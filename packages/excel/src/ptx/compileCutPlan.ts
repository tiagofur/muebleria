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
 * serializer, and it claims no CADmatic 4 compatibility (field validation
 * stays NOT_TESTED/notClaimed).
 *
 * Documented candidate decisions (the contract of the emitted bytes — checked
 * by verifyCutPlanPtxReadback and by tests; none is a receiver-verified claim):
 *
 * - One JOBS row for the whole plan. One BOARDS + one PATTERNS row per sheet
 *   (one board per cycle, no pattern compression — QTY_RUN/QTY_CYCLES/MAX_BOOK
 *   all 1). MATERIALS rows per distinct material code (first-appearance
 *   order: sheets, then piece materials). PARTS_REQ rows per placed piece
 *   with QTY_REQ=1: no type aggregation, so piece identity survives for
 *   labels.
 *
 * - CUTS rows: one per program division IN PROGRAM ORDER (row order preserves
 *   the execution/nesting order; SEQUENCE mirrors it), then one release row
 *   per remnant/offcut leaf and per rest-side piece leaf of a double-piece
 *   division. Release rows carry SEQUENCE=0 and QTY_RPT=0: they attribute
 *   production without inventing a new saw pass (dossier fragment 04).
 *
 * - FUNCTION policy. The cut phase of a division is the staging generation of
 *   its parent region: the board is generation 1; a division over a
 *   generation-g region is a phase-g pass; the kept child moves to generation
 *   g+1 while the rest child stays at g (material still on the bench is not
 *   re-staged); trim divisions are transparent — they square the perimeter
 *   and never advance the generation. This reproduces the dossier exercise:
 *   strip separation = phase 1 (fn 1), in-strip cuts = phase 2 (fn 2,
 *   CUT_B/CUT_C), the separated block reprocessed at phase 3 (fn 3, CUT_D).
 *   Phases ≤ 2 emit the axis role (axis y → 1 rip, axis x → 2 cross); phase 3
 *   emits 3. Phase > 3 fails closed: code 4 waits for an explicit phase-4
 *   fixture (#656 records.ts). Trim passes emit the phase/axis code of their
 *   position — the 90..99 trim/waste codes stay unsupported on purpose (their
 *   receiver semantics are an open §9 ambiguity; the trim geometry is
 *   already fully represented as real CUTS rows).
 *
 * - PATTERNS.TYPE: 0 (longitudinal rip staging) when the first non-trim
 *   division advances along y, 4 (cutting only, no staging claim) otherwise.
 *   Types 1/2/3 (turn/heads) are never claimed.
 *
 * - MATERIALS trims and RULE1..4 stay EMPTY: trim geometry lives in the CUTS
 *   rows as real passes and the trim-column per-class semantics are
 *   documented as ambiguous (§9). Kerf is uniform per plan: every division
 *   kerf must equal config.sawKerfMm or compilation fails closed.
 *
 * - Quantization: every magnitude is quantized to options.decimalPlaces
 *   BEFORE emission, coherently across boards/parts/cuts/vectors. The
 *   serializer's exact-representability contract then holds by construction;
 *   the same decimalPlaces must be passed to serializePtxDocument(Bytes).
 *
 * - VECTORS (optional): one row per division, drawn at the kerf-band edge
 *   away from the kept region, spanning the parent region on the other axis
 *   (never the whole board). Emitted in the top-left origin convention (CUTS
 *   convention; yTop = boardWidth − yBottom per the investigation §6
 *   formulas); HEADER.ORIGIN carries the caller's explicit choice verbatim.
 *
 * - ASCII policy: PTX text cells must be printable ASCII. Codes/titles are
 *   derived by filtering non-printable characters; a required field that
 *   comes out empty fails closed instead of being silently renamed.
 *
 * Determinism: a pure function of (cutPlan, options) — no clock, no
 * randomness, stable iteration orders everywhere.
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
  /** Fixed decimal resolution for every emitted magnitude; pass the same value when serializing. */
  readonly decimalPlaces: number;
  /** Emit one VECTORS row per division (absolute cut lines, top-left origin). */
  readonly includeVectors?: boolean;
}

