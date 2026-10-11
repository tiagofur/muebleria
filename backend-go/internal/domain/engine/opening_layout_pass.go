package engine

import (
	"fmt"
	"math"
	"strings"

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

		// Gola / integrated grips are handle-free: prune any handle hardware
		// (JALADERA) from this front so the 3D layout does not mount a pull bar
		// on a gola front.
		if len(front.Grips) > 0 && len(board.hardware) > 0 {
			filtered := make([]domain.HardwarePlacement, 0, len(board.hardware))
			for _, hp := range board.hardware {
				if strings.EqualFold(hp.OptionRole, "JALADERA") || strings.EqualFold(hp.OptionRole, "JALADERAS") {
					continue
				}
				filtered = append(filtered, hp)
			}
			board.hardware = filtered
		}
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

// OpeningMembers is the pinned member set (#1274) the layout materializes
// as DERIVED hardware placements when the design's opening constrained a
// furniture's fronts: the gola run plus its factory-declared companions.
// The ids and the spacing come from the selection's profile pin — never
// the live catalog — so a datasheet change never drifts a resolved model.
type OpeningMembers struct {
	ProfileHardwareID string
	SupportHardwareID string
	CapHardwareID     string
	SupportSpacingMm  int
}

// attachOpeningMembers appends the member placements to the FIRST
// constrained front board (the door/drawer-front the opening shrank) — the
// channel physically sits on that front's freed edge: anchorFace top for a
// top-boundary grip (gola), bottom for rebase. Placements live in the front
// board's face frame: x runs across the front's width (≈ the useful span),
// y sits at the freed edge. Industry conventions (#1274 research): one run
// centered on the span, ceil(span/spacing)+1 supports spread evenly, one
// cap per exposed end. Honest absences: no constrained front or no profile
// member places nothing.
func attachOpeningMembers(boards []layoutBoard, members OpeningMembers, constrained map[int]bool, bottomBoundary bool) {
	if members.ProfileHardwareID == "" {
		return
	}
	hostIdx := -1
	for i := range boards {
		if constrained[i] {
			hostIdx = i
			break
		}
	}
	if hostIdx < 0 {
		return
	}

	span := boards[hostIdx].widthMm
	if span <= 0 {
		return
	}
	face := "top"
	if bottomBoundary {
		face = "bottom"
	}
	at := func(hardwareID string, xMm float64) domain.HardwarePlacement {
		return domain.HardwarePlacement{
			HardwareID:       hardwareID,
			AnchorFace:       face,
			RelativePosition: domain.HardwareRelPosition{XMm: xMm},
		}
	}

	derived := []domain.HardwarePlacement{at(members.ProfileHardwareID, span/2)}
	if members.SupportHardwareID != "" && members.SupportSpacingMm > 0 {
		count := int(math.Ceil(span/float64(members.SupportSpacingMm))) + 1
		if count < 2 {
			count = 2
		}
		for i := 0; i < count; i++ {
			derived = append(derived, at(members.SupportHardwareID, span*float64(i)/float64(count-1)))
		}
	}
	if members.CapHardwareID != "" {
		derived = append(derived, at(members.CapHardwareID, 0), at(members.CapHardwareID, span))
	}
	boards[hostIdx].derivedHardware = append(boards[hostIdx].derivedHardware, derived...)
}

// openingFrontsBottomBoundary reports the zone edge the member hardware
// anchors to: a bottom grip (rebase) frees the front's bottom edge,
// anything else (gola's top consumption) the top edge.
func openingFrontsBottomBoundary(fronts []OpeningResolvedFront) bool {
	for _, grip := range fronts[0].Grips {
		if grip.Boundary == "bottom" {
			return true
		}
	}
	return false
}
