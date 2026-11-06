package engine

import (
	"errors"
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
		t.Fatalf("bottom-grip door length = %v, want 646", door.LengthMm)
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
		t.Fatalf("overhang door = L %v @ %v, want 736 @ [2 560 -18]", door.LengthMm, door.Transform.TranslationMm)
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
		t.Fatalf("the opening must supersede the authored z (200): L=%v T=%v", door.LengthMm, door.Transform.TranslationMm)
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

// #1300: the opening members' HOST is the carcass board of the boundary
// (the top board for a top-boundary gola) — the presentation adapter
// rotates the door with its OWN hardware only, so a door-hosted grip
// swung with the door. The members must never host on the front.
func TestOpeningMembersHostOnTheCarcassBoard(t *testing.T) {
	module, catalog := oneDoorCabinetCatalog()
	catalog.Hardware = append(catalog.Hardware,
		domain.Hardware{ID: "hw-gola-8006", Code: "8006", Name: "Perfil Gola L 8006", Unit: domain.UnitMeter, Active: true},
	)
	dims := &LayoutDims{WidthMm: 400, HeightMm: 720, DepthMm: 560}
	members := OpeningMembers{
		ProfileHardwareID: "hw-gola-8006",
		ProfileHeightMm:   56.5,
		ProfileDepthMm:    27.2,
	}
	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:         openingPassFront("top", 40),
		openingMembers: &members,
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	for _, hw := range layout.Hardware {
		if !strings.HasPrefix(hw.PlacementID, "opening-") {
			continue
		}
		if hw.HostComponentInstanceID == "" {
			t.Fatalf("%s lost its host binding", hw.PlacementID)
		}
		for _, component := range layout.Components {
			if component.ComponentInstanceID == hw.HostComponentInstanceID &&
				(component.SlotID == "puerta" || component.SlotID == "frente_cajon") {
				t.Fatalf("%s hosts on the front %s — the grip must stay fixed to the carcass",
					hw.PlacementID, component.ComponentInstanceID)
			}
		}
	}
}

// #1528 → #1529 — a grip over STACKED fronts (a drawer column) no longer
// blocks: a v1 pin resolves with A3 (its discount as the top discount),
// measured from the cabinet height. Fronts side by side keep the v1
// arithmetic, and a bottom gola over a stack stays blocked.
func stackedDrawerBoards() []layoutBoard {
	return []layoutBoard{
		{id: "frente-1", placement: string(domain.PlacementFrenteCajon), z: 482, lengthMm: 236, widthMm: 596},
		{id: "frente-2", placement: string(domain.PlacementFrenteCajon), z: 242, lengthMm: 236, widthMm: 596},
		{id: "frente-3", placement: string(domain.PlacementFrenteCajon), z: 2, lengthMm: 236, widthMm: 596},
		{id: "lateral", placement: string(domain.PlacementLateralIzquierdo), z: 0, lengthMm: 684, widthMm: 560},
	}
}

func assertFrontPoses(t *testing.T, boards []layoutBoard, want map[string][2]float64) {
	t.Helper()
	for _, board := range boards {
		expected, ok := want[board.id]
		if !ok {
			continue
		}
		if board.z != expected[0] || board.lengthMm != expected[1] {
			t.Fatalf("%s = z %g L %g, want z %g L %g", board.id, board.z, board.lengthMm, expected[0], expected[1])
		}
	}
}

func TestOpeningFrontsStackedDrawersResolveWithA3(t *testing.T) {
	// v1 pin with a top gola of 40 over 3 drawers (H 720, reveals 2, gaps 4):
	// top edge 720 − 40 + 2 = 682, remaining 682 − 2 − 8 = 672 → 224 each.
	boards := stackedDrawerBoards()
	constrained, err := applyOpeningFrontsToBoards(boards, openingPassFront("top", 40), 720)
	if err != nil {
		t.Fatalf("a top grip over stacked drawers must resolve with A3: %v", err)
	}
	assertFrontPoses(t, boards, map[string][2]float64{
		"frente-1": {458, 224}, "frente-2": {230, 224}, "frente-3": {2, 224}, "lateral": {0, 684},
	})
	if !constrained[0] || !constrained[1] || !constrained[2] || constrained[3] {
		t.Fatalf("only the fronts are constrained: %v", constrained)
	}

	// Overhang 20 (v1 negative bottom consumption): bottom edge −20, top
	// keeps its reveal (718): remaining 738 − 8 = 730 → 243, 243.5, 243.5.
	overhang := stackedDrawerBoards()
	if _, err := applyOpeningFrontsToBoards(overhang, openingPassFront("bottom", -20), 720); err != nil {
		t.Fatalf("an overhang over stacked fronts resolves with A3: %v", err)
	}
	assertFrontPoses(t, overhang, map[string][2]float64{
		"frente-1": {475, 243}, "frente-2": {227.5, 243.5}, "frente-3": {-20, 243.5},
	})

	// A bottom gola has no v2 equivalent: still blocked, fronts untouched.
	bottom := stackedDrawerBoards()
	_, err = applyOpeningFrontsToBoards(bottom, openingPassFront("bottom", 40), 720)
	var openingErr *OpeningResolutionError
	if !errors.As(err, &openingErr) || openingErr.Code != OpeningErrStackedFronts {
		t.Fatalf("a bottom gola over stacked fronts must block, got %v", err)
	}
	assertFrontPoses(t, bottom, map[string][2]float64{"frente-1": {482, 236}, "frente-3": {2, 236}})

	// No grip consumption: nothing changes.
	untouched := stackedDrawerBoards()
	if _, err := applyOpeningFrontsToBoards(untouched, openingPassFront("top", 0), 720); err != nil {
		t.Fatalf("zero consumption must not block: %v", err)
	}
	assertFrontPoses(t, untouched, map[string][2]float64{"frente-1": {482, 236}})
}

// #1529 acceptance — contract v2: a 3-drawer column with gola L on top (40)
// and C between every drawer (36) resolves without blocking.
func TestOpeningFrontsV2DrawerColumnTopAndBetween(t *testing.T) {
	top, between := 40.0, 36.0
	front := openingPassFront("top", 0)
	front[0].Grips = nil
	front[0].EdgeGrips = &OpeningEdgeGrips{TopDiscountMm: &top, BetweenDiscountMm: &between}
	boards := stackedDrawerBoards()
	if _, err := applyOpeningFrontsToBoards(boards, front, 720); err != nil {
		t.Fatalf("v2 column must resolve: %v", err)
	}
	// top edge 682, bottom 2, gaps 36 + 36: remaining 608 → 202.5, 202.5, 203.
	assertFrontPoses(t, boards, map[string][2]float64{
		"frente-1": {479.5, 202.5}, "frente-2": {241, 202.5}, "frente-3": {2, 203},
	})
}

// #1529 acceptance — contract v2: two doors side by side with gola L give
// H − 40, whatever the catalog reveal (v2 replaces the reveal, never adds).
func TestOpeningFrontsV2SideBySideDoorsGiveHMinus40(t *testing.T) {
	top := 40.0
	front := openingPassFront("top", 0)
	front[0].Grips = nil
	front[0].EdgeGrips = &OpeningEdgeGrips{TopDiscountMm: &top}
	boards := []layoutBoard{
		{id: "puerta-izq", placement: string(domain.PlacementPuerta), x: 2, z: 2, lengthMm: 716, widthMm: 296},
		{id: "puerta-der", placement: string(domain.PlacementPuerta), x: 302, z: 2, lengthMm: 716, widthMm: 296},
	}
	if _, err := applyOpeningFrontsToBoards(boards, front, 720); err != nil {
		t.Fatalf("v2 doors: %v", err)
	}
	assertFrontPoses(t, boards, map[string][2]float64{"puerta-izq": {2, 680}, "puerta-der": {2, 680}})
	if boards[0].widthMm != 296 {
		t.Fatalf("the grip never touches the width: %g", boards[0].widthMm)
	}
}

// #1529 acceptance — contract v2: a wall cabinet with a 20 mm overhang gives
// a front of H − r_top + 20 with its bottom edge at −20.
func TestOpeningFrontsV2WallCabinetOverhang(t *testing.T) {
	overhang := 20.0
	front := openingPassFront("top", 0)
	front[0].Grips = nil
	front[0].EdgeGrips = &OpeningEdgeGrips{BottomOverhangMm: &overhang}
	boards := []layoutBoard{{id: "puerta", placement: string(domain.PlacementPuerta), z: 2, lengthMm: 716, widthMm: 596}}
	if _, err := applyOpeningFrontsToBoards(boards, front, 720); err != nil {
		t.Fatalf("v2 overhang: %v", err)
	}
	assertFrontPoses(t, boards, map[string][2]float64{"puerta": {-20, 738}})
}

func TestOpeningFrontsMixedColumnsStayBlocked(t *testing.T) {
	boards := []layoutBoard{
		{id: "puerta", placement: string(domain.PlacementPuerta), x: 2, z: 2, lengthMm: 716, widthMm: 296},
		{id: "cajon-1", placement: string(domain.PlacementFrenteCajon), x: 302, z: 362, lengthMm: 356, widthMm: 296},
		{id: "cajon-2", placement: string(domain.PlacementFrenteCajon), x: 302, z: 2, lengthMm: 356, widthMm: 296},
	}
	_, err := applyOpeningFrontsToBoards(boards, openingPassFront("top", 40), 720)
	var openingErr *OpeningResolutionError
	if !errors.As(err, &openingErr) || openingErr.Code != OpeningErrStackedFronts {
		t.Fatalf("a door next to a drawer column is not one stack: %v", err)
	}
}

func TestOpeningFrontsSideBySideDoorsKeepV1Arithmetic(t *testing.T) {
	boards := []layoutBoard{
		{id: "puerta-izq", placement: string(domain.PlacementPuerta), x: 2, z: 2, lengthMm: 716, widthMm: 296},
		{id: "puerta-der", placement: string(domain.PlacementPuerta), x: 302, z: 2, lengthMm: 716, widthMm: 296},
	}
	constrained, err := applyOpeningFrontsToBoards(boards, openingPassFront("top", 40), 720)
	if err != nil {
		t.Fatalf("two doors side by side must resolve: %v", err)
	}
	for i, board := range boards {
		if board.lengthMm != 676 || board.z != 2 || !constrained[i] {
			t.Fatalf("door %s = L %g @ z %g (constrained %v), want 676 @ 2", board.id, board.lengthMm, board.z, constrained[i])
		}
	}
}

func TestOpeningBomPartsWithoutPosesKeepTheStructuralRule(t *testing.T) {
	// Legacy flat modules have no poses: a structural stack stays blocked.
	drawers := []domain.BoardPart{
		{ID: "frente-cajon", Placement: string(domain.PlacementFrenteCajon), Quantity: 3, LengthMm: 236},
	}
	var openingErr *OpeningResolutionError
	if err := applyOpeningFrontsToBomParts(drawers, openingPassFront("top", 40), nil); !errors.As(err, &openingErr) || openingErr.Code != OpeningErrStackedFronts {
		t.Fatalf("3 drawer fronts without poses must block, got %v", err)
	}
	if drawers[0].LengthMm != 236 {
		t.Fatalf("a blocked cut list must not touch the part: %g", drawers[0].LengthMm)
	}
	doors := []domain.BoardPart{
		{ID: "puerta", Placement: string(domain.PlacementPuerta), Quantity: 2, LengthMm: 716},
	}
	if err := applyOpeningFrontsToBomParts(doors, openingPassFront("top", 40), nil); err != nil || doors[0].LengthMm != 676 {
		t.Fatalf("two doors side by side keep v1: err %v, length %g", err, doors[0].LengthMm)
	}
}

// #1529 — with poses, the cut list copies the A3 measure of each board by id.
func TestOpeningBomPartsCopyTheA3MeasureOfTheirBoard(t *testing.T) {
	parts := []domain.BoardPart{
		{ID: "frente-1", Placement: string(domain.PlacementFrenteCajon), Quantity: 1, LengthMm: 236},
		{ID: "frente-2", Placement: string(domain.PlacementFrenteCajon), Quantity: 1, LengthMm: 236},
		{ID: "frente-3", Placement: string(domain.PlacementFrenteCajon), Quantity: 1, LengthMm: 236},
	}
	stack := func() ([]layoutBoard, float64, error) { return stackedDrawerBoards(), 720, nil }
	if err := applyOpeningFrontsToBomParts(parts, openingPassFront("top", 40), stack); err != nil {
		t.Fatalf("stacked parts with poses resolve: %v", err)
	}
	for _, part := range parts {
		if part.LengthMm != 224 {
			t.Fatalf("%s = %g, want 224", part.ID, part.LengthMm)
		}
	}
	orphan := []domain.BoardPart{{ID: "frente-x", Placement: string(domain.PlacementFrenteCajon), Quantity: 1, LengthMm: 236}}
	if err := applyOpeningFrontsToBomParts(orphan, openingPassFront("top", 40), stack); err == nil {
		t.Fatal("a front part without its board must fail closed")
	}
}
