package storage

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #772 [P1][LIB-1]: Manufacturing library storage operations.
// Phase 1 scope: identity, release lifecycle, resource refs, and project pinning.
// Overlay logic (LIB-4) is not implemented here.
//
// AUTHORIZATION RULE: All read operations go through PostgreSQL RLS using the
// tenant context already set by the request middleware. Never use domain.LibraryCode
// ("0001", "1001") for authorization decisions.

// ─── Sentinel errors ──────────────────────────────────────────────────────────

// ErrLibraryNotFound is returned when a manufacturing library row does not exist
// or is not accessible to the current tenant.
var ErrLibraryNotFound = errors.New("manufacturing library not found")

// ErrLibraryReleaseNotFound is returned when a release does not exist or is not
// accessible (e.g., a draft of another organization's library).
var ErrLibraryReleaseNotFound = errors.New("library release not found")

// ErrReleaseNotDraft is returned when an operation requires draft status but the
// release is already published or withdrawn.
var ErrReleaseNotDraft = errors.New("library release is not in draft status")

// ErrReleaseDuplicateVersion is returned when attempting to create a release with
// a version that already exists for the same library.
var ErrReleaseDuplicateVersion = errors.New("library release version already exists")

// ErrReleaseManifestHashRequired is returned when attempting to publish a release
// that does not yet have a manifest_hash (must be populated by LIB-2 first).
var ErrReleaseManifestHashRequired = errors.New("manifest_hash must be set before publishing (requires LIB-2)")

// ─── Params ───────────────────────────────────────────────────────────────────

// CreateDraftReleaseParams groups parameters for creating a new draft release.
type CreateDraftReleaseParams struct {
	LibraryID        uuid.UUID
	Version          string
	SchemaVersion    int
	MinPluginVersion *string
	BaseReleaseID    *uuid.UUID
	Changelog        *string
}

// AddResourceRefParams groups parameters for adding a resource reference to a
// draft release.
type AddResourceRefParams struct {
	ReleaseID        uuid.UUID
	ResourceKind     string
	ResourceID       uuid.UUID
	ResourceRevision string
	DefinitionHash   *string
	PackageKind      domain.PackageKind
}

// ─── GetStandardLibrary ───────────────────────────────────────────────────────

// GetStandardLibrary returns the Granete Standard manufacturing library using
// its fixed UUID constant. It does not filter by organization: Standard is
// platform-global and readable by all authenticated requests via RLS.
func (s *PostgresStore) GetStandardLibrary(ctx context.Context) (*domain.ManufacturingLibrary, error) {
	standardID, err := uuid.Parse(domain.GraneteStandardLibraryID)
	if err != nil {
		return nil, fmt.Errorf("invalid GraneteStandardLibraryID constant: %w", err)
	}
	return s.getLibraryByID(ctx, standardID)
}

func (s *PostgresStore) getLibraryByID(ctx context.Context, id uuid.UUID) (*domain.ManufacturingLibrary, error) {
	const query = `
		SELECT id, code, kind, owner_organization_id, upstream_library_id,
		       update_policy, status, created_at, updated_at
		FROM manufacturing_libraries
		WHERE id = $1`

	row := s.db(ctx).QueryRow(ctx, query, id)
	lib, err := scanManufacturingLibrary(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrLibraryNotFound
		}
		return nil, fmt.Errorf("get manufacturing library %s: %w", id, err)
	}
	return lib, nil
}

// ─── GetCurrentPublishedRelease ───────────────────────────────────────────────

// GetCurrentPublishedRelease returns the latest published (non-withdrawn) release
// for the given library, ordered by created_at DESC so the most recently published
// release is returned. Returns ErrLibraryReleaseNotFound if no published release exists.
func (s *PostgresStore) GetCurrentPublishedRelease(ctx context.Context, libraryID uuid.UUID) (*domain.LibraryRelease, error) {
	const query = `
		SELECT id, library_id, version, status, schema_version, min_plugin_version,
		       base_release_id, manifest_hash, changelog, published_at, published_by,
		       created_at, updated_at
		FROM library_releases
		WHERE library_id = $1
		  AND status = 'published'
		ORDER BY created_at DESC
		LIMIT 1`

	row := s.db(ctx).QueryRow(ctx, query, libraryID)
	rel, err := scanLibraryRelease(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrLibraryReleaseNotFound
		}
		return nil, fmt.Errorf("get current published release for library %s: %w", libraryID, err)
	}
	return rel, nil
}

