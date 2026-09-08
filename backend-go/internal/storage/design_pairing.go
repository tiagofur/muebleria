package storage

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #499 / DT-SU-1: one-time Web-to-SketchUp pairing grants (persistence).
//
// Pattern sources, deliberately not reinvented:
//   - lifecycle/TTL/one-time semantics mirror #460 device enrollments —
//     conditional status UPDATEs make a replayed exchange lose atomically;
//   - tenant scoping is the designs tenant-owned model — every statement
//     runs under the caller's own organization RLS scope, so a cross-org
//     code is indistinguishable from an unknown one;
//   - the raw code never persists (hash-only) and audit details never
//     include the code or its hash.
var (
	ErrPairingGrantNotFound = errors.New("pairing grant not found")
	ErrPairingGrantConflict = errors.New("pairing grant not exchangeable")
)

const pairingGrantColumns = `id, organization_id, project_id, design_id,
	COALESCE(base_revision_id::text, ''), action, code_hash, status, expires_at,
	created_by, exchanged_at, COALESCE(exchanged_by_session_id::text, ''),
	created_at, updated_at, version`

// HashPairingCode derives the stored form of a pairing code. Stored and
// compared as sha256 bytes only.
func HashPairingCode(normalizedCode string) []byte {
	sum := sha256.Sum256([]byte(normalizedCode))
	return sum[:]
}

func scanDesignPairingGrant(row pgx.Row) (*domain.DesignPairingGrant, error) {
	var g domain.DesignPairingGrant
	if err := row.Scan(&g.ID, &g.OrganizationID, &g.ProjectID, &g.DesignID,
		&g.BaseRevisionID, &g.Action, &g.CodeHash, &g.Status, &g.ExpiresAt, &g.CreatedBy,
		&g.ExchangedAt, &g.ExchangedBySessionID, &g.CreatedAt, &g.UpdatedAt, &g.Version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPairingGrantNotFound
		}
		return nil, err
	}
	return &g, nil
}

// CreateDesignPairingGrantCommand pins the exact handoff scope. Project,
// design and the optional pinned base revision are validated to belong to
// the same organization lineage before the row exists.
type CreateDesignPairingGrantCommand struct {
	ProjectID      string
	DesignID       string
	BaseRevisionID string // "" = no published revision yet
	Action         string
	Code           string // normalized, as returned to the creating user
	TTL            time.Duration
	ActorUserID    string
	IP             string
	RequestID      string
}

