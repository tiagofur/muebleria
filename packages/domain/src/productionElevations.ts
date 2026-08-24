/**
 * Wall elevations for production documentation (PROD-1.1).
 * Pure domain — no PDF. UI / excel consume the drawing model.
 */

import type {
  KitchenWall,
  Module,
  PlacementElevation,
  Project,
  ProjectItem,
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from './types';
import { resolveItemDims } from './itemDims';
import {
  emptyKitchenLayout,
  ensureKitchenSpaces,
  isFreePlacement,
  pruneKitchenLayout,
} from './kitchenLayout';

export type ProductionElevationUnit = {
  readonly itemId: string;
  readonly instanceIndex: number;
  readonly label: string;
  readonly moduleCode: string;
  readonly moduleName: string;
  readonly offsetMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
  readonly elevation: PlacementElevation;
  /** Clearance under floor units (zócalo), mm. */
  readonly baseClearanceMm: number;
  /** Bottom Z of the unit in mm from floor. */
  readonly bottomZMm: number;
};

export type ProductionWallElevation = {
  readonly wallId: string;
  readonly wallName: string;
  readonly wallLengthMm: number;
  /** Units on this wall, sorted by offsetMm. */
  readonly units: readonly ProductionElevationUnit[];
};

export type ProductionUnplacedUnit = {
  readonly itemId: string;
  readonly instanceIndex: number;
  readonly label: string;
  readonly moduleCode: string;
  readonly quantityNote: string;
};

/**
 * Free-place / island unit with everything a drawn sheet needs (#255):
 * dimensions, plan position and the ambiente it belongs to. Islands never
 * project onto wall elevations — they get their own ficha.
 */
export type ProductionIslandUnit = {
  readonly itemId: string;
  readonly instanceIndex: number;
  readonly label: string;
  readonly moduleCode: string;
  readonly moduleName: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
  /** Clearance under the island (zócalo/patas), mm. */
  readonly baseClearanceMm: number;
  /** Bottom Z of the unit in mm from floor. */
  readonly bottomZMm: number;
  /** Plan position (mm) and yaw — where the island sits in planta. */
  readonly freeXMm: number;
  readonly freeYMm: number;
  readonly freeYawDeg: number;
  readonly spaceId: string;
  readonly spaceName: string;
};

export type ProductionElevationsResult = {
  readonly walls: readonly ProductionWallElevation[];
  /** Quote instances not on any wall placement. */
  readonly unplaced: readonly ProductionUnplacedUnit[];
  /** Free-place / island units (drawn as their own sheets, not on walls). */
  readonly islands: readonly ProductionIslandUnit[];
};

function dimsForItem(
  item: ProjectItem,
  modules: readonly Module[],
): { width: number; height: number; depth: number } {
  const mod = modules.find((m) => m.id === item.moduleId);
  if (!mod) return { width: 600, height: 720, depth: 560 };
  // F144: single-source dims (customDims → preset → module).
  const resolved = resolveItemDims(item, mod);
  if (resolved.source !== 'fallback') {
    return { width: resolved.width, height: resolved.height, depth: resolved.depth };
  }
  if (mod.externalDims) {
    return {
      width: mod.externalDims.width,
      height: mod.externalDims.height,
      depth: mod.externalDims.depth,
    };
  }
  return { width: 600, height: 720, depth: 560 };
}

function unitLabel(
  mod: Module | undefined,
  item: ProjectItem,
  instanceIndex: number,
): { label: string; moduleCode: string; moduleName: string } {
  const moduleCode = mod?.code?.trim() || item.moduleId.slice(0, 8);
  const moduleName = mod?.name?.trim() || 'Módulo';
  const qty = Math.max(1, item.quantity);
  const label =
    qty > 1 ? `${moduleCode} (${instanceIndex + 1}/${qty})` : moduleCode;
  return { label, moduleCode, moduleName };
}

/**
 * Flatten multi-space layouts so factory elevations cover every ambiente,
 * not only the active space mirrored at top-level. Free placements are
 * returned separately, tagged with their space (#255 island fichas).
 */
function wallsAndPlacementsForElevations(
  layout: ProjectKitchenLayout,
): {
  readonly walls: readonly KitchenWall[];
  readonly placements: readonly ProjectItemPlacement[];
  readonly free: readonly {
    readonly placement: ProjectItemPlacement;
    readonly spaceId: string;
    readonly spaceName: string;
  }[];
} {
  const ensured = ensureKitchenSpaces(layout);
  const spaces = ensured.spaces ?? [];
  if (spaces.length <= 1) {
    const space = spaces[0];
    const spaceId = space?.id ?? 'default';
    const spaceName = space?.name?.trim() || 'Planta';
    return {
      walls: ensured.walls,
      placements: ensured.placements,
      free: ensured.placements
        .filter(isFreePlacement)
        .map((placement) => ({ placement, spaceId, spaceName })),
    };
  }

  const walls: KitchenWall[] = [];
  const placements: ProjectItemPlacement[] = [];
  const free: {
    placement: ProjectItemPlacement;
    spaceId: string;
    spaceName: string;
  }[] = [];
  for (const space of spaces) {
    const spaceName = space.name?.trim() || 'Ambiente';
    for (const wall of space.walls) {
      const wallLabel = wall.name?.trim() || `Muro ${wall.lengthMm} mm`;
      walls.push({
        ...wall,
        id: `${space.id}::${wall.id}`,
        name: `${spaceName} — ${wallLabel}`,
      });
    }
    for (const p of space.placements) {
      if (isFreePlacement(p)) {
        free.push({ placement: p, spaceId: space.id, spaceName });
      } else {
        placements.push({
          ...p,
          wallId: `${space.id}::${p.wallId}`,
        });
      }
    }
  }
  return { walls, placements, free };
}

/**
 * Build wall elevations + unplaced/free lists from project kitchen layout.
 * Does not invent positions for unplaced units on walls.
 * Multi-space: includes walls/placements from every KitchenSpace.
 */
export function buildProductionElevations(
  project: Project,
  modules: readonly Module[],
): ProductionElevationsResult {
  const layout = pruneKitchenLayout(
    project.kitchenLayout ?? emptyKitchenLayout(),
    project.items,
  );

  const {
    walls: elevWalls,
    placements: elevPlacements,
    free: freePlacements,
  } = wallsAndPlacementsForElevations(layout);

  const wallCabinetsZ = layout.wallCabinetZMm ?? 1400;
  const defaultBaseClearance = layout.baseClearanceMm ?? 100;

  const walls: ProductionWallElevation[] = elevWalls.map((wall) => {
    const wallPlacements = elevPlacements.filter(
      (p) =>
        p.wallId === wall.id &&
        (p.mode === undefined || p.mode === 'wall'),
    );

    const units: ProductionElevationUnit[] = [];
    for (const p of wallPlacements) {
      const item = project.items.find((i) => i.id === p.itemId);
      if (!item) continue;
      const mod = modules.find((m) => m.id === item.moduleId);
      const dims = dimsForItem(item, modules);
      const { label, moduleCode, moduleName } = unitLabel(
        mod,
        item,
        p.instanceIndex,
      );
      const elev = p.elevation;
      const baseClearance =
        elev === 'floor'
          ? (p.baseClearanceMm ?? defaultBaseClearance)
          : 0;
      const bottomZMm = elev === 'wall' ? wallCabinetsZ : baseClearance;

      units.push({
        itemId: p.itemId,
        instanceIndex: p.instanceIndex,
        label,
        moduleCode,
        moduleName,
        offsetMm: p.offsetMm,
        widthMm: dims.width,
        heightMm: dims.height,
        depthMm: dims.depth,
        elevation: elev,
        baseClearanceMm: baseClearance,
        bottomZMm,
      });
    }

    units.sort((a, b) => a.offsetMm - b.offsetMm || a.instanceIndex - b.instanceIndex);

    return {
      wallId: wall.id,
      wallName: wall.name?.trim() || `Muro ${wall.lengthMm} mm`,
      wallLengthMm: wall.lengthMm,
      units,
    };
  });

  const placedKeys = new Set(
    elevPlacements
      .filter((p) => p.mode === undefined || p.mode === 'wall')
      .map((p) => `${p.itemId}#${p.instanceIndex}`),
  );
  const freeByKey = new Map(
    freePlacements.map((f) => [
      `${f.placement.itemId}#${f.placement.instanceIndex}`,
      f,
    ]),
  );

  const unplaced: ProductionUnplacedUnit[] = [];
  const islands: ProductionIslandUnit[] = [];

  for (const item of project.items) {
    const mod = modules.find((m) => m.id === item.moduleId);
    const qty = Math.max(1, item.quantity);
    for (let i = 0; i < qty; i++) {
      const key = `${item.id}#${i}`;
      const free = freeByKey.get(key);
      if (free) {
        const dims = dimsForItem(item, modules);
        const { label, moduleCode, moduleName } = unitLabel(mod, item, i);
        const baseClearance = free.placement.baseClearanceMm ?? defaultBaseClearance;
        islands.push({
          itemId: item.id,
          instanceIndex: i,
          label,
          moduleCode,
          moduleName,
          widthMm: dims.width,
          heightMm: dims.height,
          depthMm: dims.depth,
          baseClearanceMm: baseClearance,
          bottomZMm: baseClearance,
          freeXMm: free.placement.freeXMm ?? 0,
          freeYMm: free.placement.freeYMm ?? 0,
          freeYawDeg: free.placement.freeYawDeg ?? 0,
          spaceId: free.spaceId,
          spaceName: free.spaceName,
        });
        continue;
      }
      if (placedKeys.has(key)) continue;
      const { label, moduleCode } = unitLabel(mod, item, i);
      unplaced.push({
        itemId: item.id,
        instanceIndex: i,
        label,
        moduleCode,
        quantityNote: qty > 1 ? `${i + 1}/${qty}` : '1',
      });
    }
  }

  islands.sort(
    (a, b) =>
      a.spaceName.localeCompare(b.spaceName) ||
      a.freeYMm - b.freeYMm ||
      a.freeXMm - b.freeXMm,
  );

  return { walls, unplaced, islands };
}

/** True when there is at least one drawable elevation sheet (wall or island). */
export function hasProductionElevations(
  result: ProductionElevationsResult,
): boolean {
  return result.walls.length > 0 || result.islands.length > 0;
}
