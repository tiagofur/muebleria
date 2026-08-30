package domain

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestFurnitureParameterDefinitionJSONRoundTrip(t *testing.T) {
	raw := []byte(`[
		{"name":"widthMm","label":"Width","type":"number","defaultValue":600,"required":true,"unit":"mm","category":"dimension","min":300,"max":1200,"step":10,"integer":true},
		{"name":"note","label":"Note","type":"string","defaultValue":"","required":false,"category":"configuration"},
		{"name":"hasBack","label":"Has back","type":"boolean","defaultValue":false,"required":false,"category":"configuration"},
		{"name":"doorStyle","label":"Door style","type":"enum","defaultValue":"slab","required":true,"category":"style","options":["slab","shaker"]}
	]`)

	var definitions []FurnitureParameterDefinition
	if err := json.Unmarshal(raw, &definitions); err != nil {
		t.Fatal(err)
	}
	if issues := ValidateFurnitureParameterDefinitions(definitions); len(issues) != 0 {
		t.Fatalf("valid JSON definitions rejected: %+v", issues)
	}
	if definitions[0].DefaultValue != float64(600) || definitions[1].DefaultValue != "" || definitions[2].DefaultValue != false {
		t.Fatalf("JSON scalar defaults did not retain their types: %#v", definitions)
	}

	encoded, err := json.Marshal(definitions)
	if err != nil {
		t.Fatal(err)
	}
	var roundTrip []FurnitureParameterDefinition
	if err := json.Unmarshal(encoded, &roundTrip); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(roundTrip, definitions) {
		t.Fatalf("definitions did not round-trip:\n got %#v\nwant %#v", roundTrip, definitions)
	}
}

func TestValidateFurnitureParameterDefinitions(t *testing.T) {
	f := func(value float64) *float64 { return &value }
	tests := []struct {
		name       string
		definition FurnitureParameterDefinition
		wantField  string
	}{
		{name: "valid number", definition: numberDefinition("widthMm", 600, f(300), f(1200), f(10))},
		{name: "valid string", definition: scalarDefinition("note", FurnitureParameterTypeString, "")},
		{name: "valid boolean false default", definition: scalarDefinition("hasBack", FurnitureParameterTypeBoolean, false)},
		{name: "valid enum", definition: enumDefinition("doorStyle", "slab", []string{"slab", "shaker"})},
		{name: "bad type", definition: scalarDefinition("bad", "object", "x"), wantField: "type"},
		{name: "wrong default type", definition: scalarDefinition("hasBack", FurnitureParameterTypeBoolean, "false"), wantField: "defaultValue"},
		{name: "non finite constraint", definition: numberDefinition("widthMm", 600, f(0), f(1200), f(0)), wantField: "step"},
		{name: "reversed range", definition: numberDefinition("widthMm", 600, f(700), f(600), f(10)), wantField: "min|max"},
		{name: "default outside range", definition: numberDefinition("widthMm", 200, f(300), f(1200), f(10)), wantField: "defaultValue"},
		{name: "default off step", definition: numberDefinition("widthMm", 605, f(300), f(1200), f(10)), wantField: "defaultValue"},
		{name: "count must be integer", definition: FurnitureParameterDefinition{Name: "shelfCount", Label: "Shelf count", Type: FurnitureParameterTypeNumber, DefaultValue: float64(2), Unit: FurnitureParameterUnitCount, Category: FurnitureParameterCategoryConfiguration, Min: f(0), Max: f(10), Step: f(1)}, wantField: "integer"},
		{name: "integer default must be integral", definition: func() FurnitureParameterDefinition {
			d := numberDefinition("shelfCount", 2.5, f(0), f(10), f(1))
			d.Integer = true
			return d
		}(), wantField: "defaultValue"},
		{name: "enum needs options", definition: enumDefinition("doorStyle", "slab", nil), wantField: "options"},
		{name: "enum options unique", definition: enumDefinition("doorStyle", "slab", []string{"slab", "slab"}), wantField: "options"},
		{name: "enum default allowed", definition: enumDefinition("doorStyle", "raised", []string{"slab", "shaker"}), wantField: "defaultValue"},
		{name: "options only for enum", definition: func() FurnitureParameterDefinition {
			d := scalarDefinition("note", FurnitureParameterTypeString, "")
			d.Options = []string{"x"}
			return d
		}(), wantField: "options"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issues := ValidateFurnitureParameterDefinitions([]FurnitureParameterDefinition{tt.definition})
			if tt.wantField == "" {
				if len(issues) != 0 {
					t.Fatalf("unexpected issues: %+v", issues)
				}
				return
			}
			if !hasDefinitionIssueField(issues, tt.wantField) {
				t.Fatalf("expected issue for %q, got %+v", tt.wantField, issues)
			}
		})
	}

	duplicate := scalarDefinition("note", FurnitureParameterTypeString, "")
	if issues := ValidateFurnitureParameterDefinitions([]FurnitureParameterDefinition{duplicate, duplicate}); !hasDefinitionIssueField(issues, "name") {
		t.Fatalf("duplicate names must fail canonical validation: %+v", issues)
	}
}

