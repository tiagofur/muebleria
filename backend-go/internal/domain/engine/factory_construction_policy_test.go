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
		FloorToSide        *FactoryJointRule                         `json:"floorToSide"`
		ShelfToSide        *FactoryJointRule                         `json:"shelfToSide"`
		ComponentOverrides map[string]*ComponentConstructionOverride `json:"componentOverrides"`
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
			if componentOverridesDiffer(policy.ComponentOverrides, testCase.Expected.ComponentOverrides) {
				t.Fatalf("component overrides = %+v, want %+v", policy.ComponentOverrides, testCase.Expected.ComponentOverrides)
			}
		})
	}
}

func componentOverridesDiffer(got, want map[string]*ComponentConstructionOverride) bool {
	if len(got) != len(want) {
		return true
	}
	for id, wantEntry := range want {
		gotEntry := got[id]
		if gotEntry == nil {
			return true
		}
		if scalarDiffer(gotEntry.StationsCount, wantEntry.StationsCount) ||
			scalarDiffer(gotEntry.StartMarginMm, wantEntry.StartMarginMm) ||
			scalarDiffer(gotEntry.EndMarginMm, wantEntry.EndMarginMm) ||
			scalarDiffer(gotEntry.MaxSpacingMm, wantEntry.MaxSpacingMm) {
			return true
		}
	}
	return false
}

func scalarDiffer(got, want *float64) bool {
	if got == nil || want == nil {
		return got != want
	}
	return *got != *want
}

