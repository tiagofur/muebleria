package engine

import (
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
