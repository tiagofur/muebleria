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
 *   its parent region: the board is generation 1; a division over a
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
 * - Trims/refilados FAIL CLOSED: the 90..99 trim/waste codes stay unsupported
 *   and no unequivocal documented mapping to FUNCTION 0/head exists in the
 *   frozen dossier, so a program containing trim divisions is rejected with
 *   ptx_compile.trim_unsupported instead of guessing a machine mapping
 *   (silently dropping, zero-filling or duplicating them is forbidden). The
 *   first candidate therefore supports trim = 0 plans only.
 *
 * - PATTERNS.TYPE: 0 (longitudinal rip staging) when the first division
 *   advances along y, 4 (cutting only, no staging claim) otherwise. Types
 *   1/2/3 (turn/heads) are never claimed.
 *
 * - MATERIALS: THICK/BOOK/KERF_RIP/KERF_XCT are mandatory from the real plan
 *   (missing thickness fails closed; no hardcoded 4/18 mm); both kerf fields
 *   stay separate fields fed from Granete's single saw configuration, and
 *   every division kerf must equal config.sawKerfMm or compilation fails.
 *   TRIM_* and RULE1..4 stay EMPTY: their per-class receiver semantics are a
 *   documented §9 ambiguity and the trim geometry would live in CUTS rows —
 *   which are rejected anyway by the trim policy above.
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
 * - ASCII policy: PTX text cells must be printable ASCII. Codes/titles are
 *   derived by filtering non-printable characters; a required field that
 *   comes out empty fails closed instead of being silently renamed.
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
  | 'ptx_compile.kerf_not_uniform'
  | 'ptx_compile.magnitude_not_representable'
  | 'ptx_compile.material_code_not_representable'
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

/** Filters to printable ASCII (32..126). No trimming, no transliteration: deterministic. */
export function ptxAscii(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) out += ch;
  }
  return out;
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
  /** Staging phase: 1 for board-level passes, +1 per kept-side nesting level. */
  readonly phase: number;
  /** Emitted CUTS.FUNCTION: phases ≤ 2 by axis role (y→1 rip, x→2 cross), phase 3 → 3. */
  readonly functionCode: number;
  /** Piece isolated on the kept side, referenced by the division's main row. */
  readonly keptPieceRef?: string;
  /** Piece isolated on the rest side (only when the kept side is also a piece). */
  readonly restPieceRef?: string;
}

/**
 * Staging generations: board = 1; dividing a generation-g region is a phase-g
 * pass; the kept child moves to g+1 while the rest child stays at g. Matches
 * the dossier exercise where the strip remainder keeps receiving phase-2
 * crosscuts and only the separated block is reprocessed at phase 3 — an X
 * pass at phase 3 is FUNCTION 3, never FUNCTION 1.
 */
export function planCutProgramDivisions(trace: CutProgramTrace): readonly PtxDivisionPlan[] {
  const generation = new Map<string, number>([[trace.boardRegionId, 1]]);
  const pieceByRegion = new Map<string, string>();
  for (const terminal of trace.terminals) {
    if (terminal.kind === 'piece' && terminal.pieceRef) {
      pieceByRegion.set(terminal.regionId, terminal.pieceRef);
    }
  }

  const plans: PtxDivisionPlan[] = [];
  for (const division of trace.divisions) {
    const parentGeneration = generation.get(division.parentRegionId) ?? 1;
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
 * rest subtree (each region is consumed by at most one division, guaranteed
 * by executeCutProgram). CUT_INDEX follows this order; SEQUENCE carries the
 * program's execution order instead — the two coincide on simple fixtures
 * but are derived independently (dossier fragment 03).
 */
export function ptxStructuralPreorder(trace: CutProgramTrace): readonly CutProgramTraceDivision[] {
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
  visit(trace.boardRegionId);
  if (out.length !== trace.divisions.length) {
    throw new PtxCompilationError(
      'ptx_compile.program_invalid',
      'El árbol de divisiones no es alcanzable desde el tablero',
      { divisions: trace.divisions.length, reachable: out.length },
    );
  }
  return out;
}

/**
 * PATTERNS.TYPE policy: longitudinal rip staging (0) when the first division
 * advances along y; cutting only (4) otherwise. Turn/heading types are never
 * claimed.
 */
export function ptxPatternTypeForSheet(trace: CutProgramTrace): PtxPatternType {
  const first = trace.divisions[0];
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
  bookCount: number;
}

/** A leaf released by a dedicated QTY_RPT=0 row: remnants (Xn) and rest-side pieces. */
export interface PtxReleasePlan {
  readonly regionId: string;
  readonly kind: 'offcut' | 'part';
  readonly pieceRef?: string;
  /** Extent of the released leaf along its producing division's axis. */
  readonly dimensionMm: number;
  readonly functionCode: number;
}

/**
 * Leaves that need a dedicated QTY_RPT=0/SEQUENCE=0 release row: every
 * remnant/offcut terminal (production attribution via Xn, dossier fragment
 * 04) and a piece isolated on the rest side of a division whose kept side is
 * also a piece (the main row already references the kept one). Exact-fit
 * terminals never get a fictitious row — the producing division's row
 * carries the reference.
 */
export function planSheetReleases(
  trace: CutProgramTrace,
  plans: readonly PtxDivisionPlan[],
): readonly PtxReleasePlan[] {
  const planByLeafRegion = new Map<string, PtxDivisionPlan>();
  for (const plan of plans) {
    planByLeafRegion.set(plan.division.keptRegionId, plan);
    if (plan.division.restRegionId) {
      planByLeafRegion.set(plan.division.restRegionId, plan);
    }
  }

  const releases: PtxReleasePlan[] = [];
  for (const terminal of trace.terminals) {
    const producing = planByLeafRegion.get(terminal.regionId);
    if (!producing) {
      // Only child regions can be attributed leaves; the board itself can
      // never be "produced" by a pass, so a board-level terminal cannot be
      // referenced by any CUTS row.
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
      });
    }
  }
  return releases;
}

