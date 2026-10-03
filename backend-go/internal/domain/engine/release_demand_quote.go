package engine

import (
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// DeriveQuoteUnitProfileDemand derives one pricing unit's profile hardware
// demand (#917/#986) through the SAME definition-default governed resolve the
// release freeze runs (#875 slice 2) — the release path and the commercial
// path share one derivation, never two.
//
// Skip contract: units that cannot satisfy the release-unit contract contribute
// no demand, exactly because the freeze cannot derive any for them either —
// no pinned profiles (nothing governed exists yet), unknown definition,
// historical definition version, or a structure module whose pricing authority
// carries no explicit placement dimensions. A unit that DOES satisfy the
// contract fails closed on any resolve or machining error: a governed joint
// that cannot resolve must never silently price zero hardware.
func DeriveQuoteUnitProfileDemand(
	item domain.DesignRevisionItem,
	catalog domain.Catalog,
	server *ReleaseServerInputs,
) ([]HardwareProfileDemandLine, error) {
	if server == nil || len(server.ProfilesByID) == 0 {
		return nil, nil
	}
	if strings.TrimSpace(item.FurnitureInstanceID) == "" || strings.TrimSpace(item.FurnitureDefinitionID) == "" {
		return nil, nil
	}
	if item.DefinitionVersion != nil {
		// Historical definition resolution is unsupported on the release path;
		// the quote cannot derive demand the freeze could never derive either.
		return nil, nil
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
		return nil, nil
	}
	if _, err := releaseUnitLayoutDims(module, item); err != nil {
		// Preset-driven pricing authority without explicit placement dims: the
		// release path cannot derive this unit either (named limitation).
		return nil, nil
	}
	var budget releaseExpansionBudget
	unit, err := resolveReleaseUnit(item, catalog, &budget, nil)
	if err != nil {
		return nil, err
	}
	_, demand, err := deriveReleaseRoutingUnit(item, *unit, catalog, server)
	if err != nil {
		return nil, err
	}
	return demand, nil
}

// DeriveProjectProfileDemand derives the per-item demand matrix for one
// pricing project (#986): every item runs DeriveQuoteUnitProfileDemand with
// the organization's shared inputs, index-aligned with projectItems for
// CalcProjectBreakdownWithProfileDemand.
func DeriveProjectProfileDemand(
	pricingItems []domain.ProjectItem,
	catalog domain.Catalog,
	server *ReleaseServerInputs,
) ([][]HardwareProfileDemandLine, error) {
	matrix := make([][]HardwareProfileDemandLine, 0, len(pricingItems))
	for _, item := range pricingItems {
		demand, err := DeriveQuoteUnitProfileDemand(ProjectItemAsDemandUnit(item), catalog, server)
		if err != nil {
			return nil, err
		}
		matrix = append(matrix, demand)
	}
	return matrix, nil
}

// ProjectItemAsDemandUnit converts one pricing item into the release-unit item
// shape the demand derivation consumes. The physical identity is the pricing
// item id; explicit custom dimensions become the parameter dimensions the
// release-unit contract requires — the exact inverse of
// domain.CommercialDimsFromParameters, so the governed resolve sees the same
// placed truth the BOM priced.
func ProjectItemAsDemandUnit(item domain.ProjectItem) domain.DesignRevisionItem {
	converted := domain.DesignRevisionItem{
		FurnitureInstanceID:   item.ID,
		FurnitureDefinitionID: item.ModuleID,
		Parameters:            map[string]any{},
		MaterialChoices:       item.OptionChoices,
	}
	if item.CustomDims != nil {
		converted.Parameters["widthMm"] = float64(item.CustomDims.WidthMm)
		converted.Parameters["heightMm"] = float64(item.CustomDims.HeightMm)
		converted.Parameters["depthMm"] = float64(item.CustomDims.DepthMm)
	}
	return converted
}
