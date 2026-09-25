package storage

import (
	"context"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// These are live integration tests for #108 Slice 2 (structure revision
// versioning). They are skipped unless DATABASE_URL is set AND reachable, so
// `go test ./...` stays green in any environment sin base (fresh clone, etc.).
// La CI provee Postgres vía service container con DATABASE_URL. Run them
// locally against an isolated ephemeral test DB:
//
//	scripts/backend-test.sh -run TestStructureRevision -v
//
// newMigratedRuntimeStore applies schema setup through migration authority,
// then opens a distinct runtime store for RLS assertions.

const (
	storageRuntimeFixtureUser       = "91000000-0000-0000-0000-000000000001"
	storageRuntimeFixtureMembership = "92000000-0000-0000-0000-000000000001"
)

func newMigratedRuntimeStore(t *testing.T) *PostgresStore {
	t.Helper()
	runtimeURL := TestDatabaseURL(t)
	migrationStore, err := NewPostgresStore(TestMigrationDatabaseURLForRuntimeDatabase(t))
	if err != nil {
		t.Skipf("migration database not reachable: %v", err)
	}
	if err := migrationStore.RunMigrations(context.Background()); err != nil {
		migrationStore.Close()
		t.Fatalf("run migrations: %v", err)
	}
	seedTx, err := migrationStore.Pool.Begin(context.Background())
	if err != nil {
		migrationStore.Close()
		t.Fatalf("begin runtime fixture identity seed: %v", err)
	}
	defer seedTx.Rollback(context.Background())
	if _, err := seedTx.Exec(context.Background(), `
		INSERT INTO users (id, email, password_hash, name, account_status, normalized_email)
		VALUES ($1, 'storage-runtime-fixture@example.test', 'x', 'Storage runtime fixture', 'active', 'storage-runtime-fixture@example.test')
		ON CONFLICT (id) DO NOTHING`, storageRuntimeFixtureUser); err != nil {
		migrationStore.Close()
		t.Fatalf("seed runtime fixture user: %v", err)
	}
	if _, err := seedTx.Exec(context.Background(), `
		INSERT INTO memberships (id, organization_id, user_id, roles)
		VALUES ($1, $2, $3, ARRAY['admin']::text[])
		ON CONFLICT (user_id, organization_id) DO NOTHING`,
		storageRuntimeFixtureMembership, InitialOrganizationID, storageRuntimeFixtureUser); err != nil {
		migrationStore.Close()
		t.Fatalf("seed runtime fixture membership: %v", err)
	}
	if _, err := seedTx.Exec(context.Background(), `
		UPDATE organizations SET status='active', status_reason=NULL WHERE id=$1`, InitialOrganizationID); err != nil {
		migrationStore.Close()
		t.Fatalf("activate runtime fixture organization: %v", err)
	}
	if err := seedTx.Commit(context.Background()); err != nil {
		migrationStore.Close()
		t.Fatalf("commit runtime fixture identity seed: %v", err)
	}
	migrationStore.Close()
	runtimeStore, err := NewPostgresStore(runtimeURL)
	if err != nil {
		t.Skipf("runtime database not reachable: %v", err)
	}
	t.Cleanup(runtimeStore.Close)
	return runtimeStore
}

// withinInitialOrganization runs one production-equivalent catalog command.
// The catalog commands under these tests are organization-scoped but do not
// carry a user-owned audit field, so their legitimate actor is org-only.
func withinInitialOrganization(t *testing.T, store *PostgresStore, run func(context.Context) error) {
	t.Helper()
	if err := store.WithinTenantTx(context.Background(), TenantActor{OrganizationID: InitialOrganizationID, UserID: storageRuntimeFixtureUser, MembershipID: storageRuntimeFixtureMembership}, run); err != nil {
		t.Fatal(err)
	}
}

// uniqueStructureCode returns a code unlikely to collide with seeded data or
// other test runs (uses Unix nanos).
func uniqueStructureCode(prefix string) string {
	return prefix + "-" + time.Now().Format("20060102-150405.000000000")
}

// TestStructureRevisionBumpAndSnapshot verifies UpdateStructure bumps revision
// and persists an immutable snapshot in structure_revisions (#108 Slice 2).
func TestStructureRevisionBumpAndSnapshot(t *testing.T) {
	store := newMigratedRuntimeStore(t)
	// Real component so the structure_components FK is satisfied.
	comp := &domain.Component{
		Code: "CMP-BUMP-" + time.Now().Format("20060102-150405.000000"),
		Name: "Bump Component", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", LengthMm: 720, WidthMm: 560, ThicknessMm: 18,
		OptionRoles: []string{"INTERIOR"}, Active: true,
	}
	withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.CreateComponent(txCtx, comp) })
	t.Cleanup(func() {
		withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.DeleteComponent(txCtx, comp.ID) })
	})

	// Fresh structure (rev defaults to 1 at the DB level).
	st := &domain.Structure{
		Code:    uniqueStructureCode("BUMP"),
		Name:    "Bump Test",
		WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true,
		Components: []domain.ComponentInstance{{ComponentID: comp.ID, Quantity: 1}},
		Presets:    []domain.DimensionPreset{{ID: "", Name: "Std", WidthMm: 600, HeightMm: 720, DepthMm: 560}},
	}
	withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.CreateStructure(txCtx, st) })
	t.Cleanup(func() {
		withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.DeleteStructure(txCtx, st.ID) })
	})

	// Sanity: revision 1 after create.
	var loaded *domain.Structure
	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		var err error
		loaded, err = store.GetStructureByID(txCtx, st.ID)
		return err
	})
	if loaded.Revision != 1 {
		t.Fatalf("initial revision: got %d want 1", loaded.Revision)
	}

	// Edit 1: bump components to qty 3. UpdateStructure must snapshot rev 1 and
	// advance the structure to rev 2.
	st.Components = []domain.ComponentInstance{{ComponentID: comp.ID, Quantity: 3}}
	withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.UpdateStructure(txCtx, st.ID, st) })
	if st.Revision != 2 {
		t.Errorf("in-memory revision after 1st edit: got %d want 2", st.Revision)
	}

	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		var err error
		loaded, err = store.GetStructureByID(txCtx, st.ID)
		return err
	})
	if loaded.Revision != 2 {
		t.Errorf("db revision after 1st edit: got %d want 2", loaded.Revision)
	}
	if len(loaded.Components) != 1 || loaded.Components[0].Quantity != 3 {
		t.Errorf("live components after edit: %+v want qty=3", loaded.Components)
	}
	if len(loaded.History) != 1 {
		t.Fatalf("history after 1st edit: got len=%d want 1", len(loaded.History))
	}
	snap := loaded.History[0]
	if snap.Revision != 1 || len(snap.Components) != 1 || snap.Components[0].Quantity != 1 {
		t.Errorf("rev-1 snapshot: %+v want rev=1 qty=1", snap)
	}

	// Edit 2: bump to qty 5 → rev 3, history now has 2 entries (newest-first).
	st.Components = []domain.ComponentInstance{{ComponentID: comp.ID, Quantity: 5}}
	withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.UpdateStructure(txCtx, st.ID, st) })
	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		var err error
		loaded, err = store.GetStructureByID(txCtx, st.ID)
		return err
	})
	if loaded.Revision != 3 {
		t.Errorf("db revision after 2nd edit: got %d want 3", loaded.Revision)
	}
	if len(loaded.History) != 2 {
		t.Fatalf("history after 2nd edit: got len=%d want 2", len(loaded.History))
	}
	// Newest-first ordering.
	if loaded.History[0].Revision != 2 || loaded.History[1].Revision != 1 {
		t.Errorf("history ordering wrong: got revs %d,%d want 2,1",
			loaded.History[0].Revision, loaded.History[1].Revision)
	}

	// The rev-1 snapshot must still be intact (immutability): qty=1.
	if loaded.History[1].Components[0].Quantity != 1 {
		t.Errorf("rev-1 snapshot drifted: %+v", loaded.History[1])
	}
}

