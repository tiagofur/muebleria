/**
 * #739 — frozen release cutting demand → optimizer cut rows.
 *
 * The server owns the projection of the private manufacturing snapshot
 * (getProjectProductionReleaseCuttingDemand): WHAT must be manufactured,
 * frozen at release time. This module turns that projection into the
 * ProductionCutRow demand the existing optimizer consumes — without ever
 * rebuilding pieces from the mutable project or resolving a preset.
 *
 * The current catalog participates ONLY as explicit engineering inputs:
 * material display labels + stock formats (sheet sizes) and edge-band
 * definitions (deduction thickness). Missing catalog resources are honest,
 * actionable blockers — never silent 2440×1830 defaults or invented
 * thicknesses.
 */

import { ResolutionError } from './errors';
import { formatOptimizerPartDescription, resolveCleanPieceCode } from './engine/cut';
import type {
  Catalog,
  ProductionCutRow,
} from './types';

/** Exact release pins the demand (and any plan generated from it) carries. */
export interface ReleaseCuttingDemandBase {
  readonly releaseId: string;
  readonly releaseNumber: number;
  readonly designRevisionId: string;
  readonly designRevisionNumber: number;
  readonly manufacturingFingerprint: string;
}

/**
 * Structural view of the generated ReleaseCuttingDemand contract. The
 * generated client type satisfies this shape; domain stays free of storage
 * dependencies.
 */
export interface ReleaseCuttingDemandView extends ReleaseCuttingDemandBase {
  readonly schemaVersion: number;
  readonly units: readonly ReleaseCuttingDemandUnitView[];
}

export interface ReleaseCuttingDemandUnitView {
  readonly furnitureInstanceId: string;
  readonly furnitureDefinitionId: string;
  readonly pieces: readonly ReleaseCuttingDemandPieceView[];
}

export interface ReleaseCuttingDemandPieceView {
  readonly partId: string;
  readonly partCode?: string | null;
  readonly description: string;
  readonly quantity: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly materialId: string;
  readonly edgeBandId?: string | null;
  readonly grain: 0 | 1;
  readonly l1: 0 | 1;
  readonly l2: 0 | 1;
  readonly w1: 0 | 1;
  readonly w2: 0 | 1;
  readonly optionRole?: string | null;
}

/**
 * Map the frozen cutting demand to optimizer rows. Every distinct frozen
 * material/edge identity must still exist in the current catalog (explicit
 * engineering input); a missing resource fails closed with the exact ids so
 * the workshop can restore it — no default sheet format, no zero deduction.
 */
