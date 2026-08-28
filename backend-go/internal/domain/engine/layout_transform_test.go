package engine

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #414 — authoritative local part transform contract.
//
// Every resolved board publishes (see layout.go / ADR-0004 §9):
//
//	transformContract: granete.local-basis.v1
//	components[].localTransform = { translationMm, basis: {x, y, z} }
//	components[].lengthMm/widthMm/thicknessMm (local box extents)
//
// with furniture_point = translationMm + basis·local_point for the local box
// [0,width]×[0,thickness]×[0,length]. The basis is orthonormal and
// right-handed in the furniture (workshop, SketchUp-aligned) frame, so Ruby
// applies a generic rigid transform — never a mirror, never orientation
// inference from slotId/role/name/AABB. The legacy AABB is derived from the
// same transform.

func approxVec3(a, b [3]float64, tol float64) bool {
	for k := 0; k < 3; k++ {
		if math.Abs(a[k]-b[k]) > tol {
			return false
		}
	}
	return true
}

// aabbFromTransform recomputes the furniture AABB of the local box under the
// published transform by scanning the 8 corners — an independent path from
// aabbFromLocalTransform used by the parity tests.
func aabbFromTransform(lt LayoutLocalTransform, w, t, l float64) (min [3]float64, size [3]float64) {
	min = [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
	max := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	cols := [3][3]float64{lt.Basis.X, lt.Basis.Y, lt.Basis.Z}
	dims := [3]float64{w, t, l}
	for _, sx := range [2]float64{0, 1} {
		for _, sy := range [2]float64{0, 1} {
			for _, sz := range [2]float64{0, 1} {
				coords := [3]float64{sx, sy, sz}
				for k := 0; k < 3; k++ {
					p := lt.TranslationMm[k]
					for j := 0; j < 3; j++ {
						p += cols[j][k] * dims[j] * coords[j]
					}
					if p < min[k] {
						min[k] = p
					}
					if p > max[k] {
						max[k] = p
					}
				}
			}
		}
	}
	return min, [3]float64{max[0] - min[0], max[1] - min[1], max[2] - min[2]}
}

func TestLayoutLocalTransformContractMarker(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	if layout.TransformContract != LayoutTransformContractV1 {
		t.Fatalf("transformContract = %q, want %q", layout.TransformContract, LayoutTransformContractV1)
	}
	if len(layout.Components) == 0 {
		t.Fatal("layout must carry components")
	}
	for _, c := range layout.Components {
		if err := validateLayoutBasis(c.LocalTransform.Basis); err != nil {
			t.Fatalf("component %s basis invalid: %v", c.Name, err)
		}
	}
}

// Canonical boards: left side, horizontal floor/top, back and door must
// expose correct local dimensions and orientation independently of the AABB
// shape. All standard placements are k·90° rotations, so every basis entry
// is exactly 0/±1 (no trig noise).
func TestLayoutLocalTransformCanonicalBoards(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	board := func(slot string) *LayoutComponent {
		c := findComponentByID(layout.Components, slot)
		if c == nil {
			t.Fatalf("missing %s: %+v", slot, layout.Components)
		}
		return c
	}

	// Left side: local [W=PD=560, T=18, L=PH-2T=684]. Local +X (width) runs
	// from front to back, local +Y (thickness) grows to the right, local +Z
	// (length) grows up; the box's back-top corner sits at the furniture
	// origin side, so the translation parks it at y=PD.
	left := board("lateral_izquierdo")
	if left.WidthMm != 560 || left.ThicknessMm != 18 || left.LengthMm != 684 {
		t.Fatalf("left local dims = %d/%d/%d, want 560/18/684", left.WidthMm, left.ThicknessMm, left.LengthMm)
	}
	wantLeft := LayoutLocalTransform{
		TranslationMm: [3]float64{0, 560, 0},
		Basis:         LayoutBasis{X: [3]float64{0, -1, 0}, Y: [3]float64{1, 0, 0}, Z: [3]float64{0, 0, 1}},
	}
	if left.LocalTransform != wantLeft {
		t.Fatalf("left localTransform = %+v, want %+v", left.LocalTransform, wantLeft)
	}

	// Right side: same orientation, parked at x=PW-T.
	right := board("lateral_derecho")
	if right.LocalTransform.Basis != wantLeft.Basis {
		t.Fatalf("right basis = %+v, want same as left", right.LocalTransform.Basis)
	}
	if right.LocalTransform.TranslationMm != [3]float64{582, 560, 0} {
		t.Fatalf("right translation = %v, want [582 560 0]", right.LocalTransform.TranslationMm)
	}

	// Horizontal floor: local +X (width=PD-T=542) toward the front, local +Y
	// (thickness) up, local +Z (length=PW-2T=564) to the right.
	floor := board("base")
	if floor.WidthMm != 542 || floor.LengthMm != 564 {
		t.Fatalf("floor local dims = %d/%d, want 542/564", floor.WidthMm, floor.LengthMm)
	}
	wantFloor := LayoutLocalTransform{
		TranslationMm: [3]float64{18, 0, 0},
		Basis:         LayoutBasis{X: [3]float64{0, 1, 0}, Y: [3]float64{0, 0, 1}, Z: [3]float64{1, 0, 0}},
	}
	if floor.LocalTransform != wantFloor {
		t.Fatalf("floor localTransform = %+v, want %+v", floor.LocalTransform, wantFloor)
	}

	// Top: same orientation as the floor, raised to z=PH-T.
	top := board("superior")
	if top.LocalTransform.Basis != wantFloor.Basis {
		t.Fatalf("top basis = %+v, want same as floor", top.LocalTransform.Basis)
	}
	if top.LocalTransform.TranslationMm != [3]float64{18, 0, 702} {
		t.Fatalf("top translation = %v, want [18 0 702]", top.LocalTransform.TranslationMm)
	}

	// Back panel: identity orientation, parked at its own (T, 0, T) pose —
	// T is the back's effective thickness (15 nominal here).
	back := board("trasera")
	wantBack := LayoutLocalTransform{
		TranslationMm: [3]float64{15, 0, 15},
		Basis:         LayoutBasis{X: [3]float64{1, 0, 0}, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, 1}},
	}
	if back.LocalTransform != wantBack {
		t.Fatalf("back localTransform = %+v, want %+v", back.LocalTransform, wantBack)
	}

	// Door: identity orientation at the overlay pose.
	door := board("puerta")
	if door.LocalTransform.Basis != wantBack.Basis {
		t.Fatalf("door basis = %+v, want identity", door.LocalTransform.Basis)
	}
	if door.LocalTransform.TranslationMm != [3]float64{2, 560, 2} {
		t.Fatalf("door translation = %v, want [2 560 2]", door.LocalTransform.TranslationMm)
	}

	// 90° placements must land local axes exactly on furniture axes: every
	// basis entry is exactly 0/±1 (snapUnitVec3, no trig noise survives).
	for _, c := range layout.Components {
		for _, v := range [3][3]float64{c.LocalTransform.Basis.X, c.LocalTransform.Basis.Y, c.LocalTransform.Basis.Z} {
			for _, e := range v {
				if e != 0 && e != 1 && e != -1 {
					t.Fatalf("component %s: standard placement basis must be axis-exact, got %v", c.Name, c.LocalTransform.Basis)
				}
			}
		}
	}
}

