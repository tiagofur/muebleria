package engine

import (
	"fmt"
	"math"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Opening notch layout pass (#1287 / §13.3): the profile's DECLARED side
// notch — resolved once by ResolveOpeningBodyModifiers over the same
// resolution the fronts use — materializes as an exact local subtraction box
// on every side board. The box travels on LayoutComponent.Notches so the
// host geometry, the future machining operation and any renderer consume
// ONE definition — never two independent derivations.
//
// v1 geometry contract: only the top/bottom-boundary corner notch is
// materializable (the 8006 datasheet's 10×19 top_front cut). A between
// boundary or a non-zero front offset has no geometry consumer yet and
// fails closed; so does a notch that does not fit the board.

// applyOpeningNotchesToBoards materializes every resolved notch modifier
// onto the side boards it names by constructive role. It runs right after
// the fronts pass (the notches live on the body the opening constrained)
// and before the component projection, so AABB/transform derive with the
// notch attached — the published board stays a valid AABB whose SUBTRACTION
// is structured data, never a shrunk surrogate board.
func applyOpeningNotchesToBoards(boards []layoutBoard, modifiers []ResolvedOpeningBodyModifier) error {
	for _, modifier := range modifiers {
		if modifier.Effect != OpeningModifierEffectNotch {
			continue
		}
		if modifier.Role != "lateral" {
			return fmt.Errorf(
				"la muesca del perfil %s declara el rol %q; sólo el rol \"lateral\" tiene consumidor de geometría en v1",
				modifier.ProfileID, modifier.Role)
		}
		kind := openingBoundaryKind(modifier.Boundary)
		if kind != "top" && kind != "bottom" {
			return fmt.Errorf(
				"la muesca del perfil %s sobre la frontera %q no tiene consumidor de geometría en v1",
				modifier.ProfileID, kind)
		}
		if modifier.NotchOffsetMm != 0 {
			return fmt.Errorf(
				"la muesca del perfil %s con offset %d mm no tiene consumidor de geometría en v1 (sólo la esquina)",
				modifier.ProfileID, modifier.NotchOffsetMm)
		}
		placed := false
		for i := range boards {
			if !boardIsOpeningSide(&boards[i]) {
				continue
			}
			notch, err := localNotchBox(&boards[i], modifier, kind)
			if err != nil {
				return err
			}
			boards[i].notches = append(boards[i].notches, notch)
			placed = true
		}
		if !placed {
			return fmt.Errorf(
				"la muesca del perfil %s no encontró tableros laterales que recortar",
				modifier.ProfileID)
		}
	}
	return nil
}

// boardIsOpeningSide reports whether a board is a body side panel — the
// constructive role the profile's notch modifier addresses. Placement is
// the managed vocabulary, never a name match.
func boardIsOpeningSide(board *layoutBoard) bool {
	return board.placement == string(domain.PlacementLateralIzquierdo) ||
		board.placement == string(domain.PlacementLateralDerecho)
}

// localNotchBox derives the EXACT local subtraction box for one side board:
// the notch hugs the board's top (or bottom) end and its furniture-front
// edge, running through the full board thickness. The mapping reads the
// board's published basis (the same transform the contract carries), so a
// mirrored or flipped panel never receives a mirrored cut by accident.
func localNotchBox(board *layoutBoard, modifier ResolvedOpeningBodyModifier, kind string) (LayoutNotch, error) {
	lt, err := boardLocalTransform(board)
	if err != nil {
		return LayoutNotch{}, err
	}
	axis, sign, err := localAxisForFurnitureAxis(lt.Basis, 2, "vertical")
	if err != nil {
		return LayoutNotch{}, fmt.Errorf("componente %s: %w", board.id, err)
	}
	frontAxis, frontSign, err := localAxisForFurnitureAxis(lt.Basis, 1, "frente")
	if err != nil {
		return LayoutNotch{}, fmt.Errorf("componente %s: %w", board.id, err)
	}
	if frontAxis == axis {
		return LayoutNotch{}, fmt.Errorf("componente %s: el frente y la vertical comparten eje local", board.id)
	}
	sizes := [3]float64{board.widthMm, board.thicknessMm, board.lengthMm}

	start := [3]float64{}
	size := [3]float64{}
	// Vertical span: the notch hangs from the board's furniture-top end
	// (top boundary) or rises from its furniture-bottom end (bottom).
	axisSize := sizes[axis]
	if float64(modifier.NotchHeightMm) >= axisSize {
		return LayoutNotch{}, fmt.Errorf(
			"componente %s: la muesca %d mm no cabe en la dimensión vertical %g mm",
			board.id, modifier.NotchHeightMm, axisSize)
	}
	if (kind == "top") == (sign > 0) {
		start[axis] = axisSize - float64(modifier.NotchHeightMm)
	}
	size[axis] = float64(modifier.NotchHeightMm)

	// Front span: from the furniture-front edge toward the back.
	frontSize := sizes[frontAxis]
	if float64(modifier.NotchDepthMm) >= frontSize {
		return LayoutNotch{}, fmt.Errorf(
			"componente %s: la muesca %d mm no cabe en la dimensión de frente %g mm",
			board.id, modifier.NotchDepthMm, frontSize)
	}
	if frontSign > 0 {
		start[frontAxis] = frontSize - float64(modifier.NotchDepthMm)
	}
	size[frontAxis] = float64(modifier.NotchDepthMm)

	// Through the full remaining (thickness) axis.
	for a := 0; a < 3; a++ {
		if a != axis && a != frontAxis {
			size[a] = sizes[a]
		}
	}

	return LayoutNotch{
		StartMm:   start,
		SizeMm:    size,
		ProfileID: modifier.ProfileID,
		Boundary:  modifier.Boundary,
	}, nil
}

// boardLocalTransform recomputes the board's published local transform (the
// same math the component projection uses) without publishing a component.
func boardLocalTransform(board *layoutBoard) (LayoutLocalTransform, error) {
	lt, _, _, err := boardLocalPose(board)
	if err != nil {
		return LayoutLocalTransform{}, fmt.Errorf("componente %s: %w", board.id, err)
	}
	return lt, nil
}

// localAxisForFurnitureAxis finds the engine-local axis whose furniture
// image runs along the requested furniture axis (0=X, 1=Y front, 2=Z up)
// and reports whether the local + direction points along (+1) or against
// (−1) it. Boards publish axis-aligned bases, so the check is exact.
func localAxisForFurnitureAxis(basis LayoutBasis, furnitureAxis int, label string) (int, int, error) {
	columns := [3][3]float64{basis.X, basis.Y, basis.Z}
	for localAxis, column := range columns {
		component := column[furnitureAxis]
		if math.Abs(component-1) <= 1e-6 {
			return localAxis, 1, nil
		}
		if math.Abs(component+1) <= 1e-6 {
			return localAxis, -1, nil
		}
	}
	return 0, 0, fmt.Errorf("la base no alinea ningún eje local con el eje de mueble %q", label)
}
