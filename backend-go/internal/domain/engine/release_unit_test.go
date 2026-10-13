package engine

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func releaseUnitFixture(t *testing.T) (domain.DesignRevisionItem, domain.Catalog) {
	t.Helper()
	catalog := loadPlinthFixture(t).toDomainCatalog()
	for i := range catalog.Structures {
		catalog.Structures[i].Components = nil
	}
	module := catalog.Modules[0]
	module.BaseMode, module.HardwareLines = "none", nil
	module.Components = []domain.ComponentInstance{{ComponentID: catalog.Components[0].ID, Quantity: 1}}
	module.ParameterDefinitions = []domain.FurnitureParameterDefinition{{
		Name: "shelves", Label: "Shelves", Type: domain.FurnitureParameterTypeNumber,
		Category: domain.FurnitureParameterCategoryConfiguration, Integer: true, Required: true,
		Binding: &domain.FurnitureParameterBinding{Version: 1, Kind: domain.FurnitureParameterBindingComponentQuantity, ComponentID: catalog.Components[0].ID},
	}}
	catalog.Modules = []domain.Module{module}
	return domain.DesignRevisionItem{FurnitureInstanceID: "unit-1", FurnitureDefinitionID: module.ID,
		Parameters:      map[string]any{"widthMm": float64(600), "heightMm": float64(750), "depthMm": float64(500), "shelves": float64(2)},
		MaterialChoices: map[string]string{"INTERIOR": "mat-body"}}, catalog
}

func TestResolveReleaseUnitIdentityAndIsolation(t *testing.T) {
	item, catalog := releaseUnitFixture(t)
	before, _ := json.Marshal([]any{item, catalog})
	first, err := ResolveReleaseUnit(item, catalog)
	if err != nil {
		t.Fatal(err)
	}
	secondItem := item
	secondItem.FurnitureInstanceID = "unit-2"
	secondItem.Parameters = map[string]any{"widthMm": float64(700), "heightMm": float64(800), "depthMm": float64(520), "shelves": float64(5)}
	second, err := ResolveReleaseUnit(secondItem, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if first.FurnitureInstanceID != "unit-1" || second.FurnitureInstanceID != "unit-2" || first.FurnitureDefinitionID != second.FurnitureDefinitionID {
		t.Fatal("physical and shared definition identities must be preserved")
	}
	if len(first.BOM.BoardParts) != 2 || len(second.BOM.BoardParts) != 5 {
		t.Fatal("each physical unit must resolve its own quantities")
	}
	if first.BOM.BoardParts[0].LengthMm != 750 || second.BOM.BoardParts[0].LengthMm != 800 || second.BOM.BoardParts[0].WidthMm != 520 {
		t.Fatal("each physical unit must resolve its explicit dimensions")
	}
	first.EvaluatedParameters["shelves"] = float64(99)
	after, _ := json.Marshal([]any{item, catalog})
	if string(before) != string(after) {
		t.Fatal("resolution mutated catalog or revision input")
	}
}

func TestResolveReleaseUnitRejectsParameters(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		parameter string
		value     any
	}{
		{"string width", "widthMm", "600"},
		{"zero width", "widthMm", float64(0)},
		{"fractional height", "heightMm", 750.5},
		{"infinite width", "widthMm", math.Inf(1)},
		{"unsafe width", "widthMm", float64(9007199254740992)},
		{"string quantity", "shelves", "2"},
		{"unsafe quantity", "shelves", float64(9007199254740992)},
		{"negative quantity", "shelves", float64(-1)},
		{"unknown parameter", "extra", true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			item, catalog := releaseUnitFixture(t)
			item.Parameters[scenario.parameter] = scenario.value
			if result, err := ResolveReleaseUnit(item, catalog); err == nil || result != nil {
				t.Fatalf("expected fail-closed result, got %+v, %v", result, err)
			}
		})
	}
}

