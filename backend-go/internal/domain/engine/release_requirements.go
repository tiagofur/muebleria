package engine

import (
	"fmt"
	"math"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

const maxExactRequirementQuantity = 9007199254740991

// ResolvedRequirementInput retains resolved quantities; physical release units
// use PhysicalQuantity 1 rather than reconstructing mutable project items.
type ResolvedRequirementInput struct {
	BOM              domain.ResolvedBom
	PhysicalQuantity int
}

// RequirementLinesFromProject aggregates planning demand through the existing
// BOM engine. It does not capture a release or adapt authoring parameters.
func RequirementLinesFromProject(project domain.Project, catalog domain.Catalog) ([]domain.MaterialRequirementLine, error) {
	layout, err := parseKitchenLayoutBase(project.KitchenLayout)
	if err != nil {
		return nil, err
	}
	inputs := make([]ResolvedRequirementInput, 0, len(project.Items))
	for _, item := range project.Items {
		if item.Quantity <= 0 {
			return nil, fmt.Errorf("project item quantity must be positive")
		}
		module, ok := findModule(catalog, item.ModuleID)
		if !ok {
			return nil, fmt.Errorf("module not found: %s", item.ModuleID)
		}
		bom, err := ResolveBomWithContext(module, choicesForItem(project, item), catalog,
			resolveBaseContextForItem(layout, project, item, &catalog), item.MeasurePresetID,
			item.StructureRevisionPin, item.CustomDims)
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, ResolvedRequirementInput{BOM: bom, PhysicalQuantity: item.Quantity})
	}
	return RequirementLinesFromResolvedBOMs(inputs, catalog)
}