interface CompiledSheet {
  readonly sheet: CutPlanSheet;
  readonly trace: CutProgramTrace;
  /** Division plans in STRUCTURAL PREORDER (emission order for CUT_INDEX). */
  readonly plans: readonly PtxDivisionPlan[];
  readonly releases: readonly PtxReleasePlan[];
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

function compileSheet(sheet: CutPlanSheet, kerfMm: number): CompiledSheet {
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

  const trimDivisions = trace.divisions.filter((division) => division.trim);
  if (trimDivisions.length > 0) {
    // Trim/refilado policy: the 90..99 codes are unsupported and no
    // unequivocal documented trim→head mapping exists — fail closed instead
    // of guessing, dropping, zero-filling or duplicating them.
    throw new PtxCompilationError(
      'ptx_compile.trim_unsupported',
      'El plan incluye refilados positivos y el candidato PTX todavía no tiene mapping documentado para pasadas de trim (90..99 deshabilitados); configura trim = 0',
      {
        sheetIndex: sheet.sheetIndex,
        trimCutIds: trimDivisions.map((division) => division.cutId),
      },
    );
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

  const executionPlans = planCutProgramDivisions(trace);
  const planByCutId = new Map(executionPlans.map((plan) => [plan.division.cutId, plan]));
  const plans = ptxStructuralPreorder(trace).map(
    (division) => planByCutId.get(division.cutId)!,
  );
  const releases = planSheetReleases(trace, executionPlans);

  return { sheet, trace, plans, releases };
}

function materialCodeOf(sheet: CutPlanSheet): string {
  const code = ptxAscii(sheet.materialCode);
  if (code === '') {
    throw new PtxCompilationError(
      'ptx_compile.material_code_not_representable',
      'Código de material no representable en ASCII de impresión',
      { sheetIndex: sheet.sheetIndex, materialCode: sheet.materialCode },
    );
  }
  return code;
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
  materials.set(code, { code, thicknessMm, index: 0, bookCount: 0 });
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

  const compiledSheets = cutPlan.sheets.map((sheet) => compileSheet(sheet, kerfMm));

  // --- Material table: sheets first, then any piece-only material ---------
  const materials = new Map<string, MaterialRow>();
  for (const { sheet } of compiledSheets) {
    const code = materialCodeOf(sheet);
    registerMaterial(materials, code, sheet.thicknessMm, { sheetIndex: sheet.sheetIndex });
    materials.get(code)!.bookCount += 1;
  }
  for (const { sheet } of compiledSheets) {
    for (const piece of sheet.pieces) {
      const code = ptxAscii(piece.materialCode ?? sheet.materialCode);
      if (code === '' || materials.has(code)) continue;
      registerMaterial(materials, code, piece.thicknessMm ?? sheet.thicknessMm, {
        sheetIndex: sheet.sheetIndex,
        pieceRef: piece.id,
      });
    }
  }
  let nextMaterialIndex = 1;
  for (const material of materials.values()) {
    if (material.bookCount === 0) {
      throw new PtxCompilationError(
        'ptx_compile.material_without_boards',
        'Material referenciado por piezas sin ningún tablero propio en el plan',
        { code: material.code },
      );
    }
    material.index = nextMaterialIndex++;
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
      const materialCode = ptxAscii(piece.materialCode ?? sheet.materialCode);
      partsReq.push({
        type: 'PARTS_REQ',
        jobIndex: 1,
        partIndex,
        code: ptxAscii(piece.partCode) || `PART-${partIndex}`,
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
    records.push({
      type: 'MATERIALS',
      jobIndex: 1,
      materialIndex: material.index,
      code: material.code,
      description: ptxAscii(sampleSheet.materialName) || undefined,
      thickness: q(material.thicknessMm, `MATERIALS '${material.code}' THICK`),
      bookQuantity: material.bookCount,
      kerfRip: q(kerfMm, `MATERIALS '${material.code}' KERF_RIP`),
      kerfCrosscut: q(kerfMm, `MATERIALS '${material.code}' KERF_XCT`),
      // TRIM_* and RULE1..4 deliberately empty: per-class trim semantics are
      // a §9 ambiguity and trim plans are rejected anyway.
    });
  }

  records.push(...partsReq);

  const offcutRecords: PtxOffcutRecord[] = [];
  const vectorRecords: PtxVectorRecord[] = [];
  const sheetMappings: PtxCompiledSheetMapping[] = [];
  const offcutRegionIdByOffcutIndex: string[] = [];
  const sheetIndexByPatternIndex: number[] = [];
  let offcutIndex = 1;

  compiledSheets.forEach(({ sheet, trace, plans, releases }, sheetPosition) => {
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
        sequence: division.order,
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
    releases.forEach((release, i) => {
      const cutIndex = plans.length + i + 1;
      releaseCutIndexByRegionId.set(release.regionId, cutIndex);
      const reference: PtxPartReference =
        release.kind === 'offcut'
          ? { kind: 'offcut', offcutIndex }
          : { kind: 'part', partIndex: partIndexByPieceRef.get(release.pieceRef!)! };
      records.push({
        type: 'CUTS',
        jobIndex: 1,
        patternIndex,
        cutIndex,
        sequence: 0,
        functionCode: release.functionCode,
        dimension: q(release.dimensionMm, `CUTS ${patternIndex}/${cutIndex} (release ${release.regionId}) DIMENSION`),
        repeatQuantity: 0,
        partReference: reference,
        producedQuantity: 1,
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
