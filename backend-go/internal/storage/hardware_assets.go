package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #667 / M1: persistence for versioned hardware 3D assets — staged upload
// sessions, immutable revisions, append-only validation evidence, the exact
// hardware visual binding and the DesignRevision publish pins. Bytes live on
// the filesystem under the organization media namespace (ADR-0004 layout);
// only metadata is relational. Upload/finalize byte verification itself runs
// in the API layer, which owns MediaDir.

// Commands (storage boundary of the M1 asset flow).
type CreateHardwareAssetUploadSessionCommand struct {
	Representation domain.HardwareAssetRepresentation
	DisplayName    string
	Provenance     string
	License        string
	Origin         json.RawMessage
	// TargetAssetID, when set, makes finalize append the next immutable
	// revision to this EXISTING active asset (replace-with-new-revision)
	// instead of creating a new asset. Validated at session start.
	TargetAssetID string
	ActorUserID   string
}

type HardwareAssetUploadSessionResult struct {
	Session *domain.HardwareAssetUploadSession
	// Staged files abandoned by the lazy expiry sweep; the caller removes
	// them best-effort (rows are already gone).
	AbandonedStagedKeys []string
}

type RecordHardwareAssetSessionBytesCommand struct {
	SessionID   string
	StorageKey  string
	ContentType string
	SizeBytes   int64
	SHA256      string
}

type FinalizeHardwareAssetUploadCommand struct {
	SessionID   string
	ActorUserID string
	IP          string
	RequestID   string
}

type CancelHardwareAssetUploadSessionCommand struct {
	SessionID   string
	ActorUserID string
}

type RetireHardwareAssetCommand struct {
	AssetID     string
	ActorUserID string
	IP          string
	RequestID   string
}

type RecordHardwareAssetValidationCommand struct {
	AssetID     string
	RevisionID  string
	SHA256      string
	Tool        string
	Result      string // "passed" | "failed"
	Details     json.RawMessage
	ActorUserID string
}

const hardwareAssetUploadSessionTTL = 24 * time.Hour

// hardwareAssetRevisionColumns is the canonical projection of a revision row.
// There is deliberately no validation_state column: host compatibility is
// derived from the append-only evidence rows so the revision stays truly
// immutable (spec §10 / §15).
const hardwareAssetRevisionColumns = `id, organization_id, asset_id, revision_number, representation,
	storage_key, content_type, size_bytes, sha256, origin, integrity_verified_at, created_by, created_at`

func scanHardwareAssetRevision(row pgx.Row) (*domain.HardwareAssetRevision, error) {
	var r domain.HardwareAssetRevision
	var originRaw []byte
	var createdBy *string
	if err := row.Scan(&r.ID, &r.OrganizationID, &r.AssetID, &r.RevisionNumber, &r.Representation,
		&r.StorageKey, &r.ContentType, &r.SizeBytes, &r.SHA256, &originRaw, &r.IntegrityVerifiedAt, &createdBy, &r.CreatedAt); err != nil {
		return nil, err
	}
	origin, err := domain.ValidateHardwareAssetOrigin(json.RawMessage(originRaw))
	if err != nil {
		return nil, err
	}
	r.Origin = origin
	if createdBy != nil {
		r.CreatedBy = *createdBy
	}
	return &r, nil
}

// CreateHardwareAssetUploadSession opens one staged upload. Prepared sessions
// left to expire are abandoned lazily here; their staged files are returned so
// the caller can remove them best-effort (rows are already gone).
func (s *PostgresStore) CreateHardwareAssetUploadSession(ctx context.Context, cmd CreateHardwareAssetUploadSessionCommand) (*HardwareAssetUploadSessionResult, error) {
	if !domain.IsValidHardwareAssetRepresentation(cmd.Representation) {
		return nil, fmt.Errorf("%w: representation", domain.ErrHardwareAssetInvalid)
	}
	displayName := strings.TrimSpace(cmd.DisplayName)
	if displayName == "" || len(displayName) > 255 {
		return nil, fmt.Errorf("%w: displayName is required (1-255 chars)", domain.ErrHardwareAssetInvalid)
	}
	origin, err := domain.ValidateHardwareAssetOrigin(json.RawMessage(cmd.Origin))
	if err != nil {
		return nil, err
	}

	if transactionFromContext(ctx) == nil {
		var result *HardwareAssetUploadSessionResult
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			res, err := s.CreateHardwareAssetUploadSession(txCtx, cmd)
			if err != nil {
				return err
			}
			result = res
			return nil
		})
		return result, err
	}

	abandoned, err := s.abandonExpiredHardwareAssetUploadSessions(ctx)
	if err != nil {
		return nil, err
	}

	var createdBy *string
	if isValidUUID(cmd.ActorUserID) {
		createdBy = &cmd.ActorUserID
	}
	var targetAssetID *string
	if cmd.TargetAssetID != "" {
		if !isValidUUID(cmd.TargetAssetID) {
			return nil, fmt.Errorf("%w: assetId must be a UUID", domain.ErrHardwareAssetInvalid)
		}
		target, err := s.getHardwareAssetRow(ctx, cmd.TargetAssetID)
		if err != nil {
			return nil, err
		}
		if target.Status != domain.HardwareAssetStatusActive {
			return nil, domain.ErrHardwareAssetRetired
		}
		targetAssetID = &cmd.TargetAssetID
	}
	var originArg interface{}
	if len(cmd.Origin) > 0 && string(cmd.Origin) != "null" {
		originArg = []byte(cmd.Origin)
	}
	session := &domain.HardwareAssetUploadSession{
		Representation: cmd.Representation,
		DisplayName:    displayName,
		Provenance:     cmd.Provenance,
		License:        cmd.License,
		Origin:         origin,
		Status:         "prepared",
	}
	err = s.db(ctx).QueryRow(ctx, `
		INSERT INTO hardware_asset_upload_sessions
			(organization_id, representation, display_name, provenance, license, origin, target_asset_id, status, created_by, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'prepared', $8, NOW() + $9::interval)
		RETURNING id, organization_id, created_at, expires_at
	`, OrgFromCtx(ctx), string(cmd.Representation), displayName, cmd.Provenance, cmd.License, originArg, targetAssetID, createdBy,
		fmt.Sprintf("%d seconds", int(hardwareAssetUploadSessionTTL.Seconds())),
	).Scan(&session.ID, &session.OrganizationID, &session.CreatedAt, &session.ExpiresAt)
	session.TargetAssetID = targetAssetID
	if err != nil {
		return nil, fmt.Errorf("create hardware asset upload session: %w", err)
	}
	return &HardwareAssetUploadSessionResult{Session: session, AbandonedStagedKeys: abandoned}, nil
}

