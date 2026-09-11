/**
 * CutProgram → PtxDocument compiler (#650 PR 5).
 *
 * Compiles the REAL guillotine cut program carried by a CutPlan (the same
 * program that feeds the React preview and the cutting instructions since
 * #654/#655) into the documented PTX subset implemented by the #656 core.
 * executeCutProgram is the only geometric authority: nothing is re-optimized,
 * no cut tree is rebuilt from piece coordinates, and every emitted magnitude
 * comes from the executed trace.
 *
 * Dependency direction (02_plan_de_implementacion.md, Entrega B):
 *   @granete/domain CutPlan/CutProgram → this compiler → PtxDocument → ptx core.
 * The domain never imports this package. This module is NOT connected to the
 * productive adapter, the download button or the legacy ptxCutPlanExport
 * serializer, it reads no MachineProfile/CADmatic profile, and it claims no
 * CADmatic 4 compatibility (field validation stays NOT_TESTED/notClaimed).
 *
 * Documented candidate decisions (the contract of the emitted bytes — checked
 * by verifyCutPlanPtxReadback and by tests; none is a receiver-verified claim):
 *
 * - One JOBS row for the whole plan, built only from stable plan fields
 *   (projectId): no clock, no timestamps, and the receiver-unknown optionals
 *   (ORD_DATE, OPT_PARAM, SAW_PARAM, CUT_TIME, WASTE_PCNT) stay EMPTY.
 *   HEADER.TITLE comes verbatim from options.title (caller labels the
 *   candidate, e.g. LAB_FIXTURE NOT_MACHINE_VALIDATED). One BOARDS + one
 *   PATTERNS row per sheet (one board per cycle, no pattern compression —
 *   QTY_RUN/QTY_CYCLES/MAX_BOOK all 1), so two stock formats of the same
 *   material yield 1 MATERIALS row + 2 BOARDS rows. MATERIALS rows per
 *   distinct material code. PARTS_REQ rows per placed piece with QTY_REQ=1:
 *   no type aggregation, so piece identity survives for labels.
 *
 * - CUTS rows: one per program division, emitted in STRUCTURAL PREORDER of
 *   the division tree (kept subtree first, then the rest subtree) with
 *   CUT_INDEX = 1..N in that row order — CUT_INDEX is structure/nesting.
 *   SEQUENCE carries the EXECUTION order (division.order) independently, so
 *   row order and operational order are never conflated: when a program
 *   interleaves subtrees, SEQUENCE is non-monotonic across rows exactly like
 *   the dossier fragment 03 (STRIP_B has SEQUENCE=2 while its CUT_INDEX
 *   comes after strip A's children). Release rows (remnants and rest-side
 *   pieces) follow the division rows with SEQUENCE=0 and QTY_RPT=0: they
 *   attribute production without inventing a new saw pass (fragment 04).
 *   Exact-fit terminals never get a fictitious row: the piece is referenced
 *   by the producing division that actually made it available.
 *
 * - FUNCTION policy. The cut phase of a division is the staging generation of
 *   its parent region: the staging root (the raw board, or the r3 usable
 *   root after the trim projection) is generation 1; a division over a
 *   generation-g region is a phase-g pass; the kept child moves to generation
 *   g+1 while the rest child stays at g (material still on the bench is not
 *   re-staged). This reproduces the dossier exercise: strip separation =
 *   phase 1 (fn 1), in-strip cuts = phase 2 (fn 2, CUT_B/CUT_C), the
 *   separated block reprocessed at phase 3 (fn 3, CUT_D) — including an X
 *   pass at phase 3 (fn 3, never fn 1 "for being on X"). Phases ≤ 2 emit the
 *   axis role (axis y → 1 rip, axis x → 2 cross); phase 3 emits 3. Phase > 3
 *   fails closed: code 4 waits for an explicit phase-4 fixture (#656
 *   records.ts).
 *
 * - Trims/refilados. TWO revision policies, selected by
 *   options.supportsPositiveTrim (the profile declares it as a dimension):
 *   - r2 (false/absent, the historical bytes): any positive trim fails
 *     closed with ptx_compile.trim_unsupported — the 90..99 codes stay
 *     disabled and no unequivocal documented trim→head mapping exists.
 *   - r3 (#661, true — 04_contrato_r3_refilados.md): the perimeter trim
 *     prefix (chain of divisions with trim=true from the raw board to ONE
 *     usable root) is projected to MATERIALS.TRIM_FRIP/VRIP/FXCT/VXCT —
 *     each the TOTAL margin including kerf, mapped by executed
 *     axis + leadingBand on the fixed frame (y+leading→FRIP, y+far→VRIP,
 *     x+leading→FXCT, x+far→VXCT; TRIM_TYPE=1, no initial rotation,
 *     VECTORS off). TRIM_HEAD/TRIM_FRCT/TRIM_VRCT stay ABSENT (G3: no
 *     override is derived from the four margins; absent ≠ 0). The
 *     productive subtree is compiled relative to the usable root with
 *     staging reset (usable root = phase 1), so CUTS.DIMENSION stays
 *     relative (G1) and no trim pass is emitted as a CUTS row (G4). Every
 *     non-conforming shape fails closed with a specific trim_* code.
 *
 * - PATTERNS.TYPE: 0 (longitudinal rip staging) when the first productive
 *   division advances along y, 4 (cutting only, no staging claim)
 *   otherwise. Types 1/2/3 (turn/heads) are never claimed — the r3 fixed
 *   frame is expressed through TRIM_TYPE + MATERIALS.TRIM_*, never through
 *   an initial board rotation.
 *
 * - MATERIALS: THICK/BOOK/KERF_RIP/KERF_XCT are mandatory from the real plan
 *   (missing thickness fails closed; no hardcoded 4/18 mm); both kerf fields
 *   stay separate fields fed from Granete's single saw configuration, and
 *   every division kerf must equal config.sawKerfMm or compilation fails.
 *   The dossier only establishes that BOOK counts boards, not millimetres
 *   [S03 pp.134–135] — "total boards of the material in the job" is NOT
 *   documented, so the candidate emits the conservative one-board-per-cycle
 *   value BOOK = 1 (consistent with MAX_BOOK=1/QTY_CYCLES=1 and one BOARDS
 *   row per sheet). RULE1..4 stay EMPTY: their per-class receiver semantics
 *   are a documented §9 ambiguity. TRIM_* are empty under r2 and carry the
 *   r3 projected margins (or stay absent per side without a trim pass).
 *
 * - Quantization: decimalPlaces is explicit and every magnitude must be
 *   exactly representable at that resolution, absorbing IEEE-754 arithmetic
 *   noise only (relative 1e-9, the domain's policy). A value that does not
 *   fit the configured resolution fails closed
 *   (ptx_compile.magnitude_not_representable) — never silently rounded.
 *
 * - Determinism: a pure function of (cutPlan, options) — no clock, no
 *   randomness, no new UUIDs, stable iteration orders; Map insertion order
 *   is only used where the emitted arrays are the authoritative form.
 *
 * - ASCII policy, two explicit groups. CRITICAL IDENTITY (material codes,
 *   any key that groups MATERIALS or resolves mappings, PARTS_REQ.CODE):
 *   must already be printable ASCII — non-ASCII or empty values FAIL CLOSED
 *   with ptx_compile.identity_not_ascii (field, original value, entity) so
 *   two industrial entities can never merge into one filtered
 *   representation ('MDFÁ' and 'MDF' both filtering to 'MDF' is a bug, not
 *   a sanitization). An empty partCode gets the explicit technical code
 *   PART-<n> (piece identity is the placement ref, never the display code).
 *   AUXILIARY TEXT (descriptions, COMMENT, display names): filtered to
 *   printable ASCII deterministically; a required field that comes out
 *   empty fails closed instead of being silently renamed.
 */

