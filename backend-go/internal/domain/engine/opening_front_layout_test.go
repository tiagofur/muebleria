package engine

import "testing"

// #1131 — semantic-layer invariants beyond the shared fixture: edge
// incidence for the remaining direction/boundary combos, fail-closed shape
// validation precedence, and verbatim v1 error propagation.
func TestOpeningFrontLayoutEdgeIncidence(t *testing.T) {
	// Horizontal + bottom: every zone spans the height, so the bottom edge
	// grips ALL fronts from below.
	intent := OpeningIntent{
		Layout: OpeningLayout{Direction: "horizontal", Zones: []OpeningZone{
			{ID: "z1", Access: "hinged", Ratio: 1},
			{ID: "z2", Access: "hinged", Ratio: 1},
		}},
		Grips:       []OpeningGrip{{Boundary: "bottom", ProfileID: "p"}},
		Positioning: "overlay",
	}
	profiles := []OpeningProfileData{{ProfileID: "p", DatasheetStatus: "verified", FrontReductionMm: 10, GripClearanceMm: 5}}
	layout, resErr := ResolveOpeningFrontLayout(intent, 600, 720, profiles, nil)
	if resErr != nil {
		t.Fatalf("resolve rejected: %s (%s)", resErr.Code, resErr.Message)
	}
	for _, front := range layout.Fronts {
		if len(front.Grips) != 1 || front.Grips[0].Side != "below" || front.Grips[0].Boundary != "bottom" {
			t.Fatalf("front %s grips = %+v, want one bottom/below grip", front.ZoneID, front.Grips)
		}
	}
	// Axis mapping: horizontal divides the width (600−15 = 585 → 292/293),
	// the cross axis (height 720) passes through untouched.
	if layout.Fronts[0].WidthMm != 292 || layout.Fronts[0].HeightMm != 720 {
		t.Fatalf("front z1 box = %dx%d, want 292x720", layout.Fronts[0].WidthMm, layout.Fronts[0].HeightMm)
	}
	if layout.Fronts[1].WidthMm != 293 {
		t.Fatalf("front z2 width = %d, want 293 (remainder to the last zone)", layout.Fronts[1].WidthMm)
	}
}

func TestOpeningFrontLayoutShapeValidationBeforeEvidence(t *testing.T) {
	// Incompatible shape fails closed BEFORE evidence blocking: a broken
	// direction reports OPENING_LAYOUT_INVALID even with an OQ-3 positioning.
	intent := OpeningIntent{
		Layout: OpeningLayout{Direction: "diagonal", Zones: []OpeningZone{
			{ID: "z1", Access: "hinged", Ratio: 1},
		}},
		Positioning: "bottom_overhang",
	}
	_, resErr := ResolveOpeningFrontLayout(intent, 600, 720, nil, nil)
	if resErr == nil || resErr.Code != OpeningErrLayoutInvalid {
		t.Fatalf("code = %v, want %s", resErr, OpeningErrLayoutInvalid)
	}
}

func TestOpeningFrontLayoutPropagatesV1ErrorsVerbatim(t *testing.T) {
	// Valid shape + OQ-3 positioning: the v1 evidence block passes through
	// untouched — the semantic layer never masks or rewrites it.
	intent := OpeningIntent{
		Layout: OpeningLayout{Direction: "vertical", Zones: []OpeningZone{
			{ID: "z1", Access: "hinged", Ratio: 1},
		}},
		Positioning: "bottom_overhang",
	}
	_, resErr := ResolveOpeningFrontLayout(intent, 600, 720, nil, nil)
	if resErr == nil || resErr.Code != OpeningErrOverhangEvidencePend {
		t.Fatalf("code = %v, want %s", resErr, OpeningErrOverhangEvidencePend)
	}
}

func TestOpeningFrontLayoutRejectsNonPositiveFronts(t *testing.T) {
	intent := OpeningIntent{
		Layout: OpeningLayout{Direction: "vertical", Zones: []OpeningZone{
			{ID: "z1", Access: "drawer", Ratio: 1},
		}},
	}
	for _, dims := range [][2]int{{0, 720}, {600, 0}, {-1, 720}, {600, -1}} {
		_, resErr := ResolveOpeningFrontLayout(intent, dims[0], dims[1], nil, nil)
		if resErr == nil || resErr.Code != OpeningErrLayoutInvalid {
			t.Fatalf("dims %v: code = %v, want %s", dims, resErr, OpeningErrLayoutInvalid)
		}
	}
}

func TestOpeningFrontLayoutFrontsFollowZoneOrder(t *testing.T) {
	// Stable identity: fronts come out in zone order carrying the declared
	// zone ids — never re-derived from names or quantities.
	intent := OpeningIntent{
		Layout: OpeningLayout{Direction: "vertical", Zones: []OpeningZone{
			{ID: "drawer-top", Access: "drawer", Ratio: 2},
			{ID: "puerta-abajo", Access: "hinged", Ratio: 1},
		}},
	}
	layout, resErr := ResolveOpeningFrontLayout(intent, 600, 900, nil, nil)
	if resErr != nil {
		t.Fatalf("resolve rejected: %s (%s)", resErr.Code, resErr.Message)
	}
	wantIDs := []string{"drawer-top", "puerta-abajo"}
	for i, want := range wantIDs {
		if layout.Fronts[i].ZoneID != want {
			t.Fatalf("front %d id = %s, want %s", i, layout.Fronts[i].ZoneID, want)
		}
		if layout.Fronts[i].Access != intent.Layout.Zones[i].Access {
			t.Fatalf("front %s access = %s, want declared %s", want, layout.Fronts[i].Access, intent.Layout.Zones[i].Access)
		}
	}
}
