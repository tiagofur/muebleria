/**
 * #793 — neutral frozen per-piece manufacturing label projection.
 *
 * The productive r5 PTX/label route must never rebuild label data from the
 * live project, SketchUp or the furniture catalog, and must never import
 * export-layer (PTX/Excel) types into the domain. This module is the neutral
 * bridge mandated by the #793 plan:
 *
 *     frozen release cutting demand (+ catalog engineering inputs)
 *       -> ManufacturingLabelProjection (this module, domain-neutral)
 *       -> ResolvedCuttingJob.manufacturingLabels
 *       -> export layer maps it to its own label format (PtxPartLabelData)
 *
 * Authorities (each documented in docs/machines/ptx-cadmatic4/09 and 13):
 * - piece identity: the #781 canonical workshop code walk shared with
 *   `releaseCutRowsFromDemand` (single shared iteration — the codes cannot
 *   diverge), expanded per physical copy with the same `-C<n>` suffix the
 *   optimizer's unrollRows applies;
 * - finished measures: copied verbatim from the frozen demand pieces (the
 *   edge-band deduction stays an optimization input, never pre-applied);
 * - unit context: the FROZEN workshop occurrence ordinal + catalog module
 *   definition (name / external dims) as explicit engineering inputs — the
 *   same input class the rows flow already uses for material/edge codes;
 * - room: the frozen cutting demand carries no room/space authority, so the
 *   field stays undefined (empty) — never guessed from the live project;
 * - CNC machining: ONLY an explicit machining authority supplied by the
 *   caller (frozen manufacturing truth keyed by partId) sets
 *   hasCncMachining=true. Absent authority leaves it undefined: no drawing
 *   ref, no barcode, never an inference from names/descriptions/presets;
 * - CNC scope identity: derived exclusively from the frozen release base
 *   (releaseId + designRevisionId + manufacturingFingerprint) so the same
 *   part code in a different release resolves to a different scope (no
 *   cross-release drawing collisions).
 */

import { ResolutionError } from './errors';
import type { Catalog } from './types';
import { iterateReleaseDemandPieces } from './engineeringCuttingDemand';
import type {
  ReleaseCuttingDemandBase,
  ReleaseCuttingDemandUnitView,
  ReleaseCuttingDemandView,
} from './engineeringCuttingDemand';

/**
 * Explicit frozen machining authority (#793 §10): partIds with real CNC
 * machining in the frozen manufacturing truth. The provenance string records
 * WHERE the authority came from (e.g. a release machining projection id); it
 * is metadata for manifests, never a derivation input.
 */
export interface ManufacturingMachiningAuthority {
  readonly provenance: string;
  /** Frozen partId identities that carry explicit CNC machining. */
  readonly machiningPartIds: readonly string[];
}

/** Neutral frozen label data of ONE physical piece (one copy of a demand row). */
export interface ManufacturingPieceLabel {
  /** Workshop manufacturing code of this physical piece (`MOD-XXX[-Ln]-Pnn[-Cn]`). */
  readonly manufacturingPartCode: string;
  /** Human part name from the frozen demand piece. */
  readonly partName: string;
  /** Finished measures (mm), copied verbatim from the frozen demand. */
  readonly finishedLengthMm: number;
  readonly finishedWidthMm: number;
  /** Material code (catalog engineering input of the frozen materialId). */
  readonly materialCode: string;
  /** Granete workshop edge flags (L1/L2 long edges, W1/W2 short edges). */
  readonly L1: 0 | 1;
  readonly L2: 0 | 1;
  readonly W1: 0 | 1;
  readonly W2: 0 | 1;
  /** Assigned edge band code when any side is banded (engineering input). */
  readonly edgeBandCode?: string;
  /** Module (furniture definition) code of the unit this piece belongs to. */
  readonly moduleCode: string;
  /** Module display name (catalog engineering input; undefined stays empty). */
  readonly moduleName?: string;
  /** Module external dims (mm) when the definition declares them. */
  readonly moduleWidthMm?: number;
  readonly moduleHeightMm?: number;
  readonly moduleDepthMm?: number;
  /** FROZEN 1-based workshop occurrence ordinal of the physical unit. */
  readonly workshopOccurrenceOrdinal: number;
  /** Named space/room — no frozen authority exists, stays undefined. */
  readonly room?: string;
  /** ORDER — short work reference derived from the frozen release number. */
  readonly orderRef?: string;
  /**
   * Explicit CNC machining authority. Present and true ONLY when the caller
   * supplied a frozen machining truth covering this partId; absent authority
   * never implies machining and never implies "no machining claim".
   */
  readonly hasCncMachining?: true;
  /** Exact frozen unit/part identity (audit trail, never serialized to bytes). */
  readonly furnitureInstanceId: string;
  readonly partId: string;
}