import { executeCutProgram, ValidationError } from '@granete/domain';
import type {
  CutPlan,
  CutPlanSheet,
  CutProgramTrace,
  CutProgramTraceDivision,
} from '@granete/domain';
import {
  PTX_GRAIN,
  PTX_PATTERN_TYPE,
  PTX_UNITS,
  type PtxDocument,
  type PtxGrain,
  type PtxOffcutRecord,
  type PtxPartReference,
  type PtxPatternType,
  type PtxRecord,
  type PtxTrimType,
  type PtxVectorRecord,
} from './records';
import { PtxDocumentInvalidError, validatePtxDocument } from './validate';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface CompileCutPlanToPtxOptions {
  /** HEADER.VERSION — documented PTX file version (examples use 1). Never derived from the controller name. */
  readonly headerVersion: number;
  /** HEADER.ORIGIN — carried verbatim; affects VECTORS semantics (S03 territory). */
  readonly headerOrigin: number;
  /** HEADER.TRIM_TYPE — 0 waste first, 1 fixed trim first. */
  readonly trimType: PtxTrimType;
  /** HEADER.TITLE — caller-supplied candidate label (e.g. LAB_FIXTURE NOT_MACHINE_VALIDATED). Printable ASCII, non-empty. */
  readonly title: string;
  /** Fixed decimal resolution every magnitude must be exactly representable at; pass the same value when serializing. */
  readonly decimalPlaces: number;
  /** Emit one VECTORS row per division (absolute cut lines, top-left origin). Default false. */
  readonly includeVectors?: boolean;
  /**
   * r3 candidate policy (#661, 04_contrato_r3_refilados.md). When true the
   * compiler enables the evidenced subset: perimeter trims are projected to
   * MATERIALS.TRIM_* (fixed frame, TRIM_TYPE=1, no initial rotation), the
   * productive subtree is compiled from the usable root (generation 1), the
   * event scheduler assigns SEQUENCE, and eligible rest-side phase-2
   * remnants become physical FUNCTION 92 + Xn passes. When false/absent the
   * historical r2 behavior applies unchanged: any positive trim fails closed
   * with ptx_compile.trim_unsupported and releases stay QTY_RPT=0 rows.
   */
  readonly supportsPositiveTrim?: boolean;
}

/** Per-sheet slice of the inverse table linking durable identities to local PTX indexes. */
export interface PtxCompiledSheetMapping {
  readonly sheetIndex: number;
  readonly boardIndex: number;
  readonly patternIndex: number;
  readonly patternType: PtxPatternType;
  /** cutId → CUT_INDEX of the division row. */
  readonly cutIndexByCutId: ReadonlyMap<string, number>;
  /** CUT_INDEX → cutId (position i holds cutIndex i+1) — structural preorder order. */
  readonly cutIdByCutIndex: readonly string[];
  /** released leaf regionId → CUT_INDEX of its release row. */
  readonly releaseCutIndexByRegionId: ReadonlyMap<string, number>;
  /** remnant regionId → OFFCUTS index referenced as Xn. */
  readonly offcutIndexByRegionId: ReadonlyMap<string, number>;
}

/** Inverse table: durable plan identities ↔ local PTX indexes (02 plan, "tabla inversa"). */
export interface PtxCompilationMapping {
  readonly jobIndex: number;
  /** sanitized material code → MAT_INDEX */
  readonly materialIndexByCode: ReadonlyMap<string, number>;
  /** placed piece id → PARTS_REQ PART_INDEX */
  readonly partIndexByPieceRef: ReadonlyMap<string, number>;
  /** PART_INDEX → placed piece id (position i holds partIndex i+1). */
  readonly pieceRefByPartIndex: readonly string[];
  /** OFFCUT_INDEX → remnant regionId (job-wide; position i holds offcutIndex i+1). */
  readonly offcutRegionIdByOffcutIndex: readonly string[];
  /** PTN_INDEX → sheetIndex (position i holds patternIndex i+1). */
  readonly sheetIndexByPatternIndex: readonly number[];
  readonly sheets: readonly PtxCompiledSheetMapping[];
}

export interface CompiledPtxCandidate {
  readonly document: PtxDocument;
  readonly mapping: PtxCompilationMapping;
}

export type PtxCompilationErrorCode =
  | 'ptx_compile.options_invalid'
  | 'ptx_compile.no_sheets'
  | 'ptx_compile.missing_cut_program'
  | 'ptx_compile.nesting_not_representable'
  | 'ptx_compile.program_invalid'
  | 'ptx_compile.phase_unsupported'
  | 'ptx_compile.trim_unsupported'
  | 'ptx_compile.trim_frame_unsupported'
  | 'ptx_compile.trim_structure_invalid'
  | 'ptx_compile.trim_mapping_ambiguous'
  | 'ptx_compile.trim_geometry_mismatch'
  | 'ptx_compile.offcut_release_92_unsupported'
  | 'ptx_compile.offcut_release_duplicate'
  | 'ptx_compile.kerf_not_uniform'
  | 'ptx_compile.magnitude_not_representable'
  | 'ptx_compile.identity_not_ascii'
  | 'ptx_compile.material_thickness_missing'
  | 'ptx_compile.material_conflict'
  | 'ptx_compile.material_without_boards'
  | 'ptx_compile.piece_ref_duplicate'
  | 'ptx_compile.piece_grain_invalid'
  | 'ptx_compile.piece_unattributable'
  | 'ptx_compile.remnant_unattributable'
  | 'ptx_compile.leaf_without_placement'
  | 'ptx_compile.placement_without_leaf';

export class PtxCompilationError extends Error {
  constructor(
    readonly code: PtxCompilationErrorCode,
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(`${message} [${code}]`);
    this.name = 'PtxCompilationError';
  }
}

// ---------------------------------------------------------------------------
// Shared helpers (pure; the readback verifier reuses the documented contract)
// ---------------------------------------------------------------------------

/** Filters to printable ASCII (32..126). AUXILIARY text only — never identity (see requireAsciiIdentity). */
export function ptxAscii(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) out += ch;
  }
  return out;
}

/**
 * CRITICAL IDENTITY gate: a value that groups MATERIALS, resolves mappings or
 * feeds a contractual CODE column must already be printable ASCII. Filtering
 * it would silently merge distinct industrial entities ('MDFÁ' and 'MDF' both
 * becoming 'MDF'), so non-ASCII or empty values fail closed with the field,
 * the original value and the affected entity.
 */
function requireAsciiIdentity(
  value: string,
  field: string,
  entity: Record<string, unknown>,
): string {
  if (value === '' || !isPrintableAscii(value)) {
    throw new PtxCompilationError(
      'ptx_compile.identity_not_ascii',
      `Identidad crítica '${field}' no es ASCII de impresión: rechazada en vez de mutilarse`,
      { ...entity, field, value },
    );
  }
  return value;
}

/**
 * Resolves a magnitude at the configured resolution: returns the exact
 * decimal when the value is representable, absorbing IEEE-754 arithmetic
 * noise only (relative 1e-9, the domain's policy). A value that genuinely
 * does not fit the resolution fails closed — the compiler never rounds a
 * measure into representability.
 */
export function ptxResolveMagnitude(
  value: number,
  decimalPlaces: number,
  field: string,
): number {
  if (!Number.isFinite(value)) {
    throw new PtxCompilationError(
      'ptx_compile.magnitude_not_representable',
      `${field} no es finito`,
      { field, value },
    );
  }
  const factor = 10 ** decimalPlaces;
  const snapped = Math.round(value * factor) / factor;
  if (Math.abs(snapped - value) > 1e-9 * Math.max(1, Math.abs(value))) {
    throw new PtxCompilationError(
      'ptx_compile.magnitude_not_representable',
      `${field}=${value} no es representable en ${decimalPlaces} decimal(es); cuantiza el plan o sube la resolución`,
      { field, value, decimalPlaces },
    );
  }
  return snapped;
}

