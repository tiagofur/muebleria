package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"
)

type FurnitureParameterDefinitionBoundary string

const (
	FurnitureParameterDefinitionBoundaryPersisted FurnitureParameterDefinitionBoundary = "persisted"
	FurnitureParameterDefinitionBoundaryPublished FurnitureParameterDefinitionBoundary = "published"
)

func DecodeFurnitureParameterDefinitions(raw []byte, boundary FurnitureParameterDefinitionBoundary) ([]FurnitureParameterDefinition, error) {
	definitions := []FurnitureParameterDefinition{}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&definitions); err != nil {
		return nil, &FurnitureParameterDefinitionsError{Issues: []FurnitureParameterDefinitionIssue{{Field: "definitions", Message: "invalid JSON: " + err.Error()}}}
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, &FurnitureParameterDefinitionsError{Issues: []FurnitureParameterDefinitionIssue{{Field: "definitions", Message: "must contain exactly one JSON array"}}}
	}
	issues := ValidatePublishedFurnitureParameterDefinitions(definitions)
	if boundary == FurnitureParameterDefinitionBoundaryPersisted {
		issues = ValidatePersistedFurnitureParameterDefinitions(definitions)
	}
	if len(issues) > 0 {
		return nil, &FurnitureParameterDefinitionsError{Issues: issues}
	}
	return definitions, nil
}

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
	FurnitureParameterCategoryMetadata      FurnitureParameterCategory = "metadata"
)

const (
	MaxFurnitureParameterDefinitions         = 64
	MaxFurnitureParameterNameLength          = 64
	MaxFurnitureParameterLabelLength         = 160
	MaxFurnitureParameterOptions             = 64
	MaxFurnitureParameterOptionLength        = 128
	MaxFurnitureParameterStringLength        = 512
	MaxFurnitureParameterReceivedValueLength = 128
)

const (
	FurnitureParameterBindingVersion            = 1
	FurnitureParameterBindingComponentQuantity  = "componentQuantity"
	FurnitureParameterBindingComponentCondition = "componentCondition"
	FurnitureParameterBindingDimensionColumn    = "dimensionColumn"
)

// FurnitureParameterBinding declares the authoritative consumer of a value.
// Persisted parameters must either carry a versioned binding or explicitly be
// metadata. Dimension-column bindings are projection-only and may never be
// stored in modules.parameter_definitions.
type FurnitureParameterBinding struct {
	Version      int                                    `json:"version"`
	Kind         string                                 `json:"kind"`
	ComponentID  string                                 `json:"componentId,omitempty"`
	Dimension    string                                 `json:"dimension,omitempty"`
	Relationship *FurnitureParameterRelationshipBinding `json:"relationship,omitempty"`
}

type FurnitureParameterRelationshipBinding struct {
	Kind       string                                 `json:"kind"`
	SourceRole string                                 `json:"sourceRole"`
	Targets    []FurnitureParameterRelationshipTarget `json:"targets"`
}

type FurnitureParameterRelationshipTarget struct {
	ComponentID string `json:"componentId"`
	Role        string `json:"role"`
}

type FurnitureParameterDefinition struct {
	Name         string                     `json:"name"`
	Label        string                     `json:"label"`
	SortOrder    int                        `json:"sortOrder,omitempty"`
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
	MaxLength    *int                       `json:"maxLength,omitempty"`
	Binding      *FurnitureParameterBinding `json:"binding,omitempty"`
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
	FurnitureParameterUnknown       FurnitureParameterIssueCode = "PARAMETER_UNKNOWN"
	FurnitureParameterRequired      FurnitureParameterIssueCode = "PARAMETER_REQUIRED"
	FurnitureParameterTypeInvalid   FurnitureParameterIssueCode = "PARAMETER_TYPE_INVALID"
	FurnitureParameterOutOfRange    FurnitureParameterIssueCode = "PARAMETER_OUT_OF_RANGE"
	FurnitureParameterStepInvalid   FurnitureParameterIssueCode = "PARAMETER_STEP_INVALID"
	FurnitureParameterEnumInvalid   FurnitureParameterIssueCode = "PARAMETER_ENUM_INVALID"
	FurnitureParameterStringTooLong FurnitureParameterIssueCode = "PARAMETER_STRING_TOO_LONG"
)

type FurnitureParameterIssue struct {
	Code      FurnitureParameterIssueCode `json:"code"`
	Parameter string                      `json:"parameter"`
	Message   string                      `json:"message"`
	Details   map[string]any              `json:"details,omitempty"`
}

