package engine

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestComponentBindingsSharedContract(t *testing.T) {
	var fixture struct {
		GoPiecePrefix string                                `json:"goPiecePrefix"`
		Parameters    []domain.FurnitureParameterDefinition `json:"parameters"`
		Cases         []struct {
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
				expectedIDs = append(expectedIDs, fixture.GoPiecePrefix+id)
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
