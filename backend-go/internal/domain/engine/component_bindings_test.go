package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestComponentBindingsSharedContract(t *testing.T) {
	var fixture struct {
		PiecePrefix string                                `json:"piecePrefix"`
		Parameters  []domain.FurnitureParameterDefinition `json:"parameters"`
		Cases       []struct {
			Name       string         `json:"name"`
			Values     map[string]any `json:"values"`
			Quantities []int          `json:"quantities"`
			PieceIDs   []string       `json:"pieceIds"`
			Issue      string         `json:"issue"`
		} `json:"cases"`
	}
	data, err := os.ReadFile("../../../../contracts/componentBindings.contract.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	catalog := loadPlinthFixture(t).toDomainCatalog()
	component := catalog.Components[0]
	back := component
	back.ID, back.Code = "comp-back", "BACK"
	catalog.Components = []domain.Component{component, back}
	for i := range catalog.Structures {
		catalog.Structures[i].Components = nil
	}
	module := catalog.Modules[0]
	module.BaseMode, module.HardwareLines = "none", nil
	module.ParameterDefinitions = fixture.Parameters
	module.Components = []domain.ComponentInstance{{ComponentID: component.ID, Quantity: 1}, {ComponentID: back.ID, Quantity: 1}}
	original, _ := json.Marshal([]any{catalog, module})
	for _, scenario := range fixture.Cases {
		t.Run(scenario.Name, func(t *testing.T) {
			before, _ := json.Marshal(scenario.Values)
			values, issues, err := domain.EvaluateFurnitureParameters(fixture.Parameters, scenario.Values)
			if err != nil {
				t.Fatal(err)
			}
			if scenario.Issue != "" {
				for _, issue := range issues {
					if string(issue.Code) == scenario.Issue {
						return
					}
				}
				t.Fatalf("expected %s, got %v", scenario.Issue, issues)
			}
			if len(issues) != 0 {
				t.Fatal(issues)
			}
			if issues := domain.ValidateModuleFurnitureParameterConsumers(module, catalog); len(issues) != 0 {
				t.Fatal(issues)
			}
			prepared := ApplyEvaluatedComponentBindings(module, values)
			bom, err := ResolveBomWithContext(prepared, map[string]string{"INTERIOR": "mat-body"}, catalog, nil, "", nil,
				&domain.ItemCustomDims{WidthMm: 600, HeightMm: 750, DepthMm: 500})
			if err != nil {
				t.Fatal(err)
			}
			quantities := []int{}
			for _, part := range bom.BoardParts {
				if part.Quantity != 1 {
					t.Fatal("expected physical piece")
				}
				if part.LengthMm != 750 || part.WidthMm != 500 || part.MaterialID != "mat-body" {
					t.Fatalf("unexpected part: %+v", part)
				}
			}
			for _, instance := range prepared.Components {
				quantities = append(quantities, instance.Quantity)
			}
			count := 0
			for _, quantity := range scenario.Quantities {
				count += quantity
			}
			ids := map[string]bool{}
			pieceIDs := []string{}
			for _, part := range bom.BoardParts {
				ids[part.ID] = true
				pieceIDs = append(pieceIDs, part.ID)
			}
			expectedIDs := []string{}
			for _, id := range scenario.PieceIDs {
				expectedIDs = append(expectedIDs, fixture.PiecePrefix+id)
			}
			if !reflect.DeepEqual(pieceIDs, expectedIDs) {
				t.Fatalf("unexpected physical IDs: %v", pieceIDs)
			}
			if len(bom.BoardParts) != count || len(ids) != count {
				t.Fatal("missing or duplicate physical piece")
			}
			if !reflect.DeepEqual(quantities, scenario.Quantities) || prepared.ID != module.ID {
				t.Fatalf("unexpected prepared module/BOM: %+v %v", prepared, quantities)
			}
			after, _ := json.Marshal([]any{catalog, module})
			valuesAfter, _ := json.Marshal(scenario.Values)
			if string(after) != string(original) || string(before) != string(valuesAfter) {
				t.Fatal("input mutated")
			}
			if !reflect.DeepEqual(prepared, ApplyEvaluatedComponentBindings(module, values)) {
				t.Fatal("non-deterministic binding")
			}
		})
	}
}

// TestAgregadoBindingsSharedContract (#1386) runs the shared agregado binding
// fixture: quantity/condition values drive the module's agregado instances the
// same way in Go and TS. The module carries one authored cajon-std
// instance; piece ids carry the agr-<id>-u<idx>- prefix without the mod- one.
func TestAgregadoBindingsSharedContract(t *testing.T) {
	var fixture struct {
		PiecePrefix string                                `json:"piecePrefix"`
		Parameters  []domain.FurnitureParameterDefinition `json:"parameters"`
		Cases       []struct {
			Name       string         `json:"name"`
			Values     map[string]any `json:"values"`
			Quantities []int          `json:"quantities"`
			PieceIDs   []string       `json:"pieceIds"`
			Issue      string         `json:"issue"`
		} `json:"cases"`
	}
	data, err := os.ReadFile("../../../../contracts/agregadoBindings.contract.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	mat := domain.MaterialBoard{
		ID: "mat-1", Code: "MAT", Name: "Melamina", Active: true,
		WidthMm: 1830, LengthMm: 2440, ThicknessMm: 18, CostPerM2: 20,
		DefaultEdgeBandID: "edge-1",
	}
	edge := domain.EdgeBand{ID: "edge-1", Code: "CAN", Name: "Canto", CostPerMl: 1, Active: true}
	hw := domain.Hardware{ID: "hw-1", Code: "CORR", Name: "Correderas", CostPerUnit: 50, Active: true}
	compFrente := domain.Component{
		ID: "comp-frente", Code: "FCAJ", Name: "Frente Cajon", Placement: domain.PlacementFrenteCajon,
		GeometryKind: "rectangular_board", LengthMm: 200, WidthMm: 500, ThicknessMm: 18,
		OptionRoles: []string{"FRENTE"}, Active: true,
	}
	agrCajon := domain.Agregado{
		ID: "cajon-std", Code: "CAJ", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-frente", Quantity: 1}},
	}
	st := domain.Structure{
		ID: "st-1", Code: "EST", Name: "Cuerpo", WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true,
	}
	module := domain.Module{
		ID: "mod-1", Code: "MOD", Name: "Módulo cajones",
		StructureID: "st-1", WidthMm: 600, HeightMm: 720, DepthMm: 560,
		Agregados:            []domain.ModuleAgregadoInstance{{AgregadoID: "cajon-std", Quantity: 1}},
		ParameterDefinitions: fixture.Parameters,
	}
	catalog := domain.Catalog{
		Materials:  []domain.MaterialBoard{mat},
		Edges:      []domain.EdgeBand{edge},
		Hardware:   []domain.Hardware{hw},
		Structures: []domain.Structure{st},
		Components: []domain.Component{compFrente},
		Agregados:  []domain.Agregado{agrCajon},
	}
	choices := map[string]string{"INTERIOR": "mat-1", "FRENTE": "mat-1", "HERRAJE": "hw-1"}
	original, _ := json.Marshal([]any{catalog, module})
	for _, scenario := range fixture.Cases {
		t.Run(scenario.Name, func(t *testing.T) {
			before, _ := json.Marshal(scenario.Values)
			values, issues, err := domain.EvaluateFurnitureParameters(fixture.Parameters, scenario.Values)
			if err != nil {
				t.Fatal(err)
			}
			if scenario.Issue != "" {
				for _, issue := range issues {
					if string(issue.Code) == scenario.Issue {
						return
					}
				}
				t.Fatalf("expected %s, got %v", scenario.Issue, issues)
			}
			if len(issues) != 0 {
				t.Fatal(issues)
			}
			if issues := domain.ValidateModuleFurnitureParameterConsumers(module, catalog); len(issues) != 0 {
				t.Fatal(issues)
			}
			prepared := ApplyEvaluatedAgregadoBindings(module, values)
			bom, err := ResolveBomWithContext(prepared, choices, catalog, nil, "", nil,
				&domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560})
			if err != nil {
				t.Fatal(err)
			}
			for _, part := range bom.BoardParts {
				if part.Quantity != 1 {
					t.Fatal("expected physical piece")
				}
				if part.MaterialID != "mat-1" {
					t.Fatalf("unexpected part: %+v", part)
				}
			}
			quantities := []int{}
			for _, instance := range prepared.Agregados {
				quantities = append(quantities, instance.Quantity)
			}
			count := 0
			for _, quantity := range scenario.Quantities {
				count += quantity
			}
			ids := map[string]bool{}
			pieceIDs := []string{}
			for _, part := range bom.BoardParts {
				ids[part.ID] = true
				pieceIDs = append(pieceIDs, part.ID)
			}
			expectedIDs := []string{}
			for _, id := range scenario.PieceIDs {
				expectedIDs = append(expectedIDs, fixture.PiecePrefix+id)
			}
			if !reflect.DeepEqual(pieceIDs, expectedIDs) {
				t.Fatalf("unexpected physical IDs: %v", pieceIDs)
			}
			if len(bom.BoardParts) != count || len(ids) != count {
				t.Fatal("missing or duplicate physical piece")
			}
			if !reflect.DeepEqual(quantities, scenario.Quantities) || prepared.ID != module.ID {
				t.Fatalf("unexpected prepared module/BOM: %+v %v", prepared, quantities)
			}
			after, _ := json.Marshal([]any{catalog, module})
			valuesAfter, _ := json.Marshal(scenario.Values)
			if string(after) != string(original) || string(before) != string(valuesAfter) {
				t.Fatal("input mutated")
			}
			if !reflect.DeepEqual(prepared, ApplyEvaluatedAgregadoBindings(module, values)) {
				t.Fatal("non-deterministic binding")
			}
		})
	}
}

