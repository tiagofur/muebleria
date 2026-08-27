package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #402 / MT-1 — effective thickness regression fixture.
//
// Nominal thicknesses are DELIBERATELY different from the materials the
// workshop will choose (contract §18: nominal ≠ material, so a green test can
// never come from coincidence):
//
//	nominal:   lateral 15 · base/top 18 · door 18 · back 15 · drawer front 15
//	materials: white16 = 16 mm · oak18 = 18 mm · back6 = 6 mm
//
// Canonical rule under test (docs/architecture/material-aware-furniture-resolution.md §3.3):
//
//	selected active MaterialBoard.thicknessMm > component nominal thickness
//
// Both Go resolvers (BOM + SketchUp layout) must agree with it BEFORE
// evaluating formulas, poses, dimensions, AABBs and hardware anchors.
func materialAwareCabinetCatalog() (domain.Module, domain.Catalog) {
	lateral := domain.Component{
		ID: "comp-ma-side", Code: "LAT", Name: "Lateral", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", ThicknessMm: 15,
		OptionRoles:   []string{"BODY"},
		LengthFormula: "PH - 2*T", WidthFormula: "PD", Active: true,
	}
	lateralR := lateral
	lateralR.ID = "comp-ma-side-r"
	lateralR.Code = "LAT-R"
	lateralR.Name = "Lateral Derecho"
	lateralR.Placement = domain.PlacementLateralDerecho

	base := domain.Component{
		ID: "comp-ma-base", Code: "PISO", Name: "Piso", Placement: domain.PlacementBase,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles:   []string{"BODY"},
		LengthFormula: "PW - 2*T", WidthFormula: "PD - T", Active: true,
	}
	top := base
	top.ID = "comp-ma-top"
	top.Code = "TECHO"
	top.Name = "Techo"
	top.Placement = domain.PlacementSuperior

	back := domain.Component{
		ID: "comp-ma-back", Code: "FONDO", Name: "Fondo", Placement: domain.PlacementTrasera,
		GeometryKind: "rectangular_board", ThicknessMm: 15,
		OptionRoles:   []string{"BACK"},
		LengthFormula: "PH - 2*T", WidthFormula: "PW - 2*T", Active: true,
	}

	door := domain.Component{
		ID: "comp-ma-door", Code: "PTA", Name: "Puerta", Placement: domain.PlacementPuerta,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles:   []string{"FRONT"},
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}

	drawerFront := domain.Component{
		ID: "comp-ma-dfront", Code: "FCAJ", Name: "Frente Cajón", Placement: domain.PlacementFrenteCajon,
		GeometryKind: "rectangular_board", ThicknessMm: 15,
		OptionRoles:   []string{"FRONT"},
		LengthFormula: "PH - 2", WidthFormula: "PW - 2*T", Active: true,
	}

	handle := domain.Hardware{
		ID: "hw-ma-handle", Code: "MAN-160", Name: "Manija 160", Unit: domain.UnitPiece, Active: true,
		PreviewShape:        strPtr("bar-pull"),
		PreviewSizeMm:       floatPtr(160),
		PreviewProjectionMm: floatPtr(37),
		PreviewDiameterMm:   floatPtr(32),
		PreviewColor:        strPtr("#c0c0c0"),
	}

	structure := domain.Structure{
		ID: "st-ma", Code: "CUERPO-BASE", Name: "Cuerpo Base", Active: true,
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-ma-side", Quantity: 1},
			{ComponentID: "comp-ma-side-r", Quantity: 1},
			{ComponentID: "comp-ma-base", Quantity: 1},
			{ComponentID: "comp-ma-top", Quantity: 1},
			{ComponentID: "comp-ma-back", Quantity: 1},
		},
	}

	module := domain.Module{
		ID: "mod-ma", Code: "BASE-600", Name: "Base Una Puerta 600",
		WidthMm: 600, HeightMm: 720, DepthMm: 560, StructureID: "st-ma",
		Components: []domain.ComponentInstance{
			{
				ComponentID: "comp-ma-door", Quantity: 1,
				Overrides: &domain.ComponentInstanceOverrides{
					HardwarePlacements: []domain.HardwarePlacement{{
						HardwareID: "hw-ma-handle", AnchorFace: "front",
						RelativePosition: domain.HardwareRelPosition{XMm: 40, YMm: 360},
					}},
				},
			},
		},
	}

	catalog := domain.Catalog{
		Structures: []domain.Structure{structure},
		Components: []domain.Component{door, drawerFront, lateralR, lateral, base, top, back},
		Hardware:   []domain.Hardware{handle},
	}
	return module, catalog
}

