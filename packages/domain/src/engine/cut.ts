/**
 * Production cut plan + printable piece labels + edge-banding instructions.
 *
 * F046 (#96) piece labels, F048 (#98) optimizer part description, EXP-05 board
 * parts only, EXP-04 sorting, VAL-05 empty-cut-list gate.
 */

import { ResolutionError, ValidationError } from '../errors';
import type { ProjectItem } from '../types';
import { effectiveOptionChoices } from '../optionChoices';
import { baseContextForItem } from '../plinth';
import type {
  BomProjectContext,
  Catalog,
  EdgeAssignment,
  PieceLabel,
  ProductionCutRow,
  Project,
} from '../types';
import { resolveBom } from './bom';
import {
  edgeFlags,
  findEdgeBand,
  findMaterial,
  findModule,
} from './shared';

function edgeBinaryFlags(
  edges: readonly EdgeAssignment[],
): Pick<ProductionCutRow, 'L1' | 'L2' | 'W1' | 'W2'> {
  const flags = edgeFlags(edges);
  const bit = (n: number): 0 | 1 => (n ? 1 : 0);
  return {
    L1: bit(flags.L1),
    L2: bit(flags.L2),
    W1: bit(flags.W1),
    W2: bit(flags.W2),
  };
}

interface SortableCutRow {
  readonly moduleCode: string;
  readonly partCode: string;
  readonly partId: string;
  readonly description: string;
  readonly part: import('../types').ResolvedBoardPart;
  readonly row: ProductionCutRow;
}

/**
 * Optimizer column D text with stable codes (F048 / #98).
 * `{partCode} · {partName} · {moduleCode}` or `{partName} · {moduleCode}`.
 */
export function formatOptimizerPartDescription(
  moduleCode: string,
  partName: string,
  partCode?: string,
): string {
  const name = partName.trim();
  const mod = moduleCode.trim();
  const code = partCode?.trim();
  if (code) {
    return `${code} · ${name} · ${mod}`;
  }
  return `${name} · ${mod}`;
}

/** Check if a code is a raw internal ID / UUID or contains copy artifacts */
function isInternalUuidOrCopy(code?: string): boolean {
  if (!code || !code.trim()) return true;
  const c = code.trim();
  if (c.includes('-copy-') || c.includes('/copy-') || c.includes('_copy_')) return true;
  // standard UUID or long 32+ hex pattern
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}/.test(c)) return true;
  if (/^[0-9a-fA-F]{24,}$/.test(c)) return true;
  return false;
}

/**
 * Format a human-readable, clean and unique piece code.
 * Ex: MOD-CAJ-01-P01, MOD-CAJ-01-LAT-DER, or MOD-CAJ-01-L2-P01 for duplicate lines.
 */
export function resolveCleanPieceCode(
  moduleCode: string,
  partCode: string | undefined,
  partIndexOneBased: number,
  moduleLineSuffix?: string,
): { partCode: string; labelRef: string } {
  const mod = moduleCode.trim() || 'MOD';
  const linePart = moduleLineSuffix?.trim() ? `-${moduleLineSuffix.trim()}` : '';
  const seqCode = `P${String(partIndexOneBased).padStart(2, '0')}`;

  let finalPartCode: string;
  if (partCode && !isInternalUuidOrCopy(partCode)) {
    finalPartCode = partCode.trim();
  } else {
    finalPartCode = seqCode;
  }

  const labelRef = `${mod}${linePart}-${finalPartCode}`;
  return { partCode: finalPartCode, labelRef };
}

/**
 * Expand project board parts into Optimizer cut-list rows (PRD §14).
 * Board parts only (EXP-05). Quantity = part.quantity × item.quantity (EXP-02).
 * Sorted by module code, then part code (EXP-04). Never includes hardware.
 * Description includes part/module codes for workshop ID (F048) without new columns.
 */
/**
 * One drilling link per cut row line (F130): the resolved part behind the row
 * plus the workshop-unique labelRef that DXF drilling patterns key on.
 * Quantity-collapsed like the row itself (holes are identical across copies).
 */
export interface CutRowPieceLink {
  readonly partId: string;
  readonly labelRef: string;
  readonly partCode: string;
  readonly moduleCode: string;
  readonly part: import('../types').ResolvedBoardPart;
}


/**
 * #781 — canonical workshop-code assignment rule, SHARED by every flow that
 * produces manufacturing codes (BOM rows, piece labels, release demand).
 *
 * Rule: occurrences (muebles) are ordered by the FROZEN manufacturing
 * occurrence ordinal (`workshopOccurrenceOrdinal` — the release lane always
 * carries it, decided when the work was liberated; project items may carry
 * it when the payload froze it) and the parts inside an occurrence by
 * partId, BEFORE the `-L<n>` line suffix and the sequential `Pnn` are
 * assigned. When no entry carries an ordinal, the durable id order is the
 * documented fallback. The same physical occurrence therefore keeps the
 * same code in every flow regardless of array or lexical id order.
 */
