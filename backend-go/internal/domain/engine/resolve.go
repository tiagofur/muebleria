package engine

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// dimensionAuthority names WHO owns a unit's dimensions on a resolve path
// (#727). It is an explicit boundary, not a boolean: the commercial flow and
// the manufacturing release flow read the same single engine with different
// authorities.
type dimensionAuthority int

const (
	// commercialPresetAuthority is the sales/quotation flow (H09 / #104):
	// Module.Presets drive size selection, so an exact measurePresetID is
	// mandatory for preset-bearing modules — even when custom dimensions
	// override the resolved size (stale ids fail loudly, TS parity).
	commercialPresetAuthority dimensionAuthority = iota
	// publishedDesignAuthority is the manufacturing release flow (#727): a
	// published DesignRevisionItem carries the frozen physical truth, so its
	// explicit custom dimensions are authoritative and commercial measure
	// presets are neither required nor consulted.
	publishedDesignAuthority
)

// ResolveBom validates a module and resolves material/edge/hardware IDs
// (mirrors packages/domain resolveBom).
//
// Dual path:
//   - composed: module.StructureID set → expand structure + module components
//   - legacy: use module.BoardParts as-is
//
// measurePresetID selects commercial size from Module.Presets (H09 / #104).
// Grain is inherited from material.
//
// structureRevisionPin (#108, Slice 2) optionally freezes the structure to a
// historical revision when the calling line item is part of a closed quote.
// It is the last variadic slot so existing callers stay source-compatible.
// Passing nil (or omitting it) resolves against the live structure.
func ResolveBom(
	module domain.Module,
	optionChoices map[string]string,
	catalog domain.Catalog,
	measurePresetID ...string,
) (domain.ResolvedBom, error) {
	presetID := ""
	if len(measurePresetID) > 0 {
		presetID = measurePresetID[0]
	}
	return resolveBomCommon(module, optionChoices, catalog, commercialPresetAuthority, presetID, nil, nil, nil)
}

// ResolveBomWithContext is the #442-aware canonical variant: it carries the
// quote-line base treatment context (item baseMode override + plan plinth
// height B + F088 side exposure). Mirrors TS resolveBom(..., baseContext).
// A nil context resolves with the module catalog defaults (still filtering
// ZOCLO components by the module's own base mode — TS parity).
func ResolveBomWithContext(
	module domain.Module,
	optionChoices map[string]string,
	catalog domain.Catalog,
	baseContext *BaseResolutionContext,
	measurePresetID string,
	structureRevisionPin *int,
	customDims *domain.ItemCustomDims,
) (domain.ResolvedBom, error) {
	return resolveBomCommon(module, optionChoices, catalog, commercialPresetAuthority, measurePresetID, structureRevisionPin, customDims, baseContext)
}

// ResolveBomWithDims is the F144-aware variant (#310 / P3D-7): customDims
// overrides the commercial preset W/H/D for composed (parametric) modules —
// mirrors TS resolveBom(..., dimsOverride). A non-composed module plus an
// override is rejected (it cannot honor arbitrary dims). The preset id is
// still validated so a stale measurePresetID fails loudly even with an
// override, exactly like the TS engine.
func ResolveBomWithDims(
	module domain.Module,
	optionChoices map[string]string,
	catalog domain.Catalog,
	measurePresetID string,
	structureRevisionPin *int,
	customDims *domain.ItemCustomDims,
) (domain.ResolvedBom, error) {
	return resolveBomCommon(module, optionChoices, catalog, commercialPresetAuthority, measurePresetID, structureRevisionPin, customDims, nil)
}