/** Cut phase / FUNCTION plan of one executed trace division (documented staging model). */
export interface PtxDivisionPlan {
  readonly division: CutProgramTraceDivision;
  /** Staging phase: 1 for usable-root-level passes, +1 per kept-side nesting level. */
  readonly phase: number;
  /** Emitted CUTS.FUNCTION: phases ≤ 2 by axis role (y→1 rip, x→2 cross), phase 3 → 3. */
  readonly functionCode: number;
  /** Piece isolated on the kept side, referenced by the division's main row. */
  readonly keptPieceRef?: string;
  /** Piece isolated on the rest side (only when the kept side is also a piece). */
  readonly restPieceRef?: string;
}

// ---------------------------------------------------------------------------
// r3 trim projection (#661 — 04_contrato_r3_refilados.md §3/§5)
// ---------------------------------------------------------------------------

/** The four evidenced MATERIALS.TRIM_* slots plus the never-override recut trio. */
export interface PtxMaterialTrims {
  /** Fixed rip trim (near y side) — total margin including kerf. */
  readonly trimFrip?: number;
  /** Minimum/falling-waste rip trim (far y side). */
  readonly trimVrip?: number;
  /** Fixed crosscut trim (near x side). */
  readonly trimFxct?: number;
  /** Minimum/falling-waste crosscut trim (far x side). */
  readonly trimVXct?: number;
  /** G3: never derived from the four margins — absent means no override. */
  readonly trimHead?: number;
  readonly trimFrct?: number;
  readonly trimVrct?: number;
}

/**
 * r3 PTX projection of one executed program (contract §5 "Proyección
 * requerida"): the perimeter trim prefix becomes MATERIALS.TRIM_* and the
 * productive CUTS start at the single usable root. The CutProgram itself is
 * never modified — this is a read-only view over the executed trace.
 */
export interface PtxTrimPlan {
  /** Kept region after the trim prefix (the raw board when no trims exist). */
  readonly usableRootRegionId: string;
  /** Trim margins in millimetres (totals including kerf); absent = no such pass. */
  readonly materialTrims: PtxMaterialTrims;
  /** cutIds of the divisions INSIDE the usable-root subtree (compiled as CUTS). */
  readonly productiveDivisionIds: readonly string[];
}

/**
 * Projects the executed trace into the r3 PTX view. Fail-closed per contract
 * §3.3/§7: the trims must form the structural perimeter prefix
 * (raw board → trim chain → ONE usable root), every discarded band must be
 * liberated waste, the fixed frame admits exactly one margin per side, and
 * all sheets of one material must agree (checked by the caller).
 *
 * The side authority is the executed geometry (axis + leadingBand), never
 * the cutId name: axis y + leadingBand → TRIM_FRIP (near/fixed-first),
 * axis y + far side → TRIM_VRIP, axis x + leadingBand → TRIM_FXCT,
 * axis x + far side → TRIM_VXCT. Each margin is parentExtent − keptExtent
 * from the executed trace — the TOTAL including the kerf (G4: never the
 * solid remainder alone, never the margin plus a second kerf).
 */
export function planSheetTrimProjection(trace: CutProgramTrace): PtxTrimPlan {
  const divisionByParent = new Map<string, CutProgramTraceDivision>();
  for (const division of trace.divisions) {
    divisionByParent.set(division.parentRegionId, division);
  }
  const terminalByRegion = new Map(trace.terminals.map((terminal) => [terminal.regionId, terminal]));

  // 1. Walk the trim chain from the raw board: consecutive trim divisions,
  //    each consuming the previous kept region, until a productive division
  //    (or a leaf) is reached — that kept region is the usable root.
  const chain: CutProgramTraceDivision[] = [];
  let current = trace.boardRegionId;
  for (;;) {
    const division = divisionByParent.get(current);
    if (!division || division.trim !== true) break;
    chain.push(division);
    current = division.keptRegionId;
  }
  const usableRootRegionId = current;

  // 2. Every trim division must sit in that chain. A trim deeper in the
  //    productive tree (or inside a discarded band) has no evidenced mapping.
  const chainCutIds = new Set(chain.map((division) => division.cutId));
  for (const division of trace.divisions) {
    if (division.trim === true && !chainCutIds.has(division.cutId)) {
      throw new PtxCompilationError(
        'ptx_compile.trim_structure_invalid',
        'División de trim fuera del prefijo perimetral: la proyección r3 sólo soporta la cadena de refilos desde el tablero crudo hasta una única raíz útil',
        { cutId: division.cutId, parentRegionId: division.parentRegionId },
      );
    }
  }

  // 3. Each discarded band must be liberated waste: the trim strip leaves the
  //    bench with its pass, which is what makes TRIM_* the honest projection.
  for (const division of chain) {
    if (division.restRegionId === undefined) continue;
    const terminal = terminalByRegion.get(division.restRegionId);
    if (!terminal || terminal.kind !== 'waste' || terminal.liberated !== true) {
      throw new PtxCompilationError(
        'ptx_compile.trim_structure_invalid',
        'La banda descartada por un refilo no es desperdicio liberado: no se proyecta a MATERIALS.TRIM_* material que permanece en la mesa',
        { cutId: division.cutId, restRegionId: division.restRegionId },
      );
    }
  }

  // 4. Defensive closure: everything outside the usable-root subtree must be
  //    exactly the chain bands (already validated above). The executed tree
  //    makes other shapes impossible; the check keeps the projection honest
  //    against future structural changes.
  const subtree = new Set<string>([usableRootRegionId]);
  const productiveDivisions = trace.divisions.filter((division) => division.trim !== true);
  for (const division of trace.divisions) {
    if (chainCutIds.has(division.cutId)) continue;
    if (subtree.has(division.parentRegionId)) {
      subtree.add(division.keptRegionId);
      if (division.restRegionId) subtree.add(division.restRegionId);
    }
  }
  for (const division of trace.divisions) {
    if (chainCutIds.has(division.cutId)) continue;
    if (!subtree.has(division.parentRegionId)) {
      throw new PtxCompilationError(
        'ptx_compile.trim_structure_invalid',
        'División productiva fuera de la raíz útil proyectada',
        { cutId: division.cutId, parentRegionId: division.parentRegionId },
      );
    }
  }

  // 5. Map each chain trim to its fixed-frame slot. Two trims competing for
  //    one side cannot be expressed as the single fixed margin PTX declares:
  //    that needs a frame transform (e.g. PATTERNS.TYPE=1) r3 does not
  //    implement → trim_frame_unsupported.
  const slotOrder: { readonly key: 'frip' | 'vrip' | 'fxct' | 'vxct'; readonly divisions: { readonly cutId: string; readonly marginMm: number }[] }[] = [
    { key: 'frip', divisions: [] },
    { key: 'vrip', divisions: [] },
    { key: 'fxct', divisions: [] },
    { key: 'vxct', divisions: [] },
  ];
  const slotOf = (division: CutProgramTraceDivision): 'frip' | 'vrip' | 'fxct' | 'vxct' =>
    division.axis === 'y'
      ? division.leadingBand
        ? 'frip'
        : 'vrip'
      : division.leadingBand
        ? 'fxct'
        : 'vxct';
  for (const division of chain) {
    const parentExtentMm =
      division.axis === 'x' ? division.parentRect.lengthMm : division.parentRect.widthMm;
    const marginMm = parentExtentMm - division.keptExtentMm;
    if (!Number.isFinite(marginMm) || marginMm <= 0) {
      throw new PtxCompilationError(
        'ptx_compile.trim_geometry_mismatch',
        'Margen de refilo no representable desde la geometría ejecutada (parentExtent − keptExtent)',
        { cutId: division.cutId, parentExtentMm, keptExtentMm: division.keptExtentMm },
      );
    }
    slotOrder.find((slot) => slot.key === slotOf(division))!.divisions.push({
      cutId: division.cutId,
      marginMm,
    });
  }
  for (const slot of slotOrder) {
    if (slot.divisions.length > 1) {
      throw new PtxCompilationError(
        'ptx_compile.trim_frame_unsupported',
        'Dos o más refilos del mismo lado del frame fijo: expresarlos exigiría una transformación de frame (PATTERNS.TYPE=1) no implementada en r3',
        {
          slot: slot.key,
          cutIds: slot.divisions.map((entry) => entry.cutId),
          marginsMm: slot.divisions.map((entry) => entry.marginMm),
        },
      );
    }
  }

  const marginBySlot = new Map(slotOrder.map((slot) => [slot.key, slot.divisions[0]?.marginMm]));
  const materialTrims: PtxMaterialTrims = {
    trimFrip: marginBySlot.get('frip'),
    trimVrip: marginBySlot.get('vrip'),
    trimFxct: marginBySlot.get('fxct'),
    // Field name is trimVXct (capital X per the PTX dictionary); never a
    // zero-fill: a side without a trim pass stays absent (undefined ≠ 0).
    trimVXct: marginBySlot.get('vxct'),
  };

  return {
    usableRootRegionId,
    materialTrims,
    productiveDivisionIds: productiveDivisions.map((division) => division.cutId),
  };
}

