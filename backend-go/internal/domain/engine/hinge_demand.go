package engine

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1078 — hinge DEMAND by door height band. The hinge count stops being a
// hand-edited bulk line and derives from each placed door's height through
// the factory policy ladder (library default → factory doorHingeDemand →
// per-component exception), honouring the option group choice exactly like
// #1046/#1210 do.
//
// Precedence per (module, resolved hardware) — the same single-source-of-
// truth rule as #1210, extended one rung:
//
//	placements (#1210) > band (#1078) > bulk line
//
// A door whose component carries hinge placements already bought its exact
// hinges — the band adds nothing for that hardware. Bulk BISAGRA lines for
// band-covered hardware are dropped: the fixed "2×BISAGRA" seed stops
// governing (the issue retires it).
//
// Scope: module board parts (FRENTE role, composed expansion sets the
// catalog component id). Agregado doors keep their authored demand —
// extending the band there is named remaining work in the ODD.

// hingeDemandDoorRole is the canonical door option role (same criterion as
// isDoorBoard / the layout resolver).
const hingeDemandDoorRole = "FRENTE"

// collectHingeBandDemand derives band demand lines for a module's doors.
// placementCounts are the #1210 counts (positions win over the band).
// Returns the counts per resolved hardware plus the resolved lines (ID
// hingeband-<hw>, OptionRole = the policy's role, DescriptionOverride = the
// applied-band description). A role without an effective choice contributes
// nothing — the quote gate blocks required groups before pricing; a broken
// choice errors exactly like a broken bulk line.
func collectHingeBandDemand(
	module domain.Module,
	parts []domain.BoardPart,
	catalog domain.Catalog,
	optionChoices map[string]string,
	placementCounts map[string]int,
) (map[string]int, []domain.ResolvedHardwareLine, error) {
	doors := make([]domain.BoardPart, 0, 2)
	for _, part := range parts {
		if strings.EqualFold(strings.TrimSpace(part.OptionRole), hingeDemandDoorRole) {
			doors = append(doors, part)
		}
	}
	if len(doors) == 0 {
		return nil, nil, nil
	}

	policy := catalog.ConstructionPolicy
	// Aggregate per resolved hardware; remember the consuming role per
	// hardware (roles can only collide on the same hardware when two
	// policies disagree — first door wins, the hardware identity is what
	// the BOM carries).
	type bandDemand struct {
		quantity int
		role     string
	}
	demand := make(map[string]*bandDemand)
	for _, door := range doors {
		doorPolicy := policy.HingeDemandForComponent(door.CatalogComponentID)
		role := domain.HingeDemandEffectiveRole(doorPolicy)
		if strings.TrimSpace(optionChoices[role]) == "" {
			// No choice for the group: the gate owns that failure (it
			// blocks pricing until the choice exists). The resolve stays
			// quote-stable instead of fabricating a $0 line.
			continue
		}
		hw, err := ResolveHardware(domain.HardwareLine{
			ID:         domain.HingeDemandLinePrefix + "demand-" + door.ID,
			OptionRole: role,
		}, optionChoices, catalog.Hardware)
		if err != nil {
			return nil, nil, fmt.Errorf("banda de bisagras en %s (puerta %s): %w", module.Code, door.ID, err)
		}
		if placementCounts[hw.ID] > 0 {
			// Positions already bought this hardware — #1210 wins.
			continue
		}
		entry := demand[hw.ID]
		if entry == nil {
			entry = &bandDemand{role: role}
			demand[hw.ID] = entry
		}
		entry.quantity += domain.HingesForDoor(door.LengthMm, door.WidthMm, doorPolicy) * max(door.Quantity, 1)
	}
	if len(demand) == 0 {
		return nil, nil, nil
	}

	counts := make(map[string]int, len(demand))
	lines := make([]domain.ResolvedHardwareLine, 0, len(demand))
	for hwID, entry := range demand {
		counts[hwID] = entry.quantity
		lines = append(lines, domain.ResolvedHardwareLine{
			ID:                  domain.HingeDemandLinePrefix + hwID,
			Quantity:            float64(entry.quantity),
			DescriptionOverride: domain.HingeDemandLineDescription,
			OptionRole:          entry.role,
			HardwareID:          hwID,
		})
	}
	return counts, lines, nil
}