/** Per-sheet slice of the inverse table linking durable identities to local PTX indexes. */
export interface PtxCompiledSheetMapping {
  readonly sheetIndex: number;
  readonly boardIndex: number;
  readonly patternIndex: number;
  readonly patternType: PtxPatternType;
  /** cutId → CUT_INDEX of the division row (trims included). */
  readonly cutIndexByCutId: ReadonlyMap<string, number>;
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
  | 'ptx_compile.kerf_not_uniform'
  | 'ptx_compile.material_code_not_representable'
  | 'ptx_compile.material_thickness_missing'
  | 'ptx_compile.material_conflict'
  | 'ptx_compile.material_without_boards'
  | 'ptx_compile.piece_ref_duplicate'
  | 'ptx_compile.piece_grain_invalid'
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

/** Rounds to the configured resolution so every emitted magnitude is exactly representable. */
export function ptxQuantize(value: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}

/** Cut phase / FUNCTION plan of one executed trace division (documented staging model). */
export interface PtxDivisionPlan {
  readonly division: CutProgramTraceDivision;
  /** Staging phase: 1 for board-level passes, +1 per kept-side nesting level (trims transparent). */
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
 * pass; the kept child moves to g+1 (except trims, which stay transparent at
 * g) while the rest child stays at g. Matches the dossier exercise where the
 * strip remainder keeps receiving phase-2 crosscuts and only the separated
 * block is reprocessed at phase 3.
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
    generation.set(division.keptRegionId, division.trim ? parentGeneration : parentGeneration + 1);
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
 * PATTERNS.TYPE policy: longitudinal rip staging (0) when the first non-trim
 * division advances along y; cutting only (4) otherwise. Turn/heading types
 * are never claimed.
 */
export function ptxPatternTypeForSheet(trace: CutProgramTrace): PtxPatternType {
  const first = trace.divisions.find((division) => !division.trim);
  return first && first.axis === 'y'
    ? PTX_PATTERN_TYPE.longitudinalRip
    : PTX_PATTERN_TYPE.cuttingOnly;
}

/**
 * VECTORS geometry of a division: the cut line at the kerf-band edge away
 * from the kept region, spanning the parent region on the other axis,
 * converted to the top-left origin convention (yTop = boardWidth − yBottom).
 */
export function ptxDivisionVector(
  division: CutProgramTraceDivision,
  boardWidthMm: number,
  decimalPlaces: number,
): Pick<PtxVectorRecord, 'xStart' | 'yStart' | 'xEnd' | 'yEnd'> {
  const q = (value: number) => ptxQuantize(value, decimalPlaces);
  const parent = division.parentRect;
  const band = division.kerfBandRect;
  if (division.axis === 'x') {
    const x = division.leadingBand ? band.xMm : band.xMm + band.lengthMm;
    return {
      xStart: q(x),
      yStart: q(boardWidthMm - parent.yMm),
      xEnd: q(x),
      yEnd: q(boardWidthMm - (parent.yMm + parent.widthMm)),
    };
  }
  const y = division.leadingBand ? band.yMm : band.yMm + band.widthMm;
  return {
    xStart: q(parent.xMm),
    yStart: q(boardWidthMm - y),
    xEnd: q(parent.xMm + parent.lengthMm),
    yEnd: q(boardWidthMm - y),
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
 * also a piece (the main row already references the kept one).
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
    if (!producing) continue; // only child regions can be leaves
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

  const plans = planCutProgramDivisions(trace);
  const releases = planSheetReleases(trace, plans);

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
  if (cutPlan.sheets.length === 0) {
    throw new PtxCompilationError(
      'ptx_compile.no_sheets',
      'El plan no tiene tableros que compilar',
      { planId: cutPlan.id },
    );
  }

  const decimalPlaces = options.decimalPlaces;
  const q = (value: number) => ptxQuantize(value, decimalPlaces);
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
      const materialCode = ptxAscii(piece.materialCode ?? sheet.materialCode);
      partsReq.push({
        type: 'PARTS_REQ',
        jobIndex: 1,
        partIndex,
        code: ptxAscii(piece.partCode) || `PART-${partIndex}`,
        materialIndex: materials.get(materialCode)!.index,
        length: q(piece.lengthMm),
        width: q(piece.widthMm),
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
  const planTitleCode = ptxAscii(cutPlan.id);
  const records: PtxRecord[] = [
    {
      type: 'JOBS',
      jobIndex: 1,
      name: planTitleCode || 'GRANETE-JOB',
      description: 'GRANETE NON-PRODUCTION PTX CANDIDATE',
      orderDate: /^\d{4}-\d{2}-\d{2}/.test(cutPlan.generatedAt)
        ? cutPlan.generatedAt.slice(0, 10)
        : undefined,
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
      thickness: q(material.thicknessMm),
      bookQuantity: material.bookCount,
      kerfRip: q(kerfMm),
      kerfCrosscut: q(kerfMm),
      // TRIM_* and RULE1..4 deliberately empty: trim geometry is carried by
      // real CUTS rows and the per-class trim semantics stay a §9 ambiguity.
    });
  }

  records.push(...partsReq);

  const offcutRecords: PtxOffcutRecord[] = [];
  const vectorRecords: PtxVectorRecord[] = [];
  const sheetMappings: PtxCompiledSheetMapping[] = [];
  let offcutIndex = 1;

  compiledSheets.forEach(({ sheet, trace, plans, releases }, sheetPosition) => {
    const patternIndex = sheetPosition + 1;
    const materialIndex = materials.get(materialCodeOf(sheet))!.index;
    const patternType = ptxPatternTypeForSheet(trace);

    records.push({
      type: 'BOARDS',
      jobIndex: 1,
      boardIndex: patternIndex,
      code: `S${sheet.sheetIndex + 1}`,
      materialIndex,
      length: q(sheet.sheetLengthMm),
      width: q(sheet.sheetWidthMm),
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
    plans.forEach((plan, i) => {
      const division = plan.division;
      const cutIndex = i + 1;
      cutIndexByCutId.set(division.cutId, cutIndex);
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
        dimension: q(division.keptExtentMm),
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
        dimension: q(release.dimensionMm),
        repeatQuantity: 0,
        partReference: reference,
        producedQuantity: 1,
        comment: ptxAscii(release.regionId) || undefined,
      });
      if (release.kind === 'offcut') {
        const terminal = terminalByRegion.get(release.regionId)!;
        offcutIndexByRegionId.set(release.regionId, offcutIndex);
        offcutRecords.push({
          type: 'OFFCUTS',
          jobIndex: 1,
          offcutIndex,
          code: ptxAscii(release.regionId) || `OFFCUT-${offcutIndex}`,
          materialIndex,
          length: q(terminal.rect.lengthMm),
          width: q(terminal.rect.widthMm),
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
      releaseCutIndexByRegionId,
      offcutIndexByRegionId,
    });
  });

  records.push(...offcutRecords, ...vectorRecords);

  const document: PtxDocument = {
    header: {
      type: 'HEADER',
      version: options.headerVersion,
      title: `GRANETE-NONPRODUCTION-${planTitleCode || 'CANDIDATE'}`,
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
      sheets: sheetMappings,
    },
  };
}
