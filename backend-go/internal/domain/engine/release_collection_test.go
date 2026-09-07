package engine

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func releaseCollectionFixture(t *testing.T) ([]domain.DesignRevisionItem, domain.Catalog) {
	t.Helper()
	first, catalog := releaseUnitFixture(t)
	first.DesignRevisionID = "revision-2"
	second := first
	second.FurnitureInstanceID = "unit-2"
	second.Parameters = map[string]any{"widthMm": 700.0, "heightMm": 800.0, "depthMm": 520.0, "shelves": 5.0}
	catalog.Components[0].DefaultEdges = nil
	catalog.Modules[0].HardwareLines = []domain.HardwareLine{{ID: "rail", HardwareID: "hw-perfil", Quantity: 0.5}}
	*catalog.Hardware[0].PackageSize = 2
	for i := range catalog.Materials {
		catalog.Materials[i].WidthMm, catalog.Materials[i].LengthMm = 1000, 3000
		catalog.Materials[i].WastePercent = 0
	}
	return []domain.DesignRevisionItem{first, second}, catalog
}

func TestResolveReleaseCollectionIdentityAndDemand(t *testing.T) {
	items, catalog := releaseCollectionFixture(t)
	before, _ := json.Marshal([]any{items, catalog})
	result, err := ResolveReleaseCollection("revision-2", items, catalog)
	if err != nil {
		t.Fatal(err)
	}
	want := []domain.MaterialRequirementLine{
		{Kind: "herrajes", MaterialID: "hw-perfil", Quantity: 2},
		{Kind: "tableros", MaterialID: "mat-body", Quantity: 1},
	}
	if len(result.Units) != 2 || !reflect.DeepEqual(result.Requirements, want) {
		t.Fatalf("expected two units and collection-rounded demand %v, got %+v", want, result)
	}
	for i, unit := range result.Units {
		if unit.FurnitureInstanceID != items[i].FurnitureInstanceID || unit.FurnitureDefinitionID != items[i].FurnitureDefinitionID {
			t.Fatal("physical order and shared definition identity must survive assembly")
		}
		if len(unit.BOM.BoardParts) != []int{2, 5}[i] || unit.BOM.BoardParts[0].LengthMm != []int{750, 800}[i] || unit.BOM.BoardParts[0].WidthMm != []int{500, 520}[i] {
			t.Fatalf("unit %d lost its independent dimensions or typed quantity: %+v", i, unit)
		}
	}
	result.Units[0].EvaluatedParameters["shelves"] = 99.0
	after, _ := json.Marshal([]any{items, catalog})
	if string(before) != string(after) {
		t.Fatal("assembly or modifying evaluated output mutated source inputs")
	}
	reversed, err := ResolveReleaseCollection("revision-2", []domain.DesignRevisionItem{items[1], items[0]}, catalog)
	if err != nil || reversed.Units[0].FurnitureInstanceID != "unit-2" || !reflect.DeepEqual(reversed.Requirements, want) {
		t.Fatalf("reordering must preserve physical order and aggregate demand: %+v, %v", reversed, err)
	}
}

func TestResolveReleaseCollectionRejectsWithoutPartialOutput(t *testing.T) {
	for _, scenario := range []struct {
		name string
		edit func(*string, *[]domain.DesignRevisionItem, *domain.Catalog)
	}{
		{"empty revision", func(r *string, _ *[]domain.DesignRevisionItem, _ *domain.Catalog) { *r = "" }},
		{"blank revision", func(r *string, _ *[]domain.DesignRevisionItem, _ *domain.Catalog) { *r = " " }},
		{"empty collection", func(_ *string, i *[]domain.DesignRevisionItem, _ *domain.Catalog) { *i = nil }},
		{"too many units", func(_ *string, i *[]domain.DesignRevisionItem, _ *domain.Catalog) {
			*i = make([]domain.DesignRevisionItem, releaseUnitExpansionLimit+1)
		}},
		{"duplicate physical identity", func(_ *string, i *[]domain.DesignRevisionItem, _ *domain.Catalog) {
			(*i)[1].FurnitureInstanceID = (*i)[0].FurnitureInstanceID
		}},
		{"empty physical identity", func(_ *string, i *[]domain.DesignRevisionItem, _ *domain.Catalog) { (*i)[1].FurnitureInstanceID = "" }},
		{"blank physical identity", func(_ *string, i *[]domain.DesignRevisionItem, _ *domain.Catalog) { (*i)[1].FurnitureInstanceID = " " }},
		{"later revision", func(_ *string, i *[]domain.DesignRevisionItem, _ *domain.Catalog) {
			(*i)[1].DesignRevisionID = "revision-3"
		}},
		{"missing item revision", func(_ *string, i *[]domain.DesignRevisionItem, _ *domain.Catalog) { (*i)[1].DesignRevisionID = "" }},
		{"invalid late unit", func(_ *string, i *[]domain.DesignRevisionItem, _ *domain.Catalog) {
			(*i)[1].Parameters["shelves"] = -1.0
		}},
		{"invalid aggregate inputs", func(_ *string, _ *[]domain.DesignRevisionItem, c *domain.Catalog) {
			for i := range c.Materials {
				c.Materials[i].WidthMm = 0
			}
		}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			items, catalog := releaseCollectionFixture(t)
			revision := "revision-2"
			scenario.edit(&revision, &items, &catalog)
			before, _ := json.Marshal([]any{items, catalog})
			result, err := ResolveReleaseCollection(revision, items, catalog)
			if err == nil || result != nil {
				t.Fatalf("expected failure with no partial collection, got %+v, %v", result, err)
			}
			after, _ := json.Marshal([]any{items, catalog})
			if string(before) != string(after) {
				t.Fatal("failed assembly mutated its inputs")
			}
		})
	}
}