// abandonExpiredHardwareAssetUploadSessions transitions expired prepared
// sessions to 'cancelled' and returns their staged storage keys (file removal
// is the caller's best-effort job; losing the race only leaves orphans for a
// clean-media pass — same strategy as design publish staging).
func (s *PostgresStore) abandonExpiredHardwareAssetUploadSessions(ctx context.Context) ([]string, error) {
	rows, err := s.db(ctx).Query(ctx, `
		UPDATE hardware_asset_upload_sessions
		SET status = 'cancelled', updated_at = NOW()
		WHERE status = 'prepared' AND expires_at < NOW()
		RETURNING staged_storage_key
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key *string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		if key != nil && *key != "" {
			keys = append(keys, *key)
		}
	}
	return keys, rows.Err()
}

func (s *PostgresStore) GetHardwareAssetUploadSession(ctx context.Context, sessionID string) (*domain.HardwareAssetUploadSession, error) {
	if !isValidUUID(sessionID) {
		return nil, domain.ErrHardwareAssetSessionNotFound
	}
	row := s.db(ctx).QueryRow(ctx, `
		SELECT id, organization_id, representation, display_name, provenance, license, origin,
		       staged_storage_key, staged_content_type, staged_size_bytes, staged_sha256,
		       target_asset_id, status, created_by, created_at, expires_at, finalized_asset_id, finalized_revision_id
		FROM hardware_asset_upload_sessions
		WHERE id = $1
	`, sessionID)
	return scanHardwareAssetUploadSession(row)
}

func scanHardwareAssetUploadSession(row pgx.Row) (*domain.HardwareAssetUploadSession, error) {
	var sess domain.HardwareAssetUploadSession
	var originRaw []byte
	var stagedKey, stagedCT, stagedSHA *string
	var stagedSize *int64
	var createdBy *string
	err := row.Scan(&sess.ID, &sess.OrganizationID, &sess.Representation, &sess.DisplayName,
		&sess.Provenance, &sess.License, &originRaw,
		&stagedKey, &stagedCT, &stagedSize, &stagedSHA,
		&sess.TargetAssetID, &sess.Status, &createdBy, &sess.CreatedAt, &sess.ExpiresAt,
		&sess.FinalizedAssetID, &sess.FinalizedRevisionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrHardwareAssetSessionNotFound
		}
		return nil, err
	}
	if len(originRaw) > 0 && string(originRaw) != "null" {
		origin, err := domain.ValidateHardwareAssetOrigin(json.RawMessage(originRaw))
		if err != nil {
			return nil, err
		}
		sess.Origin = origin
	}
	if stagedKey != nil && stagedCT != nil && stagedSize != nil && stagedSHA != nil {
		sess.Staged = &domain.HardwareAssetStagedBytes{
			StorageKey:  *stagedKey,
			ContentType: *stagedCT,
			SizeBytes:   *stagedSize,
			SHA256:      *stagedSHA,
		}
	}
	if createdBy != nil {
		sess.CreatedBy = *createdBy
	}
	return &sess, nil
}

// RecordHardwareAssetSessionBytes replaces the staged bytes metadata of a
// prepared session (re-upload semantics, retry-safe by upsert). The file
// itself was already written by the API layer; the row is the metadata truth.
func (s *PostgresStore) RecordHardwareAssetSessionBytes(ctx context.Context, cmd RecordHardwareAssetSessionBytesCommand) error {
	if !isValidUUID(cmd.SessionID) {
		return domain.ErrHardwareAssetSessionNotFound
	}
	tag, err := s.db(ctx).Exec(ctx, `
		UPDATE hardware_asset_upload_sessions
		SET staged_storage_key = $2, staged_content_type = $3, staged_size_bytes = $4, staged_sha256 = $5, updated_at = NOW()
		WHERE id = $1 AND status = 'prepared' AND expires_at > NOW()
	`, cmd.SessionID, cmd.StorageKey, cmd.ContentType, cmd.SizeBytes, cmd.SHA256)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Distinguish a missing session from one that can no longer accept
		// bytes so the API can answer precisely.
		sess, err := s.GetHardwareAssetUploadSession(ctx, cmd.SessionID)
		if err != nil {
			return err
		}
		return fmt.Errorf("%w: status %s", domain.ErrHardwareAssetSessionNotPrepared, sess.Status)
	}
	return nil
}

// FinalizeHardwareAssetUpload is the ONLY writer of hardware_assets and
// hardware_asset_revisions rows. Inside one tenant transaction it re-checks
// the session, creates the active asset + immutable revision #1 and marks the
// session finalized. A replayed finalize returns the SAME asset (never a
// second one). Byte verification (size+digest on disk) already happened in
// the API layer; integrity_verified_at records that server-side observation.
func (s *PostgresStore) FinalizeHardwareAssetUpload(ctx context.Context, cmd FinalizeHardwareAssetUploadCommand) (*domain.HardwareAsset, error) {
	if !isValidUUID(cmd.SessionID) {
		return nil, domain.ErrHardwareAssetSessionNotFound
	}

	if transactionFromContext(ctx) == nil {
		var asset *domain.HardwareAsset
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			a, err := s.FinalizeHardwareAssetUpload(txCtx, cmd)
			if err != nil {
				return err
			}
			asset = a
			return nil
		})
		return asset, err
	}

	// Serialize concurrent finalizes of the same session.
	row := s.db(ctx).QueryRow(ctx, `
		SELECT id, organization_id, representation, display_name, provenance, license, origin,
		       staged_storage_key, staged_content_type, staged_size_bytes, staged_sha256,
		       target_asset_id, status, created_by, created_at, expires_at, finalized_asset_id, finalized_revision_id
		FROM hardware_asset_upload_sessions
		WHERE id = $1
		FOR UPDATE
	`, cmd.SessionID)
	sess, err := scanHardwareAssetUploadSession(row)
	if err != nil {
		return nil, err
	}
	if sess.Status == "finalized" {
		// Idempotent replay: the exact same session finalizes to the exact
		// same asset, never a duplicate.
		if sess.FinalizedAssetID == nil {
			return nil, fmt.Errorf("%w: finalized session %s has no asset", domain.ErrHardwareAssetSessionNotPrepared, sess.ID)
		}
		return s.GetHardwareAsset(ctx, *sess.FinalizedAssetID)
	}
	if sess.Status != "prepared" {
		return nil, fmt.Errorf("%w: session status is %s", domain.ErrHardwareAssetSessionNotPrepared, sess.Status)
	}
	if !time.Now().Before(sess.ExpiresAt) {
		_, _ = s.db(ctx).Exec(ctx, `UPDATE hardware_asset_upload_sessions SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, sess.ID)
		return nil, fmt.Errorf("%w: session expired at %s", domain.ErrHardwareAssetSessionNotPrepared, sess.ExpiresAt.Format(time.RFC3339))
	}
	if sess.Staged == nil {
		return nil, fmt.Errorf("%w: no bytes were uploaded", domain.ErrHardwareAssetBytesMissing)
	}
	// Storage-frontier coherence (#667 R3): the staged content type must
	// belong to the session's representation. The API layer enforces this at
	// upload time; this guard makes the finalize itself refuse any
	// representation/metadata mismatch that reached the row by another path.
	if !hardwareAssetContentTypeMatchesRepresentation(sess.Representation, sess.Staged.ContentType) {
		return nil, fmt.Errorf("%w: el contenido almacenado (%s) no corresponde a la representación %s",
			domain.ErrHardwareAssetInvalid, sess.Staged.ContentType, sess.Representation)
	}

	var createdBy *string
	if isValidUUID(cmd.ActorUserID) {
		createdBy = &cmd.ActorUserID
	}

	var existing *domain.HardwareAsset
	if sess.TargetAssetID != nil && *sess.TargetAssetID != "" {
		// Replace-with-new-revision: the target asset must still exist and be
		// active. FOR UPDATE serializes every append (and the concurrent
		// retire) on the asset row, so two sessions can never compute the
		// same next revision number (#667 R5).
		a, err := s.lockHardwareAssetRow(ctx, *sess.TargetAssetID)
		if err != nil {
			return nil, err
		}
		if a.Status != domain.HardwareAssetStatusActive {
			return nil, domain.ErrHardwareAssetRetired
		}
		existing = a
	}

	asset := &domain.HardwareAsset{
		DisplayName: sess.DisplayName,
		Provenance:  sess.Provenance,
		License:     sess.License,
		Status:      domain.HardwareAssetStatusActive,
	}
	var originArg interface{}
	if sess.Origin != nil {
		raw, err := json.Marshal(sess.Origin)
		if err != nil {
			return nil, fmt.Errorf("%w: origin re-marshal: %v", domain.ErrSerializationFailed, err)
		}
		originArg = raw
	}
	if existing != nil {
		asset = existing
		asset.Revisions = nil
	} else {
		err = s.db(ctx).QueryRow(ctx, `
			INSERT INTO hardware_assets (display_name, provenance, license, status, created_by, organization_id)
			VALUES ($1, $2, $3, 'active', $4, $5)
			RETURNING id, created_at, updated_at
		`, asset.DisplayName, asset.Provenance, asset.License, createdBy, sess.OrganizationID,
		).Scan(&asset.ID, &asset.CreatedAt, &asset.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("insert hardware asset: %w", err)
		}
	}

	nextRevision := 1
	if existing != nil {
		if err := s.db(ctx).QueryRow(ctx, `
			SELECT COALESCE(MAX(revision_number), 0) + 1
			FROM hardware_asset_revisions WHERE asset_id = $1
		`, asset.ID).Scan(&nextRevision); err != nil {
			return nil, err
		}
	}
	revision := &domain.HardwareAssetRevision{
		AssetID:        asset.ID,
		RevisionNumber: nextRevision,
		Representation: sess.Representation,
		StorageKey:     sess.Staged.StorageKey,
		ContentType:    sess.Staged.ContentType,
		SizeBytes:      sess.Staged.SizeBytes,
		SHA256:         sess.Staged.SHA256,
		Origin:         sess.Origin,
	}
	var revisionCreatedBy *string
	var originRaw []byte
	err = s.db(ctx).QueryRow(ctx, `
		INSERT INTO hardware_asset_revisions
			(organization_id, asset_id, revision_number, representation, storage_key,
			 content_type, size_bytes, sha256, origin, integrity_verified_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
		RETURNING `+hardwareAssetRevisionColumns,
		sess.OrganizationID, asset.ID, revision.RevisionNumber, string(revision.Representation), revision.StorageKey,
		revision.ContentType, revision.SizeBytes, revision.SHA256, originArg, createdBy,
	).Scan(
		&revision.ID, &revision.OrganizationID, &revision.AssetID, &revision.RevisionNumber,
		&revision.Representation, &revision.StorageKey, &revision.ContentType, &revision.SizeBytes,
		&revision.SHA256, &originRaw, &revision.IntegrityVerifiedAt, &revisionCreatedBy, &revision.CreatedAt,
	)
	if err != nil {
		if isUniqueViolationOn(err, "uq_hardware_asset_revisions_number") {
			// Belt and braces for the FOR UPDATE serialization: a same-asset
			// numbering collision is a typed conflict with a safe retry,
			// never a raw constraint failure.
			return nil, domain.ErrHardwareAssetRevisionConflict
		}
		return nil, fmt.Errorf("insert hardware asset revision: %w", err)
	}
	if revisionCreatedBy != nil {
		revision.CreatedBy = *revisionCreatedBy
	}
	// A brand-new revision has no evidence yet: pending until an authorized
	// validator records it (never a client-declared state).
	revision.ValidationState = domain.HardwareAssetValidationPending
	asset.Revisions = []domain.HardwareAssetRevision{*revision}

	if _, err := s.db(ctx).Exec(ctx, `
		UPDATE hardware_asset_upload_sessions
		SET status = 'finalized', finalized_asset_id = $2, finalized_revision_id = $3, updated_at = NOW()
		WHERE id = $1
	`, sess.ID, asset.ID, revision.ID); err != nil {
		return nil, fmt.Errorf("finalize hardware asset upload session: %w", err)
	}

	// Read back the asset with ALL its revisions and derived validation
	// states (the new-revision path must return the full version history).
	asset, err = s.GetHardwareAsset(ctx, asset.ID)
	if err != nil {
		return nil, err
	}

	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "hardware_asset_finalized",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: sess.OrganizationID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"asset_id":       asset.ID,
			"revision_id":    revision.ID,
			"representation": string(revision.Representation),
			"sha256":         revision.SHA256,
			"size_bytes":     revision.SizeBytes,
			"session_id":     sess.ID,
		},
	}); err != nil {
		return nil, fmt.Errorf("audit hardware_asset_finalized: %w", err)
	}
	return asset, nil
}

