package engine

import (
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestEvaluatePartFormula(t *testing.T) {
	v, err := evaluatePartFormula("H-3", formulaDims{W: 600, H: 720, D: 560})
	if err != nil {
		t.Fatal(err)
	}
	if v != 717 {
		t.Fatalf("got %d want 717", v)
	}
	v, err = evaluatePartFormula("W/2-2", formulaDims{W: 600, H: 720, D: 560})
	if err != nil {
		t.Fatal(err)
	}
	if v != 298 {
		t.Fatalf("got %d want 298", v)
	}
	// Parent aliases + thickness (TS parity for seed formulas like PH / PD).
	v, err = evaluatePartFormula("PH", formulaDims{W: 600, H: 720, D: 560, PW: 600, PH: 720, PD: 560, T: 18})
	if err != nil {
		t.Fatal(err)
	}
	if v != 720 {
		t.Fatalf("PH got %d want 720", v)
	}
	v, err = evaluatePartFormula("PD-T", formulaDims{W: 600, H: 720, D: 560, PW: 600, PH: 720, PD: 560, T: 18})
	if err != nil {
		t.Fatal(err)
	}
	if v != 542 {
		t.Fatalf("PD-T got %d want 542", v)
	}
	v, err = evaluatePartFormula("PW/2+i", formulaDims{W: 600, H: 720, D: 560, PW: 600, I: 2})
	if err != nil {
		t.Fatal(err)
	}
	if v != 302 {
		t.Fatalf("PW/2+i got %d want 302", v)
	}
}

func TestResolveBom_ComposedModule(t *testing.T) {
	edge := domain.EdgeBand{
		ID: "edge-1", Code: "CAN", Name: "Canto", CostPerMl: 1, Active: true,
	}
	mat := domain.MaterialBoard{
		ID: "mat-1", Code: "MAT", Name: "Melamina", Active: true,
		WidthMm: 1830, LengthMm: 2440, ThicknessMm: 18, BoardPrice: 100, WastePercent: 10, CostPerM2: 20,
		DefaultEdgeBandID: "edge-1",
	}
	compCostado := domain.Component{
		ID: "comp-costado", Code: "COS", Name: "Costado", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", LengthMm: 720, WidthMm: 560, ThicknessMm: 18,
		LengthFormula: "PH", WidthFormula: "PD",
		DefaultEdges: []domain.EdgeAssignment{
			{Side: "L1", Enabled: false}, {Side: "L2", Enabled: false},
			{Side: "W1", Enabled: false}, {Side: "W2", Enabled: false},
		},
		OptionRoles: []string{"INTERIOR"}, Active: true,
	}
	compPuerta := domain.Component{
		ID: "comp-puerta", Code: "PUE", Name: "Puerta", Placement: domain.PlacementPuerta,
		GeometryKind: "rectangular_board", LengthMm: 700, WidthMm: 300, ThicknessMm: 18,
		LengthFormula: "H-3", WidthFormula: "W/2-2",
		DefaultEdges: []domain.EdgeAssignment{
			{Side: "L1", Enabled: true}, {Side: "L2", Enabled: true},
			{Side: "W1", Enabled: true}, {Side: "W2", Enabled: true},
		},
		OptionRoles: []string{"FRENTE"}, Active: true,
	}
	st := domain.Structure{
		ID: "st-1", Code: "EST", Name: "Cuerpo", WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true,
		Presets: []domain.DimensionPreset{{ID: "p1", WidthMm: 600, HeightMm: 720, DepthMm: 560}},
		Components: []domain.ComponentInstance{{ComponentID: "comp-costado", Quantity: 2}},
	}
	mod := domain.Module{
		ID: "mod-1", Code: "MOD-COMP", Name: "Compuesto",
		StructureID: "st-1", WidthMm: 600, HeightMm: 720, DepthMm: 560,
		Components: []domain.ComponentInstance{{ComponentID: "comp-puerta", Quantity: 1}},
	}
	catalog := domain.Catalog{
		Materials:  []domain.MaterialBoard{mat},
		Edges:      []domain.EdgeBand{edge},
		Structures: []domain.Structure{st},
		Components: []domain.Component{compCostado, compPuerta},
	}
	choices := map[string]string{"INTERIOR": "mat-1", "FRENTE": "mat-1"}

	bom, err := ResolveBom(mod, choices, catalog)
	if err != nil {
		t.Fatalf("ResolveBom: %v", err)
	}
	if len(bom.BoardParts) != 3 {
		t.Fatalf("parts=%d want 3", len(bom.BoardParts))
	}
	var puerta *domain.ResolvedBoardPart
	for i := range bom.BoardParts {
		if bom.BoardParts[i].Description == "Puerta" {
			puerta = &bom.BoardParts[i]
		}
	}
	if puerta == nil {
		t.Fatal("missing puerta part")
	}
	if puerta.LengthMm != 717 || puerta.WidthMm != 298 {
		t.Fatalf("puerta dims %dx%d want 717x298", puerta.LengthMm, puerta.WidthMm)
	}
	if puerta.MaterialID != "mat-1" {
		t.Fatalf("material %s", puerta.MaterialID)
	}
}

func TestResolveBom_LegacyBoardPartsStillWork(t *testing.T) {
	mat := domain.MaterialBoard{
		ID: "mat-1", Code: "MAT", Name: "Melamina", Active: true,
		WidthMm: 1830, LengthMm: 2440, ThicknessMm: 18, BoardPrice: 100, WastePercent: 10, CostPerM2: 20,
	}
	mod := domain.Module{
		ID: "mod-legacy", Code: "LEG", Name: "Legacy",
		BoardParts: []domain.BoardPart{{
			ID: "p1", Description: "Costado", Quantity: 1, LengthMm: 720, WidthMm: 560,
			OptionRole: "INTERIOR",
			Edges: []domain.EdgeAssignment{
				{Side: "L1", Enabled: false}, {Side: "L2", Enabled: false},
				{Side: "W1", Enabled: false}, {Side: "W2", Enabled: false},
			},
		}},
	}
	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{mat},
	}
	bom, err := ResolveBom(mod, map[string]string{"INTERIOR": "mat-1"}, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if len(bom.BoardParts) != 1 {
		t.Fatalf("parts=%d", len(bom.BoardParts))
	}
}

// TestResolveBomWithPin_HistoricalRevision verifies that a pin pointing at a
// historical snapshot re-resolves the BOM against that snapshot — not the live
// structure. Parity with TS resolveBom + structureRevisionPin.
func TestResolveBomWithPin_HistoricalRevision(t *testing.T) {
	edge := domain.EdgeBand{
		ID: "edge-1", Code: "CAN", Name: "Canto", CostPerMl: 1, Active: true,
	}
	mat := domain.MaterialBoard{
		ID: "mat-1", Code: "MAT", Name: "Melamina", Active: true,
		WidthMm: 1830, LengthMm: 2440, ThicknessMm: 18, BoardPrice: 100, WastePercent: 10, CostPerM2: 20,
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
	// Live structure is rev 2 (1 costado). History rev 1 had 3 costados.
	st := domain.Structure{
		ID: "st-1", Code: "EST", Name: "Cuerpo", WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true,
		Revision:  2,
		Presets:   []domain.DimensionPreset{{ID: "p1", WidthMm: 600, HeightMm: 720, DepthMm: 560}},
		Components: []domain.ComponentInstance{{ComponentID: "comp-costado", Quantity: 1}},
		History: []domain.StructureRevision{
			{
				Revision: 1, Code: "EST", Name: "Cuerpo",
				WidthMm: 600, HeightMm: 720, DepthMm: 560,
				Presets:    []domain.DimensionPreset{{ID: "p1", WidthMm: 600, HeightMm: 720, DepthMm: 560}},
				Components: []domain.ComponentInstance{{ComponentID: "comp-costado", Quantity: 3}},
			},
		},
	}
	mod := domain.Module{
		ID: "mod-1", Code: "MOD-COMP", Name: "Compuesto",
		StructureID: "st-1", WidthMm: 600, HeightMm: 720, DepthMm: 560,
	}
	catalog := domain.Catalog{
		Materials:  []domain.MaterialBoard{mat},
		Edges:      []domain.EdgeBand{edge},
		Structures: []domain.Structure{st},
		Components: []domain.Component{compCostado},
	}
	choices := map[string]string{"INTERIOR": "mat-1"}

	// Live (no pin): 1 costado.
	live, err := ResolveBomWithPin(mod, choices, catalog, "p1", nil)
	if err != nil {
		t.Fatalf("live ResolveBomWithPin: %v", err)
	}
	if len(live.BoardParts) != 1 {
		t.Fatalf("live parts=%d want 1", len(live.BoardParts))
	}

	// Pinned to rev 1: must reify the snapshot with 3 costados.
	pin := 1
	pinned, err := ResolveBomWithPin(mod, choices, catalog, "p1", &pin)
	if err != nil {
		t.Fatalf("pinned ResolveBomWithPin: %v", err)
	}
	if len(pinned.BoardParts) != 3 {
		t.Fatalf("pinned parts=%d want 3 (rev-1 snapshot)", len(pinned.BoardParts))
	}
}

// TestResolveBomWithPin_UnknownPinErrors verifies that an unknown pin produces
// a *StructureRevisionError rather than silently falling back to live.
func TestResolveBomWithPin_UnknownPinErrors(t *testing.T) {
	mat := domain.MaterialBoard{
		ID: "mat-1", Code: "MAT", Name: "Melamina", Active: true,
		WidthMm: 1830, LengthMm: 2440, ThicknessMm: 18, CostPerM2: 20,
		DefaultEdgeBandID: "edge-1",
	}
	edge := domain.EdgeBand{ID: "edge-1", Code: "CAN", Name: "Canto", CostPerMl: 1, Active: true}
	st := domain.Structure{
		ID: "st-1", Code: "EST", Name: "Cuerpo", WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true,
		Revision: 1,
		Presets:  []domain.DimensionPreset{{ID: "p1", WidthMm: 600, HeightMm: 720, DepthMm: 560}},
	}
	mod := domain.Module{ID: "mod-1", Code: "MOD", Name: "M", StructureID: "st-1"}
	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{mat}, Edges: []domain.EdgeBand{edge},
		Structures: []domain.Structure{st},
	}
	choices := map[string]string{"INTERIOR": "mat-1"}

	pin := 99 // never snapshotted
	_, err := ResolveBomWithPin(mod, choices, catalog, "p1", &pin)
	if err == nil {
		t.Fatal("expected error for unknown pin")
	}
	var sre *StructureRevisionError
	if !errors.As(err, &sre) {
		t.Fatalf("expected *StructureRevisionError, got %T (%v)", err, err)
	}
	if sre.Pin != 99 || sre.StructureID != "st-1" {
		t.Errorf("error context wrong: %+v", sre)
	}
}

// TestResolveBomWithPin_NilPinMatchesLive confirms that omitting the pin path
// (nil) is identical to ResolveBom (the un-pinned entry point). This is the
// source-compat contract for existing callers.
func TestResolveBomWithPin_NilPinMatchesLive(t *testing.T) {
	mat := domain.MaterialBoard{
		ID: "mat-1", Code: "MAT", Name: "Melamina", Active: true,
		WidthMm: 1830, LengthMm: 2440, ThicknessMm: 18, CostPerM2: 20,
		DefaultEdgeBandID: "edge-1",
	}
	edge := domain.EdgeBand{ID: "edge-1", Code: "CAN", Name: "Canto", CostPerMl: 1, Active: true}
	st := domain.Structure{
		ID: "st-1", Code: "EST", Name: "Cuerpo", WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true,
		Presets: []domain.DimensionPreset{{ID: "p1", WidthMm: 600, HeightMm: 720, DepthMm: 560}},
	}
	mod := domain.Module{ID: "mod-1", Code: "MOD", Name: "M",
		StructureID: "st-1", WidthMm: 600, HeightMm: 720, DepthMm: 560}
	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{mat}, Edges: []domain.EdgeBand{edge},
		Structures: []domain.Structure{st},
	}
	choices := map[string]string{"INTERIOR": "mat-1"}

	live, err := ResolveBom(mod, choices, catalog, "p1")
	if err != nil {
		t.Fatal(err)
	}
	pinned, err := ResolveBomWithPin(mod, choices, catalog, "p1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(live.BoardParts) != len(pinned.BoardParts) {
		t.Fatalf("nil pin path diverged from live: %d vs %d parts",
			len(live.BoardParts), len(pinned.BoardParts))
	}
}
