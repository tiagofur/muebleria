package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1078 — the shared TS↔Go hinge demand contract: the SAME
// contracts/hingeDemandBands.contract.json the vitest suite consumes pins the
// band ladder (≤900→2, 901–1600→3, 1601–2000→4, 2001–2400→5 with clamp),
// the Blum width surge and factory band overrides. One authority, every
// stack — and the drilling generator derives its cup count from the same
// policy, so cups drilled always equal hinges bought.
func TestHingeDemandBandsContract(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "contracts", "hingeDemandBands.contract.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Schema        int `json:"schema"`
		DefaultPolicy struct {
			OptionRole       string                   `json:"optionRole"`
			Bands            []domain.HingeDemandBand `json:"bands"`
			WidthSurgeOverMm *float64                 `json:"widthSurgeOverMm"`
		} `json:"defaultPolicy"`
		DemandCases []struct {
			Name           string `json:"name"`
			HeightMm       int    `json:"heightMm"`
			WidthMm        *int   `json:"widthMm"`
			ExpectedHinges int    `json:"expectedHinges"`
		} `json:"demandCases"`
		OverrideCases []struct {
			Name   string                   `json:"name"`
			Policy domain.HingeDemandPolicy `json:"policy"`
			Cases  []struct {
				HeightMm       int  `json:"heightMm"`
				WidthMm        *int `json:"widthMm"`
				ExpectedHinges int  `json:"expectedHinges"`
			} `json:"cases"`
		} `json:"overrideCases"`
		// #1579: the table a hinge declares for itself, the resolution ladder
		// and the last-band overflow warning.
		HingeTables     map[string]domain.HingeDemandPolicy `json:"hingeTables"`
		HingeTableCases []struct {
			Name    string `json:"name"`
			Table   string `json:"table"`
			Against string `json:"against"`
			Cases   []struct {
				Name                  string `json:"name"`
				HeightMm              int    `json:"heightMm"`
				WidthMm               *int   `json:"widthMm"`
				ExpectedHinges        int    `json:"expectedHinges"`
				ExpectedHingesAgainst *int   `json:"expectedHingesAgainst"`
			} `json:"cases"`
		} `json:"hingeTableCases"`
		Ladder struct {
			ComponentID   string                   `json:"componentId"`
			FactoryPolicy domain.HingeDemandPolicy `json:"factoryPolicy"`
			Exception     domain.HingeDemandPolicy `json:"exception"`
			Cases         []struct {
				Name           string  `json:"name"`
				Factory        bool    `json:"factory"`
				Table          *string `json:"table"`
				Exception      bool    `json:"exception"`
				HeightMm       int     `json:"heightMm"`
				WidthMm        *int    `json:"widthMm"`
				ExpectedHinges int     `json:"expectedHinges"`
			} `json:"cases"`
		} `json:"ladder"`
		OverflowCases []struct {
			Name                     string  `json:"name"`
			Table                    string  `json:"table"`
			HeightMm                 int     `json:"heightMm"`
			WidthMm                  *int    `json:"widthMm"`
			ExpectedHinges           int     `json:"expectedHinges"`
			ExpectedAboveLastBand    bool    `json:"expectedAboveLastBand"`
			ExpectedLastBandHeightMm float64 `json:"expectedLastBandHeightMm"`
			ExpectedNotice           *string `json:"expectedNotice"`
		} `json:"overflowCases"`
		TableValidationCases []struct {
			Name          string  `json:"name"`
			Table         *string `json:"table"`
			ExpectedError *string `json:"expectedError"`
		} `json:"tableValidationCases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if fixture.Schema != 1 {
		t.Fatalf("fixture schema = %d, want 1", fixture.Schema)
	}

	def := domain.DefaultHingeDemandPolicy()
	if fixture.DefaultPolicy.OptionRole != domain.HingeDemandRole {
		t.Fatalf("fixture optionRole %q, want %q", fixture.DefaultPolicy.OptionRole, domain.HingeDemandRole)
	}
	if len(fixture.DefaultPolicy.Bands) != len(def.Bands) {
		t.Fatalf("fixture bands %d, want %d", len(fixture.DefaultPolicy.Bands), len(def.Bands))
	}
	for i, band := range def.Bands {
		if fixture.DefaultPolicy.Bands[i] != band {
			t.Fatalf("fixture band %d = %+v, want %+v", i, fixture.DefaultPolicy.Bands[i], band)
		}
	}
	if (fixture.DefaultPolicy.WidthSurgeOverMm == nil) != (def.WidthSurgeOverMm == nil) ||
		(def.WidthSurgeOverMm != nil && *fixture.DefaultPolicy.WidthSurgeOverMm != *def.WidthSurgeOverMm) {
		t.Fatalf("fixture widthSurgeOverMm mismatch vs library default")
	}

	fixturePolicy := domain.HingeDemandPolicy{
		OptionRole:       fixture.DefaultPolicy.OptionRole,
		Bands:            fixture.DefaultPolicy.Bands,
		WidthSurgeOverMm: fixture.DefaultPolicy.WidthSurgeOverMm,
	}
	for _, tc := range fixture.DemandCases {
		width := 0
		if tc.WidthMm != nil {
			width = *tc.WidthMm
		}
		if got := domain.HingesForDoor(float64(tc.HeightMm), width, &fixturePolicy); got != tc.ExpectedHinges {
			t.Fatalf("%s: HingesForDoor(%d,%d,fixture) = %d, want %d", tc.Name, tc.HeightMm, width, got, tc.ExpectedHinges)
		}
		// The library default IS the fixture policy: the no-policy call must
		// agree (the ladder falls back whole — bands AND surge).
		if got := domain.HingesForDoor(float64(tc.HeightMm), width, nil); got != tc.ExpectedHinges {
			t.Fatalf("%s: HingesForDoor(%d,%d,nil) = %d, want %d", tc.Name, tc.HeightMm, width, got, tc.ExpectedHinges)
		}
	}

	for _, oc := range fixture.OverrideCases {
		policy := oc.Policy
		for _, tc := range oc.Cases {
			width := 0
			if tc.WidthMm != nil {
				width = *tc.WidthMm
			}
			if got := domain.HingesForDoor(float64(tc.HeightMm), width, &policy); got != tc.ExpectedHinges {
				t.Fatalf("%s (%dmm): HingesForDoor = %d, want %d", oc.Name, tc.HeightMm, got, tc.ExpectedHinges)
			}
		}
	}

	// #1579 — the table a hinge declares for itself.
	for _, group := range fixture.HingeTableCases {
		table := fixture.HingeTables[group.Table]
		against := fixture.HingeTables[group.Against]
		for _, tc := range group.Cases {
			width := 0
			if tc.WidthMm != nil {
				width = *tc.WidthMm
			}
			if got := domain.HingesForDoor(float64(tc.HeightMm), width, &table); got != tc.ExpectedHinges {
				t.Fatalf("%s / %s: HingesForDoor(table) = %d, want %d", group.Name, tc.Name, got, tc.ExpectedHinges)
			}
			// Same door, other hinge: the count follows the hinge chosen.
			if tc.ExpectedHingesAgainst != nil {
				if got := domain.HingesForDoor(float64(tc.HeightMm), width, &against); got != *tc.ExpectedHingesAgainst {
					t.Fatalf("%s / %s: HingesForDoor(against %s) = %d, want %d", group.Name, tc.Name, group.Against, got, *tc.ExpectedHingesAgainst)
				}
			}
		}
	}

	// #1579 — exception → the chosen hinge's table → factory → library.
	for _, tc := range fixture.Ladder.Cases {
		policy := &domain.FactoryConstructionPolicy{}
		if tc.Factory {
			factory := fixture.Ladder.FactoryPolicy
			policy.DoorHingeDemand = &factory
		}
		if tc.Exception {
			exception := fixture.Ladder.Exception
			policy.ComponentOverrides = map[string]*domain.ComponentConstructionOverride{
				fixture.Ladder.ComponentID: {HingeDemand: &exception},
			}
		}
		hinge := &domain.Hardware{}
		if tc.Table != nil {
			table := fixture.HingeTables[*tc.Table]
			hinge.HingeDemand = &table
		}
		width := 0
		if tc.WidthMm != nil {
			width = *tc.WidthMm
		}
		count := domain.ResolveHingeCount(float64(tc.HeightMm), width, policy.HingeDemandForDoor(fixture.Ladder.ComponentID, hinge))
		if count.Hinges != tc.ExpectedHinges {
			t.Fatalf("ladder %s: hinges = %d, want %d", tc.Name, count.Hinges, tc.ExpectedHinges)
		}
	}

	// #1579 — a door taller than the last band: the maximum, and the warning.
	for _, tc := range fixture.OverflowCases {
		table := fixture.HingeTables[tc.Table]
		width := 0
		if tc.WidthMm != nil {
			width = *tc.WidthMm
		}
		count := domain.ResolveHingeCount(float64(tc.HeightMm), width, &table)
		if count.Hinges != tc.ExpectedHinges || count.AboveLastBand != tc.ExpectedAboveLastBand ||
			count.LastBandHeightMm != tc.ExpectedLastBandHeightMm {
			t.Fatalf("overflow %s: got %+v, want hinges %d above %v last %v", tc.Name, count, tc.ExpectedHinges, tc.ExpectedAboveLastBand, tc.ExpectedLastBandHeightMm)
		}
		notice := domain.HingeDemandAboveLastBandMessage(float64(tc.HeightMm), count)
		if notice != derefOrEmpty(tc.ExpectedNotice) {
			t.Fatalf("overflow %s: notice = %q, want %q", tc.Name, notice, derefOrEmpty(tc.ExpectedNotice))
		}
	}

	// #1579 — why a hinge table is not writable: the same sentence the web
	// shows before the round-trip.
	for _, tc := range fixture.TableValidationCases {
		var table *domain.HingeDemandPolicy
		if tc.Table != nil {
			declared := fixture.HingeTables[*tc.Table]
			table = &declared
		}
		var got string
		if err := domain.ValidateHingeDemandTable(table); err != nil {
			got = err.Error()
		}
		if got != derefOrEmpty(tc.ExpectedError) {
			t.Fatalf("table validation %s: error = %q, want %q", tc.Name, got, derefOrEmpty(tc.ExpectedError))
		}
	}
}

func derefOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
