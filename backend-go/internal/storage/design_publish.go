package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #392 / DT-8: staged publication sessions and revision artifacts
// (ADR-0003, digital-thread §§17-18, 21, 26, 28).
//
// Flow: PrepareDesignPublish (manifest + base validated against the working
// copy) → RecordDesignPublishArtifact (staging metadata for each uploaded
// file; bytes are written by the API layer under the org media namespace) →
// FinalizeDesignPublish (re-validates everything under the design lock and
// reuses the #387 publish core to create the immutable revision).

// DesignPublishSessionTTL bounds how long a prepared session can still be
// finalized. Expired prepared sessions are abandoned lazily; their staged
// files are removed best-effort by the API layer.
const DesignPublishSessionTTL = 24 * time.Hour

type PrepareDesignPublishCommand struct {
	DesignID  string
	Manifest  domain.DesignPublishManifest
	ActorUserID string
	IP        string
	RequestID string
}

type RecordDesignPublishArtifactCommand struct {
	DesignID  string
	SessionID string
	Kind      domain.DesignPublishArtifactKind
	StorageKey   string
	ContentType  string
	SizeBytes    int64
	SHA256       string
	ActorUserID  string
}

type FinalizeDesignPublishCommand struct {
	DesignID    string
	SessionID   string
	ActorUserID string
	IP          string
	RequestID   string
}

// PrepareResult couples the created session with the storage keys of
// expired sessions abandoned during the lazy cleanup sweep so the API layer
// can delete those files best-effort.
type PrepareResult struct {
	Session         *domain.DesignPublishSession
	AbandonedKeys   []string
}

const designPublishSessionColumns = `
	id, organization_id, project_id, design_id,
	COALESCE(base_revision_id::text, ''),
	source::text, manifest::text,
	status, COALESCE(created_by::text, ''),
	created_at, expires_at,
	finalized_at, COALESCE(finalized_revision_id::text, '')`

func scanDesignPublishSession(row pgx.Row) (*domain.DesignPublishSession, error) {
	var s domain.DesignPublishSession
	var baseRevID, finalizedRevID string
	var finalizedAt *time.Time
	var sourceRaw, manifestRaw []byte
	if err := row.Scan(
		&s.ID, &s.OrganizationID, &s.ProjectID, &s.DesignID,
		&baseRevID, &sourceRaw, &manifestRaw,
		&s.Status, &s.CreatedBy,
		&s.CreatedAt, &s.ExpiresAt,
		&finalizedAt, &finalizedRevID,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrPublishSessionNotFound
		}
		return nil, err
	}
	if baseRevID != "" {
		s.BaseRevisionID = &baseRevID
	}
	var source domain.DesignPublishManifestSource
	if err := json.Unmarshal(sourceRaw, &source); err != nil {
		return nil, fmt.Errorf("%w: publish session source: %v", domain.ErrSerializationFailed, err)
	}
	s.Source = source
	manifest, err := domain.ParseDesignPublishManifest(manifestRaw)
	if err != nil {
		return nil, fmt.Errorf("%w: stored publish manifest is unreadable: %v", domain.ErrSerializationFailed, err)
	}
	s.Manifest = manifest
	s.FinalizedAt = finalizedAt
	if finalizedRevID != "" {
		s.FinalizedRevisionID = &finalizedRevID
	}
	return &s, nil
}

// prepareConsistencyError re-writes numbering conflicts in prepare terms:
// prepare only validates, so every conflict stays an ErrDesignRevisionConflict.
func manifestBaseID(m *domain.DesignPublishManifest) string {
	if m == nil || m.BaseRevisionID == nil {
		return ""
	}
	return *m.BaseRevisionID
}