// CancelHardwareAssetUploadSession abandons a prepared session. A previously
// associated hardware binding is untouched by definition: sessions never
// mutate the catalog (spec §6).
func (s *PostgresStore) CancelHardwareAssetUploadSession(ctx context.Context, cmd CancelHardwareAssetUploadSessionCommand) error {
	if !isValidUUID(cmd.SessionID) {
		return domain.ErrHardwareAssetSessionNotFound
	}
	tag, err := s.db(ctx).Exec(ctx, `
		UPDATE hardware_asset_upload_sessions
		SET status = 'cancelled', updated_at = NOW()
		WHERE id = $1 AND status = 'prepared'
	`, cmd.SessionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		sess, err := s.GetHardwareAssetUploadSession(ctx, cmd.SessionID)
		if err != nil {
			return err
		}
		return fmt.Errorf("%w: status %s", domain.ErrHardwareAssetSessionNotPrepared, sess.Status)
	}
	return nil
}

// --- Asset reads -------------------------------------------------------------

func (s *PostgresStore) ListHardwareAssets(ctx context.Context) ([]domain.HardwareAsset, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, organization_id, display_name, provenance, license, status, created_by, created_at, updated_at
		FROM hardware_assets
		WHERE organization_id = $1
		ORDER BY display_name ASC, id ASC
	`, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	assets := []domain.HardwareAsset{}
	// Index by POSITION in the slice (not pointers to copies): revisions and
	// derived states must land in the elements the caller receives.
	indexByID := map[string]int{}
	for rows.Next() {
		var a domain.HardwareAsset
		var createdBy *string
		if err := rows.Scan(&a.ID, &a.OrganizationID, &a.DisplayName, &a.Provenance, &a.License, &a.Status, &createdBy, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		if createdBy != nil {
			a.CreatedBy = *createdBy
		}
		a.Revisions = []domain.HardwareAssetRevision{}
		indexByID[a.ID] = len(assets)
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(assets) == 0 {
		return assets, nil
	}

	ids := make([]string, 0, len(assets))
	for _, a := range assets {
		ids = append(ids, a.ID)
	}
	revRows, err := s.db(ctx).Query(ctx, `
		SELECT `+hardwareAssetRevisionColumns+`
		FROM hardware_asset_revisions
		WHERE organization_id = $1 AND asset_id = ANY($2::uuid[])
		ORDER BY asset_id, revision_number ASC
	`, OrgFromCtx(ctx), ids)
	if err != nil {
		return nil, err
	}
	defer revRows.Close()
	revisionIDs := []string{}
	for revRows.Next() {
		rev, err := scanHardwareAssetRevision(revRows)
		if err != nil {
			return nil, err
		}
		if idx, ok := indexByID[rev.AssetID]; ok {
			assets[idx].Revisions = append(assets[idx].Revisions, *rev)
			revisionIDs = append(revisionIDs, rev.ID)
		}
	}
	if err := revRows.Err(); err != nil {
		return nil, err
	}

	states, err := s.hardwareAssetValidationStates(ctx, revisionIDs)
	if err != nil {
		return nil, err
	}
	for i := range assets {
		for j := range assets[i].Revisions {
			assets[i].Revisions[j].ValidationState = states[assets[i].Revisions[j].ID]
		}
	}
	return assets, nil
}

func (s *PostgresStore) GetHardwareAsset(ctx context.Context, assetID string) (*domain.HardwareAsset, error) {
	if !isValidUUID(assetID) {
		return nil, domain.ErrHardwareAssetNotFound
	}
	assets, err := s.ListHardwareAssetsFiltered(ctx, assetID)
	if err != nil {
		return nil, err
	}
	if len(assets) == 0 {
		return nil, domain.ErrHardwareAssetNotFound
	}
	return &assets[0], nil
}

// ListHardwareAssetsFiltered lists exactly one asset by ID within the tenant
// scope (shared query shape with ListHardwareAssets so revisions/validation
// derivation never diverges between list and detail).
func (s *PostgresStore) ListHardwareAssetsFiltered(ctx context.Context, assetID string) ([]domain.HardwareAsset, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, organization_id, display_name, provenance, license, status, created_by, created_at, updated_at
		FROM hardware_assets
		WHERE organization_id = $1 AND id = $2
	`, OrgFromCtx(ctx), assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var assets []domain.HardwareAsset
	for rows.Next() {
		var a domain.HardwareAsset
		var createdBy *string
		if err := rows.Scan(&a.ID, &a.OrganizationID, &a.DisplayName, &a.Provenance, &a.License, &a.Status, &createdBy, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		if createdBy != nil {
			a.CreatedBy = *createdBy
		}
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(assets) == 0 {
		return nil, nil
	}
	revRows, err := s.db(ctx).Query(ctx, `
		SELECT `+hardwareAssetRevisionColumns+`
		FROM hardware_asset_revisions
		WHERE organization_id = $1 AND asset_id = $2
		ORDER BY revision_number ASC
	`, OrgFromCtx(ctx), assetID)
	if err != nil {
		return nil, err
	}
	defer revRows.Close()
	revisionIDs := []string{}
	for revRows.Next() {
		rev, err := scanHardwareAssetRevision(revRows)
		if err != nil {
			return nil, err
		}
		assets[0].Revisions = append(assets[0].Revisions, *rev)
		revisionIDs = append(revisionIDs, rev.ID)
	}
	if err := revRows.Err(); err != nil {
		return nil, err
	}
	if assets[0].Revisions == nil {
		assets[0].Revisions = []domain.HardwareAssetRevision{}
	}
	states, err := s.hardwareAssetValidationStates(ctx, revisionIDs)
	if err != nil {
		return nil, err
	}
	for j := range assets[0].Revisions {
		assets[0].Revisions[j].ValidationState = states[assets[0].Revisions[j].ID]
	}
	return assets, nil
}

func (s *PostgresStore) GetHardwareAssetRevision(ctx context.Context, assetID, revisionID string) (*domain.HardwareAssetRevision, error) {
	if !isValidUUID(assetID) || !isValidUUID(revisionID) {
		return nil, domain.ErrHardwareAssetRevisionNotFound
	}
	rev, err := scanHardwareAssetRevision(s.db(ctx).QueryRow(ctx, `
		SELECT `+hardwareAssetRevisionColumns+`
		FROM hardware_asset_revisions
		WHERE organization_id = $1 AND id = $2 AND asset_id = $3
	`, OrgFromCtx(ctx), revisionID, assetID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrHardwareAssetRevisionNotFound
		}
		return nil, err
	}
	states, err := s.hardwareAssetValidationStates(ctx, []string{rev.ID})
	if err != nil {
		return nil, err
	}
	rev.ValidationState = states[rev.ID]
	return rev, nil
}

// RetireHardwareAsset withdraws the asset from NEW selections. Existing
// hardware bindings and published DesignRevision pins are never rewritten
// (spec §6/§15); a retired asset only fails new binding attempts.
func (s *PostgresStore) RetireHardwareAsset(ctx context.Context, cmd RetireHardwareAssetCommand) error {
	if !isValidUUID(cmd.AssetID) {
		return domain.ErrHardwareAssetNotFound
	}
	if transactionFromContext(ctx) == nil {
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		return s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			return s.RetireHardwareAsset(txCtx, cmd)
		})
	}
	tag, err := s.db(ctx).Exec(ctx, `
		UPDATE hardware_assets SET status = 'retired', updated_at = NOW()
		WHERE id = $1 AND organization_id = $2 AND status = 'active'
	`, cmd.AssetID, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		asset, err := s.getHardwareAssetRow(ctx, cmd.AssetID)
		if err != nil {
			return err
		}
		if asset.Status == domain.HardwareAssetStatusRetired {
			return nil // idempotent retire
		}
		return domain.ErrHardwareAssetNotFound
	}
	return s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "hardware_asset_retired",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: OrgFromCtx(ctx),
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details:        map[string]interface{}{"asset_id": cmd.AssetID},
	})
}