// AABB parity: the AABB derived (independently, via the 8 corners) from the
// new local geometry + transform must match the published AABB within
// tolerance — including under dims overrides.
func TestLayoutLocalTransformDerivedAABBParity(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()

	for _, dims := range []*LayoutDims{nil, {WidthMm: 900, HeightMm: 800, DepthMm: 500}} {
		layout, err := ResolveFurnitureLayout(module, catalog, dims, nil)
		if err != nil {
			t.Fatalf("resolve layout (dims=%v): %v", dims, err)
		}
		for _, c := range layout.Components {
			min, size := aabbFromTransform(c.LocalTransform, float64(c.WidthMm), float64(c.ThicknessMm), float64(c.LengthMm))
			if !approxVec3(min, c.Transform.TranslationMm, 1e-6) {
				t.Fatalf("%s: derived min %v != published %v", c.Name, min, c.Transform.TranslationMm)
			}
			if !approxVec3(size, c.DimensionsMm, 1e-6) {
				t.Fatalf("%s: derived size %v != published %v", c.Name, size, c.DimensionsMm)
			}
		}
	}
}

// #402 ordering: effective material thickness must already be baked into the
// local geometry and the transform — a 16 mm board produces
// thicknessMm=16, dependent poses (x=PW-T) and a transform that maps the
// 16 mm-thick local box exactly onto the published AABB.
func TestLayoutLocalTransformMixedMaterialThickness(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	catalog.Materials = []domain.MaterialBoard{
		{ID: "mat-white16", Code: "BLANCO-16", Name: "Blanco 16", ThicknessMm: 16, Active: true},
		{ID: "mat-oak18", Code: "ROBLE-18", Name: "Roble 18", ThicknessMm: 18, Active: true},
		{ID: "mat-back6", Code: "FONDO-6", Name: "Fondo 6", ThicknessMm: 6, Active: true},
	}
	choices := map[string]string{"LATERAL": "mat-white16", "INTERIOR": "mat-white16", "FONDO": "mat-back6", "FRENTE": "mat-oak18"}

	layout, err := ResolveFurnitureLayout(module, catalog, nil, choices)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	left := findComponentByID(layout.Components, "lateral_izquierdo")
	if left.ThicknessMm != 16 {
		t.Fatalf("left effective thickness = %d, want 16 (selected board)", left.ThicknessMm)
	}
	// PH-2T with T=16: length 688. The transform still parks the panel at
	// y=PD but the panel is now 16 thick, so the AABB starts at x=0..16 and
	// the right side follows PW-T=584.
	if left.LengthMm != 688 {
		t.Fatalf("left length = %d, want PH-2*16=688", left.LengthMm)
	}
	if left.LocalTransform.TranslationMm != [3]float64{0, 560, 0} {
		t.Fatalf("left translation = %v", left.LocalTransform.TranslationMm)
	}
	if left.DimensionsMm != [3]float64{16, 560, 688} {
		t.Fatalf("left AABB size = %v, want [16 560 688]", left.DimensionsMm)
	}
	right := findComponentByID(layout.Components, "lateral_derecho")
	if right.LocalTransform.TranslationMm[0] != 584 {
		t.Fatalf("right translation x = %v, want PW-16=584", right.LocalTransform.TranslationMm[0])
	}
	back := findComponentByID(layout.Components, "trasera")
	if back.ThicknessMm != 6 || back.LengthMm != 600-12 {
		t.Fatalf("back effective geometry = %d thick / %d long, want 6 / %d (PW-2T)", back.ThicknessMm, back.LengthMm, 600-12)
	}

	// Derived AABB parity holds for the mixed-thickness resolution.
	for _, c := range layout.Components {
		min, size := aabbFromTransform(c.LocalTransform, float64(c.WidthMm), float64(c.ThicknessMm), float64(c.LengthMm))
		if !approxVec3(min, c.Transform.TranslationMm, 1e-6) || !approxVec3(size, c.DimensionsMm, 1e-6) {
			t.Fatalf("%s: derived AABB %v/%v != published %v/%v", c.Name, min, size, c.Transform.TranslationMm, c.DimensionsMm)
		}
	}
}

