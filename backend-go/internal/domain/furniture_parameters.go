package domain

import (
	"fmt"
	"math"
	"strings"
)

type FurnitureParameterType string

const (
	FurnitureParameterTypeNumber  FurnitureParameterType = "number"
	FurnitureParameterTypeString  FurnitureParameterType = "string"
	FurnitureParameterTypeBoolean FurnitureParameterType = "boolean"
	FurnitureParameterTypeEnum    FurnitureParameterType = "enum"
)

type FurnitureParameterUnit string

const (
	FurnitureParameterUnitMM    FurnitureParameterUnit = "mm"
	FurnitureParameterUnitDeg   FurnitureParameterUnit = "deg"
	FurnitureParameterUnitCount FurnitureParameterUnit = "count"
)

type FurnitureParameterCategory string

const (
	FurnitureParameterCategoryDimension     FurnitureParameterCategory = "dimension"
	FurnitureParameterCategoryConfiguration FurnitureParameterCategory = "configuration"
	FurnitureParameterCategoryStyle         FurnitureParameterCategory = "style"
	FurnitureParameterCategoryHardware      FurnitureParameterCategory = "hardware"
)

type FurnitureParameterDefinition struct {
	Name         string                     `json:"name"`
	Label        string                     `json:"label"`
	Type         FurnitureParameterType     `json:"type"`
	DefaultValue any                        `json:"defaultValue,omitempty"`
	Required     bool                       `json:"required"`
	Unit         FurnitureParameterUnit     `json:"unit,omitempty"`
	Category     FurnitureParameterCategory `json:"category"`
	Min          *float64                   `json:"min,omitempty"`
	Max          *float64                   `json:"max,omitempty"`
	Step         *float64                   `json:"step,omitempty"`
	Options      []string                   `json:"options,omitempty"`
	Integer      bool                       `json:"integer,omitempty"`
}

type FurnitureParameterDefinitionIssue struct {
	Parameter string `json:"parameter,omitempty"`
	Field     string `json:"field"`
	Message   string `json:"message"`
}

type FurnitureParameterDefinitionsError struct {
	Issues []FurnitureParameterDefinitionIssue
}

func (e *FurnitureParameterDefinitionsError) Error() string {
	if e == nil || len(e.Issues) == 0 {
		return "invalid furniture parameter definitions"
	}
	issue := e.Issues[0]
	if issue.Parameter == "" {
		return fmt.Sprintf("invalid furniture parameter definitions: %s: %s", issue.Field, issue.Message)
	}
	return fmt.Sprintf("invalid furniture parameter definition %q: %s: %s", issue.Parameter, issue.Field, issue.Message)
}

type FurnitureParameterIssueCode string

const (
	FurnitureParameterUnknown     FurnitureParameterIssueCode = "PARAMETER_UNKNOWN"
	FurnitureParameterRequired    FurnitureParameterIssueCode = "PARAMETER_REQUIRED"
	FurnitureParameterTypeInvalid FurnitureParameterIssueCode = "PARAMETER_TYPE_INVALID"
	FurnitureParameterOutOfRange  FurnitureParameterIssueCode = "PARAMETER_OUT_OF_RANGE"
	FurnitureParameterStepInvalid FurnitureParameterIssueCode = "PARAMETER_STEP_INVALID"
	FurnitureParameterEnumInvalid FurnitureParameterIssueCode = "PARAMETER_ENUM_INVALID"
)

