package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// #1131 — the semantic layer of the opening/front contract: the SAME shared
// fixture feeds ResolveOpeningFrontLayout in Go and resolveOpeningFrontLayout
// in TS. fronts carry stable identity (declared zone id), axis-mapped boxes,
// resolved grip data (OQ-1 sides) and the applied rules; shape errors fail
// closed before the v1 math (layoutInvalidCases).
func TestOpeningFrontLayoutContract(t *testing.T) {
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
			CabinetFrontWidthMm  int                  `json:"cabinetFrontWidthMm"`
			Positioning          string               `json:"positioning"`
			OverhangMm           *int                 `json:"overhangMm"`
			Layout               OpeningLayout        `json:"layout"`
			Grips                []OpeningGrip        `json:"grips"`
			ProfilesOverride     []OpeningProfileData `json:"profilesOverride"`
			Expected             struct {
				Fronts []OpeningResolvedFront `json:"fronts"`
			} `json:"expected"`
		} `json:"resolutionCases"`
		BlockedCases []struct {
			Name                 string               `json:"name"`
			CabinetFrontHeightMm int                  `json:"cabinetFrontHeightMm"`
			CabinetFrontWidthMm  int                  `json:"cabinetFrontWidthMm"`
			Positioning          string               `json:"positioning"`
			Layout               OpeningLayout        `json:"layout"`
			Grips                []OpeningGrip        `json:"grips"`
			ProfilesOverride     []OpeningProfileData `json:"profilesOverride"`
			ExpectedErrorCode    string               `json:"expectedErrorCode"`
		} `json:"blockedCases"`
		LayoutInvalidCases []struct {
			Name                 string        `json:"name"`
			CabinetFrontHeightMm int           `json:"cabinetFrontHeightMm"`
			CabinetFrontWidthMm  int           `json:"cabinetFrontWidthMm"`
			Layout               OpeningLayout `json:"layout"`
			Grips                []OpeningGrip `json:"grips"`
			ExpectedErrorCode    string        `json:"expectedErrorCode"`
		} `json:"layoutInvalidCases"`
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
			layout, resErr := ResolveOpeningFrontLayout(
				OpeningIntent{Layout: tc.Layout, Grips: tc.Grips, Positioning: tc.Positioning},
				tc.CabinetFrontWidthMm,
				tc.CabinetFrontHeightMm,
				profilesFor(tc.ProfilesOverride),
				tc.OverhangMm,
			)
			if resErr != nil {
				t.Fatalf("resolve rejected: %s (%s)", resErr.Code, resErr.Message)
			}
			if layout.Contract != OpeningFrontContract {
				t.Fatalf("contract = %s, want %s", layout.Contract, OpeningFrontContract)
			}
			if !reflect.DeepEqual(layout.Fronts, tc.Expected.Fronts) {
				t.Fatalf("fronts = %+v, want %+v", layout.Fronts, tc.Expected.Fronts)
			}
			// Every resolved front keeps the v1 zone ledger in sync: same
			// count, same order, same identity.
			if len(layout.Resolution.Zones) != len(layout.Fronts) {
				t.Fatalf("zones/fronts desync: %d zones vs %d fronts", len(layout.Resolution.Zones), len(layout.Fronts))
			}
		})
	}

	for _, tc := range fixture.BlockedCases {
		t.Run(tc.Name, func(t *testing.T) {
			_, resErr := ResolveOpeningFrontLayout(
				OpeningIntent{Layout: tc.Layout, Grips: tc.Grips, Positioning: tc.Positioning},
				tc.CabinetFrontWidthMm,
				tc.CabinetFrontHeightMm,
				profilesFor(tc.ProfilesOverride),
				nil,
			)
			if resErr == nil {
				t.Fatalf("expected blocked resolution with %s", tc.ExpectedErrorCode)
			}
			if resErr.Code != tc.ExpectedErrorCode {
				t.Fatalf("code = %s, want %s", resErr.Code, tc.ExpectedErrorCode)
			}
		})
	}

	for _, tc := range fixture.LayoutInvalidCases {
		t.Run(tc.Name, func(t *testing.T) {
			_, resErr := ResolveOpeningFrontLayout(
				OpeningIntent{Layout: tc.Layout, Grips: tc.Grips, Positioning: "overlay"},
				tc.CabinetFrontWidthMm,
				tc.CabinetFrontHeightMm,
				profilesFor(nil),
				nil,
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