func materialAwareMaterials() []domain.MaterialBoard {
	return []domain.MaterialBoard{
		{ID: "mat-white16", Code: "BLANCO-16", Name: "Blanco 16", ThicknessMm: 16, Active: true},
		{ID: "mat-oak18", Code: "ROBLE-18", Name: "Roble 18", ThicknessMm: 18, Active: true},
		{ID: "mat-back6", Code: "FONDO-6", Name: "Fondo 6", ThicknessMm: 6, Active: true},
		{ID: "mat-ma-inactive", Code: "VIEJO", Name: "Descontinuado", ThicknessMm: 18, Active: false},
		{ID: "mat-zero", Code: "SIN-ESPESOR", Name: "Sin Espesor", ThicknessMm: 0, Active: true},
	}
}

func findPartByDescription(parts []domain.ResolvedBoardPart, description string) *domain.ResolvedBoardPart {
	for i := range parts {
		if parts[i].Description == description {
			return &parts[i]
		}
	}
	return nil
}

// thicknessAxisForPlacement returns which workshop AABB axis carries the board
// thickness for each standard placement (X for laterals, Z for horizontals,
// Y for fronts/doors/backs).
func thicknessAxisForPlacement(slot string) int {
	switch slot {
	case "lateral_izquierdo", "lateral_derecho":
		return 0
	case "base", "superior", "interno":
		return 2
	case "puerta", "frente_cajon", "trasera", "frontal", "custom":
		return 1
	default:
		return 1
	}
}

// ─── Go BOM resolver ──────────────────────────────────────────────────────────

// Mandatory regression case (#402): BODY → 16 mm wins over BOTH nominal
// thicknesses (lateral 15 and base/top 18); every T-dependent formula uses 16.
func TestResolveBom_EffectiveThickness_SelectedMaterialWins(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	choices := map[string]string{"BODY": "mat-white16", "FRONT": "mat-oak18", "BACK": "mat-back6"}

	bom, err := ResolveBom(module, choices, catalog)
	if err != nil {
		t.Fatalf("ResolveBom: %v", err)
	}

	// Nominal 15 lateral → 16 (PH - 2*T with T=16 → 688, not 690).
	lateral := findPartByDescription(bom.BoardParts, "Lateral")
	if lateral == nil {
		t.Fatal("missing Lateral part")
	}
	if lateral.ThicknessMm != 16 {
		t.Fatalf("lateral nominal 15 with BODY=16mm material must resolve thickness 16, got %d", lateral.ThicknessMm)
	}
	if lateral.LengthMm != 688 {
		t.Fatalf("lateral PH-2*T must use T=16 (688), got %d", lateral.LengthMm)
	}

	// Nominal 18 base → 16 (PW - 2*T = 568 and PD - T = 544, both with T=16).
	base := findPartByDescription(bom.BoardParts, "Piso")
	if base == nil {
		t.Fatal("missing Piso part")
	}
	if base.ThicknessMm != 16 {
		t.Fatalf("base nominal 18 with BODY=16mm material must resolve thickness 16, got %d", base.ThicknessMm)
	}
	if base.LengthMm != 568 {
		t.Fatalf("base PW-2*T must use T=16 (568), got %d", base.LengthMm)
	}
	if base.WidthMm != 544 {
		t.Fatalf("base PD-T must use T=16 (544), got %d", base.WidthMm)
	}

	// Mixed roles isolate: FRONT keeps its own 18, BACK its own 6.
	doorPart := findPartByDescription(bom.BoardParts, "Puerta")
	if doorPart == nil || doorPart.ThicknessMm != 18 {
		t.Fatalf("door (FRONT=oak18) must resolve thickness 18, got %+v", doorPart)
	}
	backPart := findPartByDescription(bom.BoardParts, "Fondo")
	if backPart == nil {
		t.Fatal("missing Fondo part")
	}
	if backPart.ThicknessMm != 6 {
		t.Fatalf("back (BACK=back6) must resolve thickness 6, got %d", backPart.ThicknessMm)
	}
	if backPart.LengthMm != 708 || backPart.WidthMm != 588 {
		t.Fatalf("back formulas must use T=6 (708x588), got %dx%d", backPart.LengthMm, backPart.WidthMm)
	}
}

