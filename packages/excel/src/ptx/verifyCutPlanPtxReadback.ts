/**
 * Semantic readback verification: parsed PTX bytes vs the original CutPlan
 * (#650 PR 5, R1-hardened).
 *
 * This is the closing step of the compiler chain required by the issue:
 *   optimizeCutPlan → validated cutProgram → compileCutPlanToPtxDocument
 *   → validatePtxDocument → serializePtxDocumentBytes → parsePtxDocumentBytes
 *   → verifyCutPlanPtxReadback === [].
 *
 * Independence boundaries, stated honestly and enforced by a source guard
 * test: this module imports ONLY types from compileCutPlan.ts — never the
 * compiler's productive helpers (FUNCTION staging, structural preorder,
 * PATTERN TYPE, releases, vector geometry, sanitizers). Every expected
 * invariant is re-derived here from the CutProgramTrace with deliberately
 * duplicated rules: if the writer classifies a phase wrong, this checker
 * computes the expectation independently and the mutation surfaces. Sharing
 * the derivation would let an industrial bug in the writer verify itself.
 *
 * Also independent at the format level (#656's parser vs serializer) and at
 * the program level (executeCutProgram re-runs each sheet; the compiler is
 * never re-run to compute expectations). The inverse mapping (durable id ↔
 * local index) is the audit bridge; full from-scratch tree inference from
 * bytes alone is NOT possible in this subset (staging class and phase-3 recut
 * axis are underdetermined without the mapping — a documented limitation;
 * VECTORS carry the absolute positions when emitted).
 *
 * Tolerance absorbs IEEE-754 arithmetic noise only (relative 1e-9) — never a
 * manufacturing or visual-grouping tolerance.
 */

import { executeCutProgram } from '@granete/domain';
import type { CutPlan, CutPlanSheet, CutProgramTrace, CutProgramTraceDivision } from '@granete/domain';
import type {
  PtxBoardRecord,
  PtxCutRecord,
  PtxDocument,
  PtxJobRecord,
  PtxMaterialRecord,
  PtxOffcutRecord,
  PtxPartsReqRecord,
  PtxPatternRecord,
  PtxVectorRecord,
} from './records';
import { PTX_UNITS } from './records';
import { validatePtxDocument } from './validate';
import type {
  CompileCutPlanToPtxOptions,
  PtxCompilationMapping,
  PtxCompiledSheetMapping,
} from './compileCutPlan';

export interface CutPlanPtxReadbackIssue {
  readonly code: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Independent derivations (duplicated from the documented candidate
// contract ON PURPOSE — cross-check, not shared productive logic)
// ---------------------------------------------------------------------------

/** Auxiliary-text filter for display cells (comments, JOBS name). Never identity. */
function auxAscii(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) out += ch;
  }
  return out;
}

/** Independently derived expectation for one division (staging model). */
interface LocalDivisionExpectation {
  readonly division: CutProgramTraceDivision;
  readonly phase: number;
  readonly functionCode: number;
  readonly keptPieceRef?: string;
  readonly restPieceRef?: string;
}

/**
 * Staging generations, re-derived: board = 1; dividing a generation-g region
 * is a phase-g pass; the kept child moves to g+1, the rest child stays at g.
 * FUNCTION: phases ≤ 2 by axis role (y→1 rip, x→2 cross), phase 3 → 3.
 * Returns null when the trace needs a phase beyond the supported subset
 * (the compiler must have rejected such a plan already).
 */
function deriveDivisionExpectations(trace: CutProgramTrace): readonly LocalDivisionExpectation[] | null {
  const generation = new Map<string, number>([[trace.boardRegionId, 1]]);
  const pieceByRegion = new Map<string, string>();
  for (const terminal of trace.terminals) {
    if (terminal.kind === 'piece' && terminal.pieceRef) {
      pieceByRegion.set(terminal.regionId, terminal.pieceRef);
    }
  }
  const expectations: LocalDivisionExpectation[] = [];
  for (const division of trace.divisions) {
    const parentGeneration = generation.get(division.parentRegionId) ?? 1;
    const phase = parentGeneration;
    if (phase > 3) return null;
    generation.set(division.keptRegionId, parentGeneration + 1);
    if (division.restRegionId) {
      generation.set(division.restRegionId, phase);
    }
    expectations.push({
      division,
      phase,
      functionCode: phase <= 2 ? (division.axis === 'y' ? 1 : 2) : 3,
      keptPieceRef: pieceByRegion.get(division.keptRegionId),
      restPieceRef: division.restRegionId ? pieceByRegion.get(division.restRegionId) : undefined,
    });
  }
  return expectations;
}

