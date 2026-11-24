package engine

// A3 front pass (#1529): applies the opening front contract v2
// (ResolveOpeningEdgeStack) to the door/drawer-front boards of a furniture.
// Consumed by the layout pass (applyOpeningFrontsToBoards) and, through the
// same boards, by the cut list (applyOpeningFrontsToBomParts), so the
// reported, built and cut measures are one number by construction.
//
// The stack is read from the resolved poses, never from names or order:
// fronts whose vertical extents overlap share a row (doors side by side);
// rows are ordered top → bottom. The catalog reveals and gaps come from the
// same geometry, so a front without grips keeps its catalog size exactly.

import (
	"fmt"
	"math"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// OpeningEdgeGrips is the per-edge grip declaration of contract v2: the
// recipe's top discount and between discount. WHICH edges carry the between
// grip (and whether the top edge carries the top grip at all) is the stack's
// resolved distribution (#1706, OpeningGripPlacementFor) — never "every
// edge": the between profile opens the two fronts it touches, so pairs of
// fronts share one grip from the bottom up.
type OpeningEdgeGrips struct {
	TopDiscountMm     *float64 `json:"topDiscountMm,omitempty"`
	BetweenDiscountMm *float64 `json:"betweenDiscountMm,omitempty"`
	BottomOverhangMm  *float64 `json:"bottomOverhangMm,omitempty"`
}

func (g *OpeningEdgeGrips) empty() bool {
	return g == nil || (g.TopDiscountMm == nil && g.BetweenDiscountMm == nil && g.BottomOverhangMm == nil)
}

// openingFrontRow groups the boards of one row of the stack.
type openingFrontRow struct {
	boards   []int
	bottomMm float64
	topMm    float64
}

const openingRowAlignToleranceMm = 0.01

// openingFrontRows groups the opening fronts into rows (top → bottom).
// Fronts of one row must share their vertical extent; a front that overlaps
// two rows (a door next to a drawer column) is not a single stack and fails
// closed with the stacked-fronts code.
func openingFrontRows(boards []layoutBoard) ([]openingFrontRow, error) {
	var fronts []int
	for i := range boards {
		if boardIsOpeningFront(&boards[i]) {
			fronts = append(fronts, i)
		}
	}
	if len(fronts) == 0 {
		return nil, nil
	}
	sort.SliceStable(fronts, func(a, b int) bool { return boards[fronts[a]].z > boards[fronts[b]].z })
	var rows []openingFrontRow
	for _, index := range fronts {
		board := &boards[index]
		bottom, top := board.z, board.z+board.lengthMm
		placed := false
		for r := range rows {
			row := &rows[r]
			overlap := math.Min(top, row.topMm) - math.Max(bottom, row.bottomMm)
			if overlap <= openingStackToleranceMm {
				continue
			}
			if math.Abs(bottom-row.bottomMm) > openingRowAlignToleranceMm || math.Abs(top-row.topMm) > openingRowAlignToleranceMm {
				return nil, openingFail(OpeningErrStackedFronts,
					"los frentes no forman una sola columna (hay un frente junto a varios frentes apilados); el agarre por bordes todavía no resuelve columnas distintas")
			}
			row.boards = append(row.boards, index)
			placed = true
			break
		}
		if !placed {
			rows = append(rows, openingFrontRow{boards: []int{index}, bottomMm: bottom, topMm: top})
		}
	}
	return rows, nil
}

// openingBodyBottomZ is the body floor: the base panel's lower face, or the
// furniture origin when the structure has no base panel.
func openingBodyBottomZ(boards []layoutBoard) float64 {
	for i := range boards {
		if boards[i].placement == string(domain.PlacementBase) {
			return boards[i].z
		}
	}
	return 0
}

// openingA3Poses resolves A3 over the boards' stack. It returns the new
// bottom z and length of every front board (by board index) and the v2
// resolution itself (the reported measures).
func openingA3Poses(boards []layoutBoard, grips OpeningEdgeGrips, cabinetHeightMm float64) (map[int][2]float64, *OpeningEdgeStackResolution, error) {
	rows, err := openingFrontRows(boards)
	if err != nil || len(rows) == 0 {
		return nil, nil, err
	}
	floor := openingBodyBottomZ(boards)
	// #1706: the stack's resolved distribution decides which edges the
	// recipe's discounts land on — the top discount only with a mounted top
	// profile, the between discount only on gripped edges. Un-gripped edges
	// keep their catalog gap.
	placement := OpeningGripPlacementFor(len(rows))
	input := OpeningEdgeStackInput{
		CabinetHeightMm:  cabinetHeightMm - floor,
		TopRevealMm:      cabinetHeightMm - rows[0].topMm,
		BottomRevealMm:   rows[len(rows)-1].bottomMm - floor,
		BottomOverhangMm: grips.BottomOverhangMm,
	}
	if placement.TopGrip {
		input.TopDiscountMm = grips.TopDiscountMm
	}
	for r, row := range rows {
		id := fmt.Sprintf("row-%d", r+1)
		input.Rows = append(input.Rows, OpeningEdgeStackRow{ID: id, Weight: row.topMm - row.bottomMm})
		if r < len(rows)-1 {
			input.GapsMm = append(input.GapsMm, row.bottomMm-rows[r+1].topMm)
			if grips.BetweenDiscountMm != nil && placement.BetweenGripped[r] {
				input.BetweenGrips = append(input.BetweenGrips, OpeningEdgeBetweenGrip{UpperRowID: id, DiscountMm: *grips.BetweenDiscountMm})
			}
		}
	}
	resolution, resErr := ResolveOpeningEdgeStack(input)
	if resErr != nil {
		return nil, nil, resErr
	}
	poses := map[int][2]float64{}
	for r, row := range rows {
		resolved := resolution.Rows[r]
		for _, index := range row.boards {
			poses[index] = [2]float64{floor + resolved.BottomMm, resolved.HeightMm}
		}
	}
	return poses, resolution, nil
}