func TestEvaluateFurnitureParametersAppliesDefaultsAndNormalizesStrictJSONScalars(t *testing.T) {
	f := func(value float64) *float64 { return &value }
	count := numberDefinition("shelfCount", 2, f(0), f(10), f(1))
	count.Integer = true
	count.Unit = FurnitureParameterUnitCount
	definitions := []FurnitureParameterDefinition{
		numberDefinition("widthMm", 600, f(300), f(1200), f(10)),
		count,
		scalarDefinition("note", FurnitureParameterTypeString, "factory default"),
		scalarDefinition("hasBack", FurnitureParameterTypeBoolean, true),
		enumDefinition("doorStyle", "slab", []string{"slab", "shaker"}),
	}
	provided := map[string]any{
		"widthMm":   float64(750),
		"hasBack":   false,
		"doorStyle": "shaker",
	}

	normalized, issues, err := EvaluateFurnitureParameters(definitions, provided)
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 0 {
		t.Fatalf("valid values rejected: %+v", issues)
	}
	want := map[string]any{
		"widthMm":    float64(750),
		"shelfCount": float64(2),
		"note":       "factory default",
		"hasBack":    false,
		"doorStyle":  "shaker",
	}
	if !reflect.DeepEqual(normalized, want) {
		t.Fatalf("normalized parameters mismatch:\n got %#v\nwant %#v", normalized, want)
	}
	if !reflect.DeepEqual(provided, map[string]any{"widthMm": float64(750), "hasBack": false, "doorStyle": "shaker"}) {
		t.Fatalf("evaluation mutated caller input: %#v", provided)
	}
}

func TestEvaluateFurnitureParametersReturnsStableSeparatedCodes(t *testing.T) {
	f := func(value float64) *float64 { return &value }
	requiredString := scalarDefinition("requiredString", FurnitureParameterTypeString, nil)
	requiredString.Required = true
	count := numberDefinition("shelfCount", 2, f(0), f(10), f(1))
	count.Integer = true
	count.Unit = FurnitureParameterUnitCount
	definitions := []FurnitureParameterDefinition{
		requiredString,
		numberDefinition("widthMm", 600, f(300), f(1200), f(10)),
		numberDefinition("angle", 0, f(0), f(90), f(2.5)),
		count,
		scalarDefinition("note", FurnitureParameterTypeString, ""),
		scalarDefinition("hasBack", FurnitureParameterTypeBoolean, true),
		enumDefinition("doorStyle", "slab", []string{"slab", "shaker"}),
	}
	provided := map[string]any{
		"unknown":    "value",
		"widthMm":    float64(200),
		"angle":      float64(11),
		"shelfCount": float64(2.5),
		"note":       true,
		"hasBack":    "false",
		"doorStyle":  "raised",
	}

	_, issues, err := EvaluateFurnitureParameters(definitions, provided)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]FurnitureParameterIssueCode{
		"unknown":        FurnitureParameterUnknown,
		"requiredString": FurnitureParameterRequired,
		"widthMm":        FurnitureParameterOutOfRange,
		"angle":          FurnitureParameterStepInvalid,
		"shelfCount":     FurnitureParameterTypeInvalid,
		"note":           FurnitureParameterTypeInvalid,
		"hasBack":        FurnitureParameterTypeInvalid,
		"doorStyle":      FurnitureParameterEnumInvalid,
	}
	if len(issues) != len(want) {
		t.Fatalf("issue count mismatch: got %+v want %+v", issues, want)
	}
	for _, issue := range issues {
		if want[issue.Parameter] != issue.Code {
			t.Errorf("%s code = %s, want %s", issue.Parameter, issue.Code, want[issue.Parameter])
		}
	}
}

func TestEvaluateFurnitureParametersDoesNotCoerceValues(t *testing.T) {
	f := func(value float64) *float64 { return &value }
	definitions := []FurnitureParameterDefinition{
		numberDefinition("widthMm", 600, f(300), f(1200), f(10)),
		scalarDefinition("hasBack", FurnitureParameterTypeBoolean, true),
		enumDefinition("doorStyle", "slab", []string{"slab", "shaker"}),
	}
	tests := []struct {
		name  string
		key   string
		value any
	}{
		{name: "Go int is not JSON number representation", key: "widthMm", value: 600},
		{name: "numeric string", key: "widthMm", value: "600"},
		{name: "boolean string", key: "hasBack", value: "true"},
		{name: "enum number", key: "doorStyle", value: float64(1)},
		{name: "null", key: "hasBack", value: nil},
		{name: "array", key: "doorStyle", value: []any{"slab"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, issues, err := EvaluateFurnitureParameters(definitions, map[string]any{tt.key: tt.value})
			if err != nil {
				t.Fatal(err)
			}
			if len(issues) != 1 || issues[0].Code != FurnitureParameterTypeInvalid || issues[0].Parameter != tt.key {
				t.Fatalf("expected strict wrong-type issue, got %+v", issues)
			}
		})
	}
}

