/**
 * Semantic readback verification: parsed PTX bytes vs the original CutPlan
 * (#650 PR 5).
 *
 * This is the closing step of the compiler chain required by the issue:
 *   optimizeCutPlan → validated cutProgram → compileCutPlanToPtxDocument
 *   → validatePtxDocument → serializePtxDocumentBytes → parsePtxDocumentBytes
 *   → verifyCutPlanPtxReadback === [].
 *
 * Independence boundaries, stated honestly:
 * - Format-level readback independence is #656's (parser vs serializer).
 * - Here the program is re-executed with the DOMAIN core (executeCutProgram)
 *   and every expected value is recomputed from that trace and from the plan,
 *   never from the compiler's emitted records.
 * - The staging contract (phase/FUNCTION policy, release rows, vector lines,
 *   TYPE policy) is shared with the compiler through the pure helpers in
 *   compileCutPlan.ts: that contract IS the documented meaning of the bytes,
 *   and comparing bytes against it is the point of this check.
 * - The inverse mapping (durable id ↔ local index) is the audit bridge the
 *   plan requires. Full from-scratch tree inference from bytes alone is NOT
 *   possible in this subset: the staging class of a row and the axis of a
 *   phase-3 recut are underdetermined without it (a documented limitation;
 *   VECTORS carry the absolute positions when emitted).
 *
 * Returned issues are empty exactly when the parsed document is semantically
 * equivalent to the original program under the documented contract.
 * Tolerance is the declared quantization resolution only (2 ulp of
 * decimalPlaces) — never a manufacturing or visual-grouping tolerance.
 */

import { executeCutProgram } from '@granete/domain';
import type { CutPlan, CutPlanSheet, CutProgramTrace } from '@granete/domain';
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
import {
  ptxAscii,
  ptxDivisionVector,
  ptxPatternTypeForSheet,
  ptxQuantize,
  planCutProgramDivisions,
  planSheetReleases,
  type CompileCutPlanToPtxOptions,
  type PtxCompilationMapping,
  type PtxCompiledSheetMapping,
} from './compileCutPlan';

