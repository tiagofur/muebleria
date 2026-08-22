/**
 * F144/#310 — Intenciones de precisión del plano: nudge de teclado y
 * traslación de grupo (drag). Funciones puras con las mismas reglas que
 * kitchenLayoutCommands/kitchenArrangementCommands: all-or-nothing, un
 * comando = una intención = una entrada de undo, y ningún resultado produce
 * colisiones ni overflow (North Star §§10.2/§12).
 */

import {
  isFreePlacement,
  placementAabb,
  type KitchenFootprint,
} from './kitchenLayout';
import type {
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from './types';
import {
  findPlacement,
  footprintMap,
  widthOf,
  type LayoutCommandResult,
  type PlacementKey,
} from './kitchenLayoutCommands';

function wallNameOf(layout: ProjectKitchenLayout, wallId: string): string {
  return layout.walls.find((w) => w.id === wallId)?.name?.trim() || 'el muro';
}

function depthOf(
  fpByKey: Map<PlacementKey, KitchenFootprint>,
  key: PlacementKey,
): number {
  return fpByKey.get(key)?.depth ?? 600;
}

function replacePlacements(
  layout: ProjectKitchenLayout,
  next: readonly ProjectItemPlacement[],
): ProjectKitchenLayout {
  const replace = new Map(
    next.map((p) => [`${p.itemId}#${p.instanceIndex}`, p]),
  );
  return {
    ...layout,
    placements: layout.placements.map((p) =>
      replace.get(`${p.itemId}#${p.instanceIndex}`) ?? p,
    ),
  };
}

/**
 * Trasladar la selección: unidades de muro se deslizan por SU muro
 * (multi-muro OK: cada muro valida contra sus propios pares), islas se
 * mueven en el plano por (deltaXMm, deltaYMm). Mezclar muro+isla en la
 * misma selección está permitido: cada uno usa su delta.
 *
 * All-or-nothing: si algún miembro desborda su muro o colisiona con un
 * mueble no seleccionado, el comando falla sin tocar nada y el mensaje
 * enseña cómo resolverlo. Los miembros seleccionados no colisionan entre sí
 * (se mueven solidariamente conservando el arreglo relativo).
 */
export function nudgeSelectionCommand(params: {
  readonly layout: ProjectKitchenLayout;
  readonly footprints: readonly KitchenFootprint[];
  readonly keys: readonly PlacementKey[];
  /** Delta (mm) a lo largo del muro para unidades ancladas (+= hacia el final). */
  readonly deltaWallMm?: number;
  /** Delta (mm) en plano X para islas. */
  readonly deltaXMm?: number;
  /** Delta (mm) en plano Y para islas. */
  readonly deltaYMm?: number;
  /** Etiqueta de la acción para mensajes (default "Mover"). */
  readonly action?: string;
}): LayoutCommandResult {
  const { layout, keys } = params;
  const action = params.action ?? 'Mover';
  const deltaWall = Math.round(params.deltaWallMm ?? 0);
  const deltaX = Math.round(params.deltaXMm ?? 0);
  const deltaY = Math.round(params.deltaYMm ?? 0);
  if (keys.length === 0) {
    return {
      ok: false,
      reason: 'empty-selection',
      message: 'No hay muebles seleccionados.',
    };
  }
  const fpByKey = footprintMap(params.footprints);

  // 1) Wall members, grouped per wall to validate span + overflow together.
  const byWall = new Map<string, ProjectItemPlacement[]>();
  for (const key of keys) {
    const p = findPlacement(layout, key);
    if (!p) continue;
    if (isFreePlacement(p)) continue;
    const list = byWall.get(p.wallId) ?? [];
    list.push(p);
    byWall.set(p.wallId, list);
  }
  const nextWallPlacements: ProjectItemPlacement[] = [];
  for (const [wallId, members] of byWall) {
    const wall = layout.walls.find((w) => w.id === wallId);
    if (!wall) {
      return {
        ok: false,
        reason: 'missing-wall',
        message: `El muro donde estaba un mueble seleccionado ya no existe (${wallNameOf(layout, wallId)}).`,
      };
    }
    const movedKeys = new Set(
      members.map((p) => `${p.itemId}#${p.instanceIndex}`),
    );
    const start = Math.min(
      ...members.map((p) => p.offsetMm + deltaWall),
    );
    const end = Math.max(
      ...members.map(
        (p) => p.offsetMm + deltaWall + widthOf(fpByKey, `${p.itemId}#${p.instanceIndex}`),
      ),
    );
    if (start < 0 || end > wall.lengthMm + 1) {
      return {
        ok: false,
        reason: 'no-space',
        message: `${action} ahí sacaría la selección de ${wallNameOf(layout, wallId)}.`,
      };
    }
    // Clash against non-selected peers of the same wall + elevation.
    for (const p of layout.placements) {
      if (isFreePlacement(p) || p.wallId !== wallId) continue;
      const key = `${p.itemId}#${p.instanceIndex}`;
      if (movedKeys.has(key)) continue;
      const peerStart = p.offsetMm;
      const peerEnd = p.offsetMm + widthOf(fpByKey, key);
      for (const m of members) {
        const mKey = `${m.itemId}#${m.instanceIndex}`;
        const mStart = m.offsetMm + deltaWall;
        const mEnd = mStart + widthOf(fpByKey, mKey);
        if (m.elevation !== p.elevation) continue;
        if (mStart + 1 < peerEnd && peerStart + 1 < mEnd) {
          return {
            ok: false,
            reason: 'overlap',
            message: `${action} ahí chocaría con otro mueble de ${wallNameOf(layout, wallId)}. Liberá espacio o seleccioná la corrida completa.`,
          };
        }
      }
    }
    for (const m of members) {
      nextWallPlacements.push({ ...m, offsetMm: m.offsetMm + deltaWall });
    }
  }

  // 2) Islands: move in plan, validate against non-selected islands.
  const islandNext: ProjectItemPlacement[] = [];
  const movedIslandKeys = new Set<PlacementKey>();
  for (const key of keys) {
    const p = findPlacement(layout, key);
    if (!p || !isFreePlacement(p)) continue;
    movedIslandKeys.add(key);
    islandNext.push({
      ...p,
      freeXMm: (p.freeXMm ?? 0) + deltaX,
      freeYMm: (p.freeYMm ?? 0) + deltaY,
    });
  }
  if (islandNext.length > 0 && (deltaX !== 0 || deltaY !== 0)) {
    const boxes = [
      ...layout.placements
        .filter(
          (p) =>
            isFreePlacement(p) &&
            !movedIslandKeys.has(`${p.itemId}#${p.instanceIndex}`),
        )
        .map((p) =>
          placementAabb(
            p.freeXMm ?? 0,
            p.freeYMm ?? 0,
            widthOf(fpByKey, `${p.itemId}#${p.instanceIndex}`),
            depthOf(fpByKey, `${p.itemId}#${p.instanceIndex}`),
            p.freeYawDeg ?? 0,
          ),
        ),
      ...islandNext.map((p) =>
        placementAabb(
          p.freeXMm ?? 0,
          p.freeYMm ?? 0,
          widthOf(fpByKey, `${p.itemId}#${p.instanceIndex}`),
          depthOf(fpByKey, `${p.itemId}#${p.instanceIndex}`),
          p.freeYawDeg ?? 0,
        ),
      ),
    ];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (
          a.minX < b.maxX - 1 &&
          a.maxX > b.minX + 1 &&
          a.minY < b.maxY - 1 &&
          a.maxY > b.minY + 1
        ) {
          return {
            ok: false,
            reason: 'overlap',
            message: `${action} ahí superpondría islas. Separalas primero.`,
          };
        }
      }
    }
  }

  if (nextWallPlacements.length === 0 && islandNext.length === 0) {
    return {
      ok: false,
      reason: 'not-placed',
      message: 'La selección no tiene muebles colocados en el plano.',
    };
  }

  return {
    ok: true,
    layout: replacePlacements(layout, [...nextWallPlacements, ...islandNext]),
    itemPatches: [],
    createdKeys: [],
  };
}
