package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1132 — the shared TS↔Go parity contract for the body-modifier resolver:
// declared profile modifiers × the #1131 layout resolution → exact per-role
// effects (depth reduction once, notches at resolved positions), with
// fail-closed shape/position/placement inputs and the double-apply guard.
// contracts/openingBodyModifiers.contract.json.
func TestOpeningBodyModifiersContract(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "contracts", "openingBodyModifiers.contract.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Schema          int `json:"schema"`
		ResolutionCases []struct {
			Name              string                        `json:"name"`
			Layout            OpeningFrontLayout            `json:"layout"`
			Profiles          []OpeningProfileBodyData      `json:"profiles"`
			ExpectedModifiers []ResolvedOpeningBodyModifier `json:"expectedModifiers"`
		} `json:"resolutionCases"`
		BlockedCases []struct {
			Name              string                   `json:"name"`
			Layout            OpeningFrontLayout       `json:"layout"`
			Profiles          []OpeningProfileBodyData `json:"profiles"`
			ExpectedErrorCode string                   `json:"expectedErrorCode"`
		} `json:"blockedCases"`
		InvalidCases []struct {
			Name              string                   `json:"name"`
			Layout            OpeningFrontLayout       `json:"layout"`
			Profiles          []OpeningProfileBodyData `json:"profiles"`
			ExpectedErrorCode string                   `json:"expectedErrorCode"`
		} `json:"invalidCases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if fixture.Schema != 1 {
		t.Fatalf("fixture schema = %d, want 1", fixture.Schema)
	}

	for _, tc := range fixture.ResolutionCases {
		t.Run(tc.Name, func(t *testing.T) {
			layout := tc.Layout
			modifiers, resErr := ResolveOpeningBodyModifiers(&layout, tc.Profiles)
			if resErr != nil {
				t.Fatalf("resolve rejected: %s (%s)", resErr.Code, resErr.Message)
			}
			if !reflect.DeepEqual(modifiers, tc.ExpectedModifiers) {
				t.Fatalf("modifiers = %+v, want %+v", modifiers, tc.ExpectedModifiers)
			}
			// Stable identity: effect|role|boundary is unique per feature.
			seen := map[string]bool{}
			for _, modifier := range modifiers {
				key := modifier.Effect + "|" + modifier.Role + "|" + modifier.Boundary
				if seen[key] {
					t.Fatalf("duplicated modifier identity %s", key)
				}
				seen[key] = true
			}
		})
	}

	for _, tc := range fixture.BlockedCases {
		t.Run(tc.Name, func(t *testing.T) {
			layout := tc.Layout
			_, resErr := ResolveOpeningBodyModifiers(&layout, tc.Profiles)
			if resErr == nil {
				t.Fatalf("expected blocked resolution with %s", tc.ExpectedErrorCode)
			}
			if resErr.Code != tc.ExpectedErrorCode {
				t.Fatalf("code = %s, want %s", resErr.Code, tc.ExpectedErrorCode)
			}
		})
	}

	for _, tc := range fixture.InvalidCases {
		t.Run(tc.Name, func(t *testing.T) {
			layout := tc.Layout
			_, resErr := ResolveOpeningBodyModifiers(&layout, tc.Profiles)
			if resErr == nil {
				t.Fatalf("expected fail-closed with %s", tc.ExpectedErrorCode)
			}
			if resErr.Code != tc.ExpectedErrorCode {
				t.Fatalf("code = %s, want %s", resErr.Code, tc.ExpectedErrorCode)
			}
		})
	}
}

// #1132 — the machining identity of a resolved modifier: its canonical form
// covers the complete geometry + provenance, so any value change moves the
// manufacturing identity the export chain keys off.
func TestOpeningBodyModifierMachiningIdentity(t *testing.T) {
	base := ResolvedOpeningBodyModifier{
		Effect:        OpeningModifierEffectNotch,
		Role:          "lateral",
		ProfileID:     "profile.gola-c.alu",
		Boundary:      "between:z2:z3",
		NotchHeightMm: 39,
		NotchDepthMm:  12,
		NotchOffsetMm: 305,
	}
	canonical := func(m ResolvedOpeningBodyModifier) string {
		raw, err := json.Marshal(m)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		return string(raw)
	}
	if canonical(base) != canonical(base) {
		t.Fatal("canonical form must be deterministic")
	}
	changedDepth := base
	changedDepth.NotchDepthMm = 15
	if canonical(base) == canonical(changedDepth) {
		t.Fatal("a depth change must move the machining identity")
	}
	changedProfile := base
	changedProfile.ProfileID = "profile.other.alu"
	if canonical(base) == canonical(changedProfile) {
		t.Fatal("a provenance change must move the machining identity")
	}
}

// #1132 — unit invariants beyond the fixture: role vocabulary reuse, nil
// layout guard and profile-unknown propagation.
func TestOpeningBodyModifierUnits(t *testing.T) {
	if !componentConstructiveRoles["horizontal"] || !componentConstructiveRoles["lateral"] {
		t.Fatal("the #1052 role vocabulary must contain horizontal/lateral")
	}
	if componentConstructiveRoles["techo"] {
		t.Fatal("conceptual names must NOT be part of the role vocabulary")
	}

	_, resErr := ResolveOpeningBodyModifiers(nil, nil)
	if resErr == nil || resErr.Code != OpeningErrBodyModifierInvalid {
		t.Fatalf("nil layout: code = %v, want %s", resErr, OpeningErrBodyModifierInvalid)
	}

	layout := OpeningFrontLayout{
		Contract: OpeningFrontContract,
		Resolution: &OpeningResolution{
			AvailableFrontHeightMm: 650,
			Boundaries:             []OpeningResolvedBoundary{{Boundary: "top", ConsumedMm: 70}},
		},
		Fronts: []OpeningResolvedFront{{
			ZoneID: "z1", Access: "hinged", WidthMm: 650, HeightMm: 720, OffsetMm: 0,
			Grips: []OpeningResolvedFrontGrip{{
				Boundary: "top", Side: "above", ProfileID: "ghost", ConsumedMm: 70,
			}},
		}},
	}
	_, resErr = ResolveOpeningBodyModifiers(&layout, []OpeningProfileBodyData{})
	if resErr == nil || resErr.Code != OpeningErrProfileUnknown {
		t.Fatalf("unknown profile: code = %v, want %s", resErr, OpeningErrProfileUnknown)
	}

	// Zero modifiers without grips: the baseline stays untouched.
	empty := OpeningFrontLayout{
		Contract: OpeningFrontContract,
		Resolution: &OpeningResolution{
			AvailableFrontHeightMm: 720,
			Boundaries:             []OpeningResolvedBoundary{},
		},
		Fronts: []OpeningResolvedFront{},
	}
	modifiers, resErr := ResolveOpeningBodyModifiers(&empty, []OpeningProfileBodyData{
		{ProfileID: "p", CompatiblePlacements: []string{"top"},
			BodyModifiers: []OpeningContractBodyModifier{
				openingContractBodyModifier(domain.OpeningBodyModifier{Role: "horizontal", DepthReductionMm: intPtr(20)}),
			}},
	})
	if resErr != nil {
		t.Fatalf("baseline rejected: %s (%s)", resErr.Code, resErr.Message)
	}
	if len(modifiers) != 0 {
		t.Fatalf("baseline modifiers = %+v, want none", modifiers)
	}
}
