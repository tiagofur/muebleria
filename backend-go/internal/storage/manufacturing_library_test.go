package storage_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #772 [P1][LIB-1]: Test suite for manufacturing library relational foundation,
// immutable release lifecycle, Free/Standard package semantics, RLS isolation,
// and design revision pinning.

// ─── Case 1: Seed structural ──────────────────────────────────────────────────
// Granete Standard must be seeded with fixed UUID and code '0001', kind 'standard'.
// Initial draft release 0.1.0-draft must exist with fixed draft UUID.
func TestManufacturingLibrary_SeedStructural(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	standardUUID := uuid.MustParse(domain.GraneteStandardLibraryID)

	var code, kind, status string
	var ownerOrgID, upstreamID *uuid.UUID
	err := fx.admin.QueryRow(ctx, `
		SELECT code, kind, status, owner_organization_id, upstream_library_id
		FROM manufacturing_libraries
		WHERE id = $1
	`, standardUUID).Scan(&code, &kind, &status, &ownerOrgID, &upstreamID)
	if err != nil {
		t.Fatalf("Granete Standard library not found by fixed UUID %s: %v", domain.GraneteStandardLibraryID, err)
	}

	if code != "0001" {
		t.Errorf("expected code '0001', got %q", code)
	}
	if kind != string(domain.LibraryKindStandard) {
		t.Errorf("expected kind %q, got %q", domain.LibraryKindStandard, kind)
	}
	if status != "active" {
		t.Errorf("expected status 'active', got %q", status)
	}
	if ownerOrgID != nil {
		t.Errorf("expected owner_organization_id IS NULL for Standard, got %v", ownerOrgID)
	}
	if upstreamID != nil {
		t.Errorf("expected upstream_library_id IS NULL for Standard, got %v", upstreamID)
	}

	// Verify initial draft release
	draftUUID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)
	var relVersion, relStatus string
	var relLibID uuid.UUID
	var schemaVer int
	var manifestHash *string
	err = fx.admin.QueryRow(ctx, `
		SELECT library_id, version, status, schema_version, manifest_hash
		FROM library_releases
		WHERE id = $1
	`, draftUUID).Scan(&relLibID, &relVersion, &relStatus, &schemaVer, &manifestHash)
	if err != nil {
		t.Fatalf("Granete Standard draft release not found by fixed UUID %s: %v", domain.GraneteStandardDraftReleaseID, err)
	}

	if relLibID != standardUUID {
		t.Errorf("expected draft release library_id = %s, got %s", standardUUID, relLibID)
	}
	if relVersion != "0.1.0-draft" {
		t.Errorf("expected version '0.1.0-draft', got %q", relVersion)
	}
	if relStatus != string(domain.ReleaseStatusDraft) {
		t.Errorf("expected status 'draft', got %q", relStatus)
	}
	if schemaVer != 1 {
		t.Errorf("expected schema_version 1, got %d", schemaVer)
	}
	if manifestHash != nil {
		t.Errorf("expected manifest_hash IS NULL for initial draft, got %v", *manifestHash)
	}
}

// ─── Case 2: Free is NOT a separate library row ──────────────────────────────
// Enforces the "no second catalog" invariant (§18, §22 non-goals).
func TestManufacturingLibrary_FreeIsNotSeparateLibraryRow(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	var platformLibCount int
	err := fx.admin.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM manufacturing_libraries
		WHERE owner_organization_id IS NULL
	`).Scan(&platformLibCount)
	if err != nil {
		t.Fatalf("count platform-global libraries: %v", err)
	}
	if platformLibCount != 1 {
		t.Fatalf("expected exactly 1 platform-global library (Standard), found %d", platformLibCount)
	}

	var freeOrZeroCodeCount int
	err = fx.admin.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM manufacturing_libraries
		WHERE code IN ('0000', 'free') OR kind = 'free'
	`).Scan(&freeOrZeroCodeCount)
	if err != nil {
		t.Fatalf("query for spurious free libraries: %v", err)
	}
	if freeOrZeroCodeCount != 0 {
		t.Fatalf("found %d spurious free library rows — Free must NOT be a separate library row", freeOrZeroCodeCount)
	}
}