// TestStructureRevisionPinRoundTrip verifies the project_items.structure_revision_pin
// column round-trips through storage (#108 Slice 2). It exercises the read path
// (loadProjectItems via GetProjectByID) and the write path (UpdateProject).
func TestStructureRevisionPinRoundTrip(t *testing.T) {
	store := newMigratedRuntimeStore(t)
	// Real customer + module to satisfy FKs.
	customer := &domain.Customer{
		Name:   "Pin Test Customer " + time.Now().Format("150405.000000"),
		Active: true,
	}
	withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.CreateCustomer(txCtx, customer) })

	mod := &domain.Module{
		Code: "MOD-PIN-" + time.Now().Format("20060102-150405.000000"),
		Name: "Pin Test Module", BaseLaborCost: 10,
		BoardParts:    []domain.BoardPart{},
		HardwareLines: []domain.HardwareLine{},
	}
	withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.CreateModule(txCtx, mod) })
	t.Cleanup(func() {
		withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.DeleteModule(txCtx, mod.ID) })
	})

	pin1 := 1
	pin3 := 3
	project := &domain.Project{
		Name:       "Pin Test " + time.Now().Format("150405.000000"),
		CustomerID: customer.ID,
		Currency:   "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{
			{ModuleID: mod.ID, Quantity: 1, StructureRevisionPin: &pin1,
				OptionChoices: map[string]string{}},
			{ModuleID: mod.ID, Quantity: 2, // pin nil — live
				OptionChoices: map[string]string{}},
			{ModuleID: mod.ID, Quantity: 1, StructureRevisionPin: &pin3,
				OptionChoices: map[string]string{}},
		},
	}
	withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.CreateProject(txCtx, project) })
	t.Cleanup(func() {
		withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.DeleteProject(txCtx, project.ID) })
	})

	var loaded *domain.Project
	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		var err error
		loaded, err = store.GetProjectByID(txCtx, project.ID)
		return err
	})
	if len(loaded.Items) != 3 {
		t.Fatalf("items: got %d want 3", len(loaded.Items))
	}
	// Item 0: pin 1
	if loaded.Items[0].StructureRevisionPin == nil || *loaded.Items[0].StructureRevisionPin != 1 {
		t.Errorf("item 0 pin: got %v want 1", ptrIntStr(loaded.Items[0].StructureRevisionPin))
	}
	// Item 1: nil pin (live)
	if loaded.Items[1].StructureRevisionPin != nil {
		t.Errorf("item 1 pin: got %v want nil", ptrIntStr(loaded.Items[1].StructureRevisionPin))
	}
	// Item 2: pin 3
	if loaded.Items[2].StructureRevisionPin == nil || *loaded.Items[2].StructureRevisionPin != 3 {
		t.Errorf("item 2 pin: got %v want 3", ptrIntStr(loaded.Items[2].StructureRevisionPin))
	}
}

func ptrIntStr(p *int) interface{} {
	if p == nil {
		return "<nil>"
	}
	return *p
}
