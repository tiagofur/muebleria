package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1264 / V2 OPEN-FRONT — the opening layout pass: the server-resolved front
// region constrains door/drawer-front boards (their authored holguras and
// width split stay intact), the body boards never move, a blocked size fails
// closed, and an opening-constrained front supersedes client-authored
// translation. No fronts = the historical layout stays byte-identical.

func openingPassFront(boundary string, consumedMm int) []OpeningResolvedFront {
	return []OpeningResolvedFront{{
		ZoneID: "z1", Access: "hinged", WidthMm: 596, HeightMm: 720 - consumedMm, OffsetMm: 0,
		Grips: []OpeningResolvedFrontGrip{{
			Boundary: boundary, ProfileID: "profile.gola-l.alu", ConsumedMm: consumedMm,
		}},
	}}
}

func TestOpeningFrontsConstrainDoorBoards(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}

	// Baseline sanity: the fixture's door is 716 (PH−4) at min corner z=2.
	baseline, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{})
	if err != nil {
		t.Fatalf("baseline resolve: %v", err)
	}
	baseDoor := findComponentByID(baseline.Components, "puerta")
	if baseDoor.LengthMm != 716 || baseDoor.Transform.TranslationMm != [3]float64{2, 560, 2} {
		t.Fatalf("baseline door drifted: %+v", baseDoor)
	}

	// Top grip (gola L superior): the door shrinks from the TOP — its bottom
	// edge stays where the catalog put it, the authored holgura (−4) survives
	// inside the remaining length.
	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{fronts: openingPassFront("top", 70)})
	if err != nil {
		t.Fatalf("top-grip resolve: %v", err)
	}
	door := findComponentByID(layout.Components, "puerta")
	if door == nil || door.LengthMm != 646 || door.WidthMm != 596 {
		t.Fatalf("top-grip door = %+v, want L=646 (716−70) W=596 (split intact)", door)
	}
	if door.Transform.TranslationMm != [3]float64{2, 560, 2} {
		t.Fatalf("top-grip door min corner = %v, want [2 560 2] (bottom edge intact)", door.Transform.TranslationMm)
	}
	if door.DimensionsMm != [3]float64{596, 18, 646} {
		t.Fatalf("top-grip door AABB = %v, want [596 18 646]", door.DimensionsMm)
	}
	// The BODY never moves: the lateral keeps its full resolved length.
	lateral := findComponentByID(layout.Components, "lateral_izquierdo")
	if lateral == nil || lateral.LengthMm == door.LengthMm {
		t.Fatalf("body boards must stay untouched: %+v", lateral)
	}

	// Gola fronts are handle-free: any handle hardware (JALADERA) is pruned.
	for _, hw := range layout.Hardware {
		if strings.Contains(hw.PlacementID, "hw-handle") {
			t.Fatalf("gola fronts must not mount handle hardware: %+v", hw)
		}
	}

	// Bottom grip: the door shrinks from the BOTTOM — its bottom edge lifts.
	layout, _, err = resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{fronts: openingPassFront("bottom", 70)})
	if err != nil {
		t.Fatalf("bottom-grip resolve: %v", err)
	}
	door = findComponentByID(layout.Components, "puerta")
	if door.LengthMm != 646 {
		t.Fatalf("bottom-grip door length = %d, want 646", door.LengthMm)
	}
	if door.Transform.TranslationMm != [3]float64{2, 560, 72} {
		t.Fatalf("bottom-grip door min corner = %v, want [2 560 72] (lifted by the consumption)", door.Transform.TranslationMm)
	}

	// Case C overhang (negative consumption, #1138): the front EXTENDS below
	// the body bottom with the same arithmetic.
	layout, _, err = resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{fronts: openingPassFront("bottom", -20)})
	if err != nil {
		t.Fatalf("overhang resolve: %v", err)
	}
	door = findComponentByID(layout.Components, "puerta")
	if door.LengthMm != 736 || door.Transform.TranslationMm != [3]float64{2, 560, -18} {
		t.Fatalf("overhang door = L %d @ %v, want 736 @ [2 560 -18]", door.LengthMm, door.Transform.TranslationMm)
	}

	// Fail-closed: a consumption that leaves no valid height rejects the
	// resolve — never an invented size.
	if _, _, err = resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{fronts: openingPassFront("top", 800)}); err == nil ||
		!strings.Contains(err.Error(), "sin altura válida") {
		t.Fatalf("an oversized consumption must fail closed, got %v", err)
	}

	// No fronts: the historical layout stays byte-identical.
	again, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{})
	if err != nil {
		t.Fatalf("re-baseline resolve: %v", err)
	}
	if againDoor := findComponentByID(again.Components, "puerta"); againDoor.LengthMm != baseDoor.LengthMm ||
		againDoor.Transform.TranslationMm != baseDoor.Transform.TranslationMm {
		t.Fatalf("no-fronts layout must stay byte-identical: %+v vs %+v", againDoor, baseDoor)
	}
}