// ─── Case 3: Draft release creation and unique version constraint ────────────
func TestManufacturingLibrary_DraftReleaseCreationAndUniqueVersion(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)

	// Create a new draft release with a distinct version
	v1Params := storage.CreateDraftReleaseParams{
		LibraryID:     standardID,
		Version:       "1.0.0-draft",
		SchemaVersion: 1,
	}
	rel1, err := adminStore.CreateDraftRelease(ctx, v1Params)
	if err != nil {
		t.Fatalf("create draft release v1: %v", err)
	}
	if rel1.Version != "1.0.0-draft" {
		t.Errorf("expected version '1.0.0-draft', got %q", rel1.Version)
	}
	if rel1.Status != domain.ReleaseStatusDraft {
		t.Errorf("expected status 'draft', got %q", rel1.Status)
	}

	// Create second draft with different version: should succeed
	v2Params := storage.CreateDraftReleaseParams{
		LibraryID:     standardID,
		Version:       "1.1.0-draft",
		SchemaVersion: 1,
	}
	rel2, err := adminStore.CreateDraftRelease(ctx, v2Params)
	if err != nil {
		t.Fatalf("create draft release v2: %v", err)
	}
	if rel2.Version != "1.1.0-draft" {
		t.Errorf("expected version '1.1.0-draft', got %q", rel2.Version)
	}

	// Attempt duplicate version for same library: must fail unique constraint
	_, err = adminStore.CreateDraftRelease(ctx, v1Params)
	if err == nil {
		t.Fatal("expected duplicate version to fail, but it succeeded")
	}
	if !errors.Is(err, storage.ErrReleaseDuplicateVersion) {
		t.Fatalf("expected ErrReleaseDuplicateVersion, got: %v", err)
	}
}

// ─── Case 4: Publish lifecycle ───────────────────────────────────────────────
func TestManufacturingLibrary_PublishLifecycle(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	userA := uuid.MustParse(rlsUserA)

	// Create draft release
	rel, err := adminStore.CreateDraftRelease(ctx, storage.CreateDraftReleaseParams{
		LibraryID:     standardID,
		Version:       "2.0.0-rc1",
		SchemaVersion: 1,
	})
	if err != nil {
		t.Fatalf("create draft release: %v", err)
	}

	// Attempting to publish without manifest_hash should fail with ErrReleaseManifestHashRequired
	err = adminStore.PublishRelease(ctx, rel.ID, "dummy-hash", userA)
	if !errors.Is(err, storage.ErrReleaseManifestHashRequired) {
		t.Fatalf("expected ErrReleaseManifestHashRequired when manifest_hash is not set, got: %v", err)
	}

	// Set manifest_hash on the release (as LIB-2 publisher would do)
	const manifestHash = "sha256-abcdef1234567890"
	_, err = fx.admin.Exec(ctx, `UPDATE library_releases SET manifest_hash = $2 WHERE id = $1`, rel.ID, manifestHash)
	if err != nil {
		t.Fatalf("set manifest_hash: %v", err)
	}

	// Now publish should succeed
	err = adminStore.PublishRelease(ctx, rel.ID, manifestHash, userA)
	if err != nil {
		t.Fatalf("publish release: %v", err)
	}

	// Verify published fields
	publishedRel, err := adminStore.GetReleaseByID(ctx, rel.ID)
	if err != nil {
		t.Fatalf("get published release: %v", err)
	}
	if publishedRel.Status != domain.ReleaseStatusPublished {
		t.Errorf("expected status 'published', got %q", publishedRel.Status)
	}
	if publishedRel.PublishedAt == nil {
		t.Error("expected published_at to be non-nil")
	}
	if publishedRel.PublishedBy == nil || *publishedRel.PublishedBy != userA {
		t.Errorf("expected published_by %s, got %v", userA, publishedRel.PublishedBy)
	}

	// Publishing an already published release must fail with ErrReleaseNotDraft
	err = adminStore.PublishRelease(ctx, rel.ID, manifestHash, userA)
	if !errors.Is(err, storage.ErrReleaseNotDraft) {
		t.Fatalf("expected ErrReleaseNotDraft on republish, got: %v", err)
	}
}

