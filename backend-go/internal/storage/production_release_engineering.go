package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #740 PR 1: server-authoritative Engineering start/completion bound to the
// EXACT ProductionRelease.
//
// One row per release (absent = pending). Commands run inside the tenant
// transaction with the project row locked, resolve the release by exact id
// (missing and cross-project are the same not-found), and write the durable
// security audit plus the lifecycle project event in the SAME transaction.
// Completion requires the release's frozen schema-v2 routing program — the
// minimal objective preparation evidence — and an expected version so two
// concurrent completions can never both win. Neither command touches
// Q/R/P content, materials, executions or Project.status.

// StartReleaseEngineeringCommand starts (idempotently) the engineering
// preparation of one exact release.
type StartReleaseEngineeringCommand struct {
	ProjectID   string
	ReleaseID   string
	ActorUserID string
	IP          string
	RequestID   string
}

// CompleteReleaseEngineeringCommand completes the engineering preparation of
// one exact release. ExpectedVersion is the version the actor last read;
// a concurrent completion makes it stale and the command fails closed.
type CompleteReleaseEngineeringCommand struct {
	ProjectID       string
	ReleaseID       string
	ActorUserID     string
	ExpectedVersion int
	IP              string
	RequestID       string
}

// ReleaseEngineeringOutcome reports the durable state after the command plus
// whether this call performed the transition (false = idempotent replay of an
// already-recorded fact — the row keeps the original actor/timestamp).
type ReleaseEngineeringOutcome struct {
	State        domain.ReleaseEngineeringState
	Transitioned bool
}

// StartReleaseEngineering records the durable engineering start for the exact
// release. Retries and lost responses converge on the same row: the first
// actor/timestamp wins and later calls are honest no-ops.
func (s *PostgresStore) StartReleaseEngineering(ctx context.Context, cmd StartReleaseEngineeringCommand) (*ReleaseEngineeringOutcome, error) {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.ReleaseID) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	actor := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	if actor == "" || !isValidUUID(actor) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	if transactionFromContext(ctx) == nil {
		tenantActor, ok := TenantActorFromCtx(ctx)
		if !ok {
			return nil, ErrInvalidTenantActor
		}
		var result *ReleaseEngineeringOutcome
		err := s.WithinTenantTx(ctx, tenantActor, func(inner context.Context) error {
			var err error
			result, err = s.StartReleaseEngineering(inner, cmd)
			return err
		})
		if err != nil {
			return nil, err
		}
		return result, nil
	}
	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return nil, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	txCtx := context.WithValue(ctx, transactionContextKey{}, tx)

	release, projectOrgID, err := s.lockExactReleaseProject(txCtx, cmd.ProjectID, cmd.ReleaseID)
	if err != nil {
		return nil, err
	}

	// First writer wins; everyone else converges on the same durable fact.
	state, inserted, err := scanReleaseEngineeringState(tx.QueryRow(txCtx, `
		INSERT INTO production_release_engineering (
			release_id, project_id, organization_id, status, started_by
		) VALUES ($1, $2, $3, 'in_progress', $4)
		ON CONFLICT (release_id) DO NOTHING
		RETURNING release_id::text, status, started_by::text, started_at,
			completed_by::text, completed_at, version
	`, cmd.ReleaseID, cmd.ProjectID, release.OrganizationID, actor))
	if err != nil {
		return nil, err
	}
	if !inserted {
		// Idempotent: the release already carries its (immutable) start fact.
		existing, err := s.releaseEngineeringStateTx(txCtx, cmd.ProjectID, cmd.ReleaseID)
		if err != nil {
			return nil, err
		}
		return &ReleaseEngineeringOutcome{State: *existing, Transitioned: false}, nil
	}

	if err := s.auditReleaseEngineering(txCtx, "engineering_started", actor, release, projectOrgID, cmd.IP, cmd.RequestID, map[string]interface{}{
		"status": string(domain.ReleaseEngineeringInProgress),
	}); err != nil {
		return nil, err
	}
	if err := appendReleaseEngineeringEventTx(txCtx, cmd.ProjectID, actor, release, "engineering_started",
		"Ingeniería iniciada para la liberación #"+fmt.Sprint(release.ReleaseNumber)); err != nil {
		return nil, err
	}

	if owned {
		if err := tx.Commit(txCtx); err != nil {
			return nil, err
		}
	}
	return &ReleaseEngineeringOutcome{State: *state, Transitioned: true}, nil
}

