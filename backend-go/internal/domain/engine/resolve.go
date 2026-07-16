package engine

import (
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ResolveBom validates a module and resolves material/edge/hardware IDs
// (mirrors packages/domain resolveBom). Grain is inherited from material.
func ResolveBom(
	module domain.Module,
	optionChoices map[string]string,
	catalog domain.Catalog,
) (domain.ResolvedBom, error) {
	if err := ValidateModule(module); err != nil {
		return domain.ResolvedBom{}, err
	}

	boardParts := make([]domain.ResolvedBoardPart, 0, len(module.BoardParts))
	for _, part := range module.BoardParts {
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