// ResolveBomForRelease resolves the BOM of an already-published design unit
// under publishedDesignAuthority (#727): the item's explicit dimensions are
// the manufacturing truth and commercial measure presets are not consulted,
// so a preset-bearing module releases from its exact recorded dimensions
// without a measurePresetId. Structured (parametric) modules MUST carry
// custom dimensions; fixed modules keep rejecting them. Every other
// validation — structure, components, formulas, materials, hardware,
// choices, base treatment — is the same single resolveBomCommon path: this
// is an authority boundary, not a second BOM engine.
func ResolveBomForRelease(
	module domain.Module,
	optionChoices map[string]string,
	catalog domain.Catalog,
	customDims *domain.ItemCustomDims,
) (domain.ResolvedBom, error) {
	return resolveBomCommon(module, optionChoices, catalog, publishedDesignAuthority, "", nil, customDims, nil)
}

// ResolveBomWithPin is the #108-aware variant of ResolveBom. It accepts an
// optional structureRevisionPin so closed-quote items can resolve against the
// exact structure revision they were quoted with. When pin is nil it behaves
// identically to ResolveBom. Mirrors TS resolveBom(item, ..., pin).
//
// Errors from a stale/unknown pin are returned as *StructureRevisionError so
// callers (e.g. quote breakdown) can surface them with context rather than
// silently falling back to live resolution.
func ResolveBomWithPin(
	module domain.Module,
	optionChoices map[string]string,
	catalog domain.Catalog,
	measurePresetID string,
	pin *int,
) (domain.ResolvedBom, error) {
	return resolveBomCommon(module, optionChoices, catalog, commercialPresetAuthority, measurePresetID, pin, nil, nil)
}

// resolveBomCommon is the single BOM path (#442): every exported variant
// delegates here so filtering, synthesis and base context cannot drift
// between entry points. Mirrors TS resolveBom: effective base mode/B →
// filter ZOCLO instances → expand → applyBaseTreatment → resolve ids.
func resolveBomCommon(
	module domain.Module,
	optionChoices map[string]string,
	catalog domain.Catalog,
	authority dimensionAuthority,
	measurePresetID string,
	structureRevisionPin *int,
	customDims *domain.ItemCustomDims,
	baseContext *BaseResolutionContext,
) (domain.ResolvedBom, error) {
	if err := ValidateModule(module); err != nil {
		return domain.ResolvedBom{}, err
	}
	if customDims != nil && strings.TrimSpace(module.StructureID) == "" {
		return domain.ResolvedBom{}, fmt.Errorf(
			"el mueble %q (%s) no es paramétrico; no admite medidas a medida",
			module.Name, module.Code,
		)
	}

	baseMode := ResolveBaseModeWithContext(module, baseContext)
	baseClearance := ResolveBaseClearanceWithContext(module, baseContext)

	var rawParts []domain.BoardPart
	widthMm, depthMm := 600, 560
	if strings.TrimSpace(module.StructureID) != "" {
		composed, dims, err := expandComposedModulePartsWithDims(module, catalog, authority, measurePresetID, structureRevisionPin, customDims, optionChoices, baseMode, baseClearance)
		if err != nil {
			return domain.ResolvedBom{}, err
		}
		rawParts = composed
		widthMm, depthMm = dims.W, dims.D
	} else {
		rawParts = module.BoardParts
		// TS parity (resolveBom non-composed dimsFallback): external dims if
		// present, else 600×720×560.
		if module.WidthMm > 0 {
			widthMm = module.WidthMm
		}
		if module.DepthMm > 0 {
			depthMm = module.DepthMm
		}
	}

	hardware := collectAllHardwareLines(module, catalog)
	var sides *PlinthSides
	if baseContext != nil {
		sides = baseContext.PlinthSides
	}
	treatedParts, treatedHardware := applyBaseTreatment(
		module.Code,
		rawParts,
		hardware,
		baseMode,
		baseClearance,
		widthMm,
		depthMm,
		sides,
		optionChoices,
	)
	return resolveBomFromParts(module, optionChoices, catalog, treatedParts, treatedHardware)
}