// ─── Case 5: Published release immutability ──────────────────────────────────
// AddResourceRef must reject attempts to add resources to a published release.
func TestManufacturingLibrary_PublishedReleaseImmutability(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	userA := uuid.MustParse(rlsUserA)

	// Create draft release
	rel, err := adminStore.CreateDraftRelease(ctx, storage.CreateDraftReleaseParams{
		LibraryID:     standardID,
		Version:       "3.0.0-draft",
		SchemaVersion: 1,
	})
	if err != nil {
		t.Fatalf("create draft release: %v", err)
	}

	// Add resource ref while still in draft: should succeed
	dummyResID := uuid.New()
	err = adminStore.AddResourceRef(ctx, storage.AddResourceRefParams{
		ReleaseID:        rel.ID,
		ResourceKind:     "furniture_definition",
		ResourceID:       dummyResID,
		ResourceRevision: "rev-001",
		PackageKind:      domain.PackageKindStandard,
	})
	if err != nil {
		t.Fatalf("add resource ref to draft: %v", err)
	}

	// Publish the release
	const hash = "sha256-hash300"
	_, err = fx.admin.Exec(ctx, `UPDATE library_releases SET manifest_hash = $2 WHERE id = $1`, rel.ID, hash)
	if err != nil {
		t.Fatalf("set manifest_hash: %v", err)
	}
	if err := adminStore.PublishRelease(ctx, rel.ID, hash, userA); err != nil {
		t.Fatalf("publish release: %v", err)
	}

	// Attempt to add a new resource ref to the published release: must fail
	err = adminStore.AddResourceRef(ctx, storage.AddResourceRefParams{
		ReleaseID:        rel.ID,
		ResourceKind:     "furniture_definition",
		ResourceID:       uuid.New(),
		ResourceRevision: "rev-002",
		PackageKind:      domain.PackageKindFree,
	})
	if err == nil {
		t.Fatal("expected AddResourceRef to published release to fail, but succeeded")
	}
	if !errors.Is(err, storage.ErrReleaseNotDraft) {
		t.Fatalf("expected ErrReleaseNotDraft, got: %v", err)
	}

	// Verify row count remains exactly 1
	var refCount int
	err = fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM library_release_resource_refs WHERE release_id = $1`, rel.ID).Scan(&refCount)
	if err != nil {
		t.Fatalf("count refs: %v", err)
	}
	if refCount != 1 {
		t.Fatalf("expected exactly 1 resource ref, got %d", refCount)
	}
}

// ─── Case 6: Withdraw lifecycle ──────────────────────────────────────────────
func TestManufacturingLibrary_WithdrawLifecycle(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	userA := uuid.MustParse(rlsUserA)

	rel, err := adminStore.CreateDraftRelease(ctx, storage.CreateDraftReleaseParams{
		LibraryID:     standardID,
		Version:       "4.0.0",
		SchemaVersion: 1,
	})
	if err != nil {
		t.Fatalf("create draft release: %v", err)
	}

	const hash = "sha256-hash400"
	_, _ = fx.admin.Exec(ctx, `UPDATE library_releases SET manifest_hash = $2 WHERE id = $1`, rel.ID, hash)
	if err := adminStore.PublishRelease(ctx, rel.ID, hash, userA); err != nil {
		t.Fatalf("publish release: %v", err)
	}

	// Verify GetCurrentPublishedRelease returns this release
	curr, err := adminStore.GetCurrentPublishedRelease(ctx, standardID)
	if err != nil {
		t.Fatalf("get current published release: %v", err)
	}
	if curr.ID != rel.ID {
		t.Fatalf("expected current release %s, got %s", rel.ID, curr.ID)
	}

	// Withdraw the release
	if err := adminStore.WithdrawRelease(ctx, rel.ID); err != nil {
		t.Fatalf("withdraw release: %v", err)
	}

	// Now GetCurrentPublishedRelease should return ErrLibraryReleaseNotFound
	_, err = adminStore.GetCurrentPublishedRelease(ctx, standardID)
	if !errors.Is(err, storage.ErrLibraryReleaseNotFound) {
		t.Fatalf("expected ErrLibraryReleaseNotFound after withdraw, got: %v", err)
	}

	// Historical rows still exist and are readable by exact ID
	withdrawn, err := adminStore.GetReleaseByID(ctx, rel.ID)
	if err != nil {
		t.Fatalf("get withdrawn release by ID: %v", err)
	}
	if withdrawn.Status != domain.ReleaseStatusWithdrawn {
		t.Errorf("expected status 'withdrawn', got %q", withdrawn.Status)
	}
}

// ─── Case 7: Legacy project pinning NULL ─────────────────────────────────────
// Migrated legacy rows in design_working_copies, design_revisions, production_releases
// must have effective_library_release_id = NULL (no fabricated provenance).
func TestManufacturingLibrary_LegacyProjectPinningNULL(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	// Check design_working_copies
	var nonNullWorkingCopies int
	err := fx.admin.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM design_working_copies
		WHERE effective_library_release_id IS NOT NULL
	`).Scan(&nonNullWorkingCopies)
	if err != nil {
		t.Fatalf("check design_working_copies: %v", err)
	}
	if nonNullWorkingCopies != 0 {
		t.Fatalf("found %d legacy design_working_copies with non-null effective_library_release_id", nonNullWorkingCopies)
	}

	// Check design_revisions
	var nonNullRevisions int
	err = fx.admin.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM design_revisions
		WHERE effective_library_release_id IS NOT NULL
	`).Scan(&nonNullRevisions)
	if err != nil {
		t.Fatalf("check design_revisions: %v", err)
	}
	if nonNullRevisions != 0 {
		t.Fatalf("found %d legacy design_revisions with non-null effective_library_release_id", nonNullRevisions)
	}

	// Check production_releases
	var nonNullProdReleases int
	err = fx.admin.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM production_releases
		WHERE effective_library_release_id IS NOT NULL
	`).Scan(&nonNullProdReleases)
	if err != nil {
		t.Fatalf("check production_releases: %v", err)
	}
	if nonNullProdReleases != 0 {
		t.Fatalf("found %d legacy production_releases with non-null effective_library_release_id", nonNullProdReleases)
	}
}

