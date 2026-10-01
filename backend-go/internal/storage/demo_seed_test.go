package storage_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #955 acceptance, against a real disposable PostgreSQL: the demo seed
// publishes the seeded Standard draft release through the REAL compiler —
// real manifest hash, real content-addressed blobs, hardware_profile
// resource present — and the pinned read resolves the demo profile with
// its recipe. The resolve consumption of exactly this shape is proven by
// golden 29; this test proves the SEED produces that shape from a fresh
// database, idempotently.
func TestDemoSeedPublishesStandardRelease(t *testing.T) {
	migrationPool := multiOrgFreshMigrationDB(t)
	store := &storage.PostgresStore{Pool: migrationPool}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}

	if err := application.SeedDemoStandardRelease(ctx, store); err != nil {
		t.Fatalf("demo seed: %v", err)
	}

	// The seeded draft release is now published with a REAL manifest.
	release, err := store.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		t.Fatalf("current published release: %v", err)
	}
	if release.ID.String() != domain.GraneteStandardDraftReleaseID {
		t.Fatalf("published release = %s, want the seeded draft", release.ID)
	}
	if release.ManifestHash == nil || *release.ManifestHash == "" ||
		*release.ManifestHash == "sha256:0000000000000000000000000000000000000000000000000000000000000001" {
		t.Fatalf("manifest hash is missing or the placeholder: %v", release.ManifestHash)
	}

	// The pinned read resolves the demo profile with its recipe body.
	profiles, err := application.HardwareProfilesForRelease(ctx, store, release.ID)
	if err != nil {
		t.Fatalf("pinned profiles: %v", err)
	}
	var demo *domain.HardwareProfile
	for i := range profiles {
		if profiles[i].ID == application.SeedDemoProfileID {
			demo = &profiles[i]
		}
	}
	if demo == nil {
		t.Fatalf("demo profile not pinned in the release: %d profiles", len(profiles))
	}
	if demo.Recipe == nil || len(demo.Recipe.Variants) != 2 ||
		demo.Recipe.Variants[0].TargetFace != "front" || demo.Recipe.Variants[1].TargetFace != "back" {
		t.Fatalf("demo recipe body missing or wrong variants: %+v", demo.Recipe)
	}
	if demo.Items[0].HardwareID != "a0000003-0000-0000-0000-000000000012" {
		t.Fatalf("demo items = %+v", demo.Items)
	}

	// Idempotency: a second run must not recompile or fail.
	if err := application.SeedDemoStandardRelease(ctx, store); err != nil {
		t.Fatalf("demo seed second run: %v", err)
	}
	again, err := store.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil || again.ID != release.ID {
		t.Fatalf("second run changed the published release: %+v err=%v", again, err)
	}
}
