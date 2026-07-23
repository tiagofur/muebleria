/**
 * Planning summaries: consolidated m² / edge ML / hardware purchase lists.
 *
 * F047 (#97) project material summary and EXP-08 hardware list. Board metrics
 * reuse the same resolveBom + calcBoardLineCost path as quotes.
 */

import { ResolutionError, ValidationError } from '../errors';
import { effectiveOptionChoices } from '../optionChoices';
import type {
  Catalog,
  EdgeUsageRow,
  Hardware,
  HardwarePurchaseRow,
  MaterialBoard,
  MaterialUsageRow,
  Project,
  ProjectMaterialSummary,
} from '../types';
import { resolveBom } from './bom';
import { calcBoardLineCost } from './pricing';
import {
  findEdgeBand,
  findHardware,
  findMaterial,
  findModule,
} from './shared';

/**
 * Consolidated m² / edge ML / hardware totals for planning (F047 / #97).
 * Board metrics use the same resolveBom + calcBoardLineCost path as quotes.
 * Hardware reuses generateHardwareList (EXP-08).
 */
export function generateProjectMaterialSummary(
  project: Project,
  catalog: Catalog,
): ProjectMaterialSummary {
  const materialMap = new Map<
    string,
    {
      material: MaterialBoard;
      areaM2: number;
      edgeMl: number;
      boardCost: number;
    }
  >();
  const edgeMap = new Map<
    string,
    {
      code: string;
      name: string;
      edgeMl: number;
      edgeCost: number;
    }
  >();

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
      const material = findMaterial(catalog, part.materialId);
      if (!material) {
        throw new ResolutionError(
          `Material not found: ${part.materialId}`,
          {
            projectId: project.id,
            partId: part.id,
            materialId: part.materialId,
            field: 'materialId',
          },
        );
      }

      const prev = materialMap.get(material.id);
      if (prev) {
        prev.areaM2 += line.areaM2;
        prev.edgeMl += line.edgeMl;
        prev.boardCost += line.boardCost;
      } else {
        materialMap.set(material.id, {
          material,
          areaM2: line.areaM2,
          edgeMl: line.edgeMl,
          boardCost: line.boardCost,
        });
      }

      if (part.edgeBandId && line.edgeMl > 0) {
        const edge = findEdgeBand(catalog, part.edgeBandId);
        if (!edge) {
          throw new ResolutionError(
            `Edge band not found: ${part.edgeBandId}`,
            {
              projectId: project.id,
              partId: part.id,
              edgeBandId: part.edgeBandId,
              field: 'edgeBandId',
            },
          );
        }
        const ePrev = edgeMap.get(edge.id);
        if (ePrev) {
          ePrev.edgeMl += line.edgeMl;
          ePrev.edgeCost += line.edgeCost;
        } else {
          edgeMap.set(edge.id, {
            code: edge.code,
            name: edge.name,
            edgeMl: line.edgeMl,
            edgeCost: line.edgeCost,
          });
        }
      }
    }
  }

  const materials: MaterialUsageRow[] = [...materialMap.entries()]
    .map(([materialId, row]) => ({
      materialId,
      code: row.material.code,
      name: row.material.name,
      areaM2: row.areaM2,
      edgeMl: row.edgeMl,
      boardCost: row.boardCost,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const edges: EdgeUsageRow[] = [...edgeMap.entries()]
    .map(([edgeBandId, row]) => ({
      edgeBandId,
      code: row.code,
      name: row.name,
      edgeMl: row.edgeMl,
      edgeCost: row.edgeCost,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  let hardware: HardwarePurchaseRow[] = [];
  try {
    hardware = generateHardwareList(project, catalog);
  } catch (err) {
    // No hardware lines is ok for a board-only project
    if (
      err instanceof ValidationError &&
      typeof err.message === 'string' &&
      err.message.includes('no hay herrajes')
    ) {
      hardware = [];
    } else {
      throw err;
    }
  }

  const totalAreaM2 = materials.reduce((s, m) => s + m.areaM2, 0);
  const totalEdgeMl = edges.reduce((s, e) => s + e.edgeMl, 0);
  const totalBoardCost = materials.reduce((s, m) => s + m.boardCost, 0);
  const totalEdgeCost = edges.reduce((s, e) => s + e.edgeCost, 0);
  const totalHardwareCost = hardware.reduce((s, h) => s + h.lineCost, 0);

  return {
    materials,
    edges,
    hardware,
    totalAreaM2,
    totalEdgeMl,
    totalBoardCost,
    totalEdgeCost,
    totalHardwareCost,
  };
}

/**
 * Aggregate project hardware into a purchase list (PRD EXP-08).
 * Quantity = hardwareLine.quantity × item.quantity, summed by hardwareId.
 * Board parts are never included. Sorted by code, then description.
 */
export function generateHardwareList(
  project: Project,
  catalog: Catalog,
): HardwarePurchaseRow[] {
  const totals = new Map<
    string,
    { quantity: number; hardware: Hardware }
  >();

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

    for (const line of bom.hardwareLines) {
      const hardware = findHardware(catalog, line.hardwareId);
      if (!hardware) {
        throw new ResolutionError(
          `Hardware not found: ${line.hardwareId}`,
          {
            projectId: project.id,
            hardwareLineId: line.id,
            hardwareId: line.hardwareId,
            field: 'hardwareId',
          },
        );
      }
      if (!hardware.active) {
        throw new ValidationError(
          `Inactive hardware cannot be used: ${hardware.code}`,
          {
            projectId: project.id,
            hardwareLineId: line.id,
            hardwareId: hardware.id,
            field: 'active',
          },
        );
      }

      const qty = line.quantity * item.quantity;
      const existing = totals.get(hardware.id);
      if (existing) {
        existing.quantity += qty;
      } else {
        totals.set(hardware.id, { quantity: qty, hardware });
      }
    }
  }

  if (totals.size === 0) {
    throw new ValidationError('no hay herrajes para exportar', {
      projectId: project.id,
      field: 'hardwareLines',
    });
  }

  const rows: HardwarePurchaseRow[] = [...totals.values()].map(
    ({ quantity, hardware }) => ({
      hardwareId: hardware.id,
      code: hardware.code,
      description: hardware.name,
      unit: hardware.unit,
      quantity,
      costPerUnit: hardware.costPerUnit,
      lineCost: quantity * hardware.costPerUnit,
    }),
  );

  rows.sort((a, b) => {
    const byCode = a.code.localeCompare(b.code);
    if (byCode !== 0) return byCode;
    return a.description.localeCompare(b.description);
  });

  return rows;
}
