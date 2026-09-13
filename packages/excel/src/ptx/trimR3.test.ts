/**
 * #661 — r3 trim contract tests (RED first).
 *
 * Freezes the implementation contract of docs/machines/ptx-cadmatic4/
 * 04_contrato_r3_refilados.md for the documented PTX compiler:
 *
 * - G1: CUTS.DIMENSION stays relative to the usable root (never global).
 * - G2: perimeter trims map by executed axis + leadingBand to
 *   TRIM_FRIP/VRIP/FXCT/VXCT (bottom/top/left/right of the fixed frame).
 * - G3: TRIM_HEAD/TRIM_FRCT/TRIM_VRCT stay ABSENT (undefined ≠ 0).
 * - G4: the PTX trim value is the TOTAL margin including kerf; the usable
 *   root subtree is compiled without re-emitting the trim divisions.
 * - G5: FUNCTION 92 + Xn only for the demonstrated rest-side phase-2 subset,
 *   scheduled producer < 92 < dependent recut; everything else keeps the r2
 *   QTY_RPT=0 release representation.
 *
 * Fixtures are hand-built valid CutPrograms (executeCutProgram is the only
 * geometric authority and re-runs inside the compiler/verifier); the golden
 * end-to-end case over a real optimizeCutPlan lives in cutPlanPtxGoldenR3.
 */

import { describe, expect, it } from 'vitest';
import {
  divideRegion,
  executeCutProgram,
  type CutPlan,
  type CutPlanConfig,
  type CutPlanPlacedPiece,
  type CutPlanSheet,
  type CutProgramDivision,
  type CutProgramInput,
  type CutProgramRect,
  type CutProgramRegion,
  type CutProgramTerminalDeclaration,
  type MachineOutputSelection,
} from '@granete/domain';
import { evaluateSelectedCuttingOutputReadiness } from '../machines/outputSelectionResolver';
import { CLIENT_A_HPP250_PROFILE, PTX_CADMATIC_4_R3_PROFILE } from '../machines/profiles';
import { PTX_POSTPROCESSOR_ADAPTER } from '../machines/ptxAdapter';
import type { PtxCutRecord, PtxDocument, PtxMaterialRecord, PtxRecord } from './records';
import { ptxDocumentsEqual } from './equivalence';
import { parsePtxDocumentBytes, parsePtxDocumentText } from './parse';
import { serializePtxDocument, serializePtxDocumentBytes } from './serialize';
import { validatePtxDocument } from './validate';
import {
  PtxCompilationError,
  compileCutPlanToPtxDocument,
  type CompileCutPlanToPtxOptions,
} from './compileCutPlan';
import { verifyCutPlanPtxReadback, type CutPlanPtxReadbackIssue } from './verifyCutPlanPtxReadback';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** r2 candidate options (historical): positive trims fail closed. */
const R2_OPTIONS: CompileCutPlanToPtxOptions = {
  headerVersion: 1,
  headerOrigin: 0,
  trimType: 1,
  title: 'LAB_FIXTURE NOT_MACHINE_VALIDATED',
  decimalPlaces: 2,
};

/** r3 candidate options: the evidenced trim subset of 04_contrato_r3_refilados.md. */
const R3_OPTIONS: CompileCutPlanToPtxOptions = {
  headerVersion: 1,
  headerOrigin: 0,
  trimType: 1,
  title: 'LAB_FIXTURE NOT_MACHINE_VALIDATED',
  decimalPlaces: 2,
  supportsPositiveTrim: true,
};

const KERF = 4;

const R3_SELECTION: MachineOutputSelection = {
  operation: 'cutting',
  machineProfileId: CLIENT_A_HPP250_PROFILE.ref.machineProfileId,
  machineProfileRevisionId: CLIENT_A_HPP250_PROFILE.ref.machineProfileRevisionId,
  outputCompatibilityProfileId: PTX_CADMATIC_4_R3_PROFILE.ref.outputCompatibilityProfileId,
  outputCompatibilityProfileRevisionId: PTX_CADMATIC_4_R3_PROFILE.ref.revisionId,
  outputCompatibilityProfileDigest: PTX_CADMATIC_4_R3_PROFILE.digest,
  postprocessorAdapterId: PTX_POSTPROCESSOR_ADAPTER.postprocessorAdapterId,
  postprocessorAdapterVersion: PTX_POSTPROCESSOR_ADAPTER.adapterVersion,
  postprocessorImplementationDigest: PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
};

function configWithTrim(trim: { topMm: number; bottomMm: number; leftMm: number; rightMm: number }): CutPlanConfig {
  return {
    sawKerfMm: KERF,
    trim,
    deductEdgeBand: true,
    allowRotationNoGrain: true,
    minRemnantWidthMm: 20,
    minRemnantLengthMm: 20,
    preferLongitudinalRips: true,
  };
}

// ---------------------------------------------------------------------------
// Program builder (test-local; geometry always computed by divideRegion)
// ---------------------------------------------------------------------------

class ProgramBuilder {
  readonly regions: CutProgramRegion[] = [];
  readonly divisions: CutProgramDivision[] = [];
  readonly terminals: CutProgramTerminalDeclaration[] = [];
  private readonly rects = new Map<string, CutProgramRect>();
  private seq = 0;

  constructor(boardId: string, boardRect: CutProgramRect) {
    this.regions.push({ regionId: boardId, rect: boardRect });
    this.rects.set(boardId, boardRect);
  }

  rectOf(regionId: string): CutProgramRect {
    const rect = this.rects.get(regionId);
    if (!rect) throw new Error(`region no registrada: ${regionId}`);
    return rect;
  }

