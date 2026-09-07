package engine

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ResolvedReleaseCollection is transient server-owned assembly, not another
// release or persisted snapshot. BOM rows retain their existing quantities;
// their IDs are not newly manufactured physical occurrence identities.
type ResolvedReleaseCollection struct {
	Units        []ResolvedReleaseUnit
	Requirements []domain.MaterialRequirementLine
}

// ResolveReleaseCollection assembles exact revision units through the existing
// engines. The caller owns tenant/project authorization, coherent catalog capture,
// canonical release pins and persistence. No mutable project items are consumed.
func ResolveReleaseCollection(designRevisionID string, items []domain.DesignRevisionItem, catalog domain.Catalog) (*ResolvedReleaseCollection, error) {
	if strings.TrimSpace(designRevisionID) == "" || len(items) == 0 || len(items) > releaseUnitExpansionLimit {
		return nil, fmt.Errorf("release collection requires an exact revision and 1..%d physical units", releaseUnitExpansionLimit)
	}
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		if item.DesignRevisionID != designRevisionID {
			return nil, fmt.Errorf("release collection item must belong to the exact revision")
		}
		if strings.TrimSpace(item.FurnitureInstanceID) == "" || seen[item.FurnitureInstanceID] {
			return nil, fmt.Errorf("release collection requires unique nonempty physical identities")
		}
		seen[item.FurnitureInstanceID] = true
	}

	var budget releaseExpansionBudget
	units := make([]ResolvedReleaseUnit, 0, len(items))
	inputs := make([]ResolvedRequirementInput, 0, len(items))
	for _, item := range items {
		unit, err := resolveReleaseUnit(item, catalog, &budget)
		if err != nil {
			return nil, fmt.Errorf("release collection unit %s: %w", item.FurnitureInstanceID, err)
		}
		if len(unit.BOM.BoardParts) == 0 && len(unit.BOM.HardwareLines) == 0 {
			return nil, fmt.Errorf("release collection unit %s has no manufacturing demand", item.FurnitureInstanceID)
		}
		units = append(units, *unit)
		inputs = append(inputs, ResolvedRequirementInput{BOM: unit.BOM, PhysicalQuantity: 1})
	}
	// Round sheets and hardware packages only after all physical units contribute.
	requirements, err := RequirementLinesFromResolvedBOMs(inputs, catalog)
	if err != nil {
		return nil, fmt.Errorf("release collection requirements: %w", err)
	}
	return &ResolvedReleaseCollection{Units: units, Requirements: requirements}, nil
}
