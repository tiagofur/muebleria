package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1579 PR2 — the hinge count rule pattern on aggregate doors (Go mirror of
// packages/domain/src/hingeCountRule.test.ts): the pattern buys through the
// exclusive hingeband-agr line with the REAL bay dims, the module band
// collector must not double count, fixed placements of the same hardware
// win, and recipes without the pattern stay byte-identical (the pins in
// hinge_agregado_characterization_test.go stay green).

// countRuleDoorCatalog builds the aggregate-door fixture: one door component
// (formulas PH-3 / PW-3 like the owner's COM-PUE-*) with a count-rule
// pattern + a fixed jaladera, inside a composed module.
func countRuleDoorCatalog(doorHeightMm int, patternRole string) (domain.Module, domain.Catalog) {
	sideComp := domain.Component{
		ID: "comp-side-izq", Code: "COM-COS-IZQ", Name: "Costado Izq.",
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		Placement: domain.PlacementLateralIzquierdo, OptionRoles: []string{"INTERIOR"},
		WidthFormula: "PD", LengthFormula: "PH", Active: true,
	}
	doorComp := domain.Component{
		ID: "comp-door", Code: "PUERTA", Name: "Puerta",
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		Placement: domain.PlacementPuerta, OptionRoles: []string{"FRENTES"},
		WidthFormula: "PW - 3", LengthFormula: "PH - 3", Active: true,
	}
	hwShape := "hinge"
	hwStandard := domain.Hardware{ID: "hw-standard", Code: "BIS-STD", Name: "Bisagra estándar", Active: true, CostPerUnit: 40, PreviewShape: &hwShape}
	hwReinforced := domain.Hardware{ID: "hw-reinforced", Code: "BIS-REF", Name: "Bisagra reforzada", Active: true, CostPerUnit: 45}
	hwJaladera := domain.Hardware{ID: "hw-jaladera", Code: "JAL-STD", Name: "Jaladera estándar", Active: true, CostPerUnit: 30}
	hwReinforced.HingeDemand = hingeTableWithSurge(600,
		domain.HingeDemandBand{UpToHeightMm: 900, Hinges: 2},
		domain.HingeDemandBand{UpToHeightMm: 1200, Hinges: 3},
		domain.HingeDemandBand{UpToHeightMm: 2000, Hinges: 5},
		domain.HingeDemandBand{UpToHeightMm: 2400, Hinges: 5},
	)
	agr := domain.Agregado{
		ID: "agr-pue", Code: "AGR-PUE-DER", Name: "Puerta Derecha", Active: true,
		WidthMm: 597, HeightMm: doorHeightMm - 3,
		Components: []domain.ComponentInstance{{
			ComponentID: "comp-door", Quantity: 1, PlacementOverride: ptrPlacement(domain.PlacementPuerta),
			Overrides: &domain.ComponentInstanceOverrides{
				HardwarePlacements: []domain.HardwarePlacement{
					{
						OptionRole: patternRole, AnchorFace: "back",
						CountRule:        &domain.HingeCountRule{Kind: "hingeDemand", EndOffsetBottomMm: 90, EndOffsetTopMm: 90},
						RelativePosition: domain.HardwareRelPosition{XMm: 20.5, YMm: 90, XFormula: "PW-20.5"},
					},
					{
						HardwareID: "hw-jaladera", AnchorFace: "front",
						RelativePosition: domain.HardwareRelPosition{XMm: 0, YMm: 50, XFormula: "PW-30"},
					},
				},
			},
		}},
	}
	st := domain.Structure{
		ID: "st-1", Code: "EST", Name: "Cuerpo",
		WidthMm: 600, HeightMm: doorHeightMm, DepthMm: 560, Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-side-izq", Quantity: 1}},
	}
	mod := domain.Module{
		ID: "mod-1", Code: "MOD-PUE", Name: "Con puerta patrón",
		StructureID: "st-1", WidthMm: 600, HeightMm: doorHeightMm, DepthMm: 560,
		Agregados: []domain.ModuleAgregadoInstance{{ID: "inst-door", AgregadoID: "agr-pue", Quantity: 1}},
	}
	catalog := domain.Catalog{
		Materials:  []domain.MaterialBoard{{ID: "mat-1", Code: "MEL-18", Name: "Melamina 18", ThicknessMm: 18, Active: true}},
		Hardware:   []domain.Hardware{hwStandard, hwReinforced, hwJaladera},
		Structures: []domain.Structure{st},
		Components: []domain.Component{sideComp, doorComp},
		Agregados:  []domain.Agregado{agr},
		Modules:    []domain.Module{mod},
	}
	return mod, catalog
}

func countRuleLines(bom domain.ResolvedBom) []domain.ResolvedHardwareLine {
	out := make([]domain.ResolvedHardwareLine, 0)
	for _, line := range bom.HardwareLines {
		if strings.HasPrefix(line.ID, domain.HingeDemandLinePrefix+"agr-") {
			out = append(out, line)
		}
	}
	return out
}

func TestHingeCountRuleDemandIsExclusive(t *testing.T) {
	mod, catalog := countRuleDoorCatalog(2100, domain.HingeDemandRole)
	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	bom, err := ResolveBom(mod, choices, catalog)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	// Door 2097 mm (PH-3) under the standard table → ≤2400 → 5, no overflow.
	lines := countRuleLines(bom)
	if len(lines) != 1 {
		t.Fatalf("expected exactly one pattern line, got %+v", bom.HardwareLines)
	}
	line := lines[0]
	if line.HardwareID != "hw-standard" || line.Quantity != 5 {
		t.Fatalf("pattern line = %+v, want hw-standard ×5", line)
	}
	wantID := domain.HingeDemandLinePrefix + "agr-inst-door-u0-hw-standard"
	if line.ID != wantID {
		t.Fatalf("pattern id = %q, want %q (TS parity)", line.ID, wantID)
	}
	if line.Notice != "" {
		t.Fatalf("2097 mm does not overflow: unexpected notice %q", line.Notice)
	}
	// No duplicate from the module band collector, no POSITIONED pattern line.
	for _, other := range bom.HardwareLines {
		if other.HardwareID == "hw-standard" && other.ID != line.ID {
			t.Fatalf("pattern hardware counted twice: %+v", other)
		}
	}
	// La jaladera por placement en un agregado NO cotiza en Go (la demanda de
	// placements de agregado vive del lado TS — división preexistente que los
	// pins de caracterización documentan). El patrón no la toca.
	for _, other := range bom.HardwareLines {
		if other.OptionRole == "JALADERA" {
			t.Fatalf("aggregate placements never quote in Go: %+v", other)
		}
	}
}

func TestHingeCountRuleDifferentHingesBuyDifferently(t *testing.T) {
	// 1497 mm (PH-3): the standard table → ≤1600 → 3; the reinforced one's
	// steeper table → ≤2000 → 5. Same door, same group, different choice.
	mod, catalog := countRuleDoorCatalog(1500, domain.HingeDemandRole)
	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	bom, err := ResolveBom(mod, choices, catalog)
	if err != nil {
		t.Fatalf("resolve standard: %v", err)
	}
	if lines := countRuleLines(bom); len(lines) != 1 || lines[0].Quantity != 3 {
		t.Fatalf("standard = %+v, want ×3", countRuleLines(bom))
	}

	choices[domain.HingeDemandRole] = "hw-reinforced"
	bom, err = ResolveBom(mod, choices, catalog)
	if err != nil {
		t.Fatalf("resolve reinforced: %v", err)
	}
	lines := countRuleLines(bom)
	if len(lines) != 1 || lines[0].Quantity != 5 || lines[0].HardwareID != "hw-reinforced" {
		t.Fatalf("reinforced = %+v, want hw-reinforced ×5", lines)
	}
}

func TestHingeCountRuleFixedPlacementsWin(t *testing.T) {
	// A recipe that ALSO carries 2 fixed hinge placements of the same
	// hardware: authored intent wins — the pattern neither draws nor demands.
	mod, catalog := countRuleDoorCatalog(720, domain.HingeDemandRole)
	agr := &catalog.Agregados[0]
	agr.Components[0].Overrides.HardwarePlacements = append([]domain.HardwarePlacement{
		{OptionRole: domain.HingeDemandRole, AnchorFace: "back", RelativePosition: domain.HardwareRelPosition{XMm: 20.5, YMm: 90}},
		{OptionRole: domain.HingeDemandRole, AnchorFace: "back", RelativePosition: domain.HardwareRelPosition{XMm: 20.5, YMm: 100}},
	}, agr.Components[0].Overrides.HardwarePlacements...)

	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	bom, err := ResolveBom(mod, choices, catalog)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	// Go no cotiza placements de agregado (división preexistente): la
	// invariant aquí es que el patrón SUPRIMIDO no aporta línea ninguna y el
	// dibujo conserva sólo las 2 fijas.
	if lines := countRuleLines(bom); len(lines) != 0 {
		t.Fatalf("suppressed pattern must not demand, got %+v", lines)
	}
}

func TestHingeCountRuleWithoutPatternIsByteIdentical(t *testing.T) {
	// The pins in hinge_agregado_characterization_test.go already prove the
	// FRENTES shape without a pattern stays byte-identical; this covers the
	// count-rule wiring itself: with NO instance declaring a pattern, the
	// countRule machinery contributes nothing.
	mod, catalog := countRuleDoorCatalog(2100, domain.HingeDemandRole)
	agr := &catalog.Agregados[0]
	agr.Components[0].Overrides.HardwarePlacements[0].CountRule = nil

	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	bom, err := ResolveBom(mod, choices, catalog)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if lines := countRuleLines(bom); len(lines) != 0 {
		t.Fatalf("no pattern → no pattern lines, got %+v", lines)
	}
}

func TestHingeCountRuleLayoutExpandsPositions(t *testing.T) {
	// The layout (SketchUp drawing) shows exactly what the quote buys: N
	// hinge placements at the expanded positions on the door board.
	mod, catalog := countRuleDoorCatalog(2100, domain.HingeDemandRole)
	choices := map[string]string{
		"INTERIOR": "mat-1", "FRENTES": "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	layout, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module:        mod,
		Catalog:       catalog,
		Dims:          &LayoutDims{WidthMm: 600, HeightMm: 2100, DepthMm: 560},
		OptionChoices: choices,
	})
	if err != nil {
		t.Fatalf("layout resolve: %v", err)
	}
	positions := 0
	for _, hw := range layout.Layout.Hardware {
		if hw.HardwareID != "hw-standard" {
			continue
		}
		positions++
	}
	if positions != 5 {
		t.Fatalf("layout draws %d pattern hinges, want 5", positions)
	}
}
func TestHingeCountRuleKillsRecipeBulkOfSameHardware(t *testing.T) {
	// The owner's migrated shape (AGR-PUE-2P): the recipe carries a bulk
	// hinge line AND the pattern. The exclusive hingeband-agr line buys the
	// pattern; the recipe bulk of the same hardware must die (CRITICAL from
	// the judgment round: the covered map was keyed wrong and both quoted).
	mod, catalog := countRuleDoorCatalog(2100, domain.HingeDemandRole)
	agr := &catalog.Agregados[0]
	agr.HardwareLines = []domain.HardwareLine{{
		ID: "agr-bulk-bisagra", Quantity: 3, OptionRole: domain.HingeDemandRole,
	}}

	choices := map[string]string{
		"INTERIOR":             "mat-1",
		"FRENTES":              "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	bom, err := ResolveBom(mod, choices, catalog)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	standard := 0.0
	sawBulk := false
	for _, line := range bom.HardwareLines {
		if line.HardwareID != "hw-standard" {
			continue
		}
		standard += line.Quantity
		if line.ID == "agr-bulk-bisagra" {
			sawBulk = true
		}
	}
	if sawBulk {
		t.Fatalf("the recipe bulk of the pattern hardware must die: %+v", bom.HardwareLines)
	}
	if standard != 5 {
		t.Fatalf("pattern hardware total = %v, want 5 (2097 door under the standard table)", standard)
	}
}
