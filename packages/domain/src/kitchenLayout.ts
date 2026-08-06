/**
 * Kitchen plan layout (App Excellence #133).
 * Pure geometry: walls + item placements — does not touch BOM/costs.
 *
 * Workshop plan: +X right, +Y depth into room.
 * 3D viewer: originX along run, originY depth, originZ height.
 */

import type {
  KitchenWall,
  PlacementElevation,
  ProjectItem,
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from './types';

/** Default height (mm) for wall-hung units in 3D when elevation is `wall`. */
export const DEFAULT_WALL_CABINET_Z_MM = 1400;

export type KitchenFootprint = {
  readonly itemId: string;
  readonly instanceIndex: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
};

export type ResolvedWallFrame = {
  readonly id: string;
  readonly name: string;
  readonly lengthMm: number;
  readonly angleDeg: number;
  readonly originXMm: number;
  readonly originYMm: number;
  readonly endXMm: number;
  readonly endYMm: number;
};

export type KitchenPlacedModule = {
  readonly itemId: string;
  readonly instanceIndex: number;
  readonly instanceKey: string;
  readonly wallId: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  /**
   * Module yaw in degrees (workshop plan). Width aligns with wall direction;
   * depth points into the room for axis-aligned L/U plans (v1).
   * 0 = +X wall, 90 = +Y wall, 180 = −X, 270 = −Y.
   */
  readonly yawDeg: number;
};

export type KitchenLayoutResult = {
  readonly walls: readonly ResolvedWallFrame[];
  readonly placements: readonly KitchenPlacedModule[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly totalDepth: number;
  readonly warnings: readonly string[];
};

export function emptyKitchenLayout(): ProjectKitchenLayout {
  return { walls: [], placements: [] };
}

/** Chain walls in order: each starts where the previous ends unless origin is set. */
export function resolveWallFrames(
  walls: readonly KitchenWall[],
): readonly ResolvedWallFrame[] {
  const out: ResolvedWallFrame[] = [];
  let cursorX = 0;
  let cursorY = 0;

  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]!;
    const lengthMm = Math.max(1, Math.round(w.lengthMm) || 1);
    const angleDeg = Number.isFinite(w.angleDeg) ? w.angleDeg : 0;
    const rad = (angleDeg * Math.PI) / 180;
    const originXMm =
      w.originXMm !== undefined && Number.isFinite(w.originXMm)
        ? w.originXMm
        : cursorX;
    const originYMm =
      w.originYMm !== undefined && Number.isFinite(w.originYMm)
        ? w.originYMm
        : cursorY;
    const endXMm = originXMm + Math.cos(rad) * lengthMm;
    const endYMm = originYMm + Math.sin(rad) * lengthMm;
    out.push({
      id: w.id,
      name: w.name?.trim() || `Muro ${i + 1}`,
      lengthMm,
      angleDeg,
      originXMm,
      originYMm,
      endXMm,
      endYMm,
    });
    cursorX = endXMm;
    cursorY = endYMm;
  }
  return out;
}

/**
 * Soft validation warnings (Spanish). Does not throw.
 */
