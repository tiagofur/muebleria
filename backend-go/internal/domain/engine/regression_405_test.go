package engine

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

const materialThicknessParityContractPath = "../../../../contracts/materialThicknessParity.contract.json"

type parity405RoleExpectation struct {
	MaterialID    string `json:"materialId"`
	ThicknessMm   int    `json:"thicknessMm"`
	ExpectedCount int    `json:"expectedCount"`
}

type parity405Scenario struct {
	Choices                map[string]string                   `json:"choices"`
	ExpectedRoles          map[string]parity405RoleExpectation `json:"expectedRoles"`
	ExpectedFormulaResults map[string]float64                  `json:"expectedFormulaResults"`
	ExpectedRejectedRole   string                              `json:"expectedRejectedRole"`
}

type parity405Contract struct {
	NominalThicknessMm map[string]int               `json:"nominalThicknessMm"`
	Scenarios          map[string]parity405Scenario `json:"scenarios"`
}

func loadMaterialThicknessParityContract(t *testing.T) parity405Contract {
	t.Helper()
	raw, err := os.ReadFile(materialThicknessParityContractPath)
	if err != nil {
		t.Fatalf("read #405 shared contract: %v", err)
	}
	var contract parity405Contract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("parse #405 shared contract: %v", err)
	}
	if len(contract.Scenarios) == 0 || contract.NominalThicknessMm["Lateral"] != 15 {
		t.Fatalf("#405 contract must pin non-trivial nominal thicknesses")
	}
	return contract
}

func parity405Cabinet() (domain.Module, domain.Catalog) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	shelf := domain.Component{
		ID: "comp-ma-shelf", Code: "ENTRE", Name: "Entrepaño", Placement: domain.PlacementInterno,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"BODY"},
		LengthFormula: "PW - 2*T", WidthFormula: "PD - T", Active: true,
	}
	catalog.Components = append(catalog.Components, shelf)
	module.Components = append(module.Components, domain.ComponentInstance{ComponentID: shelf.ID, Quantity: 1})
	catalog.Structures[0].Agregados = []domain.ModuleAgregadoInstance{{
		ID: "agr-ma-inst", AgregadoID: "agr-ma-drawer", Quantity: 3, LayoutDirection: "vertical",
	}}
	catalog.Agregados = []domain.Agregado{{
		ID: "agr-ma-drawer", Code: "CAJON", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-ma-dfront", Quantity: 1}},
	}}
	return module, catalog
}

func assert405BomRoles(t *testing.T, parts []domain.ResolvedBoardPart, expected map[string]parity405RoleExpectation) {
	t.Helper()
	seen := map[string]int{}
	for _, part := range parts {
		want, ok := expected[part.OptionRole]
		if !ok {
			continue
		}
		seen[part.OptionRole]++
		if part.MaterialID != want.MaterialID || part.ThicknessMm != want.ThicknessMm {
			t.Errorf("%s (%s) = %s/%dmm, want %s/%dmm", part.Description, part.OptionRole,
				part.MaterialID, part.ThicknessMm, want.MaterialID, want.ThicknessMm)
		}
	}
	for role := range expected {
		if seen[role] != expected[role].ExpectedCount {
			t.Errorf("role %s count = %d, want %d in BOM", role, seen[role], expected[role].ExpectedCount)
		}
	}
}

func assert405LayoutRoles(t *testing.T, components []LayoutComponent, expected map[string]parity405RoleExpectation) {
	t.Helper()
	seen := map[string]int{}
	for _, component := range components {
		want, ok := expected[component.OptionRole]
		if !ok {
			continue
		}
		seen[component.OptionRole]++
		if component.MaterialID != want.MaterialID || component.ThicknessMm != want.ThicknessMm {
			t.Errorf("%s (%s) = %s/%dmm, want %s/%dmm", component.Name, component.OptionRole,
				component.MaterialID, component.ThicknessMm, want.MaterialID, want.ThicknessMm)
		}
	}
	for role := range expected {
		if seen[role] != expected[role].ExpectedCount {
			t.Errorf("role %s count = %d, want %d in layout", role, seen[role], expected[role].ExpectedCount)
		}
	}
}

