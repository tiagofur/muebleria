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

// OpeningEdgeGrips is the per-edge grip declaration of contract v2. Between
// applies to every edge between two stacked rows (§14.3: the style's between
// profile grips every between edge of a stacked front column).
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
	input := OpeningEdgeStackInput{
		CabinetHeightMm:  cabinetHeightMm - floor,
		TopRevealMm:      cabinetHeightMm - rows[0].topMm,
		BottomRevealMm:   rows[len(rows)-1].bottomMm - floor,
		TopDiscountMm:    grips.TopDiscountMm,
		BottomOverhangMm: grips.BottomOverhangMm,
	}
	for r, row := range rows {
		id := fmt.Sprintf("row-%d", r+1)
		input.Rows = append(input.Rows, OpeningEdgeStackRow{ID: id, Weight: row.topMm - row.bottomMm})
		if r < len(rows)-1 {
			input.GapsMm = append(input.GapsMm, row.bottomMm-rows[r+1].topMm)
			if grips.BetweenDiscountMm != nil {
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

// openingEdgeGripsFromV1Front converts a v1 pin's single-region front into
// v2 edge grips for a stacked furniture (#1529: those were blocked by
// #1528, so no resolved design changes). A v1 bottom gola has no v2
// equivalent and stays blocked.
func openingEdgeGripsFromV1Front(front OpeningResolvedFront) (OpeningEdgeGrips, error) {
	var grips OpeningEdgeGrips
	for _, grip := range front.Grips {
		switch grip.Boundary {
		case "top":
			discount := float64(grip.ConsumedMm)
			grips.TopDiscountMm = &discount
		case "bottom":
			// A negative bottom consumption is the overhang; a positive one
			// is a bottom gola, which has no v2 equivalent.
			if grip.ConsumedMm > 0 {
				return grips, stackedFrontsError()
			}
			if grip.ConsumedMm < 0 {
				overhang := float64(-grip.ConsumedMm)
				grips.BottomOverhangMm = &overhang
			}
		default:
			return grips, stackedFrontsError()
		}
	}
	if front.OverhangMm != nil {
		overhang := float64(*front.OverhangMm)
		grips.BottomOverhangMm = &overhang
	}
	return grips, nil
}
