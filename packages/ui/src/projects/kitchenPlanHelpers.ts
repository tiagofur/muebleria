/**
 * Shared kitchen plan helper functions — used by both KitchenPlanPanel
 * (editor) and PresentationKitchenPlanSlide (read-only presentation).
 * Extracted to avoid DRY violations between the two components.
 */

import type {
  Module,
  Project,
  ProjectItem,
} from '@muebles/domain';
import {
  defaultMeasurePresetId,
  resolveItemDims,
} from '@muebles/domain';

function moduleDims(
  item: ProjectItem,
  modules: readonly Module[],
): { width: number; height: number; depth: number } {
  const mod = modules.find((m) => m.id === item.moduleId);
  if (!mod) return { width: 600, height: 720, depth: 560 };
  // F144: single-source dims (customDims → preset → module).
  const resolved = resolveItemDims(
    {
      customDims: item.customDims,
      measurePresetId:
        item.measurePresetId?.trim() || defaultMeasurePresetId(mod) || undefined,
    },
    mod,
  );
  if (resolved.source !== 'fallback') {
    return { width: resolved.width, height: resolved.height, depth: resolved.depth };
  }
  return { width: 600, height: 720, depth: 560 };
}

/** Resolve the width (mm) of a project item based on its module preset or external dims. */
export function moduleWidth(
  item: ProjectItem,
  modules: readonly Module[],
): number {
  return moduleDims(item, modules).width;
}

/** Resolve depth (mm) for plan footprints. */
export function moduleDepth(
  item: ProjectItem,
  modules: readonly Module[],
): number {
  return moduleDims(item, modules).depth;
}

/** Resolve height (mm) for plan footprints. */
export function moduleHeight(
  item: ProjectItem,
  modules: readonly Module[],
): number {
  return moduleDims(item, modules).height;
}

/** Compute all footprints (instances) for a project's items. */
export function allFootprints(
  project: Project,
  modules: readonly Module[],
): { itemId: string; instanceIndex: number; width: number; height: number; depth: number }[] {
  const out: { itemId: string; instanceIndex: number; width: number; height: number; depth: number }[] = [];
  for (const item of project.items) {
    // F144: moduleDims ya resuelve customDims → preset → module.
    const { width: w, height: h, depth: d } = moduleDims(item, modules);
    const qty = Math.max(1, item.quantity);
    for (let i = 0; i < qty; i++) {
      out.push({ itemId: item.id, instanceIndex: i, width: w, height: h, depth: d });
    }
  }
  return out;
}

/** Display label for an item instance (e.g. "MOD-GAB-01 — Gabinete (copia 2)"). */
export function itemLabel(
  itemId: string,
  instanceIndex: number,
  project: Project,
  modules: readonly Module[],
): string {
  const item = project.items.find((i) => i.id === itemId);
  const mod = modules.find((m) => m.id === item?.moduleId);
  const base = mod ? `${mod.code} — ${mod.name}` : itemId;
  const qty = item?.quantity ?? 1;
  return qty > 1 ? `${base} (copia ${instanceIndex + 1})` : base;
}

/**
 * 2D representation of a placed cabinet in workshop coordinates (mm).
 * Flush with the interior face of the wall (or freely placed), with its front face marked.
 */
export type PlacementVisualCategory = 'base' | 'alacena' | 'alto' | 'isla';

export function getPlacementCategory(params: {
  readonly isFree?: boolean;
  readonly elevation?: string;
  readonly furnitureType?: string;
}): PlacementVisualCategory {
  if (params.isFree) return 'isla';
  if (params.furnitureType === 'alto') return 'alto';
  if (params.elevation === 'wall' || params.furnitureType === 'superior') return 'alacena';
  return 'base';
}

export function getCategoryTheme(category: PlacementVisualCategory): {
  readonly label: string;
  readonly fillColor: string;
  readonly strokeColor: string;
  readonly isDashed: boolean;
  readonly swatchClass: string;
} {
  switch (category) {
    case 'alto':
      return {
        label: 'Despensa (alto)',
        fillColor: 'var(--brand-500, #6366f1)',
        strokeColor: 'var(--brand-700, #4338ca)',
        isDashed: false,
        swatchClass: 'kitchen-plan__swatch--alto',
      };
    case 'alacena':
      return {
        label: 'Alacena (muro)',
        fillColor: 'var(--info-500, #0284c7)',
        strokeColor: 'var(--info-700, #0369a1)',
        isDashed: true,
        swatchClass: 'kitchen-plan__swatch--wall',
      };
    case 'isla':
      return {
        label: 'Isla (libre)',
        fillColor: 'var(--warning-500, #f59e0b)',
        strokeColor: 'var(--warning-700, #b45309)',
        isDashed: false,
        swatchClass: 'kitchen-plan__swatch--free',
      };
    case 'base':
    default:
      return {
        label: 'Base (piso)',
        fillColor: 'var(--success-500, #16a34a)',
        strokeColor: 'var(--success-700, #15803d)',
        isDashed: false,
        swatchClass: 'kitchen-plan__swatch--floor',
      };
  }
}

