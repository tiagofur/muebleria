package engine

import (
	"strings"
	"testing"
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
