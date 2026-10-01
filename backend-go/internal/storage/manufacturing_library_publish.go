package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

var (
	ErrManifestNotFound     = errors.New("library release manifest not found")
	ErrResourceBlobNotFound = errors.New("library resource blob not found")
	ErrResourceNotInRelease = errors.New("resource not found in specified release")
)

// PublishReleaseWithManifest atomically publishes a draft release along with its
// materialized manifest and all content-addressed JSON definition blobs.
// Failure at any step leaves the previous current release untouched.
func (s *PostgresStore) PublishReleaseWithManifest(
	ctx context.Context,
	releaseID uuid.UUID,
	manifest *domain.LibraryManifest,
	manifestBytes []byte,
	blobs []domain.ResourceBlob,
	publishedBy *uuid.UUID,
) error {
	if manifest == nil || len(manifestBytes) == 0 {
		return errors.New("manifest and manifestBytes must not be empty")
	}
	if manifest.ManifestHash == "" {
		return ErrReleaseManifestHashRequired
	}

	tx, err := s.beginTx(ctx)
	if err != nil {
		return fmt.Errorf("begin publish tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// 1. Advance release status from draft to published
	const updateReleaseQuery = `
		UPDATE library_releases
		SET status        = 'published',
		    manifest_hash = $2,
		    published_at  = NOW(),
		    published_by  = $3,
		    updated_at    = NOW()
		WHERE id = $1
		  AND status = 'draft'`

	tag, err := tx.Exec(ctx, updateReleaseQuery, releaseID, manifest.ManifestHash, publishedBy)
	if err != nil {
		return fmt.Errorf("update release %s to published: %w", releaseID, err)
	}
	if tag.RowsAffected() == 0 {
		rel, lookupErr := s.GetReleaseByID(ctx, releaseID)
		if lookupErr != nil {
			return fmt.Errorf("%w: %s", ErrLibraryReleaseNotFound, releaseID)
		}
		if !rel.IsDraft() {
			return fmt.Errorf("%w: current status is %s", ErrReleaseNotDraft, rel.Status)
		}
		return fmt.Errorf("publish release %s: no rows affected", releaseID)
	}

	// 2. Insert immutable manifest row
	const insertManifestQuery = `
		INSERT INTO library_release_manifests (release_id, manifest_hash, manifest_json)
		VALUES ($1, $2, $3)`

	if _, err := tx.Exec(ctx, insertManifestQuery, releaseID, manifest.ManifestHash, manifestBytes); err != nil {
		return fmt.Errorf("insert release manifest: %w", err)
	}

	// 3. Content-addressed resource blobs (deduplicating across releases).
	// Blobs are immutable, so a blob a previous release already wrote is
	// skipped rather than updated. ON CONFLICT DO NOTHING performs no
	// conflicting update, so it needs only the INSERT grant and the
	// library_resource_blobs_insert policy (000140) — no UPDATE, which this
	// role does not have and the immutability trigger forbids. A read-then-
	// insert probe would be weaker: library_resource_blobs_read reaches a
	// blob only through a ref row, and refs are materialized at step 4.
	const insertBlobQuery = `
		INSERT INTO library_resource_blobs (
			sha256, resource_kind, resource_id, content_type, size_bytes, content
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (sha256) DO NOTHING`

	for _, b := range blobs {
		if _, err := tx.Exec(ctx, insertBlobQuery,
			b.SHA256, b.ResourceKind, b.ResourceID, b.ContentType, b.SizeBytes, b.Content,
		); err != nil {
			return fmt.Errorf("insert resource blob %s: %w", b.SHA256, err)
		}
	}

	// 4. Materialize library_release_resource_refs for every manifest
	// resource. The ref row is the only path a tenant read traverses to
	// reach a pinned blob (library_resource_blobs_read joins
	// definition_hash → refs → release → library), so a manifest resource
	// without a ref row is a resource no tenant can ever read — the blob
	// would be invisible and the pinned read would fail closed with
	// "blob not found". A compiled release therefore materializes its refs
	// here, inside the publication transaction. Existing rows receive the compiled revision, definition hash, and
	// package kind from the manifest, which is the compilation authority; missing
	// rows are inserted from the manifest, whose revision and package kind
	// are the compilation authority (#955).
	const selectRefQuery = `
		SELECT EXISTS (
			SELECT 1 FROM library_release_resource_refs
			WHERE release_id = $1 AND resource_kind = $2 AND resource_id = $3
		)`
	const insertRefQuery = `
		INSERT INTO library_release_resource_refs
		    (release_id, resource_kind, resource_id, resource_revision, definition_hash, package_kind)
		VALUES ($1, $2, $3, $4, $5, $6)`
	const updateRefQuery = `
		UPDATE library_release_resource_refs
		SET definition_hash = $3,
		    resource_revision = $5,
		    package_kind = $6
		WHERE release_id = $1
		  AND resource_kind = $2
		  AND resource_id = $4`

	for _, r := range manifest.Resources {
		var exists bool
		if err := tx.QueryRow(ctx, selectRefQuery, releaseID, r.Kind, r.ID).Scan(&exists); err != nil {
			return fmt.Errorf("read resource ref %s/%s: %w", r.Kind, r.ID, err)
		}
		if exists {
			if _, err := tx.Exec(ctx, updateRefQuery, releaseID, r.Kind, r.DefinitionHash, r.ID, r.Revision, string(r.PackageKind)); err != nil {
				return fmt.Errorf("update resource ref %s/%s definition_hash: %w", r.Kind, r.ID, err)
			}
			continue
		}
		if _, err := tx.Exec(ctx, insertRefQuery,
			releaseID, r.Kind, r.ID, r.Revision, r.DefinitionHash, string(r.PackageKind),
		); err != nil {
			return fmt.Errorf("insert resource ref %s/%s: %w", r.Kind, r.ID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit publish release %s: %w", releaseID, err)
	}

	return nil
}

// GetReleaseManifest retrieves the materialized manifest for a published release.
// Subject to RLS: tenant must have access to the release.
func (s *PostgresStore) GetReleaseManifest(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryManifest, []byte, error) {
	const query = `
		SELECT manifest_json
		FROM library_release_manifests
		WHERE release_id = $1`

	var raw []byte
	err := s.db(ctx).QueryRow(ctx, query, releaseID).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrManifestNotFound
		}
		return nil, nil, fmt.Errorf("get release manifest %s: %w", releaseID, err)
	}

	var m domain.LibraryManifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, nil, fmt.Errorf("unmarshal release manifest %s: %w", releaseID, err)
	}

	return &m, raw, nil
}

// GetResourceBlob retrieves a raw definition blob by its cryptographic content hash.
// Subject to RLS: blob must be referenced by an accessible published release.
func (s *PostgresStore) GetResourceBlob(ctx context.Context, sha256 string) (*domain.ResourceBlob, error) {
	const query = `
		SELECT sha256, resource_kind, resource_id, content_type, size_bytes, content, created_at
		FROM library_resource_blobs
		WHERE sha256 = $1`

	var b domain.ResourceBlob
	var contentRaw []byte
	err := s.db(ctx).QueryRow(ctx, query, sha256).Scan(
		&b.SHA256, &b.ResourceKind, &b.ResourceID, &b.ContentType, &b.SizeBytes, &contentRaw, &b.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrResourceBlobNotFound
		}
		return nil, fmt.Errorf("get resource blob %s: %w", sha256, err)
	}

	b.Content = contentRaw
	return &b, nil
}

