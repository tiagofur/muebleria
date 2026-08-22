/**
 * F143/#310 — Intenciones de organización del plano: compactar (alinear la
 * corrida de un muro), distribuir, alinear islas y centrar. Funciones puras;
 * mismas reglas que kitchenLayoutCommands: un comando = una intención = una
 * entrada de undo, y ningún resultado produce colisiones o overflow.
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
  COMMAND_GAP_MM,
  findPlacement,
  footprintMap,
  widthOf,
  type LayoutCommandResult,
  type PlacementKey,
} from './kitchenLayoutCommands';

type WallSelection = {
  readonly placements: readonly ProjectItemPlacement[];
  readonly wallId: string;
  readonly wallLengthMm: number;
  readonly name: string;
  readonly fpByKey: Map<PlacementKey, KitchenFootprint>;
};

function resolveWallSelection(
  layout: ProjectKitchenLayout,
  footprints: readonly KitchenFootprint[],
  keys: readonly PlacementKey[],
  action: string,
): WallSelection | { readonly error: LayoutCommandResult } {
  if (keys.length === 0) {
    return {
      error: {
        ok: false,
        reason: 'empty-selection',
        message: 'No hay muebles seleccionados.',
      },
    };
  }
  const fpByKey = footprintMap(footprints);
  const placements: ProjectItemPlacement[] = [];
  for (const key of keys) {
    const p = findPlacement(layout, key);
    if (!p) {
      return {
        error: {
          ok: false,
          reason: 'not-placed',
          message: `${action} funciona sobre muebles colocados en un muro.`,
        },
      };
    }
    if (isFreePlacement(p)) {
      return {
        error: {
          ok: false,
          reason: 'mixed-placement',
          message: `${action} funciona sobre muebles anclados a un muro; las islas se organizan aparte.`,
        },
      };
    }
    placements.push(p);
  }
  const wallId = placements[0]!.wallId;
  if (placements.some((p) => p.wallId !== wallId)) {
    return {
      error: {
        ok: false,
        reason: 'multi-wall',
        message: `${action} funciona sobre muebles de un mismo muro.`,
      },
    };
  }
  const wall = layout.walls.find((w) => w.id === wallId);
  if (!wall) {
    return {
      error: {
        ok: false,
        reason: 'missing-wall',
        message: 'El muro de los muebles seleccionados ya no existe.',
      },
    };
  }
  return {
    placements,
    wallId,
    wallLengthMm: wall.lengthMm,
    name: wall.name?.trim() || 'el muro',
    fpByKey,
  };
}

function clashOnWall(
  layout: ProjectKitchenLayout,
  sel: WallSelection,
  nextPlacements: readonly ProjectItemPlacement[],
): boolean {
  const selectedKeys = new Set(
    sel.placements.map((p) => `${p.itemId}#${p.instanceIndex}`),
  );
  const widthByKey = (p: ProjectItemPlacement): number =>
    widthOf(sel.fpByKey, `${p.itemId}#${p.instanceIndex}`);
  const others = layout.placements.filter(
    (p) =>
      !isFreePlacement(p) &&
      p.wallId === sel.wallId &&
      !selectedKeys.has(`${p.itemId}#${p.instanceIndex}`),
  );
  const all = [...others, ...nextPlacements];
  const sorted = [...all].sort((a, b) => a.offsetMm - b.offsetMm);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (a.elevation !== b.elevation) continue;
    if (a.offsetMm + widthByKey(a) > b.offsetMm + 1) return true;
  }
  return false;
}

/**
 * "Alinear" en muro = compactar la selección en una corrida contigua (gap
 * estándar) empezando donde está el primero. Es el alineado físicamente
 * posible sobre un muro: alinear bordes en 1D apilaría muebles.
 */