/** Neutral frozen label projection of one release. */
export interface ManufacturingLabelProjection {
  /** Exact frozen release pins the projection was derived from. */
  readonly releaseBase: ReleaseCuttingDemandBase;
  /** Frozen CNC/release scope identity (see manufacturingCncScope). */
  readonly cncScope: string;
  /** Short work reference (`R<releaseNumber>`) applied to every piece. */
  readonly orderRef: string;
  readonly pieces: readonly ManufacturingPieceLabel[];
}

/**
 * Deterministic frozen CNC scope identity: the exact release pins, nothing
 * else. Two different releases (or the same release after any manufacturing
 * change — new fingerprint) produce different scopes, so identical part codes
 * across releases can never collide in scope-derived drawing references.
 */
export function manufacturingCncScope(base: ReleaseCuttingDemandBase): string {
  return `release:${base.releaseId}:revision:${base.designRevisionId}:fingerprint:${base.manufacturingFingerprint}`;
}

function positiveInteger(value: number | undefined, field: string, context: Record<string, unknown>): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    throw new ResolutionError(
      `La proyección de etiquetas exige ${field} entero >= 1 (autoridad congelada)`,
      { ...context, field, value },
    );
  }
  return value;
}

function finiteMagnitude(value: number | undefined, field: string, context: Record<string, unknown>): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new ResolutionError(
      `La proyección de etiquetas exige ${field} finito > 0 (medida congelada)`,
      { ...context, field, value },
    );
  }
  return value;
}

/**
 * Builds the neutral frozen per-piece manufacturing projection of a release
 * cutting demand. One entry per PHYSICAL piece (quantity rows expand with the
 * optimizer's `-C<n>` copy discipline); codes come from the same canonical
 * walk as `releaseCutRowsFromDemand`.
 *
 * #793 freeze rule: the projection takes its INDUSTRIAL IDENTITY (module
 * code, material code, edge-band code, piece manufacturing codes) EXCLUSIVELY
 * from the SNAPSHOT-frozen fields the server authored at liberation time —
 * this builder never consults the live catalog, so the same frozen release
 * produces the same identity even after the catalog mutates. A release whose
 * snapshot predates the freeze (missing frozen codes) BLOCKS with the exact
 * missing authority — it is never silently completed from live data. Display
 * extras (module name, module dims) stay optional: absent frozen values are
 * simply empty cells, never live substitutions.
 */
