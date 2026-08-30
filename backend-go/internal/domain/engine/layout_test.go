package engine

import (
	"math"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// oneDoorCabinetCatalog builds a composed module whose structure is a classic
// one-door base cabinet: left/right sides, floor (base), top (superior), back
// panel and an overlay door carrying a bar-pull handle — the exact shape the
// workshop authors in the React app.
func oneDoorCabinetCatalog() (domain.Module, domain.Catalog) {
	lateral := domain.Component{
		ID: "comp-side", Code: "LAT", Name: "Lateral", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", LengthMm: 0, WidthMm: 0, ThicknessMm: 18,
		OptionRoles:   []string{"LATERAL"},
		LengthFormula: "PH - 2*T", WidthFormula: "PD", Active: true,
	}
	right := lateral
	right.ID = "comp-side-r"
	right.Code = "LAT-R"
	right.Name = "Lateral Derecho"
	right.Placement = domain.PlacementLateralDerecho

	floor := domain.Component{
		ID: "comp-base", Code: "PISO", Name: "Piso", Placement: domain.PlacementBase,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles:   []string{"INTERIOR"},
		LengthFormula: "PW - 2*T", WidthFormula: "PD - T", Active: true,
	}
	top := floor
	top.ID = "comp-top"
	top.Code = "TECHO"
	top.Name = "Techo"
	top.Placement = domain.PlacementSuperior

	back := domain.Component{
		ID: "comp-back", Code: "FONDO", Name: "Fondo", Placement: domain.PlacementTrasera,
		GeometryKind: "rectangular_board", ThicknessMm: 15,
		OptionRoles:   []string{"FONDO"},
		LengthFormula: "PW - 2*T", WidthFormula: "PH - 2*T", Active: true,
	}

	door := domain.Component{
		ID: "comp-door", Code: "PTA", Name: "Puerta", Placement: domain.PlacementPuerta,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles: []string{"FRENTE"},
		// Board length runs vertically (PH), width runs along the cabinet (PW).
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}

	handle := domain.Hardware{
		ID: "hw-handle", Code: "MAN-160", Name: "Manija 160", Unit: domain.UnitPiece, Active: true,
		PreviewShape:        strPtr("bar-pull"),
		PreviewSizeMm:       floatPtr(160),
		PreviewProjectionMm: floatPtr(37),
		PreviewDiameterMm:   floatPtr(32),
		PreviewColor:        strPtr("#c0c0c0"),
	}

	structure := domain.Structure{
		ID: "st-1", Code: "CUERPO-BASE", Name: "Cuerpo Base", Active: true,
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-side", Quantity: 1},
			{ComponentID: "comp-side-r", Quantity: 1},
			{ComponentID: "comp-base", Quantity: 1},
			{ComponentID: "comp-top", Quantity: 1},
			{ComponentID: "comp-back", Quantity: 1},
		},
	}

	module := domain.Module{
		ID: "mod-1", Code: "BASE-600", Name: "Base Una Puerta 600",
		WidthMm: 600, HeightMm: 720, DepthMm: 560, StructureID: "st-1",
		Components: []domain.ComponentInstance{
			{
				ComponentID: "comp-door", Quantity: 1,
				Overrides: &domain.ComponentInstanceOverrides{
					HardwarePlacements: []domain.HardwarePlacement{{
						HardwareID: "hw-handle", AnchorFace: "front",
						RelativePosition: domain.HardwareRelPosition{XMm: 40, YMm: 360},
					}},
				},
			},
		},
	}

	catalog := domain.Catalog{
		Structures: []domain.Structure{structure},
		Components: []domain.Component{right, lateral, floor, top, back, door},
		Hardware:   []domain.Hardware{handle},
	}
	return module, catalog
}

func strPtr(s string) *string     { return &s }
func floatPtr(f float64) *float64 { return &f }

func findComponentByID(components []LayoutComponent, slot string) *LayoutComponent {
	for i := range components {
		if components[i].SlotID == slot {
			return &components[i]
		}
	}
	return nil
}

