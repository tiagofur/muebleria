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
	Choices                   map[string]string                   `json:"choices"`
	BeforeChoices             map[string]string                   `json:"beforeChoices"`
	AfterChoices              map[string]string                   `json:"afterChoices"`
	AffectedRole              string                              `json:"affectedRole"`
	ExpectedAffectedCount     int                                 `json:"expectedAffectedCount"`
	ExpectedUnaffectedRoles   []string                            `json:"expectedUnaffectedRoles"`
	ExpectedHardwareYBeforeMm float64                             `json:"expectedHardwareYBeforeMm"`
	ExpectedHardwareYAfterMm  float64                             `json:"expectedHardwareYAfterMm"`
	ExpectedRoles             map[string]parity405RoleExpectation `json:"expectedRoles"`
	ExpectedFormulaResults    map[string]float64                  `json:"expectedFormulaResults"`
	ExpectedRejectedRole      string                              `json:"expectedRejectedRole"`
}

type parity405Contract struct {
	FurnitureDimensionsMm [3]int                       `json:"furnitureDimensionsMm"`
	NominalThicknessMm    map[string]int               `json:"nominalThicknessMm"`
	Scenarios             map[string]parity405Scenario `json:"scenarios"`
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

func TestMaterialThicknessParityScenarioC_FrontUpdateIsolatedAcrossBomAndLayout(t *testing.T) {
	contract := loadMaterialThicknessParityContract(t)
	scenario := contract.Scenarios["frontUpdate"]
	module, catalog := parity405Cabinet()

	beforeBom, err := ResolveBom(module, scenario.BeforeChoices, catalog)
	if err != nil {
		t.Fatalf("ResolveBom before FRONT update: %v", err)
	}
	afterBom, err := ResolveBom(module, scenario.AfterChoices, catalog)
	if err != nil {
		t.Fatalf("ResolveBom after FRONT update: %v", err)
	}
	beforeBomByID := map[string]domain.ResolvedBoardPart{}
	for _, part := range beforeBom.BoardParts {
		beforeBomByID[part.ID] = part
	}
	changedBom := 0
	for _, after := range afterBom.BoardParts {
		before, ok := beforeBomByID[after.ID]
		if !ok {
			t.Fatalf("BOM part %s appeared only after FRONT update", after.ID)
		}
		changed := before.MaterialID != after.MaterialID || before.ThicknessMm != after.ThicknessMm ||
			before.LengthMm != after.LengthMm || before.WidthMm != after.WidthMm
		if after.OptionRole == scenario.AffectedRole {
			if !changed {
				t.Errorf("affected BOM part %s (%s) did not change", after.ID, after.Description)
			}
			changedBom++
			continue
		}
		if contains405Role(scenario.ExpectedUnaffectedRoles, after.OptionRole) && changed {
			t.Errorf("unaffected BOM part %s (%s/%s) changed: before=%+v after=%+v",
				after.ID, after.Description, after.OptionRole, before, after)
		}
	}
	if changedBom != scenario.ExpectedAffectedCount {
		t.Fatalf("changed FRONT BOM parts = %d, want %d", changedBom, scenario.ExpectedAffectedCount)
	}

	beforeLayout, err := ResolveFurnitureLayout(module, catalog, nil, scenario.BeforeChoices)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout before FRONT update: %v", err)
	}
	afterLayout, err := ResolveFurnitureLayout(module, catalog, nil, scenario.AfterChoices)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout after FRONT update: %v", err)
	}
	if beforeLayout.DimensionsMm != contract.FurnitureDimensionsMm || afterLayout.DimensionsMm != contract.FurnitureDimensionsMm {
		t.Fatalf("FRONT update changed external dimensions: before=%v after=%v want=%v",
			beforeLayout.DimensionsMm, afterLayout.DimensionsMm, contract.FurnitureDimensionsMm)
	}
	beforeLayoutByID := map[string]LayoutComponent{}
	for _, component := range beforeLayout.Components {
		beforeLayoutByID[component.ComponentInstanceID] = component
	}
	changedLayout := 0
	for _, after := range afterLayout.Components {
		before, ok := beforeLayoutByID[after.ComponentInstanceID]
		if !ok {
			t.Fatalf("layout component %s appeared only after FRONT update", after.ComponentInstanceID)
		}
		changed := !same405LayoutSemantics(before, after)
		if after.OptionRole == scenario.AffectedRole {
			if !changed {
				t.Errorf("affected layout component %s (%s) did not change", after.ComponentInstanceID, after.Name)
			}
			changedLayout++
			continue
		}
		if contains405Role(scenario.ExpectedUnaffectedRoles, after.OptionRole) && changed {
			t.Errorf("unaffected layout component %s (%s/%s) changed: before=%+v after=%+v",
				after.ComponentInstanceID, after.Name, after.OptionRole, before, after)
		}
	}
	if changedLayout != scenario.ExpectedAffectedCount {
		t.Fatalf("changed FRONT layout components = %d, want %d", changedLayout, scenario.ExpectedAffectedCount)
	}
	if len(beforeLayout.Hardware) != 1 || len(afterLayout.Hardware) != 1 {
		t.Fatalf("expected one front-hosted hardware placement before/after, got %d/%d",
			len(beforeLayout.Hardware), len(afterLayout.Hardware))
	}
	beforeHardware, afterHardware := beforeLayout.Hardware[0], afterLayout.Hardware[0]
	if beforeHardware.HostComponentInstanceID != afterHardware.HostComponentInstanceID {
		t.Fatalf("hardware host identity changed: %s -> %s",
			beforeHardware.HostComponentInstanceID, afterHardware.HostComponentInstanceID)
	}
	if beforeHardware.Transform.TranslationMm[1] != scenario.ExpectedHardwareYBeforeMm ||
		afterHardware.Transform.TranslationMm[1] != scenario.ExpectedHardwareYAfterMm {
		t.Fatalf("front hardware did not recompute with host thickness: before=%v after=%v",
			beforeHardware.Transform.TranslationMm, afterHardware.Transform.TranslationMm)
	}
}

func contains405Role(roles []string, role string) bool {
	for _, candidate := range roles {
		if candidate == role {
			return true
		}
	}
	return false
}

func same405LayoutSemantics(a, b LayoutComponent) bool {
	return a.ComponentInstanceID == b.ComponentInstanceID &&
		a.ComponentDefinitionID == b.ComponentDefinitionID &&
		a.OptionRole == b.OptionRole &&
		a.MaterialID == b.MaterialID &&
		a.ThicknessMm == b.ThicknessMm &&
		a.LengthMm == b.LengthMm &&
		a.WidthMm == b.WidthMm &&
		a.Transform == b.Transform &&
		a.DimensionsMm == b.DimensionsMm &&
		a.LocalTransform == b.LocalTransform
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
