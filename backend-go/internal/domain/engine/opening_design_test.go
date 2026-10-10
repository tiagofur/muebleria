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
	resolution, resErr := ResolveDesignOpening(600, 720, gola, verified, nil, nil)
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
	resolution, resErr = ResolveDesignOpening(600, 720, gola, pending, nil, nil)
	if resErr != nil || resolution == nil {
		t.Fatalf("pending must be a state, not an error: %v / %+v", resErr, resolution)
	}
	if resolution.State != DesignOpeningStateBlocked || resolution.Reason != OpeningErrDatasheetPending {
		t.Fatalf("blocked resolution drifted: %+v", resolution)
	}

	// OQ-3: bottom overhang stays blocked until field evidence.
	overhang := &domain.DesignOpeningSelection{System: "bottom_overhang"}
	resolution, resErr = ResolveDesignOpening(600, 720, overhang, nil, nil, nil)
	if resErr != nil || resolution == nil || resolution.State != DesignOpeningStateBlocked ||
		resolution.Reason != OpeningErrOverhangEvidencePend {
		t.Fatalf("overhang must block on evidence: %v / %+v", resErr, resolution)
	}

	// Handle: baseline — the front consumes nothing.
	handle := &domain.DesignOpeningSelection{System: "handle"}
	resolution, resErr = ResolveDesignOpening(600, 720, handle, nil, nil, nil)
	if resErr != nil || resolution.State != DesignOpeningStateResolved || resolution.Fronts[0].HeightMm != 720 {
		t.Fatalf("handle resolution drifted: %v / %+v", resErr, resolution)
	}

	// No selection: no resolution.
	if resolution, _ := ResolveDesignOpening(600, 720, nil, verified, nil, nil); resolution != nil {
		t.Fatal("a design without intent must not resolve anything")
	}

	// Non-positive dims: the caller passed garbage — explicit failure.
	if _, resErr := ResolveDesignOpening(0, 720, gola, verified, nil, nil); resErr == nil {
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
	first, resErr := ResolveDesignOpening(600, 720, gola, verified, nil, nil)
	if resErr != nil {
		t.Fatalf("resolve rejected: %v", resErr)
	}
	second, resErr := ResolveDesignOpening(600, 720, gola, verified, nil, nil)
	if resErr != nil {
		t.Fatalf("repeat rejected: %v", resErr)
	}
	if first.State != second.State || len(first.Fronts) != len(second.Fronts) ||
		first.Fronts[0].HeightMm != second.Fronts[0].HeightMm {
		t.Fatal("repeated resolutions must be identical (stateless)")
	}
}