export function compactSelectionOnWallCommand(params: {
  readonly layout: ProjectKitchenLayout;
  readonly footprints: readonly KitchenFootprint[];
  readonly keys: readonly PlacementKey[];
  readonly gapMm?: number;
}): LayoutCommandResult {
  const gap = params.gapMm ?? COMMAND_GAP_MM;
  const sel = resolveWallSelection(
    params.layout,
    params.footprints,
    params.keys,
    'Alinear',
  );
  if ('error' in sel) return sel.error;
  const sorted = [...sel.placements].sort((a, b) => a.offsetMm - b.offsetMm);
  const widthOfSel = (p: ProjectItemPlacement): number =>
    widthOf(sel.fpByKey, `${p.itemId}#${p.instanceIndex}`);
  let cursor = sorted[0]!.offsetMm;
  const nextPlacements: ProjectItemPlacement[] = [];
  for (const p of sorted) {
    nextPlacements.push({ ...p, offsetMm: cursor });
    cursor += widthOfSel(p) + gap;
  }
  const lastEnd = cursor - gap;
  if (lastEnd > sel.wallLengthMm + 1) {
    return {
      ok: false,
      reason: 'no-space',
      message: `La corrida compactada saldría de ${sel.name}. Sacá un mueble o mové la selección.`,
    };
  }
  if (clashOnWall(params.layout, sel, nextPlacements)) {
    return {
      ok: false,
      reason: 'overlap',
      message: `Compactar los dejaría sobre otros muebles de ${sel.name}. Usá Distribuir o separalos.`,
    };
  }
  return {
    ok: true,
    layout: replacePlacements(params.layout, sel.placements, nextPlacements),
    itemPatches: [],
    createdKeys: [],
  };
}

/**
 * Distribuir equidistante: en muro conserva el primero y el último y iguala
 * los gaps (≥3); en islas iguala la distancia entre centros sobre el eje,
 * conservando los extremos (≥3).
 */
export function distributeSelectionCommand(params: {
  readonly layout: ProjectKitchenLayout;
  readonly footprints: readonly KitchenFootprint[];
  readonly keys: readonly PlacementKey[];
  readonly axis: 'wall' | 'x' | 'y';
  readonly gapMm?: number;
}): LayoutCommandResult {
  if (params.keys.length < 3) {
    return {
      ok: false,
      reason: 'too-few',
      message: 'Distribuir necesita al menos 3 muebles.',
    };
  }
  if (params.axis === 'wall') {
    const sel = resolveWallSelection(
      params.layout,
      params.footprints,
      params.keys,
      'Distribuir',
    );
    if ('error' in sel) return sel.error;
    const sorted = [...sel.placements].sort((a, b) => a.offsetMm - b.offsetMm);
    const widthOfSel = (p: ProjectItemPlacement): number =>
      widthOf(sel.fpByKey, `${p.itemId}#${p.instanceIndex}`);
    const firstStart = sorted[0]!.offsetMm;
    const lastEnd =
      sorted[sorted.length - 1]!.offsetMm + widthOfSel(sorted[sorted.length - 1]!);
    const totalWidth = sorted.reduce((acc, p) => acc + widthOfSel(p), 0);
    const span = lastEnd - firstStart;
    const gapN = (span - totalWidth) / (sorted.length - 1);
    if (gapN < 0) {
      return {
        ok: false,
        reason: 'overlap',
        message: `No queda espacio para distribuir en ${sel.name}: los muebles se solaparían. Compactá primero.`,
      };
    }
    let cursor = firstStart;
    const nextPlacements = sorted.map((p) => {
      const next = { ...p, offsetMm: Math.round(cursor) };
      cursor += widthOfSel(p) + gapN;
      return next;
    });
    if (clashOnWall(params.layout, sel, nextPlacements)) {
      return {
        ok: false,
        reason: 'overlap',
        message: `Distribuir los dejaría sobre otros muebles de ${sel.name}. Seleccioná la corrida completa.`,
      };
    }
    return {
      ok: true,
      layout: replacePlacements(params.layout, sel.placements, nextPlacements),
      itemPatches: [],
      createdKeys: [],
    };
  }

  // Islas: distribuir centros sobre el eje, conservando los extremos.
  const fpByKey = footprintMap(params.footprints);
  const placed: { p: ProjectItemPlacement; center: number; size: number }[] = [];
  for (const key of params.keys) {
    const p = findPlacement(params.layout, key);
    if (!p || !isFreePlacement(p)) {
      return {
        ok: false,
        reason: 'mixed-placement',
        message: 'Distribuir por eje funciona con islas; los muebles de muro se distribuyen a lo largo del muro.',
      };
    }
    const fp = fpByKey.get(key);
    const box = placementAabb(
      p.freeXMm ?? 0,
      p.freeYMm ?? 0,
      fp?.width ?? 600,
      fp?.depth ?? 600,
      p.freeYawDeg ?? 0,
    );
    placed.push({
      p,
      center: params.axis === 'x' ? (box.minX + box.maxX) / 2 : (box.minY + box.maxY) / 2,
      size: params.axis === 'x' ? box.maxX - box.minX : box.maxY - box.minY,
    });
  }
  placed.sort((a, b) => a.center - b.center);
  const first = placed[0]!.center;
  const last = placed[placed.length - 1]!.center;
  const step = (last - first) / (placed.length - 1);
  const nextPlacements = placed.map((entry, i) => {
    const target = first + step * i;
    const delta = target - entry.center;
    if (params.axis === 'x') {
      return { ...entry.p, freeXMm: Math.round((entry.p.freeXMm ?? 0) + delta) };
    }
    return { ...entry.p, freeYMm: Math.round((entry.p.freeYMm ?? 0) + delta) };
  });
  if (freePlacementsClash(params.layout, fpByKey, placed.map((e) => e.p), nextPlacements)) {
    return {
      ok: false,
      reason: 'overlap',
      message: 'Distribuir las islas las superpondría. Separalas sobre el eje primero.',
    };
  }
  return {
    ok: true,
    layout: replacePlacements(params.layout, placed.map((e) => e.p), nextPlacements),
    itemPatches: [],
    createdKeys: [],
  };
}