/**
 * Structural preorder, re-derived: kept subtree first, then the rest
 * subtree, from the board root. CUT_INDEX must follow this order while
 * SEQUENCE carries execution order — the two coincide on simple fixtures
 * but are checked independently (dossier fragment 03). Null when the tree
 * is not reachable from the board.
 */
function deriveStructuralPreorder(trace: CutProgramTrace): readonly CutProgramTraceDivision[] | null {
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
  return out.length === trace.divisions.length ? out : null;
}

/** PATTERNS.TYPE, re-derived: 0 (longitudinal rip) when the first division advances along y, else 4. */
function derivePatternType(trace: CutProgramTrace): number {
  const first = trace.divisions[0];
  return first && first.axis === 'y' ? 0 : 4;
}

/** Independently derived release-row expectation for one leaf. */
interface LocalReleaseExpectation {
  readonly regionId: string;
  readonly kind: 'offcut' | 'part';
  readonly pieceRef?: string;
  readonly dimensionMm: number;
  readonly functionCode: number;
}

/**
 * Release rows, re-derived: remnant leaves (attribution via Xn, fragment
 * 04) and a rest-side piece of a double-piece division get a QTY_RPT=0
 * row whose DIMENSION is the leaf extent along its producing division's
 * axis. Exact-fit terminals never get a fictitious row.
 */
