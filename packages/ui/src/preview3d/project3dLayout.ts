/**
 * Pure layout for multi-module quote preview (linear kitchen run).
 * Workshop frame: +X along the wall, +Y depth, +Z height.
 */

export type ModuleFootprint = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** How many copies to place side-by-side (line quantity). */
  readonly quantity: number;
};

export type PlacedModuleFootprint = ModuleFootprint & {
  readonly instanceKey: string;
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
};

export type ProjectLayoutResult = {
  readonly placements: readonly PlacedModuleFootprint[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly totalDepth: number;
};

/** Gap between adjacent cabinets on a straight run (mm). */
export const PROJECT_RUN_GAP_MM = 20;

/**
 * Shared fallback outer dims when module/structure measures are missing.
 * Used by module and project 3D previews so broken modules frame the same.
 */
export const DEFAULT_MODULE_FOOTPRINT_MM = {
  width: 600,
  height: 720,
  depth: 560,
} as const;

/**
 * Place modules in a single straight run along +X.
 * Quantity > 1 duplicates the footprint side-by-side.
 */
export function layoutProjectRun(
  modules: readonly ModuleFootprint[],
  gapMm: number = PROJECT_RUN_GAP_MM,
): ProjectLayoutResult {
  const placements: PlacedModuleFootprint[] = [];
  let cursorX = 0;
  let maxH = 0;
  let maxD = 0;

  for (const mod of modules) {
    const qty = Math.max(1, Math.floor(mod.quantity) || 1);
    const w = Math.max(mod.width, 1);
    const h = Math.max(mod.height, 1);
    const d = Math.max(mod.depth, 1);
    maxH = Math.max(maxH, h);
    maxD = Math.max(maxD, d);

    for (let i = 0; i < qty; i++) {
      placements.push({
        ...mod,
        quantity: 1,
        instanceKey: `${mod.id}#${i}`,
        originX: cursorX,
        originY: 0,
        originZ: 0,
      });
      cursorX += w + gapMm;
    }
  }

  const totalWidth =
    placements.length === 0
      ? 0
      : cursorX > 0
        ? cursorX - gapMm
        : 0;

  return {
    placements,
    totalWidth: Math.max(totalWidth, 1),
    totalHeight: Math.max(maxH, 1),
    totalDepth: Math.max(maxD, 1),
  };
}
