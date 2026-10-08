package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1133 — the shared TS↔Go parity contract for the opening BOM resolver:
// profile runs, supports and end caps from the #1131 layout resolution with
// the rules DECLARED by each profile's bom_members; deterministic line
// identity, defined presentation units, datasheet spacing, resolved end
// conditions and fail-closed inputs. contracts/openingBom.contract.json.
func TestOpeningBOMContract(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "contracts", "openingBom.contract.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Schema          int `json:"schema"`
		ResolutionCases []struct {
			Name                   string                  `json:"name"`
			CabinetInteriorWidthMm int                     `json:"cabinetInteriorWidthMm"`
			Ends                   OpeningBOMEndConditions `json:"ends"`
			Layout                 OpeningFrontLayout      `json:"layout"`
			Profiles               []struct {
				ProfileID  string                              `json:"profileId"`
				Version    int64                               `json:"version"`
				BOMMembers map[string]OpeningContractBOMMember `json:"bomMembers"`
			} `json:"profiles"`
			ExpectedLines []OpeningResolvedBOMLine `json:"expectedLines"`
		} `json:"resolutionCases"`
		InvalidCases []struct {
			Name                   string                  `json:"name"`
			CabinetInteriorWidthMm int                     `json:"cabinetInteriorWidthMm"`
			Ends                   OpeningBOMEndConditions `json:"ends"`
			Layout                 OpeningFrontLayout      `json:"layout"`
			Profiles               []struct {
				ProfileID  string                              `json:"profileId"`
				Version    int64                               `json:"version"`
				BOMMembers map[string]OpeningContractBOMMember `json:"bomMembers"`
			} `json:"profiles"`
			ExpectedErrorCode string `json:"expectedErrorCode"`
		} `json:"invalidCases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if fixture.Schema != 1 {
		t.Fatalf("fixture schema = %d, want 1", fixture.Schema)
	}

	profilesOf := func(raw []struct {
		ProfileID  string                              `json:"profileId"`
		Version    int64                               `json:"version"`
		BOMMembers map[string]OpeningContractBOMMember `json:"bomMembers"`
	}) []OpeningProfileBOMData {
		profiles := make([]OpeningProfileBOMData, 0, len(raw))
		for _, p := range raw {
			profiles = append(profiles, OpeningProfileBOMData{
				ProfileID: p.ProfileID, Version: p.Version, BOMMembers: p.BOMMembers,
			})
		}
		return profiles
	}

	for _, tc := range fixture.ResolutionCases {
		t.Run(tc.Name, func(t *testing.T) {
			layout := tc.Layout
			lines, resErr := ResolveOpeningBOM(&layout, tc.CabinetInteriorWidthMm, tc.Ends, profilesOf(tc.Profiles))
			if resErr != nil {
				t.Fatalf("resolve rejected: %s (%s)", resErr.Code, resErr.Message)
			}
			if !reflect.DeepEqual(lines, tc.ExpectedLines) {
				t.Fatalf("lines = %+v, want %+v", lines, tc.ExpectedLines)
			}
			// Idempotence: resolving again yields the identical list — no
			// accumulation, no reordering.
			again, resErr := ResolveOpeningBOM(&layout, tc.CabinetInteriorWidthMm, tc.Ends, profilesOf(tc.Profiles))
			if resErr != nil {
				t.Fatalf("re-resolve rejected: %s (%s)", resErr.Code, resErr.Message)
			}
			if !reflect.DeepEqual(lines, again) {
				t.Fatal("re-resolving must produce the identical list")
			}
		})
	}

	for _, tc := range fixture.InvalidCases {
		t.Run(tc.Name, func(t *testing.T) {
			layout := tc.Layout
			_, resErr := ResolveOpeningBOM(&layout, tc.CabinetInteriorWidthMm, tc.Ends, profilesOf(tc.Profiles))
			if resErr == nil {
				t.Fatalf("expected fail-closed with %s", tc.ExpectedErrorCode)
			}
			if resErr.Code != tc.ExpectedErrorCode {
				t.Fatalf("code = %s, want %s", resErr.Code, tc.ExpectedErrorCode)
			}
		})
	}
}

// #1133 — unit invariants beyond the fixture: entity→contract mapping keeps
// every value, nil layout guard, and the run quantity is the exact metre
// presentation of the millimetre cut.
func TestOpeningBOMUnits(t *testing.T) {
	entity := domain.OpeningBOMMember{
		HardwareID: "328.109",
		Rule:       "per_length",
		Unit:       "piece",
		SpacingMm:  intPtr(250),
	}
	contract := openingContractBOMMember(entity)
	if contract.HardwareID != "328.109" || contract.Rule != "per_length" ||
		contract.Unit != "piece" || contract.SpacingMm == nil || *contract.SpacingMm != 250 {
		t.Fatalf("entity→contract mapping drifted: %+v", contract)
	}

	_, resErr := ResolveOpeningBOM(nil, 564, OpeningBOMEndConditions{LeftEnd: OpeningEndExposed, RightEnd: OpeningEndExposed}, nil)
	if resErr == nil || resErr.Code != OpeningErrBOMInvalid {
		t.Fatalf("nil layout: code = %v, want %s", resErr, OpeningErrBOMInvalid)
	}

	// Run presentation: the metre quantity is the exact mm/1000 of the cut.
	run, resErr := resolveOpeningBOMLine(
		OpeningProfileBOMData{ProfileID: "p", Version: 1},
		OpeningBOMMemberProfile,
		OpeningContractBOMMember{HardwareID: "328.160", Rule: OpeningBOMRuleInteriorWidth, Unit: OpeningBOMUnitMeter},
		"top", 567, 0,
	)
	if resErr != nil {
		t.Fatalf("run rejected: %s (%s)", resErr.Code, resErr.Message)
	}
	if run.CutLengthMm != 567 || run.Quantity != 0.567 || run.Unit != OpeningBOMUnitMeter {
		t.Fatalf("run line drifted: %+v", run)
	}
}