// resolveBomFromParts resolves material/edge/hardware IDs for already-expanded
// board parts and the (base-treated) hardware lines. Shared by every
// ResolveBom* variant so the paths cannot drift.
func resolveBomFromParts(
	module domain.Module,
	optionChoices map[string]string,
	catalog domain.Catalog,
	rawParts []domain.BoardPart,
	hardwareLines []domain.HardwareLine,
) (domain.ResolvedBom, error) {
	boardParts := make([]domain.ResolvedBoardPart, 0, len(rawParts))
	for _, part := range rawParts {
		material, err := ResolveMaterial(part, optionChoices, catalog.Materials)
		if err != nil {
			return domain.ResolvedBom{}, err
		}
		edgeBand, err := ResolveEdgeBand(part, *material, optionChoices, catalog.Edges)
		if err != nil {
			return domain.ResolvedBom{}, err
		}

		edgeBandID := ""
		if edgeBand != nil {
			edgeBandID = edgeBand.ID
		}

		grain := domain.GrainNone
		if material.GrainDefault {
			grain = domain.GrainYes
		}

		boardParts = append(boardParts, domain.ResolvedBoardPart{
			ID:          part.ID,
			Code:        part.Code,
			Description: part.Description,
			Quantity:    part.Quantity,
			LengthMm:    part.LengthMm,
			WidthMm:     part.WidthMm,
			ThicknessMm: material.ThicknessMm,
			Grain:       grain,
			Edges:       part.Edges,
			OptionRole:  part.OptionRole,
			MaterialID:  material.ID,
			EdgeBandID:  edgeBandID,
		})
	}

	hardwareResolved := make([]domain.ResolvedHardwareLine, 0, len(hardwareLines))
	for _, line := range hardwareLines {
		hw, err := ResolveHardware(line, optionChoices, catalog.Hardware)
		if err != nil {
			return domain.ResolvedBom{}, err
		}
		hardwareResolved = append(hardwareResolved, domain.ResolvedHardwareLine{
			ID:                  line.ID,
			Quantity:            line.Quantity,
			DescriptionOverride: line.DescriptionOverride,
			OptionRole:          line.OptionRole,
			HardwareID:          hw.ID,
		})
	}

	return domain.ResolvedBom{
		BoardParts:    boardParts,
		HardwareLines: hardwareResolved,
	}, nil
}

func collectAllHardwareLines(module domain.Module, catalog domain.Catalog) []domain.HardwareLine {
	lines := make([]domain.HardwareLine, 0, len(module.HardwareLines))
	lines = append(lines, module.HardwareLines...)

	// Structure Agregados
	if strings.TrimSpace(module.StructureID) != "" {
		if st, ok := findStructure(catalog, module.StructureID); ok {
			for _, inst := range st.Agregados {
				if agr, ok := findAgregado(catalog, inst.AgregadoID); ok {
					qty := inst.Quantity
					if qty <= 0 {
						qty = 1
					}
					for _, hl := range agr.HardwareLines {
						copyHl := hl
						copyHl.Quantity = hl.Quantity * float64(qty)
						lines = append(lines, copyHl)
					}
				}
			}
		}
	}

	// Module Agregados
	for _, inst := range module.Agregados {
		if agr, ok := findAgregado(catalog, inst.AgregadoID); ok {
			qty := inst.Quantity
			if qty <= 0 {
				qty = 1
			}
			for _, hl := range agr.HardwareLines {
				copyHl := hl
				copyHl.Quantity = hl.Quantity * float64(qty)
				lines = append(lines, copyHl)
			}
		}
	}

	return lines
}