export type ResolvedPlacement2D = {
  readonly itemId: string;
  readonly instanceIndex: number;
  readonly label: string;
  readonly shortCode: string;
  readonly elevation: 'floor' | 'wall';
  readonly furnitureType?: 'inferior' | 'superior' | 'alto';
  readonly category: PlacementVisualCategory;
  readonly isFree: boolean;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly originXMm: number;
  readonly originYMm: number;
  readonly yawDeg: number;
  readonly boxMm: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
  readonly frontFaceMm: {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  };
};

/**
 * Calculate 2D workshop bounds and front-face coordinates for a placement.
 */
export function resolvePlacement2D(params: {
  readonly placement: {
    readonly itemId: string;
    readonly instanceIndex: number;
    readonly elevation?: string;
    readonly mode?: string;
    readonly wallId?: string;
    readonly offsetMm?: number;
    readonly freeXMm?: number;
    readonly freeYMm?: number;
    readonly freeYawDeg?: number;
  };
  readonly wallFrame?: {
    readonly originXMm: number;
    readonly originYMm: number;
    readonly angleDeg: number;
    readonly lengthMm: number;
  };
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm?: number;
  readonly furnitureType?: 'inferior' | 'superior' | 'alto';
  readonly label?: string;
  readonly shortCode?: string;
}): ResolvedPlacement2D | null {
  const {
    placement,
    wallFrame,
    widthMm,
    depthMm,
    heightMm = 720,
    furnitureType,
    label = '',
    shortCode = '',
  } = params;
  const isFree = placement.mode === 'free';
  const elevation: 'floor' | 'wall' = placement.elevation === 'wall' ? 'wall' : 'floor';
  const category = getPlacementCategory({ isFree, elevation, furnitureType });

  let originXMm: number;
  let originYMm: number;
  let yawDeg: number;

  if (isFree) {
    originXMm = Number.isFinite(placement.freeXMm) ? (placement.freeXMm as number) : 0;
    originYMm = Number.isFinite(placement.freeYMm) ? (placement.freeYMm as number) : 0;
    const rawYaw = Number.isFinite(placement.freeYawDeg) ? (placement.freeYawDeg as number) : 0;
    const normalizedYaw = ((rawYaw % 360) + 360) % 360;
    if (normalizedYaw > 45 && normalizedYaw < 135) yawDeg = 90;
    else if (normalizedYaw >= 135 && normalizedYaw <= 225) yawDeg = 180;
    else if (normalizedYaw > 225 && normalizedYaw < 315) yawDeg = 270;
    else yawDeg = 0;
  } else {
    if (!wallFrame) return null;
    const angle = ((wallFrame.angleDeg % 360) + 360) % 360;
    const offset = Math.max(0, placement.offsetMm ?? 0);

    if (angle > 45 && angle < 135) {
      // Wall along +Y (e.g. right wall): cabinet extends to the left into room (-X)
      yawDeg = 90;
      originXMm = wallFrame.originXMm;
      originYMm = wallFrame.originYMm + offset;
    } else if (angle >= 135 && angle <= 225) {
      // Wall along -X (e.g. bottom wall): cabinet extends upwards into room (-Y)
      yawDeg = 180;
      originXMm = wallFrame.originXMm - offset;
      originYMm = wallFrame.originYMm;
    } else if (angle > 225 && angle < 315) {
      // Wall along -Y (e.g. left wall): cabinet extends to the right into room (+X)
      yawDeg = 270;
      originXMm = wallFrame.originXMm;
      originYMm = wallFrame.originYMm - offset;
    } else {
      // Wall along +X (e.g. top wall): cabinet extends downwards into room (+Y)
      yawDeg = 0;
      originXMm = wallFrame.originXMm + offset;
      originYMm = wallFrame.originYMm;
    }
  }

  let minX: number;
  let maxX: number;
  let minY: number;
  let maxY: number;

  if (yawDeg === 90) {
    minX = originXMm - depthMm;
    maxX = originXMm;
    minY = originYMm;
    maxY = originYMm + widthMm;
  } else if (yawDeg === 180) {
    minX = originXMm - widthMm;
    maxX = originXMm;
    minY = originYMm - depthMm;
    maxY = originYMm;
  } else if (yawDeg === 270) {
    minX = originXMm;
    maxX = originXMm + depthMm;
    minY = originYMm - widthMm;
    maxY = originYMm;
  } else {
    minX = originXMm;
    maxX = originXMm + widthMm;
    minY = originYMm;
    maxY = originYMm + depthMm;
  }

  // Front face coordinates (the user-facing side with doors / drawers)
  let fx1: number;
  let fy1: number;
  let fx2: number;
  let fy2: number;

  if (yawDeg === 90) {
    // Facing left (-X into room)
    fx1 = minX;
    fy1 = minY;
    fx2 = minX;
    fy2 = maxY;
  } else if (yawDeg === 180) {
    // Facing up (-Y into room)
    fx1 = minX;
    fy1 = minY;
    fx2 = maxX;
    fy2 = minY;
  } else if (yawDeg === 270) {
    // Facing right (+X into room)
    fx1 = maxX;
    fy1 = minY;
    fx2 = maxX;
    fy2 = maxY;
  } else {
    // Facing down (+Y into room)
    fx1 = minX;
    fy1 = maxY;
    fx2 = maxX;
    fy2 = maxY;
  }

  return {
    itemId: placement.itemId,
    instanceIndex: placement.instanceIndex,
    label,
    shortCode,
    elevation,
    furnitureType,
    category,
    isFree,
    widthMm,
    depthMm,
    heightMm,
    originXMm,
    originYMm,
    yawDeg,
    boxMm: { minX, maxX, minY, maxY },
    frontFaceMm: { x1: fx1, y1: fy1, x2: fx2, y2: fy2 },
  };
}

