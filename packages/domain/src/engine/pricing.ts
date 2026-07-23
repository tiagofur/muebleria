/**
 * Pricing: line costs (board / hardware), project quote breakdown (live + frozen
 * snapshot), status transition with snapshot capture.
 *
 * Depends on bom (resolveBom) + validate (isProjectClosed) + shared (catalog
 * finders, edge flag math).
 */

import { ResolutionError, ValidationError } from '../errors';
import { effectiveOptionChoices } from '../optionChoices';
import {
  captureProjectItemStructurePins,
} from '../structures/versioning';
import type {
  Catalog,
  Project,
  ProjectStatus,
  QuoteBreakdown,
  QuotePriceSnapshot,
  ResolvedBoardPart,
  ResolvedHardwareLine,
} from '../types';
import { resolveBom } from './bom';
import {
  edgeFlags,
  findEdgeBand,
  findHardware,
  findMaterial,
  findModule,
  hasAnyEdgeEnabled,
} from './shared';
import { isProjectClosed } from './validate';

export interface BoardLineCost {
  readonly areaM2: number;
  readonly edgeMl: number;
  readonly boardCost: number;
  readonly edgeCost: number;
  readonly hardwareCost: 0;
}

export interface HardwareLineCost {
  readonly areaM2: 0;
  readonly edgeMl: 0;
  readonly boardCost: 0;
  readonly edgeCost: 0;
  readonly hardwareCost: number;
}

export type LineCost = BoardLineCost | HardwareLineCost;

export function calcMaterialCostPerM2(
  widthMm: number,
  lengthMm: number,
  boardPrice: number,
  wastePercent: number,
): number {
  if (widthMm <= 0 || lengthMm <= 0) return 0;
  const areaM2 = (widthMm * lengthMm) / 1_000_000;
  const baseCost = boardPrice / areaM2;
  return baseCost * (1 + wastePercent / 100);
}

export function calcBoardLineMetrics(
  part: Pick<
    ResolvedBoardPart,
    'quantity' | 'lengthMm' | 'widthMm' | 'edges'
  >,
): { areaM2: number; edgeMl: number } {
  const qty = part.quantity;
  const { L1, L2, W1, W2 } = edgeFlags(part.edges);
  const areaM2 = (qty * part.lengthMm * part.widthMm) / 1_000_000;
  const edgeMl =
    (qty * ((L1 + L2) * part.lengthMm + (W1 + W2) * part.widthMm)) / 1000;
  return { areaM2, edgeMl };
}

export function calcBoardLineCost(
  part: ResolvedBoardPart,
  catalog: Catalog,
  quantityMultiplier = 1,
): BoardLineCost {
  if (!(part.lengthMm > 0) || !(part.widthMm > 0)) {
    throw new ValidationError(
      `Board part dimensions must be > 0 (lengthMm=${part.lengthMm}, widthMm=${part.widthMm})`,
      {
        partId: part.id,
        field: 'lengthMm/widthMm',
      },
    );
  }

  const material = findMaterial(catalog, part.materialId);
  if (!material) {
    throw new ResolutionError(
      `Material not found: ${part.materialId}`,
      { partId: part.id, materialId: part.materialId, field: 'materialId' },
    );
  }
  if (!material.active) {
    throw new ValidationError(
      `Inactive material cannot be used: ${material.code}`,
      { partId: part.id, materialId: material.id, field: 'active' },
    );
  }

  const scaled: ResolvedBoardPart = {
    ...part,
    quantity: part.quantity * quantityMultiplier,
  };
  const { areaM2, edgeMl } = calcBoardLineMetrics(scaled);
  const boardCost = areaM2 * material.costPerM2;

  let edgeCost = 0;
  if (hasAnyEdgeEnabled(part.edges)) {
    if (!part.edgeBandId) {
      throw new ResolutionError(
        `Missing edgeBandId for part with edges enabled: ${part.code ?? part.id}`,
        { partId: part.id, field: 'edgeBandId' },
      );
    }
    const edgeBand = findEdgeBand(catalog, part.edgeBandId);
    if (!edgeBand) {
      throw new ResolutionError(
        `Edge band not found: ${part.edgeBandId}`,
        { partId: part.id, edgeBandId: part.edgeBandId, field: 'edgeBandId' },
      );
    }
    if (!edgeBand.active) {
      throw new ValidationError(
        `Inactive edge band cannot be used: ${edgeBand.code}`,
        { partId: part.id, edgeBandId: edgeBand.id, field: 'active' },
      );
    }
    edgeCost = edgeMl * edgeBand.costPerMl;
  }

  return {
    areaM2,
    edgeMl,
    boardCost,
    edgeCost,
    hardwareCost: 0,
  };
}