// GetResourceBlobWithEntitlementCheck retrieves a blob while ensuring:
// 1. It belongs to the requested release and resource ID.
// 2. Returns the package_kind ("free" vs "standard") to enforce entitlement in the API boundary.
func (s *PostgresStore) GetResourceBlobWithEntitlementCheck(
	ctx context.Context,
	releaseID uuid.UUID,
	resourceID uuid.UUID,
	sha256 string,
) (*domain.ResourceBlob, domain.PackageKind, error) {
	const query = `
		SELECT b.sha256, b.resource_kind, b.resource_id, b.content_type, b.size_bytes, b.content, b.created_at,
		       r.package_kind
		FROM library_resource_blobs b
		JOIN library_release_resource_refs r
		  ON r.definition_hash = b.sha256
		WHERE r.release_id = $1
		  AND r.resource_id = $2
		  AND b.sha256 = $3`

	var b domain.ResourceBlob
	var contentRaw []byte
	var pkgKind domain.PackageKind

	err := s.db(ctx).QueryRow(ctx, query, releaseID, resourceID, sha256).Scan(
		&b.SHA256, &b.ResourceKind, &b.ResourceID, &b.ContentType, &b.SizeBytes, &contentRaw, &b.CreatedAt,
		&pkgKind,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", ErrResourceNotInRelease
		}
		return nil, "", fmt.Errorf("get resource blob with entitlement check: %w", err)
	}

	b.Content = contentRaw
	return &b, pkgKind, nil
}