// PrepareDesignPublish validates the manifest v1 against the authoritative
// working copy under the design lock and creates the staging session. The
// session pins the exact base revision; FinalizeDesignPublish re-validates it
// so a race between prepare and finalize can never publish on a stale base.
func (s *PostgresStore) PrepareDesignPublish(ctx context.Context, cmd PrepareDesignPublishCommand) (*PrepareResult, error) {
	if !isValidUUID(cmd.DesignID) {
		return nil, domain.ErrDesignNotFound
	}
	if cmd.Manifest.ProjectID == "" || cmd.Manifest.DesignID == "" {
		return nil, fmt.Errorf("%w: manifest must identify project and design", domain.ErrPublishManifestInvalid)
	}

	if transactionFromContext(ctx) == nil {
		var res *PrepareResult
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			r, err := s.PrepareDesignPublish(txCtx, cmd)
			if err != nil {
				return err
			}
			res = r
			return nil
		})
		return res, err
	}

	// Same lock ordering as publish/finalize: design row serializes every
	// publication decision for this design.
	designOrgID, projectID, err := s.lockActiveDesignForPublish(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}

	// The manifest must describe exactly this project/design.
	if cmd.Manifest.ProjectID != projectID {
		return nil, fmt.Errorf("%w: manifest projectId %s does not match the design project %s", domain.ErrPublishManifestInvalid, cmd.Manifest.ProjectID, projectID)
	}
	if cmd.Manifest.DesignID != cmd.DesignID {
		return nil, fmt.Errorf("%w: manifest designId %s does not match %s", domain.ErrPublishManifestInvalid, cmd.Manifest.DesignID, cmd.DesignID)
	}

	// Fail-closed base concurrency, same authority as publish (#387 §16): the
	// working-copy base must be current and the manifest base must agree.
	wcBaseRevID, _, err := s.loadWorkingCopyBaseForPublish(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}
	if _, _, err := s.resolveRevisionNumbering(ctx, cmd.DesignID, manifestBaseID(&cmd.Manifest), wcBaseRevID); err != nil {
		return nil, err
	}

	// Manifest must correspond to the published working-copy state (§5): the
	// FurnitureInstance sets must be exactly equal.
	workingItems, err := s.loadWorkingItemsForPublish(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}
	if err := s.validateManifestMatchesWorkingItems(&cmd.Manifest, workingItems); err != nil {
		return nil, err
	}

	// Lazy expiry sweep: abandon this design's expired prepared sessions and
	// surface their staged files for best-effort removal.
	abandonedKeys, err := s.abandonExpiredPublishSessions(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}

	sourceJSON, err := json.Marshal(cmd.Manifest.Source)
	if err != nil {
		return nil, fmt.Errorf("%w: manifest source: %v", domain.ErrSerializationFailed, err)
	}
	manifestJSON, err := json.Marshal(&cmd.Manifest)
	if err != nil {
		return nil, fmt.Errorf("%w: manifest: %v", domain.ErrSerializationFailed, err)
	}
	var createdBy *string
	if isValidUUID(cmd.ActorUserID) {
		createdBy = &cmd.ActorUserID
	}

	var baseRev *string
	if cmd.Manifest.BaseRevisionID != nil && *cmd.Manifest.BaseRevisionID != "" {
		baseRev = cmd.Manifest.BaseRevisionID
	}

	session, err := scanDesignPublishSession(s.db(ctx).QueryRow(ctx, `
		INSERT INTO design_publish_sessions (
			organization_id, project_id, design_id, base_revision_id,
			source, manifest, status, created_by, expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, 'prepared', $7, NOW() + $8::interval)
		RETURNING `+designPublishSessionColumns,
		designOrgID, projectID, cmd.DesignID, baseRev,
		sourceJSON, manifestJSON, createdBy, fmt.Sprintf("%d seconds", int(DesignPublishSessionTTL.Seconds())),
	))
	if err != nil {
		return nil, fmt.Errorf("insert design publish session: %w", err)
	}
	return &PrepareResult{Session: session, AbandonedKeys: abandonedKeys}, nil
}

func (s *PostgresStore) validateManifestMatchesWorkingItems(manifest *domain.DesignPublishManifest, workingItems []PublishDesignRevisionItemCommand) error {
	manifestIDs := make(map[string]struct{}, len(manifest.Items))
	for _, item := range manifest.Items {
		manifestIDs[item.FurnitureInstanceID] = struct{}{}
	}
	workingIDs := make(map[string]struct{}, len(workingItems))
	for _, item := range workingItems {
		workingIDs[item.FurnitureInstanceID] = struct{}{}
	}
	for id := range workingIDs {
		if _, ok := manifestIDs[id]; !ok {
			return fmt.Errorf("%w: working copy item %s is absent from the manifest", domain.ErrPublishManifestWorkingCopyMismatch, id)
		}
	}
	for id := range manifestIDs {
		if _, ok := workingIDs[id]; !ok {
			return fmt.Errorf("%w: manifest item %s is not in the working copy", domain.ErrPublishManifestWorkingCopyMismatch, id)
		}
	}
	return nil
}

