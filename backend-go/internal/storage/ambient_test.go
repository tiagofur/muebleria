package storage_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/db"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// These are integration tests against an isolated test Postgres (DATABASE_URL).
// They skip gracefully when DATABASE_URL is not set.

const (
	connectStoreFixtureUser       = "93000000-0000-0000-0000-000000000001"
	connectStoreFixtureMembership = "94000000-0000-0000-0000-000000000001"
)

var connectStoreInitialActor = storage.TenantActor{
	OrganizationID: storage.InitialOrganizationID,
	UserID:         connectStoreFixtureUser,
	MembershipID:   connectStoreFixtureMembership,
}

// connectStore opens only the unprivileged runtime pool. It must never perform
// schema setup, DDL, grants, or administrative seeding.
func connectStore(t *testing.T) (*storage.PostgresStore, *pgxpool.Pool) {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), storage.TestDatabaseURL(t))
	if err != nil {
		t.Skipf("no runtime db: %v", err)
	}
	t.Cleanup(pool.Close)
	return &storage.PostgresStore{Pool: pool}, pool
}

func migrationConnectStore(t *testing.T) (*storage.PostgresStore, *pgxpool.Pool) {
	t.Helper()
	migrationStore, err := storage.NewPostgresStore(storage.TestMigrationDatabaseURLForRuntimeDatabase(t))
	if err != nil {
		t.Skipf("no migration db: %v", err)
	}
	t.Cleanup(migrationStore.Close)
	return migrationStore, migrationStore.Pool
}

// migratedConnectStore prepares the disposable runtime database with migration
// authority, seeds the explicit active fixture actor, then opens connectStore.
func migratedConnectStore(t *testing.T) (*storage.PostgresStore, *pgxpool.Pool) {
	t.Helper()
	migrationStore, _ := migrationConnectStore(t)
	if err := migrationStore.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	seedTx, err := migrationStore.Pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin fixture identity seed: %v", err)
	}
	defer seedTx.Rollback(context.Background())
	if _, err := seedTx.Exec(context.Background(), `
		INSERT INTO users (id, email, password_hash, name, account_status, normalized_email)
		VALUES ($1, 'connect-store-fixture@example.test', 'x', 'Connect store fixture', 'active', 'connect-store-fixture@example.test')
		ON CONFLICT (id) DO NOTHING`, connectStoreFixtureUser); err != nil {
		t.Fatalf("seed fixture user: %v", err)
	}
	if _, err := seedTx.Exec(context.Background(), `
		INSERT INTO memberships (id, organization_id, user_id, roles)
		VALUES ($1, $2, $3, ARRAY['admin']::text[])
		ON CONFLICT (user_id, organization_id) DO NOTHING`,
		connectStoreFixtureMembership, storage.InitialOrganizationID, connectStoreFixtureUser); err != nil {
		t.Fatalf("seed fixture membership: %v", err)
	}
	if _, err := seedTx.Exec(context.Background(), `
		UPDATE organizations SET status='active', status_reason=NULL WHERE id=$1`, storage.InitialOrganizationID); err != nil {
		t.Fatalf("activate fixture organization: %v", err)
	}
	if err := seedTx.Commit(context.Background()); err != nil {
		t.Fatalf("commit fixture identity seed: %v", err)
	}
	return connectStore(t)
}

func withinConnectStoreTenant(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, run func(context.Context) error) {
	t.Helper()
	ctx := storage.WithOrgCtx(context.Background(), actor.OrganizationID)
	if err := store.WithinTenantTx(ctx, actor, run); err != nil {
		t.Fatal(err)
	}
}

func withinConnectStoreTenantValue[T any](t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, run func(context.Context) (T, error)) T {
	t.Helper()
	var value T
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		var err error
		value, err = run(txCtx)
		return err
	})
	return value
}

func cleanupConnectStoreFixture(t *testing.T, query string, args ...any) {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), storage.TestMigrationDatabaseURLForRuntimeDatabase(t))
	if err != nil {
		t.Errorf("open migration cleanup pool: %v", err)
		return
	}
	defer pool.Close()
	if _, err := pool.Exec(context.Background(), query, args...); err != nil {
		t.Errorf("fixture cleanup: %v", err)
	}
}

// uniqueID mints a test-only id/code suffix so parallel/ repeatable runs never
// collide on the UNIQUE(code) constraint.
func uniqueID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
}

func fptr(v float64) *float64 { return &v }

