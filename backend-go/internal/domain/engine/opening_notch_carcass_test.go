package engine

// #1708 — the between-fronts side notch belongs to the CARCASS side panels
// only (the profile band lives at the carcass front plane, the same truthful
// host doctrine #1300 applies to the profile run). Drawer-box walls carry the
// same lateral placement but are their own agregado boards: their extent is
// the box's, and the distribution of #1706 moved the gripped joint up enough
// to expose the latent mis-cut (the live failure: «la muesca entre frentes
// (293–366 mm) no cabe en el lateral» on an agregado board of a 1x/1x/2x
// column). The pass must cut carcass sides and leave assembly boards alone.

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func notchCarcassBoards() []layoutBoard {
	return []layoutBoard{
		// The resolved front stack (the geometry the notch hangs from) — the
		// pose fields mirror what the expansion emits (probe: rotY 180).
		{id: "frente-1", placement: string(domain.PlacementFrenteCajon), x: 2, y: 560, z: 482, lengthMm: 236, widthMm: 596, thicknessMm: 18, rotY: 180},
		{id: "frente-2", placement: string(domain.PlacementFrenteCajon), x: 2, y: 560, z: 242, lengthMm: 236, widthMm: 596, thicknessMm: 18, rotY: 180},
		{id: "frente-3", placement: string(domain.PlacementFrenteCajon), x: 2, y: 560, z: 2, lengthMm: 236, widthMm: 596, thicknessMm: 18, rotY: 180},
		// The carcass side: spans the full body height, owns no assembly —
		// the pose mirrors what the expansion emits (probe: rot 90/180/90).
		{id: "st-comp-side", placement: string(domain.PlacementLateralIzquierdo), x: 0, y: 0, z: 0, lengthMm: 684, widthMm: 560, thicknessMm: 18, rotX: 90, rotY: 180, rotZ: 90},
		// The drawer-box wall of unit 0: same lateral placement, its own
		// assembly, extent [2, 150] — the gripped joint's notch [169, 242]
		// does NOT fit inside it (the live failure's shape).
		{id: "agr-x-instance-y-u0-b0000004-copy-0", placement: string(domain.PlacementLateralIzquierdo), x: 18, y: 0, z: 2, lengthMm: 148, widthMm: 520, thicknessMm: 18, rotX: 90, rotY: 180, rotZ: 90, assemblyInstanceID: "asm-u0"},
	}
}

func TestOpeningBetweenNotchCutsCarcassSidesOnly(t *testing.T) {
	boards := notchCarcassBoards()
	rows, err := openingFrontRows(boards)
	if err != nil || len(rows) != 3 {
		t.Fatalf("fixture rows: %v %v", rows, err)
	}
	// The distribution grips the edge below row 1: the notch hangs from
	// rows[1].bottomMm = 242 → [169, 242].
	placement := OpeningGripPlacementFor(len(rows))
	if !placement.BetweenGripped[1] || placement.BetweenGripped[0] {
		t.Fatalf("fixture placement drifted: %+v", placement.BetweenGripped)
	}
	modifiers := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectNotch, Role: "lateral", ProfileID: "c-8007",
		Boundary: "between", NotchHeightMm: 73, NotchDepthMm: 17,
	}}
	if err := applyOpeningNotchesToBoards(boards, modifiers); err != nil {
		t.Fatalf("the notch must cut the carcass side and leave the box wall alone: %v", err)
	}
	for i := range boards {
		cuts := 0
		for _, notch := range boards[i].notches {
			if strings.Contains(notch.Boundary, "between") {
				cuts++
			}
		}
		if boards[i].assemblyInstanceID != "" && cuts > 0 {
			t.Fatalf("%s is an assembly board: it must never receive the side notch (%d cuts)", boards[i].id, cuts)
		}
		if boards[i].assemblyInstanceID == "" && boards[i].placement == string(domain.PlacementLateralIzquierdo) && cuts != 1 {
			t.Fatalf("%s: the carcass side must carry exactly one between notch, got %d", boards[i].id, cuts)
		}
	}
}
