package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1662: price-only requote. A published/accepted quote can expire with no
// design change while the catalog prices moved; the design-driven requote
// (#394) refuses that case (ErrRequoteNoCommercialChange). This command
// re-prices the EXACT units of the base revision — same furniture instances,
// definitions, parameters, options, finishes and frozen pricing context
// (structure revision pin, preset, base) — against the current catalog and the
// project's current commercial envelope, and freezes the result as the next
// draft revision (source_type 'price_refresh', base_quote_revision_id = base).
// The base revision stays immutable (#642).
//
// Fail-closed rules:
//   - only the owning organization, only from a published/accepted revision
//     that is the latest (CreateQuoteRevision's stale-base guard);
//   - a legacy revision without commercial snapshot or per-unit pricing
//     context cannot be re-priced (no guessing);
//   - if the frozen opening (gola/agarre) section would change shape under
//     the project's current grip, this is a configuration change, not a price
//     change: refuse and point to the design requote;
//   - the command refuses when the total did not change (no noise revision);
//     the preview reports it instead.

// PriceRefreshQuoteCommand carries the explicit decision (or a preview).
type PriceRefreshQuoteCommand struct {
	ProjectID           string
	BaseQuoteRevisionID string
	// DryRun computes the new totals without writing anything (preview).
	DryRun      bool
	ActorUserID string
	IP          string
	RequestID   string
}

// PriceRefreshQuoteResult reports the totals and, unless DryRun, the created
// draft revision.
type PriceRefreshQuoteResult struct {
	Revision           *domain.QuoteRevision
	BaseRevisionNumber int
	Currency           string
	PreviousSaleTotal  float64
	NewSaleTotal       float64
	Changed            bool
}

func roundCents(v float64) float64 { return math.Round(v*100) / 100 }

// PriceRefreshQuoteRevision previews or creates the price-refresh draft.
func (s *PostgresStore) PriceRefreshQuoteRevision(ctx context.Context, cmd PriceRefreshQuoteCommand) (*PriceRefreshQuoteResult, error) {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.BaseQuoteRevisionID) {
		return nil, domain.ErrInvalidRevisionID
	}
	if transactionFromContext(ctx) == nil {
		var result *PriceRefreshQuoteResult
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			result, txErr = s.PriceRefreshQuoteRevision(txCtx, cmd)
			return txErr
		})
		return result, err
	}

	base, snapshot, err := s.readQuoteRevision(ctx, cmd.BaseQuoteRevisionID, cmd.ProjectID, false)
	if err != nil {
		return nil, err
	}
	if base.OrganizationID != OrgFromCtx(ctx) {
		return nil, domain.ErrFurnitureInstanceProjectNotWritable
	}
	if base.Status != "published" && base.Status != "accepted" {
		return nil, fmt.Errorf("%w: sólo una cotización publicada o aceptada se re-cotiza por precios", domain.ErrQuoteRevisionInvalidTransition)
	}
	if snapshot == nil {
		return nil, domain.ErrQuoteCommercialSnapshotMissing
	}

	items, err := s.priceRefreshItems(ctx, base.ID, snapshot)
	if err != nil {
		return nil, err
	}

	// The opening section is configuration derived from the project grip:
	// only re-price it when its shape is unchanged.
	var opening *designOpeningCommercial
	if len(snapshot.OpeningBOM) > 0 {
		units := make([]designOpeningUnit, 0, len(items))
		for _, item := range items {
			units = append(units, designOpeningUnit{
				FurnitureInstanceID:   item.FurnitureInstanceID,
				FurnitureDefinitionID: item.FurnitureDefinitionID,
				QuoteLineID:           item.QuoteLineID,
				Parameters:            item.Parameters,
				MaterialChoices:       item.MaterialChoices,
			})
		}
		opening, err = s.deriveDesignOpeningCommercial(ctx, cmd.ProjectID, units)
		if err != nil {
			return nil, err
		}
		if !sameOpeningCommercialLines(snapshot, opening) {
			return nil, domain.ErrPriceRefreshConfigurationChanged
		}
	}

	refreshed, err := s.buildRequoteCommercialSnapshot(ctx, cmd.ProjectID, items, opening)
	if err != nil {
		return nil, err
	}
	// Configuration provenance is unchanged: carry the base design source.
	refreshed.DesignSource = snapshot.DesignSource

	result := &PriceRefreshQuoteResult{
		BaseRevisionNumber: base.RevisionNumber,
		Currency:           refreshed.Currency,
		PreviousSaleTotal:  roundCents(snapshot.Breakdown.SalePrice),
		NewSaleTotal:       roundCents(refreshed.Breakdown.SalePrice),
	}
	result.Changed = result.PreviousSaleTotal != result.NewSaleTotal
	if cmd.DryRun {
		return result, nil
	}
	if !result.Changed {
		return nil, domain.ErrPriceRefreshNoChange
	}

	rev, err := s.CreateQuoteRevision(ctx, CreateQuoteRevisionCommand{
		ProjectID:          cmd.ProjectID,
		OrganizationID:     base.OrganizationID,
		BaseRevisionID:     base.ID,
		Status:             "draft",
		SourceType:         "price_refresh",
		Notes:              fmt.Sprintf("Borrador con los precios del catálogo vigente (re-cotización por precios desde Q%d).", base.RevisionNumber),
		CreatedBy:          nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		Items:              items,
		CommercialSnapshot: refreshed,
	})
	if err != nil {
		return nil, err
	}
	result.Revision = rev

	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "quote_revision_created_price_refresh",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: base.OrganizationID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"project_id":               cmd.ProjectID,
			"quote_revision_id":        rev.ID,
			"revision_number":          rev.RevisionNumber,
			"source_quote_revision_id": base.ID,
			"source_revision_number":   base.RevisionNumber,
			"previous_sale_total":      result.PreviousSaleTotal,
			"new_sale_total":           result.NewSaleTotal,
			"currency":                 result.Currency,
			"item_count":               len(items),
		},
	}); err != nil {
		return nil, fmt.Errorf("audit quote_revision_created_price_refresh: %w", err)
	}
	return result, nil
}

