package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// #1129 — the shared TS↔Go parity contract for the opening/front resolver:
// cases A/B/C/Baseline with the canonical math (integer millimetres,
// remainder to the last zone), evidence-blocked resolutions (OQ-2 datasheet,
// OQ-3 overhang) and fail-closed invalid intents. One authority, both
// stacks: contracts/openingFrontResolution.contract.json.
func TestOpeningFrontResolutionContract(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "contracts", "openingFrontResolution.contract.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Schema          int                  `json:"schema"`
		Contract        string               `json:"contract"`
		Profiles        []OpeningProfileData `json:"profiles"`
		ResolutionCases []struct {
			Name                 string               `json:"name"`
			CabinetFrontHeightMm int                  `json:"cabinetFrontHeightMm"`
			Positioning          string               `json:"positioning"`
			Layout               OpeningLayout        `json:"layout"`
			Grips                []OpeningGrip        `json:"grips"`
			ProfilesOverride     []OpeningProfileData `json:"profilesOverride"`
			Expected             struct {
				AvailableFrontHeightMm int                       `json:"availableFrontHeightMm"`
				Zones                  []OpeningResolvedZone     `json:"zones"`
				Boundaries             []OpeningResolvedBoundary `json:"boundaries"`
				RemainderZoneID        string                    `json:"remainderZoneId"`
			} `json:"expected"`
		} `json:"resolutionCases"`
		BlockedCases []struct {
			Name                 string               `json:"name"`
			CabinetFrontHeightMm int                  `json:"cabinetFrontHeightMm"`
			Positioning          string               `json:"positioning"`
			Layout               OpeningLayout        `json:"layout"`
			Grips                []OpeningGrip        `json:"grips"`
			ProfilesOverride     []OpeningProfileData `json:"profilesOverride"`
			ExpectedErrorCode    string               `json:"expectedErrorCode"`
		} `json:"blockedCases"`
		InvalidCases []struct {
			Name                 string               `json:"name"`
			CabinetFrontHeightMm int                  `json:"cabinetFrontHeightMm"`
			Layout               OpeningLayout        `json:"layout"`
			Grips                []OpeningGrip        `json:"grips"`
			ProfilesOverride     []OpeningProfileData `json:"profilesOverride"`
			ExpectedErrorCode    string               `json:"expectedErrorCode"`
		} `json:"invalidCases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if fixture.Schema != 1 || fixture.Contract != OpeningFrontContract {
		t.Fatalf("fixture contract mismatch: schema=%d contract=%s", fixture.Schema, fixture.Contract)
	}

	profilesFor := func(override []OpeningProfileData) []OpeningProfileData {
		if override != nil {
			return override
		}
		return fixture.Profiles
	}

	for _, tc := range fixture.ResolutionCases {
		t.Run(tc.Name, func(t *testing.T) {
			resolution, resErr := ResolveOpeningFront(
				OpeningIntent{Layout: tc.Layout, Grips: tc.Grips, Positioning: tc.Positioning},
				tc.CabinetFrontHeightMm,
				profilesFor(tc.ProfilesOverride),
			)
			if resErr != nil {
				t.Fatalf("resolve rejected: %s (%s)", resErr.Code, resErr.Message)
			}
			if resolution.AvailableFrontHeightMm != tc.Expected.AvailableFrontHeightMm {
				t.Fatalf("available = %d, want %d", resolution.AvailableFrontHeightMm, tc.Expected.AvailableFrontHeightMm)
			}
			if len(resolution.Zones) != len(tc.Expected.Zones) {
				t.Fatalf("zones = %+v, want %+v", resolution.Zones, tc.Expected.Zones)
			}
			for i, zone := range resolution.Zones {
				want := tc.Expected.Zones[i]
				if zone.ID != want.ID || zone.HeightMm != want.HeightMm || zone.OffsetFromStartMm != want.OffsetFromStartMm {
					t.Fatalf("zone %d = %+v, want %+v", i, zone, want)
				}
			}
			if len(resolution.Boundaries) != len(tc.Expected.Boundaries) {
				t.Fatalf("boundaries = %+v, want %+v", resolution.Boundaries, tc.Expected.Boundaries)
			}
			for i, boundary := range resolution.Boundaries {
				want := tc.Expected.Boundaries[i]
				if boundary.Boundary != want.Boundary || boundary.ConsumedMm != want.ConsumedMm {
					t.Fatalf("boundary %d = %+v, want %+v", i, boundary, want)
				}
			}
			if resolution.RemainderZoneID != tc.Expected.RemainderZoneID {
				t.Fatalf("remainder zone = %s, want %s", resolution.RemainderZoneID, tc.Expected.RemainderZoneID)
			}
		})
	}

	for _, tc := range fixture.BlockedCases {
		t.Run(tc.Name, func(t *testing.T) {
			_, resErr := ResolveOpeningFront(
				OpeningIntent{Layout: tc.Layout, Grips: tc.Grips, Positioning: tc.Positioning},
				tc.CabinetFrontHeightMm,
				profilesFor(tc.ProfilesOverride),
			)
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
			_, resErr := ResolveOpeningFront(
				OpeningIntent{Layout: tc.Layout, Grips: tc.Grips, Positioning: "overlay"},
				tc.CabinetFrontHeightMm,
				profilesFor(tc.ProfilesOverride),
			)
			if resErr == nil {
				t.Fatalf("expected fail-closed with %s", tc.ExpectedErrorCode)
			}
			if resErr.Code != tc.ExpectedErrorCode {
				t.Fatalf("code = %s, want %s", resErr.Code, tc.ExpectedErrorCode)
			}
		})
	}
}