function deriveReleases(
  trace: CutProgramTrace,
  expectations: readonly LocalDivisionExpectation[],
): readonly LocalReleaseExpectation[] {
  const expectationByLeafRegion = new Map<string, LocalDivisionExpectation>();
  for (const expectation of expectations) {
    expectationByLeafRegion.set(expectation.division.keptRegionId, expectation);
    if (expectation.division.restRegionId) {
      expectationByLeafRegion.set(expectation.division.restRegionId, expectation);
    }
  }
  const releases: LocalReleaseExpectation[] = [];
  for (const terminal of trace.terminals) {
    const producing = expectationByLeafRegion.get(terminal.regionId);
    if (!producing) continue;
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

/**
 * VECTORS line, re-derived: the cut line at the kerf-band edge away from the
 * kept region, spanning the parent on the other axis, converted to the
 * top-left origin convention (yTop = boardWidth − yBottom).
 */
function deriveVectorLine(
  division: CutProgramTraceDivision,
  boardWidthMm: number,
): { readonly xStart: number; readonly yStart: number; readonly xEnd: number; readonly yEnd: number } {
  const parent = division.parentRect;
  const band = division.kerfBandRect;
  if (division.axis === 'x') {
    const x = division.leadingBand ? band.xMm : band.xMm + band.lengthMm;
    return {
      xStart: x,
      yStart: boardWidthMm - parent.yMm,
      xEnd: x,
      yEnd: boardWidthMm - (parent.yMm + parent.widthMm),
    };
  }
  const y = division.leadingBand ? band.yMm : band.yMm + band.widthMm;
  return {
    xStart: parent.xMm,
    yStart: boardWidthMm - y,
    xEnd: parent.xMm + parent.lengthMm,
    yEnd: boardWidthMm - y,
  };
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

export function verifyCutPlanPtxReadback(
  parsed: PtxDocument,
  cutPlan: CutPlan,
  mapping: PtxCompilationMapping,
  options: CompileCutPlanToPtxOptions,
): readonly CutPlanPtxReadbackIssue[] {
  const issues: CutPlanPtxReadbackIssue[] = [];
  const push = (code: string, message: string): void => {
    issues.push({ code, message });
  };

  // 1. Format/relational validation of the parsed bytes.
  for (const issue of validatePtxDocument(parsed)) {
    push(`ptx_invalid.${issue.code}`, issue.message);
  }
  if (issues.length > 0) return issues;

  const close = (a: number, b: number): boolean =>
    Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const snap = (value: number): number => {
    const factor = 10 ** options.decimalPlaces;
    return Math.round(value * factor) / factor;
  };
  const expectedComment = (value: string): string | undefined => auxAscii(value) || undefined;

  // 2. Header carries the caller's declared candidate options.
  if (parsed.header.units !== PTX_UNITS.metric) {
    push('header.units', `UNITS=${parsed.header.units} no es métrico (el dominio emite mm)`);
  }
  if (parsed.header.version !== options.headerVersion) {
    push('header.version', `VERSION=${parsed.header.version} ≠ ${options.headerVersion}`);
  }
  if (parsed.header.origin !== options.headerOrigin) {
    push('header.origin', `ORIGIN=${parsed.header.origin} ≠ ${options.headerOrigin}`);
  }
  if (parsed.header.trimType !== options.trimType) {
    push('header.trim_type', `TRIM_TYPE=${parsed.header.trimType} ≠ ${options.trimType}`);
  }
  if (parsed.header.title !== options.title) {
    push('header.title', `TITLE='${parsed.header.title}' ≠ '${options.title}'`);
  }

  // 3. Table views in file order.
  const jobRows = parsed.records.filter((r): r is PtxJobRecord => r.type === 'JOBS');
  const materialRows = parsed.records.filter((r): r is PtxMaterialRecord => r.type === 'MATERIALS');
  const partsRows = parsed.records.filter((r): r is PtxPartsReqRecord => r.type === 'PARTS_REQ');
  const boardRows = parsed.records.filter((r): r is PtxBoardRecord => r.type === 'BOARDS');
  const patternRows = parsed.records.filter((r): r is PtxPatternRecord => r.type === 'PATTERNS');
  const offcutRows = parsed.records.filter((r): r is PtxOffcutRecord => r.type === 'OFFCUTS');
  const vectorRows = parsed.records.filter((r): r is PtxVectorRecord => r.type === 'VECTORS');
  const cutRows = parsed.records.filter((r): r is PtxCutRecord => r.type === 'CUTS');
  const cutsByPattern = new Map<number, PtxCutRecord[]>();
  for (const row of cutRows) {
    const list = cutsByPattern.get(row.patternIndex) ?? [];
    list.push(row);
    cutsByPattern.set(row.patternIndex, list);
  }

  if (jobRows.length !== 1 || jobRows[0]!.jobIndex !== mapping.jobIndex) {
    push('jobs.count', `se esperaba un único JOBS con índice ${mapping.jobIndex}`);
  } else {
    // JOBS.NAME is auxiliary display text (stable projectId, no clock).
    const expectedName = auxAscii(cutPlan.projectId) || 'GRANETE-JOB';
    if (jobRows[0]!.name !== expectedName) {
      push('jobs.name', `JOBS NAME='${jobRows[0]!.name}' ≠ '${expectedName}' (projectId estable, sin reloj)`);
    }
  }

  // 4. Materials: kerf must equal the plan kerf, thickness the industrial
  //    thickness (recomputed from the plan — raw codes, since the compiler
  //    rejects non-ASCII identity), and BOOK the documented conservative
  //    policy (1: "counts boards" is all S03 pp.134–135 establishes).
  const expectedThickness = new Map<string, number>();
  for (const sheet of cutPlan.sheets) {
    expectedThickness.set(sheet.materialCode, sheet.thicknessMm ?? Number.NaN);
  }
  for (const sheet of cutPlan.sheets) {
    for (const piece of sheet.pieces) {
      const code = piece.materialCode ?? sheet.materialCode;
      if (!expectedThickness.has(code)) {
        expectedThickness.set(code, piece.thicknessMm ?? sheet.thicknessMm ?? Number.NaN);
      }
    }
  }
  if (materialRows.length !== mapping.materialIndexByCode.size) {
    push('materials.count', `MATERIALS=${materialRows.length}, esperados ${mapping.materialIndexByCode.size}`);
  }
  for (const row of materialRows) {
    const expectedIndex = mapping.materialIndexByCode.get(row.code);
    if (expectedIndex === undefined) {
      push('materials.unknown', `MATERIALS code='${row.code}' no está en el mapeo`);
      continue;
    }
    if (row.materialIndex !== expectedIndex) {
      push('materials.index', `MATERIALS '${row.code}' MAT_INDEX=${row.materialIndex} ≠ ${expectedIndex}`);
    }
    if (
      !close(row.kerfRip, snap(cutPlan.config.sawKerfMm)) ||
      !close(row.kerfCrosscut, snap(cutPlan.config.sawKerfMm))
    ) {
      push('materials.kerf', `MATERIALS '${row.code}' kerf ${row.kerfRip}/${row.kerfCrosscut} ≠ kerf del plan ${snap(cutPlan.config.sawKerfMm)}`);
    }
    const thickness = expectedThickness.get(row.code);
    if (thickness === undefined || Number.isNaN(thickness)) {
      push('materials.thickness_missing', `MATERIALS '${row.code}' sin espesor esperado en el plan`);
    } else if (!close(row.thickness, snap(thickness))) {
      push('materials.thickness', `MATERIALS '${row.code}' THICK=${row.thickness} ≠ ${snap(thickness)}`);
    }
    if (row.bookQuantity !== 1) {
      push('materials.book', `MATERIALS '${row.code}' BOOK=${row.bookQuantity} ≠ 1 (política documentada: cuenta tableros, un tablero por ciclo; el total del job NO está establecido en S03)`);
    }
  }

  // 5. PARTS_REQ: one row per placed piece, in sheet/piece order. Codes are
  //    raw identity (non-ASCII would have failed compilation); an empty
  //    partCode gets the explicit technical code PART-<n>.
  const expectedPieces = cutPlan.sheets.flatMap((sheet) =>
    sheet.pieces.map((piece) => ({ sheet, piece })),
  );
  if (partsRows.length !== expectedPieces.length) {
    push('parts.count', `PARTS_REQ=${partsRows.length}, esperadas ${expectedPieces.length} piezas colocadas`);
  }
  expectedPieces.forEach(({ sheet, piece }, position) => {
    const row = partsRows[position];
    if (!row) return;
    const expectedPartIndex = mapping.partIndexByPieceRef.get(piece.id);
    if (expectedPartIndex === undefined) {
      push('parts.unmapped', `pieza ${piece.id} sin PART_INDEX en el mapeo`);
      return;
    }
    if (row.partIndex !== expectedPartIndex) {
      push('parts.order', `PARTS_REQ fila ${position + 1} PART_INDEX=${row.partIndex} ≠ ${expectedPartIndex} (pieza ${piece.id})`);
    }
    const expectedCode = piece.partCode === '' ? `PART-${expectedPartIndex}` : piece.partCode;
    if (row.code !== expectedCode) {
      push('parts.code', `PARTS_REQ ${expectedPartIndex} CODE='${row.code}' ≠ '${expectedCode}'`);
    }
    if (!close(row.length, snap(piece.lengthMm)) || !close(row.width, snap(piece.widthMm))) {
      push('parts.dims', `PARTS_REQ ${expectedPartIndex} ${row.length}×${row.width} ≠ medidas resueltas ${snap(piece.lengthMm)}×${snap(piece.widthMm)} (pieza ${piece.id})`);
    }
    const expectedGrain = piece.grain === 0 ? 0 : 1;
    if (row.grain !== expectedGrain) {
      push('parts.grain', `PARTS_REQ ${expectedPartIndex} GRAIN=${row.grain} ≠ ${expectedGrain}`);
    }
    if (row.requiredQuantity !== 1 || (row.producedQuantity ?? 0) !== 1) {
      push('parts.qty', `PARTS_REQ ${expectedPartIndex} QTY_REQ/QTY_PROD=${row.requiredQuantity}/${row.producedQuantity} ≠ 1/1 (sin agregación)`);
    }
    const materialCode = piece.materialCode ?? sheet.materialCode;
    const expectedMaterialIndex = mapping.materialIndexByCode.get(materialCode);
    if (expectedMaterialIndex === undefined || row.materialIndex !== expectedMaterialIndex) {
      push('parts.material', `PARTS_REQ ${expectedPartIndex} MAT_INDEX=${row.materialIndex} ≠ material '${materialCode}'`);
    }
  });

  // 6. BOARDS / PATTERNS / CUTS / OFFCUTS / VECTORS per sheet.
  if (boardRows.length !== cutPlan.sheets.length) {
    push('boards.count', `BOARDS=${boardRows.length} ≠ hojas ${cutPlan.sheets.length}`);
  }
  if (patternRows.length !== cutPlan.sheets.length) {
    push('patterns.count', `PATTERNS=${patternRows.length} ≠ hojas ${cutPlan.sheets.length}`);
  }
  cutPlan.sheets.forEach((sheet, position) => {
    if (
      position < mapping.sheetIndexByPatternIndex.length &&
      mapping.sheetIndexByPatternIndex[position] !== sheet.sheetIndex
    ) {
      push('patterns.sheet_map', `PTN_INDEX ${position + 1} mapea hoja ${mapping.sheetIndexByPatternIndex[position]} ≠ ${sheet.sheetIndex}`);
    }
  });

  const globalOffcutIndexByRegion = new Map<string, number>();
  let runningOffcutIndex = 1;
  const sheetTraces = new Map<number, CutProgramTrace>();
  for (const sheet of cutPlan.sheets) {
    if (!sheet.cutProgram) {
      push('sheet.program_missing', `la hoja ${sheet.sheetIndex} no trae programa de cortes`);
      continue;
    }
    try {
      const trace = executeCutProgram(sheet.cutProgram);
      sheetTraces.set(sheet.sheetIndex, trace);
      for (const terminal of trace.terminals) {
        if (terminal.kind === 'remnant') {
          globalOffcutIndexByRegion.set(terminal.regionId, runningOffcutIndex++);
        }
      }
    } catch {
      push('sheet.program_invalid', `la hoja ${sheet.sheetIndex} no ejecuta un programa válido`);
    }
  }

  cutPlan.sheets.forEach((sheet, sheetPosition) => {
    const trace = sheetTraces.get(sheet.sheetIndex);
    const sheetMapping = mapping.sheets.find((s) => s.sheetIndex === sheet.sheetIndex);
    if (!trace || !sheetMapping) {
      push('sheet.unmapped', `hoja ${sheet.sheetIndex} sin traza ejecutada o sin mapeo`);
      return;
    }
    verifySheetReadback({
      sheet,
      trace,
      sheetMapping,
      parsed,
      boardRow: boardRows[sheetPosition],
      patternRow: patternRows[sheetPosition],
      cutsByPattern,
      offcutRows,
      vectorRows,
      globalOffcutIndexByRegion,
      mapping,
      options,
      push,
      close,
      snap,
      expectedComment,
    });
  });

  // 7. Family-level completeness: no extra records beyond the contract.
  const totalDivisions = [...sheetTraces.values()].reduce(
    (sum, trace) => sum + trace.divisions.length,
    0,
  );
  let totalReleases = 0;
  for (const trace of sheetTraces.values()) {
    const expectations = deriveDivisionExpectations(trace);
    if (expectations) totalReleases += deriveReleases(trace, expectations).length;
  }
  if (cutRows.length !== totalDivisions + totalReleases) {
    push('cuts.count', `CUTS=${cutRows.length} ≠ divisiones ${totalDivisions} + liberaciones ${totalReleases}`);
  }
  if (offcutRows.length !== globalOffcutIndexByRegion.size) {
    push('offcuts.count', `OFFCUTS=${offcutRows.length} ≠ retazos ${globalOffcutIndexByRegion.size}`);
  }
  if (options.includeVectors === true) {
    if (vectorRows.length !== totalDivisions) {
      push('vectors.count', `VECTORS=${vectorRows.length} ≠ divisiones ${totalDivisions}`);
    }
  } else if (vectorRows.length > 0) {
    push('vectors.unexpected', `el documento se compiló sin vectores pero trae ${vectorRows.length}`);
  }

  return issues;
}

interface SheetVerificationContext {
  readonly sheet: CutPlanSheet;
  readonly trace: CutProgramTrace;
  readonly sheetMapping: PtxCompiledSheetMapping;
  readonly parsed: PtxDocument;
  readonly boardRow: PtxBoardRecord | undefined;
  readonly patternRow: PtxPatternRecord | undefined;
  readonly cutsByPattern: ReadonlyMap<number, readonly PtxCutRecord[]>;
  readonly offcutRows: readonly PtxOffcutRecord[];
  readonly vectorRows: readonly PtxVectorRecord[];
  readonly globalOffcutIndexByRegion: ReadonlyMap<string, number>;
  readonly mapping: PtxCompilationMapping;
  readonly options: CompileCutPlanToPtxOptions;
  readonly push: (code: string, message: string) => void;
  readonly close: (a: number, b: number) => boolean;
  readonly snap: (value: number) => number;
  readonly expectedComment: (value: string) => string | undefined;
}

function verifySheetReadback(ctx: SheetVerificationContext): void {
  const {
    sheet,
    trace,
    sheetMapping,
    boardRow,
    patternRow,
    cutsByPattern,
    offcutRows,
    vectorRows,
    globalOffcutIndexByRegion,
    mapping,
    options,
    push,
    close,
    snap,
    expectedComment,
  } = ctx;

  const expectations = deriveDivisionExpectations(trace);
  const preorder = deriveStructuralPreorder(trace);
  if (!expectations || !preorder) {
    push('sheet.phase_unsupported', `hoja ${sheet.sheetIndex}: estructura no representable en el subconjunto`);
    return;
  }
  const expectationByCutId = new Map(expectations.map((e) => [e.division.cutId, e]));
  const releases = deriveReleases(trace, expectations);

  if (!boardRow) {
    push('boards.missing', `hoja ${sheet.sheetIndex} sin fila BOARDS`);
  } else {
    if (boardRow.boardIndex !== sheetMapping.boardIndex) {
      push('boards.index', `BOARDS BRD_INDEX=${boardRow.boardIndex} ≠ ${sheetMapping.boardIndex}`);
    }
    if (
      !close(boardRow.length, snap(sheet.sheetLengthMm)) ||
      !close(boardRow.width, snap(sheet.sheetWidthMm))
    ) {
      push('boards.dims', `BOARDS ${boardRow.length}×${boardRow.width} ≠ tablero ${snap(sheet.sheetLengthMm)}×${snap(sheet.sheetWidthMm)} (hoja ${sheet.sheetIndex})`);
    }
    const sheetMaterialIndex = mapping.materialIndexByCode.get(sheet.materialCode);
    if (sheetMaterialIndex === undefined || boardRow.materialIndex !== sheetMaterialIndex) {
      push('boards.material', `BOARDS MAT_INDEX=${boardRow.materialIndex} ≠ material '${sheet.materialCode}'`);
    }
  }

  if (!patternRow) {
    push('patterns.missing', `hoja ${sheet.sheetIndex} sin fila PATTERNS`);
  } else {
    const expectedType = derivePatternType(trace);
    if (patternRow.patternIndex !== sheetMapping.patternIndex) {
      push('patterns.index', `PATTERNS PTN_INDEX=${patternRow.patternIndex} ≠ ${sheetMapping.patternIndex}`);
    }
    if (patternRow.patternType !== expectedType || patternRow.patternType !== sheetMapping.patternType) {
      push('patterns.type', `PATTERNS TYPE=${patternRow.patternType} ≠ política documentada (${expectedType})`);
    }
    if (patternRow.boardIndex !== sheetMapping.boardIndex) {
      push('patterns.board', `PATTERNS BRD_INDEX=${patternRow.boardIndex} ≠ ${sheetMapping.boardIndex}`);
    }
    if (
      patternRow.runQuantity !== 1 ||
      patternRow.cyclesQuantity !== 1 ||
      patternRow.maxBook !== 1
    ) {
      push('patterns.compression', `PATTERNS QTY_RUN/QTY_CYCLES/MAX_BOOK=${patternRow.runQuantity}/${patternRow.cyclesQuantity}/${patternRow.maxBook} ≠ 1/1/1 (un tablero por ciclo, sin compresión)`);
    }
  }

  // --- CUTS rows: divisions in structural preorder, then release rows -----
  const rows = cutsByPattern.get(sheetMapping.patternIndex) ?? [];
  if (rows.length !== preorder.length + releases.length) {
    push('cuts.sheet_count', `patrón ${sheetMapping.patternIndex}: CUTS=${rows.length} ≠ ${preorder.length} divisiones + ${releases.length} liberaciones`);
  }

  // Byte-derived extent reconstruction: the board extents come from BOARDS
  // and each row derives its children extents (dimension, parent, kerf);
  // results are compared against the independently executed trace.
  const extentAlongAxis = new Map<string, number>();
  const recordExtent = (regionId: string, axis: 'x' | 'y', extent: number): void => {
    extentAlongAxis.set(`${regionId}:${axis}`, extent);
  };
  const boardLengthBytes = boardRow ? boardRow.length : sheet.sheetLengthMm;
  const boardWidthBytes = boardRow ? boardRow.width : sheet.sheetWidthMm;
  recordExtent(trace.boardRegionId, 'x', boardLengthBytes);
  recordExtent(trace.boardRegionId, 'y', boardWidthBytes);
  const kerfBytes = materialKerfBytes(ctx);

  preorder.forEach((division, position) => {
    const row = rows[position];
    const label = `CUTS patrón ${sheetMapping.patternIndex} fila ${position + 1} (cutId ${division.cutId})`;
    if (!row) return;
    const expectation = expectationByCutId.get(division.cutId)!;
    const expectedCutIndex = sheetMapping.cutIndexByCutId.get(division.cutId);
    if (expectedCutIndex === undefined || row.cutIndex !== expectedCutIndex || expectedCutIndex !== position + 1) {
      push('cuts.index', `${label}: CUT_INDEX=${row.cutIndex} ≠ ${expectedCutIndex ?? '?'} (posición preorder ${position + 1})`);
    }
    // SEQUENCE is checked against the EXECUTION order — derived
    // independently from the row position (fragment 03).
    if (row.sequence !== division.order) {
      push('cuts.sequence', `${label}: SEQUENCE=${row.sequence} ≠ orden de ejecución ${division.order}`);
    }
    if (row.functionCode !== expectation.functionCode) {
      push('cuts.function', `${label}: FUNCTION=${row.functionCode} ≠ política documentada (${expectation.functionCode}, fase ${expectation.phase}, eje ${division.axis})`);
    }
    if (!close(row.dimension, snap(division.keptExtentMm))) {
      push('cuts.dimension', `${label}: DIMENSION=${row.dimension} ≠ medida relativa conservada ${snap(division.keptExtentMm)}`);
    }
    if (row.repeatQuantity !== 1) {
      push('cuts.repeat', `${label}: QTY_RPT=${row.repeatQuantity} ≠ 1 (sin compresión)`);
    }
    const expectedReference =
      expectation.keptPieceRef !== undefined
        ? { kind: 'part' as const, partIndex: mapping.partIndexByPieceRef.get(expectation.keptPieceRef) ?? -1 }
        : { kind: 'none' as const };
    if (
      row.partReference.kind !== expectedReference.kind ||
      (expectedReference.kind === 'part' && row.partReference.kind === 'part' && row.partReference.partIndex !== expectedReference.partIndex)
    ) {
      push('cuts.part_ref', `${label}: PART_INDEX no corresponde a la hoja de pieza esperada (${expectation.keptPieceRef ?? 'sin pieza'})`);
    }
    const expectedProduced = expectation.keptPieceRef !== undefined ? 1 : 0;
    if (row.producedQuantity !== expectedProduced) {
      push('cuts.produced', `${label}: QTY_PARTS=${row.producedQuantity} ≠ ${expectedProduced}`);
    }
    if (row.comment !== expectedComment(division.cutId)) {
      push('cuts.comment', `${label}: COMMENT='${row.comment}' ≠ '${expectedComment(division.cutId) ?? ''}'`);
    }

    // Extent derivation from bytes: parent extent comes from previously
    // derived rows (or the BOARDS record); kerf comes from MATERIALS.
    const parentExtent =
      extentAlongAxis.get(`${division.parentRegionId}:${division.axis}`) ?? Number.NaN;
    const derivedGap = parentExtent - row.dimension - kerfBytes;
    const traceParentExtent =
      division.axis === 'x' ? division.parentRect.lengthMm : division.parentRect.widthMm;
    if (!close(parentExtent, snap(traceParentExtent))) {
      push('cuts.parent_extent', `${label}: extensión del padre derivada de bytes (${parentExtent}) ≠ ejecutada (${snap(traceParentExtent)})`);
    }
    recordExtent(division.keptRegionId, division.axis, row.dimension);
    if (division.restRect) {
      const traceRestExtent =
        division.axis === 'x' ? division.restRect.lengthMm : division.restRect.widthMm;
      if (derivedGap <= 0 || !close(derivedGap, snap(traceRestExtent))) {
        push('cuts.rest_extent', `${label}: resto derivado de bytes (${derivedGap}) ≠ ejecutado (${snap(traceRestExtent)})`);
      }
      recordExtent(division.restRegionId!, division.axis, derivedGap);
    } else if (derivedGap > kerfBytes + 1e-9 * Math.max(1, kerfBytes)) {
      push('cuts.rest_missing', `${label}: bytes derivan un resto sólido de ${derivedGap - kerfBytes} mm que el programa no declara`);
    }
    // The other axis is inherited from the parent (guillotine invariance);
    // recorded so deeper rows can read it.
    const otherAxis = division.axis === 'x' ? 'y' : 'x';
    const parentOther = extentAlongAxis.get(`${division.parentRegionId}:${otherAxis}`) ?? Number.NaN;
    recordExtent(division.keptRegionId, otherAxis, parentOther);
    if (division.restRegionId) {
      recordExtent(division.restRegionId, otherAxis, parentOther);
    }
  });

  releases.forEach((release, position) => {
    const row = rows[preorder.length + position];
    const label = `liberación '${release.regionId}' (patrón ${sheetMapping.patternIndex})`;
    if (!row) return;
    if (row.sequence !== 0 || row.repeatQuantity !== 0) {
      push('release.no_pass', `${label}: SEQUENCE=${row.sequence}/QTY_RPT=${row.repeatQuantity} ≠ 0/0 (una liberación no es una pasada)`);
    }
    if (row.producedQuantity !== 1) {
      push('release.produced', `${label}: QTY_PARTS=${row.producedQuantity} ≠ 1`);
    }
    if (!close(row.dimension, snap(release.dimensionMm))) {
      push('release.dimension', `${label}: DIMENSION=${row.dimension} ≠ ${snap(release.dimensionMm)}`);
    }
    if (row.functionCode !== release.functionCode) {
      push('release.function', `${label}: FUNCTION=${row.functionCode} ≠ ${release.functionCode}`);
    }
    if (row.comment !== expectedComment(release.regionId)) {
      push('release.comment', `${label}: COMMENT='${row.comment}' ≠ '${expectedComment(release.regionId) ?? ''}'`);
    }
    const expectedCutIndex = sheetMapping.releaseCutIndexByRegionId.get(release.regionId);
    if (expectedCutIndex === undefined || row.cutIndex !== expectedCutIndex) {
      push('release.index', `${label}: CUT_INDEX=${row.cutIndex} ≠ ${expectedCutIndex ?? '?'}`);
    }
    if (release.kind === 'offcut') {
      const expectedOffcutIndex = globalOffcutIndexByRegion.get(release.regionId);
      if (
        row.partReference.kind !== 'offcut' ||
        expectedOffcutIndex === undefined ||
        row.partReference.offcutIndex !== expectedOffcutIndex
      ) {
        push('release.offcut_ref', `${label}: PART_INDEX no referencia X${expectedOffcutIndex ?? '?'}`);
      }
    } else if (
      row.partReference.kind !== 'part' ||
      row.partReference.partIndex !== (mapping.partIndexByPieceRef.get(release.pieceRef!) ?? -1)
    ) {
      push('release.part_ref', `${label}: PART_INDEX no referencia la pieza ${release.pieceRef}`);
    }
  });

  // --- OFFCUTS rows for this sheet's remnant leaves ----------------------
  const remnantTerminals = trace.terminals.filter((t) => t.kind === 'remnant');
  for (const terminal of remnantTerminals) {
    const expectedIndex = globalOffcutIndexByRegion.get(terminal.regionId);
    const row = offcutRows.find((r) => expectedIndex !== undefined && r.offcutIndex === expectedIndex);
    if (!row) {
      push('offcuts.missing', `retazo '${terminal.regionId}' (X${expectedIndex ?? '?'}) sin fila OFFCUTS`);
      continue;
    }
    if (
      !close(row.length, snap(terminal.rect.lengthMm)) ||
      !close(row.width, snap(terminal.rect.widthMm))
    ) {
      push('offcuts.dims', `OFFCUTS X${expectedIndex} ${row.length}×${row.width} ≠ hoja ejecutada ${snap(terminal.rect.lengthMm)}×${snap(terminal.rect.widthMm)}`);
    }
    const sheetMaterialIndex = mapping.materialIndexByCode.get(sheet.materialCode);
    if (sheetMaterialIndex === undefined || row.materialIndex !== sheetMaterialIndex) {
      push('offcuts.material', `OFFCUTS X${expectedIndex} MAT_INDEX=${row.materialIndex} ≠ material de la hoja`);
    }
  }

  // --- VECTORS: absolute cut lines, top-left origin ----------------------
  if (options.includeVectors === true) {
    preorder.forEach((division, position) => {
      const matching = vectorRows.filter(
        (v) => v.patternIndex === sheetMapping.patternIndex && v.cutIndex === position + 1,
      );
      const label = `VECTORS patrón ${sheetMapping.patternIndex} corte ${position + 1} (cutId ${division.cutId})`;
      if (matching.length !== 1) {
        push('vectors.count', `${label}: ${matching.length} filas, se esperaba 1`);
        return;
      }
      const expected = deriveVectorLine(division, trace.boardRect.widthMm);
      const row = matching[0]!;
      if (
        !close(row.xStart, expected.xStart) ||
        !close(row.yStart, expected.yStart) ||
        !close(row.xEnd, expected.xEnd) ||
        !close(row.yEnd, expected.yEnd)
      ) {
        push(
          'vectors.line',
          `${label}: (${row.xStart},${row.yStart})-(${row.xEnd},${row.yEnd}) ≠ línea esperada (${expected.xStart},${expected.yStart})-(${expected.xEnd},${expected.yEnd})`,
        );
      }
    });
  }
}

function materialKerfBytes(ctx: SheetVerificationContext): number {
  // The bytes declare ONE uniform kerf per material (equality with the plan
  // kerf is checked in step 4); the sheet material's kerf is the derivation
  // input. Falls back to the executed trace's first kerf when the row is
  // missing — the corresponding materials issue has already been reported.
  const index = ctx.mapping.materialIndexByCode.get(ctx.sheet.materialCode);
  for (const record of ctx.parsed.records) {
    if (record.type === 'MATERIALS' && (index === undefined || record.materialIndex === index)) {
      return record.kerfRip;
    }
  }
  return ctx.trace.divisions[0]?.kerfMm ?? 0;
}