// #1386: the BOM mirror of the formula-pose rule (resolve.go) must produce
// the same unit sizes as the layout — full-size units when the pose formulas
// use i/N, the historic layout_direction split otherwise. The drawer front
// derives its length from the unit height so the branch is observable in
// the piece dims, not just in the piece count.
func TestResolveBomAgregadoCopyPoseFormula(t *testing.T) {
	mat := domain.MaterialBoard{
		ID: "mat-1", Code: "MAT", Name: "Melamina", Active: true,
		WidthMm: 1830, LengthMm: 2440, ThicknessMm: 18, CostPerM2: 20,
		DefaultEdgeBandID: "edge-1",
	}
	edge := domain.EdgeBand{ID: "edge-1", Code: "CAN", Name: "Canto", CostPerMl: 1, Active: true}
	compFrente := domain.Component{
		ID: "comp-frente", Code: "FCAJ", Name: "Frente Cajon", Placement: domain.PlacementFrenteCajon,
		GeometryKind: "rectangular_board", LengthFormula: "H", WidthMm: 500, ThicknessMm: 18,
		OptionRoles: []string{"FRENTE"}, Active: true,
	}
	agrCajon := domain.Agregado{
		ID: "cajon-std", Code: "CAJ", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-frente", Quantity: 1}},
	}
	st := domain.Structure{ID: "st-1", Code: "EST", Name: "Cuerpo", WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true}
	module := domain.Module{
		ID: "mod-1", Code: "MOD", Name: "Cajonera", StructureID: "st-1",
		WidthMm: 600, HeightMm: 720, DepthMm: 560,
		Agregados: []domain.ModuleAgregadoInstance{{AgregadoID: "cajon-std", Quantity: 1}},
		ParameterDefinitions: []domain.FurnitureParameterDefinition{{
			Name: "cajones", Label: "Cajones", Type: domain.FurnitureParameterTypeNumber,
			Category:     domain.FurnitureParameterCategoryConfiguration,
			DefaultValue: float64(1), Integer: true,
			Binding: &domain.FurnitureParameterBinding{
				Version: 1, Kind: domain.FurnitureParameterBindingAgregadoQuantity, AgregadoID: "cajon-std",
			},
		}},
	}
	catalog := domain.Catalog{
		Materials:  []domain.MaterialBoard{mat},
		Edges:      []domain.EdgeBand{edge},
		Structures: []domain.Structure{st},
		Components: []domain.Component{compFrente},
		Agregados:  []domain.Agregado{agrCajon},
	}
	choices := map[string]string{"INTERIOR": "mat-1", "FRENTE": "mat-1"}
	run := func(t *testing.T, instance domain.ModuleAgregadoInstance, value float64) []domain.ResolvedBoardPart {
		t.Helper()
		module.Agregados = []domain.ModuleAgregadoInstance{instance}
		bound := ApplyEvaluatedAgregadoBindings(module, map[string]any{"cajones": value})
		bom, err := ResolveBomWithContext(bound, choices, catalog, nil, "", nil,
			&domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560})
		if err != nil {
			t.Fatal(err)
		}
		return bom.BoardParts
	}

	t.Run("pose formula makes BOM units full-size", func(t *testing.T) {
		parts := run(t, domain.ModuleAgregadoInstance{
			AgregadoID: "cajon-std", Quantity: 1,
			Position: &domain.AgregadoPosition{ZFormula: "i*250"},
		}, 3)
		if len(parts) != 3 {
			t.Fatalf("expected 3 pieces, got %d", len(parts))
		}
		for i, part := range parts {
			if want := fmt.Sprintf("agr-cajon-std-u%d-comp-frente-copy-0", i); part.ID != want {
				t.Fatalf("piece id = %s, want %s", part.ID, want)
			}
			if part.LengthMm != 720 {
				t.Fatalf("piece %s length = %v, want full unit 720", part.ID, part.LengthMm)
			}
		}
	})

	t.Run("no pose formula keeps the split unit sizes", func(t *testing.T) {
		parts := run(t, domain.ModuleAgregadoInstance{
			AgregadoID: "cajon-std", Quantity: 1, LayoutDirection: "vertical",
		}, 2)
		if len(parts) != 2 {
			t.Fatalf("expected 2 pieces, got %d", len(parts))
		}
		for _, part := range parts {
			if part.LengthMm != 360 {
				t.Fatalf("piece %s length = %v, want split unit 360", part.ID, part.LengthMm)
			}
		}
	})
}
