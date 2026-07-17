package engine

import (
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// regression108Fixture builds a composed-module catalog + project that can be
// exercised end-to-end through the same engine entry points the API uses
// (GenerateCutRows, CaptureQuoteSnapshot, TransitionProjectStatus).
func regression108Fixture(t *testing.T) (domain.Catalog, domain.Project) {
	t.Helper()
	edge := domain.EdgeBand{ID: "edge-1", Code: "CAN", Name: "Canto", CostPerMl: 1, Active: true}
	mat := domain.MaterialBoard{
		ID: "mat-1", Code: "MAT", Name: "Melamina", Active: true,
		WidthMm: 1830, LengthMm: 2440, ThicknessMm: 18, CostPerM2: 20,
		DefaultEdgeBandID: "edge-1",
	}
	compCostado := domain.Component{
		ID: "comp-costado", Code: "COS", Name: "Costado", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", LengthMm: 720, WidthMm: 560, ThicknessMm: 18,
		DefaultEdges: []domain.EdgeAssignment{
			{Side: "L1", Enabled: false}, {Side: "L2", Enabled: false},
			{Side: "W1", Enabled: false}, {Side: "W2", Enabled: false},
		},
		OptionRoles: []string{"INTERIOR"}, Active: true,
	}
	st := domain.Structure{
		ID: "st-1", Code: "EST", Name: "Cuerpo", WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true,
		Revision: 1,
		Presets:  []domain.DimensionPreset{{ID: "p1", WidthMm: 600, HeightMm: 720, DepthMm: 560}},
		// rev 1 had 1 costado.
		Components: []domain.ComponentInstance{{ComponentID: "comp-costado", Quantity: 1}},
	}
	mod := domain.Module{
		ID: "mod-1", Code: "MOD-COMP", Name: "Compuesto", BaseLaborCost: 50,
		StructureID: "st-1", WidthMm: 600, HeightMm: 720, DepthMm: 560,
	}
	catalog := domain.Catalog{
		Materials:  []domain.MaterialBoard{mat},
		Edges:      []domain.EdgeBand{edge},
		Structures: []domain.Structure{st},
		Components: []domain.Component{compCostado},
		Modules:    []domain.Module{mod},
	}
	project := domain.Project{
		ID: "proj-1", Name: "T", CustomerID: "c", Currency: "MXN",
		MarginFactor: 1.35, LaborFixedCost: 0, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{
			{
				ID: "i1", ModuleID: "mod-1", Quantity: 1,
				MeasurePresetID: "p1",
				OptionChoices:   map[string]string{"INTERIOR": "mat-1"},
			},
		},
	}
	return catalog, project
}

// TestRegression108_ClosedQuoteKeepsRev1BOM is the Go mirror of the TS
// non-regression test for issue #108. Flow:
//  1. Project in draft, structure at rev 1 (1 costado).
//  2. Close the project → pins are captured (rev 1) + price snapshot freezes.
//  3. Edit the structure to rev 2 (3 costados) via BumpStructureRevision.
//  4. Re-resolve the closed project's BOM (GenerateCutRows): must still be
//     1 costado because the item's pin points at rev 1.
//  5. A draft copy of the same project (no pin) sees the new 3-costado BOM.
func TestRegression108_ClosedQuoteKeepsRev1BOM(t *testing.T) {
	catalog, project := regression108Fixture(t)
	at := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)

	// 2. Close the project.
	closed, err := TransitionProjectStatus(project, domain.StatusQuoted, catalog, at)
	if err != nil {
		t.Fatalf("TransitionProjectStatus close: %v", err)
	}
	if closed.PriceSnapshot == nil {
		t.Fatal("closed project must have a price snapshot")
	}
	if len(closed.Items) != 1 || closed.Items[0].StructureRevisionPin == nil {
		t.Fatalf("item must carry a structure pin after close, got %+v", closed.Items)
	}
	if got := *closed.Items[0].StructureRevisionPin; got != 1 {
		t.Fatalf("pin: got %d want 1 (current rev at close)", got)
	}
	frozenSale := closed.PriceSnapshot.Breakdown.SalePrice

	// Closed BOM at rev 1 = 1 costado × 1 item = 1 row.
	rowsBefore, err := GenerateCutRows(closed, catalog)
	if err != nil {
		t.Fatalf("GenerateCutRows (closed, rev 1): %v", err)
	}
	if len(rowsBefore) != 1 {
		t.Fatalf("closed BOM rows: got %d want 1", len(rowsBefore))
	}

	// 3. Edit structure: bump from rev 1 (1 costado) → rev 2 (3 costados).
	draft := catalog.Structures[0]
	draft.Components = []domain.ComponentInstance{{ComponentID: "comp-costado", Quantity: 3}}
	catalog.Structures[0] = BumpStructureRevision(catalog.Structures[0], draft)
	if catalog.Structures[0].Revision != 2 {
		t.Fatalf("structure revision after bump: got %d want 2", catalog.Structures[0].Revision)
	}

	// 4. Closed project BOM must still be 1 costado (pin freezes rev 1).
	rowsAfter, err := GenerateCutRows(closed, catalog)
	if err != nil {
		t.Fatalf("GenerateCutRows (closed, after structure edit): %v", err)
	}
	if len(rowsAfter) != 1 {
		t.Fatalf("closed BOM rows after structure edit: got %d want 1 (pin freezes rev 1)",
			len(rowsAfter))
	}

	// Frozen breakdown must be unchanged (cost math is independent of pin path
	// here, but the BOM-driven snapshot must not drift).
	bd, err := CalcProjectBreakdown(closed, catalog)
	if err != nil {
		t.Fatalf("CalcProjectBreakdown closed: %v", err)
	}
	if bd.SalePrice != frozenSale {
		t.Errorf("frozen sale price drifted: got %v want %v", bd.SalePrice, frozenSale)
	}

	// 5. A draft copy of the project (no pin) must see the new 3-costado BOM.
	draftProject := project // StatusDraft, items have no pin
	rowsDraft, err := GenerateCutRows(draftProject, catalog)
	if err != nil {
		t.Fatalf("GenerateCutRows (draft, live rev 2): %v", err)
	}
	if len(rowsDraft) != 3 {
		t.Fatalf("draft BOM rows: got %d want 3 (live rev 2)", len(rowsDraft))
	}
}

// TestRegression108_ReopenConservesPins checks the audit-trail semantics:
// reopening a closed project drops the price snapshot but KEEPS the
// structure pins, so a reopened quote can still be re-resolved against the
// revision it was originally closed with.
func TestRegression108_ReopenConservesPins(t *testing.T) {
	catalog, project := regression108Fixture(t)
	at := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)

	closed, err := TransitionProjectStatus(project, domain.StatusQuoted, catalog, at)
	if err != nil {
		t.Fatal(err)
	}
	if closed.Items[0].StructureRevisionPin == nil {
		t.Fatal("expected pin after close")
	}

	reopened, err := TransitionProjectStatus(closed, domain.StatusDraft, catalog, at)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.PriceSnapshot != nil {
		t.Error("reopened draft must drop price snapshot")
	}
	if reopened.Items[0].StructureRevisionPin == nil {
		t.Error("reopened draft must CONSERVE structure pin (audit trail)")
	}
}