// ─── GetPublishedReleases ─────────────────────────────────────────────────────

// GetPublishedReleases returns all published (non-withdrawn) releases for the given
// library, ordered by created_at DESC (newest first). Returns an empty slice if no
// published releases exist.
func (s *PostgresStore) GetPublishedReleases(ctx context.Context, libraryID uuid.UUID) ([]*domain.LibraryRelease, error) {
	const query = `
		SELECT id, library_id, version, status, schema_version, min_plugin_version,
		       base_release_id, manifest_hash, changelog, published_at, published_by,
		       created_at, updated_at
		FROM library_releases
		WHERE library_id = $1
		  AND status = 'published'
		ORDER BY created_at DESC`

	rows, err := s.db(ctx).Query(ctx, query, libraryID)
	if err != nil {
		return nil, fmt.Errorf("get published releases for library %s: %w", libraryID, err)
	}
	defer rows.Close()

	var releases []*domain.LibraryRelease
	for rows.Next() {
		rel, err := scanLibraryRelease(rows)
		if err != nil {
			return nil, fmt.Errorf("scan library release: %w", err)
		}
		releases = append(releases, rel)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate library releases: %w", err)
	}
	return releases, nil
}

// ─── GetDraftReleases ─────────────────────────────────────────────────────────

// GetDraftReleases returns all draft releases for the given library, ordered
// by created_at DESC (newest first). Standard drafts are only visible to
// connections carrying the app.platform_admin marker (000156 read policy) —
// tenants keep the published-only surface. Returns an empty slice when the
// library has no open draft.
func (s *PostgresStore) GetDraftReleases(ctx context.Context, libraryID uuid.UUID) ([]*domain.LibraryRelease, error) {
	const query = `
		SELECT id, library_id, version, status, schema_version, min_plugin_version,
		       base_release_id, manifest_hash, changelog, published_at, published_by,
		       created_at, updated_at
		FROM library_releases
		WHERE library_id = $1
		  AND status = 'draft'
		ORDER BY created_at DESC`

	rows, err := s.db(ctx).Query(ctx, query, libraryID)
	if err != nil {
		return nil, fmt.Errorf("get draft releases for library %s: %w", libraryID, err)
	}
	defer rows.Close()

	var releases []*domain.LibraryRelease
	for rows.Next() {
		rel, err := scanLibraryRelease(rows)
		if err != nil {
			return nil, fmt.Errorf("scan library release: %w", err)
		}
		releases = append(releases, rel)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate library releases: %w", err)
	}
	return releases, nil
}

// ─── GetReleaseByID ───────────────────────────────────────────────────────────

// GetReleaseByID returns a specific release by its UUID. Access is enforced by
// RLS: draft releases of Granete Standard are not visible to tenant connections.
func (s *PostgresStore) GetReleaseByID(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryRelease, error) {
	const query = `
		SELECT id, library_id, version, status, schema_version, min_plugin_version,
		       base_release_id, manifest_hash, changelog, published_at, published_by,
		       created_at, updated_at
		FROM library_releases
		WHERE id = $1`

	row := s.db(ctx).QueryRow(ctx, query, releaseID)
	rel, err := scanLibraryRelease(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrLibraryReleaseNotFound
		}
		return nil, fmt.Errorf("get library release %s: %w", releaseID, err)
	}
	return rel, nil
}

// ─── CreateDraftRelease ───────────────────────────────────────────────────────

// CreateDraftRelease creates a new draft release for the given library.
// Returns ErrReleaseDuplicateVersion when the (library_id, version) pair already exists.
func (s *PostgresStore) CreateDraftRelease(ctx context.Context, params CreateDraftReleaseParams) (*domain.LibraryRelease, error) {
	const query = `
		INSERT INTO library_releases
		    (library_id, version, status, schema_version, min_plugin_version,
		     base_release_id, changelog, created_at, updated_at)
		VALUES ($1, $2, 'draft', $3, $4, $5, $6, NOW(), NOW())
		RETURNING id, library_id, version, status, schema_version, min_plugin_version,
		          base_release_id, manifest_hash, changelog, published_at, published_by,
		          created_at, updated_at`

	row := s.db(ctx).QueryRow(ctx, query,
		params.LibraryID,
		params.Version,
		params.SchemaVersion,
		params.MinPluginVersion,
		params.BaseReleaseID,
		params.Changelog,
	)
	rel, err := scanLibraryRelease(row)
	if err != nil {
		if isUniqueViolationOn(err, "library_releases_library_id_version_key") {
			return nil, fmt.Errorf("%w: %s", ErrReleaseDuplicateVersion, params.Version)
		}
		return nil, fmt.Errorf("create draft release %s@%s: %w", params.LibraryID, params.Version, err)
	}
	return rel, nil
}