// abandonExpiredPublishSessions marks this design's expired prepared sessions
// abandoned, deletes their staging rows and returns the abandoned storage
// keys so the caller can remove the files best-effort.
func (s *PostgresStore) abandonExpiredPublishSessions(ctx context.Context, designID string) ([]string, error) {
	rows, err := s.db(ctx).Query(ctx, `
		UPDATE design_publish_sessions
		SET status = 'abandoned'
		WHERE design_id = $1 AND status = 'prepared' AND expires_at < NOW()
		RETURNING id
	`, designID)
	if err != nil {
		return nil, fmt.Errorf("abandon expired publish sessions: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, nil
	}

	keyRows, err := s.db(ctx).Query(ctx, `
		DELETE FROM design_publish_artifacts
		WHERE session_id = ANY($1)
		RETURNING storage_key
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("delete expired publish artifacts: %w", err)
	}
	defer keyRows.Close()

	keys := make([]string, 0, len(ids))
	for keyRows.Next() {
		var key string
		if err := keyRows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, keyRows.Err()
}

// GetDesignPublishSession loads one staging session with its uploaded
// artifact metadata. RLS makes foreign sessions read as not found.
type DesignPublishSessionDetail struct {
	Session   *domain.DesignPublishSession
	Artifacts []domain.DesignRevisionArtifact
}

func (s *PostgresStore) GetDesignPublishSession(ctx context.Context, designID, sessionID string) (*DesignPublishSessionDetail, error) {
	if !isValidUUID(designID) || !isValidUUID(sessionID) {
		return nil, domain.ErrPublishSessionNotFound
	}
	session, err := scanDesignPublishSession(s.db(ctx).QueryRow(ctx, `
		SELECT `+designPublishSessionColumns+`
		FROM design_publish_sessions
		WHERE id = $1 AND design_id = $2
	`, sessionID, designID))
	if err != nil {
		return nil, err
	}
	artifacts, err := s.listPublishArtifacts(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	return &DesignPublishSessionDetail{Session: session, Artifacts: artifacts}, nil
}

// scanDesignPublishArtifact scans a FINAL design_revision_artifacts row
// (fourth column is the revision id).

func scanDesignPublishArtifact(row pgx.Row) (*domain.DesignRevisionArtifact, error) {
	var a domain.DesignRevisionArtifact
	if err := row.Scan(
		&a.ID, &a.OrganizationID, &a.ProjectID, &a.DesignRevisionID,
		&a.Kind, &a.StorageKey, &a.ContentType, &a.SizeBytes, &a.SHA256,
		&a.UploadedBy, &a.CreatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrPublishArtifactMissing
		}
		return nil, err
	}
	return &a, nil
}

func (s *PostgresStore) listPublishArtifacts(ctx context.Context, sessionID string) ([]domain.DesignRevisionArtifact, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, organization_id, project_id, session_id, kind,
		       storage_key, content_type, size_bytes, sha256,
		       COALESCE(uploaded_by::text, ''), created_at
		FROM design_publish_artifacts
		WHERE session_id = $1
		ORDER BY kind ASC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	artifacts := make([]domain.DesignRevisionArtifact, 0)
	for rows.Next() {
		var a domain.DesignRevisionArtifact
		if err := rows.Scan(
			&a.ID, &a.OrganizationID, &a.ProjectID, &a.DesignRevisionID,
			&a.Kind, &a.StorageKey, &a.ContentType, &a.SizeBytes, &a.SHA256,
			&a.UploadedBy, &a.CreatedAt,
		); err != nil {
			return nil, err
		}
		artifacts = append(artifacts, a)
	}
	return artifacts, rows.Err()
}

// RecordDesignPublishArtifact upserts the staging metadata of one uploaded
// artifact. Re-uploading a kind while the session is prepared replaces the
// previous row; the displaced storage key is returned so the caller can
// remove the replaced file best-effort. The session must still be prepared
// and unexpired.
func (s *PostgresStore) RecordDesignPublishArtifact(ctx context.Context, cmd RecordDesignPublishArtifactCommand) (*domain.DesignRevisionArtifact, string, error) {
	if !isValidUUID(cmd.DesignID) || !isValidUUID(cmd.SessionID) {
		return nil, "", domain.ErrPublishSessionNotFound
	}
	if !domain.IsValidDesignPublishArtifactKind(cmd.Kind) {
		return nil, "", fmt.Errorf("%w: unknown artifact kind", domain.ErrPublishManifestInvalid)
	}
	if cmd.StorageKey == "" || cmd.ContentType == "" || cmd.SizeBytes < 0 || cmd.SHA256 == "" {
		return nil, "", fmt.Errorf("%w: artifact metadata incomplete", domain.ErrPublishManifestInvalid)
	}

	if transactionFromContext(ctx) == nil {
		var artifact *domain.DesignRevisionArtifact
		var replaced string
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			a, r, err := s.RecordDesignPublishArtifact(txCtx, cmd)
			if err != nil {
				return err
			}
			artifact, replaced = a, r
			return nil
		})
		return artifact, replaced, err
	}

	var sessionOrgID, sessionProjectID string
	var status string
	var expiresAt time.Time
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id, project_id, status, expires_at
		FROM design_publish_sessions
		WHERE id = $1 AND design_id = $2
	`, cmd.SessionID, cmd.DesignID).Scan(&sessionOrgID, &sessionProjectID, &status, &expiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", domain.ErrPublishSessionNotFound
		}
		return nil, "", err
	}
	if status != "prepared" {
		return nil, "", fmt.Errorf("%w: session status is %s", domain.ErrPublishSessionNotPrepared, status)
	}
	if !time.Now().Before(expiresAt) {
		return nil, "", fmt.Errorf("%w: session expired at %s", domain.ErrPublishSessionNotPrepared, expiresAt.Format(time.RFC3339))
	}
	actorOrg := OrgFromCtx(ctx)
	if actorOrg != "" && actorOrg != sessionOrgID {
		return nil, "", domain.ErrFurnitureInstanceProjectNotWritable
	}

	var uploadedBy *string
	if isValidUUID(cmd.ActorUserID) {
		uploadedBy = &cmd.ActorUserID
	}

	// Replace semantics: read the displaced key, then upsert.
	var replaced string
	err = s.db(ctx).QueryRow(ctx, `
		SELECT storage_key FROM design_publish_artifacts
		WHERE session_id = $1 AND kind = $2
	`, cmd.SessionID, cmd.Kind).Scan(&replaced)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, "", err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		replaced = ""
	}

	var artifact domain.DesignRevisionArtifact
	err = s.db(ctx).QueryRow(ctx, `
		INSERT INTO design_publish_artifacts (
			organization_id, project_id, session_id, kind,
			storage_key, content_type, size_bytes, sha256, uploaded_by
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (session_id, kind) DO UPDATE SET
			storage_key = EXCLUDED.storage_key,
			content_type = EXCLUDED.content_type,
			size_bytes = EXCLUDED.size_bytes,
			sha256 = EXCLUDED.sha256,
			uploaded_by = EXCLUDED.uploaded_by,
			updated_at = NOW()
		RETURNING id, organization_id, project_id, session_id, kind,
		          storage_key, content_type, size_bytes, sha256,
		          COALESCE(uploaded_by::text, ''), created_at
	`, sessionOrgID, sessionProjectID, cmd.SessionID, cmd.Kind,
		cmd.StorageKey, cmd.ContentType, cmd.SizeBytes, cmd.SHA256, uploadedBy,
	).Scan(
		&artifact.ID, &artifact.OrganizationID, &artifact.ProjectID, &artifact.DesignRevisionID,
		&artifact.Kind, &artifact.StorageKey, &artifact.ContentType, &artifact.SizeBytes, &artifact.SHA256,
		&artifact.UploadedBy, &artifact.CreatedAt,
	)
	if err != nil {
		return nil, "", fmt.Errorf("upsert design publish artifact: %w", err)
	}
	return &artifact, replaced, nil
}

