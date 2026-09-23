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
	// #793 — module industrial identity frozen at resolve time (same catalog
	// read as the BOM): the r5 PTX label route serializes THESE, never a
	// live re-read. Zero/empty values (older snapshots) mean the identity was
	// not frozen — consumers fail closed instead of substituting the catalog.
	ModuleCode     string
	ModuleName     string
	ModuleWidthMm  int
	ModuleHeightMm int
	ModuleDepthMm  int
}

// ResolveReleaseUnit resolves one unversioned revision item from an already
// tenant-scoped catalog. Callers must capture that catalog and result atomically;
// this pure function does not make a mutable catalog historically authoritative.
func ResolveReleaseUnit(item domain.DesignRevisionItem, catalog domain.Catalog) (*ResolvedReleaseUnit, error) {
	return resolveReleaseUnit(item, catalog, nil)
}

func resolveReleaseUnit(item domain.DesignRevisionItem, catalog domain.Catalog, collection *releaseExpansionBudget) (*ResolvedReleaseUnit, error) {
	return resolveReleaseUnitOpt(item, catalog, collection, true)
}

// resolveReleaseUnitOpt with strictChoices=false skips the choices≡consumed
// tail validation: the #826 consumption helpers resolve with the FULL
// commercial seed (extra roles included) to derive the consumed set, then let
// callers intersect or reject explicitly.
func resolveReleaseUnitOpt(item domain.DesignRevisionItem, catalog domain.Catalog, collection *releaseExpansionBudget, strictChoices bool) (*ResolvedReleaseUnit, error) {
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
	if err := validateReleaseUnitExpansion(prepared, catalog, collection); err != nil {
		return nil, fmt.Errorf("release unit expansion: %w", err)
	}
	// #727: publishedDesignAuthority — the item's explicit dimensions are the
	// manufacturing truth; commercial measure presets are not consulted.
	bom, err := ResolveBomForRelease(prepared, item.MaterialChoices, catalog, dims)
	if err != nil {
		return nil, err
	}
	if strictChoices {
		if err := validateReleaseUnitChoices(prepared, item.MaterialChoices, catalog, bom); err != nil {
			return nil, err
		}
	}
	// #793 — freeze the module's industrial identity with the same catalog
	// read that resolved the BOM. Effective dims: the item's explicit
	// dimensions when the unit is parametric, else the definition's declared
	// dims (0 = not declared → empty optional cells downstream).
	widthMm, heightMm, depthMm := module.WidthMm, module.HeightMm, module.DepthMm
	if dims != nil {
		widthMm, heightMm, depthMm = dims.WidthMm, dims.HeightMm, dims.DepthMm
	}
	return &ResolvedReleaseUnit{FurnitureInstanceID: item.FurnitureInstanceID,
		FurnitureDefinitionID: module.ID, EvaluatedParameters: values, BOM: bom,
		ModuleCode: module.Code, ModuleName: module.Name,
		ModuleWidthMm: widthMm, ModuleHeightMm: heightMm, ModuleDepthMm: depthMm}, nil
}

func releaseUnitSafeInteger(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && math.Trunc(value) == value &&
		math.Abs(value) <= math.Min(9007199254740991, float64(int(^uint(0)>>1)))
}

// ConsumedOptionRoles is the single source of truth for "which option roles
// the resolved definition actually consumes" (#826). The release gate below
// and every seeding/materialization surface derive from THIS function so their
// verdicts can never diverge. Keys are the effective choice roles — the direct
// part role, or the legacy alias that satisfied it — and EDGE appears only
// when a resolved board part carries edges.
func ConsumedOptionRoles(module domain.Module, choices map[string]string, catalog domain.Catalog, bom domain.ResolvedBom) map[string]string {
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
	return consumed
}

// Only choices consumed by the resolved definition are accepted. Reuse the
// engine's explicit front-alias table; never infer role semantics from names.
func validateReleaseUnitChoices(module domain.Module, choices map[string]string, catalog domain.Catalog, bom domain.ResolvedBom) error {
	consumed := ConsumedOptionRoles(module, choices, catalog, bom)
	for role, id := range choices {
		if role == "" || id == "" || consumed[role] != id {
			return fmt.Errorf("release unit choice %s is not consumed by the resolved definition", role)
		}
	}
	return nil
}
