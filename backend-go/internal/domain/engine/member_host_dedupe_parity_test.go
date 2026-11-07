package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// #1557 — paridad TS↔Go del dedupe member-host/manual (#1429 slice B).
// Autoridad única: contracts/fixtures/memberHostDedupe.contract.json — los
// mismos casos (exacto, sub-umbral, fuera de umbral, cara distinta) corren en
// ambos runtimes contra la MISMA semántica (Chebyshev ±0.1mm por eje, misma
// cara; owner-wins; no-equivalentes conviven).
func TestMemberHostDedupeParity_1557(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "fixtures", "memberHostDedupe.contract.json"))
	if err != nil {
		t.Fatalf("reading shared fixture: %v", err)
	}
	var f struct {
		ToleranceMm float64 `json:"toleranceMm"`
		Cases       []struct {
			Name string `json:"name"`
			Hole struct {
				Face       string  `json:"face"`
				XMm        float64 `json:"xMm"`
				YMm        float64 `json:"yMm"`
				DiameterMm float64 `json:"diameterMm"`
				DepthMm    float64 `json:"depthMm"`
			} `json:"hole"`
			Manual struct {
				Face       string  `json:"face"`
				XMm        float64 `json:"xMm"`
				YMm        float64 `json:"yMm"`
				DiameterMm float64 `json:"diameterMm"`
				DepthMm    float64 `json:"depthMm"`
			} `json:"manual"`
			Equivalent bool `json:"equivalent"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("unmarshal shared fixture: %v", err)
	}
	if len(f.Cases) < 3 {
		t.Fatalf("fixture carries fewer than the 3 required cases")
	}
	for _, tc := range f.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			memberHost := ResolvedMachiningOperation{
				HostComponentInstanceID: "board-1",
				Provenance:              ResolvedMachiningProvenance{SourceKind: "assemblyMemberHost", MemberID: "fixed_rail_left"},
				Holes: []ResolveHole{{
					Face: tc.Hole.Face, XMm: tc.Hole.XMm, YMm: tc.Hole.YMm,
					DiameterMm: tc.Hole.DiameterMm, DepthMm: tc.Hole.DepthMm,
				}},
			}
			manual := ResolvedMachiningOperation{
				HostComponentInstanceID: "board-1",
				Provenance:              ResolvedMachiningProvenance{SourceKind: "manualHardwarePlacement", HardwarePlacementID: "hp-1"},
				Holes: []ResolveHole{{
					Face: tc.Manual.Face, XMm: tc.Manual.XMm, YMm: tc.Manual.YMm,
					DiameterMm: tc.Manual.DiameterMm, DepthMm: tc.Manual.DepthMm,
				}},
			}
			kept := dedupeMemberHostManualEquivalents([]ResolvedMachiningOperation{memberHost, manual})
			if tc.Equivalent {
				if len(kept) != 1 || kept[0].Provenance.SourceKind != "manualHardwarePlacement" {
					t.Fatalf("equivalent: the manual op must win (member-host suppressed), got %+v", kept)
				}
			} else {
				if len(kept) != 2 {
					t.Fatalf("non-equivalent: both holes must survive, got %+v", kept)
				}
			}
		})
	}
}
