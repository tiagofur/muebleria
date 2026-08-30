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