func TestResolveReleaseCollectionBudget(t *testing.T) {
	for _, source := range []string{"explicit", "fixed", "agregado repeat"} {
		for _, over := range []bool{false, true} {
			name := source + "/boundary"
			if over {
				name = source + "/over"
			}
			t.Run(name, func(t *testing.T) {
				quantity := releaseUnitExpansionLimit / 2
				item, catalog := releaseExpansionFixture(t, source, quantity)
				catalog.Components[0].DefaultEdges = nil
				item.DesignRevisionID = "revision-2"
				second := item
				second.FurnitureInstanceID = "unit-2"
				items := []domain.DesignRevisionItem{item, second}
				if over {
					// A third valid one-work-unit definition crosses the exact boundary.
					catalog.Modules = append(catalog.Modules, domain.Module{ID: "extra", Code: "EXTRA", Name: "Extra hardware unit",
						HardwareLines: []domain.HardwareLine{{ID: "rail", HardwareID: "extra-hardware", Quantity: 0.5}},
					})
					catalog.Hardware = append(catalog.Hardware, domain.Hardware{ID: "extra-hardware", Active: true})
					items = append(items, domain.DesignRevisionItem{DesignRevisionID: "revision-2", FurnitureInstanceID: "unit-3", FurnitureDefinitionID: "extra"})
				}
				for _, unit := range items {
					if _, err := ResolveReleaseUnit(unit, catalog); err != nil {
						t.Fatalf("every unit must be individually valid: %v", err)
					}
				}
				before, _ := json.Marshal([]any{items, catalog})
				result, err := ResolveReleaseCollection("revision-2", items, catalog)
				if over {
					if result != nil || err == nil || !strings.Contains(err.Error(), "exceeds 10000 work units") {
						t.Fatalf("expected collection budget rejection, got %+v, %v", result, err)
					}
				} else if err != nil || len(result.Units) != 2 {
					t.Fatalf("exact collection boundary must succeed: %+v, %v", result, err)
				}
				after, _ := json.Marshal([]any{items, catalog})
				if string(before) != string(after) {
					t.Fatal("budget validation mutated its inputs")
				}
			})
		}
	}
}

func TestResolveReleaseCollectionManufacturingPolicy(t *testing.T) {
	for _, hardware := range []bool{false, true} {
		name := "empty"
		if hardware {
			name = "hardware only"
		}
		t.Run(name, func(t *testing.T) {
			items, catalog := releaseCollectionFixture(t)
			module := &catalog.Modules[0]
			module.ParameterDefinitions, module.Components = nil, nil
			for i := range items {
				delete(items[i].Parameters, "shelves")
				items[i].MaterialChoices = nil
			}
			if !hardware {
				module.HardwareLines = nil
			}
			before, _ := json.Marshal([]any{items, catalog})
			result, err := ResolveReleaseCollection("revision-2", items, catalog)
			if hardware {
				want := []domain.MaterialRequirementLine{{Kind: "herrajes", MaterialID: "hw-perfil", Quantity: 2}}
				if err != nil || !reflect.DeepEqual(result.Requirements, want) || len(result.Units[0].BOM.BoardParts) != 0 {
					t.Fatalf("hardware-only collection must retain demand: %+v, %v", result, err)
				}
			} else if result != nil || err == nil || !strings.Contains(err.Error(), "no manufacturing demand") {
				t.Fatalf("empty manufacturing must fail closed: %+v, %v", result, err)
			}
			after, _ := json.Marshal([]any{items, catalog})
			if string(before) != string(after) {
				t.Fatal("manufacturing policy mutated its inputs")
			}
		})
	}
}
