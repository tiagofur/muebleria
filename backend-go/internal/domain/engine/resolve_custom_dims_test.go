package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// F144 / #310 (P3D-7): customDims override — mirrors TS resolveBom(dimsOverride)
// unit tests (packages/domain/src/customDims.test.ts).
func customDimsTestCatalog() domain.Catalog {
	material := domain.MaterialBoard{
		ID: "mat", Code: "MEL", Name: "Melamina",
		WidthMm: 1000, LengthMm: 1000, ThicknessMm: 15,
		BoardPrice: 100, CostPerM2: 100, Active: true,
	}
	hardware := domain.Hardware{
		ID: "hw", Code: "JAL", Name: "Jaladera",
		Unit: domain.UnitPiece, CostPerUnit: 10, Active: true,
	}
	component := domain.Component{
		ID: "comp-frente", Code: "FRENTE", Name: "Frente",
		Placement: "frontal", GeometryKind: "rectangular_board",
		LengthMm: 720, WidthMm: 600, ThicknessMm: 18,
		LengthFormula: "H", WidthFormula: "W",
		DefaultEdges: []domain.EdgeAssignment{
			{Side: "L1"}, {Side: "L2"}, {Side: "W1"}, {Side: "W2"},
		},
		OptionRoles: []string{"INTERIOR"},
		Active:      true,
	}
	structure := domain.Structure{
		ID: "s1", Code: "EST", Name: "Carcasa", Active: true,
		WidthMm: 600, HeightMm: 720, DepthMm: 560,
		Components: []domain.ComponentInstance{{ComponentID: "comp-frente", Quantity: 1}},
	}
	module := domain.Module{
		ID: "m1", Code: "BA", Name: "Bajo",
		StructureID: "s1",
		WidthMm:     600, HeightMm: 720, DepthMm: 560,
		Presets: []domain.DimensionPreset{
			{ID: "p600", WidthMm: 600, HeightMm: 720, DepthMm: 560},
			{ID: "p800", WidthMm: 800, HeightMm: 720, DepthMm: 560},
		},
	}
	return domain.Catalog{
		Materials:    []domain.MaterialBoard{material},
		Hardware:     []domain.Hardware{hardware},
		OptionGroups: []domain.OptionGroup{{ID: "og", Code: "INTERIOR", Kind: "board", Required: true, OptionIDs: []string{"mat"}}},
		Structures:   []domain.Structure{structure},
		Components:   []domain.Component{component},
		Modules:      []domain.Module{module},
	}
}

func TestResolveBomWithDimsOverrideChangesParts(t *testing.T) {
	catalog := customDimsTestCatalog()
	choices := map[string]string{"INTERIOR": "mat"}

	presetBom, err := ResolveBomWithDims(catalog.Modules[0], choices, catalog, "p600", nil, nil)
	if err != nil {
		t.Fatalf("preset resolve: %v", err)
	}
	customBom, err := ResolveBomWithDims(catalog.Modules[0], choices, catalog, "p600", nil,
		&domain.ItemCustomDims{WidthMm: 900, HeightMm: 800, DepthMm: 500})
	if err != nil {
		t.Fatalf("custom resolve: %v", err)
	}

	if got := presetBom.BoardParts[0].LengthMm; got != 720 {
		t.Errorf("preset length = %d, want 720 (H)", got)
	}
	if got := presetBom.BoardParts[0].WidthMm; got != 600 {
		t.Errorf("preset width = %d, want 600 (W)", got)
	}
	if got := customBom.BoardParts[0].LengthMm; got != 800 {
		t.Errorf("custom length = %d, want 800 (H)", got)
	}
	if got := customBom.BoardParts[0].WidthMm; got != 900 {
		t.Errorf("custom width = %d, want 900 (W)", got)
	}
}

func TestResolveBomWithDimsRejectsNonComposed(t *testing.T) {
	catalog := customDimsTestCatalog()
	fixed := catalog.Modules[0]
	fixed.StructureID = ""

	_, err := ResolveBomWithDims(fixed, map[string]string{"INTERIOR": "mat"}, catalog, "", nil,
		&domain.ItemCustomDims{WidthMm: 900, HeightMm: 720, DepthMm: 500})
	if err == nil || !strings.Contains(err.Error(), "no es paramétrico") {
		t.Fatalf("want no-es-paramétrico error, got %v", err)
	}
}

func TestResolveBomWithDimsStillValidatesPresetID(t *testing.T) {
	catalog := customDimsTestCatalog()
	// Stale preset id must fail loudly even when an override is present (TS parity).
	_, err := ResolveBomWithDims(catalog.Modules[0], map[string]string{"INTERIOR": "mat"}, catalog, "deleted", nil,
		&domain.ItemCustomDims{WidthMm: 900, HeightMm: 720, DepthMm: 500})
	if err == nil || !strings.Contains(err.Error(), "preset de medida no es válido") {
		t.Fatalf("want stale-preset error, got %v", err)
	}
}

func TestCalcProjectBreakdownUsesCustomDims(t *testing.T) {
	catalog := customDimsTestCatalog()
	base := domain.Project{
		ID: "prj", Name: "p", CustomerID: "c", Currency: "UYU",
		MarginFactor: 1.5, Status: domain.StatusDraft,
		Items: []domain.ProjectItem{{
			ID: "i1", ModuleID: "m1", Quantity: 1,
			OptionChoices:   map[string]string{"INTERIOR": "mat"},
			MeasurePresetID: "p600",
		}},
	}
	custom := base
	// Copia profunda del ítem: `custom := base` comparte el backing array de
	// Items y el override mutaría también la base.
	custom.Items = []domain.ProjectItem{{
		ID: "i1", ModuleID: "m1", Quantity: 1,
		OptionChoices:   map[string]string{"INTERIOR": "mat"},
		MeasurePresetID: "p600",
		CustomDims:      &domain.ItemCustomDims{WidthMm: 900, HeightMm: 800, DepthMm: 500},
	}}

	baseBd, err := CalcProjectBreakdown(base, catalog)
	if err != nil {
		t.Fatalf("base breakdown: %v", err)
	}
	customBd, err := CalcProjectBreakdown(custom, catalog)
	if err != nil {
		t.Fatalf("custom breakdown: %v", err)
	}
	// 0.6×0.72 m² × 100 = 43.2 → 0.9×0.8 × 100 = 72.
	if want := 43.2; abs64(baseBd.MaterialsCost-want) > 0.01 {
		t.Errorf("base materials = %v, want %v", baseBd.MaterialsCost, want)
	}
	if want := 72.0; abs64(customBd.MaterialsCost-want) > 0.01 {
		t.Errorf("custom materials = %v, want %v", customBd.MaterialsCost, want)
	}
	if customBd.SalePrice <= baseBd.SalePrice {
		t.Errorf("custom sale (%v) must exceed preset sale (%v)", customBd.SalePrice, baseBd.SalePrice)
	}
}

func abs64(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
