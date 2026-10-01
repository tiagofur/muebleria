package storage_test

import (
	"context"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #915 backend acceptance against real disposable PostgreSQL: assignments
// persist per (component, side) with upsert semantics, broken references
// fail closed, cross-org rows are invisible/mutable-proof, and the
// migration carries the full tenant-RLS checklist.

func sideAssignmentStorageFixture(t *testing.T) (isolationRuntimeFixture, string, string) {
	t.Helper()
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	ctx := context.Background()

	const componentID = "f9150000-0000-0000-0000-0000000000c1"
	// Seed the component inside a COMMITTED actor transaction: the probe
	// helper rolls back, and this row must persist for the assignments.
	tx, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin seed tx: %v", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		SELECT set_config('app.organization_id', $1, true),
		       set_config('app.user_id', $2, true),
		       set_config('app.membership_id', $3, true),
		       set_config('app.authorized_organization_ids', $1, true)
	`, fixture.actorA.OrganizationID, fixture.actorA.UserID, fixture.actorA.MembershipID); err != nil {
		t.Fatalf("seed actor context: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO components (id, organization_id, code, name, placement, length_mm, width_mm, thickness_mm, active)
		VALUES ($1, $2, 'COMP-915', 'Costado asignable', 'lateral_izquierdo', 720, 560, 18, TRUE)
	`, componentID, fixture.orgA); err != nil {
		t.Fatalf("seed component: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit seed: %v", err)
	}
	hw := createHardwareProfileFixtureHardware(t, store, fixture.actorA, uniqueID("HW-915"))
	profile := &domain.HardwareProfile{
		Code: uniqueID("PERF-915"), Name: "Unión 915", Revision: "rev-1",
		Items:  []domain.HardwareProfileItem{{HardwareID: hw.ID, Quantity: 2, ApplicationRole: "screw"}},
		Active: true,
	}
	isolationFamilyError(t, fixture, fixture.orgA, func(txCtx context.Context) error {
		return store.CreateHardwareProfile(txCtx, profile)
	})
	return fixture, componentID, profile.ID
}

func TestComponentSideAssignmentCRUD(t *testing.T) {
	fixture, componentID, profileID := sideAssignmentStorageFixture(t)
	store := fixture.store

	// Set: upsert semantics on (component, side).
	assignment := &domain.ComponentSideAssignment{ComponentID: componentID, Side: "left", ProfileID: profileID}
	if err := isolationFamilyError(t, fixture, fixture.orgA, func(txCtx context.Context) error {
		return store.SetComponentSideAssignment(txCtx, assignment)
	}); err != nil {
		t.Fatalf("set assignment: %v", err)
	}
	if assignment.ID == "" {
		t.Fatalf("set did not return the server id")
	}

	// Replace the same side: same row updated, not duplicated.
	assignment2 := &domain.ComponentSideAssignment{ComponentID: componentID, Side: "left", ProfileID: profileID}
	isolationFamilyError(t, fixture, fixture.orgA, func(txCtx context.Context) error {
		return store.SetComponentSideAssignment(txCtx, assignment2)
	})
	listed := isolationFamilyValue(t, fixture, fixture.orgA, func(txCtx context.Context) ([]domain.ComponentSideAssignment, error) {
		return store.ListComponentSideAssignments(txCtx, componentID)
	})
	if len(listed) != 1 || listed[0].Side != "left" {
		t.Fatalf("after replace: %+v", listed)
	}

	// A second side coexists (different profiles per side is the point).
	assignment3 := &domain.ComponentSideAssignment{ComponentID: componentID, Side: "right", ProfileID: profileID}
	isolationFamilyError(t, fixture, fixture.orgA, func(txCtx context.Context) error {
		return store.SetComponentSideAssignment(txCtx, assignment3)
	})
	listed = isolationFamilyValue(t, fixture, fixture.orgA, func(txCtx context.Context) ([]domain.ComponentSideAssignment, error) {
		return store.ListComponentSideAssignments(txCtx, componentID)
	})
	if len(listed) != 2 {
		t.Fatalf("two sides expected: %+v", listed)
	}

	// Remove restores inheritance.
	isolationFamilyError(t, fixture, fixture.orgA, func(txCtx context.Context) error {
		return store.RemoveComponentSideAssignment(txCtx, componentID, "left")
	})
	listed = isolationFamilyValue(t, fixture, fixture.orgA, func(txCtx context.Context) ([]domain.ComponentSideAssignment, error) {
		return store.ListComponentSideAssignments(txCtx, componentID)
	})
	if len(listed) != 1 || listed[0].Side != "right" {
		t.Fatalf("after remove: %+v", listed)
	}
}