/**
 * Deterministic PTX event schedule for the r3 candidate (#661 contract §6.3).
 * r2 reused division.order as SEQUENCE; r3 adds physical FUNCTION 92 events,
 * so SEQUENCE must come from an explicit schedule: every productive division
 * keeps its relative execution order, and each 92 release is inserted
 * immediately after its producer phase-2 pass — which also places it before
 * every dependent recut (a recut of the producer's kept region always
 * executes after the producer). Sequences are contiguous 1..M.
 */
export interface PtxExecutionEvent {
  readonly eventId: string;
  readonly type: 'division' | 'offcut_release';
  /** Division cutId (type 'division') or released leaf regionId (type 'offcut_release'). */
  readonly sourceId: string;
  readonly sequence: number;
}

export interface PtxExecutionSchedule {
  readonly events: readonly PtxExecutionEvent[];
  /** cutId → SEQUENCE for productive divisions. */
  readonly sequenceByCutId: ReadonlyMap<string, number>;
  /** Released leaf regionId → SEQUENCE for FUNCTION 92 events. */
  readonly sequenceByRegionId: ReadonlyMap<string, number>;
}

export function schedulePtxExecutionEvents(
  executionPlans: readonly PtxDivisionPlan[],
  releases: readonly PtxReleasePlan[],
): PtxExecutionSchedule {
  const releaseByProducer = new Map<string, PtxReleasePlan[]>();
  for (const release of releases) {
    if (release.offcutRelease92 !== true) continue;
    const producerCutId = releaseByProducerKey(release);
    if (!producerCutId) {
      throw new PtxCompilationError(
        'ptx_compile.offcut_release_92_unsupported',
        'Release 92 sin división productora identificada: el scheduler no puede ordenar el evento físico',
        { regionId: release.regionId },
      );
    }
    const list = releaseByProducer.get(producerCutId) ?? [];
    list.push(release);
    releaseByProducer.set(producerCutId, list);
  }

  const events: PtxExecutionEvent[] = [];
  const sequenceByCutId = new Map<string, number>();
  const sequenceByRegionId = new Map<string, number>();
  let sequence = 0;
  for (const plan of executionPlans) {
    sequence += 1;
    sequenceByCutId.set(plan.division.cutId, sequence);
    events.push({
      eventId: `division:${plan.division.cutId}`,
      type: 'division',
      sourceId: plan.division.cutId,
      sequence,
    });
    for (const release of releaseByProducer.get(plan.division.cutId) ?? []) {
      sequence += 1;
      sequenceByRegionId.set(release.regionId, sequence);
      events.push({
        eventId: `offcut_release:${release.regionId}`,
        type: 'offcut_release',
        sourceId: release.regionId,
        sequence,
      });
    }
  }
  const scheduled92 = [...sequenceByRegionId.keys()];
  if (scheduled92.length !== releases.filter((release) => release.offcutRelease92 === true).length) {
    throw new PtxCompilationError(
      'ptx_compile.offcut_release_92_unsupported',
      'Una release 92 no pudo programarse después de su productor phase-2',
      { scheduled: scheduled92 },
    );
  }
  return { events, sequenceByCutId, sequenceByRegionId };
}

/** The producer cutId of a 92 release (set by planSheetReleases). */
function releaseByProducerKey(release: PtxReleasePlan): string | undefined {
  return release.producerCutId;
}

/**
 * Staging generations: the staging root (the raw board, or the usable root
 * after the r3 trim projection) is generation 1; dividing a generation-g
 * region is a phase-g pass; the kept child moves to g+1 while the rest child
 * stays at g. Matches the dossier exercise where the strip remainder keeps
 * receiving phase-2 crosscuts and only the separated block is reprocessed at
 * phase 3 — an X pass at phase 3 is FUNCTION 3, never FUNCTION 1.
 *
 * Divisions whose parent is not in the generation map (the r3 trim prefix:
 * their regions were projected to MATERIALS.TRIM_*) are skipped — projected
 * trims never consume PTX staging phases (#661 contract §5 rule 5).
 */
export function planCutProgramDivisions(
  trace: CutProgramTrace,
  usableRootRegionId: string = trace.boardRegionId,
): readonly PtxDivisionPlan[] {
  const generation = new Map<string, number>([[usableRootRegionId, 1]]);
  const pieceByRegion = new Map<string, string>();
  for (const terminal of trace.terminals) {
    if (terminal.kind === 'piece' && terminal.pieceRef) {
      pieceByRegion.set(terminal.regionId, terminal.pieceRef);
    }
  }

  const plans: PtxDivisionPlan[] = [];
  for (const division of trace.divisions) {
    const parentGeneration = generation.get(division.parentRegionId);
    if (parentGeneration === undefined) {
      // Outside the staged subtree: the r3 trim prefix (or a region consumed
      // by an earlier failed shape — the projection rejects those first).
      continue;
    }
    const phase = parentGeneration;
    if (phase > 3) {
      throw new PtxCompilationError(
        'ptx_compile.phase_unsupported',
        `La división requiere fase ${phase}; el subconjunto PTX soportado llega a la fase 3 (la fase 4 espera un fixture explícito)`,
        { cutId: division.cutId, phase },
      );
    }
    const functionCode = phase <= 2 ? (division.axis === 'y' ? 1 : 2) : 3;
    generation.set(division.keptRegionId, parentGeneration + 1);
    if (division.restRegionId) {
      generation.set(division.restRegionId, phase);
    }
    plans.push({
      division,
      phase,
      functionCode,
      keptPieceRef: pieceByRegion.get(division.keptRegionId),
      restPieceRef: division.restRegionId ? pieceByRegion.get(division.restRegionId) : undefined,
    });
  }
  return plans;
}

/**
 * Structural preorder of the division tree: kept subtree first, then the
 * rest subtree, from the staging root (the usable root when the r3 trim
 * projection applies). CUT_INDEX follows this order; SEQUENCE carries the
 * scheduled execution order instead — the two coincide on simple fixtures
 * but are derived independently (dossier fragment 03).
 */
export function ptxStructuralPreorder(
  trace: CutProgramTrace,
  usableRootRegionId: string = trace.boardRegionId,
): readonly CutProgramTraceDivision[] {
  const divisionByParentRegion = new Map<string, CutProgramTraceDivision>();
  for (const division of trace.divisions) {
    divisionByParentRegion.set(division.parentRegionId, division);
  }
  const out: CutProgramTraceDivision[] = [];
  const visit = (regionId: string): void => {
    const division = divisionByParentRegion.get(regionId);
    if (!division) return;
    out.push(division);
    visit(division.keptRegionId);
    if (division.restRegionId) visit(division.restRegionId);
  };
  visit(usableRootRegionId);
  const expectedCount = trace.divisions.filter((division) => division.trim !== true).length;
  if (out.length !== expectedCount) {
    throw new PtxCompilationError(
      'ptx_compile.program_invalid',
      'El árbol de divisiones productivas no es alcanzable desde la raíz de staging',
      { divisions: expectedCount, reachable: out.length },
    );
  }
  return out;
}

