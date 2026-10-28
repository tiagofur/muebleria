package engine

import (
	"math"
	"reflect"
	"sort"
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
	// F6 (#668): the preview box follows the Web-parity orientation — the
	// bar-pull grip runs along the door WIDTH (workshop X), as the Web preview
	// renders it. The authored anchor (xMm=40) sits inside the door; the 160mm
	// grip centered on it extends past the door edge exactly as in Web.
	if size[0] != 160 {
		t.Fatalf("bar-pull grip must span previewSizeMm along the door width (workshop X), got %v", size)
	}
	centerX := min[0] + size[0]/2
	if centerX < 2 || centerX > 598 {
		t.Fatalf("handle anchor must sit within the door width [2,598], got center %v (%v + %v)", centerX, min, size)
	}
	if min[2] < 2 || min[2]+size[2] > 718+0.1 {
		t.Fatalf("handle must stay within the door height [2,718], got %v + %v", min, size)
	}

	// #1322: OffsetMm carries the face-plane offset [xMm, yMm] evaluated on
	// the host board — the exact numbers the authoring resolve consumes so
	// host-echoed manual placements drill at the right position instead of
	// collapsing to [0, 0].
	if len(handle.OffsetMm) != 2 || handle.OffsetMm[0] != 40 || handle.OffsetMm[1] != 360 {
		t.Fatalf("handle OffsetMm must evaluate to [40, 360], got %v", handle.OffsetMm)
	}
}

