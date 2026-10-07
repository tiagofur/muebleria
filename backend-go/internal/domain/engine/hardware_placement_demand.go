package engine

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1210 — placement-derived hardware demand. A component-instance placement
// is a physical hinge/handle: it is DEMAND, not just geometry. The positions
// WIN over module bulk lines of the same resolved hardware (single source of
// truth, mirroring the TS agregado rule in agregados.ts) and become
// POSITIONED resolved lines that price through the same catalog validation
// and unit price as manual lines.
//
// Scope: module components + structure components. Agregado instances keep
// their own TS-side dedupe (resolveAgregadoInstance); extending the Go
// agregado scope needs the per-instance bulk restructure noted in the ODD.
//
// Semantics mirror the #1046 layout resolve and the agregado rule:
//   - a concrete hardwareId wins; otherwise the optionRole resolves through
//     the effective option choices (item ⊕ project level);
//   - a role WITHOUT an effective choice contributes nothing — the quote gate
//     blocks required groups before pricing and the release gate fails
//     closed; skipping keeps legacy quotes stable;
//   - a placement with NEITHER field is an authoring error (#1147): fail
//     closed, never silently $0;
//   - a resolved choice pointing at missing/inactive hardware errors exactly
//     like a broken bulk line.
//
// Component-instance quantity multiplies the count; structure components ride
// the module's pinned/live structure via the catalog.
func collectPlacementHardwareDemand(
	module domain.Module,
	catalog domain.Catalog,
	optionChoices map[string]string,
) (map[string]int, []domain.ResolvedHardwareLine, error) {
	instances := make([]domain.ComponentInstance, 0, len(module.Components)+2)
	instances = append(instances, module.Components...)
	if strings.TrimSpace(module.StructureID) != "" {
		if st, ok := findStructure(catalog, module.StructureID); ok {
			instances = append(instances, st.Components...)
		}
	}

	counts := make(map[string]int)
	for _, inst := range instances {
		if inst.Overrides == nil || len(inst.Overrides.HardwarePlacements) == 0 {
			continue
		}
		qty := inst.Quantity
		if qty <= 0 {
			qty = 1
		}
		for _, p := range inst.Overrides.HardwarePlacements {
			if p.HardwareID == "" && strings.TrimSpace(p.OptionRole) == "" {
				return nil, nil, fmt.Errorf(
					"hardware placement on component %s has neither hardwareId nor optionRole (#1147)",
					inst.ComponentID,
				)
			}
			// Skip the unresolved-role case BEFORE ResolveHardware so a
			// missing choice is a silent no-line, not a quote failure.
			if p.HardwareID == "" && strings.TrimSpace(optionChoices[p.OptionRole]) == "" {
				continue
			}
			hw, err := ResolveHardware(domain.HardwareLine{
				ID:         "placement-" + inst.ComponentID,
				OptionRole: p.OptionRole,
				HardwareID: p.HardwareID,
			}, optionChoices, catalog.Hardware)
			if err != nil {
				return nil, nil, fmt.Errorf("placement demand on component %s: %w", inst.ComponentID, err)
			}
			counts[hw.ID] += qty
		}
	}

	positioned := make([]domain.ResolvedHardwareLine, 0, len(counts))
	for hwID, quantity := range counts {
		positioned = append(positioned, domain.ResolvedHardwareLine{
			ID:         "placement-mod-" + hwID,
			Quantity:   float64(quantity),
			OptionRole: "POSITIONED",
			HardwareID: hwID,
		})
	}
	return counts, positioned, nil
}

// resolvedBulkHardwareID mirrors ResolveHardware's id precedence for DEDUPE
// only: a concrete id wins, otherwise the effective choice for the role. An
// unresolved role returns "" (the line is kept — the main resolution loop
// surfaces the real fail-closed error).
func resolvedBulkHardwareID(line domain.HardwareLine, optionChoices map[string]string) string {
	if id := strings.TrimSpace(line.HardwareID); id != "" {
		return id
	}
	return strings.TrimSpace(optionChoices[line.OptionRole])
}
