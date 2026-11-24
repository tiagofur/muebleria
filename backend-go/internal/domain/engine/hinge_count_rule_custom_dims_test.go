package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1579 PR2 — the browser spec's PR2 shape: the pattern instance lives on
// STRUCTURE.agregados and the item resolves with customDims. The demand must
// use the CUSTOM BAY height (2100 → door 2097 → band ≤2000 → 4), never the
// module's catalog envelope.
func TestHingeCountRuleCustomDimsDemand(t *testing.T) {
	mod, catalog := countRuleDoorCatalog(720, domain.HingeDemandRole)
	// EXACT browser shape: the recipe declares NO reference box, the module
	// carries its 720 envelope as externalDims, the pattern instance lives on
	// STRUCTURE.agregados (module agregados empty), and the item resolves at
	// customDims 2100 through the QUOTE entry (ResolveBomWithPin).
	mod.Agregados = nil
	agr := &catalog.Agregados[0]
	agr.WidthMm, agr.HeightMm, agr.DepthMm = 0, 0, 0
	st := &catalog.Structures[0]
	st.Agregados = []domain.ModuleAgregadoInstance{{ID: "inst-patron", AgregadoID: "agr-pue", Quantity: 1}}
	st.Components = nil

	choices := map[string]string{
		"INTERIOR":             "mat-1",
		"FRENTES":              "mat-1",
		domain.HingeDemandRole: "hw-standard",
	}
	bom, err := ResolveBomWithContext(mod, choices, catalog, nil, "", nil, &domain.ItemCustomDims{WidthMm: 600, HeightMm: 2100, DepthMm: 560})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	pattern := countRuleLines(bom)
	if len(pattern) != 1 {
		t.Fatalf("expected one pattern line, got %+v", bom.HardwareLines)
	}
	if pattern[0].Quantity != 5 {
		t.Fatalf("customDims 2100 door (2097 after PH-3) must buy 5, got %+v", pattern[0])
	}
	if !strings.Contains(pattern[0].ID, "u0") {
		t.Fatalf("pattern line id = %q", pattern[0].ID)
	}
}
