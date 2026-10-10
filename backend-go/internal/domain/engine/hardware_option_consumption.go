package engine

import (
	"sort"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1252 — UI projection for the SketchUp Design Inspector: which hardware
// option groups (kind=hardware codes) a module definition CONSUMES through
// por-grupo demand. The walk mirrors collectPlacementHardwareDemand (#1210)
// minus choice resolution: a role is consumed when a demand carrier declares
// optionRole with no concrete hardwareId, whether or not the design already
// chose a member. Demand carriers:
//   - module bulk HardwareLines (HardwareLine.OptionRole, HardwareID empty)
//   - module component-instance placement overrides
//   - structure component-instance placements (via StructureID)
//   - agregado instances: agregado component placements + agregado bulk lines
//
// A placement with a concrete hardwareId never consumes a group (the concrete
// id wins at resolve). Read-only projection: never mutates, never resolves
// prices, and a missing structure/agregado reference contributes nothing —
// the endpoint fails closed per definition, not per request.
func CollectModuleConsumedHardwareRoles(module domain.Module, catalog domain.Catalog) []string {
	roles := map[string]bool{}
	consume := func(role, hardwareID string) {
		role = strings.TrimSpace(role)
		if role != "" && strings.TrimSpace(hardwareID) == "" {
			roles[role] = true
		}
	}

	for _, line := range module.HardwareLines {
		consume(line.OptionRole, line.HardwareID)
	}

	instances := make([]domain.ComponentInstance, 0, len(module.Components)+2)
	instances = append(instances, module.Components...)
	if strings.TrimSpace(module.StructureID) != "" {
		if st, ok := findStructure(catalog, module.StructureID); ok {
			instances = append(instances, st.Components...)
		}
	}
	for _, inst := range instances {
		if inst.Overrides == nil {
			continue
		}
		for _, p := range inst.Overrides.HardwarePlacements {
			consume(p.OptionRole, p.HardwareID)
		}
	}

	for _, aggInstance := range module.Agregados {
		agg, ok := findAgregado(catalog, aggInstance.AgregadoID)
		if !ok {
			continue
		}
		for _, line := range agg.HardwareLines {
			consume(line.OptionRole, line.HardwareID)
		}
		for _, inst := range agg.Components {
			if inst.Overrides == nil {
				continue
			}
			for _, p := range inst.Overrides.HardwarePlacements {
				consume(p.OptionRole, p.HardwareID)
			}
		}
	}

	out := make([]string, 0, len(roles))
	for role := range roles {
		out = append(out, role)
	}
	sort.Strings(out)
	return out
}
