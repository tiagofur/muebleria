/**
 * Assembly sheets per project line (PROD-4.1 / #239).
 * Design read-only summary for shop floor arming.
 */

import type { Catalog, Project, ProjectItem } from './types';
import { resolveItemDims } from './itemDims';
import { effectiveOptionChoices } from './optionChoices';
import { baseContextForItem } from './plinth';
import { resolveBom } from './engine/bom';
import { findModule } from './engine/shared';
import { normalizeItemFloorStatus, type ItemFloorStatus } from './productionFloor';
import { ResolutionError, ValidationError } from './errors';

export type AssemblySheetHardwareLine = {
  readonly code: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
};

export type AssemblySheet = {
  readonly itemId: string;
  readonly factoryCode: string;
  readonly moduleCode: string;
  readonly moduleName: string;
  readonly quantity: number;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
  readonly depthMm: number | null;
  readonly measuresLabel: string;
  readonly floorStatus: ItemFloorStatus;
  readonly boardPartLines: number;
  readonly hardware: readonly AssemblySheetHardwareLine[];
};

function dims(
  item: ProjectItem,
  catalog: Catalog,
): { width: number | null; height: number | null; depth: number | null; label: string } {
  const mod = findModule(catalog, item.moduleId);
  if (!mod) {
    return { width: null, height: null, depth: null, label: '—' };
  }
  // F144: single-source dims (customDims → preset → module).
  const resolved = resolveItemDims(item, mod);
  if (resolved.source !== 'fallback') {
    const { width, height, depth } = resolved;
    return {
      width,
      height,
      depth,
      label: `${width}×${height}×${depth} mm${resolved.source === 'custom' ? ' · a medida' : ''}`,
    };
  }
  return { width: null, height: null, depth: null, label: 'Sin medidas' };
}

/**
 * Build one assembly sheet per project line item.
 * Optional `itemIds` filters to a production scope (e.g. one kitchen space).
 */
export function buildAssemblySheets(
  project: Project,
  catalog: Catalog,
  itemIds?: ReadonlySet<string> | null,
): AssemblySheet[] {
  const codeCounts = new Map<string, number>();
  const sheets: AssemblySheet[] = [];

  for (const item of project.items) {
    if (itemIds && !itemIds.has(item.id)) continue;
    if (!(item.quantity > 0)) {
      throw new ValidationError(
        `Project item quantity must be > 0 (got ${item.quantity})`,
        { projectId: project.id, projectItemId: item.id, field: 'quantity' },
      );
    }

    const module = findModule(catalog, item.moduleId);
    if (!module) {
      throw new ResolutionError(
        `Module not found for project item: ${item.moduleId}`,
        {
          projectId: project.id,
          projectItemId: item.id,
          moduleId: item.moduleId,
          field: 'moduleId',
        },
      );
    }

    const moduleCode = module.code?.trim() || item.moduleId.slice(0, 8);
    const seen = (codeCounts.get(moduleCode) ?? 0) + 1;
    codeCounts.set(moduleCode, seen);
    const factoryCode = seen === 1 ? moduleCode : `${moduleCode}-L${seen}`;
    const d = dims(item, catalog);

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
      item.structureRevisionPin,
      baseContextForItem(project, item, catalog),
      item.customDims,
    );

    const hardwareMap = new Map<
      string,
      { code: string; description: string; quantity: number; unit: string }
    >();
    for (const line of bom.hardwareLines) {
      const hw = catalog.hardware.find((h) => h.id === line.hardwareId);
      if (!hw) continue;
      const qty = line.quantity * item.quantity;
      const prev = hardwareMap.get(hw.id);
      if (prev) {
        prev.quantity += qty;
      } else {
        hardwareMap.set(hw.id, {
          code: hw.code,
          description: hw.name || hw.code,
          quantity: qty,
          unit: hw.unit,
        });
      }
    }

    sheets.push({
      itemId: item.id,
      factoryCode,
      moduleCode,
      moduleName: module.name,
      quantity: item.quantity,
      widthMm: d.width,
      heightMm: d.height,
      depthMm: d.depth,
      measuresLabel: d.label,
      floorStatus: normalizeItemFloorStatus(item.floorStatus),
      boardPartLines: bom.boardParts.length,
      hardware: [...hardwareMap.values()].sort((a, b) =>
        a.code.localeCompare(b.code, 'es'),
      ),
    });
  }

  return sheets;
}
