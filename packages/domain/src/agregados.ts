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
 * Multiplies quantities by instance.quantity, applies mirroring if requested, and applies optionOverrides.
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

  const rawHardware = agregado.hardwareLines ?? [];
  const hardwareLines = rawHardware.map((h) => {
    const overrideHardwareId =
      instance.optionOverrides && h.optionRole && instance.optionOverrides[h.optionRole]
        ? instance.optionOverrides[h.optionRole]
        : h.hardwareId;

    return {
      ...h,
      id: `${h.id}-agr-${instance.agregadoId}`,
      hardwareId: overrideHardwareId ?? h.hardwareId,
      quantity: h.quantity * mult,
    };
  });

  return { components, hardwareLines };
}

export interface SubspaceUnit {
  readonly unitIndex: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

/**
 * Computes individual sub-space bounding boxes and 3D positions for N units of an Agregado instance.
 */
export function calculateAgregadoSubspaceUnits(
  quantity: number,
  spaceDims: { width: number; height: number; depth: number },
  spacePos: { x: number; y: number; z: number },
  layoutDirection: 'vertical' | 'horizontal' | 'none' = 'none',
  gapMm = 0,
): readonly SubspaceUnit[] {
  const N = Math.max(1, quantity);
  const gap = Math.max(0, gapMm);
  const units: SubspaceUnit[] = [];

  if (layoutDirection === 'vertical' && N > 1) {
    const availableH = Math.max(1, spaceDims.height - (N - 1) * gap);
    const unitH = availableH / N;
    for (let i = 0; i < N; i++) {
      units.push({
        unitIndex: i,
        x: spacePos.x,
        y: spacePos.y,
        z: spacePos.z + i * (unitH + gap),
        width: spaceDims.width,
        height: unitH,
        depth: spaceDims.depth,
      });
    }
  } else if (layoutDirection === 'horizontal' && N > 1) {
    const availableW = Math.max(1, spaceDims.width - (N - 1) * gap);
    const unitW = availableW / N;
    for (let i = 0; i < N; i++) {
      units.push({
        unitIndex: i,
        x: spacePos.x + i * (unitW + gap),
        y: spacePos.y,
        z: spacePos.z,
        width: unitW,
        height: spaceDims.height,
        depth: spaceDims.depth,
      });
    }
  } else {
    for (let i = 0; i < N; i++) {
      units.push({
        unitIndex: i,
        x: spacePos.x,
        y: spacePos.y,
        z: spacePos.z,
        width: spaceDims.width,
        height: spaceDims.height,
        depth: spaceDims.depth,
      });
    }
  }

  return units;
}