  divide(params: {
    parent: string;
    axis: 'x' | 'y';
    keptExtentMm: number;
    kerfMm?: number;
    leadingBand?: boolean;
    trim?: boolean;
    cutId?: string;
  }): { keptId: string; restId: string | null; keptRect: CutProgramRect; restRect: CutProgramRect | null } {
    const parentRect = this.rectOf(params.parent);
    const kerf = params.kerfMm ?? KERF;
    const geometry = divideRegion(parentRect, params.axis, params.keptExtentMm, kerf, {
      allowBladeExit: true,
      leadingBand: params.leadingBand === true,
    });
    const cutId = params.cutId ?? `cut-${++this.seq}`;
    const keptId = `${cutId}:kept`;
    this.regions.push({ regionId: keptId, rect: geometry.keptRect });
    this.rects.set(keptId, geometry.keptRect);
    let restId: string | null = null;
    const division: CutProgramDivision = {
      cutId,
      parentRegionId: params.parent,
      axis: params.axis,
      keptExtentMm: params.keptExtentMm,
      kerfMm: kerf,
      keptRegionId: keptId,
      leadingBand: params.leadingBand === true ? true : undefined,
      trim: params.trim === true ? true : undefined,
      bladeExitsParent: geometry.bladeExitsParent ? true : undefined,
    };
    if (geometry.restRect) {
      restId = `${cutId}:rest`;
      this.regions.push({ regionId: restId, rect: geometry.restRect });
      this.rects.set(restId, geometry.restRect);
      (division as { restRegionId?: string }).restRegionId = restId;
    }
    this.divisions.push(division);
    return { keptId, restId, keptRect: geometry.keptRect, restRect: geometry.restRect };
  }

  terminal(regionId: string, kind: 'piece' | 'remnant' | 'waste', pieceRef?: string, liberated?: boolean): void {
    this.terminals.push({ regionId, kind, pieceRef, liberated });
  }

  build(boardId: string): CutProgramInput {
    return {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: boardId,
      regions: [...this.regions],
      divisions: [...this.divisions],
      terminals: [...this.terminals],
    };
  }
}

/** Registers the perimeter trim chain (left, right, bottom, top) and returns the usable root id. */
function addPerimeterTrims(
  builder: ProgramBuilder,
  boardId: string,
  trim: { topMm: number; bottomMm: number; leftMm: number; rightMm: number },
): string {
  let current = boardId;
  for (const side of ['left', 'right', 'bottom', 'top'] as const) {
    const margin = trim[`${side}Mm`] ?? 0;
    if (margin <= 0) continue;
    const axis = side === 'left' || side === 'right' ? ('x' as const) : ('y' as const);
    const leading = side === 'left' || side === 'bottom';
    const rect = builder.rectOf(current);
    const parentExtent = axis === 'x' ? rect.lengthMm : rect.widthMm;
    const result = builder.divide({
      parent: current,
      axis,
      keptExtentMm: parentExtent - margin,
      leadingBand: leading,
      trim: true,
      cutId: `trim:${side}`,
    });
    if (result.restId) {
      builder.terminal(result.restId, 'waste', undefined, true);
    }
    current = result.keptId;
  }
  return current;
}

function piecePlacement(params: {
  id: string;
  partCode: string;
  rect: CutProgramRect;
  sheetIndex?: number;
}): CutPlanPlacedPiece {
  return {
    id: params.id,
    partCode: params.partCode,
    partName: params.partCode,
    moduleCode: 'M01',
    labelRef: params.id,
    materialName: 'Lab Board 18',
    materialCode: 'LAB18',
    xMm: params.rect.xMm,
    yMm: params.rect.yMm,
    lengthMm: params.rect.lengthMm,
    widthMm: params.rect.widthMm,
    originalLengthMm: params.rect.lengthMm,
    originalWidthMm: params.rect.widthMm,
    grain: 1,
    rotated: false,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
    thicknessMm: 18,
    sheetIndex: params.sheetIndex ?? 0,
    stripIndex: 0,
    cutSequenceNumber: 1,
  };
}

function planFromProgram(params: {
  program: CutProgramInput;
  boardRect: CutProgramRect;
  pieces: readonly CutPlanPlacedPiece[];
  trim: { topMm: number; bottomMm: number; leftMm: number; rightMm: number };
}): CutPlan {
  const sheet: CutPlanSheet = {
    sheetIndex: 0,
    strategy: 'saw-guillotine',
    materialCode: 'LAB18',
    materialName: 'Lab Board 18',
    sheetWidthMm: params.boardRect.widthMm,
    sheetLengthMm: params.boardRect.lengthMm,
    thicknessMm: 18,
    pieces: params.pieces,
    remnants: [],
    instructions: [],
    cutProgram: params.program,
    netPiecesAreaM2: 0,
    grossSheetAreaM2: 0,
    usableRemnantAreaM2: 0,
    wasteAreaM2: 0,
    wastePercent: 0,
    yieldPercent: 0,
  };
  return {
    id: 'cutplan-lab-661',
    projectId: 'lab-661',
    projectName: 'Lab 661',
    generatedAt: '2026-09-11T00:00:00.000Z',
    version: 1,
    isFrozen: false,
    config: configWithTrim(params.trim),
    sheets: [sheet],
    stats: {
      totalSheets: 1,
      totalPieces: params.pieces.length,
      totalGrossAreaM2: 0,
      totalNetPiecesAreaM2: 0,
      totalUsefulRemnantsAreaM2: 0,
      totalWasteAreaM2: 0,
      globalWastePercent: 0,
      globalYieldPercent: 0,
      byMaterial: [],
    },
    usefulRemnants: [],
  };
}

function expectCompilationError(fn: () => unknown, code: string): PtxCompilationError {
  let caught: unknown = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PtxCompilationError);
  expect((caught as PtxCompilationError).code).toBe(code);
  return caught as PtxCompilationError;
}

function runFullChain(plan: CutPlan, options: CompileCutPlanToPtxOptions): PtxDocument {
  const compiled = compileCutPlanToPtxDocument(plan, options);
  expect(validatePtxDocument(compiled.document)).toEqual([]);
  const bytes = serializePtxDocumentBytes(compiled.document, {
    decimalPlaces: options.decimalPlaces,
  });
  const parsed = parsePtxDocumentBytes(bytes);
  expect(validatePtxDocument(parsed)).toEqual([]);
  expect(ptxDocumentsEqual(parsed, compiled.document)).toBe(true);
  const issues = verifyCutPlanPtxReadback(parsed, plan, compiled.mapping, options);
  expect(issues).toEqual([]);
  return parsed;
}