// expandComposedModulePartsWithDims expands structure + module components and
// agregados into board parts. #442: it now filters ZOCLO component instances
// by the EFFECTIVE base mode (item override included — TS
// filterComponentInstancesForBaseMode applied to structure AND module
// instances) and returns the resolved dims so the caller can run base
// treatment synthesis with the same W/D the formulas saw.
func expandComposedModulePartsWithDims(
	module domain.Module,
	catalog domain.Catalog,
	authority dimensionAuthority,
	measurePresetID string,
	structureRevisionPin *int,
	customDims *domain.ItemCustomDims,
	optionChoices map[string]string,
	baseMode string,
	baseClearance int,
) ([]domain.BoardPart, formulaDims, error) {
	found, ok := findStructure(catalog, module.StructureID)
	if !ok {
		return nil, formulaDims{}, fmt.Errorf("structure not found: %s", module.StructureID)
	}
	// #108 (Slice 2): honor a pinned revision. When pin is nil or matches the
	// current revision the live structure is used; when pin points to a
	// historical snapshot the structure is reified from that snapshot; when pin
	// is unknown we fail loudly with context (mirrors TS resolveStructureForPin).
	structure, err := ResolveStructureForPin(found, structureRevisionPin)
	if err != nil {
		return nil, formulaDims{}, err
	}
	var dims formulaDims
	if authority == publishedDesignAuthority {
		// #727: the published revision item owns the physical truth. Commercial
		// measure presets are a sales concept and are not consulted here; the
		// explicit dimensions are mandatory for structured modules.
		if customDims == nil {
			return nil, formulaDims{}, fmt.Errorf(
				"la revisión publicada del mueble %q (%s) requiere dimensiones explícitas",
				module.Name, module.Code)
		}
		dims = formulaDims{W: customDims.WidthMm, H: customDims.HeightMm, D: customDims.DepthMm}
	} else {
		// resolveModuleDims keeps validating the preset id (stale ids fail
		// loudly, TS parity); the custom override then replaces the resolved
		// dims.
		dims, err = resolveModuleDims(module, measurePresetID)
		if err != nil {
			return nil, formulaDims{}, err
		}
		if customDims != nil {
			dims = formulaDims{W: customDims.WidthMm, H: customDims.HeightMm, D: customDims.DepthMm}
		}
	}
	if err := validateStructureDims(structure, dims); err != nil {
		return nil, formulaDims{}, err
	}

	parts := make([]domain.BoardPart, 0)
	structureParts, err := expandComponentInstances(
		filterInstancesForBaseMode(structure.Components, catalog, baseMode),
		catalog, dims, "st-", optionChoices, baseClearance,
	)
	if err != nil {
		return nil, formulaDims{}, err
	}
	parts = append(parts, structureParts...)

	moduleParts, err := expandComponentInstances(
		filterInstancesForBaseMode(module.Components, catalog, baseMode),
		catalog, dims, "mod-", optionChoices, baseClearance,
	)
	if err != nil {
		return nil, formulaDims{}, err
	}
	parts = append(parts, moduleParts...)

	// Agregados from structure and module (#442 / #434 / #54c93646 parity with
	// layout.go and TS bom.ts): evaluate sub-space box + units and disambiguate
	// sibling agregado instances with stable instance tags so part identities
	// match between BOM, layout and machining evidence without colliding on copy-0.
	agregadoInstances := append(append([]domain.ModuleAgregadoInstance{}, structure.Agregados...), module.Agregados...)
	agregadoInstanceCount := map[string]int{}
	for _, inst := range agregadoInstances {
		agregadoInstanceCount[inst.AgregadoID]++
	}
	seenInstanceIDs := map[string]bool{}
	for _, agrInst := range agregadoInstances {
		agr, ok := findAgregado(catalog, agrInst.AgregadoID)
		if !ok {
			continue
		}
		instanceTag := ""
		if agregadoInstanceCount[agrInst.AgregadoID] > 1 {
			instanceID := strings.TrimSpace(agrInst.ID)
			if instanceID == "" {
				return nil, formulaDims{}, fmt.Errorf("repeated agregado %s requires a stable instance id", agrInst.AgregadoID)
			}
			identityKey := agrInst.AgregadoID + "\x00" + instanceID
			if seenInstanceIDs[identityKey] {
				return nil, formulaDims{}, fmt.Errorf("repeated agregado %s has duplicate instance id %s", agrInst.AgregadoID, instanceID)
			}
			seenInstanceIDs[identityKey] = true
			instanceTag = fmt.Sprintf("instance-%s-", instanceID)
		}
		parentDims := formulaDims{
			W: dims.W, H: dims.H, D: dims.D,
			PW: dims.W, PH: dims.H, PD: dims.D,
			T: 18, B: baseClearance,
		}
		spaceW := float64(dims.W)
		spaceH := float64(dims.H)
		spaceD := float64(dims.D)
		if agrInst.Dimensions != nil {
			if agrInst.Dimensions.WidthFormula != "" {
				if v, err := evaluatePartFormula(agrInst.Dimensions.WidthFormula, parentDims); err == nil {
					spaceW = float64(v)
				}
			} else if agr.WidthMm > 0 {
				spaceW = float64(agr.WidthMm)
			}
			if agrInst.Dimensions.HeightFormula != "" {
				if v, err := evaluatePartFormula(agrInst.Dimensions.HeightFormula, parentDims); err == nil {
					spaceH = float64(v)
				}
			} else if agr.HeightMm > 0 {
				spaceH = float64(agr.HeightMm)
			}
			if agrInst.Dimensions.DepthFormula != "" {
				if v, err := evaluatePartFormula(agrInst.Dimensions.DepthFormula, parentDims); err == nil {
					spaceD = float64(v)
				}
			} else if agr.DepthMm > 0 {
				spaceD = float64(agr.DepthMm)
			}
		} else {
			if agr.WidthMm > 0 {
				spaceW = float64(agr.WidthMm)
			}
			if agr.HeightMm > 0 {
				spaceH = float64(agr.HeightMm)
			}
			if agr.DepthMm > 0 {
				spaceD = float64(agr.DepthMm)
			}
		}

		quantity := agrInst.Quantity
		if quantity <= 0 {
			quantity = 1
		}
		units := agregadoSubspaceUnits(quantity, spaceW, spaceH, spaceD, 0, 0, 0, agrInst.LayoutDirection, agrInst.GapMm)
		for _, unit := range units {
			unitDims := formulaDims{
				W:  int(math.Round(unit.w)),
				H:  int(math.Round(unit.h)),
				D:  int(math.Round(unit.d)),
				PW: int(math.Round(unit.w)),
				PH: int(math.Round(unit.h)),
				PD: int(math.Round(unit.d)),
				T:  18,
				B:  baseClearance,
			}
			idPrefix := fmt.Sprintf("agr-%s-%su%d-", agrInst.AgregadoID, instanceTag, unit.index)
			agrParts, err := expandComponentInstances(
				filterInstancesForBaseMode(agr.Components, catalog, baseMode),
				catalog, unitDims, idPrefix, optionChoices, baseClearance,
			)
			if err != nil {
				return nil, formulaDims{}, err
			}
			parts = append(parts, agrParts...)
		}
	}

	return parts, dims, nil
}

