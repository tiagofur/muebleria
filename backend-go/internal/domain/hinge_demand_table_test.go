package domain

import (
	"encoding/json"
	"testing"
)

// #1579 — the table a hinge declares for itself: write validation, the surge
// tri-state on the wire, and the resolution ladder entry point.

func surge(v float64) *float64 { return &v }

func TestValidateHingeDemandTable(t *testing.T) {
	valid := HingeDemandPolicy{
		Bands:            []HingeDemandBand{{UpToHeightMm: 900, Hinges: 2}, {UpToHeightMm: 2400, Hinges: 5}},
		WidthSurgeOverMm: surge(650),
	}
	cases := []struct {
		name    string
		policy  *HingeDemandPolicy
		wantErr bool
	}{
		{"nil = no table, valid", nil, false},
		{"valid table", &valid, false},
		{"valid without surge (inherits the library rule)", &HingeDemandPolicy{Bands: valid.Bands}, false},
		{"empty bands", &HingeDemandPolicy{}, true},
		{"descending heights", &HingeDemandPolicy{Bands: []HingeDemandBand{{UpToHeightMm: 1600, Hinges: 3}, {UpToHeightMm: 900, Hinges: 2}}}, true},
		{"repeated height", &HingeDemandPolicy{Bands: []HingeDemandBand{{UpToHeightMm: 900, Hinges: 2}, {UpToHeightMm: 900, Hinges: 3}}}, true},
		{"non-positive height", &HingeDemandPolicy{Bands: []HingeDemandBand{{UpToHeightMm: 0, Hinges: 2}}}, true},
		{"one hinge is below the range", &HingeDemandPolicy{Bands: []HingeDemandBand{{UpToHeightMm: 900, Hinges: 1}}}, true},
		{"six hinges is above the range", &HingeDemandPolicy{Bands: []HingeDemandBand{{UpToHeightMm: 900, Hinges: 6}}}, true},
		{"negative surge", &HingeDemandPolicy{Bands: valid.Bands, WidthSurgeOverMm: surge(-5)}, true},
		{"optionRole has no meaning on a hinge", &HingeDemandPolicy{OptionRole: HingeDemandRole, Bands: valid.Bands}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateHingeDemandTable(tc.policy)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ValidateHingeDemandTable(%+v) err = %v, wantErr %v", tc.policy, err, tc.wantErr)
			}
		})
	}
}

func TestHingeDemandPolicyUnmarshalKeepsSurgeTriState(t *testing.T) {
	cases := []struct {
		name string
		json string
		want *float64
	}{
		{"absent inherits the library default", `{"bands":[{"upToHeightMm":900,"hinges":2}]}`, nil},
		{"explicit null disables", `{"bands":[{"upToHeightMm":900,"hinges":2}],"widthSurgeOverMm":null}`, surge(0)},
		{"zero disables", `{"bands":[{"upToHeightMm":900,"hinges":2}],"widthSurgeOverMm":0}`, surge(0)},
		{"a positive threshold applies", `{"bands":[{"upToHeightMm":900,"hinges":2}],"widthSurgeOverMm":650}`, surge(650)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got HingeDemandPolicy
			if err := json.Unmarshal([]byte(tc.json), &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			switch {
			case (got.WidthSurgeOverMm == nil) != (tc.want == nil):
				t.Fatalf("WidthSurgeOverMm = %v, want %v", got.WidthSurgeOverMm, tc.want)
			case got.WidthSurgeOverMm != nil && *got.WidthSurgeOverMm != *tc.want:
				t.Fatalf("WidthSurgeOverMm = %v, want %v", *got.WidthSurgeOverMm, *tc.want)
			}
		})
	}
	// A disabled surge marshals as 0, never null, so stored tables and release
	// snapshots round-trip without flipping "disabled" into "inherit".
	roundTripped, err := json.Marshal(HingeDemandPolicy{Bands: []HingeDemandBand{{UpToHeightMm: 900, Hinges: 2}}, WidthSurgeOverMm: surge(0)})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(roundTripped) != `{"bands":[{"upToHeightMm":900,"hinges":2}],"widthSurgeOverMm":0}` {
		t.Fatalf("marshaled disabled surge = %s", roundTripped)
	}
}

func TestHingeDemandForDoorLadder(t *testing.T) {
	exception := HingeDemandPolicy{Bands: []HingeDemandBand{{UpToHeightMm: 2400, Hinges: 2}}}
	factory := HingeDemandPolicy{Bands: []HingeDemandBand{{UpToHeightMm: 1200, Hinges: 2}, {UpToHeightMm: 2400, Hinges: 6}}}
	table := HingeDemandPolicy{Bands: []HingeDemandBand{{UpToHeightMm: 1200, Hinges: 3}, {UpToHeightMm: 2400, Hinges: 5}}}
	policy := &FactoryConstructionPolicy{
		DoorHingeDemand:    &factory,
		ComponentOverrides: map[string]*ComponentConstructionOverride{"comp-pue": {HingeDemand: &exception}},
	}
	hinge := &Hardware{HingeDemand: &table}
	plain := &Hardware{}

	cases := []struct {
		name      string
		policy    *FactoryConstructionPolicy
		component string
		hinge     *Hardware
		wantBands []HingeDemandBand
		wantNil   bool
	}{
		{"nil policy, no table: library ladder", nil, "comp-pue", plain, nil, true},
		{"nil policy, table: the hinge governs", nil, "comp-pue", hinge, table.Bands, false},
		{"factory, no table", policy, "comp-otra", plain, factory.Bands, false},
		{"factory yields to the table", policy, "comp-otra", hinge, table.Bands, false},
		{"component exception beats table and factory", policy, "comp-pue", hinge, exception.Bands, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.policy.HingeDemandForDoor(tc.component, tc.hinge)
			if tc.wantNil {
				if got != nil {
					t.Fatalf("policy = %+v, want nil", got)
				}
				return
			}
			if got == nil || len(got.Bands) != len(tc.wantBands) {
				t.Fatalf("policy = %+v, want bands %+v", got, tc.wantBands)
			}
			for i := range tc.wantBands {
				if got.Bands[i] != tc.wantBands[i] {
					t.Fatalf("band %d = %+v, want %+v", i, got.Bands[i], tc.wantBands[i])
				}
			}
		})
	}
}
