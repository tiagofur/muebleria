package engine

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func releaseExpansionFixture(t *testing.T, source string, quantity int) (domain.DesignRevisionItem, domain.Catalog) {
	t.Helper()
	item, catalog := releaseUnitFixture(t)
	module := &catalog.Modules[0]
	component := domain.ComponentInstance{ComponentID: catalog.Components[0].ID, Quantity: quantity}
	if source == "explicit" {
		item.Parameters["shelves"] = float64(quantity)
		return item, catalog
	}
	if source == "default" {
		module.ParameterDefinitions[0].DefaultValue = float64(quantity)
		delete(item.Parameters, "shelves")
		return item, catalog
	}
	module.ParameterDefinitions, module.Components = nil, nil
	delete(item.Parameters, "shelves")
	switch source {
	case "static":
		module.Components = []domain.ComponentInstance{component}
	case "structure":
		catalog.Structures[0].Components = []domain.ComponentInstance{component}
	case "combined":
		component.Quantity = quantity / 2
		module.Components = []domain.ComponentInstance{component}
		component.Quantity = quantity - component.Quantity
		catalog.Structures[0].Components = []domain.ComponentInstance{component}
	case "fixed":
		module.StructureID, item.Parameters = "", nil
		module.BoardParts = []domain.BoardPart{{ID: "fixed", Description: "Fixed board", Quantity: quantity,
			LengthMm: 600, WidthMm: 400, OptionRole: "INTERIOR",
			Edges: []domain.EdgeAssignment{{Side: "L1"}, {Side: "L2"}, {Side: "W1"}, {Side: "W2"}}}}
	case "agregado component", "agregado repeat", "structure agregado", "empty agregado", "hardware agregado":
		agregado := domain.Agregado{ID: "assembly", Components: []domain.ComponentInstance{component}}
		instance := domain.ModuleAgregadoInstance{AgregadoID: agregado.ID, Quantity: 1}
		if source != "agregado component" {
			agregado.Components[0].Quantity, instance.Quantity = 1, quantity
		}
		if source == "empty agregado" || source == "hardware agregado" {
			agregado.Components, item.MaterialChoices = nil, nil
		}
		if source == "hardware agregado" {
			agregado.HardwareLines = []domain.HardwareLine{{ID: "hardware-line", HardwareID: "hardware", Quantity: 0.5}}
			catalog.Hardware = []domain.Hardware{{ID: "hardware", Active: true}}
		}
		catalog.Agregados = []domain.Agregado{agregado}
		if source == "structure agregado" {
			catalog.Structures[0].Agregados = []domain.ModuleAgregadoInstance{instance}
		} else {
			module.Agregados = []domain.ModuleAgregadoInstance{instance}
		}
	default:
		t.Fatalf("unknown expansion source %q", source)
	}
	return item, catalog
}

func TestResolveReleaseUnitExpansionLimits(t *testing.T) {
	for _, source := range []string{"explicit", "default", "static", "structure", "combined", "fixed",
		"agregado component", "agregado repeat", "structure agregado", "empty agregado", "hardware agregado"} {
		t.Run(source, func(t *testing.T) {
			for _, scenario := range []struct {
				name     string
				quantity int
			}{
				{"ordinary", 2}, {"boundary", releaseUnitExpansionLimit},
				{"one over", releaseUnitExpansionLimit + 1}, {"huge", 9007199254740991},
			} {
				t.Run(scenario.name, func(t *testing.T) {
					item, catalog := releaseExpansionFixture(t, source, scenario.quantity)
					before, _ := json.Marshal([]any{item, catalog})
					result, err := ResolveReleaseUnit(item, catalog)
					after, _ := json.Marshal([]any{item, catalog})
					if string(before) != string(after) {
						t.Fatal("expansion validation mutated its inputs")
					}
					if scenario.quantity > releaseUnitExpansionLimit {
						if result != nil || err == nil || !strings.Contains(err.Error(), "release unit expansion:") {
							t.Fatalf("expected pre-expansion rejection, got %v, %v", result, err)
						}
						return // Never call the unguarded engine with an excessive quantity.
					}
					if err != nil {
						t.Fatal(err)
					}
					prepared := ApplyEvaluatedComponentBindings(catalog.Modules[0], result.EvaluatedParameters)
					var dims *domain.ItemCustomDims
					if prepared.StructureID != "" {
						dims = &domain.ItemCustomDims{WidthMm: 600, HeightMm: 750, DepthMm: 500}
					}
					want, err := ResolveBomWithContext(prepared, item.MaterialChoices, catalog, nil, "", nil, dims)
					if err != nil || !reflect.DeepEqual(result.BOM, want) {
						t.Fatalf("guard changed existing BOM semantics: %v", err)
					}
				})
			}
		})
	}
}

