package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #773 [P1][LIB-2]: Integration test suite for deterministic library publisher,
// atomic release manifest publishing, blob deduplication, immutability triggers,
// and entitlement checks.

// ─── Case 1: Atomic Publish and Immutability Triggers ─────────────────────────
func TestManufacturingLibraryPublish_AtomicTransactionAndImmutability(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	relID := uuid.New()
	version := "1.0.0"

	// Insert draft release
	_, err := fx.admin.Exec(ctx, `
		INSERT INTO library_releases (id, library_id, version, status)
		VALUES ($1, $2, $3, 'draft')
	`, relID, standardID, version)
	if err != nil {
		t.Fatalf("insert draft release: %v", err)
	}

	resID := uuid.New()
	blobContent := []byte(`{"id":"` + resID.String() + `","name":"Base Cabinet 60"}`)
	blobHash := "sha256:1111222233334444555566667777888899990000aaaa"

	// Insert resource ref into draft release
	_, err = fx.admin.Exec(ctx, `
		INSERT INTO library_release_resource_refs (id, release_id, resource_kind, resource_id, resource_revision, package_kind)
		VALUES ($1, $2, 'furniture_definition', $3, 'rev-1', 'free')
	`, uuid.New(), relID, resID)
	if err != nil {
		t.Fatalf("insert draft resource ref: %v", err)
	}

	blob := domain.ResourceBlob{
		SHA256:       blobHash,
		ResourceKind: "furniture_definition",
		ResourceID:   resID,
		ContentType:  "application/json",
		SizeBytes:    int64(len(blobContent)),
		Content:      json.RawMessage(blobContent),
	}

	manifestHash := "sha256:manifest1234567890abcdef"
	manifest := domain.LibraryManifest{
		SchemaVersion:      1,
		LibraryID:          standardID,
		LibraryCode:        "0001",
		LibraryVersion:     version,
		EffectiveReleaseID: relID,
		ManifestHash:       manifestHash,
		Resources: []domain.ManifestResourceRef{
			{
				Kind:           "furniture_definition",
				ID:             resID,
				Revision:       "rev-1",
				PackageKind:    domain.PackageKindFree,
				DefinitionHash: blobHash,
			},
		},
	}
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}

	// Publish via adminStore (Granete Standard release management is a platform operation)
	err = adminStore.PublishReleaseWithManifest(ctx, relID, &manifest, manifestBytes, []domain.ResourceBlob{blob}, nil)
	if err != nil {
		t.Fatalf("PublishReleaseWithManifest: %v", err)
	}

	// Verify release table updated
	var relStatus string
	var relManifestHash *string
	var relPublishedAt *time.Time
	err = fx.admin.QueryRow(ctx, `
		SELECT status, manifest_hash, published_at
		FROM library_releases
		WHERE id = $1
	`, relID).Scan(&relStatus, &relManifestHash, &relPublishedAt)
	if err != nil {
		t.Fatalf("query release: %v", err)
	}

	if relStatus != string(domain.ReleaseStatusPublished) {
		t.Errorf("expected status 'published', got %q", relStatus)
	}
	if relManifestHash == nil || *relManifestHash != manifestHash {
		t.Errorf("expected manifest_hash %q, got %v", manifestHash, relManifestHash)
	}
	if relPublishedAt == nil {
		t.Errorf("expected published_at to be set, got nil")
	}

	// Verify GetReleaseManifest via adminStore
	readManifest, rawJSON, err := adminStore.GetReleaseManifest(ctx, relID)
	if err != nil {
		t.Fatalf("GetReleaseManifest: %v", err)
	}
	if readManifest.ManifestHash != manifestHash {
		t.Errorf("expected manifest hash %q, got %q", manifestHash, readManifest.ManifestHash)
	}
	if len(rawJSON) == 0 {
		t.Errorf("expected non-empty rawJSON")
	}

	// Verify GetResourceBlob via adminStore
	readBlob, err := adminStore.GetResourceBlob(ctx, blobHash)
	if err != nil {
		t.Fatalf("GetResourceBlob: %v", err)
	}
	if readBlob.SHA256 != blobHash {
		t.Errorf("expected blob hash %q, got %q", blobHash, readBlob.SHA256)
	}

	// Immutability trigger proof: UPDATE library_release_manifests must be rejected
	_, err = fx.admin.Exec(ctx, `
		UPDATE library_release_manifests
		SET manifest_hash = 'sha256:tampered'
		WHERE release_id = $1
	`, relID)
	if err == nil {
		t.Fatalf("expected trigger error when updating library_release_manifests, got nil")
	}
	if !strings.Contains(err.Error(), "immutable") {
		t.Errorf("expected immutability violation error message, got: %v", err)
	}

	// Immutability trigger proof: UPDATE library_resource_blobs must be rejected
	_, err = fx.admin.Exec(ctx, `
		UPDATE library_resource_blobs
		SET content = '{"tampered":true}'::jsonb
		WHERE sha256 = $1
	`, blobHash)
	if err == nil {
		t.Fatalf("expected trigger error when updating library_resource_blobs, got nil")
	}
	if !strings.Contains(err.Error(), "immutable") {
		t.Errorf("expected immutability violation error message, got: %v", err)
	}
}

