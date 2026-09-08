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
	// ErrPairingGrantMismatch: the confirmed binding does not match the
	// grant's exact pinned identity (wrong project/design/base).
	ErrPairingGrantMismatch = errors.New("pairing grant identity mismatch")
)

const pairingGrantColumns = `id, organization_id, project_id, design_id,
	COALESCE(base_revision_id::text, ''), action, code_hash, status, expires_at,
	created_by, created_by_session_id, exchanged_at, COALESCE(exchanged_by_session_id::text, ''),
	confirmed_at, COALESCE(confirmed_by_session_id::text, ''),
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
		&g.CreatedBySessionID, &g.ExchangedAt, &g.ExchangedBySessionID,
		&g.ConfirmedAt, &g.ConfirmedBySessionID,
		&g.CreatedAt, &g.UpdatedAt, &g.Version); err != nil {
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
	SessionID      string // creating web session (registry sid); provenance, never a secret
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
		cmd.TTL <= 0 || !isValidUUID(cmd.ActorUserID) || !isValidUUID(cmd.SessionID) {
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
				(organization_id, project_id, design_id, base_revision_id, action, code_hash, status, expires_at, created_by, created_by_session_id)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::uuid, $10::uuid)
			RETURNING `+pairingGrantColumns,
			orgID, cmd.ProjectID, cmd.DesignID, baseRev, cmd.Action,
			HashPairingCode(cmd.Code), domain.PairingGrantStatusPending,
			time.Now().Add(cmd.TTL).UTC(), cmd.ActorUserID, cmd.SessionID))
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
				"initiating_session_id":   cmd.SessionID,
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

// ExchangeDesignPairingGrantResult carries both halves of one coherent
// exchange: the consumed grant and the authoritative #388 binding context
// for the exact pinned base. Callers never re-validate.
type ExchangeDesignPairingGrantResult struct {
	Grant          *domain.DesignPairingGrant
	BindingContext *ModelBindingContext
}