func (s *PostgresStore) getHardwareAssetRow(ctx context.Context, assetID string) (*domain.HardwareAsset, error) {
	var a domain.HardwareAsset
	var createdBy *string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT id, organization_id, display_name, provenance, license, status, created_by, created_at, updated_at
		FROM hardware_assets WHERE id = $1 AND organization_id = $2
	`, assetID, OrgFromCtx(ctx)).Scan(&a.ID, &a.OrganizationID, &a.DisplayName, &a.Provenance, &a.License, &a.Status, &createdBy, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrHardwareAssetNotFound
		}
		return nil, err
	}
	if createdBy != nil {
		a.CreatedBy = *createdBy
	}
	return &a, nil
}

// ResolveHardwareVisualAssetBinding resolves and validates an exact binding
// BEFORE the hardware write path persists it: the revision must exist in this
// organization, belong to the named asset, and the asset must still be active
// (a retired asset is refused for NEW selections). Representation and digest
// are returned from the referenced rows — never from client echo. Thumbnails
// cannot carry a hardware model binding.
func (s *PostgresStore) ResolveHardwareVisualAssetBinding(ctx context.Context, assetID, revisionID string) (*domain.HardwareVisualAssetBinding, error) {
	if !isValidUUID(assetID) || !isValidUUID(revisionID) {
		return nil, fmt.Errorf("%w: asset/revision identifiers required", domain.ErrHardwareAssetBindingInvalid)
	}
	var (
		assetStatus    string
		representation string
		sha256         string
		evidence       *string
	)
	err := s.db(ctx).QueryRow(ctx, `
		SELECT a.status, r.representation, r.sha256,
		       (SELECT v.result FROM hardware_asset_validations v
		        WHERE v.revision_id = r.id ORDER BY v.created_at DESC, v.id DESC LIMIT 1)
		FROM hardware_assets a
		JOIN hardware_asset_revisions r ON r.asset_id = a.id AND r.id = $2
		WHERE a.id = $1 AND a.organization_id = $3
	`, assetID, revisionID, OrgFromCtx(ctx)).Scan(&assetStatus, &representation, &sha256, &evidence)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Neutral: an unknown revision and a foreign one are
			// indistinguishable to the caller (no existence oracle).
			return nil, fmt.Errorf("%w: revisión de recurso no disponible", domain.ErrHardwareAssetBindingInvalid)
		}
		return nil, err
	}
	if assetStatus == string(domain.HardwareAssetStatusRetired) {
		return nil, domain.ErrHardwareAssetRetired
	}
	rep := domain.HardwareAssetRepresentation(representation)
	if rep == domain.HardwareAssetRepresentationThumbnail {
		return nil, fmt.Errorf("%w: una miniatura no puede ser el modelo del herraje", domain.ErrHardwareAssetBindingInvalid)
	}
	binding := &domain.HardwareVisualAssetBinding{
		AssetID:         assetID,
		AssetRevisionID: revisionID,
		Representation:  rep,
		SHA256:          sha256,
	}
	switch {
	case evidence == nil:
		binding.ValidationState = domain.HardwareAssetValidationPending
	case *evidence == "passed":
		binding.ValidationState = domain.HardwareAssetValidationValidated
	default:
		binding.ValidationState = domain.HardwareAssetValidationFailed
	}
	return binding, nil
}

// hardwareAssetValidationStates derives the authoritative validation state of
// each revision from its latest evidence row (no evidence = pending). The
// revision rows themselves are immutable.
func (s *PostgresStore) hardwareAssetValidationStates(ctx context.Context, revisionIDs []string) (map[string]domain.HardwareAssetValidationState, error) {
	states := map[string]domain.HardwareAssetValidationState{}
	if len(revisionIDs) == 0 {
		return states, nil
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT DISTINCT ON (revision_id) revision_id, result
		FROM hardware_asset_validations
		WHERE organization_id = $1 AND revision_id = ANY($2::uuid[])
		ORDER BY revision_id, created_at DESC, id DESC
	`, OrgFromCtx(ctx), revisionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var revisionID, result string
		if err := rows.Scan(&revisionID, &result); err != nil {
			return nil, err
		}
		switch result {
		case "passed":
			states[revisionID] = domain.HardwareAssetValidationValidated
		default:
			states[revisionID] = domain.HardwareAssetValidationFailed
		}
	}
	for _, id := range revisionIDs {
		if _, ok := states[id]; !ok {
			states[id] = domain.HardwareAssetValidationPending
		}
	}
	return states, rows.Err()
}