// Mixed materials (BODY=16 / FRONT=18 / BACK=6) resolve distinct effective
// thicknesses inside the same BOM.
func TestResolveBom_EffectiveThickness_MixedRoles(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	choices := map[string]string{"BODY": "mat-white16", "FRONT": "mat-oak18", "BACK": "mat-back6"}

	bom, err := ResolveBom(module, choices, catalog)
	if err != nil {
		t.Fatalf("ResolveBom: %v", err)
	}

	want := map[string]int{"Lateral": 16, "Lateral Derecho": 16, "Piso": 16, "Techo": 16, "Puerta": 18, "Fondo": 6}
	seen := map[string]int{}
	for _, part := range bom.BoardParts {
		if exp, ok := want[part.Description]; ok {
			seen[part.Description]++
			if part.ThicknessMm != exp {
				t.Errorf("part %q thickness = %d, want %d", part.Description, part.ThicknessMm, exp)
			}
		}
	}
	for description := range want {
		if seen[description] == 0 {
			t.Errorf("missing part %q in BOM", description)
		}
	}
}

// Agregado inner components resolve their own material thickness (nominal 15
// drawer front + FRONT=18 → 18, and PW-2*T uses T=18).
func TestResolveBom_EffectiveThickness_AgregadoFronts(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	module.Components = nil // drawers take the front
	catalog.Structures[0].Agregados = []domain.ModuleAgregadoInstance{{
		ID: "agr-ma-inst", AgregadoID: "agr-ma-drawer", Quantity: 3, LayoutDirection: "vertical",
	}}
	catalog.Agregados = []domain.Agregado{{
		ID: "agr-ma-drawer", Code: "CAJON", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-ma-dfront", Quantity: 1}},
	}}

	bom, err := ResolveBom(module, map[string]string{"BODY": "mat-white16", "FRONT": "mat-oak18", "BACK": "mat-back6"}, catalog)
	if err != nil {
		t.Fatalf("ResolveBom: %v", err)
	}

	fronts := 0
	for _, part := range bom.BoardParts {
		if part.Description != "Frente Cajón" {
			continue
		}
		fronts++
		if part.ThicknessMm != 18 {
			t.Errorf("drawer front nominal 15 with FRONT=18mm material must resolve 18, got %d", part.ThicknessMm)
		}
		if part.WidthMm != 564 {
			t.Errorf("drawer front PW-2*T must use T=18 (564), got %d", part.WidthMm)
		}
	}
	if fronts != 3 {
		t.Fatalf("expected 3 drawer fronts from the agregado, got %d", fronts)
	}
}

// An explicit choice pointing at an unknown / inactive / zero-thickness
// material fails loudly before any geometry is produced.
func TestResolveBom_EffectiveThickness_FailLoudly(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	base := map[string]string{"FRONT": "mat-oak18", "BACK": "mat-back6"}

	for role, matID := range map[string]string{"unknown": "mat-nope", "inactive": "mat-ma-inactive", "zero-thickness": "mat-zero"} {
		choices := map[string]string{"BODY": matID}
		for k, v := range base {
			choices[k] = v
		}
		_, err := ResolveBom(module, choices, catalog)
		if err == nil {
			t.Fatalf("%s selected material must fail loudly", role)
		}
		if !strings.Contains(err.Error(), "BODY") {
			t.Fatalf("%s error must identify the role, got: %v", role, err)
		}
	}
}

// ─── Go layout resolver (SketchUp) ────────────────────────────────────────────