// resolveModuleDims picks commercial preset dims or falls back to module base size.
func resolveModuleDims(module domain.Module, measurePresetID string) (formulaDims, error) {
	if len(module.Presets) > 0 {
		if strings.TrimSpace(measurePresetID) == "" {
			return formulaDims{}, fmt.Errorf(
				"elegí un preset de medida para el mueble %q (%s)",
				module.Name, module.Code,
			)
		}
		for _, p := range module.Presets {
			if p.ID == measurePresetID {
				if p.WidthMm <= 0 || p.HeightMm <= 0 || p.DepthMm <= 0 {
					return formulaDims{}, fmt.Errorf("preset de medida inválido: %s", p.ID)
				}
				return formulaDims{W: p.WidthMm, H: p.HeightMm, D: p.DepthMm}, nil
			}
		}
		return formulaDims{}, fmt.Errorf(
			"el preset de medida no es válido para el mueble %q (%s)",
			module.Name, module.Code,
		)
	}
	if module.WidthMm <= 0 || module.HeightMm <= 0 || module.DepthMm <= 0 {
		return formulaDims{}, fmt.Errorf(
			"composed module requires external dimensions (got %dx%dx%d)",
			module.WidthMm, module.HeightMm, module.DepthMm,
		)
	}
	return formulaDims{W: module.WidthMm, H: module.HeightMm, D: module.DepthMm}, nil
}