func ValidateFurnitureParameterDefinitions(definitions []FurnitureParameterDefinition) []FurnitureParameterDefinitionIssue {
	issues := make([]FurnitureParameterDefinitionIssue, 0)
	seen := make(map[string]struct{}, len(definitions))

	for _, definition := range definitions {
		name := definition.Name
		add := func(field, message string) {
			issues = append(issues, FurnitureParameterDefinitionIssue{Parameter: name, Field: field, Message: message})
		}

		if name == "" || strings.TrimSpace(name) != name {
			add("name", "must be non-empty and must not have surrounding whitespace")
		} else if _, ok := seen[name]; ok {
			add("name", "must be unique")
		} else {
			seen[name] = struct{}{}
		}
		if strings.TrimSpace(definition.Label) == "" {
			add("label", "must be non-empty")
		}
		if !validFurnitureParameterType(definition.Type) {
			add("type", "must be number, string, boolean, or enum")
		}
		if !validFurnitureParameterUnit(definition.Unit) {
			add("unit", "must be mm, deg, count, or omitted")
		}
		if !validFurnitureParameterCategory(definition.Category) {
			add("category", "must be dimension, configuration, style, or hardware")
		}

		if definition.Type == FurnitureParameterTypeNumber {
			validateNumericDefinition(definition, add)
		} else {
			if definition.Min != nil || definition.Max != nil || definition.Step != nil {
				add("min|max|step", "numeric constraints require type number")
			}
			if definition.Integer {
				add("integer", "integer requires type number")
			}
			if definition.Unit != "" {
				add("unit", "unit requires type number")
			}
		}

		if definition.Type == FurnitureParameterTypeEnum {
			if len(definition.Options) == 0 {
				add("options", "enum requires at least one option")
			}
			optionSeen := make(map[string]struct{}, len(definition.Options))
			for _, option := range definition.Options {
				if option == "" {
					add("options", "enum options must be non-empty")
				}
				if _, ok := optionSeen[option]; ok {
					add("options", "enum options must be unique")
				}
				optionSeen[option] = struct{}{}
			}
		} else if len(definition.Options) != 0 {
			add("options", "options require type enum")
		}

		if definition.DefaultValue != nil {
			if code := validateFurnitureParameterValue(definition, definition.DefaultValue); code != "" {
				add("defaultValue", "must satisfy the parameter type and constraints")
			}
		}
	}

	return issues
}

func validateNumericDefinition(definition FurnitureParameterDefinition, add func(string, string)) {
	constraints := []struct {
		field string
		value *float64
	}{
		{field: "min", value: definition.Min},
		{field: "max", value: definition.Max},
		{field: "step", value: definition.Step},
	}
	for _, constraint := range constraints {
		if constraint.value != nil && (math.IsNaN(*constraint.value) || math.IsInf(*constraint.value, 0)) {
			add(constraint.field, "must be finite")
		}
	}
	if definition.Min != nil && definition.Max != nil && *definition.Min > *definition.Max {
		add("min|max", "min must be less than or equal to max")
	}
	if definition.Step != nil && *definition.Step <= 0 {
		add("step", "must be greater than zero")
	}
	if definition.Unit == FurnitureParameterUnitCount && !definition.Integer {
		add("integer", "count parameters must be integer")
	}
}

func validateFurnitureParameterValue(definition FurnitureParameterDefinition, value any) FurnitureParameterIssueCode {
	switch definition.Type {
	case FurnitureParameterTypeNumber:
		number, ok := value.(float64)
		if !ok || math.IsNaN(number) || math.IsInf(number, 0) {
			return FurnitureParameterTypeInvalid
		}
		if definition.Integer && number != math.Trunc(number) {
			return FurnitureParameterTypeInvalid
		}
		if definition.Min != nil && number < *definition.Min || definition.Max != nil && number > *definition.Max {
			return FurnitureParameterOutOfRange
		}
		if definition.Step != nil {
			origin := 0.0
			if definition.Min != nil {
				origin = *definition.Min
			}
			quotient := (number - origin) / *definition.Step
			if math.Abs(quotient-math.Round(quotient)) > 1e-9*math.Max(1, math.Abs(quotient)) {
				return FurnitureParameterStepInvalid
			}
		}
	case FurnitureParameterTypeString:
		if _, ok := value.(string); !ok {
			return FurnitureParameterTypeInvalid
		}
	case FurnitureParameterTypeBoolean:
		if _, ok := value.(bool); !ok {
			return FurnitureParameterTypeInvalid
		}
	case FurnitureParameterTypeEnum:
		option, ok := value.(string)
		if !ok {
			return FurnitureParameterTypeInvalid
		}
		for _, allowed := range definition.Options {
			if option == allowed {
				return ""
			}
		}
		return FurnitureParameterEnumInvalid
	default:
		return FurnitureParameterTypeInvalid
	}
	return ""
}

func validFurnitureParameterType(parameterType FurnitureParameterType) bool {
	switch parameterType {
	case FurnitureParameterTypeNumber, FurnitureParameterTypeString, FurnitureParameterTypeBoolean, FurnitureParameterTypeEnum:
		return true
	default:
		return false
	}
}

func validFurnitureParameterUnit(unit FurnitureParameterUnit) bool {
	switch unit {
	case "", FurnitureParameterUnitMM, FurnitureParameterUnitDeg, FurnitureParameterUnitCount:
		return true
	default:
		return false
	}
}

func validFurnitureParameterCategory(category FurnitureParameterCategory) bool {
	switch category {
	case FurnitureParameterCategoryDimension, FurnitureParameterCategoryConfiguration, FurnitureParameterCategoryStyle, FurnitureParameterCategoryHardware:
		return true
	default:
		return false
	}
}