// Mandatory regression case (#402) on the layout path: BODY → 16 mm drives
// formulas, right-side pose (PW − T), board thickness, AABB and the emitted
// LayoutComponent.ThicknessMm — while the furniture's external width stays 600.
func TestResolveFurnitureLayout_EffectiveThickness_BodySelected16(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()

	layout, err := ResolveFurnitureLayout(module, catalog, nil, map[string]string{"BODY": "mat-white16"})
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	if layout.DimensionsMm != [3]int{600, 720, 560} {
		t.Fatalf("external dims must stay 600x720x560, got %v", layout.DimensionsMm)
	}

	// Left side: nominal 15 → 16. L = PH-2*T = 688; AABB (T, D, L) = 16x560x688.
	left := findComponentByID(layout.Components, "lateral_izquierdo")
	if left == nil {
		t.Fatalf("missing lateral_izquierdo: %+v", layout.Components)
	}
	if left.ThicknessMm != 16 {
		t.Fatalf("left side thickness = %d, want 16 (selected material)", left.ThicknessMm)
	}
	if left.LengthMm != 688 || left.WidthMm != 560 {
		t.Fatalf("left side L/W = %d/%d, want 688/560 (T=16)", left.LengthMm, left.WidthMm)
	}
	if left.DimensionsMm != [3]float64{16, 560, 688} {
		t.Fatalf("left side AABB = %v, want [16 560 688]", left.DimensionsMm)
	}

	// Right side pose: x = PW − T with the selected 16 mm.
	right := findComponentByID(layout.Components, "lateral_derecho")
	if right == nil {
		t.Fatalf("missing lateral_derecho: %+v", layout.Components)
	}
	if right.Transform.TranslationMm[0] != 584 {
		t.Fatalf("right side x = %v, want PW-T=584 with T=16", right.Transform.TranslationMm[0])
	}

	// Base: nominal 18 → 16. PW-2*T = 568, PD-T = 544; AABB (568, 544, 16).
	baseComp := findComponentByID(layout.Components, "base")
	if baseComp == nil {
		t.Fatalf("missing base: %+v", layout.Components)
	}
	if baseComp.ThicknessMm != 16 {
		t.Fatalf("base thickness = %d, want 16 (selected material beats nominal 18)", baseComp.ThicknessMm)
	}
	if baseComp.LengthMm != 568 || baseComp.WidthMm != 544 {
		t.Fatalf("base L/W = %d/%d, want 568/544 (T=16)", baseComp.LengthMm, baseComp.WidthMm)
	}
	if baseComp.DimensionsMm != [3]float64{568, 544, 16} {
		t.Fatalf("base AABB = %v, want [568 544 16]", baseComp.DimensionsMm)
	}

	// FRONT has no choice yet: deterministic nominal fallback (18).
	door := findComponentByID(layout.Components, "puerta")
	if door == nil || door.ThicknessMm != 18 {
		t.Fatalf("door without FRONT choice must keep nominal 18, got %+v", door)
	}

	// Thickness/AABB consistency: the placement's thickness axis carries
	// exactly LayoutComponent.ThicknessMm on every component.
	for i := range layout.Components {
		c := &layout.Components[i]
		axis := thicknessAxisForPlacement(c.SlotID)
		if c.DimensionsMm[axis] != float64(c.ThicknessMm) {
			t.Fatalf("component %q: ThicknessMm=%d disagrees with AABB axis %d (%v)",
				c.Name, c.ThicknessMm, axis, c.DimensionsMm)
		}
	}
}

