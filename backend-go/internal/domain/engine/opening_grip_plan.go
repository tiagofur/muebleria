package engine

// Grip distribution over a front stack (#1706, owner rule 2026-11-24): the
// between profile serves PAIRS of adjacent fronts counted from the bottom up
// (the edges below fronts 1–2, 3–4, …) — one C opens the two fronts it
// touches — and the top profile mounts only when the topmost front is left
// without a between grip, which is always the case with one to three fronts.
// The same rule covers the kitchen recipe (L top + C between) and the closet
// stacks; a workshop that does not want a distribution on one furniture
// applies another grip style to it (the existing per-furniture override).
//
// The distribution is DERIVED at resolve time from the stack's row count —
// the way the A3 reveals are — so styles, frozen snapshots and catalogs keep
// zero new fields. Every consumer (the A3 pass, the notch/bevel passes, the
// derived runs and strips, the despiece and the quote/release BOM) reads THIS
// placement and never recounts edges, so the model, the cut list and the
// demand cannot drift.

// OpeningGripPlacement is the resolved grip distribution of one furniture's
// front stack.
type OpeningGripPlacement struct {
	// TopGrip reports whether the top profile mounts at the stack's top edge.
	TopGrip bool
	// BetweenGripped reports, per stack boundary, whether that edge carries
	// the between profile: index r is the edge below row r, with the rows
	// ordered top → bottom (the A3 row ids: row-1 is the topmost row). Its
	// length is rowCount − 1; nil when the stack has a single row.
	BetweenGripped []bool
}

// OpeningGripPlacementFor resolves the distribution for a stack of rowCount
// fronts. Pure and deterministic:
//
//	rows → top grip · gripped boundaries (r = edge below row r, top → bottom)
//	1    → sí      · —
//	2    → sí      · [sí]
//	3    → sí      · [no, sí]
//	4    → no      · [sí, no, sí]
//	5    → sí      · [no, sí, no, sí]
//	6    → no      · [sí, no, sí, no, sí]
func OpeningGripPlacementFor(rowCount int) OpeningGripPlacement {
	placement := OpeningGripPlacement{}
	if rowCount < 1 {
		return placement
	}
	// The top front is served by a between grip exactly when the stack's
	// edge count is odd-shaped in its favour: with an even row count the
	// pairs reach the top front, so the top profile stays off (from four
	// fronts up — below that the owner mounts it always).
	placement.TopGrip = rowCount <= 3 || rowCount%2 == 1
	if rowCount >= 2 {
		placement.BetweenGripped = make([]bool, rowCount-1)
		for r := range placement.BetweenGripped {
			// The edge below row r joins fronts (rowCount−1−r) and
			// (rowCount−r) counted from the bottom; it carries the C when
			// the lower front of its pair is odd (pairs 1–2, 3–4, …).
			placement.BetweenGripped[r] = (rowCount-1-r)%2 == 1
		}
	}
	return placement
}

// BetweenEdgeCount is the number of stack edges that carry the between
// profile — the BOM's run multiplier.
func (p OpeningGripPlacement) BetweenEdgeCount() int {
	count := 0
	for _, gripped := range p.BetweenGripped {
		if gripped {
			count++
		}
	}
	return count
}