// FinalizeDesignPublish publishes the immutable DesignRevision from the
// working copy, links the staged artifacts and advances the working-copy
// base — all in one transaction. Every precondition is re-validated under
// the design lock: a session prepared against R7 that races another client's
// R8 can never publish an R9 based on stale state.
//
// Idempotency: a session that already finalized returns its revision instead
// of publishing again (the durable Idempotency-Key receipt replays the exact
// response on top of this).
func (s *PostgresStore) FinalizeDesignPublish(ctx context.Context, cmd FinalizeDesignPublishCommand) (*domain.DesignRevision, error) {
	if !isValidUUID(cmd.DesignID) || !isValidUUID(cmd.SessionID) {
		return nil, domain.ErrPublishSessionNotFound
	}

	if transactionFromContext(ctx) == nil {
		var rev *domain.DesignRevision
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			r, err := s.FinalizeDesignPublish(txCtx, cmd)
			if err != nil {
				return err
			}
			rev = r
			return nil
		})
		return rev, err
	}

	// 1. Serialize publication decisions for this design.
	designOrgID, projectID, err := s.lockActiveDesignForPublish(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}

	// 2. Session must exist, belong to this design and still be live.
	detail, err := s.GetDesignPublishSession(ctx, cmd.DesignID, cmd.SessionID)
	if err != nil {
		return nil, err
	}
	session := detail.Session
	if session.Status == "finalized" {
		// Idempotent replay: the exact same session finalizes to the exact
		// same revision, never a second one.
		if session.FinalizedRevisionID == nil {
			return nil, fmt.Errorf("%w: finalized session %s has no revision", domain.ErrPublishSessionNotPrepared, session.ID)
		}
		return s.GetDesignRevision(ctx, cmd.DesignID, *session.FinalizedRevisionID)
	}
	if session.Status != "prepared" {
		return nil, fmt.Errorf("%w: session status is %s", domain.ErrPublishSessionNotPrepared, session.Status)
	}
	if !time.Now().Before(session.ExpiresAt) {
		return nil, fmt.Errorf("%w: session expired at %s", domain.ErrPublishSessionNotPrepared, session.ExpiresAt.Format(time.RFC3339))
	}

	// 3. All required artifacts must be staged with complete metadata.
	staged := make(map[domain.DesignPublishArtifactKind]domain.DesignRevisionArtifact, len(detail.Artifacts))
	for _, a := range detail.Artifacts {
		staged[a.Kind] = a
	}
	for _, kind := range domain.RequiredDesignPublishArtifacts {
		if _, ok := staged[kind]; !ok {
			return nil, fmt.Errorf("%w: %s artifact was not uploaded", domain.ErrPublishArtifactMissing, kind)
		}
	}

	// 4. Fail-closed base concurrency re-check (race between prepare and
	// finalize is rejected here, never rebased).
	wcBaseRevID, _, err := s.loadWorkingCopyBaseForPublish(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}
	nextRevisionNum, effectiveParentID, err := s.resolveRevisionNumbering(ctx, cmd.DesignID, manifestBaseID(session.Manifest), wcBaseRevID)
	if err != nil {
		return nil, err
	}

	// 5. Manifest must still correspond to the working copy (the client may
	// have edited items after prepare — that publish is stale, re-prepare).
	workingItems, err := s.loadWorkingItemsForPublish(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}
	if err := s.validateManifestMatchesWorkingItems(session.Manifest, workingItems); err != nil {
		return nil, err
	}
	if err := s.validateWorkingItemsForPublish(ctx, projectID, workingItems); err != nil {
		return nil, err
	}

	// 6. Publish the immutable revision through the shared #387 core.
	rev, err := s.insertDesignRevisionAndItems(ctx, designOrgID, projectID, cmd.DesignID,
		nextRevisionNum, effectiveParentID, domain.DesignRevisionSourceSketchup,
		nonEmptyOrDefault(session.CreatedBy, cmd.ActorUserID), workingItems)
	if err != nil {
		return nil, err
	}

	// 7. Link the staged artifacts to the revision (immutable rows).
	var uploadedBy *string
	if isValidUUID(cmd.ActorUserID) {
		uploadedBy = &cmd.ActorUserID
	}
	artifacts := make([]domain.DesignRevisionArtifact, 0, len(staged))
	for _, kind := range domain.RequiredDesignPublishArtifacts {
		a := staged[kind]
		var inserted domain.DesignRevisionArtifact
		err = s.db(ctx).QueryRow(ctx, `
			INSERT INTO design_revision_artifacts (
				organization_id, project_id, design_revision_id, kind,
				storage_key, content_type, size_bytes, sha256, uploaded_by
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING id, organization_id, project_id, design_revision_id, kind,
			          storage_key, content_type, size_bytes, sha256,
			          COALESCE(uploaded_by::text, ''), created_at
		`, designOrgID, projectID, rev.ID, kind,
			a.StorageKey, a.ContentType, a.SizeBytes, a.SHA256, uploadedBy,
		).Scan(
			&inserted.ID, &inserted.OrganizationID, &inserted.ProjectID, &inserted.DesignRevisionID,
			&inserted.Kind, &inserted.StorageKey, &inserted.ContentType, &inserted.SizeBytes, &inserted.SHA256,
			&inserted.UploadedBy, &inserted.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("insert design revision artifact: %w", err)
		}
		artifacts = append(artifacts, inserted)
	}
	rev.Artifacts = artifacts

	// 8. Advance the working-copy base; working items remain as authoring
	// state (§29: do not destroy the working copy).
	if err := s.advanceWorkingCopyBaseForPublish(ctx, cmd.DesignID, designOrgID, projectID, rev,
		nonEmptyOrDefault(cmd.ActorUserID, session.CreatedBy)); err != nil {
		return nil, err
	}

	// 9. Mark the session finalized.
	_, err = s.db(ctx).Exec(ctx, `
		UPDATE design_publish_sessions
		SET status = 'finalized', finalized_at = NOW(), finalized_revision_id = $2
		WHERE id = $1 AND status = 'prepared'
	`, cmd.SessionID, rev.ID)
	if err != nil {
		return nil, fmt.Errorf("finalize design publish session: %w", err)
	}

	// 10. Durable audit with artifact references (#392 §35).
	artifactRefs := make([]map[string]interface{}, 0, len(artifacts))
	for _, a := range artifacts {
		artifactRefs = append(artifactRefs, map[string]interface{}{
			"kind":          string(a.Kind),
			"sha256":        a.SHA256,
			"size_bytes":    a.SizeBytes,
			"content_type":  a.ContentType,
		})
	}
	extras := map[string]interface{}{
		"publish_session_id": session.ID,
		"artifacts":          artifactRefs,
		"authoring_client":   session.Source.Client,
		"sketchup_version":   session.Source.SketchUpVersion,
		"plugin_version":     session.Source.PluginVersion,
	}
	if err := s.auditDesignRevisionPublished(ctx, rev,
		nonEmptyOrDefault(cmd.ActorUserID, session.CreatedBy), cmd.IP, cmd.RequestID, extras); err != nil {
		return nil, err
	}

	return rev, nil
}

