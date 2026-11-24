package engine

import (
	"fmt"
	"math"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1579 PR2 — the hinge COUNT RULE pattern on aggregate-door recipes
// (AGR-PUE-*): one placement with CountRule is a PATTERN, not a piece. The
// engine expands it to as many positions as the door's effective demand
// buys (component exception → the chosen hinge's table → factory policy →
// library ladder — domain.HingeDemandForDoor) with the door board's REAL
// dimensions for that bay, and the demand prices through the exclusive
// hingeband-agr-… line (no module-band duplicate, no recipe bulk of the
// same hardware). Fixed placements of the same hardware are authored intent
// and win: the pattern neither duplicates nor demands. A door with no
// CountRule anywhere behaves byte-identically.
//
// TS parity: packages/domain/src/agregados.ts
// (expandHingeCountRulePositions + resolveAgregadoInstance count-rule path)
// and engine/bom.ts (context + module-band exclusion). The shared
// hingeDemandBands fixture pins the ladder; the position distribution is
// mirrored arithmetic (extremes at the offsets, intermediates even).

// hingeCountRuleYs returns the door-local Y positions (mm from the door
// bottom) of the pattern: first at the bottom offset, last at height minus
// the top offset, intermediates distributed evenly. Count 1 centers on the
// door. Mirrors TS expandHingeCountRulePositions.
func hingeCountRuleYs(bottomMm, topMm, heightMm float64, count int) []float64 {
	if !(heightMm > 0) || count <= 0 {
		return nil
	}
	if count == 1 {
		return []float64{heightMm / 2}
	}
	bottom := math.Max(0, bottomMm)
	top := math.Max(0, topMm)
	first := math.Min(bottom, heightMm/2)
	last := heightMm - math.Min(top, heightMm/2)
	if last-first <= 0 {
		return []float64{heightMm / 2}
	}
	ys := make([]float64, 0, count)
	ys = append(ys, first)
	for i := 1; i < count-1; i++ {
		ys = append(ys, first+((last-first)*float64(i))/float64(count-1))
	}
	ys = append(ys, last)
	return ys
}

// countRuleDoorOf returns the aggregate's door component instance that
// declares a hinge count pattern (placementOverride puerta) together with
// its pattern placement, or nil when the recipe declares none.
func countRuleDoorOf(agr domain.Agregado) (*domain.ComponentInstance, *domain.HardwarePlacement) {
	for ci := range agr.Components {
		comp := &agr.Components[ci]
		if comp.PlacementOverride == nil || *comp.PlacementOverride != domain.PlacementPuerta {
			continue
		}
		if comp.Overrides == nil {
			continue
		}
		for pi := range comp.Overrides.HardwarePlacements {
			if comp.Overrides.HardwarePlacements[pi].CountRule != nil {
				return comp, &comp.Overrides.HardwarePlacements[pi]
			}
		}
	}
	return nil, nil
}

// hingeCountRuleDoorDims evaluates the door board's REAL dimensions for the
// unit: the catalog component's formulas against the unit box (PW/PH of the
// bay, T 18 — the same frame expandComponentInstances uses), falling back to
// the instance overrides and then the box. Mirrors the TS evaluation in
// engine/bom.ts countRuleContext.
func hingeCountRuleDoorDims(catalog domain.Catalog, comp *domain.ComponentInstance, unit agregadoUnit) (heightMm, widthMm float64) {
	heightMm = unit.h
	widthMm = unit.w
	catalogComp, ok := findComponent(catalog, comp.ComponentID)
	if ok {
		dims := formulaDims{
			W: int(math.Round(unit.w)), H: int(math.Round(unit.h)), D: int(math.Round(unit.d)),
			PW: int(math.Round(unit.w)), PH: int(math.Round(unit.h)), PD: int(math.Round(unit.d)),
			T: 18,
		}
		if catalogComp.LengthFormula != "" {
			if v, err := evaluatePartFormula(catalogComp.LengthFormula, dims); err == nil && v > 0 {
				heightMm = float64(v)
			}
		} else if catalogComp.LengthMm > 0 {
			heightMm = float64(catalogComp.LengthMm)
		}
		if catalogComp.WidthFormula != "" {
			if v, err := evaluatePartFormula(catalogComp.WidthFormula, dims); err == nil && v > 0 {
				widthMm = float64(v)
			}
		} else if catalogComp.WidthMm > 0 {
			widthMm = float64(catalogComp.WidthMm)
		}
	}
	if comp.Overrides != nil {
		if comp.Overrides.LengthFormula != "" {
			if v, err := evaluatePartFormula(comp.Overrides.LengthFormula, formulaDims{
				W: int(math.Round(unit.w)), H: int(math.Round(unit.h)), D: int(math.Round(unit.d)),
				PW: int(math.Round(unit.w)), PH: int(math.Round(unit.h)), PD: int(math.Round(unit.d)),
				T: 18,
			}); err == nil && v > 0 {
				heightMm = float64(v)
			}
		}
		if comp.Overrides.WidthFormula != "" {
			if v, err := evaluatePartFormula(comp.Overrides.WidthFormula, formulaDims{
				W: int(math.Round(unit.w)), H: int(math.Round(unit.h)), D: int(math.Round(unit.d)),
				PW: int(math.Round(unit.w)), PH: int(math.Round(unit.h)), PD: int(math.Round(unit.d)),
				T: 18,
			}); err == nil && v > 0 {
				widthMm = float64(v)
			}
		}
	}
	return heightMm, widthMm
}

// hingeCountRuleResolvedHardware resolves the pattern's hardware identity:
// concrete id → instance option override → effective option choices. Empty
// when the role has no choice anywhere (the quote gate owns that failure).
func hingeCountRuleResolvedHardware(pattern *domain.HardwarePlacement, inst domain.ModuleAgregadoInstance, optionChoices map[string]string) string {
	if id := strings.TrimSpace(pattern.HardwareID); id != "" {
		return id
	}
	role := strings.TrimSpace(pattern.OptionRole)
	if role == "" {
		role = domain.HingeDemandRole
	}
	if id := strings.TrimSpace(inst.OptionOverrides[role]); id != "" {
		return id
	}
	return strings.TrimSpace(optionChoices[role])
}

// hingeCountRuleFixedSameHardware reports whether the recipe carries a FIXED
// placement (no count rule) of the same resolved hardware — authored intent
// wins: the pattern stays out of demand and drawing.
func hingeCountRuleFixedSameHardware(agr domain.Agregado, inst domain.ModuleAgregadoInstance, optionChoices map[string]string, hardwareID string) bool {
	for _, comp := range agr.Components {
		if comp.Overrides == nil {
			continue
		}
		for _, p := range comp.Overrides.HardwarePlacements {
			if p.CountRule != nil {
				continue
			}
			resolved := hingeCountRuleResolvedHardware(&p, inst, optionChoices)
			if resolved != "" && resolved == hardwareID {
				return true
			}
		}
	}
	return false
}

// expandHingeCountRuleComponentsForUnit expands the pattern placements of
// the unit's components into concrete positions (drawing layout for hosts).
// Components without a count rule pass through untouched; when the pattern
// is suppressed (fixed wins, no choice, no usable dims) the pattern
// placement is dropped from the drawing — drilled equals bought.
func expandHingeCountRuleComponentsForUnit(agr domain.Agregado, inst domain.ModuleAgregadoInstance, catalog domain.Catalog, optionChoices map[string]string, unit agregadoUnit) []domain.ComponentInstance {
	doorComp, pattern := countRuleDoorOf(agr)
	if doorComp == nil || pattern == nil {
		return agr.Components
	}
	doorHeight, doorWidth := hingeCountRuleDoorDims(catalog, doorComp, unit)
	hardwareID := hingeCountRuleResolvedHardware(pattern, inst, optionChoices)
	if hardwareID == "" {
		return dropHingeCountRulePlacements(agr.Components)
	}
	if hingeCountRuleFixedSameHardware(agr, inst, optionChoices, hardwareID) {
		return dropHingeCountRulePlacements(agr.Components)
	}
	hinge, hasHinge := findHardwareByID(catalog, hardwareID)
	var hingeForDraw *domain.Hardware
	if hasHinge {
		hingeForDraw = &hinge
	}
	policy := catalog.ConstructionPolicy.HingeDemandForDoor(doorComp.ComponentID, hingeForDraw)
	count := domain.ResolveHingeCount(doorHeight, int(math.Round(doorWidth)), policy)
	ys := hingeCountRuleYs(pattern.CountRule.EndOffsetBottomMm, pattern.CountRule.EndOffsetTopMm, doorHeight, count.Hinges)
	if len(ys) == 0 {
		return dropHingeCountRulePlacements(agr.Components)
	}

	out := make([]domain.ComponentInstance, len(agr.Components))
	copy(out, agr.Components)
	for i := range out {
		if &out[i] != doorComp && out[i].ComponentID != doorComp.ComponentID {
			continue
		}
		if out[i].Overrides == nil {
			continue
		}
		placements := make([]domain.HardwarePlacement, 0, len(ys))
		for _, p := range out[i].Overrides.HardwarePlacements {
			if p.CountRule == nil {
				placements = append(placements, p)
				continue
			}
			for _, y := range ys {
				expanded := p
				expanded.RelativePosition.YMm = y
				expanded.RelativePosition.YFormula = ""
				expanded.CountRule = nil
				placements = append(placements, expanded)
			}
		}
		out[i].Overrides.HardwarePlacements = placements
	}
	return out
}

// dropHingeCountRulePlacements removes pattern placements (suppressed
// patterns never draw — drilled equals bought).
func dropHingeCountRulePlacements(components []domain.ComponentInstance) []domain.ComponentInstance {
	out := make([]domain.ComponentInstance, len(components))
	copy(out, components)
	for i := range out {
		if out[i].Overrides == nil {
			continue
		}
		hasPattern := false
		for _, p := range out[i].Overrides.HardwarePlacements {
			if p.CountRule != nil {
				hasPattern = true
				break
			}
		}
		if !hasPattern {
			continue
		}
		placements := make([]domain.HardwarePlacement, 0, len(out[i].Overrides.HardwarePlacements))
		for _, p := range out[i].Overrides.HardwarePlacements {
			if p.CountRule == nil {
				placements = append(placements, p)
			}
		}
		out[i].Overrides.HardwarePlacements = placements
	}
	return out
}

// findHardwareByID resolves one catalog hardware by exact id.
func findHardwareByID(catalog domain.Catalog, id string) (domain.Hardware, bool) {
	for _, hw := range catalog.Hardware {
		if hw.ID == id {
			return hw, true
		}
	}
	return domain.Hardware{}, false
}

// countRuleCovers reports whether the recipe's pattern bought this hardware
// (nil map = catalogs without patterns).
func countRuleCovers(covered map[string]map[string]bool, effectiveID, hardwareID string) bool {
	if hardwareID == "" {
		return false
	}
	return covered[effectiveID][hardwareID]
}

// collectAgregadoHingeCountDemand derives the count-rule demand lines for
// every aggregate instance of the module (structure + module), mirroring
// TS resolveAgregadoInstance's count-rule path:
//   - one hingeband-agr-<key>-u<idx>-<hw> line per resolved hardware,
//     quantity = hinges × copies, overflow notice included;
//   - `covered` keys effective agregado id → hardware ids the pattern bought
//     (the recipe's bulk lines of those die in collectAllHardwareLines);
//   - `prefixes` lists agr-<effectiveID>- for instances with a pattern (the
//     module band collector excludes their door parts — no double line).
//
// The unit iteration mirrors expandComposedModulePartsWithDims exactly
// (dims formulas, copy-index override, base filtering n/a for demand), so
// unit indexes and door dimensions match the parts the BOM expands.
func collectAgregadoHingeCountDemand(module domain.Module, catalog domain.Catalog, optionChoices map[string]string, moduleDims formulaDims, baseClearance int) (lines []domain.ResolvedHardwareLine, covered map[string]map[string]bool, prefixes []string) {
	covered = map[string]map[string]bool{}
	structure := domain.Structure{}
	if strings.TrimSpace(module.StructureID) != "" {
		if st, ok := findStructure(catalog, module.StructureID); ok {
			structure = st
		}
	}
	instances := append(append([]domain.ModuleAgregadoInstance{}, structure.Agregados...), module.Agregados...)
	for _, inst := range instances {
		effectiveID := ResolveEffectiveAgregadoID(inst, optionChoices)
		if effectiveID == "" {
			continue
		}
		agr, ok := findAgregado(catalog, effectiveID)
		if !ok {
			continue
		}
		doorComp, _ := countRuleDoorOf(agr)
		if doorComp == nil {
			continue
		}
		prefixes = append(prefixes, fmt.Sprintf("agr-%s-", effectiveID))

		parentDims := formulaDims{
			W: moduleDims.W, H: moduleDims.H, D: moduleDims.D,
			PW: moduleDims.W, PH: moduleDims.H, PD: moduleDims.D,
			T: 18, B: baseClearance,
		}
		spaceW, spaceH, spaceD := float64(moduleDims.W), float64(moduleDims.H), float64(moduleDims.D)
		if inst.Dimensions != nil {
			if inst.Dimensions.WidthFormula != "" {
				if v, err := evaluatePartFormula(inst.Dimensions.WidthFormula, parentDims); err == nil {
					spaceW = float64(v)
				}
			} else if agr.WidthMm > 0 {
				spaceW = float64(agr.WidthMm)
			}
			if inst.Dimensions.HeightFormula != "" {
				if v, err := evaluatePartFormula(inst.Dimensions.HeightFormula, parentDims); err == nil {
					spaceH = float64(v)
				}
			} else if agr.HeightMm > 0 {
				spaceH = float64(agr.HeightMm)
			}
			if inst.Dimensions.DepthFormula != "" {
				if v, err := evaluatePartFormula(inst.Dimensions.DepthFormula, parentDims); err == nil {
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

		quantity := inst.Quantity
		if quantity <= 0 {
			quantity = 1
		}
		units := agregadoSubspaceUnits(quantity, spaceW, spaceH, spaceD, 0, 0, 0, inst.LayoutDirection, inst.GapMm)
		if formulaUsesCopyIndex(inst.Position) {
			units = units[:0]
			for idx := 0; idx < quantity; idx++ {
				units = append(units, agregadoUnit{index: idx, w: spaceW, h: spaceH, d: spaceD})
			}
		}
		for _, unit := range units {
			if instLines := hingeCountRuleDemandForInstance(inst, catalog, optionChoices, unit.index, unit, covered); len(instLines) > 0 {
				lines = append(lines, instLines...)
			}
		}
	}
	return lines, covered, prefixes
}

// hingeCountRuleDemandForInstance derives the count-rule demand lines of ONE
// agregado instance (mirroring TS resolveAgregadoInstance's count-rule path):
// one hingeband-agr-… line per resolved hardware for this unit, quantity =
// hinges × copies, with the overflow notice when the door exceeds the
// table's last band. Nil/empty when the recipe declares no pattern, the role
// has no choice, fixed placements of the same hardware win, or the count is
// zero. `covered` receives every hardware the pattern bought (the recipe's
// bulk lines of the same hardware die — single source of truth).
func hingeCountRuleDemandForInstance(inst domain.ModuleAgregadoInstance, catalog domain.Catalog, optionChoices map[string]string, unitIndex int, unit agregadoUnit, covered map[string]map[string]bool) []domain.ResolvedHardwareLine {
	effectiveID := ResolveEffectiveAgregadoID(inst, optionChoices)
	agr, ok := findAgregado(catalog, effectiveID)
	if !ok {
		return nil
	}
	doorComp, pattern := countRuleDoorOf(agr)
	if doorComp == nil || pattern == nil {
		return nil
	}
	hardwareID := hingeCountRuleResolvedHardware(pattern, inst, optionChoices)
	if hardwareID == "" {
		return nil
	}
	if hingeCountRuleFixedSameHardware(agr, inst, optionChoices, hardwareID) {
		return nil
	}
	doorHeight, doorWidth := hingeCountRuleDoorDims(catalog, doorComp, unit)
	hinge, hasHinge := findHardwareByID(catalog, hardwareID)
	var hingeForPolicy *domain.Hardware
	if hasHinge {
		hingeForPolicy = &hinge
	}
	policy := catalog.ConstructionPolicy.HingeDemandForDoor(doorComp.ComponentID, hingeForPolicy)
	count := domain.ResolveHingeCount(doorHeight, int(math.Round(doorWidth)), policy)
	if count.Hinges <= 0 {
		return nil
	}
	if covered[hardwareID] == nil {
		covered[hardwareID] = map[string]bool{}
	}
	covered[hardwareID][hardwareID] = true
	instanceKey := strings.TrimSpace(inst.ID)
	if instanceKey == "" {
		instanceKey = effectiveID
	}
	role := domain.HingeDemandEffectiveRole(policy)
	line := domain.ResolvedHardwareLine{
		ID:                  fmt.Sprintf("%sagr-%s-u%d-%s", domain.HingeDemandLinePrefix, instanceKey, unitIndex, hardwareID),
		Quantity:            float64(count.Hinges),
		DescriptionOverride: domain.HingeDemandLineDescription,
		OptionRole:          role,
		HardwareID:          hardwareID,
	}
	if count.AboveLastBand {
		line.Notice = domain.HingeDemandAboveLastBandMessage(doorHeight, count)
	}
	return []domain.ResolvedHardwareLine{line}
}
