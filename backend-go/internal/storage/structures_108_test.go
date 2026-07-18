package storage

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// These are live integration tests for #108 Slice 2 (structure revision
// versioning). They are skipped unless DATABASE_URL is set AND reachable, so
// `go test ./...` stays green in any environment (CI without Postgres, fresh
// clone, etc.). Run them locally against the docker compose Postgres with:
//
//	DATABASE_URL=postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable \
//	    go test ./internal/storage/ -run TestStructureRevision -v
//
// The migrations must already be applied (the server does this on startup).

func skipIfNoDB(t *testing.T) *PostgresStore {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping live storage integration test")
	}
	store, err := NewPostgresStore(url)
	if err != nil {
		t.Skipf("database not reachable: %v", err)
	}
	t.Cleanup(store.Close)
	return store
}

// uniqueStructureCode returns a code unlikely to collide with seeded data or
// other test runs (uses Unix nanos).
func uniqueStructureCode(prefix string) string {
	return prefix + "-" + time.Now().Format("20060102-150405.000000000")
}

// TestStructureRevisionBumpAndSnapshot verifies UpdateStructure bumps revision
// and persists an immutable snapshot in structure_revisions (#108 Slice 2).
func TestStructureRevisionBumpAndSnapshot(t *testing.T) {
	store := skipIfNoDB(t)
	ctx := context.Background()

	// Real component so the structure_components FK is satisfied.
	comp := &domain.Component{
		Code: "CMP-BUMP-" + time.Now().Format("20060102-150405.000000"),
		Name: "Bump Component", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", LengthMm: 720, WidthMm: 560, ThicknessMm: 18,
		OptionRoles: []string{"INTERIOR"}, Active: true,
	}
	if err := store.CreateComponent(ctx, comp); err != nil {
		t.Fatalf("CreateComponent: %v", err)
	}
	t.Cleanup(func() { _ = store.DeleteComponent(ctx, comp.ID) })

	// Fresh structure (rev defaults to 1 at the DB level).
	st := &domain.Structure{
		Code:       uniqueStructureCode("BUMP"),
		Name:       "Bump Test",
		WidthMm:    600, HeightMm: 720, DepthMm: 560, Active: true,
		Components: []domain.ComponentInstance{{ComponentID: comp.ID, Quantity: 1}},
		Presets:    []domain.DimensionPreset{{ID: "", Name: "Std", WidthMm: 600, HeightMm: 720, DepthMm: 560}},
	}
	if err := store.CreateStructure(ctx, st); err != nil {
		t.Fatalf("CreateStructure: %v", err)
	}
	t.Cleanup(func() { _ = store.DeleteStructure(ctx, st.ID) })

	// Sanity: revision 1 after create.
	loaded, err := store.GetStructureByID(ctx, st.ID)
	if err != nil {
		t.Fatalf("GetStructureByID (initial): %v", err)
	}
	if loaded.Revision != 1 {
		t.Fatalf("initial revision: got %d want 1", loaded.Revision)
	}

	// Edit 1: bump components to qty 3. UpdateStructure must snapshot rev 1 and
	// advance the structure to rev 2.
	st.Components = []domain.ComponentInstance{{ComponentID: comp.ID, Quantity: 3}}
	if err := store.UpdateStructure(ctx, st.ID, st); err != nil {
		t.Fatalf("UpdateStructure (1st edit): %v", err)
	}
	if st.Revision != 2 {
		t.Errorf("in-memory revision after 1st edit: got %d want 2", st.Revision)
	}

	loaded, err = store.GetStructureByID(ctx, st.ID)
	if err != nil {
		t.Fatalf("GetStructureByID (after edit): %v", err)
	}
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
	if err := store.UpdateStructure(ctx, st.ID, st); err != nil {
		t.Fatalf("UpdateStructure (2nd edit): %v", err)
	}
	loaded, err = store.GetStructureByID(ctx, st.ID)
	if err != nil {
		t.Fatal(err)
	}
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
	store := skipIfNoDB(t)
	ctx := context.Background()

	// Real customer + module to satisfy FKs.
	customer := &domain.Customer{
		Name: "Pin Test Customer " + time.Now().Format("150405.000000"),
		Active: true,
	}
	if err := store.CreateCustomer(ctx, customer); err != nil {
		t.Fatalf("CreateCustomer: %v", err)
	}

	mod := &domain.Module{
		Code: "MOD-PIN-" + time.Now().Format("20060102-150405.000000"),
		Name: "Pin Test Module", BaseLaborCost: 10,
		BoardParts:    []domain.BoardPart{},
		HardwareLines: []domain.HardwareLine{},
	}
	if err := store.CreateModule(ctx, mod); err != nil {
		t.Fatalf("CreateModule: %v", err)
	}
	t.Cleanup(func() { _ = store.DeleteModule(ctx, mod.ID) })

	pin1 := 1
	pin3 := 3
	project := &domain.Project{
		Name: "Pin Test " + time.Now().Format("150405.000000"),
		CustomerID: customer.ID,
		Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{
			{ModuleID: mod.ID, Quantity: 1, StructureRevisionPin: &pin1,
				OptionChoices: map[string]string{}},
			{ModuleID: mod.ID, Quantity: 2, // pin nil — live
				OptionChoices: map[string]string{}},
			{ModuleID: mod.ID, Quantity: 1, StructureRevisionPin: &pin3,
				OptionChoices: map[string]string{}},
		},
	}
	if err := store.CreateProject(ctx, project); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	t.Cleanup(func() { _ = store.DeleteProject(ctx, project.ID) })

	loaded, err := store.GetProjectByID(ctx, project.ID)
	if err != nil {
		t.Fatalf("GetProjectByID: %v", err)
	}
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