// validateStructureDims only checks positive dims (commercial allowlist is Module.Presets).
func validateStructureDims(structure domain.Structure, dims formulaDims) error {
	if dims.W <= 0 || dims.H <= 0 || dims.D <= 0 {
		return fmt.Errorf(
			"las medidas de la estructura %q (%s) deben ser mayores a 0",
			structure.Name, structure.Code,
		)
	}
	return nil
}

func expandComponentInstances(
	instances []domain.ComponentInstance,
	catalog domain.Catalog,
	dims formulaDims,
	idPrefix string,
	optionChoices map[string]string,
	baseClearance int,
) ([]domain.BoardPart, error) {
	parts := make([]domain.BoardPart, 0)
	copyCounters := map[string]int{}
	for _, inst := range instances {
		comp, ok := findComponent(catalog, inst.ComponentID)
		if !ok {
			return nil, fmt.Errorf("component not found: %s", inst.ComponentID)
		}
		if inst.Quantity <= 0 {
			return nil, fmt.Errorf("component instance quantity must be > 0 for %s", inst.ComponentID)
		}

		edges := comp.DefaultEdges
		if inst.Overrides != nil && len(inst.Overrides.Edges) > 0 {
			edges = inst.Overrides.Edges
		}
		// #403 / MT-2: single canonical binding role — multiple distinct
		// roles are ambiguous and fail loudly instead of silently honoring
		// only the first (material_role.go, mirrored from TS).
		optionRole, err := materialBindingRole(comp)
		if err != nil {
			return nil, err
		}

		// #402 / MT-1: the selected board's thickness participates in geometry
		// BEFORE any formula is evaluated — a selected material never loses to
		// the component's nominal thickness. One canonical rule feeds both the
		// BOM and the layout resolver (effective_thickness.go).
		effectiveT, err := effectiveThicknessMm(optionRole, comp.ThicknessMm, optionChoices, catalog.Materials)
		if err != nil {
			return nil, fmt.Errorf("component %s: %w", comp.Code, err)
		}

		lengthMm := comp.LengthMm
		widthMm := comp.WidthMm
		lengthFormula := comp.LengthFormula
		widthFormula := comp.WidthFormula
		if inst.Overrides != nil {
			if inst.Overrides.LengthFormula != "" {
				lengthFormula = inst.Overrides.LengthFormula
			}
			if inst.Overrides.WidthFormula != "" {
				widthFormula = inst.Overrides.WidthFormula
			}
		}
		// Parent dims + part thickness + plinth height B (TS geomDims parity:
		// W/H/D, PW/PH/PD, T, B). Length/width formulas evaluate once with
		// i=0 (same as typical non-spatial use).
		evalDims := formulaDims{
			W: dims.W, H: dims.H, D: dims.D,
			PW: dims.W, PH: dims.H, PD: dims.D,
			T: effectiveT,
			B: baseClearance,
			I: 0,
		}
		if lengthFormula != "" {
			v, err := evaluatePartFormula(lengthFormula, evalDims)
			if err != nil {
				return nil, fmt.Errorf("component %s length formula: %w", comp.Code, err)
			}
			lengthMm = v
		}
		if widthFormula != "" {
			v, err := evaluatePartFormula(widthFormula, evalDims)
			if err != nil {
				return nil, fmt.Errorf("component %s width formula: %w", comp.Code, err)
			}
			widthMm = v
		}

		for i := 0; i < inst.Quantity; i++ {
			copyIndex := copyCounters[comp.ID]
			copyCounters[comp.ID] = copyIndex + 1
			parts = append(parts, domain.BoardPart{
				ID:          fmt.Sprintf("%s%s-copy-%d", idPrefix, comp.ID, copyIndex),
				Description: comp.Name,
				Quantity:    1,
				LengthMm:    lengthMm,
				WidthMm:     widthMm,
				Edges:       edges,
				OptionRole:  optionRole,
			})
		}
	}
	return parts, nil
}