// ─── PublishRelease ───────────────────────────────────────────────────────────

// PublishRelease transitions a draft release to published. The release must be
// in draft status and must already have manifest_hash set (populated by LIB-2).
//
// Note for Phase 1: calling this on Granete Standard releases requires running
// outside tenant context (admin-side). Org overlay releases go through tenant
// RLS write policy.
func (s *PostgresStore) PublishRelease(ctx context.Context, releaseID uuid.UUID, manifestHash string, publishedBy uuid.UUID) error {
	const query = `
		UPDATE library_releases
		SET status       = 'published',
		    manifest_hash = $2,
		    published_at  = NOW(),
		    published_by  = $3,
		    updated_at    = NOW()
		WHERE id = $1
		  AND status = 'draft'
		  AND manifest_hash IS NOT NULL`

	tag, err := s.db(ctx).Exec(ctx, query, releaseID, manifestHash, publishedBy)
	if err != nil {
		return fmt.Errorf("publish release %s: %w", releaseID, err)
	}
	if tag.RowsAffected() == 0 {
		// Either the release does not exist, is already published/withdrawn, or
		// manifest_hash was still nil. Distinguish for callers.
		rel, lookupErr := s.GetReleaseByID(ctx, releaseID)
		if lookupErr != nil {
			return fmt.Errorf("%w: %s", ErrLibraryReleaseNotFound, releaseID)
		}
		if !rel.IsDraft() {
			return fmt.Errorf("%w: current status is %s", ErrReleaseNotDraft, rel.Status)
		}
		if rel.ManifestHash == nil {
			return ErrReleaseManifestHashRequired
		}
		return fmt.Errorf("publish release %s: no rows affected (unexpected)", releaseID)
	}
	return nil
}

// ─── WithdrawRelease ──────────────────────────────────────────────────────────

// WithdrawRelease marks a published release as withdrawn. A withdrawn release
// is no longer returned by GetCurrentPublishedRelease but its rows remain
// intact for historical audit and project pinning.
func (s *PostgresStore) WithdrawRelease(ctx context.Context, releaseID uuid.UUID) error {
	const query = `
		UPDATE library_releases
		SET status     = 'withdrawn',
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'published'`

	tag, err := s.db(ctx).Exec(ctx, query, releaseID)
	if err != nil {
		return fmt.Errorf("withdraw release %s: %w", releaseID, err)
	}
	if tag.RowsAffected() == 0 {
		rel, lookupErr := s.GetReleaseByID(ctx, releaseID)
		if lookupErr != nil {
			return fmt.Errorf("%w: %s", ErrLibraryReleaseNotFound, releaseID)
		}
		return fmt.Errorf("%w: cannot withdraw a %s release", ErrReleaseNotDraft, rel.Status)
	}
	return nil
}

// ─── AddResourceRef ───────────────────────────────────────────────────────────

// AddResourceRef adds a canonical resource reference to a draft release.
// Returns ErrReleaseNotDraft when the release is already published or withdrawn,
// enforcing the immutability of published releases.
func (s *PostgresStore) AddResourceRef(ctx context.Context, params AddResourceRefParams) error {
	// Verify the release is still in draft before inserting.
	// The RLS write policy also enforces this, but we surface a clear error.
	const checkQuery = `SELECT status FROM library_releases WHERE id = $1`
	var statusStr string
	err := s.db(ctx).QueryRow(ctx, checkQuery, params.ReleaseID).Scan(&statusStr)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrLibraryReleaseNotFound, params.ReleaseID)
		}
		return fmt.Errorf("check release status for AddResourceRef: %w", err)
	}
	if domain.ReleaseStatus(statusStr) != domain.ReleaseStatusDraft {
		return fmt.Errorf("%w: cannot add resource refs to a %s release", ErrReleaseNotDraft, statusStr)
	}

	const insertQuery = `
		INSERT INTO library_release_resource_refs
		    (release_id, resource_kind, resource_id, resource_revision, definition_hash, package_kind)
		VALUES ($1, $2, $3, $4, $5, $6)`

	_, err = s.db(ctx).Exec(ctx, insertQuery,
		params.ReleaseID,
		params.ResourceKind,
		params.ResourceID,
		params.ResourceRevision,
		params.DefinitionHash,
		string(params.PackageKind),
	)
	if err != nil {
		return fmt.Errorf("add resource ref to release %s: %w", params.ReleaseID, err)
	}
	return nil
}

