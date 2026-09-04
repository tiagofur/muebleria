package storage

import (
	"context"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #394 / DT-10: explicit re-quote workflow over the exact #393
// reconciliation (ADR-0003, digital-thread §§15–16, 25.5, 26).
//
// The new draft QuoteRevision is created ONLY through this explicit command.
// Everything is recomputed server-side from the exact revisions (#394 §31):
// the classification sent by any client is never trusted, values for the new
// snapshot derive exclusively from the exact DesignRevision + exact source
// QuoteRevision, and the accepted source revision is never rewritten
// (immutability enforced by CreateQuoteRevision + DB triggers).

// RequoteProjectQuoteCommand holds the explicit re-quote decision.
type RequoteProjectQuoteCommand struct {
	ProjectID           string
	BaseQuoteRevisionID string
	DesignRevisionID    string
	// IncludeFurnitureInstanceIDs optionally restricts which design-driven
	// commercial changes are incorporated (nil/empty = incorporate all).
	// Sold units are carried over regardless — it never deletes anything.
	IncludeFurnitureInstanceIDs []string
	ActorUserID                 string
	IP                          string
	RequestID                   string
}

// RequoteProjectQuoteResult returns the created draft revision plus the
// server-side classification that justified it.
type RequoteProjectQuoteResult struct {
	Revision       *domain.QuoteRevision
	Classification *domain.ImpactClassificationResult
}

// RequoteProjectQuote creates the next draft QuoteRevision from an explicit
// user decision, incorporating the commercial state of the exact
// DesignRevision into the exact source QuoteRevision.
//
// Business atomicity (#394 §30): validation, reconciliation, classification,
// draft building, revision creation and audit all run inside ONE transaction
// — a failure leaves no partial revision. Optimistic concurrency is inherited
// from CreateQuoteRevision (#393): the base revision must be the exact
// latest, otherwise ErrQuoteRevisionConflict (409 stale base).
func (s *PostgresStore) RequoteProjectQuote(ctx context.Context, cmd RequoteProjectQuoteCommand) (*RequoteProjectQuoteResult, error) {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.BaseQuoteRevisionID) || !isValidUUID(cmd.DesignRevisionID) {
		return nil, domain.ErrInvalidRevisionID
	}
	for _, id := range cmd.IncludeFurnitureInstanceIDs {
		if !isValidUUID(id) {
			return nil, domain.ErrInvalidRevisionID
		}
	}

	if transactionFromContext(ctx) == nil {
		var result *RequoteProjectQuoteResult
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			result, txErr = s.RequoteProjectQuote(txCtx, cmd)
			return txErr
		})
		return result, err
	}

	// 1. Load the exact revision snapshots under the tenant transaction.
	inputs, err := s.loadReconciliationInputs(ctx, cmd.ProjectID, cmd.BaseQuoteRevisionID, cmd.DesignRevisionID)
	if err != nil {
		return nil, err
	}
	if inputs.OrganizationID != OrgFromCtx(ctx) {
		// The project is visible (shared read) but owned by another
		// organization: commercial revisions stay with the owner.
		return nil, domain.ErrFurnitureInstanceProjectNotWritable
	}

	// 2. Reconcile + classify + build the draft server-side. Client input is
	// limited to the inclusion decision; every value comes from the exact
	// snapshots (#394 §32).
	recon, err := domain.Reconcile(inputs.Quote, inputs.Design)
	if err != nil {
		return nil, err
	}
	plan := domain.RequotePlan{}
	if len(cmd.IncludeFurnitureInstanceIDs) > 0 {
		plan.Include = make(map[string]bool, len(cmd.IncludeFurnitureInstanceIDs))
		for _, id := range cmd.IncludeFurnitureInstanceIDs {
			plan.Include[id] = true
		}
	}
	draft, err := domain.BuildRequoteDraft(inputs.Quote, inputs.Design, recon, plan)
	if err != nil {
		return nil, err
	}

	// 3. Create the immutable draft revision through the single #393 writer:
	// atomic items, race-safe numbering and fail-closed base revision
	// concurrency all come from CreateQuoteRevision.
	items := make([]CreateQuoteRevisionItemCommand, len(draft.Items))
	for i, item := range draft.Items {
		items[i] = CreateQuoteRevisionItemCommand{
			FurnitureInstanceID:   item.FurnitureInstanceID,
			FurnitureDefinitionID: item.FurnitureDefinitionID,
			DefinitionVersion:     item.DefinitionVersion,
			Parameters:            item.Parameters,
			MaterialChoices:       item.MaterialChoices,
			LifecycleStatus:       item.LifecycleStatus,
		}
	}
	rev, err := s.CreateQuoteRevision(ctx, CreateQuoteRevisionCommand{
		ProjectID:              cmd.ProjectID,
		OrganizationID:         inputs.OrganizationID,
		BaseRevisionID:         cmd.BaseQuoteRevisionID,
		Status:                 "draft",
		SourceType:             "requote",
		Notes:                  "Borrador generado desde la revisión de diseño tras detectar cambios comerciales en la reconciliación.",
		CreatedBy:              nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		SourceDesignRevisionID: cmd.DesignRevisionID,
		Items:                  items,
	})
	if err != nil {
		return nil, err
	}

	// 4. Durable audit in the SAME transaction (#394 §36).
	actorUserID := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	auditErr := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "quote_revision_created_from_design",
		ActorUserID:    actorUserID,
		OrganizationID: inputs.OrganizationID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"project_id":                cmd.ProjectID,
			"quote_revision_id":         rev.ID,
			"revision_number":           rev.RevisionNumber,
			"source_quote_revision_id":  cmd.BaseQuoteRevisionID,
			"design_revision_id":        cmd.DesignRevisionID,
			"status":                    rev.Status,
			"commercial_changes":        draft.Classification.Summary.CommercialChanges,
			"manufacturing_changes":     draft.Classification.Summary.ManufacturingChanges,
			"spatial_changes":           draft.Classification.Summary.SpatialChanges,
			"incorporated_instance_ids": draft.IncorporatedInstanceIDs,
			"item_count":                len(draft.Items),
		},
	})
	if auditErr != nil {
		return nil, fmt.Errorf("audit quote_revision_created_from_design: %w", auditErr)
	}

	return &RequoteProjectQuoteResult{
		Revision:       rev,
		Classification: draft.Classification,
	}, nil
}