func TestMaterialThicknessParityScenarioA_BOMAndLayout(t *testing.T) {
	contract := loadMaterialThicknessParityContract(t)
	scenario := contract.Scenarios["all16"]
	module, catalog := parity405Cabinet()

	bom, err := ResolveBom(module, scenario.Choices, catalog)
	if err != nil {
		t.Fatalf("ResolveBom: %v", err)
	}
	assert405BomRoles(t, bom.BoardParts, scenario.ExpectedRoles)
	if got := findPartByDescription(bom.BoardParts, "Lateral"); got == nil || got.LengthMm != int(scenario.ExpectedFormulaResults["Lateral.lengthMm"]) {
		t.Fatalf("Lateral PH-2*T did not use selected 16mm: %+v", got)
	}
	if got := findPartByDescription(bom.BoardParts, "Piso"); got == nil || got.LengthMm != 568 || got.WidthMm != 544 {
		t.Fatalf("Piso formulas did not use selected 16mm: %+v", got)
	}

	layout, err := ResolveFurnitureLayout(module, catalog, nil, scenario.Choices)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout: %v", err)
	}
	assert405LayoutRoles(t, layout.Components, scenario.ExpectedRoles)
	if layout.DimensionsMm != [3]int{600, 720, 560} {
		t.Fatalf("external dimensions changed: %v", layout.DimensionsMm)
	}
	right := findComponentByID(layout.Components, "lateral_derecho")
	if right == nil || right.Transform.TranslationMm[0] != scenario.ExpectedFormulaResults["Lateral Derecho.xMm"] {
		t.Fatalf("right placement must use PW-T=584: %+v", right)
	}
	fronts := 0
	for i := range layout.Components {
		component := &layout.Components[i]
		if component.OptionRole == "FRONT" {
			fronts++
		}
		if component.SlotID == "frente_cajon" && component.WidthMm != 568 {
			t.Errorf("drawer front PW-2*T = %d, want 568", component.WidthMm)
		}
	}
	if fronts != 4 {
		t.Fatalf("FRONT propagation count = %d, want door + 3 drawer fronts", fronts)
	}
	if len(layout.Hardware) != 1 || layout.Hardware[0].Transform.TranslationMm[1] != scenario.ExpectedFormulaResults["frontHardware.yMm"] {
		t.Fatalf("front hardware did not follow 16mm host face: %+v", layout.Hardware)
	}
}

func TestMaterialThicknessParityScenarioB_MixedRoles(t *testing.T) {
	contract := loadMaterialThicknessParityContract(t)
	scenario := contract.Scenarios["mixed"]
	module, catalog := parity405Cabinet()
	bom, err := ResolveBom(module, scenario.Choices, catalog)
	if err != nil {
		t.Fatalf("ResolveBom: %v", err)
	}
	assert405BomRoles(t, bom.BoardParts, scenario.ExpectedRoles)
	layout, err := ResolveFurnitureLayout(module, catalog, nil, scenario.Choices)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout: %v", err)
	}
	assert405LayoutRoles(t, layout.Components, scenario.ExpectedRoles)
}

func TestMaterialThicknessParityScenarioD_InactiveChoiceFailsBeforeGeometry(t *testing.T) {
	contract := loadMaterialThicknessParityContract(t)
	scenario := contract.Scenarios["failure"]
	module, catalog := parity405Cabinet()
	if _, err := ResolveBom(module, scenario.Choices, catalog); err == nil || !strings.Contains(err.Error(), scenario.ExpectedRejectedRole) {
		t.Fatalf("BOM must reject inactive %s choice, got %v", scenario.ExpectedRejectedRole, err)
	}
	layout, err := ResolveFurnitureLayout(module, catalog, nil, scenario.Choices)
	if err == nil || !strings.Contains(err.Error(), scenario.ExpectedRejectedRole) {
		t.Fatalf("layout must reject inactive %s choice, got %v", scenario.ExpectedRejectedRole, err)
	}
	if layout.Components != nil {
		t.Fatalf("failed layout must not emit geometry: %+v", layout.Components)
	}
}

// Negative proof: before #402 Go used Component.ThicknessMm. With this shared
// fixture that would emit [15,18] for the lateral/base and this test fails.
func TestMaterialThicknessParityNegativeProof_ComponentThicknessCannotWin(t *testing.T) {
	contract := loadMaterialThicknessParityContract(t)
	scenario := contract.Scenarios["all16"]
	module, catalog := parity405Cabinet()
	bom, err := ResolveBom(module, scenario.Choices, catalog)
	if err != nil {
		t.Fatalf("ResolveBom: %v", err)
	}
	side := findPartByDescription(bom.BoardParts, "Lateral")
	base := findPartByDescription(bom.BoardParts, "Piso")
	if side == nil || base == nil {
		t.Fatal("missing negative-proof parts")
	}
	if contract.NominalThicknessMm["Lateral"] != 15 || contract.NominalThicknessMm["Piso"] != 18 {
		t.Fatal("fixture stopped conflicting with selected 16mm material")
	}
	if side.ThicknessMm != 16 || base.ThicknessMm != 16 {
		t.Fatalf("pre-fix comp.ThicknessMm behavior reintroduced: lateral=%d base=%d", side.ThicknessMm, base.ThicknessMm)
	}
}