func TestComponentSideAssignmentReferenceFailClosed(t *testing.T) {
	fixture, componentID, profileID := sideAssignmentStorageFixture(t)
	store := fixture.store

	// Unknown component reference.
	err := isolationFamilyError(t, fixture, fixture.orgA, func(txCtx context.Context) error {
		return store.SetComponentSideAssignment(txCtx, &domain.ComponentSideAssignment{
			ComponentID: "f9150000-0000-0000-0000-00000000000a", Side: "left", ProfileID: profileID,
		})
	})
	if err == nil || !strings.Contains(err.Error(), "reference invalid") {
		t.Fatalf("unknown component err = %v", err)
	}

	// Unknown profile reference.
	err = isolationFamilyError(t, fixture, fixture.orgA, func(txCtx context.Context) error {
		return store.SetComponentSideAssignment(txCtx, &domain.ComponentSideAssignment{
			ComponentID: componentID, Side: "left", ProfileID: "f9150000-0000-0000-0000-00000000000b",
		})
	})
	if err == nil || !strings.Contains(err.Error(), "reference invalid") {
		t.Fatalf("unknown profile err = %v", err)
	}

	// Cross-org profile reference is indistinguishable from missing.
	hwB := createHardwareProfileFixtureHardware(t, store, fixture.actorB, uniqueID("HW-915-B"))
	profileB := &domain.HardwareProfile{
		Code: uniqueID("PERF-915-B"), Name: "Unión B", Revision: "rev-1",
		Items:  []domain.HardwareProfileItem{{HardwareID: hwB.ID, Quantity: 1}},
		Active: true,
	}
	isolationFamilyError(t, fixture, fixture.orgB, func(txCtx context.Context) error {
		return store.CreateHardwareProfile(txCtx, profileB)
	})
	err = isolationFamilyError(t, fixture, fixture.orgA, func(txCtx context.Context) error {
		return store.SetComponentSideAssignment(txCtx, &domain.ComponentSideAssignment{
			ComponentID: componentID, Side: "left", ProfileID: profileB.ID,
		})
	})
	if err == nil || !strings.Contains(err.Error(), "reference invalid") {
		t.Fatalf("cross-org profile err = %v", err)
	}

	// Org B cannot see or mutate org A's assignment.
	visible := isolationFamilyValue(t, fixture, fixture.orgB, func(txCtx context.Context) ([]domain.ComponentSideAssignment, error) {
		return store.ListComponentSideAssignments(txCtx, componentID)
	})
	if len(visible) != 0 {
		t.Fatalf("org B saw org A assignments: %+v", visible)
	}
	if err := isolationFamilyError(t, fixture, fixture.orgB, func(txCtx context.Context) error {
		return store.RemoveComponentSideAssignment(txCtx, componentID, "right")
	}); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("org B remove err = %v", err)
	}
}

func TestComponentSideAssignmentsMigrationFreshAndUpgrade(t *testing.T) {
	t.Run("fresh schema carries RLS and the inventory row", func(t *testing.T) {
		pool := multiOrgFreshMigrationDB(t)
		identityApplyThrough(t, pool, 144)
		ctx := context.Background()

		var rlsEnabled, rlsForced bool
		if err := pool.QueryRow(ctx, `
			SELECT relrowsecurity, relforcerowsecurity
			FROM pg_class WHERE relname = 'component_side_assignments'
		`).Scan(&rlsEnabled, &rlsForced); err != nil {
			t.Fatalf("rls state: %v", err)
		}
		if !rlsEnabled || !rlsForced {
			t.Fatalf("RLS enabled=%v forced=%v", rlsEnabled, rlsForced)
		}
		var classification string
		if err := pool.QueryRow(ctx, `
			SELECT classification FROM rls_policy_inventory WHERE table_name = 'component_side_assignments'
		`).Scan(&classification); err != nil {
			t.Fatalf("inventory: %v", err)
		}
		if classification != "tenant-owned" {
			t.Fatalf("classification = %q", classification)
		}
	})

	t.Run("upgrade path applies 000144 after a 143 database", func(t *testing.T) {
		pool := multiOrgFreshMigrationDB(t)
		identityApplyThrough(t, pool, 143)
		ctx := context.Background()
		var exists bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'component_side_assignments')
		`).Scan(&exists); err != nil || exists {
			t.Fatalf("before upgrade: exists=%v err=%v", exists, err)
		}
		if err := applyEmbeddedMigration(t, pool, ctx, 144); err != nil {
			t.Fatalf("apply 144: %v", err)
		}
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'component_side_assignments')
		`).Scan(&exists); err != nil || !exists {
			t.Fatalf("after upgrade: exists=%v err=%v", exists, err)
		}
	})
}
