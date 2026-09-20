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
import {
  canonicalWorkshopOccurrences,
  formatOptimizerPartDescription,
  resolveCleanPieceCode,
} from './engine/cut';
import type {
  Catalog,
  ExternalDims,
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
  /**
   * #781 — frozen manufacturing occurrence ordinal (1-based): the position of
   * this unit in the release's frozen unit order. The SERVER always carries
   * it (the liberation order); it is the shared authority behind workshop
   * codes, so this flow never orders occurrences by lexical instance id.
   */
  readonly workshopOccurrenceOrdinal: number;
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

/** One frozen demand piece already resolved against the catalog engineering inputs. */
export interface ReleaseDemandRowContext {
  readonly unit: ReleaseCuttingDemandUnitView;
  readonly piece: ReleaseCuttingDemandPieceView;
  readonly moduleCode: string;
  /** Catalog module definition (engineering input): name + external dims when declared. */
  readonly module: { readonly name: string; readonly externalDims?: ExternalDims } | undefined;
  /** #781 canonical workshop code of copy 1 (`MOD-XXX[-Ln]-Pnn`). */
  readonly cleanPartCode: string;
  /** Stable label key (workshop code authority shared with the optimizer rows). */
  readonly labelRef: string;
}

/**
 * Shared frozen iteration behind the optimizer rows AND the #793 neutral
 * manufacturing label projection: units in FROZEN workshop occurrence order,
 * pieces in canonical partId order, module/line suffixes and clean labelRefs
 * assigned by the same #781 rule. Both consumers must derive their identities
 * from this single walk or their codes could diverge.
 */
export function* iterateReleaseDemandPieces(
  demand: ReleaseCuttingDemandView,
  modulesById: ReadonlyMap<string, Catalog['modules'][number]>,
): Generator<ReleaseDemandRowContext> {
  const units = canonicalWorkshopOccurrences(
    demand.units.map((unit) => ({ ...unit, id: unit.furnitureInstanceId })),
  );
  const moduleCounts = new Map<string, number>();
  for (const unit of units) {
    const module = modulesById.get(unit.furnitureDefinitionId);
    const moduleCode = module?.code ?? unit.furnitureDefinitionId;
    const seenMod = (moduleCounts.get(moduleCode) ?? 0) + 1;
    moduleCounts.set(moduleCode, seenMod);
    const lineSuffix = seenMod === 1 ? undefined : `L${seenMod}`;
    let partIdx = 0;
    for (const piece of [...unit.pieces].sort((a, b) => a.partId.localeCompare(b.partId))) {
      partIdx++;
      const { partCode: cleanPartCode, labelRef } = resolveCleanPieceCode(
        moduleCode,
        piece.partCode ?? undefined,
        partIdx,
        lineSuffix,
      );
      yield { unit, piece, moduleCode, module, cleanPartCode, labelRef };
    }
  }
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
  for (const entry of iterateReleaseDemandPieces(demand, modulesById)) {
    const material = materialsById.get(entry.piece.materialId)!;
    const edge = entry.piece.edgeBandId ? edgesById.get(entry.piece.edgeBandId) : undefined;
    rows.push({
      quantity: entry.piece.quantity,
      lengthMm: entry.piece.lengthMm,
      widthMm: entry.piece.widthMm,
      // Finished dimensions are frozen; edge-band deduction stays an
      // optimization input (deductEdgeBand), never pre-applied here.
      description: formatOptimizerPartDescription(
        entry.moduleCode,
        entry.piece.description,
        entry.piece.partCode ?? undefined,
      ),
      materialName: material.name,
      materialCode: material.code,
      grain: entry.piece.grain,
      L1: entry.piece.l1,
      L2: entry.piece.l2,
      W1: entry.piece.w1,
      W2: entry.piece.w2,
      partName: entry.piece.description,
      partCode: entry.cleanPartCode,
      moduleCode: entry.moduleCode,
      labelRef: entry.labelRef,
      thicknessMm: entry.piece.thicknessMm,
      edgeBandCode: edge?.code,
      edgeBandName: edge?.name,
      edgeBandThicknessMm: edge?.thicknessMm,
    });
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
