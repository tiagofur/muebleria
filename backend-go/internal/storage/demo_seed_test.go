package storage_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

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

	publisher, err := store.EnsureSeedPlatformUser(ctx)
	if err != nil {
		t.Fatalf("demo publisher: %v", err)
	}
	if err := application.SeedDemoStandardRelease(ctx, store, publisher); err != nil {
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
	if err := application.SeedDemoStandardRelease(ctx, store, publisher); err != nil {
		t.Fatalf("demo seed second run: %v", err)
	}
	again, err := store.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil || again.ID != release.ID {
		t.Fatalf("second run changed the published release: %+v err=%v", again, err)
	}
}

// The browser gate's global setup flips the seeded release to published
// with the placeholder hash BEFORE any spec (and thus before the demo seed)
// runs: the seed must detect that artificial state and replace it with a
// real publication.
func TestDemoSeedReplacesGatePlaceholderPublication(t *testing.T) {
	migrationPool := multiOrgFreshMigrationDB(t)
	store := &storage.PostgresStore{Pool: migrationPool}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}
	const gatePlaceholder = "sha256:0000000000000000000000000000000000000000000000000000000000000001"
	if _, err := migrationPool.Exec(ctx, `
		UPDATE library_releases
		SET status = 'published', manifest_hash = COALESCE(manifest_hash, $2),
		    published_at = COALESCE(published_at, NOW()), updated_at = NOW()
		WHERE id = $1
	`, domain.GraneteStandardDraftReleaseID, gatePlaceholder); err != nil {
		t.Fatalf("gate flip simulation: %v", err)
	}

	publisher, err := store.EnsureSeedPlatformUser(ctx)
	if err != nil {
		t.Fatalf("demo publisher: %v", err)
	}
	if err := application.SeedDemoStandardRelease(ctx, store, publisher); err != nil {
		t.Fatalf("demo seed over gate flip: %v", err)
	}
	release, err := store.GetCurrentPublishedRelease(ctx, publisherUUID(t))
	if err != nil {
		t.Fatalf("current published: %v", err)
	}
	if release.ManifestHash == nil || *release.ManifestHash == gatePlaceholder {
		t.Fatalf("manifest hash still the placeholder: %v", release.ManifestHash)
	}
}

func publisherUUID(t *testing.T) uuid.UUID {
	t.Helper()
	return uuid.MustParse(domain.GraneteStandardLibraryID)
}

// Reproduces the server context exactly: granete_app runtime pool, tenant
// transaction with the platform marker, the gate's placeholder flip — the
// demo seed must publish through it.
func TestDemoSeedUnderRuntimeRoleWithPlatformMarker(t *testing.T) {
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	migrationStore, _ := migrationConnectStore(t)
	if err := migrationStore.RunMigrations(ctx); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	if _, err := migrationStore.EnsureSeedPlatformUser(ctx); err != nil {
		t.Fatalf("platform user: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), storage.TestDatabaseURL(t))
	if err != nil {
		t.Skipf("no runtime db: %v", err)
	}
	t.Cleanup(pool.Close)
	const gatePlaceholder = "sha256:0000000000000000000000000000000000000000000000000000000000000001"
	if _, err := migrationStore.Pool.Exec(ctx, `
		UPDATE library_releases
		SET status = 'published', manifest_hash = COALESCE(manifest_hash, $2),
		    published_at = COALESCE(published_at, NOW()), updated_at = NOW()
		WHERE id = $1
	`, domain.GraneteStandardDraftReleaseID, gatePlaceholder); err != nil {
		t.Fatalf("gate flip: %v", err)
	}

	// The server context: the auth middleware builds the actor WITH the
	// platform marker; runInTenantTx must preserve it across the per-call
	// tenant transactions the demo seed opens.
	store := &storage.PostgresStore{Pool: pool}
	actor := storage.TenantActor{
		OrganizationID: storage.InitialOrganizationID,
		UserID:         "00000000-0000-0000-0000-0000000000fe",
		PlatformAdmin:  true,
	}
	if err := store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		return application.SeedDemoStandardRelease(txCtx, store, "00000000-0000-0000-0000-0000000000fe")
	}); err != nil {
		t.Fatalf("demo seed under runtime role: %v", err)
	}
	release, err := migrationStore.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		t.Fatalf("current: %v", err)
	}
	if release.ManifestHash == nil || *release.ManifestHash == gatePlaceholder {
		t.Fatalf("hash still placeholder: %v", release.ManifestHash)
	}

	// The resolve reads the pinned profiles as a PLAIN tenant actor, with no
	// platform marker: blob visibility is granted solely through
	// library_resource_blobs_read (refs → release → library). This is the
	// proof the publication materialized the manifest's resource refs — a
	// publish that only updated existing refs would publish a manifest whose
	// blobs no tenant can ever read (#955).
	tenantActor := storage.TenantActor{
		OrganizationID: storage.InitialOrganizationID,
		UserID:         "00000000-0000-0000-0000-0000000000fe",
	}
	var pinned []domain.HardwareProfile
	if err := store.WithinTenantTx(ctx, tenantActor, func(txCtx context.Context) error {
		var readErr error
		pinned, readErr = application.HardwareProfilesForRelease(txCtx, store, release.ID)
		return readErr
	}); err != nil {
		t.Fatalf("pinned profile read as plain tenant: %v", err)
	}
	var demo *domain.HardwareProfile
	for i := range pinned {
		if pinned[i].ID == application.SeedDemoProfileID {
			demo = &pinned[i]
		}
	}
	if demo == nil || demo.Recipe == nil || len(demo.Recipe.Variants) != 2 {
		t.Fatalf("demo profile not readable as tenant: %d pinned, demo=%v", len(pinned), demo)
	}
}