/**
 * PATTERNS.TYPE policy: longitudinal rip staging (0) when the first
 * productive division advances along y; cutting only (4) otherwise. Turn and
 * heading types (1/2/3) are never claimed — with trims included, the r3
 * fixed frame is expressed through TRIM_TYPE + MATERIALS.TRIM_*, not through
 * an initial board rotation.
 */
export function ptxPatternTypeForSheet(trace: CutProgramTrace): PtxPatternType {
  const first = trace.divisions.find((division) => division.trim !== true);
  return first && first.axis === 'y'
    ? PTX_PATTERN_TYPE.longitudinalRip
    : PTX_PATTERN_TYPE.cuttingOnly;
}

/**
 * VECTORS geometry of a division: the cut line at the kerf-band edge away
 * from the kept region, spanning the parent region on the other axis,
 * converted to the top-left origin convention (yTop = boardWidth − yBottom).
 * HEADER.ORIGIN is carried verbatim as the caller's declared convention.
 */
export function ptxDivisionVector(
  division: CutProgramTraceDivision,
  boardWidthMm: number,
  decimalPlaces: number,
): Pick<PtxVectorRecord, 'xStart' | 'yStart' | 'xEnd' | 'yEnd'> {
  const resolve = (value: number, field: string) =>
    ptxResolveMagnitude(value, decimalPlaces, `VECTORS.${field}`);
  const parent = division.parentRect;
  const band = division.kerfBandRect;
  if (division.axis === 'x') {
    const x = division.leadingBand ? band.xMm : band.xMm + band.lengthMm;
    return {
      xStart: resolve(x, 'X'),
      yStart: resolve(boardWidthMm - parent.yMm, 'Y_START'),
      xEnd: resolve(x, 'X'),
      yEnd: resolve(boardWidthMm - (parent.yMm + parent.widthMm), 'Y_END'),
    };
  }
  const y = division.leadingBand ? band.yMm : band.yMm + band.widthMm;
  return {
    xStart: resolve(parent.xMm, 'X_START'),
    yStart: resolve(boardWidthMm - y, 'Y'),
    xEnd: resolve(parent.xMm + parent.lengthMm, 'X_END'),
    yEnd: resolve(boardWidthMm - y, 'Y'),
  };
}

// ---------------------------------------------------------------------------
// Internal compilation state
// ---------------------------------------------------------------------------

interface MaterialRow {
  readonly code: string;
  readonly thicknessMm: number;
  index: number;
  hasBoards: boolean;
}

/** A leaf released by a dedicated row: remnants (Xn) and rest-side pieces. */
export interface PtxReleasePlan {
  readonly regionId: string;
  readonly kind: 'offcut' | 'part';
  readonly pieceRef?: string;
  /** Extent of the released leaf along its producing division's axis. */
  readonly dimensionMm: number;
  readonly functionCode: number;
  /** cutId of the producing division (attribution + scheduler anchor). */
  readonly producerCutId?: string;
  /**
   * r3 only (#661 contract §6.2): true when this release is the demonstrated
   * physical FUNCTION 92 pass — a rest-side remnant of a phase-2/FUNCTION-2
   * producer whose kept side carries productive content. Emitted with
   * QTY_RPT=1, QTY_PARTS absent and a scheduled positive SEQUENCE.
   */
  readonly offcutRelease92?: boolean;
}

/**
 * Leaves that need a dedicated release row: every remnant/offcut terminal
 * (production attribution via Xn, dossier fragment 04) and a piece isolated
 * on the rest side of a division whose kept side is also a piece (the main
 * row already references the kept one). Exact-fit terminals never get a
 * fictitious row — the producing division's row carries the reference.
 *
 * Under the r3 policy (`offcutRelease92: true`) a remnant additionally
 * becomes a physical FUNCTION 92 pass when ALL of the demonstrated subset
 * holds (contract §6.2): rest side of its producer, producer at phase 2 with
 * FUNCTION 2 (cross), extent over the producer axis known, and productive
 * content (a consuming division or a piece) on the kept side. Every other
 * remnant keeps the r2 QTY_RPT=0/SEQUENCE=0 representation — never silently
 * converted.
 */
export function planSheetReleases(
  trace: CutProgramTrace,
  plans: readonly PtxDivisionPlan[],
  options?: { readonly offcutRelease92?: boolean },
): readonly PtxReleasePlan[] {
  const planByLeafRegion = new Map<string, PtxDivisionPlan>();
  for (const plan of plans) {
    planByLeafRegion.set(plan.division.keptRegionId, plan);
    if (plan.division.restRegionId) {
      planByLeafRegion.set(plan.division.restRegionId, plan);
    }
  }
  const productiveCutIds = new Set(plans.map((plan) => plan.division.cutId));

  const releases: PtxReleasePlan[] = [];
  for (const terminal of trace.terminals) {
    const producing = planByLeafRegion.get(terminal.regionId);
    if (!producing) {
      // Only child regions can be attributed leaves; the board itself can
      // never be "produced" by a pass, so a board-level terminal cannot be
      // referenced by any CUTS row. Trim bands are liberated waste and are
      // projected to MATERIALS.TRIM_* — they never reach this loop as
      // remnants/pieces (the projection rejects anything else).
      if (terminal.kind === 'remnant') {
        throw new PtxCompilationError(
          'ptx_compile.remnant_unattributable',
          'Retazo terminal sin división productora: ninguna fila CUTS puede referenciarlo',
          { regionId: terminal.regionId },
        );
      }
      if (terminal.kind === 'piece') {
        throw new PtxCompilationError(
          'ptx_compile.piece_unattributable',
          'Pieza terminal sin división productora: no se crea una fila CUTS ficticia para asignarle PART_INDEX',
          { regionId: terminal.regionId, pieceRef: terminal.pieceRef },
        );
      }
      continue;
    }
    const division = producing.division;
    const isKept = division.keptRegionId === terminal.regionId;
    const restExtentMm =
      division.axis === 'x' ? division.restRect?.lengthMm : division.restRect?.widthMm;

    if (terminal.kind === 'remnant') {
      releases.push({
        regionId: terminal.regionId,
        kind: 'offcut',
        dimensionMm: isKept ? division.keptExtentMm : restExtentMm!,
        functionCode: producing.functionCode,
        producerCutId: producing.division.cutId,
        offcutRelease92:
          options?.offcutRelease92 === true &&
          isOffcutRelease92Eligible(trace, producing, { isKept, restExtentMm: restExtentMm! })
            ? true
            : undefined,
      });
      continue;
    }
    if (
      terminal.kind === 'piece' &&
      !isKept &&
      producing.keptPieceRef !== undefined &&
      producing.restPieceRef === terminal.pieceRef
    ) {
      releases.push({
        regionId: terminal.regionId,
        kind: 'part',
        pieceRef: terminal.pieceRef,
        dimensionMm: restExtentMm!,
        functionCode: producing.functionCode,
        producerCutId: producing.division.cutId,
      });
    }
  }
  return releases;
}

/**
 * FUNCTION 92 eligibility (contract §6.2 — every condition must hold):
 * 1. rest-side terminal of the producer (kept side is something else);
 * 2. producer at PTX phase 2 with normal FUNCTION 2 (cross);
 * 3. extent over the producer axis known (solid rest exists);
 * 4. productive content on the other side: the producer's kept region is
 *    consumed by another division or is a piece — a kept remnant/waste means
 *    the "offcut" is not a by-product of productive cutting;
 * 5. producer itself is a compiled (productive) division — projected trim
 *    passes never release offcuts;
 * 6. Xn uniqueness is enforced by the caller (offcut_release_duplicate).
 */