export interface WorkshopOccurrenceOrdering {
  readonly id: string;
  /** #781 — frozen manufacturing occurrence ordinal (1-based, shared authority). */
  readonly workshopOccurrenceOrdinal?: number;
}

/**
 * #781 review (validation hardening): PARTIAL ordinals never fall back
 * silently. When ANY entry carries a workshop occurrence ordinal, every
 * entry must carry a valid one (integer >= 1, no duplicates) — a mixed
 * context means an upstream propagation bug and fails closed. The durable-id
 * fallback only applies when NO entry carries an ordinal (live/legacy
 * contexts that were never frozen).
 */
export function canonicalWorkshopOccurrences<T extends WorkshopOccurrenceOrdering>(
  occurrences: readonly T[],
): T[] {
  const frozen = occurrences.filter(
    (entry) => entry.workshopOccurrenceOrdinal !== undefined,
  );
  if (frozen.length === 0) {
    return [...occurrences].sort((a, b) => a.id.localeCompare(b.id));
  }
  if (frozen.length !== occurrences.length) {
    throw new ResolutionError(
      'Contexto de ocurrencias mixto: algunas unidades llevan ordinal de fabricación congelado y otras no — la propagación upstream debe ser completa o nula, nunca parcial',
      { frozen: frozen.length, total: occurrences.length },
    );
  }
  validateFrozenWorkshopOccurrenceOrdinals(occurrences);
  return [...occurrences].sort(
    (a, b) =>
      (a.workshopOccurrenceOrdinal! - b.workshopOccurrenceOrdinal!) || a.id.localeCompare(b.id),
  );
}

/**
 * #781 review — explicit guard for FROZEN contexts: every occurrence must
 * carry an integer ordinal >= 1 and two physical occurrences can never share
 * one (the ordinal IS the manufacturing occurrence authority).
 */
export function validateFrozenWorkshopOccurrenceOrdinals(
  occurrences: readonly WorkshopOccurrenceOrdering[],
): void {
  const seen = new Map<number, string>();
  for (const entry of occurrences) {
    const ordinal = entry.workshopOccurrenceOrdinal;
    if (ordinal === undefined || !Number.isInteger(ordinal) || ordinal < 1) {
      throw new ResolutionError(
        'Ordinal de ocurrencia de fabricación inválido: debe ser entero >= 1',
        { id: entry.id, ordinal },
      );
    }
    const previous = seen.get(ordinal);
    if (previous !== undefined) {
      throw new ResolutionError(
        'Dos ocurrencias físicas comparten el mismo ordinal de fabricación: la autoridad de ocurrencia no puede duplicarse',
        { ordinal, first: previous, second: entry.id },
      );
    }
    seen.set(ordinal, entry.id);
  }
}

/**
 * #781 review — frozen occurrence assignment projected from a
 * ProductionRelease: which physical instance backs each project item, with
 * the release's frozen ordinal (snapshot unit order, index + 1). Server
 * projection joins the release snapshot units with the CURRENT
 * quote-line↔instance links; `coversAllCurrentInstances` lets the caller
 * decide freeze-vs-live without re-deriving coverage.
 */
export interface WorkshopOccurrenceAssignment {
  readonly furnitureInstanceId: string;
  readonly projectItemId: string;
  readonly workshopOccurrenceOrdinal: number;
}

export interface WorkshopOccurrenceProjection {
  readonly releaseId: string;
  readonly releaseNumber: number;
  readonly coversAllCurrentInstances: boolean;
  readonly assignments: readonly WorkshopOccurrenceAssignment[];
}

/**
 * Builds the DERIVED BOM/Engineering context for a released project (#781
 * review §5): items are expanded per physical instance — an item with
 * quantity N and N linked instances becomes N derived items of quantity 1,
 * each keyed by its furniture instance id and carrying the FROZEN workshop
 * occurrence ordinal. The persisted Project is never mutated; callers that
 * only want the live view pass an empty projection and get the items back
 * unchanged. Partial coverage fails closed (never a silent mix).
 */
