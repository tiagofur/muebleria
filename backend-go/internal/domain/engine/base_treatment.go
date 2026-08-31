package engine

import (
	"fmt"
	"math"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Base treatment (zócalo / patas) — Go mirror of packages/domain/src/plinth.ts.
//
// #442: TS is the reference implementation; parity is frozen by the shared
// contract fixture contracts/plinthBaseParity.contract.json (consumed by
// packages/domain/src/plinthBaseParity.contract.test.ts and
// plinthBaseParityContract_test.go in this package). If an engine diverges,
// the engine is aligned — never the fixture.
//
// Modes:
//   - none: no base parts
//   - plinth_board: melamine plinth; synthesized (F087) when the module
//     carries no ZOCLO component
//   - plinth_strip: purchased profile consumed by the linear meter
//   - legs: adjustable feet, quantity suggested from the width
//
// F089 (wall-run front plinth merging) is intentionally absent: no TS
// production caller passes plinthRunMap, so parity means the same behavior.

const (
	baseModeNone        = "none"
	baseModePlinthBoard = "plinth_board"
	baseModePlinthStrip = "plinth_strip"
	baseModeLegs        = "legs"

	// defaultBaseClearanceMm mirrors TS DEFAULT_BASE_CLEARANCE_MM.
	defaultBaseClearanceMm = 100
	// plinthSideGapMm mirrors TS PLINTH_SIDE_GAP_MM: gap under which a
	// neighbor or wall end counts as covering a side.
	plinthSideGapMm = 30

	// syntheticZocloPartIDSuffix builds the stable synthesized part identity.
	syntheticZocloPartIDSuffix = "-zoclo-auto"
	syntheticZocloPartCode     = "ZOCLO-AUTO"
	syntheticZocloSideCode     = "ZOCLO-LADO-AUTO"

	// zocloStripRole mirrors TS ZOCLO_STRIP_ROLE (purchased plinth profile, ml).
	zocloStripRole = "ZOCLO_PERFIL"
	// patasRole mirrors TS PATAS_ROLE (legs / levelers).
	patasRole = "PATAS"
)

// PlinthSides mirrors TS PlinthSides (F088): which zócalo sides are visible.
type PlinthSides struct {
	Left  bool
	Right bool
	Back  bool
}

// BaseResolutionContext mirrors TS BaseResolutionContext: the quote-line base
// mode override plus the plinth height B resolved from the kitchen plan.
// A nil BaseClearanceMm falls back to the module value (then 100); a non-nil
// zero overrides to 0 (wall elevation).
type BaseResolutionContext struct {
	BaseMode       string
	BaseClearanceMm *int
	PlinthSides    *PlinthSides
}

func isModuleBaseMode(v string) bool {
	switch v {
	case baseModeNone, baseModePlinthBoard, baseModePlinthStrip, baseModeLegs:
		return true
	}
	return false
}

// resolveModuleBaseMode: explicit valid module.BaseMode wins; unset → none
// (existing modules stay BOM-stable).
func resolveModuleBaseMode(module domain.Module) string {
	if isModuleBaseMode(module.BaseMode) {
		return module.BaseMode
	}
	return baseModeNone
}

// resolveModuleBaseClearanceMm mirrors TS resolveModuleBaseClearanceMm:
// override (plan B) wins; then the module value; then the 100 mm default.
func resolveModuleBaseClearanceMm(module domain.Module, overrideMm *int) int {
	if overrideMm != nil {
		return maxInt(0, *overrideMm)
	}
	if resolveModuleBaseMode(module) == baseModeNone {
		return 0
	}
	if module.BaseClearanceMm != nil {
		return maxInt(0, *module.BaseClearanceMm)
	}
	return defaultBaseClearanceMm
}

// ResolveBaseModeWithContext: the item override wins over the module default.
func ResolveBaseModeWithContext(module domain.Module, ctx *BaseResolutionContext) string {
	if ctx != nil && isModuleBaseMode(ctx.BaseMode) {
		return ctx.BaseMode
	}
	return resolveModuleBaseMode(module)
}

// ResolveBaseClearanceWithContext mirrors TS resolveBaseClearanceWithContext.
// The effective mode (item override included) decides whether a height exists
// at all — a module without its own baseMode must still honor the context
// mode's default height.
func ResolveBaseClearanceWithContext(module domain.Module, ctx *BaseResolutionContext) int {
	mode := ResolveBaseModeWithContext(module, ctx)
	if mode == baseModeNone {
		return 0
	}
	if ctx != nil && ctx.BaseClearanceMm != nil {
		return resolveModuleBaseClearanceMm(module, ctx.BaseClearanceMm)
	}
	if module.BaseClearanceMm != nil {
		return maxInt(0, *module.BaseClearanceMm)
	}
	return defaultBaseClearanceMm
}

// suggestLegCount mirrors TS workshopRules.suggestLegCount: 4 legs for
// cabinets ≤ 600 mm, 6 legs for wider cabinets.
func suggestLegCount(cabinetWidthMm int) int {
	if cabinetWidthMm <= 0 {
		return 0
	}
	if cabinetWidthMm <= 600 {
		return 4
	}
	return 6
}

// plinthStripMeters mirrors TS plinthStripMeters: front plinth length in
// meters with 3 decimals (lineFactor multiplies for returns).
func plinthStripMeters(widthMm int, lineFactor float64) float64 {
	w := math.Max(0, float64(widthMm))
	factor := 1.0
	if lineFactor > 0 && !math.IsInf(lineFactor, 0) {
		factor = lineFactor
	}
	return math.Round((w/1000)*factor*1000) / 1000
}

// plinthReturnDepthMm mirrors TS plinthReturnDepthMm: the return wraps this
// much less than D (front recess of the toe-kick).
func plinthReturnDepthMm(cabinetDepthMm int) int {
	recess := math.Min(50, math.Max(20, float64(cabinetDepthMm)*0.1))
	return maxInt(50, int(math.Round(float64(cabinetDepthMm)-recess)))
}

func isZocloBoardRole(optionRole string) bool {
	return strings.TrimSpace(optionRole) == zocloBoardRole
}

func isZocloStripRole(optionRole string) bool {
	return strings.TrimSpace(optionRole) == zocloStripRole
}

func isPatasRole(optionRole string) bool {
	return strings.TrimSpace(optionRole) == patasRole
}

// applyBaseModeToHardwareLines mirrors TS applyBaseModeToHardwareLines:
//   - ZOCLO_PERFIL only in plinth_strip; quantity becomes ml from width
//   - PATAS in legs, plinth_board and plinth_strip; quantity uses
//     suggestLegCount when the line quantity is a placeholder (0)
func applyBaseModeToHardwareLines(lines []domain.HardwareLine, mode string, widthMm int) []domain.HardwareLine {
	legsActive := mode == baseModeLegs || mode == baseModePlinthBoard || mode == baseModePlinthStrip
	out := make([]domain.HardwareLine, 0, len(lines))
	for _, line := range lines {
		role := strings.TrimSpace(line.OptionRole)
		if isZocloStripRole(role) {
			if mode != baseModePlinthStrip {
				continue
			}
			factor := 1.0
			if line.Quantity > 0 {
				factor = line.Quantity
			}
			converted := line
			converted.Quantity = plinthStripMeters(widthMm, factor)
			if strings.TrimSpace(converted.DescriptionOverride) == "" {
				converted.DescriptionOverride = "Zoclo perfil (ml)"
			}
			out = append(out, converted)
			continue
		}
		if isPatasRole(role) {
			if !legsActive {
				continue
			}
			converted := line
			if !(line.Quantity > 0) {
				converted.Quantity = float64(suggestLegCount(widthMm))
			}
			out = append(out, converted)
			continue
		}
		out = append(out, line)
	}
	return out
}

// synthesizeBaseBoardPart mirrors TS synthesizeBaseBoardPart (F087): the
// melamine plinth part the engine adds when the base mode asks for a board
// zoclo and the module carries no component with role ZOCLO.
// L = cabinet width, W = base height B, visible front edge banded.
func synthesizeBaseBoardPart(moduleCode string, widthMm, baseClearanceMm int) domain.BoardPart {
	return domain.BoardPart{
		ID:          fmt.Sprintf("%s%s", moduleCode, syntheticZocloPartIDSuffix),
		Code:        syntheticZocloPartCode,
		Description: "Zócalo (melamina)",
		Quantity:    1,
		LengthMm:    maxInt(0, widthMm),
		WidthMm:     maxInt(0, baseClearanceMm),
		Edges: []domain.EdgeAssignment{
			{Side: "L1", Enabled: true},
			{Side: "L2", Enabled: false},
			{Side: "W1", Enabled: false},
			{Side: "W2", Enabled: false},
		},
		OptionRole: zocloBoardRole,
	}
}

// synthesizeBaseHardwareLine mirrors TS synthesizeBaseHardwareLine:
// placeholder line (quantity 0) converted to ml or leg count by
// applyBaseModeToHardwareLines.
func synthesizeBaseHardwareLine(moduleCode, role string) domain.HardwareLine {
	suffix := "-patas-auto"
	if role == zocloStripRole {
		suffix = "-zoclo-perfil-auto"
	}
	return domain.HardwareLine{
		ID:         fmt.Sprintf("%s%s", moduleCode, suffix),
		Quantity:   0,
		OptionRole: role,
	}
}

// applyBaseTreatment mirrors TS applyBaseTreatment: append the synthesized
// base parts/lines the base mode needs and apply the mode's quantity rules.
// Modules that already carry their own ZOCLO part or ZOCLO_PERFIL/PATAS
// lines are left untouched (no double count — and no synthesized side
// returns either: modeled fronts own their sides). F088: exposed sides add
// melamine return parts / strip ml.
func applyBaseTreatment(
	moduleCode string,
	parts []domain.BoardPart,
	hardwareLines []domain.HardwareLine,
	mode string,
	baseClearanceMm, widthMm, depthMm int,
	plinthSides *PlinthSides,
	optionChoices map[string]string,
) ([]domain.BoardPart, []domain.HardwareLine) {
	partsOut := append([]domain.BoardPart(nil), parts...)
	hardwareOut := append([]domain.HardwareLine(nil), hardwareLines...)

	var exposedSides []string
	if plinthSides != nil {
		if plinthSides.Left {
			exposedSides = append(exposedSides, "left")
		}
		if plinthSides.Right {
			exposedSides = append(exposedSides, "right")
		}
		if plinthSides.Back {
			exposedSides = append(exposedSides, "back")
		}
	}
	returnDepth := plinthReturnDepthMm(depthMm)

	hasZocloBoardPart := false
	for _, p := range partsOut {
		if isZocloBoardRole(p.OptionRole) {
			hasZocloBoardPart = true
			break
		}
	}
	if mode == baseModePlinthBoard && baseClearanceMm > 0 && widthMm > 0 && !hasZocloBoardPart {
		partsOut = append(partsOut, synthesizeBaseBoardPart(moduleCode, widthMm, baseClearanceMm))
		for _, side := range exposedSides {
			partsOut = append(partsOut, domain.BoardPart{
				ID:          fmt.Sprintf("%s%s-lado-%s", moduleCode, syntheticZocloPartIDSuffix, side),
				Code:        syntheticZocloSideCode,
				Description: "Zócalo lateral (vuelta)",
				Quantity:    1,
				LengthMm:    returnDepth,
				WidthMm:     baseClearanceMm,
				Edges: []domain.EdgeAssignment{
					{Side: "L1", Enabled: true},
					{Side: "L2", Enabled: false},
					{Side: "W1", Enabled: false},
					{Side: "W2", Enabled: false},
				},
				OptionRole: zocloBoardRole,
			})
		}
	}

	hasStripLine := false
	for _, l := range hardwareOut {
		if isZocloStripRole(l.OptionRole) {
			hasStripLine = true
			break
		}
	}
	if mode == baseModePlinthStrip && !hasStripLine {
		// Placeholder quantity doubles as the ml factor (front + returns).
		returnsMm := len(exposedSides) * returnDepth
		ratio := 0.0
		if widthMm > 0 {
			ratio = float64(widthMm+returnsMm) / float64(widthMm)
		}
		line := synthesizeBaseHardwareLine(moduleCode, zocloStripRole)
		if ratio > 0 {
			line.Quantity = ratio
		}
		hardwareOut = append(hardwareOut, line)
	}

	// Adjustable legs support floor cabinets in every mode except none. The
	// plinth/strip just covers them. Guard: only synthesize when a PATAS
	// choice exists (projects without PATAS configured are unaffected).
	patasChoice := strings.TrimSpace(optionChoices[patasRole])
	hasPatasLine := false
	for _, l := range hardwareOut {
		if isPatasRole(l.OptionRole) {
			hasPatasLine = true
			break
		}
	}
	if mode != baseModeNone && !hasPatasLine && patasChoice != "" {
		hardwareOut = append(hardwareOut, synthesizeBaseHardwareLine(moduleCode, patasRole))
	}

	return partsOut, applyBaseModeToHardwareLines(hardwareOut, mode, widthMm)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