// #1263 — the design-level BOM resolution: the PINNED BOM slice resolves the
// historical lines (revision + members frozen at validation), a pre-#1263 pin
// reports the truthful absence with no live fallback, the live slice feeds
// only pre-pin rows, and an underivable body context never invents a run.
func TestResolveDesignOpeningBOM(t *testing.T) {
	verified := []OpeningProfileData{{
		ProfileID: "profile.gola-l.alu", DatasheetStatus: "verified",
		FrontReductionMm: 38, GripClearanceMm: 2,
	}}
	spacing := 400
	members := func() map[string]domain.OpeningBOMMember {
		return map[string]domain.OpeningBOMMember{
			"profile":  {HardwareID: "HW-8006", Rule: "interior_width", Unit: "meter"},
			"supports": {HardwareID: "HW-SU116", Rule: "per_length", SpacingMm: &spacing},
			"endCaps":  {HardwareID: "HW-CAP", Rule: "per_exposed_end"},
		}
	}
	liveBOM := []OpeningProfileBOMData{{
		ProfileID: "profile.gola-l.alu", Version: 9, BOMMembers: map[string]OpeningContractBOMMember{
			"profile": {HardwareID: "HW-8006", Rule: "interior_width", Unit: "meter"},
		},
	}}
	newCtx := func(width int, profiles []OpeningProfileBOMData) *DesignOpeningBOMContext {
		ends := OpeningBOMDefaultEnds
		return &DesignOpeningBOMContext{CabinetInteriorWidthMm: width, Ends: ends, Profiles: profiles}
	}

	// Pinned selection: fronts from the pin AND lines from the frozen BOM
	// slice — the live catalog (v9) must not leak into the revision (v3).
	pinned := &domain.DesignOpeningSelection{
		System: "gola", ProfileID: "profile.gola-l.alu",
		ProfilePin: &domain.DesignOpeningProfilePin{
			ProfileCode: "8006", FrontReductionMm: 38, GripClearanceMm: 2, DatasheetStatus: "verified",
			BOM: &domain.DesignOpeningProfilePinBOM{ProfileVersion: 3, Members: members()},
		},
	}
	resolution, resErr := ResolveDesignOpening(600, 720, pinned, verified, nil, newCtx(564, liveBOM))
	if resErr != nil {
		t.Fatalf("resolve rejected: %s (%s)", resErr.Code, resErr.Message)
	}
	if resolution.State != DesignOpeningStateResolved || resolution.Fronts[0].HeightMm != 680 {
		t.Fatalf("front drifted: %+v", resolution)
	}
	if len(resolution.BOM) != 3 || resolution.BOMReason != "" {
		t.Fatalf("BOM = %+v (reason %q), want the three pinned lines", resolution.BOM, resolution.BOMReason)
	}
	byMember := map[string]OpeningResolvedBOMLine{}
	for _, line := range resolution.BOM {
		byMember[line.MemberKey] = line
	}
	if line := byMember["profile"]; line.Quantity != 0.564 || line.CutLengthMm != 564 || line.ProfileVersion != 3 || line.Unit != "meter" {
		t.Fatalf("profile run drifted: %+v", line)
	}
	if line := byMember["supports"]; line.Quantity != 3 || line.Unit != "piece" {
		t.Fatalf("supports drifted: %+v (ceil(564/400)+1 = 3)", line)
	}
	if line := byMember["endCaps"]; line.Quantity != 2 {
		t.Fatalf("end caps drifted: %+v (both ends exposed)", line)
	}
	if resolution.BOMEnds == nil || resolution.BOMEnds.LeftEnd != "exposed" || resolution.BOMEnds.RightEnd != "exposed" {
		t.Fatalf("ends must ride visibly: %+v", resolution.BOMEnds)
	}

	// Pre-#1263 pin: the truthful absence — the live slice never backfills a
	// historical design's BOM.
	legacyPin := &domain.DesignOpeningSelection{
		System: "gola", ProfileID: "profile.gola-l.alu",
		ProfilePin: &domain.DesignOpeningProfilePin{
			ProfileCode: "8006", FrontReductionMm: 38, GripClearanceMm: 2, DatasheetStatus: "verified",
		},
	}
	resolution, _ = ResolveDesignOpening(600, 720, legacyPin, verified, nil, newCtx(564, liveBOM))
	if resolution.BOM != nil || resolution.BOMReason != OpeningReasonBOMPinSliceMissing {
		t.Fatalf("legacy pin must report the missing slice: %+v (%q)", resolution.BOM, resolution.BOMReason)
	}

	// Pre-pin row (authored before pins existed): the live slice resolves.
	noPin := &domain.DesignOpeningSelection{System: "gola", ProfileID: "profile.gola-l.alu"}
	resolution, _ = ResolveDesignOpening(600, 720, noPin, verified, nil, newCtx(564, liveBOM))
	if len(resolution.BOM) != 1 || resolution.BOM[0].ProfileVersion != 9 || resolution.BOMReason != "" {
		t.Fatalf("live slice must feed pre-pin rows: %+v (%q)", resolution.BOM, resolution.BOMReason)
	}

	// Unknown live profile: the FRONT resolution blocks first with the same
	// code — a BOM reason for it is unreachable from one caller, kept only as
	// engine-side defense (designOpeningBOMData).

	// Underivable body context: no invented run length.
	resolution, _ = ResolveDesignOpening(600, 720, noPin, verified, nil, newCtx(0, liveBOM))
	if resolution.BOM != nil || resolution.BOMReason != OpeningReasonBOMBodyContextMissing {
		t.Fatalf("missing body context must be truthful: %+v (%q)", resolution.BOM, resolution.BOMReason)
	}

	// Corrupt declared data: the BOM reason carries the fail-closed code while
	// the fronts stay resolved.
	corrupt := &domain.DesignOpeningSelection{
		System: "gola", ProfileID: "profile.gola-l.alu",
		ProfilePin: &domain.DesignOpeningProfilePin{
			ProfileCode: "8006", FrontReductionMm: 38, GripClearanceMm: 2, DatasheetStatus: "verified",
			BOM: &domain.DesignOpeningProfilePinBOM{ProfileVersion: 3, Members: map[string]domain.OpeningBOMMember{
				"profile": {HardwareID: "HW-8006", Rule: "regla inventada", Unit: "meter"},
			}},
		},
	}
	resolution, _ = ResolveDesignOpening(600, 720, corrupt, verified, nil, newCtx(564, liveBOM))
	if resolution.State != DesignOpeningStateResolved || resolution.Fronts[0].HeightMm != 680 ||
		resolution.BOM != nil || resolution.BOMReason != OpeningErrBOMInvalid {
		t.Fatalf("corrupt members must not block fronts nor invent lines: %+v (%q)", resolution, resolution.BOMReason)
	}

	// Non-gola systems never grow a BOM even with a context.
	handle := &domain.DesignOpeningSelection{System: "handle"}
	resolution, _ = ResolveDesignOpening(600, 720, handle, nil, nil, newCtx(564, liveBOM))
	if resolution.BOM != nil || resolution.BOMReason != "" || resolution.BOMEnds != nil {
		t.Fatalf("handle must stay baseline: %+v", resolution)
	}
}