/**
 * Alinear bordes/centros — islas (plano libre 2D). Sobre un muro esta
 * operación es físicamente imposible (apilaría muebles): el mensaje enseña a
 * usar Compactar/Centrar.
 */
export function alignSelectionCommand(params: {
  readonly layout: ProjectKitchenLayout;
  readonly footprints: readonly KitchenFootprint[];
  readonly keys: readonly PlacementKey[];
  readonly mode: 'left' | 'right' | 'centers-x' | 'front' | 'back' | 'centers-y';
}): LayoutCommandResult {
  if (params.keys.length < 2) {
    return {
      ok: false,
      reason: 'too-few',
      message: 'Alinear necesita al menos 2 islas.',
    };
  }
  const fpByKey = footprintMap(params.footprints);
  const entries: {
    p: ProjectItemPlacement;
    box: { minX: number; maxX: number; minY: number; maxY: number };
  }[] = [];
  for (const key of params.keys) {
    const p = findPlacement(params.layout, key);
    if (!p || !isFreePlacement(p)) {
      return {
        ok: false,
        reason: 'mixed-placement',
        message: 'Alinear bordes funciona con islas; los muebles de muro se alinean con Compactar o Centrar en muro.',
      };
    }
    const fp = fpByKey.get(key);
    entries.push({
      p,
      box: placementAabb(
        p.freeXMm ?? 0,
        p.freeYMm ?? 0,
        fp?.width ?? 600,
        fp?.depth ?? 600,
        p.freeYawDeg ?? 0,
      ),
    });
  }
  const bounds = entries.reduce(
    (acc, e) => ({
      minX: Math.min(acc.minX, e.box.minX),
      maxX: Math.max(acc.maxX, e.box.maxX),
      minY: Math.min(acc.minY, e.box.minY),
      maxY: Math.max(acc.maxY, e.box.maxY),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  const nextPlacements = entries.map(({ p, box }) => {
    let dx = 0;
    let dy = 0;
    switch (params.mode) {
      case 'left':
        dx = bounds.minX - box.minX;
        break;
      case 'right':
        dx = bounds.maxX - box.maxX;
        break;
      case 'centers-x':
        dx = (bounds.minX + bounds.maxX) / 2 - (box.minX + box.maxX) / 2;
        break;
      case 'front':
        dy = bounds.minY - box.minY;
        break;
      case 'back':
        dy = bounds.maxY - box.maxY;
        break;
      case 'centers-y':
        dy = (bounds.minY + bounds.maxY) / 2 - (box.minY + box.maxY) / 2;
        break;
    }
    return {
      ...p,
      freeXMm: Math.round((p.freeXMm ?? 0) + dx),
      freeYMm: Math.round((p.freeYMm ?? 0) + dy),
    };
  });
  if (freePlacementsClash(params.layout, fpByKey, entries.map((e) => e.p), nextPlacements)) {
    return {
      ok: false,
      reason: 'overlap',
      message: 'Alinear las islas las superpondría. Separalas o alineá por otro eje.',
    };
  }
  return {
    ok: true,
    layout: replacePlacements(params.layout, entries.map((e) => e.p), nextPlacements),
    itemPatches: [],
    createdKeys: [],
  };
}

/** Centrar la selección (unidad o corrida, conservando el span) en su muro. */
export function centerSelectionOnWallCommand(params: {
  readonly layout: ProjectKitchenLayout;
  readonly footprints: readonly KitchenFootprint[];
  readonly keys: readonly PlacementKey[];
}): LayoutCommandResult {
  const sel = resolveWallSelection(
    params.layout,
    params.footprints,
    params.keys,
    'Centrar',
  );
  if ('error' in sel) return sel.error;
  const widthOfSel = (p: ProjectItemPlacement): number =>
    widthOf(sel.fpByKey, `${p.itemId}#${p.instanceIndex}`);
  const start = Math.min(...sel.placements.map((p) => p.offsetMm));
  const end = Math.max(...sel.placements.map((p) => p.offsetMm + widthOfSel(p)));
  const span = end - start;
  if (span > sel.wallLengthMm + 1) {
    return {
      ok: false,
      reason: 'no-space',
      message: `La selección es más larga que ${sel.name}; no se puede centrar.`,
    };
  }
  const delta = Math.round((sel.wallLengthMm - span) / 2) - start;
  const nextPlacements = sel.placements.map((p) => ({
    ...p,
    offsetMm: p.offsetMm + delta,
  }));
  if (clashOnWall(params.layout, sel, nextPlacements)) {
    return {
      ok: false,
      reason: 'overlap',
      message: `Centrar la selección la dejaría sobre otros muebles de ${sel.name}. Liberá el centro del muro.`,
    };
  }
  return {
    ok: true,
    layout: replacePlacements(params.layout, sel.placements, nextPlacements),
    itemPatches: [],
    createdKeys: [],
  };
}

function replacePlacements(
  layout: ProjectKitchenLayout,
  previous: readonly ProjectItemPlacement[],
  next: readonly ProjectItemPlacement[],
): ProjectKitchenLayout {
  const replace = new Map(
    previous.map((p, i) => [`${p.itemId}#${p.instanceIndex}`, next[i]!]),
  );
  return {
    ...layout,
    placements: layout.placements.map((p) =>
      replace.get(`${p.itemId}#${p.instanceIndex}`) ?? p,
    ),
  };
}

function freePlacementsClash(
  layout: ProjectKitchenLayout,
  fpByKey: Map<PlacementKey, KitchenFootprint>,
  previous: readonly ProjectItemPlacement[],
  moved: readonly ProjectItemPlacement[],
): boolean {
  const movedKeys = new Set(
    previous.map((p) => `${p.itemId}#${p.instanceIndex}`),
  );
  const boxes = [
    ...layout.placements
      .filter((p) => isFreePlacement(p) && !movedKeys.has(`${p.itemId}#${p.instanceIndex}`))
      .map((p) =>
        placementAabb(
          p.freeXMm ?? 0,
          p.freeYMm ?? 0,
          widthOf(fpByKey, `${p.itemId}#${p.instanceIndex}`),
          fpByKey.get(`${p.itemId}#${p.instanceIndex}`)?.depth ?? 600,
          p.freeYawDeg ?? 0,
        ),
      ),
    ...moved.map((p) =>
      placementAabb(
        p.freeXMm ?? 0,
        p.freeYMm ?? 0,
        widthOf(fpByKey, `${p.itemId}#${p.instanceIndex}`),
        fpByKey.get(`${p.itemId}#${p.instanceIndex}`)?.depth ?? 600,
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
        return true;
      }
    }
  }
  return false;
}