// ─── GetEffectiveReleaseForOrg ────────────────────────────────────────────────

// GetEffectiveReleaseForOrg returns the current effective library release for an
// organization.
//
// Phase 1 behavior: always returns the current published Granete Standard release.
// There are no org overlays yet (that is LIB-4 / #775). If no published release
// exists, returns ErrLibraryReleaseNotFound.
func (s *PostgresStore) GetEffectiveReleaseForOrg(ctx context.Context, _ uuid.UUID) (*domain.LibraryRelease, error) {
	standardID, err := uuid.Parse(domain.GraneteStandardLibraryID)
	if err != nil {
		return nil, fmt.Errorf("invalid GraneteStandardLibraryID constant: %w", err)
	}
	return s.GetCurrentPublishedRelease(ctx, standardID)
}

// ─── RecordDesignRevisionLibraryPin ──────────────────────────────────────────

// RecordDesignRevisionLibraryPin sets effective_library_release_id on a
// design_revisions row when it is being created (called from within the publish
// transaction). The pin is immutable after the row is written.
//
// releaseID may be nil when GetEffectiveReleaseForOrg returned no published release;
// in that case the column is set to NULL and a warning is logged. This is not an
// error in Phase 1 but will become a hard requirement in a future milestone.
func (s *PostgresStore) RecordDesignRevisionLibraryPin(ctx context.Context, revisionID uuid.UUID, releaseID *uuid.UUID) error {
	if releaseID == nil {
		slog.WarnContext(ctx, "design revision created without library pin — no published library release available",
			"revision_id", revisionID,
			"issue", "#772")
	}

	const query = `
		UPDATE design_revisions
		SET effective_library_release_id = $2
		WHERE id = $1`

	_, err := s.db(ctx).Exec(ctx, query, revisionID, releaseID)
	if err != nil {
		return fmt.Errorf("record library pin for design revision %s: %w", revisionID, err)
	}
	return nil
}

// ─── Scanners ─────────────────────────────────────────────────────────────────

func scanManufacturingLibrary(row rowScanner) (*domain.ManufacturingLibrary, error) {
	var lib domain.ManufacturingLibrary
	var ownerOrgID *uuid.UUID
	var upstreamLibID *uuid.UUID

	err := row.Scan(
		&lib.ID,
		&lib.Code,
		&lib.Kind,
		&ownerOrgID,
		&upstreamLibID,
		&lib.UpdatePolicy,
		&lib.Status,
		&lib.CreatedAt,
		&lib.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	lib.OwnerOrganizationID = ownerOrgID
	lib.UpstreamLibraryID = upstreamLibID
	return &lib, nil
}

func scanLibraryRelease(row rowScanner) (*domain.LibraryRelease, error) {
	var rel domain.LibraryRelease
	var baseReleaseID *uuid.UUID
	var manifestHash *string
	var changelog *string
	var publishedAt *time.Time
	var publishedBy *uuid.UUID
	var minPluginVersion *string

	err := row.Scan(
		&rel.ID,
		&rel.LibraryID,
		&rel.Version,
		&rel.Status,
		&rel.SchemaVersion,
		&minPluginVersion,
		&baseReleaseID,
		&manifestHash,
		&changelog,
		&publishedAt,
		&publishedBy,
		&rel.CreatedAt,
		&rel.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	rel.MinPluginVersion = minPluginVersion
	rel.BaseReleaseID = baseReleaseID
	rel.ManifestHash = manifestHash
	rel.Changelog = changelog
	rel.PublishedAt = publishedAt
	rel.PublishedBy = publishedBy
	return &rel, nil
}
