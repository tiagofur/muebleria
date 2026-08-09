/**
 * Agregados (sub-assemblies) resolution and mirroring logic.
 *
 * An Agregado is a reusable sub-assembly (e.g., a door with hinges and handle,
 * a drawer with slides, etc.).
 * When placed inside a module or structure, it can be mirrored (e.g., flipping a
 * left-opening door into a right-opening door).
 */

import type {
  Agregado,
  ComponentPlacement,
  HardwareLine,
  ModuleAgregadoInstance,
  ModuleComponentInstance,
} from './types';

/**
 * Flips spatial placement across the X axis.
 * - 'lateral_izquierdo' <-> 'lateral_derecho'
 * - other placements are symmetric or custom.
 */
export function mirrorComponentPlacement(
  placement: ComponentPlacement,
): ComponentPlacement {
  if (placement === 'lateral_izquierdo') return 'lateral_derecho';
  if (placement === 'lateral_derecho') return 'lateral_izquierdo';
  return placement;
}

/**
 * Mirrors a component instance by inverting its placement and rotation.
 */
export function mirrorComponentInstance(
  instance: ModuleComponentInstance,
): ModuleComponentInstance {
  const placementOverride = instance.placementOverride
    ? mirrorComponentPlacement(instance.placementOverride)
    : undefined;

  const currentRotateY = instance.overrides?.rotateY;
  const newRotateY =
    currentRotateY !== undefined ? (360 - currentRotateY) % 360 : undefined;

  const overrides = instance.overrides
    ? {
        ...instance.overrides,
        ...(newRotateY !== undefined ? { rotateY: newRotateY } : {}),
      }
    : undefined;

  return {
    ...instance,
    ...(placementOverride ? { placementOverride } : {}),
    ...(overrides ? { overrides } : {}),
  };
}

/**
 * Resolves a ModuleAgregadoInstance into its constituent ComponentInstances and HardwareLines.
 * Multiplies quantities by instance.quantity and applies mirroring if requested.
 */
export function resolveAgregadoInstance(
  instance: ModuleAgregadoInstance,
  agregadosCatalog: readonly Agregado[],
): {
  readonly components: readonly ModuleComponentInstance[];
  readonly hardwareLines: readonly HardwareLine[];
} {
  const agregado = agregadosCatalog.find((a) => a.id === instance.agregadoId);
  if (!agregado) {
    return { components: [], hardwareLines: [] };
  }

  const mult = Math.max(1, instance.quantity);

  const rawComponents = (agregado.components ?? []).map((c) => ({
    ...c,
    quantity: c.quantity * mult,
  }));

  const components = instance.mirrored
    ? rawComponents.map(mirrorComponentInstance)
    : rawComponents;

  const hardwareLines = (agregado.hardwareLines ?? []).map((h) => ({
    ...h,
    id: `${h.id}-agr-${instance.agregadoId}`,
    quantity: h.quantity * mult,
  }));

  return { components, hardwareLines };
}
