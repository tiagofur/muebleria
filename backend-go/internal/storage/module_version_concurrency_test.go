package storage_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/db"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #497 T2: catalog modules carry a server-owned optimistic-concurrency
// version. Every accepted update bumps it inside the update transaction; a
// stale expected version fails closed without touching the row.
func TestModuleVersionConcurrency(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	mod := &domain.Module{Code: uniqueID("MOD-VER"), Name: "Mueble versionado", WidthMm: 600, HeightMm: 720, DepthMm: 590}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateModule(txCtx, mod) })
	modID := mod.ID
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM modules WHERE id = $1`, modID) })

	if mod.Version != 1 {
		t.Fatalf("created module version = %d, want 1", mod.Version)
	}
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Module, error) { return store.GetModuleByID(txCtx, modID) })
	if got.Version != 1 {
		t.Fatalf("readback version = %d, want 1", got.Version)
	}

	// Accepted update: expected 1 → stored 2, payload persisted.
	got.Name = "Mueble versionado v2"
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateModule(txCtx, modID, 1, got)
	})
	if got.Version != 2 {
		t.Fatalf("updated module version = %d, want 2", got.Version)
	}
	after := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Module, error) { return store.GetModuleByID(txCtx, modID) })
	if after.Version != 2 || after.Name != "Mueble versionado v2" {
		t.Fatalf("post-update readback version=%d name=%q", after.Version, after.Name)
	}

	// Stale expected version: typed conflict, row untouched.
	stale := *after
	stale.Name = "Escritura vieja"
	err := tenantModuleUpdate(t, store, actor, modID, 1, &stale)
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale update err = %v, want ErrVersionConflict", err)
	}
	unchanged := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Module, error) { return store.GetModuleByID(txCtx, modID) })
	if unchanged.Version != 2 || unchanged.Name != "Mueble versionado v2" {
		t.Fatalf("rejected stale write mutated the row: version=%d name=%q", unchanged.Version, unchanged.Name)
	}

	// Version-less expectations fail closed before touching the row.
	err = tenantModuleUpdate(t, store, actor, modID, 0, &stale)
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("version-less update err = %v, want ErrVersionConflict", err)
	}

	// Unknown id stays a not-found, not a conflict.
	unknown := "f4970000-0000-0000-0000-000000000001"
	err = tenantModuleUpdate(t, store, actor, unknown, 1, &stale)
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("unknown-id update err = %v, want not found", err)
	}
}

// tenantModuleUpdate runs UpdateModule inside a tenant transaction and returns
// its error so tests can assert typed failures (withinConnectStoreTenant would
// fail the test on the first error instead).
func tenantModuleUpdate(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, id string, expectedVersion int64, m *domain.Module) error {
	t.Helper()
	ctx := storage.WithOrgCtx(context.Background(), actor.OrganizationID)
	return store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		return store.UpdateModule(txCtx, id, expectedVersion, m)
	})
}

func TestModulesVersionMigrationFreshAndUpgrade(t *testing.T) {
	t.Run("fresh schema defaults every module to version 1", func(t *testing.T) {
		pool := multiOrgFreshMigrationDB(t)
		identityApplyThrough(t, pool, 142)

		var columnDefault string
		var nullable string
		err := pool.QueryRow(context.Background(), `
			SELECT column_default, is_nullable
			FROM information_schema.columns
			WHERE table_name = 'modules' AND column_name = 'version'
		`).Scan(&columnDefault, &nullable)
		if err != nil {
			t.Fatalf("version column: %v", err)
		}
		if columnDefault != "1" || nullable != "NO" {
			t.Fatalf("version column default=%q nullable=%q", columnDefault, nullable)
		}
		if _, err := pool.Exec(context.Background(), `UPDATE modules SET version = 0 WHERE false`); err != nil {
			t.Fatalf("version column missing: %v", err)
		}
	})

	t.Run("upgrade gives a pre-existing legacy module version 1", func(t *testing.T) {
		pool := multiOrgFreshMigrationDB(t)
		identityApplyThrough(t, pool, 141)
		ctx := context.Background()
		const moduleID = "f4970000-0000-0000-0000-000000000002"
		if _, err := pool.Exec(ctx, `
			INSERT INTO modules (id, organization_id, code, name, width_mm, height_mm, depth_mm)
			VALUES ($1, $2, 'LEGACY-497', 'Legacy pre-version module', 600, 720, 590)
		`, moduleID, multiOrgInitialOrgID); err != nil {
			t.Fatalf("seed legacy module: %v", err)
		}

		if err := applyEmbeddedMigration(t, pool, ctx, 142); err != nil {
			t.Fatalf("apply migration 142: %v", err)
		}

		var version int64
		if err := pool.QueryRow(ctx, `SELECT version FROM modules WHERE id = $1`, moduleID).Scan(&version); err != nil {
			t.Fatalf("read upgraded module: %v", err)
		}
		if version != 1 {
			t.Fatalf("upgraded legacy module version = %d, want 1", version)
		}
	})
}

// applyEmbeddedMigration applies exactly one embedded migration by version —
// the upgrade-path companion of identityApplyThrough.
func applyEmbeddedMigration(t *testing.T, pool *pgxpool.Pool, ctx context.Context, version int) error {
	t.Helper()
	migrations, err := db.EmbeddedMigrations()
	if err != nil {
		return err
	}
	for _, migration := range migrations {
		if migration.Version == version {
			_, err := pool.Exec(ctx, migration.SQL)
			return err
		}
	}
	return fmt.Errorf("migration %d not found", version)
}
