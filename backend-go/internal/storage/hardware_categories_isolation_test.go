package storage_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1556 — hardware_categories (#1507) owes the new-table invariants the
// merge skipped: multi-organization RLS isolation under the runtime role,
// and the up/down replay of 000177. (Concurrency: see
// hardware_categories_concurrency_test.go.)

func TestHardwareCategories_RLSIsolationTwoOrgs_1556(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store

	// Each org creates its own category tree with the same shape.
	const nameA = "Bisagras A"
	const nameB = "Bisagras B"
	var idA, idB string
	if err := isolationRuntimeError(fixture, fixture.actorA, func(ctx context.Context) error {
		a := &domain.HardwareCategory{Name: nameA, SortOrder: 1}
		createErr := store.CreateHardwareCategory(ctx, a)
		idA = a.ID
		return createErr
	}); err != nil {
		t.Fatal(err)
	}
	if err := isolationRuntimeError(fixture, fixture.actorB, func(ctx context.Context) error {
		b := &domain.HardwareCategory{Name: nameB, SortOrder: 1}
		createErr := store.CreateHardwareCategory(ctx, b)
		idB = b.ID
		return createErr
	}); err != nil {
		t.Fatal(err)
	}

	// Lists only see their own tree.
	listA := isolationRuntimeValue(t, fixture, fixture.actorA, func(ctx context.Context) ([]domain.HardwareCategory, error) {
		return store.ListHardwareCategories(ctx)
	})
	listB := isolationRuntimeValue(t, fixture, fixture.actorB, func(ctx context.Context) ([]domain.HardwareCategory, error) {
		return store.ListHardwareCategories(ctx)
	})
	if len(listA) != 1 || listA[0].ID != idA {
		t.Fatalf("org A list = %+v, want only its own node", listA)
	}
	if len(listB) != 1 || listB[0].ID != idB {
		t.Fatalf("org B list = %+v, want only its own node", listB)
	}

	// A foreign id reads as not-found — never as a distinct code that would
	// confirm existence (ADR-0004: tenant_id is not authorization).
	crossErr := isolationRuntimeError(fixture, fixture.actorB, func(ctx context.Context) error {
		_, err := store.GetHardwareCategoryByID(ctx, idA)
		return err
	})
	if !errors.Is(crossErr, storage.ErrHardwareCategoryNotFound) {
		t.Fatalf("org B reading org A's category err = %v, want ErrHardwareCategoryNotFound", crossErr)
	}

	// And the org-scoped lookup is exactly what the hardware category-link
	// validation runs before any write. This probe pins WHY that pre-check
	// is REQUIRED, not optional: the FK cannot protect this path (referential
	// integrity bypasses RLS), so at STORAGE level a cross-tenant category_id
	// still LANDS — only the admin role can see it, no tenant scope can (the
	// link is invisible to org A and org B alike). The handler-level E2E in
	// the api package asserts the 422 that blocks it.
	hw := &domain.Hardware{
		ID: "c9000000-0000-0000-0000-00000000000a", Code: "HW-1556-A", Name: "Herraje A",
		Unit: "piece", CostPerUnit: 1, Active: true, CategoryID: idA,
	}
	if err := isolationRuntimeError(fixture, fixture.actorB, func(ctx context.Context) error {
		return store.CreateHardware(ctx, hw)
	}); err != nil {
		t.Fatalf("storage-level cross-org category write err = %v (the gap this test pins changed — update the handler E2E)", err)
	}
}

func TestHardwareCategories_MigrationUpDownReplay_1556(t *testing.T) {
	ctx := context.Background()
	pool := multiOrgFreshMigrationDB(t)
	migrationStore := &storage.PostgresStore{Pool: pool}
	if err := migrationStore.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	downSQL, err := os.ReadFile("../../db/migration/000177_hardware_categories.down.sql")
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	if _, err := pool.Exec(ctx, string(downSQL)); err != nil {
		t.Fatalf("execute down migration: %v", err)
	}
	for _, artifact := range []string{
		`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'hardware_categories')`,
		`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'hardwares' AND column_name = 'category_id')`,
		`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'hardwares' AND column_name = 'brand')`,
		`SELECT EXISTS(SELECT 1 FROM pg_policies WHERE tablename = 'hardware_categories')`,
		`SELECT EXISTS(SELECT 1 FROM rls_policy_inventory WHERE table_name = 'hardware_categories')`,
	} {
		var exists bool
		if err := pool.QueryRow(ctx, artifact).Scan(&exists); err != nil || exists {
			t.Fatalf("down migration left an artifact behind (%s): exists=%v err=%v", artifact, exists, err)
		}
	}

	upSQL, err := os.ReadFile("../../db/migration/000177_hardware_categories.up.sql")
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	if _, err := pool.Exec(ctx, string(upSQL)); err != nil {
		t.Fatalf("re-apply up migration: %v", err)
	}
	for _, artifact := range []string{
		`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'hardware_categories')`,
		`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'hardwares' AND column_name = 'category_id')`,
		`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'hardwares' AND column_name = 'brand')`,
		`SELECT EXISTS(SELECT 1 FROM pg_policies WHERE tablename = 'hardware_categories' AND policyname = 'tenant_isolation')`,
		`SELECT EXISTS(SELECT 1 FROM rls_policy_inventory WHERE table_name = 'hardware_categories')`,
	} {
		var exists bool
		if err := pool.QueryRow(ctx, artifact).Scan(&exists); err != nil || !exists {
			t.Fatalf("re-applied migration missing artifact (%s): exists=%v err=%v", artifact, exists, err)
		}
	}
}