export function releaseCutRowsFromDemand(
  demand: ReleaseCuttingDemandView,
  catalog: Catalog | null,
): readonly ProductionCutRow[] {
  const materialsById = new Map((catalog?.materials ?? []).map((m) => [m.id, m]));
  const edgesById = new Map((catalog?.edges ?? []).map((e) => [e.id, e]));
  const modulesById = new Map((catalog?.modules ?? []).map((m) => [m.id, m]));

  const missingMaterials = new Set<string>();
  const missingEdges = new Set<string>();
  for (const unit of demand.units) {
    for (const piece of unit.pieces) {
      if (!materialsById.has(piece.materialId)) {
        missingMaterials.add(piece.materialId);
      }
      if (piece.edgeBandId && !edgesById.has(piece.edgeBandId)) {
        missingEdges.add(piece.edgeBandId);
      }
    }
  }
  if (missingMaterials.size > 0) {
    throw new ResolutionError(
      `El catálogo vigente ya no tiene los materiales de la liberación (${[...missingMaterials].join(', ')}). Restaurá el material o su formato de tablero antes de preparar el corte.`,
      { releaseId: demand.releaseId, field: 'materialId' },
    );
  }
  if (missingEdges.size > 0) {
    throw new ResolutionError(
      `El catálogo vigente ya no tiene los cantos de la liberación (${[...missingEdges].join(', ')}). Restaurá el canto antes de preparar el corte; no se descuenta un grosor desconocido.`,
      { releaseId: demand.releaseId, field: 'edgeBandId' },
    );
  }

  const rows: ProductionCutRow[] = [];
  // Deterministic order: unit identity, then the server's piece order.
  const units = [...demand.units].sort((a, b) =>
    a.furnitureInstanceId.localeCompare(b.furnitureInstanceId),
  );
  // #781 — manufacturing code authority. Rows carry the SAME clean
  // partCode/labelRef style the BOM flow (engine/cut.ts) already emits, so
  // the app, labels and PTX PARTS_REQ.CODE share one workshop code instead
  // of the internal partId leaking into fabrication outputs. Duplicate
  // module codes get the -L<n>- line suffix; partIdx is 1-based per unit
  // line (mirrors generateCutRowsWithLinks). pieceRef identity is NOT
  // touched: it stays partId-based wherever identity is the concept.
  const moduleCounts = new Map<string, number>();
  for (const unit of units) {
    const moduleCode = modulesById.get(unit.furnitureDefinitionId)?.code ?? unit.furnitureDefinitionId;
    const seenMod = (moduleCounts.get(moduleCode) ?? 0) + 1;
    moduleCounts.set(moduleCode, seenMod);
    const lineSuffix = seenMod === 1 ? undefined : `L${seenMod}`;
    let partIdx = 0;
    for (const piece of unit.pieces) {
      partIdx++;
      const material = materialsById.get(piece.materialId)!;
      const edge = piece.edgeBandId ? edgesById.get(piece.edgeBandId) : undefined;
      const { partCode: cleanPartCode, labelRef } = resolveCleanPieceCode(
        moduleCode,
        piece.partCode ?? undefined,
        partIdx,
        lineSuffix,
      );
      rows.push({
        quantity: piece.quantity,
        lengthMm: piece.lengthMm,
        widthMm: piece.widthMm,
        // Finished dimensions are frozen; edge-band deduction stays an
        // optimization input (deductEdgeBand), never pre-applied here.
        description: formatOptimizerPartDescription(
          moduleCode,
          piece.description,
          piece.partCode ?? undefined,
        ),
        materialName: material.name,
        materialCode: material.code,
        grain: piece.grain,
        L1: piece.l1,
        L2: piece.l2,
        W1: piece.w1,
        W2: piece.w2,
        partName: piece.description,
        partCode: cleanPartCode,
        moduleCode,
        labelRef,
        thicknessMm: piece.thicknessMm,
        edgeBandCode: edge?.code,
        edgeBandName: edge?.name,
        edgeBandThicknessMm: edge?.thicknessMm,
      });
    }
  }
  return rows;
}

/** Plan pin derived from the exact demand the plan was generated against. */
export function releaseBaseFromDemand(
  demand: ReleaseCuttingDemandView,
): ReleaseCuttingDemandBase {
  return {
    releaseId: demand.releaseId,
    releaseNumber: demand.releaseNumber,
    designRevisionId: demand.designRevisionId,
    designRevisionNumber: demand.designRevisionNumber,
    manufacturingFingerprint: demand.manufacturingFingerprint,
  };
}

/** A saved plan applies to a context only when EVERY pin matches exactly. */
export function planMatchesReleaseBase(
  plan: import('./optimizer/types').CutPlan,
  base: ReleaseCuttingDemandBase | null | undefined,
): boolean {
  if (!base) return false;
  const planBase = plan.releaseBase;
  if (!planBase) return false;
  return (
    planBase.releaseId === base.releaseId &&
    planBase.releaseNumber === base.releaseNumber &&
    planBase.designRevisionId === base.designRevisionId &&
    planBase.designRevisionNumber === base.designRevisionNumber &&
    planBase.manufacturingFingerprint === base.manufacturingFingerprint
  );
}
