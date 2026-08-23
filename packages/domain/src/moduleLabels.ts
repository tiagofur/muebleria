/**
 * Module / Furniture / Package labels generator for workshop production & logistics.
 * Pure domain logic — generates one label per physical unit with package indexing (e.g. Bulto 3 de 8).
 */

import type { Catalog, Project, ProjectItem, ModuleLabel } from './types';
import { resolveItemDims } from './itemDims';
import { effectiveOptionChoices } from './optionChoices';
import { baseContextForItem } from './plinth';
import { resolveBom } from './engine/bom';
import { findModule } from './engine/shared';
import { normalizeItemFloorStatus } from './productionFloor';
import { ResolutionError, ValidationError } from './errors';
import { ensureKitchenSpaces } from './kitchenLayout';

export interface GenerateModuleLabelsOptions {
  readonly customerName?: string;
  readonly revision?: string;
  /** Filter to specific item IDs (e.g. space/scope filtering) */
  readonly itemIds?: ReadonlySet<string> | null;
}

function resolveDims(
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
 * Generate module/furniture labels for a project.
 * Yields one label per physical unit (`item.quantity` 3 yields 3 separate labels: unit 1/3, 2/3, 3/3),
 * with global package numbering `Bulto packageIndex de totalPackages`.
 */
export function generateModuleLabels(
  project: Project,
  catalog: Catalog,
  options: GenerateModuleLabelsOptions = {},
): ModuleLabel[] {
  const { customerName, revision, itemIds } = options;
  const labels: ModuleLabel[] = [];

  // Filter items if requested
  const activeItems = project.items.filter((item) => !itemIds || itemIds.has(item.id));

  // Compute total physical packages
  let totalPackages = 0;
  for (const item of activeItems) {
    if (!(item.quantity > 0)) {
      throw new ValidationError(
        `Project item quantity must be > 0 (got ${item.quantity})`,
        { projectId: project.id, projectItemId: item.id, field: 'quantity' },
      );
    }
    totalPackages += Math.max(1, Math.floor(item.quantity));
  }

  // Pre-calculate spaces and walls from layout if present
  const layout = project.kitchenLayout ? ensureKitchenSpaces(project.kitchenLayout) : null;
  const spaces = layout?.spaces ?? [];
  const wallMap = new Map<string, { wallName: string; spaceName: string }>();
  for (const space of spaces) {
    for (const wall of space.walls) {
      wallMap.set(wall.id, {
        wallName: wall.name || 'Muro',
        spaceName: space.name || 'Cocina',
      });
    }
  }

  const placements = project.kitchenLayout?.placements ?? [];
  const codeCounts = new Map<string, number>();
  let currentPackageIndex = 0;

  for (const item of activeItems) {
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
    const d = resolveDims(item, catalog);

    // Count parts & hardware via BOM
    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
      item.structureRevisionPin,
      baseContextForItem(project, item, catalog),
      item.customDims,
    );

    const boardPartCount = bom.boardParts.reduce((sum, p) => sum + p.quantity, 0);
    const hardwareCount = bom.hardwareLines.reduce((sum, h) => sum + h.quantity, 0);

    const quantity = Math.max(1, Math.floor(item.quantity));
    for (let unitIndex = 1; unitIndex <= quantity; unitIndex++) {
      currentPackageIndex++;

      // Find matching placement for this copy
      const placement = placements.find(
        (p) => p.itemId === item.id && p.instanceIndex === unitIndex - 1,
      );

      let spaceName: string | undefined;
      let wallName: string | undefined;
      if (placement) {
        if (placement.mode === 'free') {
          spaceName = 'Isla / Libre';
        } else if (placement.wallId) {
          const wallInfo = wallMap.get(placement.wallId);
          if (wallInfo) {
            spaceName = wallInfo.spaceName;
            wallName = wallInfo.wallName;
          }
        }
      }

      labels.push({
        itemId: item.id,
        factoryCode,
        moduleCode,
        moduleName: module.name,
        projectId: project.id,
        projectName: project.name,
        customerName: customerName ?? undefined,
        packageIndex: currentPackageIndex,
        totalPackages,
        unitIndex,
        unitQuantity: quantity,
        widthMm: d.width,
        heightMm: d.height,
        depthMm: d.depth,
        measuresLabel: d.label,
        spaceName,
        wallName,
        floorStatus: normalizeItemFloorStatus(item.floorStatus),
        boardPartCount,
        hardwareCount,
        revision: revision ?? undefined,
      });
    }
  }

  return labels;
}
