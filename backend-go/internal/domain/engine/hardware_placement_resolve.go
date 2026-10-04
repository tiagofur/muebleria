package engine

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// resolvePlacementHardwareIDs substitutes role-based hardware placements
// (#1046) with their chosen concrete catalog hardware before any downstream
// consumer (machining, drilling, demand, preview) sees them. Concrete
// placements pass through untouched; a role resolves through the effective
// option choices; a role WITHOUT a choice fails closed when the group is
// required (or unknown) and drops the placement when the group is explicitly
// optional — the same semantics as board-material choices. A placement with
// neither field is invalid authoring.
func resolvePlacementHardwareIDs(
	placements []domain.HardwarePlacement,
	optionChoices map[string]string,
	catalog domain.Catalog,
	hostID string,
) ([]domain.HardwarePlacement, error) {
	if len(placements) == 0 {
		return placements, nil
	}
	out := make([]domain.HardwarePlacement, 0, len(placements))
	for _, hp := range placements {
		if strings.TrimSpace(hp.HardwareID) != "" {
			out = append(out, hp)
			continue
		}
		role := strings.TrimSpace(hp.OptionRole)
		if role == "" {
			return nil, fmt.Errorf("hardware placement on %s has neither hardwareId nor optionRole", hostID)
		}
		chosen := strings.TrimSpace(optionChoices[role])
		if chosen == "" {
			if group := findOptionGroupByCode(catalog, role); group != nil && !group.Required {
				continue // optional group without a choice: the placement stays out, never fabricated
			}
			return nil, fmt.Errorf("herraje por grupo %q sin elección (placement en %s)", role, hostID)
		}
		hw, ok := findHardware(catalog, chosen)
		if !ok || !hw.Active {
			return nil, fmt.Errorf("elección de herraje %q (grupo %s) no existe o está inactiva (placement en %s)", chosen, role, hostID)
		}
		hp.HardwareID = chosen
		out = append(out, hp)
	}
	return out, nil
}

func findOptionGroupByCode(catalog domain.Catalog, code string) *domain.OptionGroup {
	for i := range catalog.OptionGroups {
		if strings.EqualFold(catalog.OptionGroups[i].Code, code) {
			return &catalog.OptionGroups[i]
		}
	}
	return nil
}

// consumePlacementOptionRoles records every option role a module's role-based
// hardware placements consume (#1046), mirroring the collectAllHardwareLines
// traversal: module components, structure components, and the components of
// every agregado instance (module- and structure-scoped). The consumed value
// is the choice the layout resolver substitutes — identical to choices[role]
// — so validateReleaseUnitChoices keeps the role in the frozen choice set.
func consumePlacementOptionRoles(
	module domain.Module,
	catalog domain.Catalog,
	choices map[string]string,
	consumed map[string]string,
) {
	record := func(instances []domain.ComponentInstance) {
		for _, inst := range instances {
			if inst.Overrides == nil {
				continue
			}
			for _, hp := range inst.Overrides.HardwarePlacements {
				if strings.TrimSpace(hp.HardwareID) != "" {
					continue
				}
				role := strings.TrimSpace(hp.OptionRole)
				if role == "" {
					continue
				}
				chosen := strings.TrimSpace(choices[role])
				if chosen == "" {
					continue // optional-group drop or required-group failure: neither consumes
				}
				consumed[role] = chosen
			}
		}
	}

	record(module.Components)
	if strings.TrimSpace(module.StructureID) != "" {
		if st, ok := findStructure(catalog, module.StructureID); ok {
			record(st.Components)
			for _, agrInst := range st.Agregados {
				if agr, ok := findAgregado(catalog, agrInst.AgregadoID); ok {
					record(agr.Components)
				}
			}
		}
	}
	for _, agrInst := range module.Agregados {
		if agr, ok := findAgregado(catalog, agrInst.AgregadoID); ok {
			record(agr.Components)
		}
	}
}