// formulaDims holds parent and optional part variables (TS evaluatePartFormula parity).
type formulaDims struct {
	W, H, D    int
	PW, PH, PD int
	T, I       int
	// B is the plinth/toe-kick height (zoclo) in mm; 0 when the module has none.
	B int
	// HW is the hardware preview size for hardware relative-position formulas.
	HW int
}

// evaluatePartFormula evaluates simple math with W/H/D/PW/PH/PD/T/B/HW/i (TS parity).
func evaluatePartFormula(formula string, dims formulaDims) (int, error) {
	trimmed := strings.TrimSpace(formula)
	if trimmed == "" {
		return 0, fmt.Errorf("la fórmula no puede estar vacía")
	}
	clean := strings.ReplaceAll(trimmed, " ", "")
	for _, r := range clean {
		// Allow '.' for decimal literals (e.g. "1.5", "W * 1.5") — parser already handles them.
		if unicode.IsDigit(r) || r == '.' || r == 'W' || r == 'H' || r == 'D' ||
			r == 'P' || r == 'T' || r == 'B' || r == 'L' || r == 'i' ||
			r == '+' || r == '-' || r == '*' || r == '/' || r == '(' || r == ')' {
			continue
		}
		return 0, fmt.Errorf("la fórmula %q contiene caracteres no permitidos", formula)
	}
	p := &formulaParser{s: clean, i: 0, dims: dims}
	v, err := p.parseExpr()
	if err != nil {
		return 0, err
	}
	if p.i != len(p.s) {
		return 0, fmt.Errorf("la fórmula %q no se pudo evaluar correctamente", formula)
	}
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, fmt.Errorf("la fórmula %q no se pudo evaluar correctamente", formula)
	}
	return int(math.Round(v)), nil
}

type formulaParser struct {
	s    string
	i    int
	dims formulaDims
}

func (p *formulaParser) parentW() int {
	if p.dims.PW != 0 {
		return p.dims.PW
	}
	return p.dims.W
}

func (p *formulaParser) parentH() int {
	if p.dims.PH != 0 {
		return p.dims.PH
	}
	return p.dims.H
}

func (p *formulaParser) parentD() int {
	if p.dims.PD != 0 {
		return p.dims.PD
	}
	return p.dims.D
}

func (p *formulaParser) parseExpr() (float64, error) {
	left, err := p.parseTerm()
	if err != nil {
		return 0, err
	}
	for p.i < len(p.s) {
		op := p.s[p.i]
		if op != '+' && op != '-' {
			break
		}
		p.i++
		right, err := p.parseTerm()
		if err != nil {
			return 0, err
		}
		if op == '+' {
			left += right
		} else {
			left -= right
		}
	}
	return left, nil
}

func (p *formulaParser) parseTerm() (float64, error) {
	left, err := p.parseFactor()
	if err != nil {
		return 0, err
	}
	for p.i < len(p.s) {
		op := p.s[p.i]
		if op != '*' && op != '/' {
			break
		}
		p.i++
		right, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		if op == '*' {
			left *= right
		} else {
			if right == 0 {
				return 0, fmt.Errorf("división por cero")
			}
			left /= right
		}
	}
	return left, nil
}