// ListDesignRevisionArtifacts returns the published artifact metadata of one
// revision (read model for Web/backend revision readback, §31).
func (s *PostgresStore) ListDesignRevisionArtifacts(ctx context.Context, designID, revisionID string) ([]domain.DesignRevisionArtifact, error) {
	if !isValidUUID(designID) || !isValidUUID(revisionID) {
		return nil, domain.ErrDesignRevisionNotFound
	}
	var revDesignID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT design_id FROM design_revisions WHERE id = $1
	`, revisionID).Scan(&revDesignID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}
	if revDesignID != designID {
		return nil, domain.ErrDesignRevisionNotFound
	}

	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, organization_id, project_id, design_revision_id, kind,
		       storage_key, content_type, size_bytes, sha256,
		       COALESCE(uploaded_by::text, ''), created_at
		FROM design_revision_artifacts
		WHERE design_revision_id = $1
		ORDER BY kind ASC
	`, revisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	artifacts := make([]domain.DesignRevisionArtifact, 0)
	for rows.Next() {
		var a domain.DesignRevisionArtifact
		if err := rows.Scan(
			&a.ID, &a.OrganizationID, &a.ProjectID, &a.DesignRevisionID,
			&a.Kind, &a.StorageKey, &a.ContentType, &a.SizeBytes, &a.SHA256,
			&a.UploadedBy, &a.CreatedAt,
		); err != nil {
			return nil, err
		}
		artifacts = append(artifacts, a)
	}
	return artifacts, rows.Err()
}

// GetDesignRevisionArtifact resolves one artifact (kind) of one revision for
// the signed-read authorization path. Storage keys never leave the server.
func (s *PostgresStore) GetDesignRevisionArtifact(ctx context.Context, designID, revisionID string, kind domain.DesignPublishArtifactKind) (*domain.DesignRevisionArtifact, error) {
	if !isValidUUID(designID) || !isValidUUID(revisionID) || !domain.IsValidDesignPublishArtifactKind(kind) {
		return nil, domain.ErrDesignRevisionNotFound
	}
	row := s.db(ctx).QueryRow(ctx, `
		SELECT a.id, a.organization_id, a.project_id, a.design_revision_id, a.kind,
		       a.storage_key, a.content_type, a.size_bytes, a.sha256,
		       COALESCE(a.uploaded_by::text, ''), a.created_at
		FROM design_revision_artifacts a
		JOIN design_revisions r ON r.id = a.design_revision_id
		WHERE a.design_revision_id = $1 AND r.design_id = $2 AND a.kind = $3
	`, revisionID, designID, kind)
	artifact, err := scanDesignPublishArtifact(row)
	if err != nil {
		if errors.Is(err, domain.ErrPublishArtifactMissing) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}
	return artifact, nil
}