function isOffcutRelease92Eligible(
  trace: CutProgramTrace,
  producing: PtxDivisionPlan,
  measures: { readonly isKept: boolean; readonly restExtentMm: number },
): boolean {
  if (measures.isKept) return false;
  if (producing.phase !== 2 || producing.functionCode !== 2) return false;
  if (!Number.isFinite(measures.restExtentMm) || measures.restExtentMm <= 0) return false;
  const keptRegionId = producing.division.keptRegionId;
  const keptHasDivision = trace.divisions.some(
    (division) => division.trim !== true && division.parentRegionId === keptRegionId,
  );
  const keptIsPiece = trace.terminals.some(
    (terminal) => terminal.regionId === keptRegionId && terminal.kind === 'piece',
  );
  return keptHasDivision || keptIsPiece;
}

interface CompiledSheet {
  readonly sheet: CutPlanSheet;
  readonly trace: CutProgramTrace;
  /** Division plans in STRUCTURAL PREORDER (emission order for CUT_INDEX). */
  readonly plans: readonly PtxDivisionPlan[];
  readonly releases: readonly PtxReleasePlan[];
  /** r3 projection of the perimeter trims (usable root + MATERIALS.TRIM_*). */
  readonly trimPlan: PtxTrimPlan;
  /** r3 event schedule (sequence per division / per 92 release); undefined under r2 policy. */
  readonly schedule?: PtxExecutionSchedule;
}

function assertSheetCompilable(sheet: CutPlanSheet): void {
  if (sheet.strategy === 'cnc-nesting') {
    throw new PtxCompilationError(
      'ptx_compile.nesting_not_representable',
      'Hoja CNC nesting no representable en PTX guillotina: dibujar rectángulos no demuestra guillotinabilidad',
      { sheetIndex: sheet.sheetIndex },
    );
  }
  if (!sheet.cutProgram) {
    throw new PtxCompilationError(
      'ptx_compile.missing_cut_program',
      'Hoja sin programa de cortes: no se compila un árbol inventado desde coordenadas de piezas',
      { sheetIndex: sheet.sheetIndex },
    );
  }
}

function compileSheet(
  sheet: CutPlanSheet,
  kerfMm: number,
  options: CompileCutPlanToPtxOptions,
): CompiledSheet {
  assertSheetCompilable(sheet);
  let trace: CutProgramTrace;
  try {
    trace = executeCutProgram(sheet.cutProgram!);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new PtxCompilationError(
        'ptx_compile.program_invalid',
        `El programa de la hoja no ejecuta: ${error.message}`,
        { sheetIndex: sheet.sheetIndex, cause: error.context },
      );
    }
    throw error;
  }

  const r3TrimPolicy = options.supportsPositiveTrim === true;
  let trimPlan: PtxTrimPlan;
  if (r3TrimPolicy) {
    // r3: project the perimeter trim prefix to MATERIALS.TRIM_* and compile
    // the productive subtree from the usable root. Fail-closed shapes throw
    // specific trim_* codes from the planner.
    trimPlan = planSheetTrimProjection(trace);
  } else {
    const trimDivisions = trace.divisions.filter((division) => division.trim);
    if (trimDivisions.length > 0) {
      // Trim/refilado policy (r2, unchanged): the 90..99 codes are unsupported
      // and no unequivocal documented trim→head mapping exists — fail closed
      // instead of guessing, dropping, zero-filling or duplicating them.
      throw new PtxCompilationError(
        'ptx_compile.trim_unsupported',
        'El plan incluye refilados positivos y el candidato PTX todavía no tiene mapping documentado para pasadas de trim (90..99 deshabilitados); configura trim = 0',
        {
          sheetIndex: sheet.sheetIndex,
          trimCutIds: trimDivisions.map((division) => division.cutId),
        },
      );
    }
    trimPlan = planSheetTrimProjection(trace);
  }

  for (const division of trace.divisions) {
    if (Math.abs(division.kerfMm - kerfMm) > 1e-9 * Math.max(1, kerfMm)) {
      throw new PtxCompilationError(
        'ptx_compile.kerf_not_uniform',
        'Kerf de división distinto del kerf del plan: MATERIALS declara un único kerf',
        {
          sheetIndex: sheet.sheetIndex,
          cutId: division.cutId,
          divisionKerfMm: division.kerfMm,
          planKerfMm: kerfMm,
        },
      );
    }
  }

  const placedRefs = new Set(sheet.pieces.map((piece) => piece.id));
  const leafRefs = new Set<string>();
  for (const terminal of trace.terminals) {
    if (terminal.kind !== 'piece') continue;
    leafRefs.add(terminal.pieceRef!);
    if (!placedRefs.has(terminal.pieceRef!)) {
      throw new PtxCompilationError(
        'ptx_compile.leaf_without_placement',
        'Hoja de pieza del programa sin colocación correspondiente en la hoja',
        { sheetIndex: sheet.sheetIndex, pieceRef: terminal.pieceRef, regionId: terminal.regionId },
      );
    }
  }
  for (const piece of sheet.pieces) {
    if (!leafRefs.has(piece.id)) {
      throw new PtxCompilationError(
        'ptx_compile.placement_without_leaf',
        'Pieza colocada sin hoja de pieza en el programa ejecutado',
        { sheetIndex: sheet.sheetIndex, pieceRef: piece.id },
      );
    }
  }

  // Staging resets at the usable root under r3: projected trims never consume
  // PTX phases, so the first productive pass is phase 1 again.
  const executionPlans = planCutProgramDivisions(trace, trimPlan.usableRootRegionId);
  const planByCutId = new Map(executionPlans.map((plan) => [plan.division.cutId, plan]));
  const plans = ptxStructuralPreorder(trace, trimPlan.usableRootRegionId).map(
    (division) => planByCutId.get(division.cutId)!,
  );
  const releases = planSheetReleases(trace, executionPlans, {
    offcutRelease92: r3TrimPolicy,
  });

  let schedule: PtxExecutionSchedule | undefined;
  if (r3TrimPolicy) {
    schedule = schedulePtxExecutionEvents(executionPlans, releases);
  }

  return { sheet, trace, plans, releases, trimPlan, schedule };
}

function materialCodeOf(sheet: CutPlanSheet): string {
  return requireAsciiIdentity(sheet.materialCode, 'material code', {
    sheetIndex: sheet.sheetIndex,
    materialCode: sheet.materialCode,
  });
}

/** Piece material identity: the piece's own code, or the sheet's when absent. */
function pieceMaterialCodeOf(piece: { readonly materialCode?: string }, sheet: CutPlanSheet): string {
  return piece.materialCode !== undefined
    ? requireAsciiIdentity(piece.materialCode, 'piece material code', {
        sheetIndex: sheet.sheetIndex,
        materialCode: piece.materialCode,
      })
    : materialCodeOf(sheet);
}

function registerMaterial(
  materials: Map<string, MaterialRow>,
  code: string,
  thicknessMm: number | undefined,
  context: Record<string, unknown>,
): void {
  if (thicknessMm === undefined || !Number.isFinite(thicknessMm) || thicknessMm <= 0) {
    throw new PtxCompilationError(
      'ptx_compile.material_thickness_missing',
      'Espesor industrial obligatorio ausente: no hay espesor por defecto en el candidato PTX',
      { ...context, code },
    );
  }
  const existing = materials.get(code);
  if (existing) {
    if (Math.abs(existing.thicknessMm - thicknessMm) > 1e-9 * Math.max(1, thicknessMm)) {
      throw new PtxCompilationError(
        'ptx_compile.material_conflict',
        'Mismo código de material con espesores distintos: identidades de stock separadas requeridas',
        { ...context, code, existingThicknessMm: existing.thicknessMm, thicknessMm },
      );
    }
    return;
  }
  materials.set(code, { code, thicknessMm, index: 0, hasBoards: false });
}

