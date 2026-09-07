package engine

import (
	"fmt"
	"math"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// RequirementLinesFromProject aggregates planning demand through the existing
// BOM engine. It does not capture a release or adapt authoring parameters.
func RequirementLinesFromProject(project domain.Project, catalog domain.Catalog) ([]domain.MaterialRequirementLine, error) {
	layout, err := parseKitchenLayoutBase(project.KitchenLayout)
	if err != nil {
		return nil, err
	}
	areas, edges := map[string]float64{}, map[string]float64{}
	hasHardware := false
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
		for _, part := range bom.BoardParts {
			// Bound integer arithmetic before using the shared metrics helper;
			// values outside JS's exact integer range cannot have TS/Go parity.
			areaMm2 := float64(part.Quantity) * float64(item.Quantity) * float64(part.LengthMm) * float64(part.WidthMm)
			perimeterMm := float64(part.Quantity) * float64(item.Quantity) * 2 * (float64(part.LengthMm) + float64(part.WidthMm))
			if part.Quantity <= 0 || part.LengthMm <= 0 || part.WidthMm <= 0 || areaMm2 > 9007199254740991 || perimeterMm > 9007199254740991 {
				return nil, fmt.Errorf("board metrics exceed supported integer range: %s", part.ID)
			}
			area, edge := CalcBoardLineMetrics(domain.BoardPart{
				Quantity: part.Quantity, LengthMm: part.LengthMm, WidthMm: part.WidthMm, Edges: part.Edges,
			}, item.Quantity)
			if !positiveFinite(area) || math.IsNaN(edge) || math.IsInf(edge, 0) || edge < 0 {
				return nil, fmt.Errorf("invalid board metrics: %s", part.ID)
			}
			areas[part.MaterialID] += area
			if edge > 0 {
				if part.EdgeBandID == "" {
					return nil, fmt.Errorf("missing resolved edge: %s", part.ID)
				}
				edges[part.EdgeBandID] += edge
			}
		}
		for _, line := range bom.HardwareLines {
			if !positiveFinite(line.Quantity) {
				return nil, fmt.Errorf("invalid hardware quantity: %s", line.ID)
			}
			hw, ok := findHardware(catalog, line.HardwareID)
			if !ok || (hw.PackageSize != nil && !positiveFinite(*hw.PackageSize)) {
				return nil, fmt.Errorf("invalid hardware package: %s", line.HardwareID)
			}
			hasHardware = true
		}
	}
	lines := make([]domain.MaterialRequirementLine, 0)
	if hasHardware {
		rows, err := GenerateHardwareList(project, catalog)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			lines = append(lines, domain.MaterialRequirementLine{Kind: "herrajes", MaterialID: row.HardwareID, Quantity: row.PurchaseQuantity})
		}
	}
	for id, area := range areas {
		var material *domain.MaterialBoard
		for i := range catalog.Materials {
			if catalog.Materials[i].ID == id {
				material = &catalog.Materials[i]
				break
			}
		}
		if material == nil || material.WidthMm <= 0 || material.LengthMm <= 0 ||
			math.IsNaN(material.WastePercent) || math.IsInf(material.WastePercent, 0) {
			return nil, fmt.Errorf("invalid sheet dimensions or waste: %s", id)
		}
		sheetArea := float64(material.WidthMm) * float64(material.LengthMm) / 1e6
		quantity := math.Max(1, math.Ceil(area*(1+math.Max(0, material.WastePercent)/100)/sheetArea-1e-12))
		lines = append(lines, domain.MaterialRequirementLine{Kind: "tableros", MaterialID: id, Quantity: quantity})
	}
	for id, quantity := range edges {
		lines = append(lines, domain.MaterialRequirementLine{Kind: "cintillas", MaterialID: id, Quantity: quantity})
	}
	for _, line := range lines {
		if line.MaterialID == "" || !positiveFinite(line.Quantity) {
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
