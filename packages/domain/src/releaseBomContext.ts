/**
 * Release BOM context (#577 / OPS-DT-1).
 *
 * The canonical ProductionRelease pins an immutable DesignRevision snapshot;
 * operational derivations (material requirements, part executions) must run
 * over THAT exact snapshot instead of the mutable `project.items` quote state
 * — a late quote edit can never silently change what P1 releases to the
 * floor. This module adapts the revision items onto the input shape the
 * existing TS BOM engine already consumes: no second engine, no persisted
 * copy, no client-side remapping of the canonical release into the legacy
 * blob.
 *
 * Mapping (documented limits, not silent fallbacks):
 * - `furnitureDefinitionId` → `moduleId` (the catalog module of the instance);
 * - each revision item is ONE physical unit → `quantity: 1`;
 * - `materialChoices` (slot → material/hardware id) ride `optionChoices`: the
 *   engine resolves board/hardware/edge roles by exactly these keys;
 * - `parameters.widthMm/heightMm/depthMm` → `customDims` when numeric;
 * - `definitionVersion` is NOT consumed here: catalog modules are unversioned
 *   today (structure pins live on quote `ProjectItem`s, which revision items
 *   don't carry). The release `manufacturingFingerprint` is the exactness
 *   proof at revision granularity; the server stamps it on every derivation.
 */

import { computeProductionTotals } from './productionTotals';
import { estimateBoardSheets } from './boardSheetEstimate';
import { generateCutRows } from './engine/cut';
import { generateHardwareList, generateProjectMaterialSummary } from './engine/labels';
import { ValidationError } from './errors';
import type {
  BomProjectContext,
  Catalog,
  HardwarePurchaseRow,
  MaterialBoard,
  ProjectItem,
} from './types';
import type { StockMaterialKind } from './stock';

export type { BomProjectContext };

/** Domain-level mirror of a DesignRevisionItem (mapped at the API boundary). */
export interface ReleaseBomItem {
  readonly furnitureInstanceId: string;
  readonly furnitureDefinitionId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly materialChoices: Readonly<Record<string, string>>;
}

function finiteNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Adapt the immutable revision items onto the engine's line-item shape: one
 * physical unit per item, its pinned material slots as option choices and its
 * pinned dimensions as the custom-dims override.
 */
export function releaseBomItemsToProjectItems(
  items: readonly ReleaseBomItem[],
): ProjectItem[] {
  return items
    .filter((item) => item.furnitureDefinitionId)
    .map((item) => {
      const widthMm = finiteNumber(item.parameters.widthMm);
      const heightMm = finiteNumber(item.parameters.heightMm);
      const depthMm = finiteNumber(item.parameters.depthMm);
      const customDims =
        widthMm !== undefined && heightMm !== undefined && depthMm !== undefined
          ? { widthMm, heightMm, depthMm }
          : undefined;
      const projectItem: ProjectItem = {
        id: item.furnitureInstanceId,
        moduleId: item.furnitureDefinitionId,
        quantity: 1,
        optionChoices: { ...item.materialChoices },
      };
      return customDims ? { ...projectItem, customDims } : projectItem;
    });
}

/**
 * Build the structural BOM context the engine aggregates consume. The
 * revision items carry their own pinned choices, so no project-level defaults
 * leak into a release derivation.
 */
export function buildReleaseBomContext(
  projectId: string,
  items: readonly ReleaseBomItem[],
): BomProjectContext {
  return {
    id: projectId,
    items: releaseBomItemsToProjectItems(items),
    projectLevelChoices: {},
  };
}

/** One material requirement line of a released BOM (OC-050 derive input). */
export interface ReleaseRequirementLine {
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly quantity: number;
}

/**
 * Requirement lines of a BOM context — herrajes by hardwareId with package
 * purchase quantity, tableros as estimated sheets, cintillas as edge meters
 * resolved through the edge-code → catalog-id map. The ONE line builder
 * shared by the legacy quote path and the canonical release path so both
 * derive identical requirements from identical inputs.
 */
export function requirementLinesFromContext(
  context: BomProjectContext,
  catalog: Catalog,
  catalogMaterials: readonly MaterialBoard[],
  edgeIdByCode: Readonly<Record<string, string>>,
): ReleaseRequirementLine[] {
  const lines: ReleaseRequirementLine[] = [];
  // Board-only modules are legitimate: zero resolved hardware is not an
  // error for planning (same tolerance the material summary applies).
  let hardwareRows: readonly HardwarePurchaseRow[] = [];
  try {
    hardwareRows = generateHardwareList(context, catalog);
  } catch (err) {
    if (!(err instanceof ValidationError && err.message.includes('no hay herrajes'))) {
      throw err;
    }
  }
  for (const hardware of hardwareRows) {
    if (hardware.hardwareId) {
      lines.push({
        kind: 'herrajes',
        materialId: hardware.hardwareId,
        quantity: hardware.purchaseQuantity,
      });
    }
  }
  const summary = generateProjectMaterialSummary(context, catalog);
  for (const sheet of estimateBoardSheets(summary.materials, catalogMaterials)) {
    if (sheet.estimatedSheets > 0) {
      lines.push({ kind: 'tableros', materialId: sheet.materialId, quantity: sheet.estimatedSheets });
    }
  }
  const totals = computeProductionTotals(generateCutRows(context, catalog));
  for (const edge of totals.edges) {
    const id = edgeIdByCode[edge.edgeBandCode ?? edge.key];
    if (id && edge.ml > 0) {
      lines.push({ kind: 'cintillas', materialId: id, quantity: edge.ml });
    }
  }
  return lines;
}