// An opening-constrained front supersedes client-authored translation: the
// opening owns the front's vertical placement (#477 final pass exempts it),
// while body boards keep their authored poses.
func TestOpeningFrontsSupersedeAuthoredTranslation(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	snapshot := defaultAuthoringOccurrences()
	for i := range snapshot {
		switch snapshot[i].ComponentInstanceID {
		case "door-01":
			snapshot[i].Transform = &AuthoringOccurrenceTransform{Frame: "assembly", TranslationMm: [3]float64{50, 555, 200}}
		case "floor-01":
			snapshot[i].Transform = &AuthoringOccurrenceTransform{Frame: "assembly", TranslationMm: [3]float64{10, 10, 10}}
		}
	}

	resolve := func(fronts []OpeningResolvedFront) *AuthoringResolveResult {
		t.Helper()
		result, err := ResolveAuthoringLayout(AuthoringResolveInput{
			Module: module, Catalog: catalog, PrecisionMm: 0.01,
			Occurrences: snapshot, Relationships: []AuthoringRelationship{},
			Fronts: fronts,
		})
		if err != nil {
			t.Fatalf("authoring resolve: %v", err)
		}
		if len(result.StructuralIssues) != 0 {
			t.Fatalf("resolve must be accepted, got %+v", result.StructuralIssues)
		}
		return result
	}

	// WITHOUT the opening the authored poses win verbatim.
	baseline := resolve(nil)
	door := findBoard(baseline.Layout, "door-01")
	if door == nil || door.Transform.TranslationMm[2] != 200 {
		t.Fatalf("baseline must honor the authored door pose: %+v", door)
	}

	// WITH the opening the front's vertical placement is the opening's —
	// the authored z (200) is superseded, the length carries the constraint
	// and the body's authored pose (floor z=10) stays untouched.
	opened := resolve(openingPassFront("top", 70))
	door = findBoard(opened.Layout, "door-01")
	if door == nil {
		t.Fatalf("missing door-01: %+v", opened.Layout.Components)
	}
	if door.LengthMm != 646 || door.Transform.TranslationMm[2] == 200 {
		t.Fatalf("the opening must supersede the authored z (200): L=%d T=%v", door.LengthMm, door.Transform.TranslationMm)
	}
	floor := findBoard(opened.Layout, "floor-01")
	if floor == nil || floor.Transform.TranslationMm[2] != 10 {
		t.Fatalf("body authored poses must survive: %+v", floor)
	}
}

// #1283 / §13.2 — the member hardware's envelopes and the support's vertical
// position come from the pin's DECLARED datasheet geometry, never engine
// constants. 8006 datasheet (SCILM 2022-04-01): profile 56.5 tall × 27.2
// deep; SU116 support [17, 19.5, 39.5]; CF8006TP cap [3, 28.8, 58]. The
// support's local origin sits at profile height / 2 from the declared height
// reference (the carcass top plane at a top-boundary gola).
func TestOpeningMembersPlaceFromDeclaredDatasheet(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	catalog.Hardware = append(catalog.Hardware,
		domain.Hardware{ID: "hw-gola-8006", Code: "8006", Name: "Perfil Gola L 8006", Unit: domain.UnitMeter, Active: true},
		domain.Hardware{ID: "hw-su116", Code: "SU116", Name: "Soporte Gola SU116", Unit: domain.UnitPiece, Active: true},
		domain.Hardware{ID: "hw-cf8006tp", Code: "CF8006TP", Name: "Tapa CF8006TP", Unit: domain.UnitPiece, Active: true},
	)
	dims := &LayoutDims{WidthMm: 400, HeightMm: 720, DepthMm: 560}
	members := OpeningMembers{
		ProfileHardwareID: "hw-gola-8006",
		SupportHardwareID: "hw-su116",
		CapHardwareID:     "hw-cf8006tp",
		SupportSpacingMm:  400,
		ProfileHeightMm:   56.5,
		ProfileDepthMm:    27.2,
		SupportDimsMm:     &[3]float64{17, 19.5, 39.5},
		CapDimsMm:         &[3]float64{3, 28.8, 58},
	}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:         openingPassFront("top", 40),
		openingMembers: &members,
	})
	if err != nil {
		t.Fatalf("resolve with declared members: %v", err)
	}
	byID := map[string]LayoutHardware{}
	for _, hw := range layout.Hardware {
		if strings.HasPrefix(hw.PlacementID, "opening-") {
			byID[hw.PlacementID] = hw
		}
	}
	if len(byID) != 5 {
		t.Fatalf("want profile + 2 supports + 2 caps, got %d opening members: %v", len(byID), byID)
	}

	profile := byID["opening-profile-hw-gola-8006"]
	if profile.DimensionsMm != [3]float64{400, 27.2, 56.5} {
		t.Fatalf("profile envelope = %v, want [400 27.2 56.5] (datasheet, front flush)", profile.DimensionsMm)
	}
	if profile.Transform.TranslationMm != [3]float64{0, 560, 720} {
		t.Fatalf("profile translation = %v, want [0 560 720]", profile.Transform.TranslationMm)
	}

	// #1296: the support's origin (the L's corner: plate face, arm rear,
	// bracket bottom) mounts on the side's INNER face (18mm board), behind
	// the profile band (arm tip at 560−27.2) and centered on the profile's
	// height (720−56.5/2−39.5/2).
	left := byID["opening-support-left-hw-su116"]
	if left.Transform.TranslationMm != [3]float64{18, 513.3, 672} {
		t.Fatalf("left support translation = %v, want [18 513.3 672] (inner face, behind profile, height-centered)", left.Transform.TranslationMm)
	}
	if left.DimensionsMm != [3]float64{17, 19.5, 39.5} {
		t.Fatalf("support envelope = %v, want declared [17 19.5 39.5]", left.DimensionsMm)
	}
	right := byID["opening-support-right-hw-su116"]
	if right.Transform.TranslationMm != [3]float64{382, 513.3, 672} {
		t.Fatalf("right support translation = %v, want [382 513.3 672] (mirrored inner face)", right.Transform.TranslationMm)
	}
	if right.LocalTransform.Basis.X != [3]float64{-1, 0, 0} {
		t.Fatalf("right support must stay mirrored in X, got %v", right.LocalTransform.Basis.X)
	}

	capLeft := byID["opening-cap-left-hw-cf8006tp"]
	if capLeft.DimensionsMm != [3]float64{3, 28.8, 58} {
		t.Fatalf("cap envelope = %v, want declared [3 28.8 58]", capLeft.DimensionsMm)
	}
	// #1292: the cap box sits INSIDE the profile band (min-corner origin —
	// the host fallback extends +axes from the translation): Y [531.2, 560],
	// Z [662, 720], left cap X [0, 3] / right cap X [397, 400].
	if capLeft.Transform.TranslationMm != [3]float64{0, 531.2, 662} {
		t.Fatalf("left cap translation = %v, want [0 531.2 662] (min corner of the cap band)", capLeft.Transform.TranslationMm)
	}
	capRight := byID["opening-cap-right-hw-cf8006tp"]
	if capRight.Transform.TranslationMm != [3]float64{400, 531.2, 662} {
		t.Fatalf("right cap translation = %v, want [400 531.2 662] (mirrored)", capRight.Transform.TranslationMm)
	}

	// Idempotence: a second resolve is byte-identical (no duplicated members).
	again, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:         openingPassFront("top", 40),
		openingMembers: &members,
	})
	if err != nil {
		t.Fatalf("second resolve: %v", err)
	}
	if len(again.Hardware) != len(layout.Hardware) {
		t.Fatalf("resolve must be idempotent: %d vs %d hardware", len(again.Hardware), len(layout.Hardware))
	}
}

