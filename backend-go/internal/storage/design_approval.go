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

// ApproveDesignRevisionCommand is the durable approval command.
type ApproveDesignRevisionCommand struct {
	DesignID         string
	DesignRevisionID string
	ActorUserID      string
	IP               string
	RequestID        string
}

// ApproveDesignRevision transitions an exact published DesignRevision to
// approved exactly once. Re-approving an already-approved revision is an
// idempotent no-op returning the current state: approval metadata is history
// and is never rewritten. Any other status rejects the command.
func (s *PostgresStore) ApproveDesignRevision(ctx context.Context, cmd ApproveDesignRevisionCommand) (*domain.DesignRevision, error) {
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