func TestFurnitureParameterDefinitionHashIsCanonicalAndCoversRulesAndDefaults(t *testing.T) {
	f := func(value float64) *float64 { return &value }
	width := numberDefinition("widthMm", 600, f(300), f(1200), f(10))
	style := enumDefinition("doorStyle", "slab", []string{"slab", "shaker"})

	first, err := FurnitureParameterDefinitionHash([]FurnitureParameterDefinition{width, style})
	if err != nil {
		t.Fatal(err)
	}
	reordered, err := FurnitureParameterDefinitionHash([]FurnitureParameterDefinition{style, width})
	if err != nil {
		t.Fatal(err)
	}
	if first != reordered {
		t.Fatalf("definition order changed canonical hash: %s != %s", first, reordered)
	}
	if len(first) != len("sha256-")+64 || first[:len("sha256-")] != "sha256-" {
		t.Fatalf("unexpected hash format: %q", first)
	}

	tests := []struct {
		name   string
		mutate func(*FurnitureParameterDefinition)
	}{
		{name: "default", mutate: func(d *FurnitureParameterDefinition) { d.DefaultValue = float64(610) }},
		{name: "minimum", mutate: func(d *FurnitureParameterDefinition) { d.Min = f(200) }},
		{name: "maximum", mutate: func(d *FurnitureParameterDefinition) { d.Max = f(1300) }},
		{name: "step", mutate: func(d *FurnitureParameterDefinition) { d.Step = f(5) }},
		{name: "required", mutate: func(d *FurnitureParameterDefinition) { d.Required = !d.Required }},
		{name: "integer", mutate: func(d *FurnitureParameterDefinition) { d.Integer = true }},
		{name: "unit", mutate: func(d *FurnitureParameterDefinition) { d.Unit = FurnitureParameterUnitDeg }},
		{name: "category", mutate: func(d *FurnitureParameterDefinition) { d.Category = FurnitureParameterCategoryConfiguration }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			changed := width
			tt.mutate(&changed)
			hash, err := FurnitureParameterDefinitionHash([]FurnitureParameterDefinition{changed, style})
			if err != nil {
				t.Fatal(err)
			}
			if hash == first {
				t.Fatalf("changing %s reused definition hash %s", tt.name, hash)
			}
		})
	}

	changedOptions := style
	changedOptions.Options = []string{"slab", "shaker", "raised"}
	hash, err := FurnitureParameterDefinitionHash([]FurnitureParameterDefinition{width, changedOptions})
	if err != nil {
		t.Fatal(err)
	}
	if hash == first {
		t.Fatalf("changing enum options reused definition hash %s", hash)
	}
}

func TestFurnitureParameterDefinitionHashRejectsInvalidDefinitions(t *testing.T) {
	_, err := FurnitureParameterDefinitionHash([]FurnitureParameterDefinition{{Name: "bad", Label: "Bad", Type: FurnitureParameterTypeEnum, Category: FurnitureParameterCategoryStyle}})
	if err == nil {
		t.Fatal("expected invalid definition error")
	}
	if _, ok := err.(*FurnitureParameterDefinitionsError); !ok {
		t.Fatalf("expected typed definition error, got %T", err)
	}
}

func numberDefinition(name string, defaultValue float64, min, max, step *float64) FurnitureParameterDefinition {
	return FurnitureParameterDefinition{
		Name:         name,
		Label:        name,
		Type:         FurnitureParameterTypeNumber,
		DefaultValue: defaultValue,
		Unit:         FurnitureParameterUnitMM,
		Category:     FurnitureParameterCategoryDimension,
		Min:          min,
		Max:          max,
		Step:         step,
	}
}

func scalarDefinition(name string, parameterType FurnitureParameterType, defaultValue any) FurnitureParameterDefinition {
	return FurnitureParameterDefinition{
		Name:         name,
		Label:        name,
		Type:         parameterType,
		DefaultValue: defaultValue,
		Category:     FurnitureParameterCategoryConfiguration,
	}
}

func enumDefinition(name, defaultValue string, options []string) FurnitureParameterDefinition {
	return FurnitureParameterDefinition{
		Name:         name,
		Label:        name,
		Type:         FurnitureParameterTypeEnum,
		DefaultValue: defaultValue,
		Category:     FurnitureParameterCategoryStyle,
		Options:      options,
	}
}

func hasDefinitionIssueField(issues []FurnitureParameterDefinitionIssue, field string) bool {
	for _, issue := range issues {
		if issue.Field == field {
			return true
		}
	}
	return false
}