// Agregado child boards use the same contract (identity orientation for the
// drawer fronts, translation == published AABB min corner).
func TestLayoutLocalTransformAgregadoChildren(t *testing.T) {
	drawerFront := domain.Component{
		ID: "comp-dfront", Code: "FRENTE-CAJ", Name: "Frente Cajón", Placement: domain.PlacementFrenteCajon,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"FRENTE"},
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}
	agregado := domain.Agregado{
		ID: "agr-drawer", Code: "CAJON", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-dfront", Quantity: 1}},
	}
	module, catalog := oneDoorCabinetCatalog()
	module.Components = []domain.ComponentInstance{}
	catalog.Agregados = append(catalog.Agregados, agregado)
	catalog.Components = append(catalog.Components, drawerFront)
	catalog.Structures[0].Agregados = []domain.ModuleAgregadoInstance{{
		ID: "agr-inst-1", AgregadoID: "agr-drawer", Quantity: 3, LayoutDirection: "vertical",
	}}

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	fronts := 0
	for i := range layout.Components {
		c := &layout.Components[i]
		if c.SlotID != "frente_cajon" {
			continue
		}
		fronts++
		identity := LayoutBasis{X: [3]float64{1, 0, 0}, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, 1}}
		if c.LocalTransform.Basis != identity {
			t.Fatalf("drawer front basis = %+v, want identity", c.LocalTransform.Basis)
		}
		if c.LocalTransform.TranslationMm != c.Transform.TranslationMm {
			t.Fatalf("identity-oriented front translation %v must equal AABB min %v",
				c.LocalTransform.TranslationMm, c.Transform.TranslationMm)
		}
		if err := validateLayoutBasis(c.LocalTransform.Basis); err != nil {
			t.Fatalf("drawer front basis invalid: %v", err)
		}
	}
	if fronts != 3 {
		t.Fatalf("expected 3 drawer fronts with transforms, got %d", fronts)
	}
}

