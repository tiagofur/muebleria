package engine

import (
	"fmt"
)

// Opening bevel layout pass (#1327 slice 3): the profile's DECLARED door
// bevel — resolved once by ResolveOpeningBodyModifiers over the same
// resolution the fronts use — materializes as an exact local wedge on every
// door/drawer-front board. The wedge travels on LayoutComponent.Bevels so
// the host geometry, the machining operation and any renderer consume ONE
// definition — never two independent derivations.
//
// v1 geometry contract: only the italian gola's 45° cut at the door's
// furniture-top (or bottom) front edge is materializable, at WHATEVER size
// the profile declares — the engine never carries bevel constants. The door
// is the effect's only consumer (role "door"); any other role, a between
// boundary, or a bevel that does not fit the board fails closed.

// applyOpeningBevelsToBoards materializes every resolved bevel modifier onto
// the front boards the opening constrains. It runs right after the notch
// pass (the same before-projection slot), so AABB/transform derive with the
// wedge attached — the published board stays a valid AABB whose SUBTRACTION
// is structured data, never a shrunk surrogate board.
func applyOpeningBevelsToBoards(boards []layoutBoard, modifiers []ResolvedOpeningBodyModifier) error {
	for _, modifier := range modifiers {
		if modifier.Effect != OpeningModifierEffectBevel {
			continue
		}
		if modifier.Role != "door" {
			return fmt.Errorf(
				"el bisel del perfil %s declara el rol %q; sólo el rol \"door\" tiene consumidor de geometría en v1",
				modifier.ProfileID, modifier.Role)
		}
		kind := openingBoundaryKind(modifier.Boundary)
		if kind != "top" && kind != "bottom" {
			return fmt.Errorf(
				"el bisel del perfil %s sobre la frontera %q no tiene consumidor de geometría en v1",
				modifier.ProfileID, kind)
		}
		placed := false
		for i := range boards {
			if !boardIsOpeningFront(&boards[i]) {
				continue
			}
			bevel, err := localBevelPrism(&boards[i], modifier, kind)
			if err != nil {
				return err
			}
			boards[i].bevels = append(boards[i].bevels, bevel)
			placed = true
		}
		if !placed {
			return fmt.Errorf(
				"el bisel del perfil %s no encontró frentes que biselar",
				modifier.ProfileID)
		}
	}
	return nil
}

// localBevelPrism derives the EXACT local bounding prism of one front
// board's bevel wedge: it hugs the board's furniture-top (or bottom) end and
// its furniture-BACK edge, running the board's full remaining width, with
// the 45° wedge's equal legs on the vertical and back axes. The mapping
// reads the board's published basis (the same transform the contract
// carries), so a mirrored or flipped door never receives a mirrored cut by
// accident.
func localBevelPrism(board *layoutBoard, modifier ResolvedOpeningBodyModifier, kind string) (LayoutBevel, error) {
	lt, err := boardLocalTransform(board)
	if err != nil {
		return LayoutBevel{}, err
	}
	axis, sign, err := localAxisForFurnitureAxis(lt.Basis, 2, "vertical")
	if err != nil {
		return LayoutBevel{}, fmt.Errorf("componente %s: %w", board.id, err)
	}
	frontAxis, frontSign, err := localAxisForFurnitureAxis(lt.Basis, 1, "frente")
	if err != nil {
		return LayoutBevel{}, fmt.Errorf("componente %s: %w", board.id, err)
	}
	if frontAxis == axis {
		return LayoutBevel{}, fmt.Errorf("componente %s: el frente y la vertical comparten eje local", board.id)
	}
	sizes := [3]float64{board.widthMm, board.thicknessMm, board.lengthMm}

	// Vertical leg: from the board's furniture-top end downward (top
	// boundary) or its furniture-bottom end upward (bottom).
	start := [3]float64{}
	size := [3]float64{}
	axisSize := sizes[axis]
	if modifier.BevelSizeMm >= axisSize {
		return LayoutBevel{}, fmt.Errorf(
			"componente %s: el bisel %g mm no cabe en la dimensión vertical %g mm",
			board.id, modifier.BevelSizeMm, axisSize)
	}
	if (kind == "top") == (sign > 0) {
		start[axis] = axisSize - modifier.BevelSizeMm
	}
	size[axis] = modifier.BevelSizeMm

	// Front leg: the wedge hugs the furniture-BACK face. #1342: the
	// top_front (or bottom_front) bevel LOWERS the door's edge toward the
	// back — the furniture-front face stays full and the edge keeps its
	// thickness-minus-leg flat at the front. The removed wedge is the BACK
	// corner: hug the end OPPOSITE the furniture front.
	frontSize := sizes[frontAxis]
	if modifier.BevelSizeMm >= frontSize {
		return LayoutBevel{}, fmt.Errorf(
			"componente %s: el bisel %g mm no cabe en la dimensión de frente %g mm",
			board.id, modifier.BevelSizeMm, frontSize)
	}
	if frontSign < 0 {
		start[frontAxis] = frontSize - modifier.BevelSizeMm
	}
	size[frontAxis] = modifier.BevelSizeMm

	// The wedge runs the full remaining (width) axis.
	for a := 0; a < 3; a++ {
		if a != axis && a != frontAxis {
			size[a] = sizes[a]
		}
	}

	edge := "top_front"
	if kind == "bottom" {
		edge = "bottom_front"
	}
	return LayoutBevel{
		StartMm:   start,
		SizeMm:    size,
		AngleDeg:  modifier.BevelAngleDeg,
		Edge:      edge,
		ProfileID: modifier.ProfileID,
		Boundary:  modifier.Boundary,
	}, nil
}