func TestResolveFurnitureLayoutCompleteComposition(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	// The full body + door must materialize: this is the regression behind
	// "solo se generan los laterales" — the old generic fallback rendered 2.
	if len(layout.Components) != 6 {
		t.Fatalf("expected 6 board components (2 laterales, piso, techo, fondo, puerta), got %d: %+v",
			len(layout.Components), layout.Components)
	}
	if layout.DimensionsMm != [3]int{600, 720, 560} {
		t.Fatalf("dimensions = %v", layout.DimensionsMm)
	}

	for _, c := range layout.Components {
		if c.Kind != "board" || c.Name == "" || c.OptionRole == "" {
			t.Fatalf("board component incomplete: %+v", c)
		}
		for k, dim := range c.DimensionsMm {
			if dim <= 0 || math.IsNaN(dim) {
				t.Fatalf("component %s has invalid AABB axis %d: %+v", c.Name, k, c.DimensionsMm)
			}
		}
	}

	// Left side: pose x=0, rot [90,180,90], local box [W=PD=560, T=18, L=PH-2T=684].
	left := findComponentByID(layout.Components, "lateral_izquierdo")
	if left == nil {
		t.Fatalf("missing lateral_izquierdo: %+v", layout.Components)
	}
	if left.LengthMm != 684 || left.WidthMm != 560 || left.ThicknessMm != 18 {
		t.Fatalf("left side L/W/T = %d/%d/%d, want 684/560/18", left.LengthMm, left.WidthMm, left.ThicknessMm)
	}
	// AABB of the rotated side: workshop size (T × D × H) = 18 × 560 × 684 at (0,0,0).
	if left.DimensionsMm != [3]float64{18, 560, 684} {
		t.Fatalf("left side AABB size = %v, want [18 560 684]", left.DimensionsMm)
	}
	if left.Transform.TranslationMm != [3]float64{0, 0, 0} {
		t.Fatalf("left side min corner = %v, want origin", left.Transform.TranslationMm)
	}

	// Right side sits at x = PW − T.
	right := findComponentByID(layout.Components, "lateral_derecho")
	if right == nil || right.Transform.TranslationMm[0] != 582 {
		t.Fatalf("right side must start at PW-T=582, got %+v", right)
	}

	// Door: overlay pose (x=2, y=PD, z=2) with local [W=PW-4=596, T=18, L=PH-4=716].
	door := findComponentByID(layout.Components, "puerta")
	if door == nil {
		t.Fatalf("missing puerta: %+v", layout.Components)
	}
	if door.LengthMm != 716 || door.WidthMm != 596 {
		t.Fatalf("door L/W = %d/%d, want 716/596", door.LengthMm, door.WidthMm)
	}
	// Rotated [90,180,0] door: AABB spans (W along X, T along Y, L along Z).
	if door.DimensionsMm != [3]float64{596, 18, 716} {
		t.Fatalf("door AABB size = %v, want [596 18 716]", door.DimensionsMm)
	}
	if door.Transform.TranslationMm != [3]float64{2, 560, 2} {
		t.Fatalf("door min corner = %v, want [2 560 2]", door.Transform.TranslationMm)
	}
}

func TestResolveFurnitureLayoutHardwarePlacement(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	if len(layout.Hardware) != 1 {
		t.Fatalf("expected the door handle to materialize, got %d hardware", len(layout.Hardware))
	}
	handle := layout.Hardware[0]
	if handle.HardwareID != "hw-handle" || handle.Shape != "bar-pull" || handle.Name != "Manija 160" {
		t.Fatalf("handle identity lost: %+v", handle)
	}
	if handle.HostComponentInstanceID == "" || handle.AnchorFace != "front" {
		t.Fatalf("handle must stay anchored to its host door: %+v", handle)
	}
	if handle.ColorHex != "#c0c0c0" || handle.ProjectionMm != 37 {
		t.Fatalf("handle visual fields lost: %+v", handle)
	}

	// The door board occupies x∈[2, 598], y∈[560, 578], z∈[2, 718] (AABB). The
	// handle sits on the +thickness (front) face: y must start at ≥ 578 and its
	// projection must grow outward (y max ≤ 578+37).
	min := handle.Transform.TranslationMm
	size := handle.DimensionsMm
	if min[1] < 577.9 {
		t.Fatalf("handle must sit outside the door front face (y ≥ 578), got %v", min)
	}
	if min[1]+size[1] > 578+37+0.1 {
		t.Fatalf("handle projection must not exceed previewProjectionMm, spans %v + %v", min, size)
	}
	if min[0] < 2 || min[0]+size[0] > 598+0.1 {
		t.Fatalf("handle must stay within the door width [2,598], got %v + %v", min, size)
	}
	if min[2] < 2 || min[2]+size[2] > 718+0.1 {
		t.Fatalf("handle must stay within the door height [2,718], got %v + %v", min, size)
	}
}

