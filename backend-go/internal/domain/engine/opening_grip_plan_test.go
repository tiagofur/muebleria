package engine

// #1706: the grip distribution rule — the between profile serves PAIRS of
// fronts from the bottom up and the top profile mounts only when the topmost
// front is left without a between grip (always with one to three fronts).
// The table IS the owner's approved rule; every consumer derives its edges
// from this placement, never from its own recount.

import "testing"

func TestOpeningGripPlacementForRowCounts(t *testing.T) {
	equalBool := func(got, want []bool) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range got {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}
	cases := []struct {
		rows    int
		topGrip bool
		between []bool // index r = the edge below row r, top → bottom
	}{
		{rows: 0, topGrip: false, between: nil},
		{rows: 1, topGrip: true, between: nil},
		{rows: 2, topGrip: true, between: []bool{true}},
		{rows: 3, topGrip: true, between: []bool{false, true}},
		{rows: 4, topGrip: false, between: []bool{true, false, true}},
		{rows: 5, topGrip: true, between: []bool{false, true, false, true}},
		{rows: 6, topGrip: false, between: []bool{true, false, true, false, true}},
		{rows: 7, topGrip: true, between: []bool{false, true, false, true, false, true}},
	}
	for _, c := range cases {
		placement := OpeningGripPlacementFor(c.rows)
		if placement.TopGrip != c.topGrip {
			t.Fatalf("%d rows: topGrip = %v, want %v", c.rows, placement.TopGrip, c.topGrip)
		}
		if !equalBool(placement.BetweenGripped, c.between) {
			t.Fatalf("%d rows: between = %v, want %v", c.rows, placement.BetweenGripped, c.between)
		}
		wantGripped := 0
		for _, gripped := range c.between {
			if gripped {
				wantGripped++
			}
		}
		if placement.BetweenEdgeCount() != wantGripped {
			t.Fatalf("%d rows: betweenEdgeCount = %d, want %d", c.rows, placement.BetweenEdgeCount(), wantGripped)
		}
	}
}
