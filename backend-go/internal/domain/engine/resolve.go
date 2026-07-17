package engine

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"

	"github.com/tiagofur/muebles-backend/internal/domain"
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
func ResolveBom(
	module domain.Module,
	optionChoices map[string]string,
	catalog domain.Catalog,
	measurePresetID ...string,
) (domain.ResolvedBom, error) {
	if err := ValidateModule(module); err != nil {
		return domain.ResolvedBom{}, err
	}

	presetID := ""
	if len(measurePresetID) > 0 {
		presetID = measurePresetID[0]
	}

	rawParts := module.BoardParts
	if strings.TrimSpace(module.StructureID) != "" {
		composed, err := expandComposedModuleParts(module, catalog, presetID)
		if err != nil {
			return domain.ResolvedBom{}, err
		}
		rawParts = composed
	}

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
			Grain:       grain,
			Edges:       part.Edges,
			OptionRole:  part.OptionRole,
			MaterialID:  material.ID,
			EdgeBandID:  edgeBandID,
		})
	}

	hardwareLines := make([]domain.ResolvedHardwareLine, 0, len(module.HardwareLines))
	for _, line := range module.HardwareLines {
		hw, err := ResolveHardware(line, optionChoices, catalog.Hardware)
		if err != nil {
			return domain.ResolvedBom{}, err
		}
		hardwareLines = append(hardwareLines, domain.ResolvedHardwareLine{
			ID:                  line.ID,
			Quantity:            line.Quantity,
			DescriptionOverride: line.DescriptionOverride,
			OptionRole:          line.OptionRole,
			HardwareID:          hw.ID,
		})
	}

	return domain.ResolvedBom{
		BoardParts:    boardParts,
		HardwareLines: hardwareLines,
	}, nil
}

func expandComposedModuleParts(
	module domain.Module,
	catalog domain.Catalog,
	measurePresetID string,
) ([]domain.BoardPart, error) {
	structure, ok := findStructure(catalog, module.StructureID)
	if !ok {
		return nil, fmt.Errorf("structure not found: %s", module.StructureID)
	}
	dims, err := resolveModuleDims(module, measurePresetID)
	if err != nil {
		return nil, err
	}
	if err := validateStructureDims(structure, dims); err != nil {
		return nil, err
	}

	parts := make([]domain.BoardPart, 0)
	structureParts, err := expandComponentInstances(structure.Components, catalog, dims, "st-")
	if err != nil {
		return nil, err
	}
	parts = append(parts, structureParts...)

	moduleParts, err := expandComponentInstances(module.Components, catalog, dims, "mod-")
	if err != nil {
		return nil, err
	}
	parts = append(parts, moduleParts...)
	return parts, nil
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
) ([]domain.BoardPart, error) {
	parts := make([]domain.BoardPart, 0)
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
		optionRole := ""
		if len(comp.OptionRoles) > 0 {
			optionRole = comp.OptionRoles[0]
		}
		if strings.TrimSpace(optionRole) == "" {
			return nil, fmt.Errorf("component %s has no optionRoles", comp.Code)
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
		// Parent dims + part thickness (TS geomDims: W/H/D, PW/PH/PD, T).
		// Length/width formulas evaluate once with i=0 (same as typical non-spatial use).
		evalDims := formulaDims{
			W: dims.W, H: dims.H, D: dims.D,
			PW: dims.W, PH: dims.H, PD: dims.D,
			T: comp.ThicknessMm,
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
			parts = append(parts, domain.BoardPart{
				ID:          fmt.Sprintf("%s%s-copy-%d", idPrefix, comp.ID, i),
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
}

// evaluatePartFormula evaluates simple math with W/H/D/PW/PH/PD/T/i (TS parity).
func evaluatePartFormula(formula string, dims formulaDims) (int, error) {
	trimmed := strings.TrimSpace(formula)
	if trimmed == "" {
		return 0, fmt.Errorf("la fórmula no puede estar vacía")
	}
	clean := strings.ReplaceAll(trimmed, " ", "")
	for _, r := range clean {
		if unicode.IsDigit(r) || r == 'W' || r == 'H' || r == 'D' ||
			r == 'P' || r == 'T' || r == 'L' || r == 'i' ||
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

// CalcHardwareLineCost multiplies line qty × item qty × unit cost (TS parity).
func CalcHardwareLineCost(
	line domain.ResolvedHardwareLine,
	catalog domain.Catalog,
	qtyMultiplier int,
) (HardwareLineCost, error) {
	if line.Quantity <= 0 {
		return HardwareLineCost{}, fmt.Errorf("hardware line quantity must be > 0 (got %d)", line.Quantity)
	}
	hw, ok := findHardware(catalog, line.HardwareID)
	if !ok {
		return HardwareLineCost{}, fmt.Errorf("hardware not found: %s", line.HardwareID)
	}
	if !hw.Active {
		return HardwareLineCost{}, fmt.Errorf("inactive hardware cannot be used: %s", hw.Code)
	}
	return HardwareLineCost{
		HardwareCost: float64(line.Quantity*qtyMultiplier) * hw.CostPerUnit,
	}, nil
}