func TestResolveFurnitureLayoutDimsOverride(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()

	layout, err := ResolveFurnitureLayout(module, catalog, &LayoutDims{WidthMm: 900, HeightMm: 800, DepthMm: 560}, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	if layout.DimensionsMm != [3]int{900, 800, 560} {
		t.Fatalf("override dims not applied: %v", layout.DimensionsMm)
	}

	right := findComponentByID(layout.Components, "lateral_derecho")
	if right == nil || right.Transform.TranslationMm[0] != 900-18 {
		t.Fatalf("right side must follow the override width (x=882), got %+v", right)
	}
	door := findComponentByID(layout.Components, "puerta")
	if door == nil || door.LengthMm != 796 {
		t.Fatalf("door length formula must re-evaluate with H=800 (796), got %+v", door)
	}
}

func TestResolveFurnitureLayoutAgregadoUnits(t *testing.T) {
	// A 3-drawer agregado laid out vertically inside the cabinet body.
	drawerFront := domain.Component{
		ID: "comp-dfront", Code: "FRENTE-CAJ", Name: "Frente Cajón", Placement: domain.PlacementFrenteCajon,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles:   []string{"FRENTE"},
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}
	agregado := domain.Agregado{
		ID: "agr-drawer", Code: "CAJON", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-dfront", Quantity: 1}},
	}
	module, catalog := oneDoorCabinetCatalog()
	// Cabinet without the module door: the drawers take the front instead.
	module.Components = []domain.ComponentInstance{}
	catalog.Agregados = append(catalog.Agregados, agregado)
	catalog.Components = append(catalog.Components, drawerFront)
	catalog.Structures[0].Agregados = []domain.ModuleAgregadoInstance{{
		ID: "agr-inst-1", AgregadoID: "agr-drawer", Quantity: 3, LayoutDirection: "vertical",
		// No y offset: the frente_cajon pose already puts each front at the
		// unit's front edge (unit depth defaults to the module depth).
	}}

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	// 5 body boards + 3 drawer fronts.
	if len(layout.Components) != 8 {
		t.Fatalf("expected 8 components with the 3-drawer agregado, got %d: %+v", len(layout.Components), layout.Components)
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
	// Vertical layout in PH=720: each unit spans 240 mm; fronts must stack in z
	// and all sit in front of the body (y = PD = 560).
	for _, f := range fronts {
		if f.Transform.TranslationMm[1] != 560 {
			t.Fatalf("drawer front y = %v, want 560", f.Transform.TranslationMm[1])
		}
		if f.DimensionsMm[2] > 240 {
			t.Fatalf("drawer front height %v exceeds its 240mm unit", f.DimensionsMm[2])
		}
	}
	z0 := fronts[0].Transform.TranslationMm[2]
	z2 := fronts[2].Transform.TranslationMm[2]
	if z2 <= z0 {
		t.Fatalf("vertical units must stack upward: z0=%v z2=%v", z0, z2)
	}
}

func TestResolveFurnitureLayoutLegacyModuleStacksAllPieces(t *testing.T) {
	edges := []domain.EdgeAssignment{
		{Side: "L1"}, {Side: "L2"}, {Side: "W1"}, {Side: "W2"},
	}
	module := domain.Module{
		ID: "mod-legacy", Code: "LEGACY", Name: "Módulo Legado",
		WidthMm: 600, HeightMm: 720, DepthMm: 500,
		BoardParts: []domain.BoardPart{
			{ID: "p1", Description: "Lateral Izq", Quantity: 1, LengthMm: 702, WidthMm: 500, OptionRole: "LATERAL", Edges: edges},
			{ID: "p2", Description: "Lateral Der", Quantity: 1, LengthMm: 702, WidthMm: 500, OptionRole: "LATERAL", Edges: edges},
			{ID: "p3", Description: "Piso", Quantity: 1, LengthMm: 564, WidthMm: 500, OptionRole: "INTERIOR", Edges: edges},
		},
	}

	layout, err := ResolveFurnitureLayout(module, domain.Catalog{}, nil, nil)
	if err != nil {
		t.Fatalf("resolve legacy layout: %v", err)
	}
	// Every authored piece materializes even without spatial data.
	if len(layout.Components) != 3 {
		t.Fatalf("legacy module must render all its pieces, got %d", len(layout.Components))
	}
	if layout.Components[0].Name != "Lateral Izq" || layout.Components[2].Name != "Piso" {
		t.Fatalf("legacy piece names not preserved: %+v", layout.Components)
	}
	// #415 identity on the legacy path: each flat part IS its own
	// single-instance definition, so componentDefinitionId == componentInstanceId
	// is the documented intent (composed components share defID across copies).
	for _, c := range layout.Components {
		if c.ComponentDefinitionID == "" || c.ComponentDefinitionID != c.ComponentInstanceID {
			t.Fatalf("legacy component %s must publish defID == instanceID (single-instance definition), got %q",
				c.ComponentInstanceID, c.ComponentDefinitionID)
		}
	}
}

func TestResolveFurnitureLayoutCostOnlyHardwareRendersNothing(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	catalog.Hardware[0].PreviewShape = nil // cost-only: no preview geometry

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	if len(layout.Hardware) != 0 {
		t.Fatalf("cost-only hardware must not materialize, got %d", len(layout.Hardware))
	}
}

func TestResolveFurnitureLayoutErrors(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()

	// Missing structure.
	broken := module
	broken.StructureID = "st-missing"
	if _, err := ResolveFurnitureLayout(broken, catalog, nil, nil); err == nil {
		t.Fatal("missing structure must fail loudly")
	}

	// Invalid dims.
	if _, err := ResolveFurnitureLayout(module, catalog, &LayoutDims{WidthMm: -5, HeightMm: 720, DepthMm: 500}, nil); err == nil {
		t.Fatal("negative dims must fail loudly")
	}
}

func TestResolveFurnitureLayoutMaterialChoices(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	catalog.Materials = []domain.MaterialBoard{
		{ID: "mat-white", Code: "MEL-BLANCO", Name: "Melamina Blanca", ThicknessMm: 18,
			PreviewColor: "#f5f5f0", Active: true},
		{ID: "mat-oak", Code: "ROBLE-CLARO", Name: "Roble Claro", ThicknessMm: 18,
			PreviewColor: "#c4a574", Active: true},
		{ID: "mat-inactive", Code: "VIEJO", Name: "Descontinuado", Active: false},
	}

	// FRENTE chooses oak; LATERAL stays unchosen (palette fallback).
	layout, err := ResolveFurnitureLayout(module, catalog, nil,
		map[string]string{"FRENTE": "mat-oak"})
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	door := findComponentByID(layout.Components, "puerta")
	if door == nil {
		t.Fatalf("missing puerta: %+v", layout.Components)
	}
	if door.MaterialID != "mat-oak" || door.MaterialCode != "ROBLE-CLARO" ||
		door.MaterialName != "Roble Claro" || door.MaterialColorHex != "#c4a574" {
		t.Fatalf("door material not resolved from the choice: %+v", door)
	}

	left := findComponentByID(layout.Components, "lateral_izquierdo")
	if left == nil || left.MaterialID != "" {
		t.Fatalf("role without choice must keep the palette fallback, got %+v", left)
	}
	if left.MaterialColorHex != colorForOptionRole("LATERAL") {
		t.Fatalf("fallback color lost: %+v", left)
	}

	// Unknown choice fails loudly (typo detection, engine parity).
	if _, err := ResolveFurnitureLayout(module, catalog, nil,
		map[string]string{"FRENTE": "mat-nope"}); err == nil {
		t.Fatal("unknown material choice must fail loudly")
	}

	// Inactive material cannot be chosen either.
	if _, err := ResolveFurnitureLayout(module, catalog, nil,
		map[string]string{"FRENTE": "mat-inactive"}); err == nil {
		t.Fatal("inactive material choice must fail loudly")
	}
}

func TestEvaluatePartFormulaSupportsBaseClearance(t *testing.T) {
	// B (zoclo clearance) powers authored z formulas; it must evaluate.
	v, err := evaluatePartFormula("B+37", formulaDims{B: 100})
	if err != nil || v != 137 {
		t.Fatalf("B variable not supported: v=%d err=%v", v, err)
	}

	v, err = evaluatePartFormula("HW/2", formulaDims{HW: 160})
	if err != nil || v != 80 {
		t.Fatalf("HW variable not supported: v=%d err=%v", v, err)
	}
}

func TestDefaultPoseForPlacementParity(t *testing.T) {
	// Spot-check the TS parity of the heuristic poses (spatialPlacement.ts).
	base := defaultPoseForPlacement("base", 600, 720, 560, 18, 0, 1)
	if base.x != 18 || base.y != 0 || base.z != 0 || base.rotateY != 90 {
		t.Fatalf("base pose = %+v", base)
	}
	sup := defaultPoseForPlacement("superior", 600, 720, 560, 18, 0, 1)
	if sup.z != 702 || sup.rotateY != 90 {
		t.Fatalf("superior pose = %+v", sup)
	}
	front := defaultPoseForPlacement("frontal", 600, 720, 560, 18, 0, 1)
	if front.y != 542 || front.z != 18 || front.rotateX != 90 || front.rotateY != 180 {
		t.Fatalf("frontal pose = %+v", front)
	}
	interno := defaultPoseForPlacement("interno", 600, 720, 560, 18, 2, 3)
	if interno.z != 550 || interno.x != 18 || interno.y != 18 {
		t.Fatalf("interno pose = %+v", interno)
	}
	// Multiple left sides spread across the width.
	lateral := defaultPoseForPlacement("lateral_izquierdo", 600, 720, 560, 18, 1, 2)
	if lateral.x != 582 {
		t.Fatalf("second lateral x = %v, want 582", lateral.x)
	}
}
