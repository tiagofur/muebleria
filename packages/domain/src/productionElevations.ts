/**
 * Wall elevations for production documentation (PROD-1.1).
 * Pure domain — no PDF. UI / excel consume the drawing model.
 */

import type {
  Module,
  PlacementElevation,
  Project,
  ProjectItem,
  ProjectItemPlacement,
} from './types';
import { defaultMeasurePresetId, resolveModuleMeasurePreset } from './measurePresets';
import { emptyKitchenLayout, pruneKitchenLayout } from './kitchenLayout';

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

export type ProductionElevationsResult = {
  readonly walls: readonly ProductionWallElevation[];
  /** Quote instances not on any wall placement. */
  readonly unplaced: readonly ProductionUnplacedUnit[];
  /** Free-place / island units (not drawn on wall elevations). */
  readonly freePlace: readonly ProductionUnplacedUnit[];
};

function dimsForItem(
  item: ProjectItem,
  modules: readonly Module[],
): { width: number; height: number; depth: number } {
  const mod = modules.find((m) => m.id === item.moduleId);
  if (!mod) return { width: 600, height: 720, depth: 560 };
  try {
    const preset = resolveModuleMeasurePreset(
      mod,
      item.measurePresetId?.trim() || defaultMeasurePresetId(mod) || undefined,
    );
    if (preset) {
      return {
        width: preset.width,
        height: preset.height,
        depth: preset.depth,
      };
    }
  } catch {
    /* fall through */
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
 * Build wall elevations + unplaced/free lists from project kitchen layout.
 * Does not invent positions for unplaced units on walls.
 */
export function buildProductionElevations(
  project: Project,
  modules: readonly Module[],
): ProductionElevationsResult {
  const layout = pruneKitchenLayout(
    project.kitchenLayout ?? emptyKitchenLayout(),
    project.items,
  );

  const wallCabinetsZ = layout.wallCabinetZMm ?? 1400;
  const defaultBaseClearance = layout.baseClearanceMm ?? 100;

  const walls: ProductionWallElevation[] = layout.walls.map((wall) => {
    const wallPlacements = layout.placements.filter(
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
    layout.placements
      .filter((p) => p.mode === undefined || p.mode === 'wall')
      .map((p) => `${p.itemId}#${p.instanceIndex}`),
  );
  const freeKeys = new Set(
    layout.placements
      .filter((p) => p.mode === 'free')
      .map((p) => `${p.itemId}#${p.instanceIndex}`),
  );

  const unplaced: ProductionUnplacedUnit[] = [];
  const freePlace: ProductionUnplacedUnit[] = [];

  for (const item of project.items) {
    const mod = modules.find((m) => m.id === item.moduleId);
    const qty = Math.max(1, item.quantity);
    for (let i = 0; i < qty; i++) {
      const key = `${item.id}#${i}`;
      const { label, moduleCode } = unitLabel(mod, item, i);
      const entry: ProductionUnplacedUnit = {
        itemId: item.id,
        instanceIndex: i,
        label,
        moduleCode,
        quantityNote: qty > 1 ? `${i + 1}/${qty}` : '1',
      };
      if (freeKeys.has(key)) {
        freePlace.push(entry);
      } else if (!placedKeys.has(key)) {
        unplaced.push(entry);
      }
    }
  }

  return { walls, unplaced, freePlace };
}

/** True when there is at least one wall to draw. */
export function hasProductionElevations(
  result: ProductionElevationsResult,
): boolean {
  return result.walls.length > 0;
}