func TestResolveReleaseUnitRejectsUnsupportedInput(t *testing.T) {
	cases := []struct {
		name string
		edit func(*domain.DesignRevisionItem, *domain.Catalog)
	}{
		{"missing identity", func(i *domain.DesignRevisionItem, c *domain.Catalog) { i.FurnitureInstanceID = "" }},
		{"missing definition", func(i *domain.DesignRevisionItem, c *domain.Catalog) { i.FurnitureDefinitionID = "absent" }},
		{"ambiguous definition", func(i *domain.DesignRevisionItem, c *domain.Catalog) { c.Modules = append(c.Modules, c.Modules[0]) }},
		{"unsupported version", func(i *domain.DesignRevisionItem, c *domain.Catalog) {
			version := 1
			i.DefinitionVersion = &version
		}},
		{"missing depth", func(i *domain.DesignRevisionItem, c *domain.Catalog) { delete(i.Parameters, "depthMm") }},
		{"missing consumer", func(i *domain.DesignRevisionItem, c *domain.Catalog) {
			c.Modules[0].ParameterDefinitions[0].Binding = nil
		}},
		{"unknown consumer", func(i *domain.DesignRevisionItem, c *domain.Catalog) {
			c.Modules[0].ParameterDefinitions[0].Binding.ComponentID = "missing"
		}},
		{"ambiguous consumer", func(i *domain.DesignRevisionItem, c *domain.Catalog) {
			c.Modules[0].Components = append(c.Modules[0].Components, c.Modules[0].Components[0])
		}},
		{"relationship consumer", func(i *domain.DesignRevisionItem, c *domain.Catalog) {
			c.Modules[0].ParameterDefinitions[0].Binding.Relationship = &domain.FurnitureParameterRelationshipBinding{Kind: "shelf", SourceRole: "shelf", Targets: []domain.FurnitureParameterRelationshipTarget{{ComponentID: c.Modules[0].Components[0].ComponentID, Role: "support"}}}
		}},
		{"unknown material", func(i *domain.DesignRevisionItem, c *domain.Catalog) { i.MaterialChoices["INTERIOR"] = "absent" }},
		{"inactive material", func(i *domain.DesignRevisionItem, c *domain.Catalog) {
			for n := range c.Materials {
				if c.Materials[n].ID == "mat-body" {
					c.Materials[n].Active = false
				}
			}
		}},
		{"unconsumed material", func(i *domain.DesignRevisionItem, c *domain.Catalog) { i.MaterialChoices["EXTRA"] = "mat-body" }},
		{"unconsumed edge", func(i *domain.DesignRevisionItem, c *domain.Catalog) { i.MaterialChoices["EDGE"] = "absent" }},
	}
	for _, scenario := range cases {
		t.Run(scenario.name, func(t *testing.T) {
			item, catalog := releaseUnitFixture(t)
			scenario.edit(&item, &catalog)
			if result, err := ResolveReleaseUnit(item, catalog); err == nil || result != nil {
				t.Fatalf("expected fail-closed result, got %+v, %v", result, err)
			}
		})
	}
}