// ─── Case 2: Content Blob Deduplication ───────────────────────────────────────
func TestManufacturingLibraryPublish_BlobDeduplication(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	sharedHash := "sha256:sharedcontent1234567890abcdef"
	sharedContent := []byte(`{"shared":true,"type":"standard_hardware"}`)
	resID := uuid.New()

	blob := domain.ResourceBlob{
		SHA256:       sharedHash,
		ResourceKind: "hardware_definition",
		ResourceID:   resID,
		ContentType:  "application/json",
		SizeBytes:    int64(len(sharedContent)),
		Content:      json.RawMessage(sharedContent),
	}

	// Release 1 with shared blob
	rel1ID := uuid.New()
	_, err := fx.admin.Exec(ctx, `
		INSERT INTO library_releases (id, library_id, version, status)
		VALUES ($1, $2, '1.1.0', 'draft')
	`, rel1ID, standardID)
	if err != nil {
		t.Fatalf("insert rel 1: %v", err)
	}
	_, err = fx.admin.Exec(ctx, `
		INSERT INTO library_release_resource_refs (id, release_id, resource_kind, resource_id, resource_revision, package_kind)
		VALUES ($1, $2, 'hardware_definition', $3, 'rev-1', 'free')
	`, uuid.New(), rel1ID, resID)
	if err != nil {
		t.Fatalf("insert ref 1: %v", err)
	}

	manifest1 := domain.LibraryManifest{
		SchemaVersion:      1,
		LibraryID:          standardID,
		LibraryCode:        "0001",
		LibraryVersion:     "1.1.0",
		EffectiveReleaseID: rel1ID,
		ManifestHash:       "sha256:manifestrel1",
		Resources: []domain.ManifestResourceRef{
			{
				Kind:           "hardware_definition",
				ID:             resID,
				Revision:       "rev-1",
				PackageKind:    domain.PackageKindFree,
				DefinitionHash: sharedHash,
			},
		},
	}
	mBytes1, _ := json.Marshal(manifest1)
	if err := adminStore.PublishReleaseWithManifest(ctx, rel1ID, &manifest1, mBytes1, []domain.ResourceBlob{blob}, nil); err != nil {
		t.Fatalf("publish release 1: %v", err)
	}

	// Release 2 with the EXACT SAME BLOB (deduplication ON CONFLICT DO NOTHING)
	rel2ID := uuid.New()
	_, err = fx.admin.Exec(ctx, `
		INSERT INTO library_releases (id, library_id, version, status)
		VALUES ($1, $2, '1.2.0', 'draft')
	`, rel2ID, standardID)
	if err != nil {
		t.Fatalf("insert rel 2: %v", err)
	}
	_, err = fx.admin.Exec(ctx, `
		INSERT INTO library_release_resource_refs (id, release_id, resource_kind, resource_id, resource_revision, package_kind)
		VALUES ($1, $2, 'hardware_definition', $3, 'rev-1', 'free')
	`, uuid.New(), rel2ID, resID)
	if err != nil {
		t.Fatalf("insert ref 2: %v", err)
	}

	manifest2 := domain.LibraryManifest{
		SchemaVersion:      1,
		LibraryID:          standardID,
		LibraryCode:        "0001",
		LibraryVersion:     "1.2.0",
		EffectiveReleaseID: rel2ID,
		ManifestHash:       "sha256:manifestrel2",
		Resources: []domain.ManifestResourceRef{
			{
				Kind:           "hardware_definition",
				ID:             resID,
				Revision:       "rev-1",
				PackageKind:    domain.PackageKindFree,
				DefinitionHash: sharedHash,
			},
		},
	}
	mBytes2, _ := json.Marshal(manifest2)
	if err := adminStore.PublishReleaseWithManifest(ctx, rel2ID, &manifest2, mBytes2, []domain.ResourceBlob{blob}, nil); err != nil {
		t.Fatalf("publish release 2 with duplicate blob failed (should deduplicate): %v", err)
	}

	// Verify only 1 row exists in library_resource_blobs for sharedHash
	var count int
	err = fx.admin.QueryRow(ctx, `
		SELECT COUNT(*) FROM library_resource_blobs WHERE sha256 = $1
	`, sharedHash).Scan(&count)
	if err != nil {
		t.Fatalf("count blobs: %v", err)
	}
	if count != 1 {
		t.Errorf("expected exactly 1 blob row after deduplication, got %d", count)
	}
}