// ExchangeDesignPairingGrant consumes a pending, unexpired grant and resolves
// the authoritative binding context in ONE transaction, in that order:
//
//  1. SELECT ... FOR UPDATE by code hash under the exchanging device's own
//     tenant scope (a foreign-org code is uniformly not-found);
//  2. pending + TTL check — a replayed/expired/cancelled code answers
//     ErrPairingGrantConflict WITHOUT touching the row;
//  3. exact #388 binding validation via GetModelBindingContext, passing the
//     grant's frozen BaseRevisionID (never nil): a grant pinned to R1
//     validates R1 even if the design has since published R2, and an invalid
//     pin fails with the exact ErrDesignRevisionNotFound — never a silent
//     re-base. A validation failure ROLLS BACK: the grant stays pending and
//     remains retryable once the cause is fixed;
//  4. only then the conditional pending→exchanged UPDATE (one winner under
//     concurrency) and the exchange audit (never the code or its hash).
func (s *PostgresStore) ExchangeDesignPairingGrant(ctx context.Context, cmd ExchangeDesignPairingGrantCommand) (*ExchangeDesignPairingGrantResult, error) {
	if cmd.Code == "" || !isValidUUID(cmd.ExchangedByUserID) || !isValidUUID(cmd.ExchangedBySessionID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	codeHash := HashPairingCode(cmd.Code)
	var result *ExchangeDesignPairingGrantResult
	execute := func(txCtx context.Context) error {
		// Lock the exact row so two concurrent exchanges of the same code
		// serialize: the loser re-reads the winner's commit and conflicts.
		current, err := scanDesignPairingGrant(s.db(txCtx).QueryRow(txCtx, `
			SELECT `+pairingGrantColumns+` FROM design_pairing_grants WHERE code_hash = $1
			FOR UPDATE
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

		// Exact pinned-base validation BEFORE any consume: a failure here
		// rolls the whole transaction back, so the grant survives pending.
		bindingCtx, err := s.GetModelBindingContext(txCtx, current.ProjectID, current.DesignID, current.BaseRevisionID)
		if err != nil {
			return err
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
		result = &ExchangeDesignPairingGrantResult{Grant: updated, BindingContext: bindingCtx}
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "design_pairing_grant_exchanged",
			ActorUserID: cmd.ExchangedByUserID,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"grant_id":                  updated.ID,
				"project_id":                updated.ProjectID,
				"design_id":                 updated.DesignID,
				"action":                    updated.Action,
				"pinned_base_revision_id":   derefString(updated.BaseRevisionID),
				"initiating_session_id":     updated.CreatedBySessionID,
				"exchanging_device_session": cmd.ExchangedBySessionID,
				"request_id":                cmd.RequestID,
			},
		})
	}
	if transactionFromContext(ctx) != nil {
		return result, execute(ctx)
	}
	actor, _ := TenantActorFromCtx(ctx)
	if actor.OrganizationID == "" {
		actor.OrganizationID = OrgFromCtx(ctx)
	}
	err := s.WithinTenantTx(ctx, actor, execute)
	return result, err
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
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

// ConfirmDesignPairingGrantCommand carries the exact binding the extension
// says it persisted and read back. Confirmation is device-only and belongs
// to the SAME session that exchanged: a different session can never confirm
// someone else's handoff.
type ConfirmDesignPairingGrantCommand struct {
	GrantID              string
	PersistedProjectID   string
	PersistedDesignID    string
	PersistedBaseRevID   string // "" = bound without a published base
	ConfirmedByUserID    string
	ConfirmedBySessionID string
	IP                   string
	RequestID            string
}

// ConfirmDesignPairingGrant closes the initiated-vs-confirmed gap (#499
// Slice 3). Exactness rules, all enforced in ONE transaction:
//   - only the grant's own exchanging session may confirm;
//   - the persisted project/design must match the grant row exactly;
//   - the persisted base must be EXACTLY the grant's frozen pin when one
//     exists (an R2 confirm against an R1 grant is rejected), or exact null
//     when the grant pinned no published revision;
//   - the transition is a conditional exchanged→confirmed UPDATE, and a
//     repeated confirm by the same session is an idempotent success.
func (s *PostgresStore) ConfirmDesignPairingGrant(ctx context.Context, cmd ConfirmDesignPairingGrantCommand) (*domain.DesignPairingGrant, error) {
	if !isValidUUID(cmd.GrantID) || !isValidUUID(cmd.PersistedProjectID) ||
		!isValidUUID(cmd.PersistedDesignID) || !isValidUUID(cmd.ConfirmedByUserID) ||
		!isValidUUID(cmd.ConfirmedBySessionID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	if cmd.PersistedBaseRevID != "" && !isValidUUID(cmd.PersistedBaseRevID) {
		return nil, domain.ErrInvalidDesignCommand
	}

	var confirmed *domain.DesignPairingGrant
	execute := func(txCtx context.Context) error {
		current, err := scanDesignPairingGrant(s.db(txCtx).QueryRow(txCtx, `
			SELECT `+pairingGrantColumns+` FROM design_pairing_grants WHERE id = $1::uuid
			FOR UPDATE
		`, cmd.GrantID))
		if errors.Is(err, ErrPairingGrantNotFound) {
			return ErrPairingGrantNotFound
		}
		if err != nil {
			return err
		}

		// Idempotent replay: the same session confirming again succeeds.
		if current.Status == domain.PairingGrantStatusConfirmed {
			if current.ConfirmedBySessionID != nil && *current.ConfirmedBySessionID == cmd.ConfirmedBySessionID {
				confirmed = current
				return nil
			}
			return ErrPairingGrantConflict
		}
		if current.Status != domain.PairingGrantStatusExchanged {
			return ErrPairingGrantConflict
		}
		if current.ExchangedBySessionID == nil || *current.ExchangedBySessionID != cmd.ConfirmedBySessionID {
			// Uniform conflict: another session's grant is indistinguishable
			// from a non-exchangeable one — never a probe oracle.
			return ErrPairingGrantConflict
		}
		if current.ProjectID != cmd.PersistedProjectID || current.DesignID != cmd.PersistedDesignID {
			return ErrPairingGrantMismatch
		}

		// Exact base rule: every grant confirms its captured pin verbatim.
		// A nil pin is meaningful: it records that no published base existed at
		// grant creation, even when a working base appears before exchange.
		var persistedBase *string
		if cmd.PersistedBaseRevID != "" {
			persistedBase = &cmd.PersistedBaseRevID
		}
		expectedBase := current.BaseRevisionID
		if derefString(expectedBase) != derefString(persistedBase) {
			return ErrPairingGrantMismatch
		}

		updated, err := scanDesignPairingGrant(s.db(txCtx).QueryRow(txCtx, `
			UPDATE design_pairing_grants
			SET status = $1, confirmed_at = NOW(), confirmed_by_session_id = $2::uuid,
				updated_at = NOW(), version = version + 1
			WHERE id = $3::uuid AND status = $4 AND exchanged_by_session_id = $5::uuid
			RETURNING `+pairingGrantColumns,
			domain.PairingGrantStatusConfirmed, cmd.ConfirmedBySessionID,
			cmd.GrantID, domain.PairingGrantStatusExchanged, cmd.ConfirmedBySessionID))
		if err != nil {
			return err
		}
		confirmed = updated
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "design_pairing_grant_confirmed",
			ActorUserID: cmd.ConfirmedByUserID,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"grant_id":              updated.ID,
				"project_id":            updated.ProjectID,
				"design_id":             updated.DesignID,
				"persisted_base_rev_id": cmd.PersistedBaseRevID,
				"request_id":            cmd.RequestID,
			},
		})
	}
	if transactionFromContext(ctx) != nil {
		return confirmed, execute(ctx)
	}
	actor, _ := TenantActorFromCtx(ctx)
	if actor.OrganizationID == "" {
		actor.OrganizationID = OrgFromCtx(ctx)
	}
	err := s.WithinTenantTx(ctx, actor, execute)
	return confirmed, err
}