export function kitchenLayoutWarnings(
  layout: ProjectKitchenLayout | undefined,
  items: readonly ProjectItem[],
  footprints: readonly KitchenFootprint[] = [],
): string[] {
  if (!layout) return [];
  const warnings: string[] = [];
  const itemById = new Map(items.map((it) => [it.id, it]));
  const wallById = new Map(layout.walls.map((w) => [w.id, w]));
  const fpByKey = new Map(
    footprints.map((f) => [`${f.itemId}#${f.instanceIndex}`, f]),
  );

  for (const p of layout.placements) {
    const item = itemById.get(p.itemId);
    if (!item) {
      warnings.push(`Colocación huérfana: ítem ${p.itemId} ya no está en la cotización.`);
      continue;
    }
    if (p.instanceIndex < 0 || p.instanceIndex >= Math.max(1, item.quantity)) {
      warnings.push(
        `Índice de copia inválido para ítem ${p.itemId} (copia ${p.instanceIndex + 1}).`,
      );
    }
    const wall = wallById.get(p.wallId);
    if (!wall) {
      warnings.push(`Muro no encontrado para una colocación (${p.wallId}).`);
      continue;
    }
    const fp = fpByKey.get(`${p.itemId}#${p.instanceIndex}`);
    const width = fp?.width ?? 600;
    if (p.offsetMm < 0) {
      warnings.push(`Offset negativo en muro «${wall.name ?? wall.id}».`);
    }
    if (p.offsetMm + width > wall.lengthMm + 1) {
      warnings.push(
        `El mueble sobresale del muro «${wall.name ?? wall.id}» (${Math.round(p.offsetMm + width)} mm > ${wall.lengthMm} mm).`,
      );
    }
  }

  // Soft overlap on same wall (same elevation)
  const byWallElev = new Map<string, ProjectItemPlacement[]>();
  for (const p of layout.placements) {
    if (!wallById.has(p.wallId)) continue;
    const key = `${p.wallId}|${p.elevation}`;
    const list = byWallElev.get(key) ?? [];
    list.push(p);
    byWallElev.set(key, list);
  }
  for (const [, list] of byWallElev) {
    const sorted = [...list].sort((a, b) => a.offsetMm - b.offsetMm);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      const aw =
        fpByKey.get(`${a.itemId}#${a.instanceIndex}`)?.width ?? 600;
      if (a.offsetMm + aw > b.offsetMm + 1) {
        warnings.push('Hay solape entre muebles en el mismo muro.');
        break;
      }
    }
  }

  return warnings;
}

/** Drop placements that no longer match items; keep walls. */
export function pruneKitchenLayout(
  layout: ProjectKitchenLayout,
  items: readonly ProjectItem[],
): ProjectKitchenLayout {
  const itemById = new Map(items.map((it) => [it.id, it]));
  const wallIds = new Set(layout.walls.map((w) => w.id));
  const placements = layout.placements.filter((p) => {
    const item = itemById.get(p.itemId);
    if (!item) return false;
    if (!wallIds.has(p.wallId)) return false;
    return p.instanceIndex >= 0 && p.instanceIndex < Math.max(1, item.quantity);
  });
  return { walls: layout.walls, placements };
}

/**
 * Prune layout after quote item mutations. Returns `undefined` when both walls
 * and placements are empty (same contract as project store clear).
 */
export function pruneKitchenLayoutOrClear(
  layout: ProjectKitchenLayout | undefined,
  items: readonly ProjectItem[],
): ProjectKitchenLayout | undefined {
  if (!layout) return undefined;
  const pruned = pruneKitchenLayout(layout, items);
  if (pruned.walls.length === 0 && pruned.placements.length === 0) {
    return undefined;
  }
  return pruned;
}

/**
 * Snap wall angle to cardinal yaw so module width follows the wall and depth
 * points into the room for the default L template (walls at 0° and 90°).
 */
export function wallDirectionYawDeg(angleDeg: number): number {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a > 45 && a < 135) return 90;
  if (a >= 135 && a <= 225) return 180;
  if (a > 225 && a < 315) return 270;
  return 0;
}

/** Axis-aligned footprint AABB after yaw (workshop mm). */
export function placementAabb(
  originX: number,
  originY: number,
  width: number,
  depth: number,
  yawDeg: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const y = wallDirectionYawDeg(yawDeg);
  if (y === 90) {
    return {
      minX: originX - depth,
      maxX: originX,
      minY: originY,
      maxY: originY + width,
    };
  }
  if (y === 180) {
    return {
      minX: originX - width,
      maxX: originX,
      minY: originY - depth,
      maxY: originY,
    };
  }
  if (y === 270) {
    return {
      minX: originX,
      maxX: originX + depth,
      minY: originY - width,
      maxY: originY,
    };
  }
  return {
    minX: originX,
    maxX: originX + width,
    minY: originY,
    maxY: originY + depth,
  };
}

/**
 * Swap order of a placement on its wall, then re-pack offsets with gap.
 * Unlike a blind offset swap, widths stay contiguous.
 */