// CompleteReleaseEngineering records the durable engineering completion for
// the exact release. Requires a prior start, the frozen routing preparation
// evidence, and the expected row version; completion is final.
func (s *PostgresStore) CompleteReleaseEngineering(ctx context.Context, cmd CompleteReleaseEngineeringCommand) (*ReleaseEngineeringOutcome, error) {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.ReleaseID) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	if cmd.ExpectedVersion < 1 {
		return nil, domain.ErrInvalidReleaseCommand
	}
	actor := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	if actor == "" || !isValidUUID(actor) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	if transactionFromContext(ctx) == nil {
		tenantActor, ok := TenantActorFromCtx(ctx)
		if !ok {
			return nil, ErrInvalidTenantActor
		}
		var result *ReleaseEngineeringOutcome
		err := s.WithinTenantTx(ctx, tenantActor, func(inner context.Context) error {
			var err error
			result, err = s.CompleteReleaseEngineering(inner, cmd)
			return err
		})
		if err != nil {
			return nil, err
		}
		return result, nil
	}
	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return nil, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	txCtx := context.WithValue(ctx, transactionContextKey{}, tx)

	release, projectOrgID, err := s.lockExactReleaseProject(txCtx, cmd.ProjectID, cmd.ReleaseID)
	if err != nil {
		return nil, err
	}

	// Minimal objective preparation evidence: the release must carry its
	// frozen schema-v2 routing program (same evidence the physical writers
	// trust). A release without it cannot honestly complete engineering.
	frozen, err := s.GetProductionReleaseManufacturingSnapshot(txCtx, cmd.ProjectID, cmd.ReleaseID)
	if err != nil {
		return nil, domain.ErrEngineeringRoutingUnavailable
	}
	if frozen.SchemaVersion < 2 || frozen.Routing == nil ||
		frozen.Release.DesignRevisionID != release.DesignRevisionID ||
		frozen.Release.ManufacturingFingerprint != release.ManufacturingFingerprint {
		return nil, domain.ErrEngineeringRoutingUnavailable
	}

	// Guarded one-way transition under the expected version. The trigger
	// (migration 000134) independently rejects identity rewrites, downgrades
	// and version jumps.
	state, updated, err := scanReleaseEngineeringState(tx.QueryRow(txCtx, `
		UPDATE production_release_engineering
		SET status = 'completed', completed_by = $2, completed_at = NOW(),
		    version = version + 1, updated_at = NOW()
		WHERE release_id = $1 AND status = 'in_progress' AND version = $3
		RETURNING release_id::text, status, started_by::text, started_at,
			completed_by::text, completed_at, version
	`, cmd.ReleaseID, actor, cmd.ExpectedVersion))
	if err != nil {
		return nil, err
	}
	if !updated {
		existing, lErr := s.releaseEngineeringStateTx(txCtx, cmd.ProjectID, cmd.ReleaseID)
		if lErr != nil {
			return nil, lErr
		}
		if existing == nil {
			return nil, domain.ErrEngineeringNotStarted
		}
		if existing.Status == domain.ReleaseEngineeringCompleted {
			// Idempotent: the completion fact is already durable; the row
			// keeps the original actor/timestamp.
			return &ReleaseEngineeringOutcome{State: *existing, Transitioned: false}, nil
		}
		return nil, ErrVersionConflict
	}

	if err := s.auditReleaseEngineering(txCtx, "engineering_completed", actor, release, projectOrgID, cmd.IP, cmd.RequestID, map[string]interface{}{
		"status":                    string(domain.ReleaseEngineeringCompleted),
		"expected_version":          cmd.ExpectedVersion,
		"routing_schema_version":    frozen.SchemaVersion,
	}); err != nil {
		return nil, err
	}
	if err := appendReleaseEngineeringEventTx(txCtx, cmd.ProjectID, actor, release, "engineering_completed",
		"Ingeniería completa para la liberación #"+fmt.Sprint(release.ReleaseNumber)); err != nil {
		return nil, err
	}

	if owned {
		if err := tx.Commit(txCtx); err != nil {
			return nil, err
		}
	}
	return &ReleaseEngineeringOutcome{State: *state, Transitioned: true}, nil
}

// GetReleaseEngineeringState loads the durable engineering state of one exact
// release (nil = pending). Reads never write. The exact release must be
// visible under tenant RLS AND belong to the caller's organization — the
// evidence is owner-internal, so a shared reader never receives a false
// "pending" for a release another org completed.
func (s *PostgresStore) GetReleaseEngineeringState(ctx context.Context, projectID, releaseID string) (*domain.ReleaseEngineeringState, error) {
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	// Ownership check first — inside or outside a transaction. s.db(ctx)
	// resolves to the surrounding transaction when one exists (the auth
	// middleware wraps every request in one).
	var releaseOrgID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT pr.organization_id::text
		FROM production_releases pr
		WHERE pr.id = $1 AND pr.project_id = $2
	`, releaseID, projectID).Scan(&releaseOrgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrReleaseNotFound
		}
		return nil, err
	}
	if releaseOrgID != OrgFromCtx(ctx) {
		return nil, domain.ErrCrossProjectRelease
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT release_id::text, status, started_by::text, started_at,
			completed_by::text, completed_at, version
		FROM production_release_engineering
		WHERE release_id = $1 AND project_id = $2 AND organization_id = $3
	`, releaseID, projectID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return nil, nil
	}
	state, _, err := scanReleaseEngineeringState(rows)
	if err != nil {
		return nil, err
	}
	return state, nil
}