// RequirementLinesFromResolvedBOMs aggregates without resolving catalog modules.
// All rounding happens after collection totals. Callers own coherent catalog
// selection, physical identity and nonempty manufacturing policy.
func RequirementLinesFromResolvedBOMs(inputs []ResolvedRequirementInput, catalog domain.Catalog) ([]domain.MaterialRequirementLine, error) {
	areas, edges := map[string]float64{}, map[string]float64{}
	areaBoundsMm2, edgeBoundsMm := map[string]float64{}, map[string]float64{}
	consumedHardware := map[string]float64{}
	maxMetricInteger := math.Min(maxExactRequirementQuantity, float64(int(^uint(0)>>1)))
	for _, input := range inputs {
		if input.PhysicalQuantity <= 0 || float64(input.PhysicalQuantity) > maxMetricInteger {
			return nil, fmt.Errorf("physical quantity exceeds supported integer range")
		}
		bom := input.BOM
		for _, part := range bom.BoardParts {
			// Bound integer arithmetic before using the shared metrics helper;
			// values outside JS's exact integer range cannot have TS/Go parity.
			areaMm2 := float64(part.Quantity) * float64(input.PhysicalQuantity) * float64(part.LengthMm) * float64(part.WidthMm)
			perimeterMm := float64(part.Quantity) * float64(input.PhysicalQuantity) * 2 * (float64(part.LengthMm) + float64(part.WidthMm))
			if part.Quantity <= 0 || part.LengthMm <= 0 || part.WidthMm <= 0 || areaMm2 > maxMetricInteger || perimeterMm > maxMetricInteger {
				return nil, fmt.Errorf("board metrics exceed supported integer range: %s", part.ID)
			}
			area, edge := CalcBoardLineMetrics(domain.BoardPart{
				Quantity: part.Quantity, LengthMm: part.LengthMm, WidthMm: part.WidthMm, Edges: part.Edges,
			}, input.PhysicalQuantity)
			if !positiveFinite(area) || math.IsNaN(edge) || math.IsInf(edge, 0) || edge < 0 {
				return nil, fmt.Errorf("invalid board metrics: %s", part.ID)
			}
			// Check integer-domain totals before unit conversion can erase a tiny
			// increment near 2^53; perimeter is a conservative edge upper bound.
			if !addRequirementQuantity(areaBoundsMm2, part.MaterialID, areaMm2, maxMetricInteger) {
				return nil, fmt.Errorf("aggregate board area exceeds supported range: %s", part.MaterialID)
			}
			areas[part.MaterialID] += area
			if edge > 0 {
				if part.EdgeBandID == "" {
					return nil, fmt.Errorf("missing resolved edge: %s", part.ID)
				}
				edgeBand, ok := findEdgeBand(catalog, part.EdgeBandID)
				if !ok || !edgeBand.Active || !addRequirementQuantity(edgeBoundsMm, part.EdgeBandID, perimeterMm, maxMetricInteger) {
					return nil, fmt.Errorf("invalid aggregate edge demand: %s", part.EdgeBandID)
				}
				edges[part.EdgeBandID] += edge
			}
		}
		for _, line := range bom.HardwareLines {
			if !positiveFinite(line.Quantity) {
				return nil, fmt.Errorf("invalid hardware quantity: %s", line.ID)
			}
			hw, ok := findHardware(catalog, line.HardwareID)
			if !ok || !hw.Active || (hw.PackageSize != nil && !positiveFinite(*hw.PackageSize)) {
				return nil, fmt.Errorf("invalid hardware package: %s", line.HardwareID)
			}
			if !addRequirementQuantity(consumedHardware, hw.ID, line.Quantity*float64(input.PhysicalQuantity), maxExactRequirementQuantity) {
				return nil, fmt.Errorf("hardware demand exceeds supported numeric range: %s", hw.ID)
			}
		}
	}
	lines := make([]domain.MaterialRequirementLine, 0)
	for id, consumed := range consumedHardware {
		hw, _ := findHardware(catalog, id)
		// Bound the rounded package count before the shared helper converts to int.
		if hw.PackageSize != nil && math.Ceil(consumed / *hw.PackageSize) > maxMetricInteger {
			return nil, fmt.Errorf("hardware package count exceeds supported range: %s", id)
		}
		quantity, _, _ := roundHardwarePurchaseQuantity(consumed, hw.PackageSize)
		lines = append(lines, domain.MaterialRequirementLine{Kind: "herrajes", MaterialID: id, Quantity: quantity})
	}
	for id, area := range areas {
		var material *domain.MaterialBoard
		for i := range catalog.Materials {
			if catalog.Materials[i].ID == id {
				material = &catalog.Materials[i]
				break
			}
		}
		if material == nil || !material.Active || material.WidthMm <= 0 || material.LengthMm <= 0 ||
			math.IsNaN(material.WastePercent) || math.IsInf(material.WastePercent, 0) {
			return nil, fmt.Errorf("invalid sheet dimensions or waste: %s", id)
		}
		sheetArea := float64(material.WidthMm) * float64(material.LengthMm) / 1e6
		adjustedArea := area * (1 + math.Max(0, material.WastePercent)/100)
		if !positiveFinite(adjustedArea) || adjustedArea > maxExactRequirementQuantity {
			return nil, fmt.Errorf("board waste exceeds supported numeric range: %s", id)
		}
		quantity := math.Max(1, math.Ceil(adjustedArea/sheetArea-1e-12))
		lines = append(lines, domain.MaterialRequirementLine{Kind: "tableros", MaterialID: id, Quantity: quantity})
	}
	for id, quantity := range edges {
		lines = append(lines, domain.MaterialRequirementLine{Kind: "cintillas", MaterialID: id, Quantity: quantity})
	}
	for _, line := range lines {
		if line.MaterialID == "" || !positiveFinite(line.Quantity) || line.Quantity > maxExactRequirementQuantity {
			return nil, fmt.Errorf("invalid requirement: %s", line.MaterialID)
		}
	}
	sort.Slice(lines, func(i, j int) bool {
		if lines[i].Kind != lines[j].Kind {
			return lines[i].Kind < lines[j].Kind
		}
		return lines[i].MaterialID < lines[j].MaterialID
	})
	return lines, nil
}

func positiveFinite(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func addRequirementQuantity(totals map[string]float64, id string, quantity, maximum float64) bool {
	if id == "" || !positiveFinite(quantity) || quantity > maximum-totals[id] {
		return false
	}
	totals[id] += quantity
	return true
}