// priceRefreshItems rebuilds the exact units of the base revision: physical
// identity and configuration from quote_revision_items, line identity, options,
// finishes and frozen pricing context from the commercial snapshot.
func (s *PostgresStore) priceRefreshItems(ctx context.Context, revisionID string, snapshot *domain.QuoteCommercialSnapshot) ([]CreateQuoteRevisionItemCommand, error) {
	unitByInstance := make(map[string]domain.QuoteCommercialUnit, len(snapshot.Units))
	for _, unit := range snapshot.Units {
		unitByInstance[unit.FurnitureInstanceID] = unit
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT furniture_instance_id, COALESCE(furniture_definition_id::text, ''), definition_version,
			parameters, material_choices, lifecycle_status
		FROM quote_revision_items
		WHERE quote_revision_id = $1
		ORDER BY furniture_instance_id`, revisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []CreateQuoteRevisionItemCommand{}
	for rows.Next() {
		var instanceID, definitionID, lifecycle string
		var version *int
		var paramsJSON, choicesJSON []byte
		if err := rows.Scan(&instanceID, &definitionID, &version, &paramsJSON, &choicesJSON, &lifecycle); err != nil {
			return nil, err
		}
		params := map[string]any{}
		if len(paramsJSON) > 0 && string(paramsJSON) != "null" {
			if err := json.Unmarshal(paramsJSON, &params); err != nil {
				return nil, domain.ErrInvalidRevisionSnapshot
			}
		}
		choices := map[string]string{}
		if len(choicesJSON) > 0 && string(choicesJSON) != "null" {
			if err := json.Unmarshal(choicesJSON, &choices); err != nil {
				return nil, domain.ErrInvalidRevisionSnapshot
			}
		}
		unit, ok := unitByInstance[instanceID]
		if !ok || unit.QuoteLineID == "" {
			return nil, fmt.Errorf("%w: la unidad %s no tiene línea comercial congelada", domain.ErrQuoteCommercialSnapshotMissing, instanceID)
		}
		if lifecycle == "active" && (unit.PricingContext == nil || (unit.PricingContext.StructureRevisionPin == nil && !unit.PricingContext.StructureIndependent)) {
			return nil, fmt.Errorf("%w: la revisión base no congeló el contexto de precio por unidad; creá una revisión comercial nueva con el contrato actual", domain.ErrQuoteCommercialSnapshotMissing)
		}
		finishes := map[string]string{}
		for _, option := range unit.Options {
			choices[option.GroupCode] = option.ChoiceID
			if option.FinishID != "" {
				finishes[option.GroupCode] = option.FinishID
			}
		}
		items = append(items, CreateQuoteRevisionItemCommand{
			FurnitureInstanceID:   instanceID,
			QuoteLineID:           unit.QuoteLineID,
			FurnitureDefinitionID: definitionID,
			DefinitionVersion:     version,
			Parameters:            params,
			MaterialChoices:       choices,
			OptionFinishes:        finishes,
			LifecycleStatus:       lifecycle,
			PricingContext:        domain.CloneQuoteCommercialPricingContext(unit.PricingContext),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("%w: la revisión base no tiene unidades", domain.ErrQuoteCommercialSnapshotMissing)
	}
	return items, nil
}