func TestResolveReleaseUnitFixedChoices(t *testing.T) {
	item, catalog := releaseUnitFixture(t)
	module := &catalog.Modules[0]
	module.StructureID, module.ParameterDefinitions, module.Components = "", nil, nil
	module.BoardParts = []domain.BoardPart{{ID: "fixed-part", Description: "Fixed panel", Quantity: 1, LengthMm: 600, WidthMm: 400, OptionRole: "INTERIOR", Edges: []domain.EdgeAssignment{{Side: "L1", Enabled: true}, {Side: "L2"}, {Side: "W1"}, {Side: "W2"}}}}
	module.HardwareLines = []domain.HardwareLine{{ID: "hinge-line", OptionRole: "HINGE", Quantity: 2}}
	catalog.Edges = []domain.EdgeBand{{ID: "edge", Active: true}}
	catalog.Hardware = []domain.Hardware{{ID: "hinge", Active: true}}
	item.Parameters = nil
	item.MaterialChoices["EDGE"], item.MaterialChoices["HINGE"] = "edge", "hinge"
	result, err := ResolveReleaseUnit(item, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if result.BOM.BoardParts[0].EdgeBandID != "edge" || result.BOM.HardwareLines[0].HardwareID != "hinge" {
		t.Fatal("explicit edge and hardware choices were not consumed")
	}
	for _, name := range []string{"widthMm", "heightMm", "depthMm"} {
		item.Parameters = map[string]any{name: float64(600)}
		if result, err := ResolveReleaseUnit(item, catalog); err == nil || result != nil {
			t.Fatal("fixed dimensions must not be silently ignored")
		}
	}
	item.Parameters = nil
	catalog.Hardware[0].Active = false
	if result, err := ResolveReleaseUnit(item, catalog); err == nil || result != nil {
		t.Fatal("inactive hardware accepted")
	}
}

func TestResolveReleaseUnitDefaultsConditionAndMetadata(t *testing.T) {
	item, catalog := releaseUnitFixture(t)
	definition := &catalog.Modules[0].ParameterDefinitions[0]
	definition.DefaultValue = float64(3)
	delete(item.Parameters, "shelves")
	maxLength := 32
	catalog.Modules[0].ParameterDefinitions = append(catalog.Modules[0].ParameterDefinitions,
		domain.FurnitureParameterDefinition{Name: "note", Label: "Note", Type: domain.FurnitureParameterTypeString,
			Category: domain.FurnitureParameterCategoryMetadata, DefaultValue: "retained", MaxLength: &maxLength})
	result, err := ResolveReleaseUnit(item, catalog)
	if err != nil || len(result.BOM.BoardParts) != 3 || result.EvaluatedParameters["note"] != "retained" {
		t.Fatalf("declared defaults must be evaluated and retained: %+v, %v", result, err)
	}
	definition = &catalog.Modules[0].ParameterDefinitions[0]
	definition.Type, definition.Integer, definition.DefaultValue = domain.FurnitureParameterTypeBoolean, false, true
	definition.Binding.Kind = domain.FurnitureParameterBindingComponentCondition
	result, err = ResolveReleaseUnit(item, catalog)
	if err != nil || len(result.BOM.BoardParts) != 1 {
		t.Fatalf("true condition must retain template: %+v, %v", result, err)
	}
	item.Parameters["shelves"] = false
	item.MaterialChoices = nil
	result, err = ResolveReleaseUnit(item, catalog)
	if err != nil || len(result.BOM.BoardParts) != 0 {
		t.Fatalf("false condition must omit template: %+v, %v", result, err)
	}
	item.Parameters["shelves"] = "false"
	if result, err := ResolveReleaseUnit(item, catalog); err == nil || result != nil {
		t.Fatal("boolean string accepted")
	}
	duplicate := *definition
	duplicate.Name = "otherCondition"
	catalog.Modules[0].ParameterDefinitions = append(catalog.Modules[0].ParameterDefinitions, duplicate)
	delete(item.Parameters, "shelves")
	if result, err := ResolveReleaseUnit(item, catalog); err == nil || result != nil {
		t.Fatal("competing consumers accepted")
	}
}

// #1309: relationship bindings the release derive can govern resolve; kinds
// outside the governed ladder keep failing closed. back-panel joined the
// governed set with #874 (2aa9cb9a) — the whitelist predating that commit
// rejected every module carrying the binding.
func TestResolveReleaseUnitGovernedRelationshipBindings(t *testing.T) {
	for _, tc := range []struct {
		name  string
		kind  string
		valid bool
	}{
		{"floor-side governed", "floor-side", true},
		{"fixed-shelf-side governed", "fixed-shelf-side", true},
		{"back-panel governed since #874", "back-panel", true},
		{"unknown kind rejected", "shelf", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			item, catalog := releaseUnitFixture(t)
			// A second distinct participant mirrors the real back-panel
			// binding (owner module MOD-BAJ-1P-IZQ, tornillosRespaldo): the
			// #874 joinery validates faces per distinct component.
			second := domain.Component{
				ID: "comp-bp-second", Code: "BP-2", Name: "Second participant",
				Placement:    domain.PlacementBase,
				GeometryKind: "rectangular_board", ThicknessMm: 18,
				OptionRoles: []string{"INTERIOR"}, Active: true,
			}
			catalog.Components = append(catalog.Components, second)
			catalog.Modules[0].Components = append(catalog.Modules[0].Components, domain.ComponentInstance{ComponentID: second.ID, Quantity: 1})
			catalog.Modules[0].ParameterDefinitions[0].Binding = &domain.FurnitureParameterBinding{
				Version:     1,
				Kind:        "structureRelationship",
				ComponentID: catalog.Modules[0].Components[0].ComponentID,
				Relationship: &domain.FurnitureParameterRelationshipBinding{
					Kind:       tc.kind,
					SourceRole: "support",
					Targets: []domain.FurnitureParameterRelationshipTarget{
						{ComponentID: catalog.Modules[0].Components[0].ComponentID, Role: "side", Face: "front"},
						{ComponentID: second.ID, Role: "bottom-run", Face: "front"},
					},
				},
			}
			result, err := ResolveReleaseUnit(item, catalog)
			if tc.valid && (err != nil || result == nil) {
				t.Fatalf("binding %q must resolve a release unit, got err %v", tc.kind, err)
			}
			if !tc.valid && (err == nil || result != nil) {
				t.Fatalf("binding %q must fail closed", tc.kind)
			}
		})
	}
}
