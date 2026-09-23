package engine

import (
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #826: consumability of material choices. Commercial materialization merges
// project-level option defaults without knowing what each physical definition
// consumes, so authored items can carry roles the release resolver rejects
// ("choice X is not consumed by the resolved definition"). The helpers here
// expose the exact consumed-role set — derived from the same resolve the
// release gate runs — so seeding surfaces converge BEFORE persisting, instead
// of failing at release time with a generic message.

// unitConsumption is one lenient resolution: the matched module, its resolved
// unit and the consumed-role map derived with the same logic the release gate
// uses.
type unitConsumption struct {
	module   domain.Module
	unit     *ResolvedReleaseUnit
	consumed map[string]string
}

// resolveUnitConsumption resolves leniently: the input may carry the full
// commercial seed with extra roles — exactly what callers want classified,
// not rejected here (the strict gate keeps owning rejection).
func resolveUnitConsumption(item domain.DesignRevisionItem, catalog domain.Catalog) (*unitConsumption, error) {
	unit, err := resolveReleaseUnitOpt(item, catalog, nil, false)
	if err != nil {
		return nil, err
	}
	module, err := catalogModuleByID(item.FurnitureDefinitionID, catalog)
	if err != nil {
		return nil, err
	}
	return &unitConsumption{
		module:   module,
		unit:     unit,
		consumed: ConsumedOptionRoles(module, item.MaterialChoices, catalog, unit.BOM),
	}, nil
}

// ResolveConsumedOptionRoles resolves one item's BOM and derives the exact
// consumed-role map (same semantics as the release gate). A resolve error
// means consumability is not computable for this item; callers that are not
// the release gate treat it as "skip the check" — the release gate stays the
// final backstop.
func ResolveConsumedOptionRoles(item domain.DesignRevisionItem, catalog domain.Catalog) (map[string]string, error) {
	resolved, err := resolveUnitConsumption(item, catalog)
	if err != nil {
		return nil, err
	}
	return resolved.consumed, nil
}

// IntersectConsumedOptionChoices filters an effective choice map down to the
// roles the item's definition consumes. BOM-neutral by construction: roles the
// resolved BOM does not consume cannot affect pricing, so dropping them never
// changes the frozen commercial truth's amounts. Skipped (ok=false, choices
// untouched) when the unit cannot resolve, and when the BOM carries NO
// manufacturing demand at all (no board parts and no hardware lines): an
// empty demand set proves nothing about any role — dropping choices there
// would fabricate commercial deltas while the release gate already blocks the
// unit for zero demand. A hardware-only BOM (fixed-ID lines, zero consumed
// roles) IS valid demand, so surplus roles converge there.
//
// Base-treatment roles (ZOCLO, ZOCLO_PERFIL, PATAS) are NEVER dropped: their
// consumption depends on the effective base context (project/line/preset),
// which this module-default resolve cannot see. Dropping them could desync
// the frozen choices from the pricing BOM.
func IntersectConsumedOptionChoices(item domain.DesignRevisionItem, catalog domain.Catalog) (choices map[string]string, ok bool) {
	resolved, err := resolveUnitConsumption(item, catalog)
	if err != nil {
		return item.MaterialChoices, false
	}
	if len(resolved.unit.BOM.BoardParts) == 0 && len(resolved.unit.BOM.HardwareLines) == 0 {
		return item.MaterialChoices, false
	}
	filtered := make(map[string]string, len(item.MaterialChoices))
	for role, id := range item.MaterialChoices {
		if _, consumedRole := resolved.consumed[role]; consumedRole || baseTreatmentRoles[role] {
			filtered[role] = id
		}
	}
	return filtered, true
}

// baseTreatmentRoles are synthesized/filtered by the effective base context
// (base_treatment.go); their consumability is not derivable from the
// module-default resolve alone.
var baseTreatmentRoles = map[string]bool{
	"ZOCLO":        true,
	"ZOCLO_PERFIL": true,
	"PATAS":        true,
}

func catalogModuleByID(id string, catalog domain.Catalog) (domain.Module, error) {
	for _, candidate := range catalog.Modules {
		if candidate.ID == id {
			return candidate, nil
		}
	}
	return domain.Module{}, fmt.Errorf("catalog module %s not found", id)
}