export function applyFrozenWorkshopOccurrenceOrdinals(
  items: readonly ProjectItem[],
  projection: WorkshopOccurrenceProjection | undefined,
): readonly ProjectItem[] {
  if (!projection || projection.assignments.length === 0) {
    return items;
  }
  validateFrozenWorkshopOccurrenceOrdinals(
    projection.assignments.map((assignment) => ({
      id: assignment.furnitureInstanceId,
      workshopOccurrenceOrdinal: assignment.workshopOccurrenceOrdinal,
    })),
  );
  const byItem = new Map<string, WorkshopOccurrenceAssignment[]>();
  for (const assignment of projection.assignments) {
    const list = byItem.get(assignment.projectItemId) ?? [];
    list.push(assignment);
    byItem.set(assignment.projectItemId, list);
  }
  const derived: ProjectItem[] = [];
  for (const item of items) {
    const assignments = byItem.get(item.id);
    if (!assignments || assignments.length === 0) {
      throw new ResolutionError(
        'La liberación congelada no cubre este ítem del proyecto: el contexto BOM no puede mezclar ítems con y sin ordinal de fabricación',
        { projectItemId: item.id, releaseId: projection.releaseId },
      );
    }
    // The frozen release expanded each item copy into one physical instance:
    // derived items keep every commercial attribute, carry quantity 1 and
    // take their durable identity from the furniture instance.
    derived.push(
      ...assignments.map((assignment) => ({
        ...item,
        id: assignment.furnitureInstanceId,
        quantity: 1,
        workshopOccurrenceOrdinal: assignment.workshopOccurrenceOrdinal,
      })),
    );
  }
  return derived;
}

/** #781 — canonical part order inside one occurrence (see above). */
export function canonicalWorkshopParts<T extends { readonly id: string }>(
  parts: readonly T[],
): T[] {
  return [...parts].sort((a, b) => a.id.localeCompare(b.id));
}

export function generateCutRowsWithLinks(
  project: BomProjectContext,
  catalog: Catalog,
): { rows: ProductionCutRow[]; links: CutRowPieceLink[] } {
  const sortable: SortableCutRow[] = [];
  const moduleCounts = new Map<string, number>();

  // #781 — canonical occurrence order (see canonicalWorkshopOccurrences).
  for (const item of canonicalWorkshopOccurrences(project.items)) {
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

    const seenMod = (moduleCounts.get(module.code) ?? 0) + 1;
    moduleCounts.set(module.code, seenMod);
    const lineSuffix = seenMod === 1 ? undefined : `L${seenMod}`;

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
      item.structureRevisionPin,
      baseContextForItem(project, item, catalog),
      item.customDims,
    );

    let partIdx = 0;
    // #781 — canonical part order: Pnn follows partId, never array order.
    for (const part of canonicalWorkshopParts(bom.boardParts)) {
      partIdx++;
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

      const edgeBits = edgeBinaryFlags(part.edges);
      const { partCode: cleanPartCode, labelRef } = resolveCleanPieceCode(
        module.code,
        part.code,
        partIdx,
        lineSuffix,
      );
      const description = formatOptimizerPartDescription(
        module.code,
        part.description,
        part.code,
      );
      const edgeBand = part.edgeBandId
        ? findEdgeBand(catalog, part.edgeBandId)
        : undefined;
      sortable.push({
        moduleCode: module.code,
        partCode: part.code ?? '',
        partId: part.id,
        description: part.description,
        part,
        row: {
          quantity: part.quantity * item.quantity,
          lengthMm: part.lengthMm,
          widthMm: part.widthMm,
          description,
          materialName: material.name,
          grain: part.grain,
          ...edgeBits,
          partName: part.description,
          partCode: cleanPartCode,
          moduleCode: module.code,
          labelRef,
          materialCode: material.code,
          thicknessMm: part.thicknessMm,
          edgeBandCode: edgeBand?.code,
          edgeBandName: edgeBand?.name,
          edgeBandThicknessMm: edgeBand?.thicknessMm,
        },
      });
    }
  }

  // VAL-05
  if (sortable.length === 0) {
    throw new ValidationError('no hay piezas de tablero para exportar', {
      projectId: project.id,
      field: 'boardParts',
    });
  }

  sortable.sort((a, b) => {
    const byModule = a.moduleCode.localeCompare(b.moduleCode);
    if (byModule !== 0) return byModule;
    const byPartCode = a.partCode.localeCompare(b.partCode);
    if (byPartCode !== 0) return byPartCode;
    const byDescription = a.description.localeCompare(b.description);
    if (byDescription !== 0) return byDescription;
    return a.partId.localeCompare(b.partId);
  });

  return {
    rows: sortable.map((entry) => entry.row),
    links: sortable.map((entry) => ({
      partId: entry.partId,
      labelRef: entry.row.labelRef ?? entry.row.partCode ?? entry.partId,
      partCode: entry.row.partCode ?? '',
      moduleCode: entry.moduleCode,
      part: entry.part,
    })),
  };
}

export function generateCutRows(
  project: BomProjectContext,
  catalog: Catalog,
): ProductionCutRow[] {
  return generateCutRowsWithLinks(project, catalog).rows;
}

const EDGE_SIDE_ORDER = ['L1', 'L2', 'W1', 'W2'] as const;