// ─── Case 3: Entitlement Check for Resource Blob Download ─────────────────────
func TestManufacturingLibraryPublish_GetResourceBlobWithEntitlementCheck(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	relID := uuid.New()
	freeResID := uuid.New()
	stdResID := uuid.New()

	_, err := fx.admin.Exec(ctx, `
		INSERT INTO library_releases (id, library_id, version, status)
		VALUES ($1, $2, '2.0.0', 'draft')
	`, relID, standardID)
	if err != nil {
		t.Fatalf("insert rel: %v", err)
	}

	_, err = fx.admin.Exec(ctx, `
		INSERT INTO library_release_resource_refs (id, release_id, resource_kind, resource_id, resource_revision, package_kind)
		VALUES
			($1, $2, 'furniture_definition', $3, 'rev-free', 'free'),
			($4, $2, 'furniture_definition', $5, 'rev-std', 'standard')
	`, uuid.New(), relID, freeResID, uuid.New(), stdResID)
	if err != nil {
		t.Fatalf("insert refs: %v", err)
	}

	freeHash := "sha256:freeblob12345"
	stdHash := "sha256:standardblob67890"

	freeBlob := domain.ResourceBlob{
		SHA256:       freeHash,
		ResourceKind: "furniture_definition",
		ResourceID:   freeResID,
		ContentType:  "application/json",
		SizeBytes:    20,
		Content:      json.RawMessage(`{"name":"Free"}`),
	}
	stdBlob := domain.ResourceBlob{
		SHA256:       stdHash,
		ResourceKind: "furniture_definition",
		ResourceID:   stdResID,
		ContentType:  "application/json",
		SizeBytes:    24,
		Content:      json.RawMessage(`{"name":"Standard"}`),
	}

	manifest := domain.LibraryManifest{
		SchemaVersion:      1,
		LibraryID:          standardID,
		LibraryCode:        "0001",
		LibraryVersion:     "2.0.0",
		EffectiveReleaseID: relID,
		ManifestHash:       "sha256:manifest200",
		Resources: []domain.ManifestResourceRef{
			{
				Kind:           "furniture_definition",
				ID:             freeResID,
				Revision:       "rev-free",
				PackageKind:    domain.PackageKindFree,
				DefinitionHash: freeHash,
			},
			{
				Kind:           "furniture_definition",
				ID:             stdResID,
				Revision:       "rev-std",
				PackageKind:    domain.PackageKindStandard,
				DefinitionHash: stdHash,
			},
		},
	}
	mBytes, _ := json.Marshal(manifest)

	if err := adminStore.PublishReleaseWithManifest(ctx, relID, &manifest, mBytes, []domain.ResourceBlob{freeBlob, stdBlob}, nil); err != nil {
		t.Fatalf("publish: %v", err)
	}

	// 1. Fetch free resource
	b, pkgKind, err := adminStore.GetResourceBlobWithEntitlementCheck(ctx, relID, freeResID, freeHash)
	if err != nil {
		t.Fatalf("fetch free blob: %v", err)
	}
	if b.SHA256 != freeHash {
		t.Errorf("expected hash %q, got %q", freeHash, b.SHA256)
	}
	if pkgKind != domain.PackageKindFree {
		t.Errorf("expected PackageKindFree, got %q", pkgKind)
	}

	// 2. Fetch standard resource
	b, pkgKind, err = adminStore.GetResourceBlobWithEntitlementCheck(ctx, relID, stdResID, stdHash)
	if err != nil {
		t.Fatalf("fetch standard blob: %v", err)
	}
	if b.SHA256 != stdHash {
		t.Errorf("expected hash %q, got %q", stdHash, b.SHA256)
	}
	if pkgKind != domain.PackageKindStandard {
		t.Errorf("expected PackageKindStandard, got %q", pkgKind)
	}

	// 3. Resource not in release -> ErrResourceNotInRelease
	unrelatedResID := uuid.New()
	_, _, err = adminStore.GetResourceBlobWithEntitlementCheck(ctx, relID, unrelatedResID, freeHash)
	if !errors.Is(err, storage.ErrResourceNotInRelease) {
		t.Errorf("expected ErrResourceNotInRelease, got %v", err)
	}

	// 4. Hash mismatch -> ErrResourceNotInRelease
	_, _, err = adminStore.GetResourceBlobWithEntitlementCheck(ctx, relID, freeResID, "sha256:wronghash")
	if !errors.Is(err, storage.ErrResourceNotInRelease) {
		t.Errorf("expected ErrResourceNotInRelease, got %v", err)
	}
}

