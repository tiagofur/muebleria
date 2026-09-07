package engine

import (
	"fmt"
	"math"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ResolvedReleaseUnit preserves physical identity around the existing BOM engine.
// It is not a persisted snapshot, collection deduplication or machining proof.
type ResolvedReleaseUnit struct {
	FurnitureInstanceID   string
	FurnitureDefinitionID string
	EvaluatedParameters   map[string]any
	BOM                   domain.ResolvedBom
}

// ResolveReleaseUnit resolves one unversioned revision item from an already
// tenant-scoped catalog. Callers must capture that catalog and result atomically;
// this pure function does not make a mutable catalog historically authoritative.
func ResolveReleaseUnit(item domain.DesignRevisionItem, catalog domain.Catalog) (*ResolvedReleaseUnit, error) {
	if strings.TrimSpace(item.FurnitureInstanceID) == "" || strings.TrimSpace(item.FurnitureDefinitionID) == "" {
		return nil, fmt.Errorf("release unit requires physical and definition identities")
	}
	if item.DefinitionVersion != nil {
		return nil, fmt.Errorf("release unit definition version requires unsupported historical catalog resolution")
	}
	var module domain.Module
	matches := 0
	for _, candidate := range catalog.Modules {
		if candidate.ID == item.FurnitureDefinitionID {
			module = candidate
			matches++
		}
	}
	if matches != 1 {
		return nil, fmt.Errorf("release unit requires exactly one matching definition")
	}
	if issues := domain.ValidatePersistedFurnitureParameterDefinitions(module.ParameterDefinitions); len(issues) > 0 {
		return nil, &domain.FurnitureParameterDefinitionsError{Issues: issues}
	}
	if issues := domain.ValidateModuleFurnitureParameterConsumers(module, catalog); len(issues) > 0 {
		return nil, &domain.FurnitureParameterDefinitionsError{Issues: issues}
	}
	targets := map[string]bool{}
	for _, definition := range module.ParameterDefinitions {
		if definition.Binding != nil {
			if targets[definition.Binding.ComponentID] {
				return nil, fmt.Errorf("release unit has competing consumers for component %s", definition.Binding.ComponentID)
			}
			targets[definition.Binding.ComponentID] = true
		}
		if definition.Binding != nil && definition.Binding.Relationship != nil {
			return nil, fmt.Errorf("release unit does not materialize relationship binding %s", definition.Name)
		}
	}
	definitions := append([]domain.FurnitureParameterDefinition(nil), module.ParameterDefinitions...)
	definitions = append(definitions, domain.ProjectFurnitureDimensionParameters()...)
	values, issues, err := domain.EvaluateFurnitureParameters(definitions, item.Parameters)
	if err != nil {
		return nil, err
	}
	if len(issues) > 0 {
		return nil, fmt.Errorf("invalid release unit parameters: %v", issues)
	}
	var dims *domain.ItemCustomDims
	if strings.TrimSpace(module.StructureID) != "" {
		dimensions := make([]int, 0, 3)
		for _, name := range []string{"widthMm", "heightMm", "depthMm"} {
			value, ok := item.Parameters[name].(float64)
			if !ok || !releaseUnitSafeInteger(value) || value <= 0 {
				return nil, fmt.Errorf("release unit requires explicit positive integer %s", name)
			}
			dimensions = append(dimensions, int(value))
		}
		dims = &domain.ItemCustomDims{WidthMm: dimensions[0], HeightMm: dimensions[1], DepthMm: dimensions[2]}
	} else {
		for _, name := range []string{"widthMm", "heightMm", "depthMm"} {
			if _, present := item.Parameters[name]; present {
				return nil, fmt.Errorf("fixed release unit does not support dimension overrides")
			}
		}
		// Fixed modules do not expand component consumers or parametric bases.
		if len(module.Components) > 0 || len(module.Agregados) > 0 || (module.BaseMode != "" && module.BaseMode != "none") {
			return nil, fmt.Errorf("fixed release unit requires fixed board parts without composition or base synthesis")
		}
	}
	for _, definition := range module.ParameterDefinitions {
		if definition.Binding != nil && definition.Binding.Kind == domain.FurnitureParameterBindingComponentQuantity {
			value, ok := values[definition.Name].(float64)
			if !ok || !releaseUnitSafeInteger(value) || value < 0 {
				return nil, fmt.Errorf("release unit requires a safe component quantity for %s", definition.Name)
			}
		}
	}
	prepared := ApplyEvaluatedComponentBindings(module, values)
	bom, err := ResolveBomWithContext(prepared, item.MaterialChoices, catalog, nil, "", nil, dims)
	if err != nil {
		return nil, err
	}
	if err := validateReleaseUnitChoices(prepared, item.MaterialChoices, catalog, bom); err != nil {
		return nil, err
	}
	return &ResolvedReleaseUnit{FurnitureInstanceID: item.FurnitureInstanceID,
		FurnitureDefinitionID: module.ID, EvaluatedParameters: values, BOM: bom}, nil
}

func releaseUnitSafeInteger(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && math.Trunc(value) == value &&
		math.Abs(value) <= math.Min(9007199254740991, float64(int(^uint(0)>>1)))
}

// Only choices consumed by the resolved definition are accepted. Reuse the
// engine's explicit front-alias table; never infer role semantics from names.
func validateReleaseUnitChoices(module domain.Module, choices map[string]string, catalog domain.Catalog, bom domain.ResolvedBom) error {
	consumed := map[string]string{}
	for _, part := range bom.BoardParts {
		role := part.OptionRole
		if strings.TrimSpace(choices[role]) == "" {
			for _, alias := range legacyFrontAliasTargets(role) {
				if strings.TrimSpace(choices[alias]) != "" {
					role = alias
					break
				}
			}
		}
		consumed[role] = part.MaterialID
		if part.EdgeBandID != "" {
			consumed["EDGE"] = part.EdgeBandID
		}
	}
	for _, line := range collectAllHardwareLines(module, catalog) {
		if line.HardwareID == "" {
			for _, resolved := range bom.HardwareLines {
				if resolved.ID == line.ID {
					consumed[line.OptionRole] = resolved.HardwareID
				}
			}
		}
	}
	for role, id := range choices {
		if role == "" || id == "" || consumed[role] != id {
			return fmt.Errorf("release unit choice %s is not consumed by the resolved definition", role)
		}
	}
	return nil
}