export interface CutPlanPtxReadbackIssue {
  readonly code: string;
  readonly message: string;
}

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

  const toleranceMm = 2 * 10 ** -options.decimalPlaces;
  const close = (a: number, b: number): boolean =>
    Math.abs(a - b) <= toleranceMm + 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const q = (value: number) => ptxQuantize(value, options.decimalPlaces);
  const expectedComment = (value: string): string | undefined => ptxAscii(value) || undefined;

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
  }

  // 4. Materials: kerf must equal the plan kerf and thickness the industrial
  //    thickness (recomputed from the plan, not from the compiler).
  const expectedThickness = new Map<string, number>();
  const expectedBook = new Map<string, number>();
  for (const sheet of cutPlan.sheets) {
    const code = ptxAscii(sheet.materialCode);
    expectedThickness.set(code, sheet.thicknessMm ?? Number.NaN);
    expectedBook.set(code, (expectedBook.get(code) ?? 0) + 1);
  }
  for (const sheet of cutPlan.sheets) {
    for (const piece of sheet.pieces) {
      const code = ptxAscii(piece.materialCode ?? sheet.materialCode);
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
    if (!close(row.kerfRip, q(cutPlan.config.sawKerfMm)) || !close(row.kerfCrosscut, q(cutPlan.config.sawKerfMm))) {
      push('materials.kerf', `MATERIALS '${row.code}' kerf ${row.kerfRip}/${row.kerfCrosscut} ≠ kerf del plan ${q(cutPlan.config.sawKerfMm)}`);
    }
    const thickness = expectedThickness.get(row.code);
    if (thickness === undefined || Number.isNaN(thickness)) {
      push('materials.thickness_missing', `MATERIALS '${row.code}' sin espesor esperado en el plan`);
    } else if (!close(row.thickness, q(thickness))) {
      push('materials.thickness', `MATERIALS '${row.code}' THICK=${row.thickness} ≠ ${q(thickness)}`);
    }
    const book = expectedBook.get(row.code) ?? 0;
    if (row.bookQuantity !== Math.max(1, book)) {
      push('materials.book', `MATERIALS '${row.code}' BOOK=${row.bookQuantity} ≠ tableros del plan (${book})`);
    }
  }

  // 5. PARTS_REQ: one row per placed piece, in sheet/piece order.
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
    const expectedCode = ptxAscii(piece.partCode) || `PART-${expectedPartIndex}`;
    if (row.code !== expectedCode) {
      push('parts.code', `PARTS_REQ ${expectedPartIndex} CODE='${row.code}' ≠ '${expectedCode}'`);
    }
    if (!close(row.length, q(piece.lengthMm)) || !close(row.width, q(piece.widthMm))) {
      push('parts.dims', `PARTS_REQ ${expectedPartIndex} ${row.length}×${row.width} ≠ medidas resueltas ${q(piece.lengthMm)}×${q(piece.widthMm)} (pieza ${piece.id})`);
    }
    const expectedGrain = piece.grain === 0 ? 0 : 1;
    if (row.grain !== expectedGrain) {
      push('parts.grain', `PARTS_REQ ${expectedPartIndex} GRAIN=${row.grain} ≠ ${expectedGrain}`);
    }
    if (row.requiredQuantity !== 1 || (row.producedQuantity ?? 0) !== 1) {
      push('parts.qty', `PARTS_REQ ${expectedPartIndex} QTY_REQ/QTY_PROD=${row.requiredQuantity}/${row.producedQuantity} ≠ 1/1 (sin agregación)`);
    }
    const materialCode = ptxAscii(piece.materialCode ?? sheet.materialCode);
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
      q,
      expectedComment,
    });
  });

  // 7. Family-level completeness: no extra records beyond the contract.
  const totalDivisions = [...sheetTraces.values()].reduce(
    (sum, trace) => sum + trace.divisions.length,
    0,
  );
  const totalReleases = [...sheetTraces.values()].reduce(
    (sum, trace) => sum + planSheetReleases(trace, planCutProgramDivisions(trace)).length,
    0,
  );
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
  readonly q: (value: number) => number;
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
    q,
    expectedComment,
  } = ctx;

  let plans;
  try {
    plans = planCutProgramDivisions(trace);
  } catch {
    push('sheet.phase_unsupported', `hoja ${sheet.sheetIndex}: fase > 3 no soportada`);
    return;
  }
  const releases = planSheetReleases(trace, plans);

  if (!boardRow) {
    push('boards.missing', `hoja ${sheet.sheetIndex} sin fila BOARDS`);
  } else {
    if (boardRow.boardIndex !== sheetMapping.boardIndex) {
      push('boards.index', `BOARDS BRD_INDEX=${boardRow.boardIndex} ≠ ${sheetMapping.boardIndex}`);
    }
    if (!close(boardRow.length, q(sheet.sheetLengthMm)) || !close(boardRow.width, q(sheet.sheetWidthMm))) {
      push('boards.dims', `BOARDS ${boardRow.length}×${boardRow.width} ≠ tablero ${q(sheet.sheetLengthMm)}×${q(sheet.sheetWidthMm)} (hoja ${sheet.sheetIndex})`);
    }
    const sheetMaterialIndex = mapping.materialIndexByCode.get(ptxAscii(sheet.materialCode));
    if (sheetMaterialIndex === undefined || boardRow.materialIndex !== sheetMaterialIndex) {
      push('boards.material', `BOARDS MAT_INDEX=${boardRow.materialIndex} ≠ material '${ptxAscii(sheet.materialCode)}'`);
    }
  }

  if (!patternRow) {
    push('patterns.missing', `hoja ${sheet.sheetIndex} sin fila PATTERNS`);
  } else {
    const expectedType = ptxPatternTypeForSheet(trace);
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

  // --- CUTS rows: divisions in program order, then release rows ----------
  const rows = cutsByPattern.get(sheetMapping.patternIndex) ?? [];
  if (rows.length !== plans.length + releases.length) {
    push('cuts.sheet_count', `patrón ${sheetMapping.patternIndex}: CUTS=${rows.length} ≠ ${plans.length} divisiones + ${releases.length} liberaciones`);
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
  const kerfBytes = materialRowsKerf(ctx);

  plans.forEach((plan, position) => {
    const division = plan.division;
    const row = rows[position];
    const label = `CUTS patrón ${sheetMapping.patternIndex} fila ${position + 1} (cutId ${division.cutId})`;
    if (!row) return;
    const expectedCutIndex = sheetMapping.cutIndexByCutId.get(division.cutId);
    if (expectedCutIndex === undefined || row.cutIndex !== expectedCutIndex || expectedCutIndex !== position + 1) {
      push('cuts.index', `${label}: CUT_INDEX=${row.cutIndex} ≠ ${expectedCutIndex ?? '?'} (posición ${position + 1})`);
    }
    if (row.sequence !== division.order) {
      push('cuts.sequence', `${label}: SEQUENCE=${row.sequence} ≠ orden del programa ${division.order}`);
    }
    if (row.functionCode !== plan.functionCode) {
      push('cuts.function', `${label}: FUNCTION=${row.functionCode} ≠ política documentada (${plan.functionCode}, fase ${plan.phase}, eje ${division.axis})`);
    }
    if (!close(row.dimension, q(division.keptExtentMm))) {
      push('cuts.dimension', `${label}: DIMENSION=${row.dimension} ≠ medida relativa conservada ${q(division.keptExtentMm)}`);
    }
    if (row.repeatQuantity !== 1) {
      push('cuts.repeat', `${label}: QTY_RPT=${row.repeatQuantity} ≠ 1 (sin compresión)`);
    }
    const expectedReference =
      plan.keptPieceRef !== undefined
        ? { kind: 'part' as const, partIndex: mapping.partIndexByPieceRef.get(plan.keptPieceRef) ?? -1 }
        : { kind: 'none' as const };
    if (
      row.partReference.kind !== expectedReference.kind ||
      (expectedReference.kind === 'part' && row.partReference.kind === 'part' && row.partReference.partIndex !== expectedReference.partIndex)
    ) {
      push('cuts.part_ref', `${label}: PART_INDEX no corresponde a la hoja de pieza esperada (${plan.keptPieceRef ?? 'sin pieza'})`);
    }
    const expectedProduced = plan.keptPieceRef !== undefined ? 1 : 0;
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
      division.axis === 'x'
        ? division.parentRect.lengthMm
        : division.parentRect.widthMm;
    if (!close(parentExtent, q(traceParentExtent))) {
      push('cuts.parent_extent', `${label}: extensión del padre derivada de bytes (${parentExtent}) ≠ ejecutada (${q(traceParentExtent)})`);
    }
    recordExtent(division.keptRegionId, division.axis, row.dimension);
    if (division.restRect) {
      const traceRestExtent =
        division.axis === 'x' ? division.restRect.lengthMm : division.restRect.widthMm;
      if (derivedGap <= 0 || !close(derivedGap, q(traceRestExtent))) {
        push('cuts.rest_extent', `${label}: resto derivado de bytes (${derivedGap}) ≠ ejecutado (${q(traceRestExtent)})`);
      }
      recordExtent(division.restRegionId!, division.axis, derivedGap);
    } else if (derivedGap > kerfBytes + 2 * 10 ** -options.decimalPlaces) {
      push('cuts.rest_missing', `${label}: bytes derivan un resto sólido de ${derivedGap - kerfBytes} mm que el programa no declara`);
    }
    // The other axis is inherited from the parent (guillotine invariance);
    // recorded for completeness so deeper rows can read it.
    recordExtent(division.keptRegionId, division.axis === 'x' ? 'y' : 'x',
      extentAlongAxis.get(`${division.parentRegionId}:${division.axis === 'x' ? 'y' : 'x'}`) ?? Number.NaN);
    if (division.restRegionId) {
      recordExtent(division.restRegionId, division.axis === 'x' ? 'y' : 'x',
        extentAlongAxis.get(`${division.parentRegionId}:${division.axis === 'x' ? 'y' : 'x'}`) ?? Number.NaN);
    }
  });

  releases.forEach((release, position) => {
    const row = rows[plans.length + position];
    const label = `liberación '${release.regionId}' (patrón ${sheetMapping.patternIndex})`;
    if (!row) return;
    if (row.sequence !== 0 || row.repeatQuantity !== 0) {
      push('release.no_pass', `${label}: SEQUENCE=${row.sequence}/QTY_RPT=${row.repeatQuantity} ≠ 0/0 (una liberación no es una pasada)`);
    }
    if (row.producedQuantity !== 1) {
      push('release.produced', `${label}: QTY_PARTS=${row.producedQuantity} ≠ 1`);
    }
    if (!close(row.dimension, q(release.dimensionMm))) {
      push('release.dimension', `${label}: DIMENSION=${row.dimension} ≠ ${q(release.dimensionMm)}`);
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
    if (!close(row.length, q(terminal.rect.lengthMm)) || !close(row.width, q(terminal.rect.widthMm))) {
      push('offcuts.dims', `OFFCUTS X${expectedIndex} ${row.length}×${row.width} ≠ hoja ejecutada ${q(terminal.rect.lengthMm)}×${q(terminal.rect.widthMm)}`);
    }
    const sheetMaterialIndex = mapping.materialIndexByCode.get(ptxAscii(sheet.materialCode));
    if (sheetMaterialIndex === undefined || row.materialIndex !== sheetMaterialIndex) {
      push('offcuts.material', `OFFCUTS X${expectedIndex} MAT_INDEX=${row.materialIndex} ≠ material de la hoja`);
    }
  }

  // --- VECTORS: absolute cut lines, top-left origin ----------------------
  if (options.includeVectors === true) {    plans.forEach((plan, position) => {
      const division = plan.division;
      const matching = vectorRows.filter(
        (v) => v.patternIndex === sheetMapping.patternIndex && v.cutIndex === position + 1,
      );
      const label = `VECTORS patrón ${sheetMapping.patternIndex} corte ${position + 1} (cutId ${division.cutId})`;
      if (matching.length !== 1) {
        push('vectors.count', `${label}: ${matching.length} filas, se esperaba 1`);
        return;
      }
      const expected = ptxDivisionVector(division, trace.boardRect.widthMm, options.decimalPlaces);
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

function materialRowsKerf(ctx: SheetVerificationContext): number {
  // The bytes declare ONE uniform kerf per material (validated: kerf equality
  // with the plan is checked in step 4); the sheet material's kerf is the
  // derivation input. Falls back to the executed trace's first kerf when the
  // row is missing — the corresponding materials issue has already been
  // reported by then.
  const code = ptxAscii(ctx.sheet.materialCode);
  const index = ctx.mapping.materialIndexByCode.get(code);
  for (const record of ctx.parsed.records) {
    if (record.type === 'MATERIALS' && (index === undefined || record.materialIndex === index)) {
      return record.kerfRip;
    }
  }
  return ctx.trace.divisions[0]?.kerfMm ?? 0;
}
