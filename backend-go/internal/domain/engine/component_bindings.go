package engine

import "github.com/tiagofur/muebles-backend/internal/domain"

// ApplyEvaluatedComponentBindings copies component quantity/condition consumers.
// Callers must validate definitions, consumer targets and evaluated scalar values
// first. This is not a release readiness gate or relationship materializer.
func ApplyEvaluatedComponentBindings(module domain.Module, values map[string]any) domain.Module {
	for _, definition := range module.ParameterDefinitions {
		binding := definition.Binding
		if binding == nil || (binding.Kind != domain.FurnitureParameterBindingComponentQuantity && binding.Kind != domain.FurnitureParameterBindingComponentCondition) {
			continue
		}
		quantity := -1
		if binding.Kind == domain.FurnitureParameterBindingComponentQuantity {
			value, ok := values[definition.Name].(float64)
			if !ok {
				continue
			}
			quantity = int(value)
		} else {
			value, ok := values[definition.Name].(bool)
			if !ok {
				continue
			}
			if !value {
				quantity = 0
			}
		}
		updated := make([]domain.ComponentInstance, 0, len(module.Components))
		for _, instance := range module.Components {
			if instance.ComponentID == binding.ComponentID {
				if quantity == 0 {
					continue
				}
				if quantity > 0 {
					instance.Quantity = quantity
				}
			}
			updated = append(updated, instance)
		}
		module.Components = updated
	}
	return module
}

// ApplyEvaluatedAgregadoBindings copies agregado quantity/condition consumers
// (#1386). Callers must validate definitions, consumer targets and evaluated
// scalar values first. Same semantics as the component apply: quantity 0 or a
// false condition removes the matched instances entirely.
func ApplyEvaluatedAgregadoBindings(module domain.Module, values map[string]any) domain.Module {
	for _, definition := range module.ParameterDefinitions {
		binding := definition.Binding
		if binding == nil || (binding.Kind != domain.FurnitureParameterBindingAgregadoQuantity && binding.Kind != domain.FurnitureParameterBindingAgregadoCondition) {
			continue
		}
		quantity := -1
		if binding.Kind == domain.FurnitureParameterBindingAgregadoQuantity {
			value, ok := values[definition.Name].(float64)
			if !ok {
				continue
			}
			quantity = int(value)
		} else {
			value, ok := values[definition.Name].(bool)
			if !ok {
				continue
			}
			if !value {
				quantity = 0
			}
		}
		updated := make([]domain.ModuleAgregadoInstance, 0, len(module.Agregados))
		for _, instance := range module.Agregados {
			if instance.AgregadoID == binding.AgregadoID {
				if quantity == 0 {
					continue
				}
				if quantity > 0 {
					instance.Quantity = quantity
				}
			}
			updated = append(updated, instance)
		}
		module.Agregados = updated
	}
	return module
}