export type PlanBounds = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly widthMm: number;
  readonly heightMm: number;
};

/**
 * Compute the bounding box in workshop mm for all walls, placements, and underlays.
 */
export function resolvePlanBounds(params: {
  readonly wallFrames: readonly {
    readonly originXMm: number;
    readonly originYMm: number;
    readonly endXMm: number;
    readonly endYMm: number;
  }[];
  readonly placements?: readonly ResolvedPlacement2D[];
  readonly underlay?: {
    readonly originXMm?: number;
    readonly originYMm?: number;
    readonly widthMm: number;
    readonly heightMm: number;
  };
  readonly minDimensionMm?: number;
}): PlanBounds {
  const { wallFrames, placements = [], underlay, minDimensionMm = 1000 } = params;

  let minX = 0;
  let maxX = 100;
  let minY = 0;
  let maxY = 100;
  let hasGeometry = false;

  for (const f of wallFrames) {
    if (!hasGeometry) {
      minX = Math.min(f.originXMm, f.endXMm);
      maxX = Math.max(f.originXMm, f.endXMm);
      minY = Math.min(f.originYMm, f.endYMm);
      maxY = Math.max(f.originYMm, f.endYMm);
      hasGeometry = true;
    } else {
      minX = Math.min(minX, f.originXMm, f.endXMm);
      maxX = Math.max(maxX, f.originXMm, f.endXMm);
      minY = Math.min(minY, f.originYMm, f.endYMm);
      maxY = Math.max(maxY, f.originYMm, f.endYMm);
    }
  }

  for (const p of placements) {
    if (!hasGeometry) {
      minX = p.boxMm.minX;
      maxX = p.boxMm.maxX;
      minY = p.boxMm.minY;
      maxY = p.boxMm.maxY;
      hasGeometry = true;
    } else {
      minX = Math.min(minX, p.boxMm.minX);
      maxX = Math.max(maxX, p.boxMm.maxX);
      minY = Math.min(minY, p.boxMm.minY);
      maxY = Math.max(maxY, p.boxMm.maxY);
    }
  }

  if (underlay) {
    const ux = underlay.originXMm ?? 0;
    const uy = underlay.originYMm ?? 0;
    const uw = underlay.widthMm;
    const uh = underlay.heightMm;
    if (!hasGeometry) {
      minX = ux;
      maxX = ux + uw;
      minY = uy;
      maxY = uy + uh;
      hasGeometry = true;
    } else {
      minX = Math.min(minX, ux, ux + uw);
      maxX = Math.max(maxX, ux, ux + uw);
      minY = Math.min(minY, uy, uy + uh);
      maxY = Math.max(maxY, uy, uy + uh);
    }
  }

  const widthMm = Math.max(maxX - minX, minDimensionMm);
  const heightMm = Math.max(maxY - minY, minDimensionMm);

  return {
    minX,
    maxX: minX + widthMm,
    minY,
    maxY: minY + heightMm,
    widthMm,
    heightMm,
  };
}