func (p *formulaParser) parseFactor() (float64, error) {
	if p.i >= len(p.s) {
		return 0, fmt.Errorf("fórmula incompleta")
	}
	if p.s[p.i] == '+' {
		p.i++
		return p.parseFactor()
	}
	if p.s[p.i] == '-' {
		p.i++
		v, err := p.parseFactor()
		return -v, err
	}
	if p.s[p.i] == '(' {
		p.i++
		v, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		if p.i >= len(p.s) || p.s[p.i] != ')' {
			return 0, fmt.Errorf("paréntesis sin cerrar")
		}
		p.i++
		return v, nil
	}
	// Multi-char parent vars before single-letter W/H/D (TS substitutes PW before W).
	if strings.HasPrefix(p.s[p.i:], "PW") {
		p.i += 2
		return float64(p.parentW()), nil
	}
	if strings.HasPrefix(p.s[p.i:], "PH") {
		p.i += 2
		return float64(p.parentH()), nil
	}
	if strings.HasPrefix(p.s[p.i:], "PD") {
		p.i += 2
		return float64(p.parentD()), nil
	}
	// HW is the hardware preview size (hardware relative-position formulas).
	if strings.HasPrefix(p.s[p.i:], "HW") {
		p.i += 2
		return float64(p.dims.HW), nil
	}
	if p.s[p.i] == 'W' {
		p.i++
		return float64(p.dims.W), nil
	}
	if p.s[p.i] == 'H' {
		p.i++
		return float64(p.dims.H), nil
	}
	if p.s[p.i] == 'D' || p.s[p.i] == 'L' {
		p.i++
		return float64(p.dims.D), nil
	}
	if p.s[p.i] == 'T' {
		p.i++
		return float64(p.dims.T), nil
	}
	if p.s[p.i] == 'B' {
		p.i++
		return float64(p.dims.B), nil
	}
	if p.s[p.i] == 'i' {
		p.i++
		return float64(p.dims.I), nil
	}
	start := p.i
	for p.i < len(p.s) && (unicode.IsDigit(rune(p.s[p.i])) || p.s[p.i] == '.') {
		p.i++
	}
	if start == p.i {
		return 0, fmt.Errorf("número o variable esperada")
	}
	return strconv.ParseFloat(p.s[start:p.i], 64)
}

func findStructure(catalog domain.Catalog, id string) (domain.Structure, bool) {
	for _, s := range catalog.Structures {
		if s.ID == id {
			return s, true
		}
	}
	return domain.Structure{}, false
}

func findComponent(catalog domain.Catalog, id string) (domain.Component, bool) {
	for _, c := range catalog.Components {
		if c.ID == id {
			return c, true
		}
	}
	return domain.Component{}, false
}

func findModule(catalog domain.Catalog, id string) (domain.Module, bool) {
	for _, m := range catalog.Modules {
		if m.ID == id {
			return m, true
		}
	}
	return domain.Module{}, false
}

func findMaterial(catalog domain.Catalog, id string) (domain.MaterialBoard, bool) {
	for _, m := range catalog.Materials {
		if m.ID == id {
			return m, true
		}
	}
	return domain.MaterialBoard{}, false
}

func findEdgeBand(catalog domain.Catalog, id string) (domain.EdgeBand, bool) {
	for _, e := range catalog.Edges {
		if e.ID == id {
			return e, true
		}
	}
	return domain.EdgeBand{}, false
}

func findHardware(catalog domain.Catalog, id string) (domain.Hardware, bool) {
	for _, h := range catalog.Hardware {
		if h.ID == id {
			return h, true
		}
	}
	return domain.Hardware{}, false
}

func findAgregado(catalog domain.Catalog, id string) (domain.Agregado, bool) {
	for _, a := range catalog.Agregados {
		if a.ID == id {
			return a, true
		}
	}
	return domain.Agregado{}, false
}

// CalcHardwareLineCost multiplies line qty × item qty × unit cost (TS parity).
func CalcHardwareLineCost(
	line domain.ResolvedHardwareLine,
	catalog domain.Catalog,
	qtyMultiplier int,
) (HardwareLineCost, error) {
	if !(line.Quantity > 0) {
		return HardwareLineCost{}, fmt.Errorf("hardware line quantity must be > 0 (got %v)", line.Quantity)
	}
	hw, ok := findHardware(catalog, line.HardwareID)
	if !ok {
		return HardwareLineCost{}, fmt.Errorf("hardware not found: %s", line.HardwareID)
	}
	if !hw.Active {
		return HardwareLineCost{}, fmt.Errorf("inactive hardware cannot be used: %s", hw.Code)
	}
	// #442: quantity is float64 (ml consumption for strip profiles) — quote
	// cost prices what is consumed; purchase-bar rounding is export-only
	// (TS calcHardwareLineCost parity).
	return HardwareLineCost{
		HardwareCost: line.Quantity * float64(qtyMultiplier) * hw.CostPerUnit,
	}, nil
}