// RecordHardwareAssetValidation appends one authorized evidence record bound
// to the exact revision AND digest. The digest must match the stored bytes —
// evidence can never be attached to different content. In M1 this writer is
// exercised only by tests with explicitly simulated validators; the real
// producer is the #668 SketchUp host validator.
func (s *PostgresStore) RecordHardwareAssetValidation(ctx context.Context, cmd RecordHardwareAssetValidationCommand) error {
	if cmd.Tool == "" || (cmd.Result != "passed" && cmd.Result != "failed") {
		return fmt.Errorf("%w: tool and result are required", domain.ErrHardwareAssetInvalid)
	}
	if transactionFromContext(ctx) == nil {
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		return s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			return s.RecordHardwareAssetValidation(txCtx, cmd)
		})
	}
	rev, err := s.GetHardwareAssetRevision(ctx, cmd.AssetID, cmd.RevisionID)
	if err != nil {
		return err
	}
	if rev.SHA256 != cmd.SHA256 {
		return fmt.Errorf("%w: la evidencia no corresponde al digest almacenado", domain.ErrHardwareAssetBindingInvalid)
	}
	var createdBy *string
	if isValidUUID(cmd.ActorUserID) {
		createdBy = &cmd.ActorUserID
	}
	var detailsArg interface{}
	if len(cmd.Details) > 0 {
		detailsArg = []byte(cmd.Details)
	}
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO hardware_asset_validations (organization_id, asset_id, revision_id, sha256, tool, result, details, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, '{}'::jsonb), $8)
	`, OrgFromCtx(ctx), cmd.AssetID, cmd.RevisionID, cmd.SHA256, cmd.Tool, cmd.Result, detailsArg, createdBy)
	return err
}

// --- DesignRevision publish pins ---------------------------------------------

// freezeDesignRevisionHardwareAssets pins, inside the publish transaction,
// the exact hardware→asset-revision references of every furniture item being
// published (#667 M1, R4 correction).
//
// The reference set comes from the item's SEMANTIC composition — structure
// components' placement overrides, module components' overrides, agregado
// instances' components and hardware lines, and the module's own hardware
// lines — NOT from layout.Hardware, which the engine filters to
// preview-drawable placeholders (a hardware bound to a real SKP with no
// previewShape would silently lose its pin).
//
// Failure contract (never silent disappearance):
//   - item without FurnitureDefinitionID, or a definition that no longer
//     exists → legitimate absence (the #639 unavailable-legacy precedent);
//   - a definition whose composition cannot be resolved (referenced
//     structure or agregado missing) → the publish FAILS with a typed error;
//   - parameters do not gate membership in the M1 contract (no
//     parameter-conditional bindings exist), so the walk freezes the
//     definition's full reference set — a conservative superset: over-pinning
//     keeps history, under-pinning loses it.
//
// The pin INSERT is a single statement joining hardwares with their bound
// revision: representation and digest always come from the same read as the
// revision id, so a concurrent rebind can never produce a mixed pin.
func (s *PostgresStore) freezeDesignRevisionHardwareAssets(ctx context.Context, designOrgID, projectID, designRevisionID string, items []PublishDesignRevisionItemCommand) (int, error) {
	hardwareIDs := map[string]struct{}{}
	modules := map[string]*domain.Module{}
	var catalog *domain.Catalog

	for _, item := range items {
		if !isValidUUID(item.FurnitureDefinitionID) {
			continue
		}
		if _, cached := modules[item.FurnitureDefinitionID]; cached {
			continue
		}
		m, err := s.GetModuleByID(ctx, item.FurnitureDefinitionID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Historical/legacy definition: explicit absence, no invented
				// pins (same precedent as the presentation snapshot).
				modules[item.FurnitureDefinitionID] = nil
				continue
			}
			return 0, err
		}
		modules[item.FurnitureDefinitionID] = m
	}

	for _, module := range modules {
		if module == nil {
			continue
		}
		if catalog == nil {
			cat, err := s.publishResolutionCatalog(ctx)
			if err != nil {
				return 0, err
			}
			catalog = &cat
		}
		ids, err := compositionHardwareIDs(*module, *catalog)
		if err != nil {
			return 0, err
		}
		for id := range ids {
			hardwareIDs[id] = struct{}{}
		}
	}
	if len(hardwareIDs) == 0 {
		return 0, nil
	}

	ids := make([]string, 0, len(hardwareIDs))
	for id := range hardwareIDs {
		ids = append(ids, id)
	}
	// One atomic statement: the revision id, representation and digest of
	// each pin come from the SAME read of hardwares × hardware_asset_revisions.
	pinned, err := s.db(ctx).Query(ctx, `
		WITH inserted AS (
			INSERT INTO design_revision_hardware_assets
				(organization_id, project_id, design_revision_id, hardware_id, asset_id, asset_revision_id, representation, sha256)
			SELECT $1, $2, $3, h.id, r.asset_id, r.id, r.representation, r.sha256
			FROM hardwares h
			JOIN hardware_asset_revisions r
			  ON r.id = h.visual_asset_revision_id AND r.asset_id = h.visual_asset_id
			WHERE h.organization_id = $1 AND h.visual_asset_id IS NOT NULL AND h.id = ANY($4::uuid[])
			RETURNING 1
		)
		SELECT count(*) FROM inserted
	`, designOrgID, projectID, designRevisionID, ids)
	if err != nil {
		return 0, err
	}
	defer pinned.Close()
	var count int
	if pinned.Next() {
		if err := pinned.Scan(&count); err != nil {
			return 0, err
		}
	}
	return count, pinned.Err()
}

// compositionHardwareIDs walks one module's SEMANTIC composition and returns
// every hardware id it references: placement overrides on structure and
// module component instances, agregado instances' component placements and
// hardware lines, and the module's own hardware lines. A referenced
// structure or agregado that cannot be found is a resolution error — the
// caller fails the publish instead of silently dropping references.
func compositionHardwareIDs(module domain.Module, catalog domain.Catalog) (map[string]struct{}, error) {
	out := map[string]struct{}{}
	addPlacement := func(hardwareID string) {
		if strings.TrimSpace(hardwareID) != "" {
			out[hardwareID] = struct{}{}
		}
	}
	addInstances := func(instances []domain.ComponentInstance) {
		for _, ci := range instances {
			if ci.Overrides == nil {
				continue
			}
			for _, hp := range ci.Overrides.HardwarePlacements {
				addPlacement(hp.HardwareID)
			}
		}
	}
	addAgregadoInstances := func(instances []domain.ModuleAgregadoInstance) error {
		for _, ai := range instances {
			agregado, ok := findCatalogAgregado(catalog, ai.AgregadoID)
			if !ok {
				return fmt.Errorf("%w: el módulo %s referencia el agregado %s y no existe en el catálogo",
					domain.ErrCompositionUnresolvable, module.Code, ai.AgregadoID)
			}
			addInstances(agregado.Components)
			for _, hl := range agregado.HardwareLines {
				addPlacement(hl.HardwareID)
			}
		}
		return nil
	}

	if strings.TrimSpace(module.StructureID) != "" {
		structure, ok := findCatalogStructure(catalog, module.StructureID)
		if !ok {
			return nil, fmt.Errorf("%w: el módulo %s referencia la estructura %s y no existe en el catálogo",
				domain.ErrCompositionUnresolvable, module.Code, module.StructureID)
		}
		addInstances(structure.Components)
		if err := addAgregadoInstances(structure.Agregados); err != nil {
			return nil, err
		}
	}
	addInstances(module.Components)
	if err := addAgregadoInstances(module.Agregados); err != nil {
		return nil, err
	}
	for _, hl := range module.HardwareLines {
		addPlacement(hl.HardwareID)
	}
	return out, nil
}

func findCatalogStructure(catalog domain.Catalog, structureID string) (domain.Structure, bool) {
	for _, st := range catalog.Structures {
		if st.ID == structureID {
			return st, true
		}
	}
	return domain.Structure{}, false
}

func findCatalogAgregado(catalog domain.Catalog, agregadoID string) (domain.Agregado, bool) {
	for _, ag := range catalog.Agregados {
		if ag.ID == agregadoID {
			return ag, true
		}
	}
	return domain.Agregado{}, false
}

// publishResolutionCatalog loads the composition the authoritative resolver
// consumes (same shape as the furniture layout endpoint).
func (s *PostgresStore) publishResolutionCatalog(ctx context.Context) (domain.Catalog, error) {
	var cat domain.Catalog
	structures, err := s.ListStructures(ctx)
	if err != nil {
		return cat, err
	}
	cat.Structures = structures
	components, err := s.ListComponents(ctx)
	if err != nil {
		return cat, err
	}
	cat.Components = components
	agregados, err := s.ListAgregados(ctx)
	if err != nil {
		return cat, err
	}
	cat.Agregados = agregados
	hardware, err := s.ListHardwares(ctx)
	if err != nil {
		return cat, err
	}
	cat.Hardware = hardware
	materials, err := s.ListMaterialBoards(ctx)
	if err != nil {
		return cat, err
	}
	cat.Materials = materials
	return cat, nil
}


// ListDesignRevisionHardwareAssets reads the frozen pins of one revision
// (readback for consumers and tests).
func (s *PostgresStore) ListDesignRevisionHardwareAssets(ctx context.Context, designRevisionID string) ([]domain.DesignRevisionHardwareAssetPin, error) {
	if !isValidUUID(designRevisionID) {
		return nil, domain.ErrDesignRevisionNotFound
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, hardware_id, asset_id, asset_revision_id, representation, sha256, created_at
		FROM design_revision_hardware_assets
		WHERE organization_id = $1 AND design_revision_id = $2
		ORDER BY hardware_id ASC
	`, OrgFromCtx(ctx), designRevisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pins []domain.DesignRevisionHardwareAssetPin
	for rows.Next() {
		var p domain.DesignRevisionHardwareAssetPin
		if err := rows.Scan(&p.ID, &p.HardwareID, &p.AssetID, &p.AssetRevisionID, &p.Representation, &p.SHA256, &p.CreatedAt); err != nil {
			return nil, err
		}
		pins = append(pins, p)
	}
	return pins, rows.Err()
}

