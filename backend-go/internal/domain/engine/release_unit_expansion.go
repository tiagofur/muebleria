package engine

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// A deliberately conservative per-physical-unit work budget, not a geometry
// engine: count boards (including fixed physical quantities), hardware rows and
// empty agregado repetitions before allocation. Count even base-filtered parts
// and reserve six rows for possible base synthesis (four boards, two hardware).
// Hardware consumption may be fractional; its quantity is not a row count.
// Collection limits and occurrence identity validation remain caller concerns.
const releaseUnitExpansionLimit = 10_000

type releaseExpansionBudget int

func (used *releaseExpansionBudget) add(count, multiplier int) error {
	// Check before multiplying or adding; even MaxInt inputs cannot overflow.
	if count < 0 || multiplier < 1 || multiplier > releaseUnitExpansionLimit ||
		count > (releaseUnitExpansionLimit-int(*used))/multiplier {
		return fmt.Errorf("exceeds %d work units", releaseUnitExpansionLimit)
	}
	*used += releaseExpansionBudget(count * multiplier)
	return nil
}

func (used *releaseExpansionBudget) components(instances []domain.ComponentInstance, catalog domain.Catalog) error {
	for _, instance := range instances {
		if strings.TrimSpace(instance.ComponentID) == "" {
			return fmt.Errorf("component identity is required")
		}
		if _, ok := findComponent(catalog, instance.ComponentID); !ok {
			return fmt.Errorf("component not found: %s", instance.ComponentID)
		}
		if instance.Quantity <= 0 {
			return fmt.Errorf("component quantity must be positive: %s", instance.ComponentID)
		}
		if err := used.add(instance.Quantity, 1); err != nil {
			return err
		}
	}
	return nil
}

func (used *releaseExpansionBudget) agregados(instances []domain.ModuleAgregadoInstance, catalog domain.Catalog) error {
	for _, instance := range instances {
		agregado, ok := findAgregado(catalog, instance.AgregadoID)
		if strings.TrimSpace(instance.AgregadoID) == "" || !ok {
			return fmt.Errorf("agregado not found: %s", instance.AgregadoID)
		}
		quantity := instance.Quantity
		if quantity <= 0 {
			quantity = 1 // Preserve the existing engine's agregado default.
		}
		var unit releaseExpansionBudget
		if err := unit.components(agregado.Components, catalog); err != nil {
			return err
		}
		if err := unit.add(len(agregado.HardwareLines), 1); err != nil {
			return err
		}
		// The engine repeats even an empty agregado; hardware rows are counted
		// per repetition conservatively although collected as multiplied lines.
		if err := used.add(maxInt(1, int(unit)), quantity); err != nil {
			return err
		}
	}
	return nil
}

func validateReleaseUnitExpansion(module domain.Module, catalog domain.Catalog) error {
	var used releaseExpansionBudget
	if err := used.add(len(module.HardwareLines), 1); err != nil {
		return err
	}
	if strings.TrimSpace(module.StructureID) == "" {
		for _, part := range module.BoardParts {
			if part.Quantity <= 0 {
				return fmt.Errorf("fixed board quantity must be positive: %s", part.ID)
			}
			if err := used.add(part.Quantity, 1); err != nil {
				return err
			}
		}
		return nil
	}
	structure, ok := findStructure(catalog, module.StructureID)
	if !ok {
		return fmt.Errorf("structure not found: %s", module.StructureID)
	}
	if ResolveBaseModeWithContext(module, nil) != baseModeNone {
		if err := used.add(6, 1); err != nil {
			return err
		}
	}
	if err := used.components(structure.Components, catalog); err != nil {
		return err
	}
	if err := used.components(module.Components, catalog); err != nil {
		return err
	}
	if err := used.agregados(structure.Agregados, catalog); err != nil {
		return err
	}
	return used.agregados(module.Agregados, catalog)
}