function materialsOf(doc: PtxDocument): PtxMaterialRecord[] {
  return doc.records.filter((r): r is PtxMaterialRecord => r.type === 'MATERIALS');
}

function cutsOf(doc: PtxDocument, patternIndex = 1): PtxCutRecord[] {
  return doc.records.filter(
    (r): r is PtxCutRecord => r.type === 'CUTS' && r.patternIndex === patternIndex,
  );
}

function issueCodes(issues: readonly CutPlanPtxReadbackIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

/** Serialize → apply a record-level mutation → parse (format-level validity preserved). */
function mutateAndParse(doc: PtxDocument, mutate: (records: PtxRecord[]) => PtxRecord[]): PtxDocument {
  return parsePtxDocumentText(
    serializePtxDocument({ header: doc.header, records: mutate([...doc.records]) }),
  );
}

// ---------------------------------------------------------------------------
// Main r3 fixture: 10/10/10/10 trims, two eligible 92 remnants, one phase-1
// remnant and one rest-side piece (kept as r2 release rows).
// ---------------------------------------------------------------------------

interface MainFixture {
  readonly plan: CutPlan;
  readonly usableRootRect: CutProgramRect;
}

/**
 * Board 600×400, trims 10/10/10/10, kerf 4 → usable root (10,10) 580×380.
 *
 * Productive tree (all magnitudes relative to the usable root):
 * - D1  rip   y 200 → strip1 (kept) / R1  (rest, gen 1)
 * - D1b rip   y 150 on R1 → S2 (kept) / R1b (rest → remnant X3, phase 1: NOT eligible)
 * - D2  cross x 250 on strip1 → K2 (kept) / RA (rest → remnant X1, ELIGIBLE 92; kept side has D3)
 * - D2b cross x 300 on S2    → K2b (kept piece P3) / RB (rest → remnant X2, ELIGIBLE 92)
 * - D3  recut y 150 on K2 (phase 3) → P1 (kept piece) / P2 (rest piece, r2 'part' release)
 */
function buildMainFixture(): MainFixture {
  const boardRect: CutProgramRect = { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 };
  const builder = new ProgramBuilder('board', boardRect);
  const usable = addPerimeterTrims(builder, 'board', {
    topMm: 10,
    bottomMm: 10,
    leftMm: 10,
    rightMm: 10,
  });
  const usableRootRect = builder.rectOf(usable);

  const d1 = builder.divide({ parent: usable, axis: 'y', keptExtentMm: 200, cutId: 'D1' });
  const d1b = builder.divide({ parent: d1.restId!, axis: 'y', keptExtentMm: 150, cutId: 'D1b' });
  const d2 = builder.divide({ parent: d1.keptId, axis: 'x', keptExtentMm: 250, cutId: 'D2' });
  const d2b = builder.divide({ parent: d1b.keptId, axis: 'x', keptExtentMm: 300, cutId: 'D2b' });
  const d3 = builder.divide({ parent: d2.keptId, axis: 'y', keptExtentMm: 150, cutId: 'D3' });

  builder.terminal(d3.keptId, 'piece', 'P1');
  builder.terminal(d3.restId!, 'piece', 'P2');
  builder.terminal(d2b.keptId, 'piece', 'P3');
  // Declaration order fixes the Xn assignment: RA → X1, RB → X2, R1b → X3.
  builder.terminal(d2.restId!, 'remnant');
  builder.terminal(d2b.restId!, 'remnant');
  builder.terminal(d1b.restId!, 'remnant');

  const program = builder.build('board');
  executeCutProgram(program); // fixture sanity: the program is executable

  const pieces = [
    piecePlacement({ id: 'P1', partCode: 'P1', rect: d3.keptRect }),
    piecePlacement({ id: 'P2', partCode: 'P2', rect: d3.restRect! }),
    piecePlacement({ id: 'P3', partCode: 'P3', rect: d2b.keptRect }),
  ];
  return {
    plan: planFromProgram({
      program,
      boardRect,
      pieces,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
    }),
    usableRootRect,
  };
}

// ---------------------------------------------------------------------------
// G2/G3/G4 — the supported trim subset compiles end to end
// ---------------------------------------------------------------------------

describe('r3 — refilados 10/10/10/10 con kerf 4 (caso principal)', () => {
  const fixture = buildMainFixture();
  let doc: PtxDocument;

  it('compila → valida → serializa → parsea → verifier = []', () => {
    doc = runFullChain(fixture.plan, R3_OPTIONS);
  });

  it('MATERIALS declara los cuatro TRIM_* como total incluyendo kerf (G4)', () => {
    const material = materialsOf(doc)[0]!;
    expect(material.trimFRip).toBe(10);
    expect(material.trimVRip).toBe(10);
    expect(material.trimFXct).toBe(10);
    expect(material.trimVXct).toBe(10);
    // G4: nunca 6 (sólido) ni 14 (doble kerf).
    expect(material.trimFRip).not.toBe(6);
    expect(material.trimFRip).not.toBe(14);
  });

  it('G3: TRIM_HEAD/TRIM_FRCT/TRIM_VRCT quedan AUSENTES (no 0)', () => {
    const material = materialsOf(doc)[0]!;
    expect(material.trimHead).toBeUndefined();
    expect(material.trimFRct).toBeUndefined();
    expect(material.trimVRct).toBeUndefined();
    const text = serializePtxDocument(doc, { decimalPlaces: 2 });
    const materialLine = text.split('\r\n').find((line) => line.startsWith('MATERIALS'))!;
    // Las tres celdas siguen a los cuatro refilados: vacías, no "0".
    expect(materialLine).toContain(',10,10,10,10,,,');
  });

  it('las divisiones de trim no se emiten como CUTS (sin double counting)', () => {
    const comments = cutsOf(doc).map((row) => row.comment);
    for (const side of ['left', 'right', 'bottom', 'top']) {
      expect(comments).not.toContain(`trim:${side}`);
    }
    // 5 divisiones productivas (D1, D2, D3, D1b, D2b) + 4 liberaciones
    // (P2 parte, RA 92, RB 92, R1b remnant phase-1).
    expect(cutsOf(doc)).toHaveLength(9);
  });

  it('BOARDS conserva las dimensiones brutas del tablero', () => {
    const board = doc.records.find((r) => r.type === 'BOARDS') as { length: number; width: number };
    expect(board.length).toBe(600);
    expect(board.width).toBe(400);
  });

  it('G5: FUNCTION 92 + Xn sólo para los dos rest-side phase-2 elegibles', () => {
    const rows = cutsOf(doc);
    const fn92 = rows.filter((row) => row.functionCode === 92);
    expect(fn92).toHaveLength(2);
    for (const row of fn92) {
      expect(row.repeatQuantity).toBe(1);
      expect(row.producedQuantity).toBeUndefined();
      expect(row.partReference.kind).toBe('offcut');
      expect(row.sequence).toBeGreaterThan(0);
      expect(row.dimension).toBeGreaterThan(0);
    }
    // RA 326 mm / RB 276 mm sobre el eje productor (x), en orden de declaración.
    expect(fn92.map((row) => row.dimension).sort((a, b) => b - a)).toEqual([326, 276]);
    expect(fn92.map((row) => (row.partReference as { offcutIndex: number }).offcutIndex).sort())
      .toEqual([1, 2]);
  });

  it('los remanentes no elegibles conservan la fila r2 QTY_RPT=0/SEQUENCE=0', () => {
    const rows = cutsOf(doc);
    const r1b = rows.find((row) => row.comment === 'D1b:rest');
    expect(r1b).toBeDefined();
    expect(r1b!.functionCode).toBe(1); // productor phase-1 rip
    expect(r1b!.repeatQuantity).toBe(0);
    expect(r1b!.sequence).toBe(0);
    expect(r1b!.dimension).toBe(22);
    const p2 = rows.find((row) => row.comment === 'D3:rest');
    expect(p2).toBeDefined();
    expect(p2!.functionCode).toBe(3);
    expect(p2!.repeatQuantity).toBe(0);
    expect(p2!.partReference).toEqual({ kind: 'part', partIndex: 2 });
  });

  it('el scheduler ordena producer < 92 < recut dependiente con secuencias contiguas', () => {
    const rows = cutsOf(doc);
    const sequenceOf = (comment: string) => rows.find((row) => row.comment === comment)!.sequence;
    // Orden de ejecución del programa: D1, D1b, D2, [92 RA], D2b, [92 RB], D3.
    expect(sequenceOf('D1')).toBe(1);
    expect(sequenceOf('D1b')).toBe(2);
    expect(sequenceOf('D2')).toBe(3);
    expect(sequenceOf('D2:rest')).toBe(4); // 92 tras su productor
    expect(sequenceOf('D2b')).toBe(5);
    expect(sequenceOf('D2b:rest')).toBe(6);
    expect(sequenceOf('D3')).toBe(7);
    // El recut dependiente de D2 (D3) queda DESPUÉS de la 92 de D2.
    expect(sequenceOf('D2:rest')).toBeLessThan(sequenceOf('D3'));
    // Orden relativo de divisiones preservado: ordenadas por SEQUENCE deben
    // reproducir el orden de ejecución del programa (no el de las filas).
    const divisionRows = rows.filter((row) => row.comment && !row.comment.includes(':rest'));
    const executionOrder = [...divisionRows]
      .sort((a, b) => a.sequence - b.sequence)
      .map((row) => row.comment);
    expect(executionOrder).toEqual(['D1', 'D1b', 'D2', 'D2b', 'D3']);
  });

  it('CUT_INDEX (preorder estructural) y SEQUENCE (schedule) divergen', () => {
    const rows = cutsOf(doc);
    const d3 = rows.find((row) => row.comment === 'D3')!;
    const ra = rows.find((row) => row.comment === 'D2:rest')!;
    expect(d3.cutIndex).toBeLessThan(ra.cutIndex); // D3 en preorder antes que las liberaciones
    expect(d3.sequence).toBeGreaterThan(ra.sequence); // pero ejecuta después de la 92
  });

  it('PATTERNS.TYPE sigue la política r2 (0 rip-first; nunca 1..3)', () => {
    const pattern = doc.records.find((r) => r.type === 'PATTERNS') as { patternType: number };
    expect(pattern.patternType).toBe(0);
  });

  it('es determinista: mismas entradas → mismos bytes', () => {
    const a = compileCutPlanToPtxDocument(fixture.plan, R3_OPTIONS);
    const b = compileCutPlanToPtxDocument(fixture.plan, R3_OPTIONS);
    expect(serializePtxDocumentBytes(a.document, { decimalPlaces: 2 })).toEqual(
      serializePtxDocumentBytes(b.document, { decimalPlaces: 2 }),
    );
  });
});

describe('r3 — identidad de regiones local a cada hoja', () => {
  function sheetWithRepeatedLocalIds(sheetIndex: number): CutPlanSheet {
    const boardRect: CutProgramRect = { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 };
    const builder = new ProgramBuilder('board', boardRect);
    const usable = addPerimeterTrims(builder, 'board', {
      topMm: 10,
      bottomMm: 10,
      leftMm: 10,
      rightMm: 10,
    });
    const rip = builder.divide({ parent: usable, axis: 'y', keptExtentMm: 200, cutId: 'D1' });
    const cross = builder.divide({ parent: rip.keptId, axis: 'x', keptExtentMm: 250, cutId: 'D2' });
    const recut = builder.divide({ parent: cross.keptId, axis: 'y', keptExtentMm: 150, cutId: 'D3' });
    const pieceId = `P${sheetIndex + 1}`;
    builder.terminal(recut.keptId, 'piece', pieceId);
    builder.terminal(recut.restId!, 'waste');
    builder.terminal(cross.restId!, 'remnant');
    builder.terminal(rip.restId!, 'waste');
    const program = builder.build('board');
    executeCutProgram(program);
    return {
      sheetIndex,
      strategy: 'saw-guillotine',
      materialCode: 'LAB18',
      materialName: 'Lab Board 18',
      sheetWidthMm: boardRect.widthMm,
      sheetLengthMm: boardRect.lengthMm,
      thicknessMm: 18,
      pieces: [piecePlacement({ id: pieceId, partCode: pieceId, rect: recut.keptRect, sheetIndex })],
      remnants: [],
      instructions: [],
      cutProgram: program,
      netPiecesAreaM2: 0,
      grossSheetAreaM2: 0,
      usableRemnantAreaM2: 0,
      wasteAreaM2: 0,
      wastePercent: 0,
      yieldPercent: 0,
    };
  }

  function multiSheetPlan(): CutPlan {
    const sheets = [sheetWithRepeatedLocalIds(0), sheetWithRepeatedLocalIds(1)];
    return {
      id: 'cutplan-multi-sheet-local-region-ids',
      projectId: 'lab-692',
      generatedAt: '2026-09-12T00:00:00.000Z',
      version: 1,
      isFrozen: true,
      config: configWithTrim({ topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 }),
      sheets,
      stats: {
        totalSheets: 2,
        totalPieces: 2,
        totalGrossAreaM2: 0,
        totalNetPiecesAreaM2: 0,
        totalUsefulRemnantsAreaM2: 0,
        totalWasteAreaM2: 0,
        globalWastePercent: 0,
        globalYieldPercent: 0,
        byMaterial: [],
      },
      usefulRemnants: [],
    };
  }

  it('asigna X1/X2 por (sheetIndex, regionId) aunque los ids locales se repitan', () => {
    const plan = multiSheetPlan();
    const compiled = compileCutPlanToPtxDocument(plan, R3_OPTIONS);
    const fn92 = cutsOf(compiled.document, 1)
      .concat(cutsOf(compiled.document, 2))
      .filter((row) => row.functionCode === 92);
    expect(fn92).toHaveLength(2);
    expect(fn92.map((row) => row.partReference)).toEqual([
      { kind: 'offcut', offcutIndex: 1 },
      { kind: 'offcut', offcutIndex: 2 },
    ]);
    expect(compiled.mapping.offcutRegionRefByOffcutIndex).toEqual([
      { sheetIndex: 0, regionId: 'D2:rest' },
      { sheetIndex: 1, regionId: 'D2:rest' },
    ]);
    expect(runFullChain(plan, R3_OPTIONS)).toBeDefined();
  });

  it('rechaza un cruce X1/X2 aunque el documento siga siendo válido', () => {
    const plan = multiSheetPlan();
    const compiled = compileCutPlanToPtxDocument(plan, R3_OPTIONS);
    const mutated = mutateAndParse(compiled.document, (records) =>
      records.map((record) => {
        if (record.type !== 'CUTS' || record.functionCode !== 92 || record.partReference.kind !== 'offcut') {
          return record;
        }
        return {
          ...record,
          partReference: {
            kind: 'offcut',
            offcutIndex: record.partReference.offcutIndex === 1 ? 2 : 1,
          },
        };
      }),
    );
    expect(validatePtxDocument(mutated)).toEqual([]);
    expect(issueCodes(verifyCutPlanPtxReadback(mutated, plan, compiled.mapping, R3_OPTIONS)))
      .toContain('release.offcut_ref');
  });
});

// ---------------------------------------------------------------------------
// G2 — asimétricos: mapping por eje + leadingBand, sin normalizar
// ---------------------------------------------------------------------------

describe('r3 — trims asimétricos 10/5/8/12', () => {
  function buildAsymmetricFixture(): CutPlan {
    const boardRect: CutProgramRect = { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 };
    const builder = new ProgramBuilder('board', boardRect);
    const usable = addPerimeterTrims(builder, 'board', {
      topMm: 12,
      bottomMm: 8,
      leftMm: 10,
      rightMm: 5,
    });
    const d1 = builder.divide({ parent: usable, axis: 'y', keptExtentMm: 200, cutId: 'D1' });
    builder.terminal(d1.keptId, 'piece', 'PA');
    builder.terminal(d1.restId!, 'waste');
    const program = builder.build('board');
    executeCutProgram(program);
    return planFromProgram({
      program,
      boardRect,
      pieces: [piecePlacement({ id: 'PA', partCode: 'PA', rect: d1.keptRect })],
      trim: { topMm: 12, bottomMm: 8, leftMm: 10, rightMm: 5 },
    });
  }

  it('mapea left→FXCT, right→VXCT, bottom→FRIP, top→VRIP sin normalizar', () => {
    const doc = runFullChain(buildAsymmetricFixture(), R3_OPTIONS);
    const material = materialsOf(doc)[0]!;
    expect(material.trimFXct).toBe(10);
    expect(material.trimVXct).toBe(5);
    expect(material.trimFRip).toBe(8);
    expect(material.trimVRip).toBe(12);
    expect(material.trimHead).toBeUndefined();
    expect(material.trimFRct).toBeUndefined();
    expect(material.trimVRct).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// G4 — trim == kerf y trim < kerf
// ---------------------------------------------------------------------------

describe('r3 — trim == kerf y trim < kerf', () => {
  function buildEdgeFixture(trim: {
    topMm: number;
    bottomMm: number;
    leftMm: number;
    rightMm: number;
  }): CutPlan {
    const boardRect: CutProgramRect = { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 };
    const builder = new ProgramBuilder('board', boardRect);
    const usable = addPerimeterTrims(builder, 'board', trim);
    const d1 = builder.divide({ parent: usable, axis: 'y', keptExtentMm: 200, cutId: 'D1' });
    builder.terminal(d1.keptId, 'piece', 'PA');
    builder.terminal(d1.restId!, 'remnant');
    const program = builder.build('board');
    executeCutProgram(program);
    return planFromProgram({ program, boardRect, pieces: [piecePlacement({ id: 'PA', partCode: 'PA', rect: d1.keptRect })], trim });
  }

  it('trim == kerf: PTX trim total = 4 (no 0, no 8)', () => {
    const trim = { topMm: 4, bottomMm: 4, leftMm: 4, rightMm: 4 };
    const doc = runFullChain(buildEdgeFixture(trim), R3_OPTIONS);
    const material = materialsOf(doc)[0]!;
    expect(material.trimFRip).toBe(4);
    expect(material.trimVRip).toBe(4);
    expect(material.trimFXct).toBe(4);
    expect(material.trimVXct).toBe(4);
  });

  it('trim < kerf: PTX trim total = 3 (blade-exit explícito del dominio)', () => {
    const trim = { topMm: 3, bottomMm: 3, leftMm: 3, rightMm: 3 };
    const doc = runFullChain(buildEdgeFixture(trim), R3_OPTIONS);
    const material = materialsOf(doc)[0]!;
    expect(material.trimFRip).toBe(3);
    expect(material.trimVRip).toBe(3);
    expect(material.trimFXct).toBe(3);
    expect(material.trimVXct).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// #14 — regresión trim cero
// ---------------------------------------------------------------------------

describe('r3 — trim cero conserva el comportamiento histórico', () => {
  function buildZeroTrimFixture(): CutPlan {
    const boardRect: CutProgramRect = { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 };
    const builder = new ProgramBuilder('board', boardRect);
    const d1 = builder.divide({ parent: 'board', axis: 'y', keptExtentMm: 200, cutId: 'D1' });
    builder.terminal(d1.keptId, 'piece', 'PA');
    builder.terminal(d1.restId!, 'waste');
    const program = builder.build('board');
    executeCutProgram(program);
    return planFromProgram({
      program,
      boardRect,
      pieces: [piecePlacement({ id: 'PA', partCode: 'PA', rect: d1.keptRect })],
      trim: { topMm: 0, bottomMm: 0, leftMm: 0, rightMm: 0 },
    });
  }

  it('r3 sin trims produce el mismo documento que la ruta r2 (bytes idénticos)', () => {
    const plan = buildZeroTrimFixture();
    const withR2 = compileCutPlanToPtxDocument(plan, R2_OPTIONS);
    const withR3 = compileCutPlanToPtxDocument(plan, R3_OPTIONS);
    expect(ptxDocumentsEqual(withR2.document, withR3.document)).toBe(true);
    expect(serializePtxDocument(withR3.document, { decimalPlaces: 2 })).toBe(
      serializePtxDocument(withR2.document, { decimalPlaces: 2 }),
    );
    const material = materialsOf(withR3.document)[0]!;
    expect(material.trimFRip).toBeUndefined();
    expect(material.trimVRip).toBeUndefined();
    expect(material.trimFXct).toBeUndefined();
    expect(material.trimVXct).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// r2 permanece inmutable: sin la opción r3, los trims positivos siguen bloqueados
// ---------------------------------------------------------------------------

describe('r2 inmutable — la opción r3 es la única puerta del subconjunto', () => {
  it('sin supportsPositiveTrim el compilador sigue fallando con trim_unsupported', () => {
    const fixture = buildMainFixture();
    const error = expectCompilationError(
      () => compileCutPlanToPtxDocument(fixture.plan, R2_OPTIONS),
      'ptx_compile.trim_unsupported',
    );
    expect((error.context.trimCutIds as string[]).length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Fail closed — estructura y frame
// ---------------------------------------------------------------------------

describe('r3 fail closed — estructura del prefijo de trims', () => {
  it('un trim fuera de la cadena perimetral: trim_structure_invalid', () => {
    const boardRect: CutProgramRect = { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 };
    const builder = new ProgramBuilder('board', boardRect);
    const d1 = builder.divide({ parent: 'board', axis: 'y', keptExtentMm: 200, cutId: 'D1' });
    // Trim en mitad del árbol productivo (parent = kept de D1).
    const t = builder.divide({
      parent: d1.keptId,
      axis: 'x',
      keptExtentMm: d1.keptRect.lengthMm - 10,
      cutId: 'trim:mid',
      trim: true,
    });
    builder.terminal(t.keptId, 'piece', 'PA');
    builder.terminal(t.restId!, 'waste', undefined, true);
    builder.terminal(d1.restId!, 'waste');
    const program = builder.build('board');
    executeCutProgram(program);
    const plan = planFromProgram({
      program,
      boardRect,
      pieces: [piecePlacement({ id: 'PA', partCode: 'PA', rect: t.keptRect })],
      trim: { topMm: 0, bottomMm: 0, leftMm: 0, rightMm: 0 },
    });
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, R3_OPTIONS),
      'ptx_compile.trim_structure_invalid',
    );
  });

  it('el resto de un trim que no es desperdicio liberado: trim_structure_invalid', () => {
    const boardRect: CutProgramRect = { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 };
    const builder = new ProgramBuilder('board', boardRect);
    const left = builder.divide({
      parent: 'board',
      axis: 'x',
      keptExtentMm: 590,
      leadingBand: true,
      cutId: 'trim:left',
      trim: true,
    });
    // El resto del trim se declara remnant: la proyección lo descartaría.
    builder.terminal(left.restId!, 'remnant');
    const d1 = builder.divide({ parent: left.keptId, axis: 'y', keptExtentMm: 200, cutId: 'D1' });
    builder.terminal(d1.keptId, 'piece', 'PA');
    builder.terminal(d1.restId!, 'waste');
    const program = builder.build('board');
    executeCutProgram(program);
    const plan = planFromProgram({
      program,
      boardRect,
      pieces: [piecePlacement({ id: 'PA', partCode: 'PA', rect: d1.keptRect })],
      trim: { topMm: 0, bottomMm: 0, leftMm: 10, rightMm: 0 },
    });
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, R3_OPTIONS),
      'ptx_compile.trim_structure_invalid',
    );
  });

  it('dos trims del mismo lado (frame fijo no puede sostener el plan): trim_frame_unsupported', () => {
    const boardRect: CutProgramRect = { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 };
    const builder = new ProgramBuilder('board', boardRect);
    const first = builder.divide({
      parent: 'board',
      axis: 'x',
      keptExtentMm: 590,
      leadingBand: true,
      cutId: 'trim:left-a',
      trim: true,
    });
    builder.terminal(first.restId!, 'waste', undefined, true);
    const second = builder.divide({
      parent: first.keptId,
      axis: 'x',
      keptExtentMm: 580,
      leadingBand: true,
      cutId: 'trim:left-b',
      trim: true,
    });
    builder.terminal(second.restId!, 'waste', undefined, true);
    const d1 = builder.divide({ parent: second.keptId, axis: 'y', keptExtentMm: 200, cutId: 'D1' });
    builder.terminal(d1.keptId, 'piece', 'PA');
    builder.terminal(d1.restId!, 'waste');
    const program = builder.build('board');
    executeCutProgram(program);
    const plan = planFromProgram({
      program,
      boardRect,
      pieces: [piecePlacement({ id: 'PA', partCode: 'PA', rect: d1.keptRect })],
      trim: { topMm: 0, bottomMm: 0, leftMm: 20, rightMm: 0 },
    });
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, R3_OPTIONS),
      'ptx_compile.trim_frame_unsupported',
    );
    const readiness = evaluateSelectedCuttingOutputReadiness(plan, R3_SELECTION);
    expect(readiness.status).toBe('CONFIGURED');
    if (readiness.status === 'CONFIGURED') {
      expect(readiness.readiness.ready).toBe(false);
      expect(readiness.readiness.reasons.map((reason) => reason.code)).toContain(
        'ptx_compile.trim_frame_unsupported',
      );
    }
  });

  it('mismo material con márgenes ejecutados distintos entre hojas: trim_mapping_ambiguous', () => {
    const buildSheetProgram = (topMm: number): { program: CutProgramInput; pieces: CutPlanPlacedPiece[] } => {
      const boardRect: CutProgramRect = { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 };
      const builder = new ProgramBuilder('board', boardRect);
      const usable = addPerimeterTrims(builder, 'board', {
        topMm,
        bottomMm: 10,
        leftMm: 10,
        rightMm: 10,
      });
      const d1 = builder.divide({ parent: usable, axis: 'y', keptExtentMm: 200, cutId: 'D1' });
      builder.terminal(d1.keptId, 'piece', 'PA');
      builder.terminal(d1.restId!, 'waste');
      return {
        program: builder.build('board'),
        pieces: [piecePlacement({ id: 'PA', partCode: 'PA', rect: d1.keptRect })],
      };
    };
    const first = buildSheetProgram(10);
    const second = buildSheetProgram(0);
    const sheet = (program: CutProgramInput, pieces: CutPlanPlacedPiece[], sheetIndex: number): CutPlanSheet => ({
      sheetIndex,
      strategy: 'saw-guillotine',
      materialCode: 'LAB18',
      materialName: 'Lab Board 18',
      sheetWidthMm: 400,
      sheetLengthMm: 600,
      thicknessMm: 18,
      pieces,
      remnants: [],
      instructions: [],
      cutProgram: program,
      netPiecesAreaM2: 0,
      grossSheetAreaM2: 0,
      usableRemnantAreaM2: 0,
      wasteAreaM2: 0,
      wastePercent: 0,
      yieldPercent: 0,
    });
    const plan: CutPlan = {
      ...planFromProgram({ program: first.program, boardRect: { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 }, pieces: first.pieces, trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 } }),
      sheets: [
        sheet(first.program, first.pieces, 0),
        sheet(second.program, second.pieces, 1),
      ],
    };
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, R3_OPTIONS),
      'ptx_compile.trim_mapping_ambiguous',
    );
  });
});

// ---------------------------------------------------------------------------
// G5 — negativos del subconjunto 92
// ---------------------------------------------------------------------------

describe('r3 — release phase-1 y kept-side no se convierten a 92', () => {
  it('remanente kept-side de un productor phase-2 conserva la fila r2', () => {
    const boardRect: CutProgramRect = { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 400 };
    const builder = new ProgramBuilder('board', boardRect);
    const usable = addPerimeterTrims(builder, 'board', {
      topMm: 10,
      bottomMm: 10,
      leftMm: 10,
      rightMm: 10,
    });
    // strip1 (kept de D1) y R1 con un recut para que strip1 sea gen 2.
    const d1 = builder.divide({ parent: usable, axis: 'y', keptExtentMm: 200, cutId: 'D1' });
    const d1b = builder.divide({ parent: d1.restId!, axis: 'y', keptExtentMm: 150, cutId: 'D1b' });
    // D2: el KEPT es el remnant (kept-side), el resto se procesa productivamente.
    const d2 = builder.divide({ parent: d1.keptId, axis: 'x', keptExtentMm: 250, cutId: 'D2' });
    builder.terminal(d2.keptId, 'remnant'); // kept-side remnant → NO elegible
    const d3 = builder.divide({ parent: d2.restId!, axis: 'y', keptExtentMm: 150, cutId: 'D3' });
    builder.terminal(d3.keptId, 'piece', 'PA');
    builder.terminal(d3.restId!, 'waste');
    builder.terminal(d1b.keptId, 'waste');
    builder.terminal(d1b.restId!, 'waste');
    const program = builder.build('board');
    executeCutProgram(program);
    const plan = planFromProgram({
      program,
      boardRect,
      pieces: [piecePlacement({ id: 'PA', partCode: 'PA', rect: d3.keptRect })],
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
    });
    const doc = runFullChain(plan, R3_OPTIONS);
    const rows = cutsOf(doc);
    expect(rows.filter((row) => row.functionCode === 92)).toHaveLength(0);
    const keptRow = rows.find((row) => row.comment === 'D2:kept');
    expect(keptRow).toBeDefined();
    expect(keptRow!.functionCode).toBe(2); // productor phase-2 cross
    expect(keptRow!.repeatQuantity).toBe(0);
    expect(keptRow!.sequence).toBe(0);
    expect(keptRow!.partReference).toEqual({ kind: 'offcut', offcutIndex: 1 });
  });
});

// ---------------------------------------------------------------------------
// #28 — mutation tests: el verifier detecta lo que el validador de formato no ve
// ---------------------------------------------------------------------------

describe('r3 — mutation tests M1..M8 (verifier independiente)', () => {
  function compiledMain(): { doc: PtxDocument; plan: CutPlan } {
    const fixture = buildMainFixture();
    const compiled = compileCutPlanToPtxDocument(fixture.plan, R3_OPTIONS);
    return { doc: compiled.document, plan: fixture.plan };
  }

  function mappingOf(plan: CutPlan) {
    return compileCutPlanToPtxDocument(plan, R3_OPTIONS).mapping;
  }

  function expectVerifierFails(mutated: PtxDocument, plan: CutPlan, expectedCode: string): void {
    // El validador de formato puede seguir verde: el fallo es semántico.
    const issues = verifyCutPlanPtxReadback(mutated, plan, mappingOf(plan), R3_OPTIONS);
    expect(issues.length).toBeGreaterThan(0);
    expect(issueCodes(issues)).toContain(expectedCode);
  }

  it('M1: TRIM_FRIP 10 → 14', () => {
    const { doc, plan } = compiledMain();
    const mutated = mutateAndParse(doc, (records) =>
      records.map((r) =>
        r.type === 'MATERIALS' ? { ...r, trimFRip: 14 } : r,
      ),
    );
    expect(validatePtxDocument(mutated)).toEqual([]);
    expectVerifierFails(mutated, plan, 'materials.trims');
  });

  it('M2: TRIM_VRIP alterado', () => {
    const { doc, plan } = compiledMain();
    const mutated = mutateAndParse(doc, (records) =>
      records.map((r) => (r.type === 'MATERIALS' ? { ...r, trimVRip: 12 } : r)),
    );
    expect(validatePtxDocument(mutated)).toEqual([]);
    expectVerifierFails(mutated, plan, 'materials.trims');
  });

  it('M3: TRIM_* correcto pero CUTS conserva una división de trim (double counting)', () => {
    const { doc, plan } = compiledMain();
    const mutated = mutateAndParse(doc, (records) => [
      ...records,
      {
        type: 'CUTS',
        jobIndex: 1,
        patternIndex: 1,
        cutIndex: 10,
        sequence: 0,
        functionCode: 1,
        dimension: 590,
        repeatQuantity: 1,
        partReference: { kind: 'none' },
        producedQuantity: 0,
        comment: 'trim:left',
      } as PtxCutRecord,
    ]);
    expect(validatePtxDocument(mutated)).toEqual([]);
    expectVerifierFails(mutated, plan, 'cuts.count');
  });

  it('M4: FUNCTION 92 → 2', () => {
    const { doc, plan } = compiledMain();
    const mutated = mutateAndParse(doc, (records) =>
      records.map((r) =>
        r.type === 'CUTS' && r.functionCode === 92 ? { ...r, functionCode: 2 } : r,
      ),
    );
    expect(validatePtxDocument(mutated)).toEqual([]);
    expectVerifierFails(mutated, plan, 'release.function');
  });

  it('M5: X1 → X2 cruzado', () => {
    const { doc, plan } = compiledMain();
    const mutated = mutateAndParse(doc, (records) =>
      records.map((r) =>
        r.type === 'CUTS' && r.functionCode === 92 && r.partReference.kind === 'offcut' && r.partReference.offcutIndex === 1
          ? { ...r, partReference: { kind: 'offcut', offcutIndex: 2 } }
          : r,
      ),
    );
    expect(validatePtxDocument(mutated)).toEqual([]);
    expectVerifierFails(mutated, plan, 'release.offcut_ref');
  });

  it('M6: DIMENSION de la release alterada', () => {
    const { doc, plan } = compiledMain();
    const mutated = mutateAndParse(doc, (records) =>
      records.map((r) =>
        r.type === 'CUTS' && r.functionCode === 92 && r.dimension === 326 ? { ...r, dimension: 300 } : r,
      ),
    );
    expect(validatePtxDocument(mutated)).toEqual([]);
    expectVerifierFails(mutated, plan, 'release.dimension');
  });

  it('M7a: 92 antes del productor', () => {
    const { doc, plan } = compiledMain();
    const mutated = mutateAndParse(doc, (records) =>
      records.map((r) =>
        r.type === 'CUTS' && r.functionCode === 92 && r.sequence === 4 ? { ...r, sequence: 1 } : r,
      ),
    );
    expect(validatePtxDocument(mutated)).toEqual([]);
    expectVerifierFails(mutated, plan, 'release.sequence');
  });

  it('M7b: 92 después del recut dependiente', () => {
    const { doc, plan } = compiledMain();
    const mutated = mutateAndParse(doc, (records) =>
      records.map((r) =>
        r.type === 'CUTS' && r.functionCode === 92 && r.sequence === 4 ? { ...r, sequence: 7 } : r,
      ),
    );
    expect(validatePtxDocument(mutated)).toEqual([]);
    expectVerifierFails(mutated, plan, 'release.sequence');
  });

  it('M8: mismo Xn referenciado por dos releases físicas', () => {
    const { doc, plan } = compiledMain();
    const mutated = mutateAndParse(doc, (records) =>
      records.map((r) =>
        r.type === 'CUTS' && r.functionCode === 92 && r.partReference.kind === 'offcut' && r.partReference.offcutIndex === 2
          ? { ...r, partReference: { kind: 'offcut', offcutIndex: 1 } }
          : r,
      ),
    );
    expect(validatePtxDocument(mutated)).toEqual([]);
    expectVerifierFails(mutated, plan, 'release.offcut_duplicate');
  });

  it('M9: PTX intacto pero una banda descartada deja de ser waste liberado', () => {
    const fixture = buildMainFixture();
    const compiled = compileCutPlanToPtxDocument(fixture.plan, R3_OPTIONS);
    const sheet = fixture.plan.sheets[0]!;
    const cutProgram = sheet.cutProgram!;
    const mutatedPlan: CutPlan = {
      ...fixture.plan,
      sheets: [
        {
          ...sheet,
          cutProgram: {
            ...cutProgram,
            terminals: cutProgram.terminals.map((terminal) =>
              terminal.regionId === 'trim:left:rest'
                ? { ...terminal, liberated: false }
                : terminal,
            ),
          },
        },
      ],
    };
    executeCutProgram(mutatedPlan.sheets[0]!.cutProgram!);
    const parsed = mutateAndParse(compiled.document, (records) => records);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(issueCodes(
      verifyCutPlanPtxReadback(parsed, mutatedPlan, compiled.mapping, R3_OPTIONS),
    )).toContain('trim.discarded_terminal');
  });
});