export function calcHardwareLineCost(
  line: ResolvedHardwareLine,
  catalog: Catalog,
  quantityMultiplier = 1,
): HardwareLineCost {
  if (!(line.quantity > 0)) {
    throw new ValidationError(
      `Hardware line quantity must be > 0 (got ${line.quantity})`,
      { hardwareLineId: line.id, field: 'quantity' },
    );
  }

  const hardware = findHardware(catalog, line.hardwareId);
  if (!hardware) {
    throw new ResolutionError(`Hardware not found: ${line.hardwareId}`, {
      hardwareLineId: line.id,
      hardwareId: line.hardwareId,
      field: 'hardwareId',
    });
  }
  if (!hardware.active) {
    throw new ValidationError(
      `Inactive hardware cannot be used: ${hardware.code}`,
      {
        hardwareLineId: line.id,
        hardwareId: hardware.id,
        field: 'active',
      },
    );
  }

  const hardwareCost =
    line.quantity * quantityMultiplier * hardware.costPerUnit;

  return {
    areaM2: 0,
    edgeMl: 0,
    boardCost: 0,
    edgeCost: 0,
    hardwareCost,
  };
}

/** Line cost for a resolved board part or hardware line (PRD §13.2). */
export function calcLineCost(
  line: ResolvedBoardPart | ResolvedHardwareLine,
  catalog: Catalog,
  quantityMultiplier = 1,
): LineCost {
  if ('materialId' in line) {
    return calcBoardLineCost(line, catalog, quantityMultiplier);
  }
  return calcHardwareLineCost(line, catalog, quantityMultiplier);
}

/**
 * Live breakdown from current catalog (PRD §13.3).
 * Multiplies module part quantities by each ProjectItem.quantity.
 * Ignores any priceSnapshot on the project.
 */
function calcLiveProjectBreakdown(
  project: Project,
  catalog: Catalog,
): QuoteBreakdown {
  if (!(project.marginFactor > 0)) {
    throw new ValidationError(
      `marginFactor must be > 0 (got ${project.marginFactor})`,
      { projectId: project.id, field: 'marginFactor' },
    );
  }
  if (project.laborFixedCost < 0) {
    throw new ValidationError(
      `laborFixedCost must be >= 0 (got ${project.laborFixedCost})`,
      { projectId: project.id, field: 'laborFixedCost' },
    );
  }

  let materialsCost = 0;
  let edgeTotal = 0;
  let hardwareTotal = 0;
  let laborModular = 0;

  for (const item of project.items) {
    if (!(item.quantity > 0)) {
      throw new ValidationError(
        `Project item quantity must be > 0 (got ${item.quantity})`,
        {
          projectId: project.id,
          projectItemId: item.id,
          field: 'quantity',
        },
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

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
      item.structureRevisionPin,
    );

    for (const part of bom.boardParts) {
      const line = calcBoardLineCost(part, catalog, item.quantity);
      materialsCost += line.boardCost;
      edgeTotal += line.edgeCost;
    }

    for (const hw of bom.hardwareLines) {
      const line = calcHardwareLineCost(hw, catalog, item.quantity);
      hardwareTotal += line.hardwareCost;
    }

    laborModular += item.quantity * (module.baseLaborCost ?? 0);
  }

  const directCost = materialsCost + edgeTotal + hardwareTotal;
  const salePrice =
    directCost * project.marginFactor +
    laborModular +
    project.laborFixedCost;

  return {
    materialsCost,
    edgeTotal,
    hardwareTotal,
    directCost,
    laborModular,
    laborFixedCost: project.laborFixedCost,
    marginFactor: project.marginFactor,
    salePrice,
  };
}

/**
 * Collect unit prices for materials/edges/hardware used by the project's resolved BOM.
 */
function collectUsedUnitPrices(
  project: Project,
  catalog: Catalog,
): Pick<
  QuotePriceSnapshot,
  'materialCostPerM2' | 'edgeCostPerMl' | 'hardwareCostPerUnit'
> {
  const materialCostPerM2: Record<string, number> = {};
  const edgeCostPerMl: Record<string, number> = {};
  const hardwareCostPerUnit: Record<string, number> = {};

  for (const item of project.items) {
    const module = findModule(catalog, item.moduleId);
    if (!module) continue;

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
      item.structureRevisionPin,
    );

    for (const part of bom.boardParts) {
      const material = findMaterial(catalog, part.materialId);
      if (material) {
        materialCostPerM2[material.id] = material.costPerM2;
      }
      if (part.edgeBandId) {
        const edge = findEdgeBand(catalog, part.edgeBandId);
        if (edge) {
          edgeCostPerMl[edge.id] = edge.costPerMl;
        }
      }
    }

    for (const hw of bom.hardwareLines) {
      const hardware = findHardware(catalog, hw.hardwareId);
      if (hardware) {
        hardwareCostPerUnit[hardware.id] = hardware.costPerUnit;
      }
    }
  }

  return {
    materialCostPerM2,
    edgeCostPerMl,
    hardwareCostPerUnit,
  };
}

