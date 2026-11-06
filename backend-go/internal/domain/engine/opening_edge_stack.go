package engine

// Opening front contract v2 (#1529, ADR-0009 Amendment 1 A3): one gap per
// edge of the front stack. Shared with the TS domain through
// contracts/openingFrontEdgeStack.contract.json (Go is the resolve
// authority; TS is parity only). Consumed by the layout and BOM front passes
// (opening_layout_pass.go) for stacked fronts.
//
// Rule (A3), measured from the cabinet height H, with z = 0 at the body
// bottom:
//   - top edge of the topmost row:  H − D_top + r_bottom with a top grip,
//     otherwise H − r_top (the catalog reveal);
//   - bottom edge of the lowest row: −X with a bottom overhang of X,
//     otherwise r_bottom (the catalog reveal);
//   - gap between rows i and i+1: D_between when that edge has a grip,
//     otherwise the catalog gap;
//   - remaining height = top − bottom − Σ gaps, split by the row weights.
//
// The discount replaces the edge's normal reveal; it is never added to it.
//
// Precision and remainder (fixed by this contract): every input is a
// multiple of 0.5 mm, the math runs in integer half millimetres, each row
// gets floor(remaining × weight / Σweights) and the leftover half
// millimetres go one by one to the LOWEST row first, moving up (the v1
// "last_zone_first" policy, rows ordered top → bottom).

import (
	"fmt"
	"math"
)

const OpeningFrontContractV2 = "granete.opening-front.v2"

// OpeningEdgeStackRow is one row of the front stack, top → bottom. Fronts
// side by side share a row. Weight is the row's share of the remaining
// height (the authored front height of the catalog formulas).
type OpeningEdgeStackRow struct {
	ID     string  `json:"id"`
	Weight float64 `json:"weight"`
}

// OpeningEdgeStackInput is the declared stack plus its grips.
type OpeningEdgeStackInput struct {
	CabinetHeightMm float64               `json:"cabinetHeightMm"`
	Rows            []OpeningEdgeStackRow `json:"rows"`
	// Catalog reveals of the stack (normal, no grip).
	TopRevealMm    float64   `json:"topRevealMm"`
	BottomRevealMm float64   `json:"bottomRevealMm"`
	GapsMm         []float64 `json:"gapsMm"` // len(Rows) − 1, gap below row i
	// Grips. nil = the edge keeps its catalog reveal.
	TopDiscountMm    *float64                 `json:"topDiscountMm,omitempty"`
	BetweenGrips     []OpeningEdgeBetweenGrip `json:"betweenGrips,omitempty"`
	BottomOverhangMm *float64                 `json:"bottomOverhangMm,omitempty"`
}

// OpeningEdgeBetweenGrip is a grip on the edge just below UpperRowID.
type OpeningEdgeBetweenGrip struct {
	UpperRowID string  `json:"upperRowId"`
	DiscountMm float64 `json:"discountMm"`
}

// OpeningEdgeStackResolvedRow is the BUILT front of one row: the same
// numbers the boards and the cut list use.
type OpeningEdgeStackResolvedRow struct {
	ID       string  `json:"id"`
	BottomMm float64 `json:"bottomMm"`
	HeightMm float64 `json:"heightMm"`
}

// OpeningEdgeStackResolution is the v2 result.
type OpeningEdgeStackResolution struct {
	Contract     string                        `json:"contract"`
	TopEdgeMm    float64                       `json:"topEdgeMm"`
	BottomEdgeMm float64                       `json:"bottomEdgeMm"`
	Rows         []OpeningEdgeStackResolvedRow `json:"rows"`
	RemainderRow string                        `json:"remainderRowId"`
}

// toHalfMm converts a millimetre value to integer half millimetres, failing
// when the value is not a multiple of 0.5 (beyond float noise).
func toHalfMm(value float64, field string) (int64, *OpeningResolutionError) {
	half := value * 2
	rounded := math.Round(half)
	if math.Abs(half-rounded) > 1e-6 || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, openingFail(OpeningErrLayoutInvalid,
			fmt.Sprintf("%s debe ser múltiplo de 0,5 mm (%g)", field, value))
	}
	return int64(rounded), nil
}