// Server-start path applies the new migration; applying the embedded SQL a
// second time directly must be safe (IF NOT EXISTS guards) — spec #4150.
func TestAmbientMaterials_MigrationIsAdditiveAndReRunSafe(t *testing.T) {
	store, pool := migrationConnectStore(t)
	ctx := context.Background()

	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'ambient_materials'`,
	).Scan(&n); err != nil {
		t.Fatalf("query information_schema: %v", err)
	}
	if n != 1 {
		t.Fatalf("ambient_materials table missing (count=%d)", n)
	}

	migs, err := db.EmbeddedMigrations()
	if err != nil {
		t.Fatalf("embedded migrations: %v", err)
	}
	var ambientSQL string
	for _, m := range migs {
		if m.Name == "ambient_materials" {
			ambientSQL = m.SQL
			break
		}
	}
	if ambientSQL == "" {
		t.Fatal("ambient_materials migration not embedded")
	}
	// Re-applying the exact shipped SQL must not error.
	if _, err := pool.Exec(ctx, ambientSQL); err != nil {
		t.Fatalf("re-running migration SQL must be safe (IF NOT EXISTS): %v", err)
	}
}

func TestAmbientMaterials_CRUDRoundTrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	id := uniqueID("amb-crud")
	code := uniqueID("FLR")
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM ambient_materials WHERE id = $1`, id) })

	in := &domain.AmbientMaterial{ID: id, Code: code, Name: "Roble", Active: true, SurfaceType: domain.AmbientSurfaceFloor, PreviewColor: "#8b5a2b", PreviewTextureURL: "/api/media/oak.webp"}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateAmbientMaterial(txCtx, in) })

	var got *domain.AmbientMaterial
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		var err error
		got, err = store.GetAmbientMaterialByID(txCtx, id)
		return err
	})
	if got.Code != code || got.Name != "Roble" || got.SurfaceType != domain.AmbientSurfaceFloor || got.PreviewColor != "#8b5a2b" || got.PreviewTextureURL != "/api/media/oak.webp" || !got.Active {
		t.Fatalf("get round-trip mismatch: %#v", got)
	}

	var list []domain.AmbientMaterial
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		var err error
		list, err = store.ListAmbientMaterials(txCtx)
		return err
	})
	if !containsID(list, id) {
		t.Fatalf("list does not contain created row")
	}

	upd := *got
	upd.Name = "Roble Premium"
	upd.PreviewTextureURL = ""
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateAmbientMaterial(txCtx, id, &upd) })
	var again *domain.AmbientMaterial
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		var err error
		again, err = store.GetAmbientMaterialByID(txCtx, id)
		return err
	})
	if again.Name != "Roble Premium" || again.PreviewTextureURL != "" {
		t.Fatalf("update not persisted: %#v", again)
	}

	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.DeactivateAmbientMaterial(txCtx, id) })
	var deact *domain.AmbientMaterial
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		var err error
		deact, err = store.GetAmbientMaterialByID(txCtx, id)
		return err
	})
	if deact.Active {
		t.Error("expected Active=false after deactivate")
	}
}

func TestAmbientMaterials_NullablePBR_NullVsZero(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	id := uniqueID("amb-pbr")
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM ambient_materials WHERE id = $1`, id) })
	in := &domain.AmbientMaterial{ID: id, Code: uniqueID("PBR"), Name: "PBR", Active: true, SurfaceType: domain.AmbientSurfaceFloor, PreviewMetalness: fptr(0.5)}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateAmbientMaterial(txCtx, in) })
	var got *domain.AmbientMaterial
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		var err error
		got, err = store.GetAmbientMaterialByID(txCtx, id)
		return err
	})
	if got.PreviewRoughness != nil {
		t.Fatalf("unset roughness must stay nil, got %v", *got.PreviewRoughness)
	}
	if got.PreviewMetalness == nil || *got.PreviewMetalness != 0.5 {
		t.Fatalf("metalness=0.5 not preserved: %#v", got.PreviewMetalness)
	}
	upd := *got
	upd.PreviewRoughness = fptr(0)
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateAmbientMaterial(txCtx, id, &upd) })
	var zero *domain.AmbientMaterial
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		var err error
		zero, err = store.GetAmbientMaterialByID(txCtx, id)
		return err
	})
	if zero.PreviewRoughness == nil || *zero.PreviewRoughness != 0 {
		t.Fatalf("roughness = %v, want non-nil 0", zero.PreviewRoughness)
	}
}

func TestAmbientMaterials_UniqueCodeConstraint(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	code := uniqueID("UNIQ")
	id1 := uniqueID("amb-uniq-1")
	id2 := uniqueID("amb-uniq-2")
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM ambient_materials WHERE id IN ($1, $2)`, id1, id2) })
	mk := func(id string) *domain.AmbientMaterial {
		return &domain.AmbientMaterial{ID: id, Code: code, Name: "Dup", Active: true, SurfaceType: domain.AmbientSurfaceWall}
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateAmbientMaterial(txCtx, mk(id1)) })
	duplicateErr := store.WithinTenantTx(
		storage.WithOrgCtx(context.Background(), actor.OrganizationID),
		actor,
		func(txCtx context.Context) error { return store.CreateAmbientMaterial(txCtx, mk(id2)) },
	)
	if duplicateErr == nil {
		t.Fatal("expected duplicate-key error on repeated code, got nil")
	}
	if !strings.Contains(duplicateErr.Error(), "duplicate key") && !strings.Contains(duplicateErr.Error(), "unique constraint") {
		t.Fatalf("error must mention duplicate/unique constraint, got: %v", duplicateErr)
	}
}

func containsID(list []domain.AmbientMaterial, id string) bool {
	for _, m := range list {
		if m.ID == id {
			return true
		}
	}
	return false
}