// attachHardwareVisualBindings resolves the exact binding details
// (representation, digest, derived validation state) for hardware rows that
// reference a revision. The identifiers live on the hardwares row; the
// resolved facts come from the referenced rows — never from client echo.
func (s *PostgresStore) attachHardwareVisualBindings(ctx context.Context, items []domain.Hardware) error {
	revisionIDs := make([]string, 0, len(items))
	for _, h := range items {
		if h.VisualAsset != nil && h.VisualAsset.AssetRevisionID != "" {
			revisionIDs = append(revisionIDs, h.VisualAsset.AssetRevisionID)
		}
	}
	if len(revisionIDs) == 0 {
		return nil
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT r.id, r.representation, r.sha256
		FROM hardware_asset_revisions r
		WHERE r.organization_id = $1 AND r.id = ANY($2::uuid[])
	`, OrgFromCtx(ctx), revisionIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	details := map[string]struct {
		Representation domain.HardwareAssetRepresentation
		SHA256         string
	}{}
	for rows.Next() {
		var revisionID, representation, sha256 string
		if err := rows.Scan(&revisionID, &representation, &sha256); err != nil {
			return err
		}
		details[revisionID] = struct {
			Representation domain.HardwareAssetRepresentation
			SHA256         string
		}{domain.HardwareAssetRepresentation(representation), sha256}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	states, err := s.hardwareAssetValidationStates(ctx, revisionIDs)
	if err != nil {
		return err
	}
	for i := range items {
		binding := items[i].VisualAsset
		if binding == nil {
			continue
		}
		d, ok := details[binding.AssetRevisionID]
		if !ok {
			// Referenced revision unreadable in this org: keep identifiers,
			// expose no fabricated facts (fail-honest read).
			binding.Representation = ""
			binding.SHA256 = ""
			binding.ValidationState = ""
			continue
		}
		binding.Representation = d.Representation
		binding.SHA256 = d.SHA256
		binding.ValidationState = states[binding.AssetRevisionID]
	}
	return nil
}

// hardwareAssetContentTypeMatchesRepresentation is the storage-frontier
// coherence table (#667 R3): which staged content types may finalize under
// each representation.
func hardwareAssetContentTypeMatchesRepresentation(rep domain.HardwareAssetRepresentation, contentType string) bool {
	switch rep {
	case domain.HardwareAssetRepresentationSKP:
		return contentType == "application/octet-stream"
	case domain.HardwareAssetRepresentationGLB:
		return contentType == "model/gltf-binary"
	case domain.HardwareAssetRepresentationThumbnail:
		return contentType == "image/png" || contentType == "image/jpeg" || contentType == "image/webp"
	default:
		return false
	}
}

// lockHardwareAssetRow reads one asset row FOR UPDATE: every append of a new
// revision (and the retire transition) serializes on it (#667 R5).
func (s *PostgresStore) lockHardwareAssetRow(ctx context.Context, assetID string) (*domain.HardwareAsset, error) {
	var a domain.HardwareAsset
	var createdBy *string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT id, organization_id, display_name, provenance, license, status, created_by, created_at, updated_at
		FROM hardware_assets WHERE id = $1 AND organization_id = $2
		FOR UPDATE
	`, assetID, OrgFromCtx(ctx)).Scan(&a.ID, &a.OrganizationID, &a.DisplayName, &a.Provenance, &a.License, &a.Status, &createdBy, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrHardwareAssetNotFound
		}
		return nil, err
	}
	if createdBy != nil {
		a.CreatedBy = *createdBy
	}
	return &a, nil
}

