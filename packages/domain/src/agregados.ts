/**
 * Agregados (sub-assemblies) resolution and mirroring logic.
 *
 * An Agregado is a reusable sub-assembly (e.g., a door with hinges and handle,
 * a drawer with slides, etc.).
 * When placed inside a module or structure, it can be mirrored (e.g., flipping a
 * left-opening door into a right-opening door).
 */

import {
  HINGE_DEMAND_DESCRIPTION,
  HINGE_DEMAND_LINE_PREFIX,
  hingeDemandRole,
  hingesForDoor,
  type HingeDemandPolicy,
} from './hingeDemand';
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
  unitIndex?: number,
  // Item 2 de la issue del resto: la política de fábrica (traída por
  // catálogo). La banda de la puerta-agregado usa la MISMA política que
  // cotiza el servidor; omitida = escalera de librería.
  hingeDemandPolicy?: HingeDemandPolicy,
): {
  readonly components: readonly ModuleComponentInstance[];
  readonly hardwareLines: readonly HardwareLine[];
} {
  const agregado = agregadosCatalog.find((a) => a.id === instance.agregadoId);
  if (!agregado) {
    return { components: [], hardwareLines: [] };
  }

  const mult = Math.max(1, instance.quantity);
  const instanceKey = instance.id ? instance.id : instance.agregadoId;
  const unitSuffix = unitIndex !== undefined ? `-u${unitIndex}` : '';

  const rawComponents = (agregado.components ?? []).map((c) => ({
    ...c,
    quantity: c.quantity * mult,
  }));

  const components = instance.mirrored
    ? rawComponents.map(mirrorComponentInstance)
    : rawComponents;

  // Count positioned hardware: each hardwarePlacement on a component = 1 unit,
  // scaled by the component's (already mult-scaled) quantity. This is the
  // single source of truth for cost + 3D + future CNC — a positioned hardware
  // is never also counted via a bulk hardwareLine (dedup below).
  const placementCounts = new Map<string, number>();
  for (const comp of components) {
    const placements = comp.overrides?.hardwarePlacements;
    if (!placements) continue;
    for (const p of placements) {
      // #1046: role-based placements resolve against the instance's option
      // overrides (same map bulk lines use). A role without a choice is not
      // concrete in this estimate — it stays out instead of fabricating a
      // count for the wrong member.
      const resolvedId =
        p.hardwareId ||
        (p.optionRole && instance.optionOverrides?.[p.optionRole]) ||
        '';
      if (!resolvedId) continue;
      placementCounts.set(
        resolvedId,
        (placementCounts.get(resolvedId) ?? 0) + comp.quantity,
      );
    }
  }

  // Item 2 — los agregados-puerta compran bisagras por banda de altura, la
  // MISMA escalera que las puertas de módulo: posiciones > banda > línea
  // bulk autorizada. El agregado ES la puerta (patrón AGR-PUE): sus
  // externalDims son la caja de la puerta. Sin dims, sin componente puerta
  // o sin elección para el grupo → la banda no aparece (nunca se inventa).
  // Un agregado mixto (mueble con puerta interna) queda fuera del alcance de
  // la banda (su caja no es la de la puerta) — nombrado en la issue.
  const bandCounts = new Map<string, number>();
  const bandRoles = new Map<string, string>();
  const isDoorAggregate = (agregado.components ?? []).some(
    (c) => c.placementOverride === 'puerta',
  );
  const doorBox = agregado.externalDims;
  if (isDoorAggregate && doorBox && doorBox.height > 0) {
    const role = hingeDemandRole(hingeDemandPolicy);
    const chosenId = instance.optionOverrides?.[role]?.trim();
    if (chosenId && !placementCounts.has(chosenId)) {
      const perUnit = hingesForDoor(
        doorBox.height,
        doorBox.width,
        hingeDemandPolicy,
      );
      if (perUnit > 0) {
        bandCounts.set(chosenId, perUnit * mult);
        bandRoles.set(chosenId, role);
      }
    }
  }

  const rawHardware = agregado.hardwareLines ?? [];
  // Bulk hardware lines, EXCLUDING any whose resolved hardwareId is also
  // positioned (positions win) or band-covered (the derived band replaces
  // the fixed authored line of the same hardware).
  const bulkHardwareLines = rawHardware
    .map((h) => {
      const overrideHardwareId =
        instance.optionOverrides && h.optionRole && instance.optionOverrides[h.optionRole]
          ? instance.optionOverrides[h.optionRole]
          : h.hardwareId;
      return {
        ...h,
        id: `${h.id}-agr-${instanceKey}${unitSuffix}`,
        hardwareId: overrideHardwareId ?? h.hardwareId,
        quantity: h.quantity * mult,
      };
    })
    .filter(
      (h) =>
        !(
          h.hardwareId &&
          (placementCounts.has(h.hardwareId) || bandCounts.has(h.hardwareId))
        ),
    );

  // Position-derived hardware lines (one per positioned hardwareId).
  const placementHardwareLines: HardwareLine[] = [...placementCounts].map(
    ([hwId, qty]) => ({
      id: `placement-agr-${instanceKey}${unitSuffix}-${hwId}`,
      quantity: qty,
      optionRole: 'POSITIONED',
      hardwareId: hwId,
    }),
  );

  // Band-derived demand lines (después de posiciones — mismo orden que el
  // resolve de módulo).
  const bandHardwareLines: HardwareLine[] = [...bandCounts].map(
    ([hwId, qty]) => ({
      id: `${HINGE_DEMAND_LINE_PREFIX}agr-${instanceKey}${unitSuffix}-${hwId}`,
      quantity: qty,
      optionRole: bandRoles.get(hwId) ?? hingeDemandRole(hingeDemandPolicy),
      hardwareId: hwId,
      descriptionOverride: HINGE_DEMAND_DESCRIPTION,
    }),
  );

  const hardwareLines = [
    ...bulkHardwareLines,
    ...placementHardwareLines,
    ...bandHardwareLines,
  ];

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
