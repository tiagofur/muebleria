package storage_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #913 (HW-PROFILE): tenant-scoped CRUD for hardware profiles over the
// frozen #912 contract — hardware referenced by id only, server-owned
// optimistic-concurrency version, and cross-org rejection indistinguishable
// from "does not exist".

func createHardwareProfileFixtureHardware(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, code string) domain.Hardware {
	t.Helper()
	hw := domain.Hardware{Code: code, Name: "Herraje " + code, Unit: domain.UnitPiece, CostPerUnit: 10.5, Active: true}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, &hw)
	})
	return hw
}

func hardwareProfileFixture(hwID string) *domain.HardwareProfile {
	return &domain.HardwareProfile{
		Code:     "PERF-TEST",
		Name:     "Unión de prueba",
		Revision: "rev-1",
		Items: []domain.HardwareProfileItem{
			{HardwareID: hwID, Quantity: 2, ApplicationRole: "screw"},
		},
		RecipeRef: &domain.ProfileRecipeRef{RecipeID: "test:synthetic-fixed-shelf", RecipeRevision: "test-1"},
		Active:    true,
	}
}

func TestHardwareProfileCRUDAndVersionConcurrency(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	hw := createHardwareProfileFixtureHardware(t, store, actor, uniqueID("HW-PROF"))

	profile := hardwareProfileFixture(hw.ID)
	profile.Code = uniqueID("PERF")
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateHardwareProfile(txCtx, profile) })
	profileID := profile.ID
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM hardware_profiles WHERE id = $1`, profileID) })

	if profile.Version != 1 {
		t.Fatalf("created profile version = %d, want 1", profile.Version)
	}

	// Readback round-trips the #912 payload verbatim (items + recipe ref).
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.HardwareProfile, error) {
		return store.GetHardwareProfileByID(txCtx, profileID)
	})
	if got.Code != profile.Code || got.Revision != "rev-1" || len(got.Items) != 1 ||
		got.Items[0].HardwareID != hw.ID || got.Items[0].Quantity != 2 || got.RecipeRef == nil ||
		got.RecipeRef.RecipeRevision != "test-1" || !got.Active || got.Version != 1 {
		t.Fatalf("readback mismatch: %+v", got)
	}

	// Accepted update bumps the version inside the transaction.
	got.Name = "Unión v2"
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardwareProfile(txCtx, profileID, 1, got)
	})
	after := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.HardwareProfile, error) {
		return store.GetHardwareProfileByID(txCtx, profileID)
	})
	if after.Version != 2 || after.Name != "Unión v2" {
		t.Fatalf("post-update readback version=%d name=%q", after.Version, after.Name)
	}

	// Stale expected version: typed conflict, row untouched.
	stale := *after
	stale.Name = "Escritura vieja"
	err := tenantHardwareProfileUpdate(t, store, actor, profileID, 1, &stale)
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale update err = %v, want ErrVersionConflict", err)
	}
	unchanged := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.HardwareProfile, error) {
		return store.GetHardwareProfileByID(txCtx, profileID)
	})
	if unchanged.Version != 2 || unchanged.Name != "Unión v2" {
		t.Fatalf("rejected stale write mutated the row: version=%d name=%q", unchanged.Version, unchanged.Name)
	}

	// Version-less expectations fail closed.
	if err := tenantHardwareProfileUpdate(t, store, actor, profileID, 0, &stale); !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("version-less update err = %v, want ErrVersionConflict", err)
	}

	// Unknown id stays a not-found, not a conflict.
	unknown := "f9130000-0000-0000-0000-000000000001"
	err = tenantHardwareProfileUpdate(t, store, actor, unknown, 1, &stale)
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("unknown-id update err = %v, want not found", err)
	}

	// Deactivate is version-guarded too and bumps the version.
	err = tenantHardwareProfileDeactivate(t, store, actor, profileID, 2)
	if err != nil {
		t.Fatalf("deactivate err = %v", err)
	}
	deactivated := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.HardwareProfile, error) {
		return store.GetHardwareProfileByID(txCtx, profileID)
	})
	if deactivated.Active || deactivated.Version != 3 {
		t.Fatalf("deactivated profile active=%v version=%d", deactivated.Active, deactivated.Version)
	}
	if err := tenantHardwareProfileDeactivate(t, store, actor, profileID, 2); !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale deactivate err = %v, want ErrVersionConflict", err)
	}
}

func tenantHardwareProfileUpdate(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, id string, expectedVersion int64, p *domain.HardwareProfile) error {
	t.Helper()
	ctx := storage.WithOrgCtx(context.Background(), actor.OrganizationID)
	return store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		return store.UpdateHardwareProfile(txCtx, id, expectedVersion, p)
	})
}

func tenantHardwareProfileDeactivate(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, id string, expectedVersion int64) error {
	t.Helper()
	ctx := storage.WithOrgCtx(context.Background(), actor.OrganizationID)
	return store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		return store.DeactivateHardwareProfile(txCtx, id, expectedVersion)
	})
}

func TestHardwareProfileDuplicateCodeRejectedWithinOrganization(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	hw := createHardwareProfileFixtureHardware(t, store, actor, uniqueID("HW-DUP"))

	code := uniqueID("PERF-DUP")
	first := hardwareProfileFixture(hw.ID)
	first.Code = code
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateHardwareProfile(txCtx, first) })
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM hardware_profiles WHERE id = $1`, first.ID) })

	second := hardwareProfileFixture(hw.ID)
	second.Code = code
	err := tenantHardwareProfileCreate(t, store, actor, second)
	if err == nil || !strings.Contains(err.Error(), "duplicate key") {
		t.Fatalf("duplicate code err = %v, want duplicate key", err)
	}
}