/**
 * Capture live breakdown + unit prices used (for close / audit).
 * Always uses live catalog prices — never reads an existing snapshot.
 */
export function captureQuoteSnapshot(
  project: Project,
  catalog: Catalog,
  capturedAt: string = new Date().toISOString(),
): QuotePriceSnapshot {
  const breakdown = calcLiveProjectBreakdown(project, catalog);
  const unitPrices = collectUsedUnitPrices(project, catalog);
  return {
    capturedAt,
    breakdown,
    ...unitPrices,
  };
}

/**
 * Status transition helper (PRD §7.4):
 * - draft → quoted/accepted/produced: attach fresh priceSnapshot + pin current
 *   structure revisions on every item (#108).
 * - closed → draft: remove priceSnapshot (reopen). Structure revision pins are
 *   INTENTIONALLY kept so the reopened quote can still be audited against the
 *   exact revisions it was closed with; they get rewritten on the next close.
 * - closed → closed (quoted ↔ accepted → produced): keep existing snapshot and
 *   existing pins (do not rewrite the audited revisions).
 */
export function transitionProjectStatus(
  project: Project,
  newStatus: ProjectStatus,
  catalog: Catalog,
  capturedAt?: string,
): Project {
  const wasClosed = isProjectClosed(project.status);
  const willClose = isProjectClosed(newStatus);

  if (!wasClosed && willClose) {
    return {
      ...project,
      status: newStatus,
      priceSnapshot: captureQuoteSnapshot(project, catalog, capturedAt),
      // #108 — freeze each item to its module's current structure revision.
      items: captureProjectItemStructurePins(project.items, catalog),
    };
  }

  if (wasClosed && !willClose) {
    // #108 — pins kept on reopen for audit continuity (see JSDoc above).
    const { priceSnapshot: _removed, ...rest } = project;
    return {
      ...rest,
      status: newStatus,
    };
  }

  if (wasClosed && willClose) {
    if (project.priceSnapshot) {
      return { ...project, status: newStatus };
    }
    return {
      ...project,
      status: newStatus,
      priceSnapshot: captureQuoteSnapshot(project, catalog, capturedAt),
      items: captureProjectItemStructurePins(project.items, catalog),
    };
  }

  // draft → draft (or same status)
  if (project.priceSnapshot) {
    const { priceSnapshot: _stale, ...rest } = project;
    return { ...rest, status: newStatus };
  }
  return { ...project, status: newStatus };
}

/**
 * Full project quote breakdown (PRD §13.3 + §7.4).
 * Closed projects with a snapshot return the frozen breakdown.
 * Draft always recalculates from the current catalog.
 */
export function calcProjectBreakdown(
  project: Project,
  catalog: Catalog,
): QuoteBreakdown {
  if (isProjectClosed(project.status) && project.priceSnapshot) {
    return project.priceSnapshot.breakdown;
  }
  return calcLiveProjectBreakdown(project, catalog);
}