// Mixed materials (BODY=16 / FRONT=18 / BACK=6) in the same furniture layout.
func TestResolveFurnitureLayout_EffectiveThickness_MixedRoles(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	choices := map[string]string{"BODY": "mat-white16", "FRONT": "mat-oak18", "BACK": "mat-back6"}

	layout, err := ResolveFurnitureLayout(module, catalog, nil, choices)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	body := map[string]bool{"lateral_izquierdo": true, "lateral_derecho": true, "base": true, "superior": true}
	for i := range layout.Components {
		c := &layout.Components[i]
		switch {
		case body[c.SlotID]:
			if c.ThicknessMm != 16 || c.MaterialID != "mat-white16" {
				t.Errorf("BODY component %q = %d mm (%s), want 16 (mat-white16)", c.Name, c.ThicknessMm, c.MaterialID)
			}
		case c.SlotID == "puerta":
			if c.ThicknessMm != 18 || c.MaterialID != "mat-oak18" {
				t.Errorf("FRONT door = %d mm (%s), want 18 (mat-oak18)", c.ThicknessMm, c.MaterialID)
			}
			if c.DimensionsMm != [3]float64{596, 18, 716} {
				t.Errorf("door AABB = %v, want [596 18 716] with T=18", c.DimensionsMm)
			}
		case c.SlotID == "trasera":
			if c.ThicknessMm != 6 || c.MaterialID != "mat-back6" {
				t.Errorf("BACK panel = %d mm (%s), want 6 (mat-back6)", c.ThicknessMm, c.MaterialID)
			}
			if c.LengthMm != 708 || c.WidthMm != 588 {
				t.Errorf("back L/W = %d/%d, want 708/588 (T=6)", c.LengthMm, c.WidthMm)
			}
			if c.DimensionsMm != [3]float64{588, 6, 708} {
				t.Errorf("back AABB = %v, want [588 6 708] with T=6", c.DimensionsMm)
			}
		}
	}
}

// Hardware anchored to FRONT follows the recalculated front geometry: the
// door's front face moves with the selected 16 mm material (560+16=576), not
// with the nominal 18 mm (578).
func TestResolveFurnitureLayout_EffectiveThickness_HardwareFollowsFront(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()

	layout, err := ResolveFurnitureLayout(module, catalog, nil, map[string]string{"FRONT": "mat-white16"})
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	door := findComponentByID(layout.Components, "puerta")
	if door == nil {
		t.Fatalf("missing puerta: %+v", layout.Components)
	}
	if door.ThicknessMm != 16 {
		t.Fatalf("door thickness = %d, want 16 (selected FRONT material)", door.ThicknessMm)
	}
	if door.DimensionsMm[1] != 16 {
		t.Fatalf("door AABB thickness axis = %v, want 16", door.DimensionsMm)
	}

	if len(layout.Hardware) != 1 {
		t.Fatalf("expected the door handle, got %d hardware", len(layout.Hardware))
	}
	handle := layout.Hardware[0]
	if handle.HostComponentInstanceID != door.ComponentInstanceID {
		t.Fatalf("handle must stay anchored to the door: %+v", handle)
	}
	minY := handle.Transform.TranslationMm[1]
	// Front face sits at y = PD + T = 560 + 16 = 576 (nominal 18 would put it at 578).
	if minY < 575.9 || minY >= 577 {
		t.Fatalf("handle must sit on the 16mm recalculated front face (y≈576), got %v", minY)
	}
	if minY+handle.DimensionsMm[1] > 576+37+0.1 {
		t.Fatalf("handle projection exceeds previewProjectionMm from the 576 face: %+v", handle)
	}
}

// Agregado components use their own resolved material thickness — the drawer
// fronts (nominal 15) follow FRONT=18: thickness 18 and PW-2*T with T=18.
func TestResolveFurnitureLayout_EffectiveThickness_AgregadoFronts(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	module.Components = nil // drawers take the front
	catalog.Structures[0].Agregados = []domain.ModuleAgregadoInstance{{
		ID: "agr-ma-inst", AgregadoID: "agr-ma-drawer", Quantity: 3, LayoutDirection: "vertical",
	}}
	catalog.Agregados = []domain.Agregado{{
		ID: "agr-ma-drawer", Code: "CAJON", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-ma-dfront", Quantity: 1}},
	}}

	layout, err := ResolveFurnitureLayout(module, catalog, nil, map[string]string{"FRONT": "mat-oak18"})
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	var fronts []*LayoutComponent
	for i := range layout.Components {
		if layout.Components[i].SlotID == "frente_cajon" {
			fronts = append(fronts, &layout.Components[i])
		}
	}
	if len(fronts) != 3 {
		t.Fatalf("expected 3 drawer fronts, got %d", len(fronts))
	}
	for _, f := range fronts {
		if f.ThicknessMm != 18 {
			t.Fatalf("drawer front nominal 15 with FRONT=18mm must resolve 18, got %d", f.ThicknessMm)
		}
		if f.WidthMm != 564 {
			t.Fatalf("drawer front PW-2*T must use T=18 (564), got %d", f.WidthMm)
		}
		// Unit height is 240 (720/3): the front still fits its unit.
		if f.DimensionsMm[2] > 240 {
			t.Fatalf("drawer front height %v exceeds its 240mm unit", f.DimensionsMm[2])
		}
	}
	if fronts[2].Transform.TranslationMm[2] <= fronts[0].Transform.TranslationMm[2] {
		t.Fatalf("vertical units must stack upward: z0=%v z2=%v",
			fronts[0].Transform.TranslationMm[2], fronts[2].Transform.TranslationMm[2])
	}
}