// ─── Case 4: Rollback on Error ────────────────────────────────────────────────
func TestManufacturingLibraryPublish_RollbackOnError(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	nonExistentRelID := uuid.New()
	manifest := domain.LibraryManifest{
		SchemaVersion:      1,
		LibraryID:          uuid.New(),
		LibraryCode:        "9999",
		LibraryVersion:     "9.9.9",
		EffectiveReleaseID: nonExistentRelID,
		ManifestHash:       "sha256:none",
	}
	mBytes, _ := json.Marshal(manifest)

	err := adminStore.PublishReleaseWithManifest(ctx, nonExistentRelID, &manifest, mBytes, nil, nil)
	if err == nil {
		t.Fatalf("expected error for non-existent release, got nil")
	}

	// Ensure no orphaned manifest row exists
	var count int
	_ = fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM library_release_manifests WHERE release_id = $1`, nonExistentRelID).Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 manifest rows after rollback, got %d", count)
	}
}

// ─── Case 5: Negative Proof — Hash knowledge is not authorization ─────────────
func TestManufacturingLibraryPublish_NegativeProof_HashNotAuth(t *testing.T) {
	candidates := []string{
		"manufacturing_library_publish.go",
		"internal/storage/manufacturing_library_publish.go",
		"backend-go/internal/storage/manufacturing_library_publish.go",
	}
	var content []byte
	var err error
	for _, p := range candidates {
		content, err = os.ReadFile(p)
		if err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("could not read manufacturing_library_publish.go: %v", err)
	}

	src := string(content)

	// Ensure the query verifies release membership before returning blob
	if !strings.Contains(src, "library_release_resource_refs") {
		t.Errorf("GetResourceBlobWithEntitlementCheck must join or check library_release_resource_refs for release membership")
	}
}