// CreateDesignPairingGrant validates the exact Project/Design/base-revision
// lineage, then inserts the pending hash-only grant plus its creation audit
// in the caller's tenant transaction. Foreign objects answer
// ErrDesignNotFound uniformly — never a partial scope.
func (s *PostgresStore) CreateDesignPairingGrant(ctx context.Context, cmd CreateDesignPairingGrantCommand) (*domain.DesignPairingGrant, error) {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.DesignID) ||
		!domain.IsValidPairingAction(cmd.Action) || cmd.Code == "" ||
		cmd.TTL <= 0 || !isValidUUID(cmd.ActorUserID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	if cmd.BaseRevisionID != "" && !isValidUUID(cmd.BaseRevisionID) {
		return nil, domain.ErrInvalidDesignCommand
	}

	// Exact lineage validation (mirrors #388 negative proofs): project must
	// exist and be visible under the caller's org scope; the design must
	// belong to that exact project; a pinned base revision must belong to
	// that exact design. Anything else is uniformly not-found.
	var orgID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT p.organization_id::text
		FROM projects p
		JOIN designs d ON d.project_id = p.id AND d.id = $2
		WHERE p.id = $1
	`, cmd.ProjectID, cmd.DesignID).Scan(&orgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, fmt.Errorf("resolve pairing grant project/design: %w", err)
	}
	if cmd.BaseRevisionID != "" {
		var revDesign string
		err := s.db(ctx).QueryRow(ctx, `
			SELECT design_id::text FROM design_revisions WHERE id = $1
		`, cmd.BaseRevisionID).Scan(&revDesign)
		if err != nil || revDesign != cmd.DesignID {
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("resolve pairing grant base revision: %w", err)
			}
			return nil, domain.ErrDesignRevisionNotFound
		}
	}

	var baseRev *string
	if cmd.BaseRevisionID != "" {
		baseRev = &cmd.BaseRevisionID
	}
	var created *domain.DesignPairingGrant
	execute := func(txCtx context.Context) error {
		created, err = scanDesignPairingGrant(s.db(txCtx).QueryRow(txCtx, `
			INSERT INTO design_pairing_grants
				(organization_id, project_id, design_id, base_revision_id, action, code_hash, status, expires_at, created_by)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::uuid)
			RETURNING `+pairingGrantColumns,
			orgID, cmd.ProjectID, cmd.DesignID, baseRev, cmd.Action,
			HashPairingCode(cmd.Code), domain.PairingGrantStatusPending,
			time.Now().Add(cmd.TTL).UTC(), cmd.ActorUserID))
		if err != nil {
			return err
		}
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "design_pairing_grant_created",
			ActorUserID: cmd.ActorUserID,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"grant_id":                created.ID,
				"project_id":              cmd.ProjectID,
				"design_id":               cmd.DesignID,
				"action":                  cmd.Action,
				"pinned_base_revision_id": cmd.BaseRevisionID,
				"request_id":              cmd.RequestID,
			},
		})
	}
	if transactionFromContext(ctx) != nil {
		return created, execute(ctx)
	}
	actor, _ := TenantActorFromCtx(ctx)
	if actor.OrganizationID == "" {
		actor.OrganizationID = OrgFromCtx(ctx)
	}
	err = s.WithinTenantTx(ctx, actor, execute)
	return created, err
}

// ExchangeDesignPairingGrantCommand consumes a grant by its normalized code
// under the EXCHANGING device's own tenant scope. The raw code never reaches
// persistence: only its sha256 is used for the lookup. The exchanging
// session id is the registry sid carried by the extension transport token —
// exact attribution without storing any secret.
type ExchangeDesignPairingGrantCommand struct {
	Code                 string
	ExchangedByUserID    string
	ExchangedBySessionID string
	IP                   string
	RequestID            string
}

// ExchangeDesignPairingGrant atomically consumes a pending, unexpired grant:
// the conditional pending→exchanged UPDATE makes a replayed code lose instead
// of revealing the context twice. The lookup runs under the caller's
// organization RLS scope, so a code minted by another organization is
// uniformly not-found (never a scope leak).
func (s *PostgresStore) ExchangeDesignPairingGrant(ctx context.Context, cmd ExchangeDesignPairingGrantCommand) (*domain.DesignPairingGrant, error) {
	if cmd.Code == "" || !isValidUUID(cmd.ExchangedByUserID) || !isValidUUID(cmd.ExchangedBySessionID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	codeHash := HashPairingCode(cmd.Code)
	var exchanged *domain.DesignPairingGrant
	execute := func(txCtx context.Context) error {
		// Classify before consuming so expired/cancelled/exchanged answer a
		// typed conflict while foreign codes stay uniformly not-found.
		current, err := scanDesignPairingGrant(s.db(txCtx).QueryRow(txCtx, `
			SELECT `+pairingGrantColumns+` FROM design_pairing_grants WHERE code_hash = $1
		`, codeHash))
		if errors.Is(err, ErrPairingGrantNotFound) {
			return ErrPairingGrantNotFound
		}
		if err != nil {
			return err
		}
		if current.Status != domain.PairingGrantStatusPending || time.Now().After(current.ExpiresAt) {
			return ErrPairingGrantConflict
		}
		updated, err := scanDesignPairingGrant(s.db(txCtx).QueryRow(txCtx, `
			UPDATE design_pairing_grants
			SET status = $1, exchanged_at = NOW(), exchanged_by_session_id = $2::uuid,
				updated_at = NOW(), version = version + 1
			WHERE id = $3::uuid AND status = $4 AND expires_at > NOW()
			RETURNING `+pairingGrantColumns,
			domain.PairingGrantStatusExchanged, cmd.ExchangedBySessionID, current.ID, domain.PairingGrantStatusPending))
		if err != nil {
			return err
		}
		exchanged = updated
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "design_pairing_grant_exchanged",
			ActorUserID: cmd.ExchangedByUserID,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"grant_id":   updated.ID,
				"project_id": updated.ProjectID,
				"design_id":  updated.DesignID,
				"action":     updated.Action,
				"request_id": cmd.RequestID,
			},
		})
	}
	if transactionFromContext(ctx) != nil {
		return exchanged, execute(ctx)
	}
	actor, _ := TenantActorFromCtx(ctx)
	if actor.OrganizationID == "" {
		actor.OrganizationID = OrgFromCtx(ctx)
	}
	err := s.WithinTenantTx(ctx, actor, execute)
	return exchanged, err
}

// GetDesignPairingGrant reads one grant under the caller's tenant scope by
// the exact (project, design, grant) triple; foreign or cross-paired rows
// are uniformly not-found.
func (s *PostgresStore) GetDesignPairingGrant(ctx context.Context, projectID, designID, grantID string) (*domain.DesignPairingGrant, error) {
	if !isValidUUID(projectID) || !isValidUUID(designID) || !isValidUUID(grantID) {
		return nil, ErrPairingGrantNotFound
	}
	var out *domain.DesignPairingGrant
	execute := func(txCtx context.Context) error {
		var err error
		out, err = scanDesignPairingGrant(s.db(txCtx).QueryRow(txCtx, `
			SELECT `+pairingGrantColumns+`
			FROM design_pairing_grants
			WHERE id = $1::uuid AND project_id = $2::uuid AND design_id = $3::uuid
		`, grantID, projectID, designID))
		return err
	}
	if transactionFromContext(ctx) != nil {
		return out, execute(ctx)
	}
	actor, _ := TenantActorFromCtx(ctx)
	if actor.OrganizationID == "" {
		actor.OrganizationID = OrgFromCtx(ctx)
	}
	err := s.WithinTenantTx(ctx, actor, execute)
	return out, err
}

// CancelDesignPairingGrantCommand revokes a still-pending grant. Only the
// creating user may cancel: nobody widens someone else's handoff.
type CancelDesignPairingGrantCommand struct {
	ProjectID   string
	DesignID    string
	GrantID     string
	ActorUserID string
	IP          string
	RequestID   string
}

// CancelDesignPairingGrant transitions pending→cancelled exactly once.
// Cancelling an exchanged/expired/already-cancelled grant answers
// ErrPairingGrantConflict; foreign or cross-paired grants answer
// ErrPairingGrantNotFound uniformly.
func (s *PostgresStore) CancelDesignPairingGrant(ctx context.Context, cmd CancelDesignPairingGrantCommand) (*domain.DesignPairingGrant, error) {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.DesignID) ||
		!isValidUUID(cmd.GrantID) || !isValidUUID(cmd.ActorUserID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	var cancelled *domain.DesignPairingGrant
	execute := func(txCtx context.Context) error {
		current, err := s.GetDesignPairingGrant(txCtx, cmd.ProjectID, cmd.DesignID, cmd.GrantID)
		if err != nil {
			return err
		}
		if current.Status != domain.PairingGrantStatusPending {
			return ErrPairingGrantConflict
		}
		updated, err := scanDesignPairingGrant(s.db(txCtx).QueryRow(txCtx, `
			UPDATE design_pairing_grants
			SET status = $1, updated_at = NOW(), version = version + 1
			WHERE id = $2::uuid AND status = $3 AND created_by = $4::uuid
			RETURNING `+pairingGrantColumns,
			domain.PairingGrantStatusCancelled, cmd.GrantID, domain.PairingGrantStatusPending, cmd.ActorUserID))
		if err != nil {
			return err
		}
		cancelled = updated
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "design_pairing_grant_cancelled",
			ActorUserID: cmd.ActorUserID,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"grant_id":   updated.ID,
				"project_id": cmd.ProjectID,
				"design_id":  cmd.DesignID,
				"request_id": cmd.RequestID,
			},
		})
	}
	if transactionFromContext(ctx) != nil {
		return cancelled, execute(ctx)
	}
	actor, _ := TenantActorFromCtx(ctx)
	if actor.OrganizationID == "" {
		actor.OrganizationID = OrgFromCtx(ctx)
	}
	err := s.WithinTenantTx(ctx, actor, execute)
	return cancelled, err
}
