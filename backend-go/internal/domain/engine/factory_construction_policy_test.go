package engine

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type factoryPolicyFixtureCase struct {
	Name      string          `json:"name"`
	Overrides json.RawMessage `json:"overrides"`
	Expected  struct {
		FloorToSide *FactoryJointRule `json:"floorToSide"`
		ShelfToSide *FactoryJointRule `json:"shelfToSide"`
	} `json:"expected"`
}

func TestParseFactoryConstructionPolicyParityFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/factoryConstructionPolicyParity.contract.json")
	if err != nil {
		t.Fatalf("read parity contract: %v", err)
	}
	var fixture struct {
		Cases []factoryPolicyFixtureCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode parity contract: %v", err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatalf("parity contract carries no cases")
	}
	for _, testCase := range fixture.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			policy, err := ParseFactoryConstructionPolicy(testCase.Overrides)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			if rulesDiffer(policy.FloorToSide, testCase.Expected.FloorToSide) ||
				rulesDiffer(policy.ShelfToSide, testCase.Expected.ShelfToSide) {
				t.Fatalf("rules = %+v, want floor=%+v shelf=%+v",
					policy, testCase.Expected.FloorToSide, testCase.Expected.ShelfToSide)
			}
		})
	}
}

func rulesDiffer(got, want *FactoryJointRule) bool {
	if got == nil || want == nil {
		return got != want
	}
	return *got != *want
}

func TestParseFactoryConstructionPolicyEdgeCases(t *testing.T) {
	t.Run("empty overrides inherit", func(t *testing.T) {
		for _, raw := range []json.RawMessage{nil, []byte(""), []byte("null")} {
			policy, err := ParseFactoryConstructionPolicy(raw)
			if err != nil || policy != nil {
				t.Fatalf("raw %s: policy = %+v, err = %v", raw, policy, err)
			}
		}
	})
	t.Run("malformed overrides fail closed", func(t *testing.T) {
		if _, err := ParseFactoryConstructionPolicy(json.RawMessage("{not-json")); err == nil {
			t.Fatalf("malformed JSON must error")
		}
	})
	t.Run("unusable explicit patterns fail closed", func(t *testing.T) {
		for name, raw := range map[string]json.RawMessage{
			"count below floor":     []byte(`{"joint.floorToSide.stationsCount": 1}`),
			"count above bound":     []byte(`{"joint.floorToSide.stationsCount": 1001}`),
			"fractional count":      []byte(`{"joint.floorToSide.stationsCount": 2.5}`),
			"negative margin":       []byte(`{"joint.shelfToSide.systemId": "m", "joint.shelfToSide.startMarginMm": -5}`),
			"string margin":         []byte(`{"joint.floorToSide.systemId": "m", "joint.floorToSide.endMarginMm": "wide"}`),
			"structured non-object": []byte(`{"joint.constructionPolicy": {"version": 1, "floorToSide": "four"}}`),
		} {
			if _, err := ParseFactoryConstructionPolicy(raw); err == nil {
				t.Fatalf("%s: unusable explicit pattern must error", name)
			}
		}
	})
}

func TestRuleForKindMapsEngineResolvableFamilies(t *testing.T) {
	policy := &FactoryConstructionPolicy{
		FloorToSide: &FactoryJointRule{StationsCount: 4},
		ShelfToSide: &FactoryJointRule{StationsCount: 2},
	}
	if policy.RuleForKind("floor-side") != policy.FloorToSide {
		t.Fatalf("floor-side must map to the floor family rule")
	}
	if policy.RuleForKind("fixed-shelf-side") != policy.ShelfToSide {
		t.Fatalf("fixed-shelf-side must map to the shelf family rule")
	}
	if policy.RuleForKind("shelf-support") != nil || policy.RuleForKind("top-to-side") != nil {
		t.Fatalf("unresolved kinds must inherit, got overrides")
	}
	var nilPolicy *FactoryConstructionPolicy
	if nilPolicy.RuleForKind("floor-side") != nil {
		t.Fatalf("nil policy must inherit everywhere")
	}
}