// ResolveOpeningEdgeStack applies A3 to a stack of fronts. Pure and
// deterministic; identical to the TS domain through the shared fixture.
func ResolveOpeningEdgeStack(input OpeningEdgeStackInput) (*OpeningEdgeStackResolution, *OpeningResolutionError) {
	rows := input.Rows
	if len(rows) == 0 {
		return nil, openingFail(OpeningErrLayoutInvalid, "la pila de frentes no tiene filas")
	}
	if len(input.GapsMm) != len(rows)-1 {
		return nil, openingFail(OpeningErrLayoutInvalid,
			fmt.Sprintf("la pila de %d filas necesita %d huecos entre frentes", len(rows), len(rows)-1))
	}
	seen := map[string]bool{}
	weightSum := 0.0
	for _, row := range rows {
		if row.ID == "" || seen[row.ID] {
			return nil, openingFail(OpeningErrLayoutInvalid, fmt.Sprintf("fila sin id o repetida %q", row.ID))
		}
		seen[row.ID] = true
		if !(row.Weight > 0) {
			return nil, openingFail(OpeningErrLayoutInvalid, fmt.Sprintf("la fila %s tiene un peso inválido", row.ID))
		}
		weightSum += row.Weight
	}
	h, err := toHalfMm(input.CabinetHeightMm, "el alto del mueble")
	if err != nil {
		return nil, err
	}
	rTop, err := toHalfMm(input.TopRevealMm, "la holgura superior")
	if err != nil {
		return nil, err
	}
	rBottom, err := toHalfMm(input.BottomRevealMm, "la holgura inferior")
	if err != nil {
		return nil, err
	}
	if h <= 0 || rTop < 0 || rBottom < 0 {
		return nil, openingFail(OpeningErrLayoutInvalid, "el alto debe ser positivo y las holguras no negativas")
	}

	top := h - rTop
	if input.TopDiscountMm != nil {
		discount, err := toHalfMm(*input.TopDiscountMm, "el descuento del frente arriba")
		if err != nil {
			return nil, err
		}
		if discount <= 0 {
			return nil, openingFail(OpeningErrLayoutInvalid, "el descuento del frente arriba debe ser mayor a 0")
		}
		top = h - discount + rBottom
	}
	bottom := rBottom
	if input.BottomOverhangMm != nil {
		overhang, err := toHalfMm(*input.BottomOverhangMm, "el rebase")
		if err != nil {
			return nil, err
		}
		if overhang <= 0 {
			return nil, openingFail(OpeningErrLayoutInvalid, "el rebase debe ser mayor a 0")
		}
		bottom = -overhang
	}

	rowIndex := map[string]int{}
	for i, row := range rows {
		rowIndex[row.ID] = i
	}
	betweenByIndex := map[int]float64{}
	for _, grip := range input.BetweenGrips {
		index, ok := rowIndex[grip.UpperRowID]
		if !ok || index >= len(rows)-1 {
			return nil, openingFail(OpeningErrBoundaryInvalid,
				fmt.Sprintf("la gola entre frentes bajo %q no tiene un frente debajo", grip.UpperRowID))
		}
		if _, dup := betweenByIndex[index]; dup {
			return nil, openingFail(OpeningErrBoundaryDuplicate,
				fmt.Sprintf("gola entre frentes repetida bajo %q", grip.UpperRowID))
		}
		betweenByIndex[index] = grip.DiscountMm
	}
	gaps := make([]int64, len(input.GapsMm))
	gapSum := int64(0)
	for i, gapMm := range input.GapsMm {
		gap, err := toHalfMm(gapMm, "el hueco entre frentes")
		if err != nil {
			return nil, err
		}
		if discount, ok := betweenByIndex[i]; ok {
			gap, err = toHalfMm(discount, "el descuento entre frentes")
			if err != nil {
				return nil, err
			}
			if gap <= 0 {
				return nil, openingFail(OpeningErrLayoutInvalid, "el descuento entre frentes debe ser mayor a 0")
			}
		}
		if gap < 0 {
			return nil, openingFail(OpeningErrLayoutInvalid, "el hueco entre frentes no puede ser negativo")
		}
		gaps[i] = gap
		gapSum += gap
	}

	remaining := top - bottom - gapSum
	if remaining <= 0 {
		return nil, openingFail(OpeningErrLayoutInvalid, "los descuentos consumen más que el alto del mueble")
	}
	heights := make([]int64, len(rows))
	used := int64(0)
	for i, row := range rows {
		heights[i] = int64(math.Floor(float64(remaining) * row.Weight / weightSum))
		used += heights[i]
	}
	// The floors lose less than one half millimetre per row, so one pass
	// from the lowest row up always absorbs the leftover.
	for i := len(rows) - 1; i >= 0 && used < remaining; i-- {
		heights[i]++
		used++
	}
	for i, height := range heights {
		if height <= 0 {
			return nil, openingFail(OpeningErrLayoutInvalid, fmt.Sprintf("la fila %s queda sin altura", rows[i].ID))
		}
	}

	resolved := make([]OpeningEdgeStackResolvedRow, len(rows))
	cursor := top
	for i, row := range rows {
		cursor -= heights[i]
		resolved[i] = OpeningEdgeStackResolvedRow{
			ID:       row.ID,
			BottomMm: float64(cursor) / 2,
			HeightMm: float64(heights[i]) / 2,
		}
		if i < len(gaps) {
			cursor -= gaps[i]
		}
	}
	return &OpeningEdgeStackResolution{
		Contract:     OpeningFrontContractV2,
		TopEdgeMm:    float64(top) / 2,
		BottomEdgeMm: float64(bottom) / 2,
		Rows:         resolved,
		RemainderRow: rows[len(rows)-1].ID,
	}, nil
}