// #1322: verify that hardware placements with formulas evaluate their OffsetMm
// against the boardEnv (W, H, PW, PH, etc.) and serialize the evaluated numbers.
func TestResolveFurnitureLayoutHardwarePlacementOffsetMmWithFormulas(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	// Override door hardware placements with formulas (similar to agregados de puertas).
	// Door board: length = PH - 4 = 716, width = PW - 4 = 596.
	module.Components[0].Overrides = &domain.ComponentInstanceOverrides{
		HardwarePlacements: []domain.HardwarePlacement{
			{
				HardwareID: "hw-handle",
				AnchorFace: "front",
				RelativePosition: domain.HardwareRelPosition{
					XMm:      30,
					YMm:      0,
					XFormula: "PW - 30",
					YFormula: "PH - 30",
				},
			},
			{
				HardwareID: "hw-handle",
				AnchorFace: "back",
				RelativePosition: domain.HardwareRelPosition{
					XMm: 20.5,
					YMm: 90,
				},
			},
			{
				HardwareID: "hw-handle",
				AnchorFace: "back",
				RelativePosition: domain.HardwareRelPosition{
					XMm:      20.5,
					YMm:      50,
					YFormula: "PH - 90",
				},
			},
		},
	}

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	if len(layout.Hardware) != 3 {
		t.Fatalf("expected 3 hardware placements, got %d", len(layout.Hardware))
	}

	// Placement 0: handle on front: X = PW - 30 = 596 - 30 = 566, Y = PH - 30 = 716 - 30 = 686.
	h0 := layout.Hardware[0]
	if len(h0.OffsetMm) != 2 || h0.OffsetMm[0] != 566 || h0.OffsetMm[1] != 686 {
		t.Fatalf("placement 0 offsetMm must be [566, 686], got %v", h0.OffsetMm)
	}

	// Placement 1: hinge fixed: X = 20.5, Y = 90.
	h1 := layout.Hardware[1]
	if len(h1.OffsetMm) != 2 || h1.OffsetMm[0] != 20.5 || h1.OffsetMm[1] != 90 {
		t.Fatalf("placement 1 offsetMm must be [20.5, 90], got %v", h1.OffsetMm)
	}

	// Placement 2: hinge formula: X = 20.5, Y = PH - 90 = 716 - 90 = 626.
	h2 := layout.Hardware[2]
	if len(h2.OffsetMm) != 2 || h2.OffsetMm[0] != 20.5 || h2.OffsetMm[1] != 626 {
		t.Fatalf("placement 2 offsetMm must be [20.5, 626], got %v", h2.OffsetMm)
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

// #1383: N is the instance's copy total — a shelf row declares
// z = PH/(N+1)*(i+1) and the engine distributes the copies by height.
func shelfTowerCatalog(shelfQuantity int) (domain.Module, domain.Catalog) {
	lateral := domain.Component{
		ID: "comp-side", Code: "LAT", Name: "Lateral", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles:   []string{"LATERAL"},
		LengthFormula: "PH - 2*T", WidthFormula: "PD", Active: true,
	}
	right := lateral
	right.ID = "comp-side-r"
	right.Code = "LAT-R"
	right.Placement = domain.PlacementLateralDerecho

	shelf := domain.Component{
		ID: "comp-ent", Code: "ENT", Name: "Entrepaño", Placement: domain.PlacementInterno,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles:   []string{"INTERIOR"},
		LengthFormula: "PW - 2*T", WidthFormula: "PD - T",
		// Distribution by height: PH is the module height, N the copy total.
		ZFormula: "PH/(N+1)*(i+1)",
		Active:   true,
	}

	structure := domain.Structure{
		ID: "st-1", Code: "CUERPO-TORRE", Name: "Cuerpo Torre", Active: true,
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-side", Quantity: 1},
			{ComponentID: "comp-side-r", Quantity: 1},
			{ComponentID: "comp-ent", Quantity: shelfQuantity},
		},
	}

	module := domain.Module{
		ID: "mod-1", Code: "TORRE-600", Name: "Torre 600",
		WidthMm: 600, HeightMm: 2100, DepthMm: 550, StructureID: "st-1",
	}

	catalog := domain.Catalog{
		Structures: []domain.Structure{structure},
		Components: []domain.Component{lateral, right, shelf},
	}
	return module, catalog
}

func shelfHeights(t *testing.T, module domain.Module, catalog domain.Catalog) []float64 {
	t.Helper()
	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	var zs []float64
	for _, c := range layout.Components {
		if c.Name == "Entrepaño" {
			zs = append(zs, c.Transform.TranslationMm[2])
		}
	}
	sort.Float64s(zs)
	return zs
}

func TestResolveFurnitureLayoutShelfDistributionFormula(t *testing.T) {
	t.Run("N=4 distributes by height (2100/5 steps)", func(t *testing.T) {
		module, catalog := shelfTowerCatalog(4)
		zs := shelfHeights(t, module, catalog)
		want := []float64{420, 840, 1260, 1680}
		if !reflect.DeepEqual(zs, want) {
			t.Fatalf("shelf z = %v, want %v", zs, want)
		}
	})

	t.Run("N=1 centers the single shelf", func(t *testing.T) {
		module, catalog := shelfTowerCatalog(1)
		zs := shelfHeights(t, module, catalog)
		if !reflect.DeepEqual(zs, []float64{1050}) {
			t.Fatalf("shelf z = %v, want [1050]", zs)
		}
	})
}

// The real pipeline for a configurable shelf row: the shelf lives as a
// MODULE-level component (the authoring surface for doors/shelves), the
// parameter binding (componentQuantity) rewrites that instance BEFORE the
// layout — including removing it at 0. Persisted quantity 0 stays invalid by
// design; the bound value never reaches that validation because 0 drops the
// instance.
func boundShelfModule() (domain.Module, domain.Catalog) {
	module, catalog := shelfTowerCatalog(0)
	// Strip the structure shelf: the row is authored at module level.
	structure := catalog.Structures[0]
	structure.Components = structure.Components[:2]
	catalog.Structures = []domain.Structure{structure}
	module.Components = []domain.ComponentInstance{
		{ComponentID: "comp-ent", Quantity: 4},
	}
	module.ParameterDefinitions = []domain.FurnitureParameterDefinition{{
		Name:         "entrepanos",
		Label:        "Entrepaños",
		Type:         domain.FurnitureParameterTypeNumber,
		Category:     domain.FurnitureParameterCategoryConfiguration,
		DefaultValue: float64(4),
		Min:          floatPtr(0),
		Max:          floatPtr(8),
		Step:         floatPtr(1),
		Integer:      true,
		Binding: &domain.FurnitureParameterBinding{
			Version: 1, Kind: domain.FurnitureParameterBindingComponentQuantity, ComponentID: "comp-ent",
		},
	}}
	return module, catalog
}

func TestComponentQuantityBindingDrivesShelfCount(t *testing.T) {
	module, catalog := boundShelfModule()

	t.Run("entrepanos=6 distributes 2100/7", func(t *testing.T) {
		bound := ApplyEvaluatedComponentBindings(module, map[string]any{"entrepanos": float64(6)})
		zs := shelfHeights(t, bound, catalog)
		want := []float64{300, 600, 900, 1200, 1500, 1800}
		if !reflect.DeepEqual(zs, want) {
			t.Fatalf("shelf z = %v, want %v", zs, want)
		}
	})

	t.Run("entrepanos=0 removes the row entirely", func(t *testing.T) {
		bound := ApplyEvaluatedComponentBindings(module, map[string]any{"entrepanos": float64(0)})
		if zs := shelfHeights(t, bound, catalog); len(zs) != 0 {
			t.Fatalf("expected no shelf boards, got z = %v", zs)
		}
	})

	t.Run("entrepanos=1 centers", func(t *testing.T) {
		bound := ApplyEvaluatedComponentBindings(module, map[string]any{"entrepanos": float64(1)})
		zs := shelfHeights(t, bound, catalog)
		if !reflect.DeepEqual(zs, []float64{1050}) {
			t.Fatalf("shelf z = %v, want [1050]", zs)
		}
	})
}

func TestEvaluatePartFormulaSupportsCopyCountN(t *testing.T) {
	dims := formulaDims{PW: 600, PH: 2100, PD: 550, T: 18, I: 2, N: 4}
	v, err := evaluatePartFormula("PH/(N+1)*(i+1)", dims)
	if err != nil || v != 1260 {
		t.Fatalf("PH/(N+1)*(i+1) = %d, %v; want 1260", v, err)
	}
	v, err = evaluatePartFormula("N", dims)
	if err != nil || v != 4 {
		t.Fatalf("N = %d, %v; want 4", v, err)
	}
	v, err = evaluatePartFormula("PW-2*T", dims)
	if err != nil || v != 564 {
		t.Fatalf("PW-2*T = %d, %v; want 564", v, err)
	}
	// Lowercase n stays forbidden (the variable is the uppercase N only).
	if _, err := evaluatePartFormula("n", dims); err == nil {
		t.Fatal("lowercase n must be rejected")
	}
	if _, err := evaluatePartFormula("NN", dims); err == nil {
		t.Fatal("NN without operator must be rejected")
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

// #1386: an agregado instance whose pose formulas reference i/N positions
// every copy BY FORMULA at full sub-space size; without them the historic
// layout_direction split is untouched. The quantity comes from the
// agregadoQuantity binding, mirroring the boundShelfModule pattern.
func TestAgregadoCopyPoseFormula(t *testing.T) {
	drawerFront := domain.Component{
		ID: "comp-frente", Code: "FCAJ", Name: "Frente Cajón", Placement: domain.PlacementFrenteCajon,
		GeometryKind: "rectangular_board", LengthMm: 200, WidthMm: 500, ThicknessMm: 18,
		OptionRoles: []string{"FRENTE"}, Active: true,
	}
	agrCajon := domain.Agregado{
		ID: "cajon-std", Code: "CAJ", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-frente", Quantity: 1}},
	}
	newModule := func(instance domain.ModuleAgregadoInstance) (domain.Module, domain.Catalog) {
		structure := domain.Structure{ID: "st-1", Code: "EST", Name: "Cuerpo", WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true}
		module := domain.Module{
			ID: "mod-1", Code: "MOD", Name: "Cajonera", StructureID: "st-1",
			WidthMm: 600, HeightMm: 720, DepthMm: 560,
			Agregados: []domain.ModuleAgregadoInstance{instance},
			ParameterDefinitions: []domain.FurnitureParameterDefinition{{
				Name: "cajones", Label: "Cajones", Type: domain.FurnitureParameterTypeNumber,
				Category:     domain.FurnitureParameterCategoryConfiguration,
				DefaultValue: float64(1), Integer: true,
				Binding: &domain.FurnitureParameterBinding{
					Version: 1, Kind: domain.FurnitureParameterBindingAgregadoQuantity, AgregadoID: "cajon-std",
				},
			}},
		}
		catalog := domain.Catalog{
			Structures: []domain.Structure{structure},
			Components: []domain.Component{drawerFront},
			Agregados:  []domain.Agregado{agrCajon},
		}
		return module, catalog
	}
	drawerZs := func(t *testing.T, module domain.Module, catalog domain.Catalog) []float64 {
		t.Helper()
		layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
		if err != nil {
			t.Fatalf("resolve layout: %v", err)
		}
		var zs []float64
		for _, c := range layout.Components {
			if c.Name == "Frente Cajón" {
				zs = append(zs, c.Transform.TranslationMm[2])
			}
		}
		sort.Float64s(zs)
		return zs
	}

	t.Run("i formula stacks copies 250mm apart at full size", func(t *testing.T) {
		module, catalog := newModule(domain.ModuleAgregadoInstance{
			AgregadoID: "cajon-std", Quantity: 1,
			Position: &domain.AgregadoPosition{ZFormula: "i*250"},
		})
		bound := ApplyEvaluatedAgregadoBindings(module, map[string]any{"cajones": float64(3)})
		zs := drawerZs(t, bound, catalog)
		// The +2 is the frente placement's own z offset (pre-existing), on
		// top of each formula pose (i*250).
		if !reflect.DeepEqual(zs, []float64{2, 252, 502}) {
			t.Fatalf("drawer z = %v, want [2 252 502]", zs)
		}
	})

	t.Run("no i/N keeps the layout_direction split", func(t *testing.T) {
		module, catalog := newModule(domain.ModuleAgregadoInstance{
			AgregadoID: "cajon-std", Quantity: 1, LayoutDirection: "vertical",
		})
		bound := ApplyEvaluatedAgregadoBindings(module, map[string]any{"cajones": float64(2)})
		zs := drawerZs(t, bound, catalog)
		// Sub-space = module height 720 split in 2 → units at z 0 and 360,
		// plus the frente placement's own +2.
		if !reflect.DeepEqual(zs, []float64{2, 362}) {
			t.Fatalf("drawer z = %v, want split [2 362]", zs)
		}
	})
}
