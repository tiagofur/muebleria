package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #727 — release-specific dimension authority. A published DesignRevision
// item carries the physical truth of the unit: its explicit dimensions are
// authoritative for manufacturing and no commercial measure preset is
// required (or accepted as a dimension source) on the release path. The
// commercial path keeps requiring the exact preset (H09 / #104).

// presetReleaseUnitFixture builds a structured module WITH commercial presets
// whose sizes deliberately differ from the item's explicit dimensions, so any
// leak of preset dimensions into the release BOM is observable.
func presetReleaseUnitFixture(t *testing.T) (domain.DesignRevisionItem, domain.Catalog) {
	t.Helper()
	item, catalog := releaseUnitFixture(t)
	catalog.Modules[0].Presets = []domain.DimensionPreset{
		{ID: "std", Name: "Standard", WidthMm: 600, HeightMm: 750, DepthMm: 500},
		{ID: "xl", Name: "XL", WidthMm: 900, HeightMm: 900, DepthMm: 600},
	}
	// Explicit dimensions different from every preset (std 600×750×500,
	// xl 900×900×600): 640×770×510 appears in no preset.
	item.Parameters = map[string]any{
		"widthMm": float64(640), "heightMm": float64(770), "depthMm": float64(510),
		"shelves": float64(2),
	}
	return item, catalog
}

// Main regression: a preset-bearing module releases through the explicit
// dimensions of the DesignRevisionItem. The resolved BOM must use exactly
// those dimensions — never a preset's.
func TestResolveReleaseUnitPresetModuleUsesExplicitDimensions(t *testing.T) {
	item, catalog := presetReleaseUnitFixture(t)
	unit, err := ResolveReleaseUnit(item, catalog)
	if err != nil {
		t.Fatalf("release must resolve preset-bearing modules from explicit dimensions: %v", err)
	}
	if len(unit.BOM.BoardParts) == 0 {
		t.Fatal("release must produce manufacturing demand")
	}
	// The fixture's panel formula derives part size from height×depth: the
	// item's 770×510 must appear, proving no preset dimension leaked.
	for _, part := range unit.BOM.BoardParts {
		if part.LengthMm != 770 || part.WidthMm != 510 {
			t.Fatalf("BOM part %s must use the item's explicit dimensions (770×510), got %d×%d",
				part.ID, part.LengthMm, part.WidthMm)
		}
	}
	if unit.FurnitureInstanceID != item.FurnitureInstanceID || unit.FurnitureDefinitionID != item.FurnitureDefinitionID {
		t.Fatal("physical and definition identities must be preserved")
	}
}

// The same authority must hold at collection level (the exact path
// CreateProductionRelease exercises).
func TestResolveReleaseCollectionPresetModuleUsesExplicitDimensions(t *testing.T) {
	item, catalog := presetReleaseUnitFixture(t)
	item.DesignRevisionID = "revision-727"
	second := item
	second.FurnitureInstanceID = "unit-2"
	result, err := ResolveReleaseCollection("revision-727", []domain.DesignRevisionItem{item, second}, catalog)
	if err != nil {
		t.Fatalf("collection must resolve preset-bearing modules from explicit dimensions: %v", err)
	}
	if len(result.Units) != 2 {
		t.Fatalf("expected two resolved units, got %d", len(result.Units))
	}
	for _, unit := range result.Units {
		for _, part := range unit.BOM.BoardParts {
			if part.LengthMm != 770 || part.WidthMm != 510 {
				t.Fatalf("unit %s: BOM must use explicit dimensions 770×510, got %d×%d",
					unit.FurnitureInstanceID, part.LengthMm, part.WidthMm)
			}
		}
	}
}

// Commercial guard: preset authority is NOT relaxed. Modules with presets
// still require the exact measurePresetID on every commercial entry point —
// with or without custom dimensions present.
func TestCommercialPresetAuthorityRequiresExactPreset(t *testing.T) {
	item, catalog := presetReleaseUnitFixture(t)
	module := catalog.Modules[0]
	choices := item.MaterialChoices

	if _, err := ResolveBom(module, choices, catalog); err == nil || !strings.Contains(err.Error(), "preset de medida") {
		t.Fatalf("commercial resolve without preset must fail with the preset error, got %v", err)
	}
	dims := &domain.ItemCustomDims{WidthMm: 640, HeightMm: 770, DepthMm: 510}
	if _, err := ResolveBomWithContext(module, choices, catalog, nil, "", nil, dims); err == nil || !strings.Contains(err.Error(), "preset de medida") {
		t.Fatalf("custom dims must not bypass commercial preset authority, got %v", err)
	}
	if _, err := ResolveBomWithContext(module, choices, catalog, nil, "not-a-preset", nil, nil); err == nil || !strings.Contains(err.Error(), "preset de medida") {
		t.Fatalf("an unknown preset must still fail loudly on the commercial path, got %v", err)
	}
	if _, err := ResolveBomWithContext(module, choices, catalog, nil, "std", nil, nil); err != nil {
		t.Fatalf("the exact preset must keep resolving commercially: %v", err)
	}
}

// Release authority does not weaken the explicit-dimension contract for
// structured modules: absent, non-positive or fractional dimensions still
// reject — the fix must not add a silent fallback to preset dimensions.
func TestResolveReleaseUnitPresetModuleRejectsInvalidDimensions(t *testing.T) {
	scenarios := []struct {
		name  string
		edit  func(map[string]any)
		match string
	}{
		{"missing width", func(p map[string]any) { delete(p, "widthMm") }, "widthMm"},
		{"missing height", func(p map[string]any) { delete(p, "heightMm") }, "heightMm"},
		{"missing depth", func(p map[string]any) { delete(p, "depthMm") }, "depthMm"},
		{"zero height", func(p map[string]any) { p["heightMm"] = float64(0) }, "heightMm"},
		{"negative depth", func(p map[string]any) { p["depthMm"] = float64(-510) }, "depthMm"},
		{"fractional width", func(p map[string]any) { p["widthMm"] = 640.5 }, "widthMm"},
	}
	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			item, catalog := presetReleaseUnitFixture(t)
			scenario.edit(item.Parameters)
			if result, err := ResolveReleaseUnit(item, catalog); err == nil || result != nil ||
				!strings.Contains(err.Error(), scenario.match) {
				t.Fatalf("expected fail-closed rejection naming %s, got %+v, %v", scenario.match, result, err)
			}
		})
	}
}

// Custom dimensions remain forbidden on non-parametric modules even when the
// module carries presets (presets are a commercial concept; a fixed module
// has fixed parts).
func TestResolveReleaseUnitPresetFixedModuleRejectsDimensionOverrides(t *testing.T) {
	item, catalog := presetReleaseUnitFixture(t)
	module := &catalog.Modules[0]
	module.StructureID, module.ParameterDefinitions, module.Components = "", nil, nil
	module.BoardParts = []domain.BoardPart{{ID: "fixed-part", Description: "Fixed panel", Quantity: 1,
		LengthMm: 600, WidthMm: 400, OptionRole: "INTERIOR"}}
	module.HardwareLines = nil
	delete(item.Parameters, "shelves")
	if result, err := ResolveReleaseUnit(item, catalog); err == nil || result != nil ||
		!strings.Contains(err.Error(), "dimension overrides") {
		t.Fatalf("fixed module must reject dimension overrides, got %+v, %v", result, err)
	}
}