export function reorderPlacementOnWall(
  layout: ProjectKitchenLayout,
  itemId: string,
  instanceIndex: number,
  dir: -1 | 1,
  footprints: readonly KitchenFootprint[],
  gapMm: number = 20,
): ProjectKitchenLayout {
  const target = layout.placements.find(
    (p) => p.itemId === itemId && p.instanceIndex === instanceIndex,
  );
  if (!target) return layout;
  const onWall = layout.placements
    .filter((p) => p.wallId === target.wallId)
    .sort((a, b) => a.offsetMm - b.offsetMm);
  const idx = onWall.findIndex(
    (p) => p.itemId === itemId && p.instanceIndex === instanceIndex,
  );
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= onWall.length) return layout;

  const reordered = [...onWall];
  const tmp = reordered[idx]!;
  reordered[idx] = reordered[j]!;
  reordered[j] = tmp;

  const fpByKey = new Map(
    footprints.map((f) => [`${f.itemId}#${f.instanceIndex}`, f]),
  );
  const newOffset = new Map<string, number>();
  let cursor = 0;
  for (const p of reordered) {
    const key = `${p.itemId}#${p.instanceIndex}`;
    newOffset.set(key, cursor);
    const w = fpByKey.get(key)?.width ?? 600;
    cursor += w + gapMm;
  }

  return {
    ...layout,
    placements: layout.placements.map((p) => {
      const key = `${p.itemId}#${p.instanceIndex}`;
      const next = newOffset.get(key);
      return next === undefined ? p : { ...p, offsetMm: next };
    }),
  };
}

/**
 * Place modules using kitchen plan. Axis-aligned cabinets (v1):
 * - angle ~0°: along +X at wall originY, yaw 0
 * - angle ~90°: along +Y at wall originX, yaw 90 (depth into −X / room)
 */
export function layoutKitchenPlacements(
  layout: ProjectKitchenLayout,
  footprints: readonly KitchenFootprint[],
  options?: { readonly wallCabinetZMm?: number },
): KitchenLayoutResult {
  const wallZ = options?.wallCabinetZMm ?? DEFAULT_WALL_CABINET_Z_MM;
  const walls = resolveWallFrames(layout.walls);
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const fpByKey = new Map(
    footprints.map((f) => [`${f.itemId}#${f.instanceIndex}`, f]),
  );
  const warnings = kitchenLayoutWarnings(
    layout,
    // synthetic items for index checks from footprints
    uniqueItemsFromFootprints(footprints),
    footprints,
  );

  const placements: KitchenPlacedModule[] = [];
  let minX = 0;
  let maxX = 1;
  let minY = 0;
  let maxY = 1;
  let maxH = 1;
  let maxTopZ = 1;

  for (const p of layout.placements) {
    const wall = wallById.get(p.wallId);
    const fp = fpByKey.get(`${p.itemId}#${p.instanceIndex}`);
    if (!wall || !fp) continue;

    const elev: PlacementElevation = p.elevation === 'wall' ? 'wall' : 'floor';
    const originZ = elev === 'wall' ? wallZ : 0;
    const yawDeg = wallDirectionYawDeg(wall.angleDeg);
    const { originX, originY } = placementOriginsOnWall(
      wall,
      p.offsetMm,
      fp.width,
    );

    placements.push({
      itemId: p.itemId,
      instanceIndex: p.instanceIndex,
      instanceKey: `${p.itemId}#${p.instanceIndex}`,
      wallId: p.wallId,
      width: fp.width,
      height: fp.height,
      depth: fp.depth,
      originX,
      originY,
      originZ,
      yawDeg,
    });

    const box = placementAabb(originX, originY, fp.width, fp.depth, yawDeg);
    minX = Math.min(minX, box.minX);
    maxX = Math.max(maxX, box.maxX);
    minY = Math.min(minY, box.minY);
    maxY = Math.max(maxY, box.maxY);
    maxH = Math.max(maxH, fp.height);
    maxTopZ = Math.max(maxTopZ, originZ + fp.height);
  }

  // Include walls in bounds so empty plan still frames
  for (const w of walls) {
    minX = Math.min(minX, w.originXMm, w.endXMm);
    maxX = Math.max(maxX, w.originXMm, w.endXMm);
    minY = Math.min(minY, w.originYMm, w.endYMm);
    maxY = Math.max(maxY, w.originYMm, w.endYMm);
  }

  // Normalize so plan is in +X/+Y quadrant for the 3D viewer
  const shiftX = minX < 0 ? -minX : 0;
  const shiftY = minY < 0 ? -minY : 0;
  const shifted =
    shiftX === 0 && shiftY === 0
      ? placements
      : placements.map((pl) => ({
          ...pl,
          originX: pl.originX + shiftX,
          originY: pl.originY + shiftY,
        }));

  return {
    walls: walls.map((w) => ({
      ...w,
      originXMm: w.originXMm + shiftX,
      originYMm: w.originYMm + shiftY,
      endXMm: w.endXMm + shiftX,
      endYMm: w.endYMm + shiftY,
    })),
    placements: shifted,
    totalWidth: Math.max(maxX + shiftX - Math.min(0, minX + shiftX), 1),
    totalHeight: Math.max(maxTopZ, maxH, 1),
    totalDepth: Math.max(maxY + shiftY - Math.min(0, minY + shiftY), 1),
    warnings,
  };
}