// A selected material that is unknown, inactive or thickness-less fails loudly
// BEFORE any layout geometry is emitted.
func TestResolveFurnitureLayout_EffectiveThickness_FailLoudly(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()

	for name, choice := range map[string]string{
		"unknown":        "mat-nope",
		"inactive":       "mat-ma-inactive",
		"zero-thickness": "mat-zero",
	} {
		layout, err := ResolveFurnitureLayout(module, catalog, nil, map[string]string{"BODY": choice})
		if err == nil {
			t.Fatalf("%s selected material must fail loudly", name)
		}
		if !strings.Contains(err.Error(), "BODY") {
			t.Fatalf("%s error must identify the role, got: %v", name, err)
		}
		if layout.Components != nil {
			t.Fatalf("%s must not emit geometry alongside the error", name)
		}
	}
}

// Legacy flat modules keep the explicit 18 mm stacking fallback only when the
// role has no material choice; a selected material drives the real thickness.
func TestResolveFurnitureLayout_EffectiveThickness_LegacyStack(t *testing.T) {
	legacyEdges := []domain.EdgeAssignment{
		{Side: "L1"}, {Side: "L2"}, {Side: "W1"}, {Side: "W2"},
	}
	module := domain.Module{
		ID: "mod-ma-legacy", Code: "LEGACY", Name: "Módulo Legado",
		WidthMm: 600, HeightMm: 720, DepthMm: 500,
		BoardParts: []domain.BoardPart{
			{ID: "lp1", Description: "Lateral Izq", Quantity: 1, LengthMm: 702, WidthMm: 500, OptionRole: "BODY", Edges: legacyEdges},
			{ID: "lp2", Description: "Lateral Der", Quantity: 1, LengthMm: 702, WidthMm: 500, OptionRole: "BODY", Edges: legacyEdges},
		},
	}
	catalog := domain.Catalog{Materials: materialAwareMaterials()}

	// No choice → explicit legacy 18 mm fallback.
	plain, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("legacy layout: %v", err)
	}
	if plain.Components[0].ThicknessMm != 18 || plain.Components[1].Transform.TranslationMm[2] != 18 {
		t.Fatalf("legacy fallback must stay 18mm/18mm stacking, got %+v", plain.Components)
	}

	// Selected BODY material → its thickness drives board + stacking.
	chosen, err := ResolveFurnitureLayout(module, catalog, nil, map[string]string{"BODY": "mat-white16"})
	if err != nil {
		t.Fatalf("legacy layout with choice: %v", err)
	}
	if chosen.Components[0].ThicknessMm != 16 || chosen.Components[0].MaterialID != "mat-white16" {
		t.Fatalf("legacy lateral must use the selected 16mm material, got %+v", chosen.Components[0])
	}
	if chosen.Components[1].Transform.TranslationMm[2] != 16 {
		t.Fatalf("legacy stacking must use the effective 16mm thickness, got %v",
			chosen.Components[1].Transform.TranslationMm[2])
	}
}

// No choice at all → deterministic nominal thicknesses (preview behavior).
func TestResolveFurnitureLayout_EffectiveThickness_NoChoiceKeepsNominal(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	left := findComponentByID(layout.Components, "lateral_izquierdo")
	if left == nil || left.ThicknessMm != 15 || left.LengthMm != 690 {
		t.Fatalf("lateral without choice must keep nominal 15 (L=690), got %+v", left)
	}
	baseComp := findComponentByID(layout.Components, "base")
	if baseComp == nil || baseComp.ThicknessMm != 18 || baseComp.LengthMm != 564 {
		t.Fatalf("base without choice must keep nominal 18 (L=564), got %+v", baseComp)
	}
}