func tenantHardwareProfileCreate(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, p *domain.HardwareProfile) error {
	t.Helper()
	ctx := storage.WithOrgCtx(context.Background(), actor.OrganizationID)
	return store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		return store.CreateHardwareProfile(txCtx, p)
	})
}

// A profile only references hardware of its own scope: the id set the API
// validates against is organization-scoped (#913 acceptance).
func TestExistingHardwareIDsIsOrganizationScoped(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB
	_ = orgB

	hwA := createHardwareProfileFixtureHardware(t, store, fixture.actorA, uniqueID("HW-ISO"))
	hwB := createHardwareProfileFixtureHardware(t, store, fixture.actorB, uniqueID("HW-ISO"))

	existingA := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) (map[string]bool, error) {
		return store.ExistingHardwareIDs(txCtx, []string{hwA.ID, hwB.ID})
	})
	if !existingA[hwA.ID] {
		t.Fatalf("org A must resolve its own hardware %s", hwA.ID)
	}
	if existingA[hwB.ID] {
		t.Fatalf("org A must not resolve org B hardware %s", hwB.ID)
	}
}

func TestIsolation_HardwareProfiles(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB

	hwA := createHardwareProfileFixtureHardware(t, store, fixture.actorA, uniqueID("HW-ISO-PROF"))
	profile := hardwareProfileFixture(hwA.ID)
	profile.Code = uniqueID("PERF-ISO")
	isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.CreateHardwareProfile(txCtx, profile)
	})
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM hardware_profiles WHERE id = $1`, profile.ID) })

	// Org B never lists or reads org A's profile.
	visible := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.HardwareProfile, error) {
		return store.ListHardwareProfiles(txCtx)
	})
	for _, listed := range visible {
		if listed.ID == profile.ID {
			t.Fatalf("org B listed org A profile %s", profile.ID)
		}
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		_, err := store.GetHardwareProfileByID(txCtx, profile.ID)
		return err
	}); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("org B read org A profile err = %v, want not found", err)
	}

	// Writes from org B are rejected indistinguishably from "does not exist".
	mutated := hardwareProfileFixture(hwA.ID)
	mutated.Code = profile.Code
	mutated.Name = "Escritura cruzada"
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		return store.UpdateHardwareProfile(txCtx, profile.ID, 1, mutated)
	}); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("org B update err = %v, want not found", err)
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		return store.DeactivateHardwareProfile(txCtx, profile.ID, 1)
	}); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("org B deactivate err = %v, want not found", err)
	}

	// Org A still sees its row unchanged.
	still := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) (*domain.HardwareProfile, error) {
		return store.GetHardwareProfileByID(txCtx, profile.ID)
	})
	if still.Name != profile.Name || !still.Active || still.Version != 1 {
		t.Fatalf("org A row mutated by cross-org write: %+v", still)
	}
}

func TestHardwareProfilesMigrationFreshAndUpgrade(t *testing.T) {
	t.Run("fresh schema carries the table with version defaults and RLS inventory", func(t *testing.T) {
		pool := multiOrgFreshMigrationDB(t)
		identityApplyThrough(t, pool, 143)
		ctx := context.Background()

		var columnDefault, nullable string
		err := pool.QueryRow(ctx, `
			SELECT column_default, is_nullable
			FROM information_schema.columns
			WHERE table_name = 'hardware_profiles' AND column_name = 'version'
		`).Scan(&columnDefault, &nullable)
		if err != nil {
			t.Fatalf("version column: %v", err)
		}
		if columnDefault != "1" || nullable != "NO" {
			t.Fatalf("version column default=%q nullable=%q", columnDefault, nullable)
		}

		var rlsEnabled, rlsForced bool
		if err := pool.QueryRow(ctx, `
			SELECT relrowsecurity, relforcerowsecurity
			FROM pg_class WHERE relname = 'hardware_profiles'
		`).Scan(&rlsEnabled, &rlsForced); err != nil {
			t.Fatalf("rls state: %v", err)
		}
		if !rlsEnabled || !rlsForced {
			t.Fatalf("hardware_profiles RLS enabled=%v forced=%v", rlsEnabled, rlsForced)
		}

		var classification string
		if err := pool.QueryRow(ctx, `
			SELECT classification FROM rls_policy_inventory WHERE table_name = 'hardware_profiles'
		`).Scan(&classification); err != nil {
			t.Fatalf("rls inventory: %v", err)
		}
		if classification != "tenant-owned" {
			t.Fatalf("classification = %q, want tenant-owned", classification)
		}
	})

	t.Run("upgrade path applies 000143 after a 142 database", func(t *testing.T) {
		pool := multiOrgFreshMigrationDB(t)
		identityApplyThrough(t, pool, 142)
		ctx := context.Background()

		var exists bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hardware_profiles')
		`).Scan(&exists); err != nil || exists {
			t.Fatalf("table before upgrade: exists=%v err=%v", exists, err)
		}

		if err := applyEmbeddedMigration(t, pool, ctx, 143); err != nil {
			t.Fatalf("apply migration 143: %v", err)
		}
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hardware_profiles')
		`).Scan(&exists); err != nil || !exists {
			t.Fatalf("table after upgrade: exists=%v err=%v", exists, err)
		}
	})
}