// rulesDiffer compares field by field: the rule carries pointer scalars
// (maxSpacingMm, #1065), so a struct != would compare pointer identities.
func rulesDiffer(got, want *FactoryJointRule) bool {
	if got == nil || want == nil {
		return got != want
	}
	if got.StationsCount != want.StationsCount ||
		got.StartMarginMm != want.StartMarginMm ||
		got.EndMarginMm != want.EndMarginMm {
		return true
	}
	return scalarDiffer(got.MaxSpacingMm, want.MaxSpacingMm)
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
			// #1065: spacing rules validate like counts — positive and finite.
			"zero spacing":     []byte(`{"joint.floorToSide.systemId": "m", "joint.floorToSide.maxSpacingMm": 0}`),
			"negative spacing": []byte(`{"joint.floorToSide.systemId": "m", "joint.floorToSide.maxSpacingMm": -250}`),
			"string spacing":   []byte(`{"joint.floorToSide.systemId": "m", "joint.floorToSide.maxSpacingMm": "wide"}`),
		} {
			if _, err := ParseFactoryConstructionPolicy(raw); err == nil {
				t.Fatalf("%s: unusable explicit pattern must error", name)
			}
		}
	})

	t.Run("structured count and spacing mixed fails closed", func(t *testing.T) {
		raw := []byte(`{"joint.constructionPolicy": {"version": 1, "floorToSide": {
			"provenance": "factory", "stationsCount": 3, "maxSpacingMm": 250,
			"startMarginMm": 40, "endMarginMm": 40}}}`)
		if _, err := ParseFactoryConstructionPolicy(raw); err == nil {
			t.Fatalf("a family declaring both patterns must error")
		}
	})

	t.Run("granular count wins over a stale spacing key (#1065)", func(t *testing.T) {
		// The flat keys are a multi-writer merge surface: a provisioned
		// spacing default plus a later explicit count must resolve to the
		// count, never poison the org policy with a parse error.
		raw := []byte(`{"joint.floorToSide.maxSpacingMm": 250, "joint.floorToSide.stationsCount": 4}`)
		policy, err := ParseFactoryConstructionPolicy(raw)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if policy.FloorToSide == nil || policy.FloorToSide.StationsCount != 4 {
			t.Fatalf("floor rule = %+v, want count 4", policy.FloorToSide)
		}
		if policy.FloorToSide.MaxSpacingMm != nil {
			t.Fatalf("the stale spacing key must be ignored: %+v", policy.FloorToSide)
		}
	})

	t.Run("structured spacing rule zeroes the count", func(t *testing.T) {
		raw := []byte(`{"joint.constructionPolicy": {"version": 1, "shelfToSide": {
			"provenance": "factory", "maxSpacingMm": 400,
			"startMarginMm": 40, "endMarginMm": 60}}}`)
		policy, err := ParseFactoryConstructionPolicy(raw)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if policy.ShelfToSide == nil || policy.ShelfToSide.MaxSpacingMm == nil || *policy.ShelfToSide.MaxSpacingMm != 400 {
			t.Fatalf("spacing rule = %+v", policy.ShelfToSide)
		}
		if policy.ShelfToSide.StationsCount != 0 {
			t.Fatalf("a spacing rule must not carry a count: %+v", policy.ShelfToSide)
		}
	})

	t.Run("component spacing exception resolves over the factory count", func(t *testing.T) {
		spacing := 300.0
		policy := &FactoryConstructionPolicy{
			FloorToSide: &FactoryJointRule{StationsCount: 4, StartMarginMm: 30, EndMarginMm: 35},
			ComponentOverrides: map[string]*ComponentConstructionOverride{
				"comp-base": {MaxSpacingMm: &spacing, StartMarginMm: float64Pointer(20)},
			},
		}
		rule := policy.RuleForComponent("comp-base", "floor-side")
		if rule == nil || rule.MaxSpacingMm == nil || *rule.MaxSpacingMm != 300 {
			t.Fatalf("component spacing exception must own the pattern: %+v", rule)
		}
		if rule.StationsCount != 0 {
			t.Fatalf("resolved spacing rule must not keep a count: %+v", rule)
		}
		if rule.StartMarginMm != 20 || rule.EndMarginMm != 35 {
			t.Fatalf("margins resolve per scalar around the spacing: %+v", rule)
		}

		count := 3.0
		policy.ComponentOverrides["comp-count"] = &ComponentConstructionOverride{StationsCount: &count}
		rule = policy.RuleForComponent("comp-count", "floor-side")
		if rule == nil || rule.MaxSpacingMm != nil || rule.StationsCount != 3 {
			t.Fatalf("a count exception must replace a factory spacing: %+v", rule)
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
	result := applyFactoryStationPatterns(undeclared, policy, nil)
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
	if unchanged := applyFactoryStationPatterns(undeclared, nil, nil); &unchanged[0] != &undeclared[0] {
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

	t.Run("spacing family rule materializes maxSpacingMm, never a zero count (#1065)", func(t *testing.T) {
		spacing := 400.0
		policy := &FactoryConstructionPolicy{
			ShelfToSide: &FactoryJointRule{StartMarginMm: 50, EndMarginMm: 50, MaxSpacingMm: &spacing},
		}
		definition := structureDefinition()
		definition.Binding.Relationship.Kind = "fixed-shelf-side"
		relationships := materializeBoundRelationships(
			[]domain.FurnitureParameterDefinition{definition},
			map[string]any{"baseJointStations": float64(3)},
			structureBoards(), nil, policy)
		if len(relationships) != 1 {
			t.Fatalf("relationships = %+v", relationships)
		}
		if got := relationships[0].Parameters["maxSpacingMm"]; got != spacing {
			t.Fatalf("the spacing rule must materialize maxSpacingMm, got %v", got)
		}
		if _, hasCount := relationships[0].Parameters["stationCount"]; hasCount {
			t.Fatalf("a spacing policy must not materialize a (zero) stationCount: %+v", relationships[0].Parameters)
		}
		if relationships[0].Parameters["startMarginMm"] != 50.0 || relationships[0].Parameters["endMarginMm"] != 50.0 {
			t.Fatalf("the spacing rule carries the factory margins: %+v", relationships[0].Parameters)
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

func TestParseFactoryConstructionPolicyComponentOverrides(t *testing.T) {
	t.Run("raw entries pass through with scalars validated", func(t *testing.T) {
		policy, err := ParseFactoryConstructionPolicy([]byte(`{
			"joint.constructionPolicy": {
				"version": 1,
				"shelfToSide": {"provenance": "factory", "stationsCount": 4, "startMarginMm": 40, "endMarginMm": 40},
				"componentOverrides": {
					"comp-shelf-a": {"stationsCount": 2},
					"comp-shelf-b": {"stationsCount": 3, "startMarginMm": 25, "endMarginMm": 25}
				}
			}
		}`))
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if len(policy.ComponentOverrides) != 2 {
			t.Fatalf("component overrides = %+v", policy.ComponentOverrides)
		}
		a := policy.ComponentOverrides["comp-shelf-a"]
		if a == nil || a.StationsCount == nil || *a.StationsCount != 2 || a.StartMarginMm != nil {
			t.Fatalf("comp-shelf-a entry = %+v", a)
		}
		b := policy.ComponentOverrides["comp-shelf-b"]
		if b == nil || b.StartMarginMm == nil || *b.StartMarginMm != 25 {
			t.Fatalf("comp-shelf-b entry = %+v", b)
		}
	})

	t.Run("absent and empty entries carry no intent", func(t *testing.T) {
		policy, err := ParseFactoryConstructionPolicy([]byte(`{
			"joint.constructionPolicy": {
				"version": 1,
				"componentOverrides": {"comp-empty": {}}
			}
		}`))
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if policy.ComponentOverrides != nil {
			t.Fatalf("entries without usable scalars must not persist: %+v", policy.ComponentOverrides)
		}
	})

	t.Run("unusable explicit scalars fail closed", func(t *testing.T) {
		for name, raw := range map[string]json.RawMessage{
			"count below floor":  []byte(`{"joint.constructionPolicy": {"version": 1, "componentOverrides": {"c": {"stationsCount": 1}}}}`),
			"zero count":         []byte(`{"joint.constructionPolicy": {"version": 1, "componentOverrides": {"c": {"stationsCount": 0}}}}`),
			"count above bound":  []byte(`{"joint.constructionPolicy": {"version": 1, "componentOverrides": {"c": {"stationsCount": 1001}}}}`),
			"fractional count":   []byte(`{"joint.constructionPolicy": {"version": 1, "componentOverrides": {"c": {"stationsCount": 2.5}}}}`),
			"negative margin":    []byte(`{"joint.constructionPolicy": {"version": 1, "componentOverrides": {"c": {"startMarginMm": -1}}}}`),
			"string margin":      []byte(`{"joint.constructionPolicy": {"version": 1, "componentOverrides": {"c": {"endMarginMm": "wide"}}}}`),
			"entry not object":   []byte(`{"joint.constructionPolicy": {"version": 1, "componentOverrides": {"c": 4}}}`),
			"section not object": []byte(`{"joint.constructionPolicy": {"version": 1, "componentOverrides": 4}}`),
		} {
			if _, err := ParseFactoryConstructionPolicy(raw); err == nil {
				t.Fatalf("%s: unusable explicit exception must error", name)
			}
		}
	})

	t.Run("granular fallback carries no component dimension", func(t *testing.T) {
		policy, err := ParseFactoryConstructionPolicy([]byte(`{"joint.shelfToSide.stationsCount": 4}`))
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if policy.ComponentOverrides != nil {
			t.Fatalf("granular overrides must not invent component exceptions: %+v", policy.ComponentOverrides)
		}
	})
}

func TestRuleForComponentResolvesTheC3Ladder(t *testing.T) {
	factory := &FactoryJointRule{StationsCount: 4, StartMarginMm: 40, EndMarginMm: 40}
	policy := &FactoryConstructionPolicy{
		ShelfToSide: factory,
		ComponentOverrides: map[string]*ComponentConstructionOverride{
			"comp-exception-count":      {StationsCount: float64Pointer(2)},
			"comp-exception-full":       {StationsCount: float64Pointer(3), StartMarginMm: float64Pointer(20), EndMarginMm: float64Pointer(25)},
			"comp-exception-margins":    {StartMarginMm: float64Pointer(10)},
			"comp-unknown-family-kind2": {StationsCount: float64Pointer(5)},
		},
	}

	t.Run("component without exception inherits the factory rule", func(t *testing.T) {
		got := policy.RuleForComponent("comp-plain", "fixed-shelf-side")
		if got == nil || *got != *factory {
			t.Fatalf("plain component must inherit factory: %+v", got)
		}
	})

	t.Run("count-only exception keeps factory margins", func(t *testing.T) {
		got := policy.RuleForComponent("comp-exception-count", "fixed-shelf-side")
		if got.StationsCount != 2 || got.StartMarginMm != 40 || got.EndMarginMm != 40 {
			t.Fatalf("count-only exception must inherit factory margins: %+v", got)
		}
	})

	t.Run("full exception replaces the whole pattern", func(t *testing.T) {
		got := policy.RuleForComponent("comp-exception-full", "fixed-shelf-side")
		if got.StationsCount != 3 || got.StartMarginMm != 20 || got.EndMarginMm != 25 {
			t.Fatalf("full exception must replace: %+v", got)
		}
	})

	t.Run("margin-only exception inherits factory count", func(t *testing.T) {
		got := policy.RuleForComponent("comp-exception-margins", "fixed-shelf-side")
		if got.StationsCount != 4 || got.StartMarginMm != 10 || got.EndMarginMm != 40 {
			t.Fatalf("margin-only exception must inherit factory count and other margin: %+v", got)
		}
	})

	t.Run("component exception without a factory rule falls back to library defaults", func(t *testing.T) {
		got := policy.RuleForComponent("comp-exception-count", "floor-side")
		if got == nil || got.StationsCount != 2 || got.StartMarginMm != factoryPolicyDefaultMarginMm {
			t.Fatalf("exception over inherited family must resolve library defaults: %+v", got)
		}
	})

	t.Run("unresolvable kind inherits everywhere", func(t *testing.T) {
		if got := policy.RuleForComponent("comp-exception-count", "top-to-side"); got != nil {
			t.Fatalf("engine-unresolvable kind must stay honest absence: %+v", got)
		}
	})

	t.Run("nil policy and empty component id inherit", func(t *testing.T) {
		var nilPolicy *FactoryConstructionPolicy
		if nilPolicy.RuleForComponent("comp-exception-count", "fixed-shelf-side") != nil {
			t.Fatalf("nil policy must inherit")
		}
		if policy.RuleForComponent("", "fixed-shelf-side") != factory {
			t.Fatalf("empty component id must resolve the factory rule")
		}
	})
}

func float64Pointer(v float64) *float64 { return &v }

func TestApplyFactoryStationPatternsComponentExceptionBeatsFactoryRule(t *testing.T) {
	policy := &FactoryConstructionPolicy{
		FloorToSide: &FactoryJointRule{StationsCount: 4, StartMarginMm: 30, EndMarginMm: 35},
		ComponentOverrides: map[string]*ComponentConstructionOverride{
			"comp-base": {StationsCount: float64Pointer(2)},
		},
	}
	// Instance "floor" maps to catalog component "comp-base" (the exception
	// holder); "floor-other" maps to a plain component.
	boards := []layoutBoard{
		{id: "floor", catalogComponentID: "comp-base"},
		{id: "floor-other", catalogComponentID: "comp-base-plain"},
	}
	relationships := []AuthoringRelationship{
		{RelationshipID: "a1", Kind: "floor-side", Source: AuthoringRelationshipAnchor{ComponentInstanceID: "floor"}, Parameters: map[string]any{}},
		{RelationshipID: "a2", Kind: "floor-side", Source: AuthoringRelationshipAnchor{ComponentInstanceID: "floor-other"}, Parameters: map[string]any{}},
		{RelationshipID: "a3", Kind: "floor-side", Source: AuthoringRelationshipAnchor{ComponentInstanceID: "floor"}, Parameters: map[string]any{"stationCount": float64(6)}},
	}
	result := applyFactoryStationPatterns(relationships, policy, boards)
	if got := result[0].Parameters["stationCount"]; got != float64(2) {
		t.Fatalf("the excepted component must take its own count 2, got %v", got)
	}
	if got := result[1].Parameters["stationCount"]; got != float64(4) {
		t.Fatalf("a plain component must keep the factory count 4, got %v", got)
	}
	if got := result[2].Parameters["stationCount"]; got != float64(6) {
		t.Fatalf("authored explicit count stays immune to the exception, got %v", got)
	}
}

// TestApplyFactoryStationPatternsSpacingRuleInjectsMaxSpacing (#1065): a
// factory spacing rule fills the pattern with maxSpacingMm — never a count —
// so the resolver derives each contact's stations from its real span.
func TestApplyFactoryStationPatternsSpacingRuleInjectsMaxSpacing(t *testing.T) {
	spacing := 250.0
	policy := &FactoryConstructionPolicy{
		FloorToSide: &FactoryJointRule{StartMarginMm: 40, EndMarginMm: 40, MaxSpacingMm: &spacing},
	}
	relationships := []AuthoringRelationship{
		{RelationshipID: "undeclared", Kind: "floor-side", Parameters: map[string]any{}},
		{RelationshipID: "authored-count", Kind: "floor-side", Parameters: map[string]any{"stationCount": float64(2)}},
		{RelationshipID: "authored-spacing", Kind: "floor-side", Parameters: map[string]any{"maxSpacingMm": float64(400)}},
	}
	result := applyFactoryStationPatterns(relationships, policy, nil)
	if got := result[0].Parameters["maxSpacingMm"]; got != spacing {
		t.Fatalf("undeclared floor-side must take the factory spacing, got %v", got)
	}
	if _, hasCount := result[0].Parameters["stationCount"]; hasCount {
		t.Fatalf("a spacing rule must not inject a count: %+v", result[0].Parameters)
	}
	if result[0].Parameters["startMarginMm"] != 40.0 || result[0].Parameters["endMarginMm"] != 40.0 {
		t.Fatalf("spacing rule must carry the factory margins: %+v", result[0].Parameters)
	}
	if _, untouched := result[1].Parameters["maxSpacingMm"]; untouched {
		t.Fatalf("authored count must stay untouched by the factory spacing: %+v", result[1].Parameters)
	}
	if got := result[2].Parameters["maxSpacingMm"]; got != float64(400) {
		t.Fatalf("authored spacing stays immune to the factory rule, got %v", got)
	}

	t.Run("component spacing exception replaces the factory count", func(t *testing.T) {
		componentSpacing := 300.0
		policy := &FactoryConstructionPolicy{
			FloorToSide: &FactoryJointRule{StationsCount: 4, StartMarginMm: 30, EndMarginMm: 35},
			ComponentOverrides: map[string]*ComponentConstructionOverride{
				"comp-base": {MaxSpacingMm: &componentSpacing},
			},
		}
		boards := []layoutBoard{
			{id: "floor", catalogComponentID: "comp-base"},
			{id: "floor-other", catalogComponentID: "comp-plain"},
		}
		relationships := []AuthoringRelationship{
			{RelationshipID: "a1", Kind: "floor-side", Source: AuthoringRelationshipAnchor{ComponentInstanceID: "floor"}, Parameters: map[string]any{}},
			{RelationshipID: "a2", Kind: "floor-side", Source: AuthoringRelationshipAnchor{ComponentInstanceID: "floor-other"}, Parameters: map[string]any{}},
		}
		result := applyFactoryStationPatterns(relationships, policy, boards)
		if got := result[0].Parameters["maxSpacingMm"]; got != componentSpacing {
			t.Fatalf("the excepted component must derive from its own spacing, got %v", got)
		}
		if _, hasCount := result[0].Parameters["stationCount"]; hasCount {
			t.Fatalf("a component spacing exception must not leave a count: %+v", result[0].Parameters)
		}
		if got := result[1].Parameters["stationCount"]; got != float64(4) {
			t.Fatalf("a plain component keeps the factory count, got %v", got)
		}
	})
}

func TestMaterializeBoundRelationshipsComponentExceptionBeatsFactoryRule(t *testing.T) {
	policy := &FactoryConstructionPolicy{
		FloorToSide: &FactoryJointRule{StationsCount: 4, StartMarginMm: 30, EndMarginMm: 35},
		ComponentOverrides: map[string]*ComponentConstructionOverride{
			"comp-base": {StationsCount: float64Pointer(2)},
			"comp-side": {StartMarginMm: float64Pointer(15)},
		},
	}
	relationships := materializeBoundRelationships(
		[]domain.FurnitureParameterDefinition{structureDefinition()},
		map[string]any{"baseJointStations": float64(3)},
		structureBoards(), nil, policy)
	if len(relationships) != 1 {
		t.Fatalf("relationships = %+v", relationships)
	}
	if got := relationships[0].Parameters["stationCount"]; got != float64(2) {
		t.Fatalf("the binding's component exception must beat the factory count 4, got %v", got)
	}
	if relationships[0].Parameters["startMarginMm"] != 30.0 || relationships[0].Parameters["endMarginMm"] != 35.0 {
		t.Fatalf("count-only exception must inherit the factory margins: %+v", relationships[0].Parameters)
	}

	t.Run("an exception on a target component does not govern the source joint", func(t *testing.T) {
		factoryOnly := &FactoryConstructionPolicy{
			FloorToSide:        &FactoryJointRule{StationsCount: 4, StartMarginMm: 30, EndMarginMm: 35},
			ComponentOverrides: map[string]*ComponentConstructionOverride{},
		}
		relationships := materializeBoundRelationships(
			[]domain.FurnitureParameterDefinition{structureDefinition()},
			map[string]any{"baseJointStations": float64(3)},
			structureBoards(), nil, factoryOnly)
		if len(relationships) != 1 || relationships[0].Parameters["stationCount"] != float64(4) {
			t.Fatalf("scoping guard: %+v", relationships)
		}
	})
}
