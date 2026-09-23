package engine

import (
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #826: consumability of material choices. Commercial materialization merges
// project-level option defaults without knowing what each physical definition
// consumes, so authored items can carry roles the release resolver would
// reject ("choice X is not consumed by the resolved definition"). The helpers
// here expose the exact consumed-role set — derived from the same resolve the
// release gate runs — so seeding surfaces intersect BEFORE persisting and
// authoring boundaries reject BEFORE freezing, instead of failing at release
// time with a generic message.

// ResolveConsumedOptionRoles resolves one item's BOM and derives the exact
// consumed-role map (same semantics as the release gate). A resolve error
// means consumability is not computable for this item; callers that are not
// the release gate treat it as "skip the check" — the release gate stays the
// final backstop.
func ResolveConsumedOptionRoles(item domain.DesignRevisionItem, catalog domain.Catalog) (map[string]string, error) {
	// Lenient resolve: the input may carry the full commercial seed with extra
	// roles — exactly what the caller wants classified, not rejected here.
	unit, err := resolveReleaseUnitOpt(item, catalog, nil, false)
	if err != nil {
		return nil, err
	}
	module, err := catalogModuleByID(item.FurnitureDefinitionID, catalog)
	if err != nil {
		return nil, err
	}
	return ConsumedOptionRoles(module, item.MaterialChoices, catalog, unit.BOM), nil
}

// IntersectConsumedOptionChoices filters an effective choice map down to the
// roles the item's definition consumes. BOM-neutral by construction: roles the
// resolved BOM does not consume cannot affect pricing, so dropping them never
// changes the frozen commercial truth's amounts. When the unit cannot resolve,
// the choices are returned unchanged (ok=false): legacy/quote-only units keep
// today's behavior and remain guarded by the release gate.
//
// Base-treatment roles (ZOCLO, ZOCLO_PERFIL, PATAS) are NEVER dropped: their
// consumption depends on the effective base context (project/line/preset),
// which this module-default resolve cannot see. Dropping them could desync
// the frozen choices from the pricing BOM.
func IntersectConsumedOptionChoices(item domain.DesignRevisionItem, catalog domain.Catalog) (choices map[string]string, ok bool) {
	consumed, err := ResolveConsumedOptionRoles(item, catalog)
	if err != nil {
		return item.MaterialChoices, false
	}
	if len(consumed) == 0 {
		// Degenerate definition (e.g. gutted structure → zero demand): an
		// empty consumed set proves nothing about any role, and dropping
		// authored choices here would fabricate commercial deltas. The
		// release gate already blocks these units for zero demand.
		return item.MaterialChoices, false
	}
	filtered := make(map[string]string, len(item.MaterialChoices))
	for role, id := range item.MaterialChoices {
		if _, consumedRole := consumed[role]; consumedRole || baseTreatmentRoles[role] {
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