// ─── Case 8: RLS cross-org isolation ─────────────────────────────────────────
// Org A cannot read Org B's organization_overlay library drafts under runtime role.
func TestManufacturingLibrary_RLSCrossOrgIsolation(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	orgB := uuid.MustParse(rlsOrgB)

	// Create an organization overlay for Org B via admin pool
	overlayB_ID := uuid.New()
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	_, err := fx.admin.Exec(ctx, `
		INSERT INTO manufacturing_libraries
		    (id, code, kind, owner_organization_id, upstream_library_id, status)
		VALUES ($1, 'B-OVERLAY', 'organization_overlay', $2, $3, 'active')
	`, overlayB_ID, orgB, standardID)
	if err != nil {
		t.Fatalf("create Org B overlay: %v", err)
	}

	// Create a draft release for Org B's overlay
	draftB_ID := uuid.New()
	_, err = fx.admin.Exec(ctx, `
		INSERT INTO library_releases (id, library_id, version, status, schema_version)
		VALUES ($1, $2, '0.1.0-b', 'draft', 1)
	`, draftB_ID, overlayB_ID)
	if err != nil {
		t.Fatalf("create Org B draft release: %v", err)
	}

	// Run as Org A under granete_app role
	withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		// Org A attempting to SELECT Org B's overlay: must return 0 rows
		var count int
		err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM manufacturing_libraries WHERE id = $1
		`, overlayB_ID).Scan(&count)
		if err != nil {
			t.Fatalf("query overlay as Org A: %v", err)
		}
		if count != 0 {
			t.Fatalf("RLS breach: Org A saw Org B's overlay library (%d rows)", count)
		}

		// Org A attempting to SELECT Org B's draft release: must return 0 rows
		err = tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM library_releases WHERE id = $1
		`, draftB_ID).Scan(&count)
		if err != nil {
			t.Fatalf("query draft release as Org A: %v", err)
		}
		if count != 0 {
			t.Fatalf("RLS breach: Org A saw Org B's draft release (%d rows)", count)
		}
	})

	// Verify Org B CAN see its own overlay and draft
	withRLSActor(t, fx.app, rlsOrgB, rlsUserB, func(tx pgx.Tx) {
		var count int
		err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM manufacturing_libraries WHERE id = $1
		`, overlayB_ID).Scan(&count)
		if err != nil {
			t.Fatalf("query overlay as Org B: %v", err)
		}
		if count != 1 {
			t.Fatalf("Org B should see its own overlay library, got %d", count)
		}

		err = tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM library_releases WHERE id = $1
		`, draftB_ID).Scan(&count)
		if err != nil {
			t.Fatalf("query draft as Org B: %v", err)
		}
		if count != 1 {
			t.Fatalf("Org B should see its own draft release, got %d", count)
		}
	})
}