export function manufacturingLabelProjectionFromDemand(
  demand: ReleaseCuttingDemandView,
  options?: {
    /** Explicit frozen machining authority; absent = no authority (fields stay empty). */
    readonly machining?: ManufacturingMachiningAuthority;
  },
): ManufacturingLabelProjection {
  const machiningPartIds = new Set(options?.machining?.machiningPartIds ?? []);
  const pieces: ManufacturingPieceLabel[] = [];
  for (const entry of iterateReleaseDemandPieces(demand, EMPTY_MODULES)) {
    const context = {
      releaseId: demand.releaseId,
      furnitureInstanceId: entry.unit.furnitureInstanceId,
      partId: entry.piece.partId,
      labelRef: entry.labelRef,
    };

    // --- Frozen industrial identity gates (#793): same release ⇒ same
    // identity regardless of later catalog mutations; missing freeze ⇒ BLOCK.
    const frozenModuleCode = entry.unit.frozenModuleCode?.trim();
    if (frozenModuleCode === undefined || frozenModuleCode === '') {
      throw new ResolutionError(
        'La proyección de etiquetas r5 exige el código de módulo congelado en el snapshot de la liberación; los snapshots anteriores no definen identidad industrial congelada (re-liberar la obra)',
        { ...context, field: 'frozenModuleCode', furnitureDefinitionId: entry.unit.furnitureDefinitionId },
      );
    }
    const frozenMaterialCode = entry.piece.frozenMaterialCode?.trim();
    if (frozenMaterialCode === undefined || frozenMaterialCode === '') {
      throw new ResolutionError(
        'La proyección de etiquetas r5 exige el código de material congelado en el snapshot de la liberación; los snapshots anteriores no definen identidad industrial congelada (re-liberar la obra)',
        { ...context, field: 'frozenMaterialCode', materialId: entry.piece.materialId },
      );
    }
    const banded = entry.piece.l1 === 1 || entry.piece.l2 === 1 || entry.piece.w1 === 1 || entry.piece.w2 === 1;
    const frozenEdgeBandCode = entry.piece.frozenEdgeBandCode?.trim();
    if (banded && (frozenEdgeBandCode === undefined || frozenEdgeBandCode === '')) {
      throw new ResolutionError(
        'La pieza lleva cantos y el snapshot de la liberación no congeló su código industrial; los snapshots anteriores no definen identidad industrial congelada (re-liberar la obra)',
        { ...context, field: 'frozenEdgeBandCode', edgeBandId: entry.piece.edgeBandId ?? null },
      );
    }

    const quantity = positiveInteger(entry.piece.quantity, 'quantity', context);
    const hasCnc = machiningPartIds.has(entry.piece.partId) ? (true as const) : undefined;
    for (let copy = 1; copy <= quantity; copy++) {
      const manufacturingPartCode = copy > 1 ? `${entry.labelRef}-C${copy}` : entry.labelRef;
      const externalDims = frozenUnitDims(entry.unit);
      pieces.push({
        manufacturingPartCode,
        partName: entry.piece.description,
        finishedLengthMm: finiteMagnitude(entry.piece.lengthMm, 'lengthMm', context),
        finishedWidthMm: finiteMagnitude(entry.piece.widthMm, 'widthMm', context),
        materialCode: frozenMaterialCode,
        L1: entry.piece.l1,
        L2: entry.piece.l2,
        W1: entry.piece.w1,
        W2: entry.piece.w2,
        edgeBandCode: banded ? frozenEdgeBandCode : undefined,
        moduleCode: frozenModuleCode,
        moduleName: entry.unit.frozenModuleName?.trim() || undefined,
        ...(externalDims !== undefined
          ? {
              moduleWidthMm: finiteMagnitude(externalDims.width, 'moduleWidthMm', context),
              moduleHeightMm: finiteMagnitude(externalDims.height, 'moduleHeightMm', context),
              moduleDepthMm: finiteMagnitude(externalDims.depth, 'moduleDepthMm', context),
            }
          : {}),
        workshopOccurrenceOrdinal: positiveInteger(
          entry.unit.workshopOccurrenceOrdinal,
          'workshopOccurrenceOrdinal',
          context,
        ),
        ...(hasCnc !== undefined ? { hasCncMachining: hasCnc } : {}),
        furnitureInstanceId: entry.unit.furnitureInstanceId,
        partId: entry.piece.partId,
      });
    }
  }

  const seen = new Set<string>();
  for (const piece of pieces) {
    if (seen.has(piece.manufacturingPartCode)) {
      throw new ResolutionError(
        'Dos piezas físicas comparten el código de fabricación de la proyección de etiquetas',
        { releaseId: demand.releaseId, manufacturingPartCode: piece.manufacturingPartCode },
      );
    }
    seen.add(piece.manufacturingPartCode);
  }

  return {
    releaseBase: {
      releaseId: demand.releaseId,
      releaseNumber: demand.releaseNumber,
      designRevisionId: demand.designRevisionId,
      designRevisionNumber: demand.designRevisionNumber,
      manufacturingFingerprint: demand.manufacturingFingerprint,
    },
    cncScope: manufacturingCncScope({
      releaseId: demand.releaseId,
      releaseNumber: demand.releaseNumber,
      designRevisionId: demand.designRevisionId,
      designRevisionNumber: demand.designRevisionNumber,
      manufacturingFingerprint: demand.manufacturingFingerprint,
    }),
    orderRef: `R${demand.releaseNumber}`,
    pieces,
  };
}

const EMPTY_MODULES: ReadonlyMap<string, Catalog['modules'][number]> = new Map();

function frozenUnitDims(
  unit: ReleaseCuttingDemandUnitView,
): { width: number; height: number; depth: number } | undefined {
  const { frozenModuleWidthMm: width, frozenModuleHeightMm: height, frozenModuleDepthMm: depth } = unit;
  if (width == null || height == null || depth == null) return undefined;
  return { width, height, depth };
}