func TestApplyFactoryStationPatternsFillsOnlyUndeclaredIntent(t *testing.T) {
	rule := &FactoryJointRule{StationsCount: 4, StartMarginMm: 30, EndMarginMm: 35}
	policy := &FactoryConstructionPolicy{FloorToSide: rule}

	undeclared := []AuthoringRelationship{
		{RelationshipID: "authored-1", Kind: "floor-side", Parameters: map[string]any{}},
		{RelationshipID: "authored-2", Kind: "floor-side", Parameters: map[string]any{"stationCount": float64(2)}},
		{RelationshipID: "authored-3", Kind: "floor-side", Families: []AuthoringRelationshipFamily{{FamilyID: "f"}}},
		{RelationshipID: "authored-4", Kind: "fixed-shelf-side", Parameters: nil},
	}
	result := applyFactoryStationPatterns(undeclared, policy)
	if got := result[0].Parameters["stationCount"]; got != float64(4) {
		t.Fatalf("undeclared floor-side must take the factory count, got %v", got)
	}
	if result[0].Parameters["startMarginMm"] != 30.0 || result[0].Parameters["endMarginMm"] != 35.0 {
		t.Fatalf("undeclared floor-side must take the factory margins: %+v", result[0].Parameters)
	}
	if _, explicit := result[1].Parameters["stationCount"]; !explicit || result[1].Parameters["stationCount"] != float64(2) {
		t.Fatalf("explicit authored count must stay untouched: %+v", result[1].Parameters)
	}
	if len(result[2].Families) != 1 || len(result[2].Parameters) != 0 {
		t.Fatalf("family-declared relationships are explicit intent and stay untouched: %+v", result[2])
	}
	if _, filled := result[3].Parameters["stationCount"]; filled {
		t.Fatalf("fixed-shelf-side has no floor rule and must inherit: %+v", result[3].Parameters)
	}
	if unchanged := applyFactoryStationPatterns(undeclared, nil); &unchanged[0] != &undeclared[0] {
		t.Fatalf("nil policy must be a no-op")
	}
}

func TestMaterializeBoundRelationshipsFactoryPolicyOverridesDefinitionDefault(t *testing.T) {
	policy := &FactoryConstructionPolicy{
		FloorToSide: &FactoryJointRule{StationsCount: 4, StartMarginMm: 30, EndMarginMm: 35},
	}
	relationships := materializeBoundRelationships(
		[]domain.FurnitureParameterDefinition{structureDefinition()},
		map[string]any{"baseJointStations": float64(3)},
		structureBoards(), nil, policy)
	if len(relationships) != 1 {
		t.Fatalf("relationships = %+v", relationships)
	}
	if got := relationships[0].Parameters["stationCount"]; got != float64(4) {
		t.Fatalf("factory policy must replace the definition default 3, got %v", got)
	}
	if relationships[0].Parameters["startMarginMm"] != 30.0 || relationships[0].Parameters["endMarginMm"] != 35.0 {
		t.Fatalf("factory policy must replace the binding margins: %+v", relationships[0].Parameters)
	}

	t.Run("library provenance keeps the definition default", func(t *testing.T) {
		relationships := materializeBoundRelationships(
			[]domain.FurnitureParameterDefinition{structureDefinition()},
			map[string]any{"baseJointStations": float64(3)},
			structureBoards(), nil, &FactoryConstructionPolicy{})
		if len(relationships) != 1 || relationships[0].Parameters["stationCount"] != float64(3) {
			t.Fatalf("no factory rule must keep the parameter-driven count: %+v", relationships)
		}
		if relationships[0].Parameters["startMarginMm"] != 40.0 {
			t.Fatalf("binding margins must survive without a factory rule: %+v", relationships[0].Parameters)
		}
	})

	t.Run("shelf family rule maps fixed-shelf-side bindings", func(t *testing.T) {
		definition := structureDefinition()
		definition.Binding.Relationship.Kind = "fixed-shelf-side"
		policy := &FactoryConstructionPolicy{ShelfToSide: &FactoryJointRule{StationsCount: 2, StartMarginMm: 60, EndMarginMm: 60}}
		relationships := materializeBoundRelationships(
			[]domain.FurnitureParameterDefinition{definition},
			map[string]any{"baseJointStations": float64(3)},
			structureBoards(), nil, policy)
		if len(relationships) != 1 || relationships[0].Parameters["stationCount"] != float64(2) {
			t.Fatalf("shelf rule must govern fixed-shelf-side bindings: %+v", relationships)
		}
	})

	t.Run("construction-declared families stay policy-immune", func(t *testing.T) {
		definition := structureDefinition()
		definition.Binding.Relationship.Families = []domain.FurnitureRelationshipFamily{
			{FamilyID: "minifix", Count: 2, StartMarginMm: 10, EndMarginMm: 10},
		}
		relationships := materializeBoundRelationships(
			[]domain.FurnitureParameterDefinition{definition},
			map[string]any{"baseJointStations": float64(3)},
			structureBoards(), nil, policy)
		if len(relationships) != 1 || len(relationships[0].Families) != 1 {
			t.Fatalf("family-declared binding must keep its families: %+v", relationships)
		}
		if len(relationships[0].Parameters) != 0 {
			t.Fatalf("family-declared binding must not grow a policy station pattern: %+v", relationships[0].Parameters)
		}
	})
}
