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
			OptionRole       string                `json:"optionRole"`
			Bands            []domain.HingeDemandBand `json:"bands"`
			WidthSurgeOverMm *float64              `json:"widthSurgeOverMm"`
		} `json:"defaultPolicy"`
		DemandCases []struct {
			Name           string `json:"name"`
			HeightMm       int    `json:"heightMm"`
			WidthMm        *int   `json:"widthMm"`
			ExpectedHinges int    `json:"expectedHinges"`
		} `json:"demandCases"`
		OverrideCases []struct {
			Name   string `json:"name"`
			Policy domain.HingeDemandPolicy `json:"policy"`
			Cases  []struct {
				HeightMm       int  `json:"heightMm"`
				WidthMm        *int `json:"widthMm"`
				ExpectedHinges int  `json:"expectedHinges"`
			} `json:"cases"`
		} `json:"overrideCases"`
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
		if got := domain.HingesForDoor(tc.HeightMm, width, &fixturePolicy); got != tc.ExpectedHinges {
			t.Fatalf("%s: HingesForDoor(%d,%d,fixture) = %d, want %d", tc.Name, tc.HeightMm, width, got, tc.ExpectedHinges)
		}
		// The library default IS the fixture policy: the no-policy call must
		// agree (the ladder falls back whole — bands AND surge).
		if got := domain.HingesForDoor(tc.HeightMm, width, nil); got != tc.ExpectedHinges {
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
			if got := domain.HingesForDoor(tc.HeightMm, width, &policy); got != tc.ExpectedHinges {
				t.Fatalf("%s (%dmm): HingesForDoor = %d, want %d", oc.Name, tc.HeightMm, got, tc.ExpectedHinges)
			}
		}
	}
}
