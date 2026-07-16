package engine

import (
	"errors"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type BoardLineCost struct {
	AreaM2       float64 `json:"area_m2"`
	EdgeMl       float64 `json:"edge_ml"`
	BoardCost    float64 `json:"board_cost"`
	EdgeCost     float64 `json:"edge_cost"`
	HardwareCost float64 `json:"hardware_cost"`
}

type HardwareLineCost struct {
	AreaM2       float64 `json:"area_m2"`
	EdgeMl       float64 `json:"edge_ml"`
	BoardCost    float64 `json:"board_cost"`
	EdgeCost     float64 `json:"edge_cost"`
	HardwareCost float64 `json:"hardware_cost"`
}

func CalcMaterialCostPerM2(widthMm, lengthMm int, boardPrice, wastePercent float64) float64 {
	if widthMm <= 0 || lengthMm <= 0 {
		return 0
	}
	areaM2 := float64(widthMm*lengthMm) / 1000000.0
	baseCost := boardPrice / areaM2
	return baseCost * (1.0 + wastePercent/100.0)
}

// edgeFlags maps L1/L2/W1/W2 → 0|1. Unknown sides are ignored here;
// callers must run ValidateBoardPart first so typos never reach cost math.
func edgeFlags(edges []domain.EdgeAssignment) map[string]int {
	flags := map[string]int{"L1": 0, "L2": 0, "W1": 0, "W2": 0}
	for _, e := range edges {
		if _, ok := validEdgeSide[e.Side]; !ok {
			continue
		}
		if e.Enabled {
			flags[e.Side] = 1
		}
	}
	return flags
}

func hasAnyEdgeEnabled(edges []domain.EdgeAssignment) bool {
	for _, e := range edges {
		if e.Enabled {
			return true
		}
	}
	return false
}

func CalcBoardLineMetrics(part domain.BoardPart, qtyMultiplier int) (float64, float64) {
	qty := part.Quantity * qtyMultiplier
	flags := edgeFlags(part.Edges)
	
	areaM2 := float64(qty*part.LengthMm*part.WidthMm) / 1000000.0
	
	lSum := flags["L1"] + flags["L2"]
	wSum := flags["W1"] + flags["W2"]
	edgeMl := float64(qty*(lSum*part.LengthMm+wSum*part.WidthMm)) / 1000.0
	
	return areaM2, edgeMl
}

func ResolveEdgeBand(part domain.BoardPart, material domain.MaterialBoard, optionChoices map[string]string, edges []domain.EdgeBand) (*domain.EdgeBand, error) {
	if !hasAnyEdgeEnabled(part.Edges) {
		return nil, nil
	}

	explicitID, ok := optionChoices["EDGE"]
	if ok && explicitID != "" {
		for _, e := range edges {
			if e.ID == explicitID {
				if !e.Active {
					return nil, fmt.Errorf("inactive edge band cannot be used: %s", e.Code)
				}
				return &e, nil
			}
		}
		return nil, fmt.Errorf("edge band not found for choice: %s", explicitID)
	}

	if material.DefaultEdgeBandID == "" {
		return nil, fmt.Errorf("missing edge band for part %s (no EDGE choice and material '%s' has no default_edge_band_id)", part.Code, material.Code)
	}

	for _, e := range edges {
		if e.ID == material.DefaultEdgeBandID {
			if !e.Active {
				return nil, fmt.Errorf("inactive default edge band cannot be used: %s", e.Code)
			}
			return &e, nil
		}
	}

	return nil, fmt.Errorf("default edge band not found: %s (material '%s')", material.DefaultEdgeBandID, material.Code)
}

func ResolveMaterial(part domain.BoardPart, optionChoices map[string]string, materials []domain.MaterialBoard) (*domain.MaterialBoard, error) {
	choiceID, ok := optionChoices[part.OptionRole]
	if !ok || choiceID == "" {
		return nil, fmt.Errorf("missing option choice for role '%s' on part %s", part.OptionRole, part.Code)
	}

	for _, m := range materials {
		if m.ID == choiceID {
			if !m.Active {
				return nil, fmt.Errorf("inactive material cannot be used: %s", m.Code)
			}
			return &m, nil
		}
	}

	return nil, fmt.Errorf("material not found for choice: %s", choiceID)
}

func ResolveHardware(line domain.HardwareLine, optionChoices map[string]string, hardware []domain.Hardware) (*domain.Hardware, error) {
	hardwareID := line.HardwareID
	if hardwareID == "" {
		var ok bool
		hardwareID, ok = optionChoices[line.OptionRole]
		if !ok || hardwareID == "" {
			return nil, fmt.Errorf("missing hardware choice for role '%s' on line %s", line.OptionRole, line.ID)
		}
	}

	for _, h := range hardware {
		if h.ID == hardwareID {
			if !h.Active {
				return nil, fmt.Errorf("inactive hardware cannot be used: %s", h.Code)
			}
			return &h, nil
		}
	}

	return nil, fmt.Errorf("hardware not found for ID: %s", hardwareID)
}

func CalcBoardLineCost(part domain.BoardPart, material domain.MaterialBoard, edgeBand *domain.EdgeBand, qtyMultiplier int) (BoardLineCost, error) {
	if part.LengthMm <= 0 || part.WidthMm <= 0 {
		return BoardLineCost{}, fmt.Errorf(
			"board part dimensions must be > 0 (lengthMm=%d, widthMm=%d)",
			part.LengthMm, part.WidthMm,
		)
	}
	if part.Quantity <= 0 {
		return BoardLineCost{}, fmt.Errorf("board part quantity must be > 0 (got %d)", part.Quantity)
	}
	if !material.Active {
		return BoardLineCost{}, fmt.Errorf("inactive material cannot be used: %s", material.Code)
	}

	areaM2, edgeMl := CalcBoardLineMetrics(part, qtyMultiplier)
	boardCost := areaM2 * material.CostPerM2

	edgeCost := 0.0
	if hasAnyEdgeEnabled(part.Edges) {
		if edgeBand == nil {
			return BoardLineCost{}, fmt.Errorf("missing resolved edgeBand for part: %s", part.Code)
		}
		// Mirrors TS calcBoardLineCost: reject inactive edge even if already resolved.
		if !edgeBand.Active {
			return BoardLineCost{}, fmt.Errorf("inactive edge band cannot be used: %s", edgeBand.Code)
		}
		edgeCost = edgeMl * edgeBand.CostPerMl
	}

	return BoardLineCost{
		AreaM2:    areaM2,
		EdgeMl:    edgeMl,
		BoardCost: boardCost,
		EdgeCost:  edgeCost,
	}, nil
}

func CalcProjectBreakdown(project domain.Project, catalog domain.Catalog) (domain.QuoteBreakdown, error) {
	if project.MarginFactor <= 0 {
		return domain.QuoteBreakdown{}, errors.New("margin factor must be > 0")
	}
	if project.LaborFixedCost < 0 {
		return domain.QuoteBreakdown{}, errors.New("labor fixed cost must be >= 0")
	}

	// Si el proyecto ya está cerrado (quoted/accepted) y tiene un snapshot, se devuelve el snapshot congelado
	if (project.Status == domain.StatusQuoted || project.Status == domain.StatusAccepted) && project.PriceSnapshot != nil {
		return project.PriceSnapshot.Breakdown, nil
	}

	var materialsCost float64
	var edgeTotal float64
	var hardwareTotal float64
	var laborModular float64

	modulesMap := make(map[string]domain.Module)
	for _, m := range catalog.Modules {
		modulesMap[m.ID] = m
	}

	for _, item := range project.Items {
		// Mirrors TS calcLiveProjectBreakdown: reject non-positive item qty.
		if item.Quantity <= 0 {
			return domain.QuoteBreakdown{}, fmt.Errorf(
				"project item quantity must be > 0 (got %d)", item.Quantity,
			)
		}

		module, ok := modulesMap[item.ModuleID]
		if !ok {
			return domain.QuoteBreakdown{}, fmt.Errorf("module not found for project item: %s", item.ModuleID)
		}

		// Structural module validation before any cost math (TS: resolveBom → validateModule).
		if err := ValidateModule(module); err != nil {
			return domain.QuoteBreakdown{}, err
		}

		choices := choicesForItem(project, item)

		for _, part := range module.BoardParts {
			material, err := ResolveMaterial(part, choices, catalog.Materials)
			if err != nil {
				return domain.QuoteBreakdown{}, err
			}
			edgeBand, err := ResolveEdgeBand(part, *material, choices, catalog.Edges)
			if err != nil {
				return domain.QuoteBreakdown{}, err
			}

			lineCost, err := CalcBoardLineCost(part, *material, edgeBand, item.Quantity)
			if err != nil {
				return domain.QuoteBreakdown{}, err
			}

			materialsCost += lineCost.BoardCost
			edgeTotal += lineCost.EdgeCost
		}

		for _, line := range module.HardwareLines {
			hw, err := ResolveHardware(line, choices, catalog.Hardware)
			if err != nil {
				return domain.QuoteBreakdown{}, err
			}

			// Cast each qty to float64 before multiply — int*int can overflow
			// on 32-bit before conversion (issue #10; TS multiplies as float).
			lineCost := float64(line.Quantity) * float64(item.Quantity) * hw.CostPerUnit
			hardwareTotal += lineCost
		}

		laborModular += float64(item.Quantity) * module.BaseLaborCost
	}

	directCost := materialsCost + edgeTotal + hardwareTotal

	// Sale formula: (direct_cost * margin_factor) + modular_labor + fixed_labor.
	// No intermediate rounding — same policy as packages/domain (TS). Display/export
	// layers round to 2 decimals for presentation only (issue #7).
	salePrice := directCost*project.MarginFactor + laborModular + project.LaborFixedCost

	return domain.QuoteBreakdown{
		MaterialsCost:  materialsCost,
		EdgeTotal:      edgeTotal,
		HardwareTotal:  hardwareTotal,
		DirectCost:     directCost,
		LaborModular:   laborModular,
		LaborFixedCost: project.LaborFixedCost,
		MarginFactor:   project.MarginFactor,
		SalePrice:      salePrice,
	}, nil
}