// #415 — authoring-definition identity on the wire. componentDefinitionId is
// the #346 stable reusable definition ID: every copy of one component shares
// it while keeping a distinct componentInstanceId. It is Granete-owned
// identity and stays a separate field from any future catalogComponentId —
// the SketchUp renderer (#415) stores it verbatim in namespaced metadata and
// never substitutes the host-generated SU definition GUID.
func TestLayoutComponentDefinitionIdentity(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	for _, c := range layout.Components {
		if c.ComponentDefinitionID == "" {
			t.Fatalf("component %s publishes no componentDefinitionId", c.ComponentInstanceID)
		}
		if c.ComponentDefinitionID == c.ComponentInstanceID {
			t.Fatalf("component %s collapses definition and instance identity", c.ComponentInstanceID)
		}
	}

	// Three copies of one component (one entry, quantity 3): same definition
	// identity, distinct concrete instances (the #346 two-shelves rule).
	st := catalog.Structures[0]
	st.Components[0].Quantity = 3
	catalog.Structures[0] = st
	copied, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve copied layout: %v", err)
	}
	var copies []LayoutComponent
	for _, c := range copied.Components {
		if c.ComponentDefinitionID == "st-comp-side" {
			copies = append(copies, c)
		}
	}
	if len(copies) != 3 {
		t.Fatalf("expected 3 copies of st-comp-side, got %d", len(copies))
	}
	for i := 1; i < len(copies); i++ {
		if copies[i].ComponentInstanceID == copies[0].ComponentInstanceID {
			t.Fatalf("copies share componentInstanceId %s", copies[i].ComponentInstanceID)
		}
	}
}

// Hardware host references stay tied to componentInstanceId after the
// transform contract change, and every host carries a localTransform.
func TestLayoutLocalTransformHardwareHostIdentity(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	if len(layout.Hardware) == 0 {
		t.Fatal("fixture must carry the door handle")
	}
	byID := map[string]*LayoutComponent{}
	for i := range layout.Components {
		byID[layout.Components[i].ComponentInstanceID] = &layout.Components[i]
	}
	for _, hw := range layout.Hardware {
		host, ok := byID[hw.HostComponentInstanceID]
		if !ok {
			t.Fatalf("hardware %s references unknown host %s", hw.PlacementID, hw.HostComponentInstanceID)
		}
		if err := validateLayoutBasis(host.LocalTransform.Basis); err != nil {
			t.Fatalf("hardware host %s has no valid localTransform: %v", host.ComponentInstanceID, err)
		}
	}
}

// NEGATIVE PROOF (#414): slotId, name and the AABB (min corner + size) are
// NOT enough to recover a board's orientation. Two custom boards share all
// of them and still need different bases — exactly the ambiguity the
// authoritative transform exists to remove. A client "deriving" rotation
// from slot/AABB would place one of the two wrong.
func TestLayoutLocalTransformNegativeProofSlotAndAABBCannotRecoverOrientation(t *testing.T) {
	square := func(id string, rotateY int) domain.Component {
		return domain.Component{
			ID: id, Code: id, Name: "Panel", Placement: domain.PlacementCustom,
			GeometryKind: "rectangular_board", LengthMm: 400, WidthMm: 400, ThicknessMm: 18,
			OptionRoles: []string{"INTERIOR"}, RotateY: rotateY, Active: true,
		}
	}
	flat := square("comp-flat", 0)
	turned := square("comp-turned", 90)
	structure := domain.Structure{
		ID: "st-1", Code: "CUERPO", Name: "Cuerpo", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-flat", Quantity: 1}, {ComponentID: "comp-turned", Quantity: 1}},
	}
	module := domain.Module{
		ID: "mod-1", Code: "SQ", Name: "Cuadrados", WidthMm: 600, HeightMm: 720, DepthMm: 560,
		StructureID: "st-1",
	}
	catalog := domain.Catalog{
		Structures: []domain.Structure{structure},
		Components: []domain.Component{flat, turned},
	}

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	if len(layout.Components) != 2 {
		t.Fatalf("expected 2 boards, got %d", len(layout.Components))
	}
	a, b := layout.Components[0], layout.Components[1]

	// The misleading inputs are identical...
	if a.SlotID != b.SlotID || a.Name != b.Name {
		t.Fatalf("fixture must share slotId+name: %q/%q vs %q/%q", a.SlotID, b.SlotID, a.Name, b.Name)
	}
	if a.Transform.TranslationMm != b.Transform.TranslationMm || a.DimensionsMm != b.DimensionsMm {
		t.Fatalf("fixture must share the AABB: %v/%v vs %v/%v",
			a.Transform.TranslationMm, a.DimensionsMm, b.Transform.TranslationMm, b.DimensionsMm)
	}

	// ...and still the orientations differ: only localTransform distinguishes
	// them. (flat keeps +X to the right; turned maps +X to the front.)
	if a.LocalTransform.Basis == b.LocalTransform.Basis {
		t.Fatalf("boards with identical slot/name/AABB must still expose distinct bases, got %+v",
			a.LocalTransform.Basis)
	}
	for _, c := range []LayoutComponent{a, b} {
		if err := validateLayoutBasis(c.LocalTransform.Basis); err != nil {
			t.Fatalf("basis must stay valid: %v", err)
		}
	}
}

