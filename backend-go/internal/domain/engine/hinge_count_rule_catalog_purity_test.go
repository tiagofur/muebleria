package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1710 — the countRule expansion mutated the CALLER's catalog: the instance
// copy shares the Overrides POINTER with the catalog entry, so writing the
// expanded (or dropped, when choices are nil — the projection estimate pass
// resolves with nil, nil) placements rewrote the shared recipe. One estimate
// pass stripped the count rule from the live catalog and every later
// resolution in the same process (authoring resolve = dry run + real pass +
// the estimate the furniture projection runs) bought jaladera-only.
// The expansion must leave the catalog byte-identical; every resolution
// re-expands from the pristine recipe.
func TestHingeCountRuleExpansionLeavesCatalogUntouched(t *testing.T) {
	mod, catalog := countRuleDoorCatalog(2100, domain.HingeDemandRole)
	choices := map[string]string{
		"INTERIOR":             "mat-1",
		"FRENTES":              "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	dims := &LayoutDims{WidthMm: 600, HeightMm: 2100, DepthMm: 560}

	recipePlacements := func() int {
		t.Helper()
		for i := range catalog.Agregados {
			if catalog.Agregados[i].ID != "agr-pue" {
				continue
			}
			for ci := range catalog.Agregados[i].Components {
				ov := catalog.Agregados[i].Components[ci].Overrides
				if ov == nil {
					continue
				}
				return len(ov.HardwarePlacements)
			}
		}
		t.Fatal("recipe not found in catalog")
		return 0
	}
	recipeHasPattern := func() bool {
		t.Helper()
		for i := range catalog.Agregados {
			if catalog.Agregados[i].ID != "agr-pue" {
				continue
			}
			for ci := range catalog.Agregados[i].Components {
				ov := catalog.Agregados[i].Components[ci].Overrides
				if ov == nil {
					continue
				}
				for _, p := range ov.HardwarePlacements {
					if p.CountRule != nil {
						return true
					}
				}
			}
		}
		return false
	}
	if got := recipePlacements(); got != 2 {
		t.Fatalf("fixture recipe placements = %d, want 2 (patrón + jaladera)", got)
	}

	// The estimate pass the furniture projection runs resolves with nil
	// choices — the drop path. It must NOT touch the shared catalog.
	if _, err := ResolveFurnitureLayout(mod, catalog, dims, nil); err != nil {
		t.Fatalf("estimate resolve: %v", err)
	}
	if !recipeHasPattern() {
		t.Fatal("estimate pass (nil choices) stripped the count rule from the shared catalog recipe (#1710)")
	}

	// A later resolution with choices must still expand the pattern.
	layout, err := ResolveFurnitureLayout(mod, catalog, dims, choices)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	hinges := 0
	for _, hw := range layout.Hardware {
		if hw.HardwareID == "hw-standard" {
			hinges++
		}
	}
	if hinges != 5 {
		t.Fatalf("post-estimate resolve bought %d hinges, want 5 (catalog was corrupted by the estimate pass)", hinges)
	}
	if !recipeHasPattern() {
		t.Fatal("expansion stripped the count rule from the shared catalog recipe")
	}
	if got := recipePlacements(); got != 2 {
		t.Fatalf("catalog recipe placements after expansion = %d, want 2", got)
	}
}
