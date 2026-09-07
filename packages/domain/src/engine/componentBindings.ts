import type { FurnitureParameter } from '../smartFurnitureDomain';
import type { FurnitureParameterValue } from '../furnitureParameters';
import type { Module } from '../types';

/** Mirrors Go ApplyEvaluatedComponentBindings, not a release readiness gate.
 * Callers must validate definitions, consumer targets and evaluated values first.
 * Relationship effects are outside this component-only materialization helper.
 */
export function applyEvaluatedComponentBindings(
  module: Module,
  definitions: readonly FurnitureParameter[],
  values: Readonly<Record<string, FurnitureParameterValue>>,
): Module {
  let prepared = module;
  for (const definition of definitions) {
    const binding = definition.binding;
    if (!binding || !['componentQuantity', 'componentCondition'].includes(binding.kind)) continue;
    const value = values[definition.name];
    let quantity = -1;
    if (binding.kind === 'componentQuantity') {
      if (typeof value !== 'number') continue;
      quantity = Math.trunc(value);
    } else {
      if (typeof value !== 'boolean') continue;
      if (!value) quantity = 0;
    }
    prepared = {
      ...prepared,
      components: (prepared.components ?? []).flatMap((instance) => {
        if (instance.componentId !== binding.componentId) return [instance];
        if (quantity === 0) return [];
        return [quantity > 0 ? { ...instance, quantity } : instance];
      }),
    };
  }
  return prepared;
}
