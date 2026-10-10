package engine

import (
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Opening fronts layout pass (#1264 / V2 OPEN-FRONT): the server-resolved
// front region CONSTRAINS the expanded door/drawer-front boards. The pass
// runs over []layoutBoard right after expansion, BEFORE the authored-
// translation final pass — under an opening, the vertical placement of a
// front is the opening's, never client-authored — and before the pose
// projection, so AABB/localTransform/machining derive naturally downstream.
//
// Semantics (v1 single-region pilot): every front board keeps its authored
// width split and holguras (the catalog formulas' gaps stay intact); each
// grip consumes from its boundary — a top grip shrinks the board from the
// top, a bottom grip lifts its bottom edge (z += consumed). A negative
// consumption (case C's overhang, #1138) extends the board downward with
// the same arithmetic. Fail-closed: a board that would end non-positive
// rejects the resolve — never an invented size.
//
// Identity is never inferred from names or order: the boards are selected
// by the managed vocabulary (placement puerta/frente_cajon, or the FRENTE
// role the door-swing criterion already owns).

// applyOpeningFrontsToBoards applies the resolved front region to the door
// and drawer-front boards. It returns the set of constrained board indexes —
// their authored translation is superseded by the opening's constraint.
func applyOpeningFrontsToBoards(boards []layoutBoard, fronts []OpeningResolvedFront) (map[int]bool, error) {
	if len(fronts) == 0 {
		return nil, nil
	}
	// v1 pilot: ONE front region per furniture — the design opening
	// selection resolves a single zone (ratio 1); multi-zone layouts are V3
	// explicit scope, never a silent split.
	front := fronts[0]
	consumedByBoundary := map[string]int{}
	totalConsumed := 0
	for _, grip := range front.Grips {
		consumedByBoundary[grip.Boundary] += grip.ConsumedMm
		totalConsumed += grip.ConsumedMm
	}
	constrained := map[int]bool{}
	for i := range boards {
		board := &boards[i]
		if !boardIsOpeningFront(board) {
			continue
		}
		if board.lengthMm-float64(totalConsumed) <= 0 {
			return nil, fmt.Errorf(
				"la apertura deja el frente %s sin altura válida (consumo %d mm sobre %g mm)",
				board.id, totalConsumed, board.lengthMm)
		}
		board.lengthMm -= float64(totalConsumed)
		if lift := consumedByBoundary["bottom"]; lift != 0 {
			board.z += float64(lift)
		}
		constrained[i] = true
	}
	return constrained, nil
}

// boardIsOpeningFront reports whether a board is a door/drawer-front the
// opening region constrains: the managed placements plus the FRENTE role
// criterion the door-swing accessories already own.
func boardIsOpeningFront(board *layoutBoard) bool {
	return board.placement == string(domain.PlacementPuerta) ||
		board.placement == string(domain.PlacementFrenteCajon) ||
		isDoorBoard(board)
}