function uniqueItemsFromFootprints(
  footprints: readonly KitchenFootprint[],
): ProjectItem[] {
  const map = new Map<string, number>();
  for (const f of footprints) {
    map.set(f.itemId, Math.max(map.get(f.itemId) ?? 0, f.instanceIndex + 1));
  }
  return [...map.entries()].map(([id, quantity]) => ({
    id,
    moduleId: id,
    quantity,
    optionChoices: {},
  }));
}

function placementOriginsOnWall(
  wall: ResolvedWallFrame,
  offsetMm: number,
  _moduleWidthMm: number,
): { originX: number; originY: number } {
  const angle = ((wall.angleDeg % 360) + 360) % 360;
  // Snap to axis-aligned for v1
  if (angle > 45 && angle < 135) {
    // Wall along +Y
    return {
      originX: wall.originXMm,
      originY: wall.originYMm + offsetMm,
    };
  }
  if (angle > 225 && angle < 315) {
    // Wall along -Y
    return {
      originX: wall.originXMm,
      originY: wall.originYMm - offsetMm,
    };
  }
  if (angle >= 135 && angle <= 225) {
    // Wall along -X
    return {
      originX: wall.originXMm - offsetMm,
      originY: wall.originYMm,
    };
  }
  // Default: along +X
  return {
    originX: wall.originXMm + offsetMm,
    originY: wall.originYMm,
  };
}

/**
 * Project a plan point (workshop X/Y mm) onto a wall axis → offset along wall.
 * Clamped so the module footprint stays within the wall length.
 */
export function offsetMmFromPlanPoint(
  wall: {
    readonly originXMm: number;
    readonly originYMm: number;
    readonly angleDeg: number;
    readonly lengthMm: number;
  },
  planXMm: number,
  planYMm: number,
  moduleWidthMm: number,
): number {
  const yaw = wallDirectionYawDeg(wall.angleDeg);
  let offset: number;
  if (yaw === 90) {
    offset = planYMm - wall.originYMm;
  } else if (yaw === 270) {
    offset = wall.originYMm - planYMm;
  } else if (yaw === 180) {
    offset = wall.originXMm - planXMm;
  } else {
    offset = planXMm - wall.originXMm;
  }
  const width = Math.max(1, moduleWidthMm);
  const maxOff = Math.max(0, wall.lengthMm - width);
  return Math.max(0, Math.min(maxOff, Math.round(offset)));
}

/** Suggest next offset on a wall (pack after last placement). */
export function nextOffsetOnWall(
  layout: ProjectKitchenLayout,
  wallId: string,
  footprints: readonly KitchenFootprint[],
  gapMm: number = 20,
): number {
  const onWall = layout.placements.filter((p) => p.wallId === wallId);
  if (onWall.length === 0) return 0;
  const fpByKey = new Map(
    footprints.map((f) => [`${f.itemId}#${f.instanceIndex}`, f]),
  );
  let maxEnd = 0;
  for (const p of onWall) {
    const w = fpByKey.get(`${p.itemId}#${p.instanceIndex}`)?.width ?? 600;
    maxEnd = Math.max(maxEnd, p.offsetMm + w);
  }
  return maxEnd + gapMm;
}

export function createDefaultLWalls(newId: () => string): KitchenWall[] {
  return [
    {
      id: newId(),
      name: 'Muro A',
      lengthMm: 3000,
      angleDeg: 0,
      originXMm: 0,
      originYMm: 0,
    },
    {
      id: newId(),
      name: 'Muro B',
      lengthMm: 2500,
      angleDeg: 90,
      // origin chained automatically if omitted; set for clarity
      originXMm: 3000,
      originYMm: 0,
    },
  ];
}