// A pin authored before the declared envelope existed (#1283) carries zeros —
// the layout places NO opening hardware (truthful absence), never an invented
// constant. A member without declared dims skips only that member.
func TestOpeningMembersWithoutDeclaredGeometryPlaceNothing(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	catalog.Hardware = append(catalog.Hardware,
		domain.Hardware{ID: "hw-gola-8006", Code: "8006", Name: "Perfil Gola L 8006", Unit: domain.UnitMeter, Active: true},
		domain.Hardware{ID: "hw-su116", Code: "SU116", Name: "Soporte Gola SU116", Unit: domain.UnitPiece, Active: true},
	)
	dims := &LayoutDims{WidthMm: 400, HeightMm: 720, DepthMm: 560}

	prePinEnvelope := OpeningMembers{
		ProfileHardwareID: "hw-gola-8006",
		SupportHardwareID: "hw-su116",
		SupportSpacingMm:  400,
	}
	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:         openingPassFront("top", 40),
		openingMembers: &prePinEnvelope,
	})
	if err != nil {
		t.Fatalf("resolve with pre-#1283 members: %v", err)
	}
	for _, hw := range layout.Hardware {
		if strings.HasPrefix(hw.PlacementID, "opening-") {
			t.Fatalf("a pin without declared geometry must place nothing, got %s %+v", hw.PlacementID, hw)
		}
	}

	// Declared envelope but the support member declares no dims: the profile
	// still places, the support does not (fail-closed per member).
	noSupportDims := OpeningMembers{
		ProfileHardwareID: "hw-gola-8006",
		SupportHardwareID: "hw-su116",
		SupportSpacingMm:  400,
		ProfileHeightMm:   56.5,
		ProfileDepthMm:    27.2,
	}
	layout, _, err = resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:         openingPassFront("top", 40),
		openingMembers: &noSupportDims,
	})
	if err != nil {
		t.Fatalf("resolve without support dims: %v", err)
	}
	for _, hw := range layout.Hardware {
		if strings.Contains(hw.PlacementID, "support") {
			t.Fatalf("a member without declared dims must not place: %s", hw.PlacementID)
		}
		if strings.HasPrefix(hw.PlacementID, "opening-profile-") && hw.DimensionsMm != [3]float64{400, 27.2, 56.5} {
			t.Fatalf("declared profile envelope must survive: %+v", hw.DimensionsMm)
		}
	}
}