func ValidateFurnitureParameterDefinitions(definitions []FurnitureParameterDefinition) []FurnitureParameterDefinitionIssue {
	issues := make([]FurnitureParameterDefinitionIssue, 0)
	seen := make(map[string]struct{}, len(definitions))
	if len(definitions) > MaxFurnitureParameterDefinitions {
		issues = append(issues, FurnitureParameterDefinitionIssue{Field: "definitions", Message: fmt.Sprintf("must contain at most %d entries", MaxFurnitureParameterDefinitions)})
	}

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
		if len([]rune(name)) > MaxFurnitureParameterNameLength {
			add("name", fmt.Sprintf("must contain at most %d characters", MaxFurnitureParameterNameLength))
		}
		if strings.TrimSpace(definition.Label) == "" {
			add("label", "must be non-empty")
		}
		if len([]rune(definition.Label)) > MaxFurnitureParameterLabelLength {
			add("label", fmt.Sprintf("must contain at most %d characters", MaxFurnitureParameterLabelLength))
		}
		if definition.SortOrder < 0 {
			add("sortOrder", "must be greater than or equal to zero")
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
		if definition.Type == FurnitureParameterTypeString {
			if definition.MaxLength == nil {
				add("maxLength", "is required for string parameters")
			} else if *definition.MaxLength < 1 || *definition.MaxLength > MaxFurnitureParameterStringLength {
				add("maxLength", fmt.Sprintf("must be between 1 and %d", MaxFurnitureParameterStringLength))
			}
		} else if definition.MaxLength != nil {
			add("maxLength", "requires type string")
		}

		if definition.Type == FurnitureParameterTypeEnum {
			if len(definition.Options) == 0 {
				add("options", "enum requires at least one option")
			}
			optionSeen := make(map[string]struct{}, len(definition.Options))
			if len(definition.Options) > MaxFurnitureParameterOptions {
				add("options", fmt.Sprintf("must contain at most %d entries", MaxFurnitureParameterOptions))
			}
			for _, option := range definition.Options {
				if option == "" {
					add("options", "enum options must be non-empty")
				}
				if len([]rune(option)) > MaxFurnitureParameterOptionLength {
					add("options", fmt.Sprintf("each option must contain at most %d characters", MaxFurnitureParameterOptionLength))
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

func EvaluateFurnitureParameters(definitions []FurnitureParameterDefinition, provided map[string]any) (map[string]any, []FurnitureParameterIssue, error) {
	if definitionIssues := ValidateFurnitureParameterDefinitions(definitions); len(definitionIssues) != 0 {
		return nil, nil, &FurnitureParameterDefinitionsError{Issues: definitionIssues}
	}

	ordered := sortedFurnitureParameterDefinitions(definitions)
	declared := make(map[string]FurnitureParameterDefinition, len(ordered))
	for _, definition := range ordered {
		declared[definition.Name] = definition
	}

	issues := make([]FurnitureParameterIssue, 0)
	unknown := make([]string, 0)
	for name := range provided {
		if _, ok := declared[name]; !ok {
			unknown = append(unknown, name)
		}
	}
	sort.Strings(unknown)
	for _, name := range unknown {
		issues = append(issues, FurnitureParameterIssue{Code: FurnitureParameterUnknown, Parameter: name, Message: "parameter is not declared by the furniture definition"})
	}

	normalized := make(map[string]any, len(ordered))
	for _, definition := range ordered {
		value, present := provided[definition.Name]
		if !present {
			if definition.DefaultValue != nil {
				normalized[definition.Name] = definition.DefaultValue
			} else if definition.Required {
				issues = append(issues, furnitureParameterIssue(FurnitureParameterRequired, definition, nil))
			}
			continue
		}

		if code := validateFurnitureParameterValue(definition, value); code != "" {
			issues = append(issues, furnitureParameterIssue(code, definition, value))
			continue
		}
		normalized[definition.Name] = value
	}

	return normalized, issues, nil
}

func FurnitureParameterDefinitionHash(definitions []FurnitureParameterDefinition) (string, error) {
	if issues := ValidateFurnitureParameterDefinitions(definitions); len(issues) != 0 {
		return "", &FurnitureParameterDefinitionsError{Issues: issues}
	}

	var payload bytes.Buffer
	encoder := json.NewEncoder(&payload)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(sortedFurnitureParameterDefinitions(definitions)); err != nil {
		return "", fmt.Errorf("encode furniture parameter definitions: %w", err)
	}
	canonical := bytes.TrimSuffix(payload.Bytes(), []byte("\n"))
	sum := sha256.Sum256(canonical)
	return fmt.Sprintf("sha256-%x", sum), nil
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
		text, ok := value.(string)
		if !ok {
			return FurnitureParameterTypeInvalid
		}
		if definition.MaxLength != nil && len([]rune(text)) > *definition.MaxLength {
			return FurnitureParameterStringTooLong
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

func furnitureParameterIssue(code FurnitureParameterIssueCode, definition FurnitureParameterDefinition, value any) FurnitureParameterIssue {
	messages := map[FurnitureParameterIssueCode]string{
		FurnitureParameterUnknown:       "parameter is not declared by the furniture definition",
		FurnitureParameterRequired:      "required parameter is missing and has no default",
		FurnitureParameterTypeInvalid:   "parameter value has the wrong JSON type",
		FurnitureParameterOutOfRange:    "numeric parameter is outside its allowed range",
		FurnitureParameterStepInvalid:   "numeric parameter does not align with its allowed step",
		FurnitureParameterEnumInvalid:   "enum parameter is not one of its allowed options",
		FurnitureParameterStringTooLong: "string parameter exceeds its allowed length",
	}
	details := map[string]any{"expectedType": string(definition.Type)}
	if value != nil {
		details["receivedType"] = furnitureParameterJSONType(value)
	}
	if definition.Min != nil {
		details["min"] = *definition.Min
	}
	if definition.Max != nil {
		details["max"] = *definition.Max
	}
	if definition.Step != nil {
		details["step"] = *definition.Step
	}
	if len(definition.Options) > 0 {
		details["allowedOptions"] = append([]string(nil), definition.Options...)
	}
	if definition.Integer {
		details["integer"] = true
	}
	if definition.MaxLength != nil {
		details["maxLength"] = *definition.MaxLength
	}
	if received, ok := safeFurnitureParameterReceivedValue(value); ok {
		details["receivedValue"] = received
	}
	return FurnitureParameterIssue{Code: code, Parameter: definition.Name, Message: messages[code], Details: details}
}

func validateFurnitureParameterBinding(definition FurnitureParameterDefinition, add func(string, string)) {
	if definition.Category == FurnitureParameterCategoryMetadata {
		if definition.Binding != nil {
			add("binding", "metadata parameters must not declare an authoritative consumer")
		}
		return
	}
	if definition.Binding == nil {
		add("binding", "non-metadata parameters require an authoritative consumer")
		return
	}
	b := definition.Binding
	if b.Version != FurnitureParameterBindingVersion {
		add("binding.version", "must be 1")
	}
	switch b.Kind {
	case FurnitureParameterBindingComponentQuantity:
		if definition.Type != FurnitureParameterTypeNumber || !definition.Integer {
			add("binding.kind", "componentQuantity requires an integer number parameter")
		}
		if strings.TrimSpace(b.ComponentID) == "" {
			add("binding.componentId", "is required for componentQuantity")
		}
		if b.Dimension != "" {
			add("binding.dimension", "is not allowed for componentQuantity")
		}
		if b.Relationship != nil {
			if strings.TrimSpace(b.Relationship.Kind) == "" {
				add("binding.relationship.kind", "is required")
			}
			if strings.TrimSpace(b.Relationship.SourceRole) == "" {
				add("binding.relationship.sourceRole", "is required")
			}
			if len(b.Relationship.Targets) == 0 {
				add("binding.relationship.targets", "must contain at least one target")
			}
			for _, target := range b.Relationship.Targets {
				if strings.TrimSpace(target.ComponentID) == "" || strings.TrimSpace(target.Role) == "" {
					add("binding.relationship.targets", "componentId and role are required")
				}
			}
		}
	case FurnitureParameterBindingComponentCondition:
		if definition.Type != FurnitureParameterTypeBoolean {
			add("binding.kind", "componentCondition requires a boolean parameter")
		}
		if strings.TrimSpace(b.ComponentID) == "" {
			add("binding.componentId", "is required for componentCondition")
		}
		if b.Dimension != "" || b.Relationship != nil {
			add("binding", "componentCondition cannot declare dimension or relationship")
		}
	case FurnitureParameterBindingDimensionColumn:
		if definition.Type != FurnitureParameterTypeNumber || !definition.Integer || definition.Unit != FurnitureParameterUnitMM {
			add("binding.kind", "dimensionColumn requires an integer millimeter number parameter")
		}
		if b.Dimension != definition.Name || !IsReservedFurnitureDimensionName(b.Dimension) {
			add("binding.dimension", "must match widthMm, heightMm, or depthMm")
		}
		if b.ComponentID != "" || b.Relationship != nil {
			add("binding", "dimensionColumn cannot target composition")
		}
	default:
		add("binding.kind", "must be componentQuantity, componentCondition, or dimensionColumn")
	}
}

func IsReservedFurnitureDimensionName(name string) bool {
	return name == "widthMm" || name == "heightMm" || name == "depthMm"
}

// ValidatePersistedFurnitureParameterDefinitions rejects projection-owned
// dimensions so width/height/depth keep a single source of truth: module columns.
func ValidatePersistedFurnitureParameterDefinitions(definitions []FurnitureParameterDefinition) []FurnitureParameterDefinitionIssue {
	issues := ValidateFurnitureParameterDefinitions(definitions)
	for _, definition := range definitions {
		add := func(field, message string) {
			issues = append(issues, FurnitureParameterDefinitionIssue{Parameter: definition.Name, Field: field, Message: message})
		}
		validateFurnitureParameterBinding(definition, add)
		if IsReservedFurnitureDimensionName(definition.Name) {
			issues = append(issues, FurnitureParameterDefinitionIssue{Parameter: definition.Name, Field: "name", Message: "is reserved for the module dimension column projection"})
		}
		if definition.Binding != nil && definition.Binding.Kind == FurnitureParameterBindingDimensionColumn {
			issues = append(issues, FurnitureParameterDefinitionIssue{Parameter: definition.Name, Field: "binding.kind", Message: "dimensionColumn is projection-only"})
		}
	}
	return issues
}

// ValidatePublishedFurnitureParameterDefinitions applies consumer validation
// after projection has added its dimension-column definitions.
func ValidatePublishedFurnitureParameterDefinitions(definitions []FurnitureParameterDefinition) []FurnitureParameterDefinitionIssue {
	issues := ValidateFurnitureParameterDefinitions(definitions)
	for _, definition := range definitions {
		add := func(field, message string) {
			issues = append(issues, FurnitureParameterDefinitionIssue{Parameter: definition.Name, Field: field, Message: message})
		}
		validateFurnitureParameterBinding(definition, add)
	}
	return issues
}

func furnitureParameterJSONType(value any) string {
	switch value.(type) {
	case float64:
		return "number"
	case string:
		return "string"
	case bool:
		return "boolean"
	case nil:
		return "null"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		return fmt.Sprintf("%T", value)
	}
}

func safeFurnitureParameterReceivedValue(value any) (any, bool) {
	switch typed := value.(type) {
	case string:
		runes := []rune(typed)
		if len(runes) > MaxFurnitureParameterReceivedValueLength {
			return string(runes[:MaxFurnitureParameterReceivedValueLength]) + "…", true
		}
		return typed, true
	case float64, bool:
		return typed, true
	case nil:
		return nil, true
	default:
		return nil, false
	}
}

func sortedFurnitureParameterDefinitions(definitions []FurnitureParameterDefinition) []FurnitureParameterDefinition {
	ordered := append([]FurnitureParameterDefinition(nil), definitions...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].SortOrder != ordered[j].SortOrder {
			return ordered[i].SortOrder < ordered[j].SortOrder
		}
		return ordered[i].Name < ordered[j].Name
	})
	return ordered
}

// ValidateModuleFurnitureParameterConsumers proves every declared binding
// points at composition that this module can actually resolve.
func ValidateModuleFurnitureParameterConsumers(module Module, catalog Catalog) []FurnitureParameterDefinitionIssue {
	issues := []FurnitureParameterDefinitionIssue{}
	directEntries := map[string]int{}
	allEntries := map[string]int{}
	occurrences := map[string]int{}
	note := func(instance ComponentInstance, direct bool) {
		allEntries[instance.ComponentID]++
		quantity := instance.Quantity
		if quantity <= 0 {
			quantity = 1
		}
		occurrences[instance.ComponentID] += quantity
		if direct {
			directEntries[instance.ComponentID]++
		}
	}
	for _, instance := range module.Components {
		note(instance, true)
	}
	if module.StructureID != "" {
		for _, structure := range catalog.Structures {
			if structure.ID != module.StructureID {
				continue
			}
			for _, instance := range structure.Components {
				note(instance, false)
			}
			break
		}
	}
	for _, definition := range module.ParameterDefinitions {
		binding := definition.Binding
		if binding == nil || (binding.Kind != FurnitureParameterBindingComponentQuantity && binding.Kind != FurnitureParameterBindingComponentCondition) {
			continue
		}
		if directEntries[binding.ComponentID] != 1 || allEntries[binding.ComponentID] != 1 {
			issues = append(issues, FurnitureParameterDefinitionIssue{Parameter: definition.Name, Field: "binding.componentId", Message: "must reference exactly one unambiguous component entry placed directly on the module"})
		}
		if binding.Relationship == nil {
			continue
		}
		for _, target := range binding.Relationship.Targets {
			if allEntries[target.ComponentID] != 1 || occurrences[target.ComponentID] != 1 {
				issues = append(issues, FurnitureParameterDefinitionIssue{Parameter: definition.Name, Field: "binding.relationship.targets", Message: "must reference exactly one unambiguous component occurrence in the module composition"})
			}
		}
	}
	return issues
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
	case FurnitureParameterCategoryDimension, FurnitureParameterCategoryConfiguration, FurnitureParameterCategoryStyle, FurnitureParameterCategoryHardware, FurnitureParameterCategoryMetadata:
		return true
	default:
		return false
	}
}