// EngineeringStatesByRelease batch-loads the durable engineering states for
// the exact releases (list read model projection, #740). Absent = absent.
func (s *PostgresStore) EngineeringStatesByRelease(ctx context.Context, releaseIDs []string) (map[string]*domain.ReleaseEngineeringState, error) {
	out := make(map[string]*domain.ReleaseEngineeringState, len(releaseIDs))
	valid := make([]string, 0, len(releaseIDs))
	for _, id := range releaseIDs {
		if isValidUUID(id) {
			valid = append(valid, id)
		}
	}
	if len(valid) == 0 {
		return out, nil
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT release_id::text, status, started_by::text, started_at,
			completed_by::text, completed_at, version
		FROM production_release_engineering
		WHERE release_id = ANY($1) AND organization_id = $2
	`, valid, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		state, _, err := scanReleaseEngineeringState(rows)
		if err != nil {
			return nil, err
		}
		out[state.ReleaseID] = state
	}
	return out, rows.Err()
}

// lockExactReleaseProject locks the project row (org/sales/manufacturing
// visibility, mirroring the physical writers) and loads the EXACT release —
// missing and cross-project stay the same not-found. Engineering facts are
// owner-organization authored; a caller from any other org fails closed.
func (s *PostgresStore) lockExactReleaseProject(ctx context.Context, projectID, releaseID string) (*domain.ProductionRelease, string, error) {
	var projectOrgID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id FROM projects
		WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2)
		FOR UPDATE
	`, projectID, OrgFromCtx(ctx)).Scan(&projectOrgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", domain.ErrDesignNotFound
		}
		return nil, "", err
	}
	tx := transactionFromContext(ctx)
	release, err := s.getProjectProductionReleaseTx(ctx, tx, projectID, releaseID)
	if err != nil {
		return nil, "", err
	}
	if release.OrganizationID != OrgFromCtx(ctx) {
		// Only the owner organization authors engineering facts for its
		// releases; shared readers never do.
		return nil, "", domain.ErrCrossProjectRelease
	}
	return release, projectOrgID, nil
}

// releaseEngineeringStateTx reads one exact row on the command transaction.
func (s *PostgresStore) releaseEngineeringStateTx(ctx context.Context, projectID, releaseID string) (*domain.ReleaseEngineeringState, error) {
	rows, err := transactionFromContext(ctx).Query(ctx, `
		SELECT release_id::text, status, started_by::text, started_at,
			completed_by::text, completed_at, version
		FROM production_release_engineering
		WHERE release_id = $1 AND project_id = $2 AND organization_id = $3
	`, releaseID, projectID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return nil, nil
	}
	state, _, err := scanReleaseEngineeringState(rows)
	return state, err
}

// scanReleaseEngineeringState scans the durable row; the second return is
// false when no row matched (pgx.ErrNoRows), keeping call sites explicit.
func scanReleaseEngineeringState(row interface{ Scan(dest ...interface{}) error }) (*domain.ReleaseEngineeringState, bool, error) {
	var state domain.ReleaseEngineeringState
	err := row.Scan(&state.ReleaseID, &state.Status, &state.StartedBy, &state.StartedAt,
		&state.CompletedBy, &state.CompletedAt, &state.Version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return &state, true, nil
}

// auditReleaseEngineering writes the durable security audit event in the SAME
// transaction as the transition (CreateProductionRelease pattern).
func (s *PostgresStore) auditReleaseEngineering(ctx context.Context, eventType, actor string, release *domain.ProductionRelease, projectOrgID, ip, requestID string, details map[string]interface{}) error {
	all := map[string]interface{}{
		"production_release_id":     release.ID,
		"project_id":                release.ProjectID,
		"release_number":            release.ReleaseNumber,
		"design_revision_id":        release.DesignRevisionID,
		"manufacturing_fingerprint": release.ManufacturingFingerprint,
	}
	for k, v := range details {
		all[k] = v
	}
	return s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      eventType,
		ActorUserID:    actor,
		OrganizationID: projectOrgID,
		IP:             ip,
		RequestID:      requestID,
		Details:        all,
	})
}

// appendReleaseEngineeringEventTx appends the lifecycle project event in the
// same transaction (source "api": server command, not a client append).
func appendReleaseEngineeringEventTx(ctx context.Context, projectID, actor string, release *domain.ProductionRelease, eventType, note string) error {
	payload, err := json.Marshal(map[string]interface{}{
		"release_id":     release.ID,
		"release_number": release.ReleaseNumber,
	})
	if err != nil {
		return err
	}
	var byUser *string
	if actor != "" {
		byUser = &actor
	}
	at := time.Now().UTC()
	_, err = transactionFromContext(ctx).Exec(ctx, `
		INSERT INTO project_events (id, project_id, type, at, by_user_id, source, note, payload, organization_id)
		VALUES ($1, $2, $3, $4, $5, 'api', $6, $7, $8)
		ON CONFLICT (id) DO NOTHING
	`, newStorageEventID(), projectID, eventType, at, byUser, note, payload, OrgFromCtx(ctx))
	return err
}

// newStorageEventID mints a storage-side event id (server commands author
// their lifecycle events; the api helper lives in another package).
func newStorageEventID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("evt_%d", time.Now().UnixNano())
	}
	return "evt_" + hex.EncodeToString(b[:])
}
