package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1137 — the design opening resolution: a persisted intent resolves over
// the furniture's explicit dims through the #1131 layout resolver (one
// front region in v1); pending evidence blocks honestly; the historical
// rule holds — today's capabilities never reach this path.
func TestResolveDesignOpening(t *testing.T) {
	verified := []OpeningProfileData{{
		ProfileID: "profile.gola-l.alu", DatasheetStatus: "verified",
		FrontReductionMm: 66, GripClearanceMm: 4,
	}}
	gola := &domain.DesignOpeningSelection{System: "gola", ProfileID: "profile.gola-l.alu"}

	// Resolved: the front carries the grip consumption and the read-only
	// dims the Inspector renders.
	resolution, resErr := ResolveDesignOpening(600, 720, gola, verified, nil)
	if resErr != nil {
		t.Fatalf("resolve rejected: %s (%s)", resErr.Code, resErr.Message)
	}
	if resolution.State != DesignOpeningStateResolved || len(resolution.Fronts) != 1 {
		t.Fatalf("resolution = %+v, want one resolved front", resolution)
	}
	front := resolution.Fronts[0]
	if front.HeightMm != 650 || front.Grips[0].ConsumedMm != 70 {
		t.Fatalf("front drifted: %+v", front)
	}

	// Pending datasheet: blocked, never invented.
	pending := []OpeningProfileData{{
		ProfileID: "profile.gola-l.alu", DatasheetStatus: "pending",
		FrontReductionMm: 66, GripClearanceMm: 4,
	}}
	resolution, resErr = ResolveDesignOpening(600, 720, gola, pending, nil)
	if resErr != nil || resolution == nil {
		t.Fatalf("pending must be a state, not an error: %v / %+v", resErr, resolution)
	}
	if resolution.State != DesignOpeningStateBlocked || resolution.Reason != OpeningErrDatasheetPending {
		t.Fatalf("blocked resolution drifted: %+v", resolution)
	}

	// OQ-3: bottom overhang stays blocked until field evidence.
	overhang := &domain.DesignOpeningSelection{System: "bottom_overhang"}
	resolution, resErr = ResolveDesignOpening(600, 720, overhang, nil, nil)
	if resErr != nil || resolution == nil || resolution.State != DesignOpeningStateBlocked ||
		resolution.Reason != OpeningErrOverhangEvidencePend {
		t.Fatalf("overhang must block on evidence: %v / %+v", resErr, resolution)
	}

	// Handle: baseline — the front consumes nothing.
	handle := &domain.DesignOpeningSelection{System: "handle"}
	resolution, resErr = ResolveDesignOpening(600, 720, handle, nil, nil)
	if resErr != nil || resolution.State != DesignOpeningStateResolved || resolution.Fronts[0].HeightMm != 720 {
		t.Fatalf("handle resolution drifted: %v / %+v", resErr, resolution)
	}

	// No selection: no resolution.
	if resolution, _ := ResolveDesignOpening(600, 720, nil, verified, nil); resolution != nil {
		t.Fatal("a design without intent must not resolve anything")
	}

	// Non-positive dims: the caller passed garbage — explicit failure.
	if _, resErr := ResolveDesignOpening(0, 720, gola, verified, nil); resErr == nil {
		t.Fatal("non-positive dims must fail closed", nil)
	}
}

// #1137 — the historical rule at the engine boundary: capabilities are not
// an input of ResolveDesignOpening (compile-time proof by signature) — a
// capability flip between write and read never changes a persisted design's
// resolution.
func TestResolveDesignOpeningIgnoresCapabilities(t *testing.T) {
	verified := []OpeningProfileData{{
		ProfileID: "profile.gola-l.alu", DatasheetStatus: "verified",
		FrontReductionMm: 66, GripClearanceMm: 4,
	}}
	gola := &domain.DesignOpeningSelection{System: "gola", ProfileID: "profile.gola-l.alu"}
	first, resErr := ResolveDesignOpening(600, 720, gola, verified, nil)
	if resErr != nil {
		t.Fatalf("resolve rejected: %v", resErr)
	}
	second, resErr := ResolveDesignOpening(600, 720, gola, verified, nil)
	if resErr != nil {
		t.Fatalf("repeat rejected: %v", resErr)
	}
	if first.State != second.State || len(first.Fronts) != len(second.Fronts) ||
		first.Fronts[0].HeightMm != second.Fronts[0].HeightMm {
		t.Fatal("repeated resolutions must be identical (stateless)")
	}
}
