package engine

import (
	"fmt"
	"math"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Opening depth-reduction layout pass (#1317 / §13.6): the profile's
// DECLARED depth reduction — resolved once by ResolveOpeningBodyModifiers —
// materializes on the horizontal body panels the constructive role
// addresses. At a top-boundary gola the profile occupies the front band
// Y ∈ [depth − reduction, depth] × Z ∈ [height − profileHeight, height];
// wood of the addressed role sitting in that band is corrected exactly two
// ways, the owner's §13.6 contract:
//   - a FULL-DEPTH panel (the techo, back edge at 0, front edge flush with
//     the cabinet front): its DEPTH MEASURE shrinks by the reduction — the
//     cut list fact, mirrored on the BOM by
//     openingDepthReductionAnnotations;
//   - a FRONT-FLUSH partial panel (the manguete superior frontal): its Y
//     POSITION recedes by the reduction, measure and orientation intact;
//   - any OTHER addressed-role board inside the band is unclassifiable wood
//     and fails the resolve — interference is never ignored silently;
//   - a board outside the band is untouched (the manguete amarre, the piso
//     at a top boundary).
//
// The band geometry is basis-aware (the same published-transform reading
// the notch pass uses), so a mirrored or flipped panel never moves the
// wrong end. The value is the pinned declaration's own number (explicit
// depthReductionMm or the derived profile_depth_mm) — the engine carries
// no discount constant.
//
// v1 materializes the canonical horizontal placements: `superior` at a top
// boundary, `base` at a bottom one (rebase). An addressed-role board inside
// the band on any other placement is the unclassifiable case above — it
// stops the resolve instead of receiving an invented correction.

// openingDepthReductionToleranceMm is the classification slack for
// flush/full-depth edges: formulas evaluate in integer millimetres, the
// derived reduction is decimal (27.2), so the touched extents differ from
// the furniture planes by at most rounding — half a millimetre separates
// "flush" from "protruding", never an invented correction.
const openingDepthReductionToleranceMm = 0.5

// applyOpeningDepthReductionToBoards materializes every resolved
// depth-reduction modifier onto the role-addressed boards. It runs right
// after the fronts and notch passes, BEFORE the authored-translation final
// pass: a board the opening corrected is exempt from authored translation —
// the front band's placement is the opening's (the same rule that governs
// constrained fronts). The returned set holds the corrected board indexes.
func applyOpeningDepthReductionToBoards(
	boards []layoutBoard,
	modifiers []ResolvedOpeningBodyModifier,
	dims LayoutDims,
) (map[int]bool, error) {
	affected := map[int]bool{}
	for _, modifier := range modifiers {
		if modifier.Effect != OpeningModifierEffectDepthReduction {
			continue
		}
		kind := openingBoundaryKind(modifier.Boundary)
		if kind != "top" && kind != "bottom" {
			return nil, fmt.Errorf(
				"la reducción de profundidad del perfil %s sobre la frontera %q no tiene consumidor de geometría",
				modifier.ProfileID, kind)
		}
		if modifier.ProfileHeightMm <= 0 || modifier.DepthReductionMm <= 0 {
			return nil, fmt.Errorf(
				"la reducción de profundidad del perfil %s no declara la banda del perfil (alto %g, descuento %g)",
				modifier.ProfileID, modifier.ProfileHeightMm, modifier.DepthReductionMm)
		}
		// The canonical horizontal placement the boundary corrects: the top
		// panel family at a gola, the bottom panel at a rebase.
		wantedPlacement := string(domain.PlacementSuperior)
		if kind == "bottom" {
			wantedPlacement = string(domain.PlacementBase)
		}
		depthMm := float64(dims.DepthMm)
		heightMm := float64(dims.HeightMm)
		bandY0 := depthMm - modifier.DepthReductionMm
		var bandZ0, bandZ1 float64
		if kind == "top" {
			bandZ0, bandZ1 = heightMm-modifier.ProfileHeightMm, heightMm
		} else {
			bandZ0, bandZ1 = 0, modifier.ProfileHeightMm
		}
		matched := false
		for i := range boards {
			board := &boards[i]
			if board.constructiveRole != modifier.Role {
				continue
			}
			local, err := boardLocalTransform(board)
			if err != nil {
				return nil, err
			}
			frontAxis, _, err := localAxisForFurnitureAxis(local.Basis, 1, "frente")
			if err != nil {
				return nil, fmt.Errorf("componente %s: %w", board.id, err)
			}
			sizes := [3]float64{board.widthMm, board.thicknessMm, board.lengthMm}
			y0, y1 := furnitureSpanFromLocal(local, 1, sizes)
			z0, z1 := furnitureSpanFromLocal(local, 2, sizes)
			// Outside the profile's band: the board never touches the profile
			// (manguete amarre, piso under a top gola) — intact.
			if y1 <= bandY0+1e-6 || y0 >= depthMm-1e-6 ||
				z1 <= bandZ0+1e-6 || z0 >= bandZ1-1e-6 {
				continue
			}
			// Addressed-role wood INSIDE the band on a non-canonical
			// placement is unclassifiable — fail closed instead of inventing
			// a correction.
			if board.placement != wantedPlacement {
				return nil, fmt.Errorf(
					"la reducción de profundidad del perfil %s encuentra el tablero %s (rol %q, placement %q) dentro de la banda del perfil; sólo %q es materializable en v1",
					modifier.ProfileID, board.id, modifier.Role, board.placement, wantedPlacement)
			}
			fullDepth := math.Abs(y0) <= openingDepthReductionToleranceMm &&
				math.Abs(y1-depthMm) <= openingDepthReductionToleranceMm
			frontFlush := math.Abs(y1-depthMm) <= openingDepthReductionToleranceMm
			if fullDepth {
				if y1-y0 <= modifier.DepthReductionMm+openingDepthReductionToleranceMm {
					return nil, fmt.Errorf(
						"el componente %s mide %g mm de fondo y la banda del perfil %s consume %g mm: el recorte no deja panel",
						board.id, y1-y0, modifier.ProfileID, modifier.DepthReductionMm)
				}
				// Techo: shrink the local dimension that maps to the
				// furniture depth — the front end recedes, the back edge and
				// the pose stay (validated on the published basis below).
				applyDepthReductionTrim(board, frontAxis, modifier.DepthReductionMm)
			} else if frontFlush {
				if y0-modifier.DepthReductionMm < -openingDepthReductionToleranceMm {
					return nil, fmt.Errorf(
						"el componente %s corre a fondo %g mm y la banda del perfil %s empuja %g mm: la corrección lo sacaría por el respaldo",
						board.id, y0, modifier.ProfileID, modifier.DepthReductionMm)
				}
				// Manguete frontal: the whole board recedes with the
				// profile's back face; measure and orientation intact.
				board.y -= modifier.DepthReductionMm
			} else {
				return nil, fmt.Errorf(
					"el tablero %s (rol %q) atraviesa la banda del perfil %s sin estar a fondo ni a tope de frente (Y [%g, %g] sobre profundidad %g); la corrección no es clasificable",
					board.id, modifier.Role, modifier.ProfileID, y0, y1, depthMm)
			}
			// Post-verification on the PUBLISHED transform: the furniture
			// extents must be exactly the corrected ones — a basis the
			// mutation cannot express fails loudly, never silently crooked.
			verified, err := boardLocalTransform(board)
			if err != nil {
				return nil, err
			}
			newSizes := [3]float64{board.widthMm, board.thicknessMm, board.lengthMm}
			vy0, vy1 := furnitureSpanFromLocal(verified, 1, newSizes)
			wantY0, wantY1 := y0, y1-modifier.DepthReductionMm
			if frontFlush && !fullDepth {
				wantY0 = y0 - modifier.DepthReductionMm
			}
			if math.Abs(vy0-wantY0) > 1e-6 || math.Abs(vy1-wantY1) > 1e-6 {
				return nil, fmt.Errorf(
					"componente %s: la corrección de profundidad dejó Y [%g, %g] en lugar de [%g, %g]; la base publicada no expresa el recorte",
					board.id, vy0, vy1, wantY0, wantY1)
			}
			vz0, vz1 := furnitureSpanFromLocal(verified, 2, newSizes)
			if math.Abs(vz0-z0) > 1e-6 || math.Abs(vz1-z1) > 1e-6 {
				return nil, fmt.Errorf(
					"componente %s: la corrección de profundidad movió la altura Z [%g, %g] → [%g, %g]",
					board.id, z0, z1, vz0, vz1)
			}
			affected[i] = true
			matched = true
		}
		if !matched {
			return nil, fmt.Errorf(
				"la reducción de profundidad del perfil %s no encontró tableros del rol %q dentro de la banda del perfil",
				modifier.ProfileID, modifier.Role)
		}
	}
	return affected, nil
}

// constructionConstructiveRole reads the component's DECLARED constructive
// role (#1052 vocabulary) — the addressing identity the depth-reduction
// pass matches against the profile's declared role. nil construction block
// = undeclared (never matched).
func constructionConstructiveRole(comp domain.Component) string {
	if comp.Construction == nil {
		return ""
	}
	return comp.Construction.ConstructiveRole
}

// applyDepthReductionTrim shrinks the board's local dimension along the
// furniture depth by reduction. The board's pose (the workshop AABB min
// corner) stays: for the canonical horizontal bases the local far end IS
// the furniture front, so shrinking the extent recedes the front edge. The
// caller verifies the published extents and fails closed otherwise.
func applyDepthReductionTrim(board *layoutBoard, frontAxis int, reduction float64) {
	switch frontAxis {
	case 0:
		board.widthMm -= reduction
	case 1:
		board.thicknessMm -= reduction
	case 2:
		board.lengthMm -= reduction
	}
}

// furnitureSpanFromLocal returns the furniture-frame span of the local box
// under an axis-aligned published basis (the same arithmetic
// aabbFromLocalTransform uses, for one axis).
func furnitureSpanFromLocal(local LayoutLocalTransform, furnitureAxis int, dims [3]float64) (float64, float64) {
	columns := [3][3]float64{local.Basis.X, local.Basis.Y, local.Basis.Z}
	lo, hi := local.TranslationMm[furnitureAxis], local.TranslationMm[furnitureAxis]
	for axis := 0; axis < 3; axis++ {
		span := columns[axis][furnitureAxis] * dims[axis]
		if span < 0 {
			lo += span
		} else {
			hi += span
		}
	}
	return lo, hi
}