// ─── Case 9: RLS Standard readable by all authenticated orgs ─────────────────
func TestManufacturingLibrary_RLSStandardReadable(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)

	// Publish a release on Standard via admin
	pubRelID := uuid.New()
	_, err := fx.admin.Exec(ctx, `
		INSERT INTO library_releases (id, library_id, version, status, schema_version, manifest_hash, published_at)
		VALUES ($1, $2, '1.0.0-std', 'published', 1, 'hash-std', NOW())
	`, pubRelID, standardID)
	if err != nil {
		t.Fatalf("insert published release: %v", err)
	}

	// Add resource refs to the published release
	refID := uuid.New()
	_, err = fx.admin.Exec(ctx, `
		INSERT INTO library_release_resource_refs (id, release_id, resource_kind, resource_id, resource_revision, package_kind)
		VALUES ($1, $2, 'furniture_definition', $3, 'rev-std-1', 'standard')
	`, refID, pubRelID, uuid.New())
	if err != nil {
		t.Fatalf("insert resource ref: %v", err)
	}

	// Both Org A and Org B must be able to read Standard library and the published release
	for _, tc := range []struct {
		orgID, userID string
	}{
		{rlsOrgA, rlsUserA},
		{rlsOrgB, rlsUserB},
	} {
		t.Run("Org "+tc.orgID, func(t *testing.T) {
			withRLSActor(t, fx.app, tc.orgID, tc.userID, func(tx pgx.Tx) {
				var libCount int
				err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM manufacturing_libraries WHERE id = $1`, standardID).Scan(&libCount)
				if err != nil {
					t.Fatalf("read standard library: %v", err)
				}
				if libCount != 1 {
					t.Fatalf("expected Standard library readable, got %d", libCount)
				}

				var relCount int
				err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM library_releases WHERE id = $1`, pubRelID).Scan(&relCount)
				if err != nil {
					t.Fatalf("read published release: %v", err)
				}
				if relCount != 1 {
					t.Fatalf("expected published release readable, got %d", relCount)
				}

				var refCount int
				err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM library_release_resource_refs WHERE id = $1`, refID).Scan(&refCount)
				if err != nil {
					t.Fatalf("read resource ref: %v", err)
				}
				if refCount != 1 {
					t.Fatalf("expected resource ref readable, got %d", refCount)
				}
			})
		})
	}
}

// ─── Case 10: Negative proof — LibraryCode is not authorization ──────────────
// Validates that no storage query branches on WHERE code = $1 or uses library
// code for access control.
func TestManufacturingLibrary_NegativeProof_LibraryCodeNotAuth(t *testing.T) {
	candidates := []string{
		"manufacturing_library.go",
		"internal/storage/manufacturing_library.go",
		"backend-go/internal/storage/manufacturing_library.go",
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
		t.Fatalf("could not read manufacturing_library.go: %v", err)
	}

	src := string(content)

	// Must NOT contain WHERE code = or WHERE ml.code =
	forbiddenPatterns := []string{
		"WHERE code =",
		"WHERE ml.code =",
		"WHERE code=",
		"WHERE ml.code=",
		"code == \"0001\"",
		"code == \"0000\"",
	}

	for _, pattern := range forbiddenPatterns {
		if strings.Contains(src, pattern) {
			t.Fatalf("VIOLATION of #772 acceptance: found forbidden authorization pattern %q in manufacturing_library.go", pattern)
		}
	}
}

// ─── Case 11: DesignRevision pinning & pin immutability ──────────────────────
// Verifies that publishing a design revision records effective_library_release_id,
// and that publishing subsequent library releases does NOT alter the historical pin.
func TestManufacturingLibrary_DesignRevisionPinningImmutability(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	orgA := uuid.MustParse(rlsOrgA)
	userA := uuid.MustParse(rlsUserA)

	// 1. Create and publish library release v1
	rel1ID := uuid.New()
	_, err := fx.admin.Exec(ctx, `
		INSERT INTO library_releases (id, library_id, version, status, schema_version, manifest_hash, published_at, created_at)
		VALUES ($1, $2, '1.0.0', 'published', 1, 'hash-v1', NOW(), NOW())
	`, rel1ID, standardID)
	if err != nil {
		t.Fatalf("publish library v1: %v", err)
	}

	// 2. Publish a design revision for project in Org A
	designID := uuid.New().String()
	projectID := "40000000-0000-0000-0000-000000000001" // project in rlsOrgA from fixture
	_, err = fx.admin.Exec(ctx, `
		INSERT INTO designs (id, organization_id, project_id, name)
		VALUES ($1, $2, $3, 'Pinning Test Design')
	`, designID, rlsOrgA, projectID)
	if err != nil {
		t.Fatalf("insert design: %v", err)
	}

	// Publish the revision via storage layer inside Org A's tenant transaction
	pubCmd := storage.PublishDesignRevisionCommand{
		DesignID:    designID,
		SourceType:  domain.DesignRevisionSourceManual,
		ActorUserID: userA.String(),
	}
	var rev *domain.DesignRevision
	err = fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var pErr error
		rev, pErr = fx.store.PublishDesignRevision(txCtx, pubCmd)
		return pErr
	})
	if err != nil {
		t.Fatalf("publish design revision: %v", err)
	}

	// Verify the design revision was pinned to rel1ID
	if rev.EffectiveLibraryReleaseID == nil {
		t.Fatal("expected EffectiveLibraryReleaseID to be pinned, got nil")
	}
	if *rev.EffectiveLibraryReleaseID != rel1ID {
		t.Fatalf("expected pinned release %s, got %s", rel1ID, *rev.EffectiveLibraryReleaseID)
	}

	// 3. Publish a subsequent library release v2 (newer)
	rel2ID := uuid.New()
	_, err = fx.admin.Exec(ctx, `
		INSERT INTO library_releases (id, library_id, version, status, schema_version, manifest_hash, published_at, created_at)
		VALUES ($1, $2, '2.0.0', 'published', 1, 'hash-v2', NOW(), NOW() + interval '1 hour')
	`, rel2ID, standardID)
	if err != nil {
		t.Fatalf("publish library v2: %v", err)
	}

	// 4. Verify GetEffectiveReleaseForOrg now returns v2
	eff, err := fx.store.GetEffectiveReleaseForOrg(ctx, orgA)
	if err != nil {
		t.Fatalf("get effective release: %v", err)
	}
	if eff.ID != rel2ID {
		t.Fatalf("expected effective release to advance to %s, got %s", rel2ID, eff.ID)
	}

	// 5. IMMUTABILITY CHECK: Read back the historical design revision
	var historicalRev *domain.DesignRevision
	err = fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var gErr error
		historicalRev, gErr = fx.store.GetDesignRevision(txCtx, designID, rev.ID)
		return gErr
	})
	if err != nil {
		t.Fatalf("get historical design revision: %v", err)
	}
	if historicalRev.EffectiveLibraryReleaseID == nil {
		t.Fatal("historical revision lost its library pin")
	}
	if *historicalRev.EffectiveLibraryReleaseID != rel1ID {
		t.Fatalf("IMMUTABILITY BREACH: historical revision pinned release retargeted from %s to %s",
			rel1ID, *historicalRev.EffectiveLibraryReleaseID)
	}

	// 6. DB TRIGGER CHECK: Attempting direct UPDATE on effective_library_release_id must fail
	_, err = fx.admin.Exec(ctx, `
		UPDATE design_revisions
		SET effective_library_release_id = $2
		WHERE id = $1
	`, rev.ID, rel2ID)
	if err == nil {
		t.Fatal("expected direct UPDATE on effective_library_release_id to fail via immutability trigger, but succeeded")
	}
	if !strings.Contains(err.Error(), "design_revisions is immutable") && !strings.Contains(err.Error(), "immutable") {
		t.Fatalf("expected immutability trigger error, got: %v", err)
	}
}