function grainOf(grain: number, context: Record<string, unknown>): PtxGrain {
  if (grain === 0) return PTX_GRAIN.free;
  if (grain === 1) return PTX_GRAIN.length;
  throw new PtxCompilationError(
    'ptx_compile.piece_grain_invalid',
    'Valor de veta no representable en el diccionario PTX',
    { ...context, grain },
  );
}

function isPrintableAscii(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/**
 * Compiles a real CutPlan into a validated PtxDocument plus the inverse
 * mapping. The returned document has passed validatePtxDocument (fail-closed
 * boundary, same contract as the serializer): a document is never returned
 * with relational/index issues.
 */
export function compileCutPlanToPtxDocument(
  cutPlan: CutPlan,
  options: CompileCutPlanToPtxOptions,
): CompiledPtxCandidate {
  if (
    !Number.isInteger(options.decimalPlaces) ||
    options.decimalPlaces < 0 ||
    options.decimalPlaces > 6
  ) {
    throw new PtxCompilationError(
      'ptx_compile.options_invalid',
      'decimalPlaces debe ser un entero entre 0 y 6',
      { decimalPlaces: options.decimalPlaces },
    );
  }
  if (options.title === '' || !isPrintableAscii(options.title)) {
    throw new PtxCompilationError(
      'ptx_compile.options_invalid',
      'title debe ser ASCII de impresión no vacío (etiqueta del candidato)',
      { title: options.title },
    );
  }
  if (cutPlan.sheets.length === 0) {
    throw new PtxCompilationError(
      'ptx_compile.no_sheets',
      'El plan no tiene tableros que compilar',
      { planId: cutPlan.id },
    );
  }

  const decimalPlaces = options.decimalPlaces;
  const q = (value: number, field: string) => ptxResolveMagnitude(value, decimalPlaces, field);
  const kerfMm = cutPlan.config.sawKerfMm;

  const compiledSheets = cutPlan.sheets.map((sheet) => compileSheet(sheet, kerfMm, options));

  // --- Material table: sheets first, then any piece-only material ---------
  const materials = new Map<string, MaterialRow>();
  for (const { sheet } of compiledSheets) {
    const code = materialCodeOf(sheet);
    registerMaterial(materials, code, sheet.thicknessMm, { sheetIndex: sheet.sheetIndex });
    materials.get(code)!.hasBoards = true;
  }
  for (const { sheet } of compiledSheets) {
    for (const piece of sheet.pieces) {
      const code = pieceMaterialCodeOf(piece, sheet);
      if (materials.has(code)) continue;
      registerMaterial(materials, code, piece.thicknessMm ?? sheet.thicknessMm, {
        sheetIndex: sheet.sheetIndex,
        pieceRef: piece.id,
      });
    }
  }
  let nextMaterialIndex = 1;
  for (const material of materials.values()) {
    if (!material.hasBoards) {
      throw new PtxCompilationError(
        'ptx_compile.material_without_boards',
        'Material referenciado por piezas sin ningún tablero propio en el plan',
        { code: material.code },
      );
    }
    material.index = nextMaterialIndex++;
  }

  // --- MATERIALS.TRIM_* (#661): one row per material must agree across all
  // --- of its sheets; disagreeing executed margins cannot share a row.
  const trimByMaterial = new Map<string, PtxMaterialTrims>();
  for (const material of materials.values()) {
    const sheetPlans = compiledSheets
      .filter(({ sheet }) => materialCodeOf(sheet) === material.code)
      .map(({ trimPlan }) => trimPlan.materialTrims);
    if (sheetPlans.length === 0) continue;
    const slots = [
      'trimFrip',
      'trimVrip',
      'trimFxct',
      'trimVXct',
    ] as const;
    for (const slot of slots) {
      const values = sheetPlans.map((trims) => trims[slot]);
      const defined = values.filter((value) => value !== undefined);
      const allDefined = values.every((value) => value !== undefined);
      if (defined.length === 0) continue;
      if (
        !allDefined ||
        defined.some((value) => Math.abs(value! - defined[0]!) > 1e-9 * Math.max(1, defined[0]!))
      ) {
        throw new PtxCompilationError(
          'ptx_compile.trim_mapping_ambiguous',
          'Hojas del mismo material con refilados ejecutados distintos: la fila MATERIALS no puede representar un único TRIM_*',
          {
            code: material.code,
            slot,
            executedMarginsMm: values,
          },
        );
      }
    }
    trimByMaterial.set(material.code, sheetPlans[0]!);
  }

  // --- Parts table: one row per placed piece, no aggregation --------------
  const partIndexByPieceRef = new Map<string, number>();
  const pieceRefByPartIndex: string[] = [];
  const partsReq: PtxRecord[] = [];
  let partIndex = 1;
  for (const { sheet } of compiledSheets) {
    for (const piece of sheet.pieces) {
      if (partIndexByPieceRef.has(piece.id)) {
        throw new PtxCompilationError(
          'ptx_compile.piece_ref_duplicate',
          'Referencia de pieza duplicada en el plan',
          { pieceRef: piece.id },
        );
      }
      partIndexByPieceRef.set(piece.id, partIndex);
      pieceRefByPartIndex.push(piece.id);
      const materialCode = pieceMaterialCodeOf(piece, sheet);
      // PARTS_REQ.CODE is contractual identity: non-ASCII fails closed (no
      // silent filtering that could merge two part codes); empty gets the
      // explicit technical code PART-<n> (the placement ref is the identity).
      const partCode =
        piece.partCode === ''
          ? `PART-${partIndex}`
          : requireAsciiIdentity(piece.partCode, 'partCode', { pieceRef: piece.id, partCode: piece.partCode });
      partsReq.push({
        type: 'PARTS_REQ',
        jobIndex: 1,
        partIndex,
        code: partCode,
        materialIndex: materials.get(materialCode)!.index,
        length: q(piece.lengthMm, `PARTS_REQ ${partIndex} LENGTH`),
        width: q(piece.widthMm, `PARTS_REQ ${partIndex} WIDTH`),
        requiredQuantity: 1,
        overQuantity: 0,
        underQuantity: 0,
        grain: grainOf(piece.grain, { pieceRef: piece.id }),
        producedQuantity: 1,
      });
      partIndex += 1;
    }
  }

  // --- Records -------------------------------------------------------------
  const records: PtxRecord[] = [
    {
      type: 'JOBS',
      jobIndex: 1,
      name: ptxAscii(cutPlan.projectId) || 'GRANETE-JOB',
      description: 'GRANETE NON-PRODUCTION PTX CANDIDATE',
      // ORD_DATE/OPT_PARAM/SAW_PARAM/CUT_TIME/WASTE_PCNT deliberately empty:
      // no clock and no receiver-unknown values are invented (fragment 02
      // prefix style is NOT copied).
    },
  ];

  for (const material of materials.values()) {
    const sampleSheet = compiledSheets.find(
      ({ sheet }) => materialCodeOf(sheet) === material.code,
    )!.sheet;
    const trims = trimByMaterial.get(material.code);
    records.push({
      type: 'MATERIALS',
      jobIndex: 1,
      materialIndex: material.index,
      code: material.code,
      description: ptxAscii(sampleSheet.materialName) || undefined,
      thickness: q(material.thicknessMm, `MATERIALS '${material.code}' THICK`),
      // BOOK: the dossier only establishes that it counts boards, not
      // millimetres [S03 pp.134–135]; "total boards of the material in the
      // job" is NOT documented. The candidate's one-board-per-cycle policy
      // (MAX_BOOK=1, QTY_CYCLES=1, one BOARDS row per sheet) emits BOOK = 1.
      bookQuantity: 1,
      kerfRip: q(kerfMm, `MATERIALS '${material.code}' KERF_RIP`),
      kerfCrosscut: q(kerfMm, `MATERIALS '${material.code}' KERF_XCT`),
      // r3 (#661): the four evidenced trims, each the TOTAL margin including
      // kerf (G4), mapped by executed axis + leadingBand (G2). A side without
      // a trim pass stays ABSENT (undefined → empty cell, never 0). G3:
      // TRIM_HEAD/TRIM_FRCT/TRIM_VRCT are never derived — no override.
      trimFRip: trims?.trimFrip !== undefined ? q(trims.trimFrip, `MATERIALS '${material.code}' TRIM_FRIP`) : undefined,
      trimVRip: trims?.trimVrip !== undefined ? q(trims.trimVrip, `MATERIALS '${material.code}' TRIM_VRIP`) : undefined,
      trimFXct: trims?.trimFxct !== undefined ? q(trims.trimFxct, `MATERIALS '${material.code}' TRIM_FXCT`) : undefined,
      trimVXct: trims?.trimVXct !== undefined ? q(trims.trimVXct, `MATERIALS '${material.code}' TRIM_VXCT`) : undefined,
      // RULE1..4 deliberately empty: receiver semantics stay unresolved (§9).
    });
  }

  records.push(...partsReq);

  const offcutRecords: PtxOffcutRecord[] = [];
  const vectorRecords: PtxVectorRecord[] = [];
  const sheetMappings: PtxCompiledSheetMapping[] = [];
  const offcutRegionIdByOffcutIndex: string[] = [];
  const sheetIndexByPatternIndex: number[] = [];
  let offcutIndex = 1;

  compiledSheets.forEach(({ sheet, trace, plans, releases, schedule }, sheetPosition) => {
    const patternIndex = sheetPosition + 1;
    const materialIndex = materials.get(materialCodeOf(sheet))!.index;
    const patternType = ptxPatternTypeForSheet(trace);
    sheetIndexByPatternIndex.push(sheet.sheetIndex);

    records.push({
      type: 'BOARDS',
      jobIndex: 1,
      boardIndex: patternIndex,
      code: `S${sheet.sheetIndex + 1}`,
      materialIndex,
      length: q(sheet.sheetLengthMm, `BOARDS ${patternIndex} LENGTH`),
      width: q(sheet.sheetWidthMm, `BOARDS ${patternIndex} WIDTH`),
      stockQuantity: 1,
      usedQuantity: 1,
    });
    records.push({
      type: 'PATTERNS',
      jobIndex: 1,
      patternIndex,
      boardIndex: patternIndex,
      patternType,
      runQuantity: 1,
      cyclesQuantity: 1,
      maxBook: 1,
    });

    const cutIndexByCutId = new Map<string, number>();
    const cutIdByCutIndex: string[] = [];
    plans.forEach((plan, i) => {
      const division = plan.division;
      const cutIndex = i + 1;
      cutIndexByCutId.set(division.cutId, cutIndex);
      cutIdByCutIndex.push(division.cutId);
      const partReference: PtxPartReference =
        plan.keptPieceRef !== undefined
          ? { kind: 'part', partIndex: partIndexByPieceRef.get(plan.keptPieceRef)! }
          : { kind: 'none' };
      records.push({
        type: 'CUTS',
        jobIndex: 1,
        patternIndex,
        cutIndex,
        // r2: the program's execution order. r3: the explicit event schedule
        // (division events keep their relative order; FUNCTION 92 releases
        // interleave right after their producer — contract §6.3).
        sequence: schedule?.sequenceByCutId.get(division.cutId) ?? division.order,
        functionCode: plan.functionCode,
        dimension: q(division.keptExtentMm, `CUTS ${patternIndex}/${cutIndex} (${division.cutId}) DIMENSION`),
        repeatQuantity: 1,
        partReference,
        producedQuantity: plan.keptPieceRef !== undefined ? 1 : 0,
        comment: ptxAscii(division.cutId) || undefined,
      });
      if (options.includeVectors === true) {
        vectorRecords.push({
          type: 'VECTORS',
          jobIndex: 1,
          patternIndex,
          cutIndex,
          ...ptxDivisionVector(division, trace.boardRect.widthMm, decimalPlaces),
        });
      }
    });

    const terminalByRegion = new Map(trace.terminals.map((t) => [t.regionId, t]));
    const releaseCutIndexByRegionId = new Map<string, number>();
    const offcutIndexByRegionId = new Map<string, number>();
    const offcutIndexBy92Release = new Map<string, string>();
    releases.forEach((release, i) => {
      const cutIndex = plans.length + i + 1;
      releaseCutIndexByRegionId.set(release.regionId, cutIndex);
      const reference: PtxPartReference =
        release.kind === 'offcut'
          ? { kind: 'offcut', offcutIndex }
          : { kind: 'part', partIndex: partIndexByPieceRef.get(release.pieceRef!)! };
      // r3 FUNCTION 92 (contract §6.2): a PHYSICAL release pass — QTY_RPT=1,
      // QTY_PARTS absent, positive scheduled SEQUENCE. Every other release
      // keeps the r2 relational representation: QTY_RPT=0/SEQUENCE=0.
      const isPhysical92 = release.offcutRelease92 === true;
      if (isPhysical92) {
        const previous = offcutIndexBy92Release.get(`X${offcutIndex}`);
        if (previous !== undefined || release.producerCutId === undefined) {
          throw new PtxCompilationError(
            'ptx_compile.offcut_release_duplicate',
            'El mismo Xn tendría dos eventos físicos de release: ninguna referencia de retazo puede liberarse dos veces',
            { regionId: release.regionId, offcutIndex, previousRegionId: previous },
          );
        }
        offcutIndexBy92Release.set(`X${offcutIndex}`, release.regionId);
      }
      records.push({
        type: 'CUTS',
        jobIndex: 1,
        patternIndex,
        cutIndex,
        sequence: isPhysical92
          ? schedule!.sequenceByRegionId.get(release.regionId)!
          : 0,
        functionCode: isPhysical92 ? 92 : release.functionCode,
        dimension: q(release.dimensionMm, `CUTS ${patternIndex}/${cutIndex} (release ${release.regionId}) DIMENSION`),
        repeatQuantity: isPhysical92 ? 1 : 0,
        partReference: reference,
        producedQuantity: isPhysical92 ? undefined : 1,
        comment: ptxAscii(release.regionId) || undefined,
      });
      if (release.kind === 'offcut') {
        const terminal = terminalByRegion.get(release.regionId)!;
        offcutIndexByRegionId.set(release.regionId, offcutIndex);
        offcutRegionIdByOffcutIndex.push(release.regionId);
        offcutRecords.push({
          type: 'OFFCUTS',
          jobIndex: 1,
          offcutIndex,
          code: ptxAscii(release.regionId) || `OFFCUT-${offcutIndex}`,
          materialIndex,
          length: q(terminal.rect.lengthMm, `OFFCUTS ${offcutIndex} LENGTH`),
          width: q(terminal.rect.widthMm, `OFFCUTS ${offcutIndex} WIDTH`),
        });
        offcutIndex += 1;
      }
    });

    sheetMappings.push({
      sheetIndex: sheet.sheetIndex,
      boardIndex: patternIndex,
      patternIndex,
      patternType,
      cutIndexByCutId,
      cutIdByCutIndex,
      releaseCutIndexByRegionId,
      offcutIndexByRegionId,
    });
  });

  records.push(...offcutRecords, ...vectorRecords);

  const document: PtxDocument = {
    header: {
      type: 'HEADER',
      version: options.headerVersion,
      title: options.title,
      units: PTX_UNITS.metric,
      origin: options.headerOrigin,
      trimType: options.trimType,
    },
    records,
  };

  const issues = validatePtxDocument(document);
  if (issues.length > 0) {
    throw new PtxDocumentInvalidError(issues);
  }

  return {
    document,
    mapping: {
      jobIndex: 1,
      materialIndexByCode: new Map(
        [...materials.values()].map((material) => [material.code, material.index]),
      ),
      partIndexByPieceRef,
      pieceRefByPartIndex,
      offcutRegionIdByOffcutIndex,
      sheetIndexByPatternIndex,
      sheets: sheetMappings,
    },
  };
}