// Mirrors, collapses and NaN orientations can never be published.
func TestValidateLayoutBasisRejectsInvalidBases(t *testing.T) {
	mirror := LayoutBasis{X: [3]float64{1, 0, 0}, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, -1}}
	if err := validateLayoutBasis(mirror); err == nil {
		t.Fatal("mirrored (left-handed) basis must be rejected")
	}
	scaled := LayoutBasis{X: [3]float64{2, 0, 0}, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, 1}}
	if err := validateLayoutBasis(scaled); err == nil {
		t.Fatal("non-unit basis must be rejected")
	}
	nan := LayoutBasis{X: [3]float64{math.NaN(), 0, 0}, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, 1}}
	if err := validateLayoutBasis(nan); err == nil {
		t.Fatal("NaN basis must be rejected")
	}
	skew := LayoutBasis{X: [3]float64{1, 0, 0}, Y: [3]float64{1, 1, 0}, Z: [3]float64{0, 0, 1}}
	if err := validateLayoutBasis(skew); err == nil {
		t.Fatal("non-orthogonal basis must be rejected")
	}
}

// Serialization API: the served JSON round-trips every contract field, and
// the golden fixture in contracts/sketchupLayoutTransform.contract.json —
// consumed VERBATIM by the Ruby parser tests — pins the exact wire shape.
// Regenerate with UPDATE_LAYOUT_CONTRACT_GOLDEN=1.
func TestLayoutTransformContractSerializationGolden(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}

	body, err := json.MarshalIndent(layout, "", "  ")
	if err != nil {
		t.Fatalf("marshal layout: %v", err)
	}

	goldenPath := "../../../../contracts/sketchupLayoutTransform.contract.json"
	if os.Getenv("UPDATE_LAYOUT_CONTRACT_GOLDEN") == "1" {
		if err := os.WriteFile(goldenPath, append(body, '\n'), 0o644); err != nil {
			t.Fatalf("update golden: %v", err)
		}
	}

	raw, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}

	var fromGolden FurnitureLayout
	if err := json.Unmarshal(raw, &fromGolden); err != nil {
		t.Fatalf("decode golden: %v", err)
	}
	if fromGolden.TransformContract != LayoutTransformContractV1 {
		t.Fatalf("golden transformContract = %q", fromGolden.TransformContract)
	}
	if len(fromGolden.Components) != len(layout.Components) {
		t.Fatalf("golden carries %d components, want %d", len(fromGolden.Components), len(layout.Components))
	}
	for i := range fromGolden.Components {
		g, c := fromGolden.Components[i], layout.Components[i]
		if g.ComponentInstanceID != c.ComponentInstanceID || g.ComponentDefinitionID != c.ComponentDefinitionID ||
			g.LocalTransform != c.LocalTransform ||
			g.Transform != c.Transform || g.DimensionsMm != c.DimensionsMm ||
			g.LengthMm != c.LengthMm || g.WidthMm != c.WidthMm || g.ThicknessMm != c.ThicknessMm {
			t.Fatalf("component %d drifted from golden: golden=%+v live=%+v", i, g, c)
		}
	}

	// Wire shape must keep the contract keys the Ruby parser pins.
	var probe map[string]any
	if err := json.Unmarshal(body, &probe); err != nil {
		t.Fatalf("decode probe: %v", err)
	}
	if probe["transformContract"] != LayoutTransformContractV1 {
		t.Fatalf("wire body missing transformContract")
	}
	comps := probe["components"].([]any)
	first := comps[0].(map[string]any)
	lt := first["localTransform"].(map[string]any)
	if _, ok := lt["basis"].(map[string]any); !ok {
		t.Fatal("localTransform.basis missing on the wire")
	}
	if _, ok := lt["translationMm"].([]any); !ok {
		t.Fatal("localTransform.translationMm missing on the wire")
	}
}