/**
 * Human-readable edge-banding instruction for workshop labels (F046 / #96).
 * Uses Optimizer side codes L1/L2/W1/W2.
 */
export function formatEdgeBandingInstruction(
  sides: Readonly<{
    L1: boolean;
    L2: boolean;
    W1: boolean;
    W2: boolean;
  }>,
  edge?: Readonly<{
    code: string;
    name: string;
    thicknessMm: number;
  }> | null,
): string {
  const enabled = EDGE_SIDE_ORDER.filter((s) => sides[s]);
  if (enabled.length === 0) {
    return 'Sin encintar';
  }

  let sidesText: string;
  if (enabled.length === 1) {
    sidesText = enabled[0]!;
  } else if (enabled.length === 2) {
    sidesText = `${enabled[0]} y ${enabled[1]}`;
  } else {
    sidesText = `${enabled.slice(0, -1).join(', ')} y ${enabled[enabled.length - 1]}`;
  }

  if (edge) {
    return `Encintar ${sidesText} con ${edge.name} ${edge.thicknessMm} mm (${edge.code})`;
  }
  return `Encintar ${sidesText} (definir canto)`;
}

interface SortablePieceLabel {
  readonly moduleCode: string;
  readonly partCode: string;
  readonly partId: string;
  readonly description: string;
  readonly label: PieceLabel;
}

/**
 * Build printable piece labels from resolved board parts (F046 / #96).
 * Never includes hardware. Quantity = part.quantity × item.quantity.
 * Sorted like cut rows (module code, part code, description).
 */
export function generatePieceLabels(
  project: Project,
  catalog: Catalog,
): PieceLabel[] {
  const sortable: SortablePieceLabel[] = [];
  const moduleCounts = new Map<string, number>();

  // #781 — canonical occurrence order (see canonicalWorkshopOccurrences).
  for (const item of canonicalWorkshopOccurrences(project.items)) {
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

    const seenMod = (moduleCounts.get(module.code) ?? 0) + 1;
    moduleCounts.set(module.code, seenMod);
    const lineSuffix = seenMod === 1 ? undefined : `L${seenMod}`;

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
      item.structureRevisionPin,
      baseContextForItem(project, item, catalog),
      item.customDims,
    );

    let partIdx = 0;
    // #781 — canonical part order: Pnn follows partId, never array order.
    for (const part of canonicalWorkshopParts(bom.boardParts)) {
      partIdx++;
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

      const flags = edgeBinaryFlags(part.edges);
      const sides = {
        L1: flags.L1 === 1,
        L2: flags.L2 === 1,
        W1: flags.W1 === 1,
        W2: flags.W2 === 1,
      };

      let edgeBandCode: string | undefined;
      let edgeBandName: string | undefined;
      let edgeForInstruction: {
        code: string;
        name: string;
        thicknessMm: number;
      } | null = null;

      if (part.edgeBandId) {
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
        edgeBandCode = edge.code;
        edgeBandName = edge.name;
        edgeForInstruction = {
          code: edge.code,
          name: edge.name,
          thicknessMm: edge.thicknessMm,
        };
      }

      const { partCode: cleanPartCode } = resolveCleanPieceCode(
        module.code,
        part.code,
        partIdx,
        lineSuffix,
      );

      sortable.push({
        moduleCode: module.code,
        partCode: cleanPartCode,
        partId: part.id,
        description: part.description,
        label: {
          moduleCode: module.code,
          moduleName: module.name,
          partCode: cleanPartCode,
          description: part.description,
          quantity: part.quantity * item.quantity,
          lengthMm: part.lengthMm,
          widthMm: part.widthMm,
          thicknessMm: part.thicknessMm,
          grain: part.grain,
          materialCode: material.code,
          materialName: material.name,
          edgeBandCode,
          edgeBandName,
          edgeBandThicknessMm: edgeForInstruction?.thicknessMm,
          L1: sides.L1,
          L2: sides.L2,
          W1: sides.W1,
          W2: sides.W2,
          edgeBandingInstruction: formatEdgeBandingInstruction(
            sides,
            edgeForInstruction,
          ),
        },
      });
    }
  }

  if (sortable.length === 0) {
    throw new ValidationError('no hay piezas de tablero para etiquetar', {
      projectId: project.id,
      field: 'boardParts',
    });
  }

  sortable.sort((a, b) => {
    const byModule = a.moduleCode.localeCompare(b.moduleCode);
    if (byModule !== 0) return byModule;
    const byPartCode = a.partCode.localeCompare(b.partCode);
    if (byPartCode !== 0) return byPartCode;
    const byDescription = a.description.localeCompare(b.description);
    if (byDescription !== 0) return byDescription;
    return a.partId.localeCompare(b.partId);
  });

  return sortable.map((entry) => entry.label);
}