func TestResolveReleaseUnitExpansionDependencyClosure(t *testing.T) {
	for _, source := range []string{"static", "structure", "agregado component", "structure agregado"} {
		t.Run(source, func(t *testing.T) {
			item, catalog := releaseExpansionFixture(t, source, 2)
			catalog.Components = nil
			if result, err := ResolveReleaseUnit(item, catalog); result != nil || err == nil || !strings.Contains(err.Error(), "component not found") {
				t.Fatalf("missing referenced component accepted: %v", err)
			}
		})
	}
	for _, source := range []string{"static", "agregado repeat", "structure agregado"} {
		t.Run("missing dependency "+source, func(t *testing.T) {
			item, catalog := releaseExpansionFixture(t, source, 2)
			catalog.Agregados = nil
			if source == "static" {
				catalog.Structures = nil
			}
			if result, err := ResolveReleaseUnit(item, catalog); result != nil || err == nil {
				t.Fatal("missing referenced dependency accepted")
			}
		})
	}
	item, catalog := releaseExpansionFixture(t, "static", 2)
	catalog.Modules = append(catalog.Modules, domain.Module{ID: "unrelated", Components: []domain.ComponentInstance{{Quantity: int(^uint(0) >> 1)}}})
	catalog.Structures = append(catalog.Structures, domain.Structure{ID: "unrelated", Components: []domain.ComponentInstance{{ComponentID: "absent"}}})
	catalog.Agregados = append(catalog.Agregados, domain.Agregado{ID: "unrelated", Components: []domain.ComponentInstance{{ComponentID: "absent"}}})
	if _, err := ResolveReleaseUnit(item, catalog); err != nil {
		t.Fatalf("unrelated catalog records must not block resolution: %v", err)
	}
}

func TestReleaseExpansionCheckedArithmeticAndDefaults(t *testing.T) {
	for _, quantity := range []int{5000, 5001, int(^uint(0) >> 1)} {
		item, catalog := releaseExpansionFixture(t, "agregado component", quantity)
		catalog.Modules[0].Agregados[0].Quantity = 2
		result, err := ResolveReleaseUnit(item, catalog)
		if quantity == 5000 {
			if err != nil || len(result.BOM.BoardParts) != releaseUnitExpansionLimit {
				t.Fatalf("aggregate product at boundary failed: %v", err)
			}
		} else if err == nil || result != nil {
			t.Fatal("aggregate product exceeded budget")
		}
	}
	for _, scenario := range []struct {
		name                    string
		used, count, multiplier int
	}{
		{"addition overflow", 1, int(^uint(0) >> 1), 1},
		{"multiplication overflow", 0, 2, int(^uint(0) >> 1)},
		{"combined over budget", 1, 5000, 2},
		{"empty enormous loop", 0, 0, int(^uint(0) >> 1)},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			used := releaseExpansionBudget(scenario.used)
			if err := used.add(scenario.count, scenario.multiplier); err == nil || int(used) != scenario.used {
				t.Fatal("unchecked arithmetic or partial budget mutation")
			}
		})
	}
	for _, quantity := range []int{0, -1} {
		item, catalog := releaseExpansionFixture(t, "agregado repeat", quantity)
		result, err := ResolveReleaseUnit(item, catalog)
		if err != nil || len(result.BOM.BoardParts) != 1 {
			t.Fatalf("existing non-positive agregado default changed: %v", err)
		}
	}
}

func TestResolveReleaseUnitExpansionRowsAndSuppression(t *testing.T) {
	for _, source := range []string{"fixed rows", "hardware rows", "base reserve"} {
		t.Run(source, func(t *testing.T) {
			for _, extra := range []int{0, 1} {
				item, catalog := releaseExpansionFixture(t, "fixed", 1)
				module := &catalog.Modules[0]
				count := releaseUnitExpansionLimit + extra
				switch source {
				case "fixed rows":
					part := module.BoardParts[0]
					module.BoardParts = make([]domain.BoardPart, count)
					for n := range module.BoardParts {
						module.BoardParts[n] = part
					}
				case "hardware rows":
					module.BoardParts, item.MaterialChoices = nil, nil
					catalog.Hardware = []domain.Hardware{{ID: "hardware", Active: true}}
					module.HardwareLines = make([]domain.HardwareLine, count)
					for n := range module.HardwareLines {
						module.HardwareLines[n] = domain.HardwareLine{ID: "line", HardwareID: "hardware", Quantity: 0.5}
					}
				case "base reserve":
					item, catalog = releaseExpansionFixture(t, "static", count-6)
					catalog.Modules[0].BaseMode = baseModeLegs
				}
				result, err := ResolveReleaseUnit(item, catalog)
				if (extra == 0 && err != nil) || (extra == 1 && (err == nil || result != nil)) {
					t.Fatalf("unexpected row budget result for extra=%d: %v", extra, err)
				}
			}
		})
	}
	item, catalog := releaseUnitFixture(t)
	catalog.Modules[0].Components[0].Quantity = int(^uint(0) >> 1)
	item.Parameters["shelves"] = float64(0)
	item.MaterialChoices = nil
	if result, err := ResolveReleaseUnit(item, catalog); err != nil || len(result.BOM.BoardParts) != 0 {
		t.Fatalf("guard must use effective bindings, not suppressed static quantity: %v", err)
	}
}

func TestReleaseExpansionBaseSynthesisReserve(t *testing.T) {
	for _, scenario := range []struct {
		mode             string
		boards, hardware int
	}{{baseModePlinthBoard, 4, 1}, {baseModePlinthStrip, 0, 2}, {baseModeLegs, 0, 1}} {
		t.Run(scenario.mode, func(t *testing.T) {
			parts, hardware := applyBaseTreatment("module", nil, nil, scenario.mode, 100, 700, 500,
				&PlinthSides{Left: true, Right: true, Back: true}, map[string]string{patasRole: "legs"})
			if len(parts) != scenario.boards || len(hardware) != scenario.hardware || len(parts)+len(hardware) > 6 {
				t.Fatal("base synthesis exceeded the conservative reservation")
			}
			for _, part := range parts {
				if part.Quantity != 1 {
					t.Fatal("synthetic board row no longer represents one physical part")
				}
			}
		})
	}
}