// isUniqueViolationOn reports whether err is a 23505 on the given constraint.
func isUniqueViolationOn(err error, constraint string) bool {
	var pgErr interface{ SQLState() string }
	if !errors.As(err, &pgErr) || pgErr.SQLState() != "23505" {
		return false
	}
	return strings.Contains(err.Error(), constraint)
}

// CollectHardwareAssetStagedFile decides, under the session row lock, whether
// a staged storage key is still needed; when it is not, it invokes remove()
// WHILE the lock is held so a concurrent staging of the same
// content-addressed key can never observe a missing file, and only then
// commits the decision. A key is still needed when it is the staged bytes of
// a PREPARED session (the state a rollback restores) or when any immutable
// revision references it (the finalized blob). Cancelled/expired sessions
// keep their staged metadata, so their keys are collectable. Returns whether
// the file was collected.
func (s *PostgresStore) CollectHardwareAssetStagedFile(ctx context.Context, sessionID, organizationID, storageKey string, remove func() error) (bool, error) {
	if !isValidUUID(sessionID) || storageKey == "" {
		return false, nil
	}
	actor, _ := TenantActorFromCtx(ctx)
	if actor.OrganizationID == "" {
		actor.OrganizationID = organizationID
	}
	collected := false
	err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		var (
			staged     *string
			status     string
			revisionRefs int
		)
		if err := s.db(txCtx).QueryRow(txCtx, `
			SELECT staged_storage_key, status
			FROM hardware_asset_upload_sessions
			WHERE id = $1 AND organization_id = $2
			FOR UPDATE
		`, sessionID, organizationID).Scan(&staged, &status); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Session row gone (or foreign org): nothing can restore a
				// reference to the key through it; revision refs below still
				// guard finalized blobs.
				staged, status = nil, ""
			} else {
				return err
			}
		}
		if err := s.db(txCtx).QueryRow(txCtx, `
			SELECT count(*) FROM hardware_asset_revisions
			WHERE organization_id = $1 AND storage_key = $2
		`, organizationID, storageKey).Scan(&revisionRefs); err != nil {
			return err
		}
		liveStaging := staged != nil && *staged == storageKey && status == "prepared"
		if liveStaging || revisionRefs > 0 {
			return nil // still needed: prepared bytes or a finalized blob
		}
		if remove == nil {
			return nil
		}
		if err := remove(); err != nil {
			return err // decision tx rolls back; the file stays for a retry
		}
		collected = true
		return nil
	})
	if err != nil {
		return false, err
	}
	return collected, nil
}
