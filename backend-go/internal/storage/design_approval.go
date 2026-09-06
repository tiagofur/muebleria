package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #395 / DT-11: explicit DesignRevision approval (digital-thread §§17, 22).
//
// Publishing records design history; approval explicitly authorizes the exact
// revision for production. The command always targets an exact revisionId (§6:
// never "latest"), is permission-gated upstream (RoleCanApproveDesignRevisions)
// and server-authoritative: actor and timestamp come from the server, never
// from the request body (§32). The snapshot columns are untouched — the DB
// trigger only ever accepts the published→approved lifecycle transition.

// ApproveDesignRevisionCommand is the GENERIC design-lifecycle approval
// command (#395: published→approved for design-first flows without a
// commercial baseline). It never represents production approval — that is a
// SEPARATE always-gated command (ApproveDesignRevisionForProductionCommand).
type ApproveDesignRevisionCommand struct {
	DesignID         string
	DesignRevisionID string
	ActorUserID      string
	IP               string
	RequestID        string
}

// ApproveDesignRevisionForProductionCommand is the production approval of
// the commercial Digital Thread (#502): it REQUIRES the exact accepted
// QuoteRevision and always runs the SAME authoritative gate chain the
// release command enforces — accepted baseline, reconciliation commercial
// gate and manufacturing preflight over the exact pair — BEFORE the
// published→approved transition. There is no skip mode: production approval
// cannot exist without the exact commercial pin.
type ApproveDesignRevisionForProductionCommand struct {
	ProjectID        string
	DesignID         string
	DesignRevisionID string
	QuoteRevisionID  string
	ActorUserID      string
	IP               string
	RequestID        string
}

// ApproveDesignRevision transitions an exact published DesignRevision to
// approved exactly once (generic design lifecycle). Re-approving an
// already-approved revision is an idempotent no-op returning the current
// state: approval metadata is history and is never rewritten. Any other
// status rejects the command.
func (s *PostgresStore) ApproveDesignRevision(ctx context.Context, cmd ApproveDesignRevisionCommand) (*domain.DesignRevision, error) {
	return s.approveDesignRevision(ctx, cmd.DesignID, cmd.DesignRevisionID, "", "", cmd.ActorUserID, cmd.IP, cmd.RequestID)
}

// ApproveDesignRevisionForProduction is the always-gated production
// approval (#502): exact accepted QuoteRevision + exact DesignRevision of
// the exact project, enforced by the release gate chain before the
// transition. Any blocker rejects with the typed domain error and leaves
// the revision published.
func (s *PostgresStore) ApproveDesignRevisionForProduction(ctx context.Context, cmd ApproveDesignRevisionForProductionCommand) (*domain.DesignRevision, error) {
	if !isValidUUID(cmd.DesignID) || !isValidUUID(cmd.DesignRevisionID) || !isValidUUID(cmd.ProjectID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	if !isValidUUID(cmd.QuoteRevisionID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	return s.approveDesignRevision(ctx, cmd.DesignID, cmd.DesignRevisionID, cmd.QuoteRevisionID, cmd.ProjectID, cmd.ActorUserID, cmd.IP, cmd.RequestID)
}

func (s *PostgresStore) approveDesignRevision(ctx context.Context, designID, revisionID, quoteRevisionID, expectedProjectID, actorOverride, ip, requestID string) (*domain.DesignRevision, error) {
	cmd := ApproveDesignRevisionCommand{
		DesignID:         designID,
		DesignRevisionID: revisionID,
		ActorUserID:      actorOverride,
		IP:               ip,
		RequestID:        requestID,
	}
	if !isValidUUID(cmd.DesignID) || !isValidUUID(cmd.DesignRevisionID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	actor := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	if actor == "" || !isValidUUID(actor) {
		return nil, domain.ErrInvalidDesignCommand
	}

	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return nil, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	txCtx := context.WithValue(ctx, transactionContextKey{}, tx)

	// 1. Load and lock the exact revision. FOR UPDATE serializes concurrent
	// approvals of the same revision: the first transitions it, the second
	// observes approved and becomes an idempotent no-op.
	row := s.db(txCtx).QueryRow(txCtx, `
		SELECT `+designRevisionColumns+`
		FROM design_revisions
		WHERE id = $1 AND design_id = $2
		FOR UPDATE
	`, cmd.DesignRevisionID, cmd.DesignID)
	rev, err := scanDesignRevision(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}

	// 2. Domain transition validation (fail-closed on superseded).
	if err := domain.ValidateDesignRevisionApproval(rev.Status); err != nil {
		return nil, err
	}

	// 2b. Production approval gate: with an exact accepted quote pinned the
	// server enforces the SAME authoritative commercial + preflight verdicts
	// the release command enforces — production approval can never bypass
	// blocking state. Idempotent replays of an already-approved revision keep
	// returning the current state (history is never rewritten).
	if expectedProjectID != "" && rev.ProjectID != expectedProjectID {
		return nil, domain.ErrCrossProjectRelease
	}
	if rev.Status == domain.DesignRevisionStatusPublished && quoteRevisionID != "" {
		if _, _, err := s.enforceProductionGates(txCtx, rev.OrganizationID, rev.ProjectID, quoteRevisionID, cmd.DesignRevisionID); err != nil {
			return nil, err
		}
	}

	// 3. The single lifecycle mutation. The immutability trigger and the
	// owner-org RLS update policy are the DB backstop behind this UPDATE.
	if rev.Status == domain.DesignRevisionStatusPublished {
		approved, err := scanDesignRevision(s.db(txCtx).QueryRow(txCtx, `
			UPDATE design_revisions
			SET status = 'approved', approved_by = $2, approved_at = NOW()
			WHERE id = $1
			RETURNING `+designRevisionColumns+`
		`, cmd.DesignRevisionID, actor))
		if err != nil {
			return nil, err
		}
		rev = approved

		// 4. Durable audit in the SAME transaction (§8).
		if err := s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:      "design_revision_approved",
			ActorUserID:    actor,
			OrganizationID: rev.OrganizationID,
			IP:             cmd.IP,
			RequestID:      cmd.RequestID,
			Details: map[string]interface{}{
				"design_revision_id": rev.ID,
				"design_id":          rev.DesignID,
				"project_id":         rev.ProjectID,
				"revision_number":    rev.RevisionNumber,
				"source_type":        string(rev.SourceType),
			},
		}); err != nil {
			return nil, fmt.Errorf("audit design_revision_approved: %w", err)
		}
	}

	// 5. Readback: full revision with items and artifacts.
	items, err := s.ListDesignRevisionItems(txCtx, rev.ID)
	if err != nil {
		return nil, err
	}
	rev.Items = items
	artifacts, err := s.ListDesignRevisionArtifacts(txCtx, rev.DesignID, rev.ID)
	if err != nil {
		return nil, err
	}
	if artifacts != nil {
		rev.Artifacts = artifacts
	}

	if owned {
		if err := tx.Commit(txCtx); err != nil {
			return nil, err
		}
	}
	return rev, nil
}
