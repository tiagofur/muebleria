/**
 * Read-only module inventory rows for production hub (PROD-0.4).
 * Pure helpers — no React.
 */

import type {
  ItemFloorStatus,
  Module,
  Project,
  ProjectItem,
  ProjectItemPlacement,
  ProductionCutRow,
} from '@muebles/domain';
import {
  defaultMeasurePresetId,
  normalizeItemFloorStatus,
  resolveModuleMeasurePreset,
} from '@muebles/domain';

export type ProductionModuleRow = {
  readonly itemId: string;
  /** Stable factory code: module code + line suffix when needed. */
  readonly factoryCode: string;
  readonly moduleCode: string;
  readonly moduleName: string;
  readonly quantity: number;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
  readonly depthMm: number | null;
  readonly measuresLabel: string;
  /** Wall names or free-place; null if no kitchen layout. */
  readonly placementLabel: string | null;
  readonly unplaced: boolean;
  /** Cut rows linked to this module (by moduleCode when available). */
  readonly pieceCount: number;
  /** Shop-floor status (PROD-3.1). */
  readonly floorStatus: ItemFloorStatus;
};

function measuresForItem(
  item: ProjectItem,
  modules: readonly Module[],
): {
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
  label: string;
} {
  const mod = modules.find((m) => m.id === item.moduleId);
  if (!mod) {
    return {
      widthMm: null,
      heightMm: null,
      depthMm: null,
      label: '—',
    };
  }
  try {
    const preset = resolveModuleMeasurePreset(
      mod,
      item.measurePresetId?.trim() || defaultMeasurePresetId(mod) || undefined,
    );
    if (preset) {
      return {
        widthMm: preset.width,
        heightMm: preset.height,
        depthMm: preset.depth,
        label: `${preset.width}×${preset.height}×${preset.depth} mm`,
      };
    }
  } catch {
    /* fall through */
  }
  if (mod.externalDims) {
    const { width, height, depth } = mod.externalDims;
    return {
      widthMm: width,
      heightMm: height,
      depthMm: depth,
      label: `${width}×${height}×${depth} mm`,
    };
  }
  return {
    widthMm: null,
    heightMm: null,
    depthMm: null,
    label: 'Sin medidas',
  };
}

function allPlacements(project: Project): readonly ProjectItemPlacement[] {
  const layout = project.kitchenLayout;
  if (!layout) return [];
  if (layout.spaces && layout.spaces.length > 0) {
    return layout.spaces.flatMap((s) => s.placements ?? []);
  }
  return layout.placements ?? [];
}

function wallNameById(project: Project, wallId: string): string {
  const layout = project.kitchenLayout;
  if (!layout) return wallId;
  const walls =
    layout.spaces && layout.spaces.length > 0
      ? layout.spaces.flatMap((s) => s.walls ?? [])
      : (layout.walls ?? []);
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return wallId;
  return wall.name?.trim() || `Muro ${wall.lengthMm} mm`;
}

function placementSummary(
  project: Project,
  itemId: string,
): { label: string | null; unplaced: boolean } {
  const layout = project.kitchenLayout;
  if (!layout) {
    return { label: null, unplaced: false };
  }
  const wallCount =
    layout.spaces && layout.spaces.length > 0
      ? layout.spaces.reduce((n, s) => n + (s.walls?.length ?? 0), 0)
      : (layout.walls?.length ?? 0);
  if (wallCount === 0 && !(layout.placements?.length)) {
    return { label: null, unplaced: false };
  }

  const placements = allPlacements(project).filter((p) => p.itemId === itemId);
  if (placements.length === 0) {
    return { label: 'Sin colocar', unplaced: true };
  }

  const parts: string[] = [];
  for (const p of placements) {
    if (p.mode === 'free') {
      parts.push('Libre / isla');
    } else {
      parts.push(wallNameById(project, p.wallId));
    }
  }
  const unique = [...new Set(parts)];
  return { label: unique.join(', '), unplaced: false };
}

function pieceCountForModule(
  moduleCode: string,
  cutRows: readonly ProductionCutRow[] | null,
): number {
  if (!cutRows || cutRows.length === 0) return 0;
  let n = 0;
  for (const row of cutRows) {
    if (row.moduleCode && row.moduleCode === moduleCode) {
      n += row.quantity > 0 ? row.quantity : 1;
    }
  }
  // Fallback: if no moduleCode on rows, do not invent per-line counts.
  return n;
}

/**
 * Build factory inventory rows for the production modules tab.
 * Factory codes: first line of a module code stays as code; duplicates get -L2, -L3…
 */
export function buildProductionModuleRows(
  project: Project,
  modules: readonly Module[],
  cutRows: readonly ProductionCutRow[] | null = null,
): ProductionModuleRow[] {
  const codeCounts = new Map<string, number>();
  const rows: ProductionModuleRow[] = [];

  for (const item of project.items) {
    const mod = modules.find((m) => m.id === item.moduleId);
    const moduleCode = mod?.code?.trim() || item.moduleId.slice(0, 8);
    const moduleName = mod?.name?.trim() || 'Módulo desconocido';
    const seen = (codeCounts.get(moduleCode) ?? 0) + 1;
    codeCounts.set(moduleCode, seen);
    const factoryCode = seen === 1 ? moduleCode : `${moduleCode}-L${seen}`;
    const measures = measuresForItem(item, modules);
    const place = placementSummary(project, item.id);

    rows.push({
      itemId: item.id,
      factoryCode,
      moduleCode,
      moduleName,
      quantity: item.quantity,
      widthMm: measures.widthMm,
      heightMm: measures.heightMm,
      depthMm: measures.depthMm,
      measuresLabel: measures.label,
      placementLabel: place.label,
      unplaced: place.unplaced,
      pieceCount: pieceCountForModule(moduleCode, cutRows),
      floorStatus: normalizeItemFloorStatus(item.floorStatus),
    });
  }

  return rows;
}
