/**
 * #650 PR 5 — CutProgram → PtxDocument compiler tests.
 *
 * Flagship chain (the issue's required demonstration):
 *   optimizeCutPlan → validated cutProgram → compileCutPlanToPtxDocument
 *   → validatePtxDocument → serializePtxDocumentBytes → parsePtxDocumentBytes
 *   → verifyCutPlanPtxReadback === [].
 *
 * The didactic dossier exercise (1200×700, kerf 4, A 450×320 + B 280×210,
 * docs/machines/ptx-cadmatic4/examples/01) is reproduced through the REAL
 * strip heuristic: its compiled CUTS rows must match the documented fragment
 * (CUT_A..CUT_D) — same functions, same relative dimensions (never global
 * coordinates: 280, not 734), same part references.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUT_PLAN_CONFIG,
  divideRegion,
  executeCutProgram,
  optimizeCutPlan,
  packSingleSheetStrip,
  projectCutProgram,
  type CutInstruction,
  type CutPlan,
  type CutPlanConfig,
  type CutPlanPlacedPiece,
  type CutPlanRemnant,
  type CutPlanSheet,
  type CutProgramInput,
  type CutProgramRect,
  type MaterialBoard,
  type ProductionCutRow,
} from '@granete/domain';
import type { PtxCutRecord, PtxDocument, PtxRecord } from './records';
import { ptxDocumentsEqual } from './equivalence';
import { parsePtxDocumentBytes, parsePtxDocumentText } from './parse';
import { serializePtxDocument, serializePtxDocumentBytes } from './serialize';
import { validatePtxDocument } from './validate';
import {
  PtxCompilationError,
  compileCutPlanToPtxDocument,
  type CompileCutPlanToPtxOptions,
} from './compileCutPlan';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LAB_MATERIALS: MaterialBoard[] = [
  {
    id: 'mat-lab',
    code: 'LAB18',
    name: 'Lab Board 18',
    costPerM2: 10,
    wastePercent: 10,
    lengthMm: 1200,
    widthMm: 700,
    thicknessMm: 18,
    grainDefault: true,
    boardPrice: 8,
    active: true,
  },
  {
    id: 'mat-small',
    code: 'SML18',
    name: 'Lab Small 18',
    costPerM2: 10,
    wastePercent: 10,
    lengthMm: 600,
    widthMm: 400,
    thicknessMm: 18,
    grainDefault: true,
    boardPrice: 5,
    active: true,
  },
];

const WITH_VECTORS: CompileCutPlanToPtxOptions = {
  headerVersion: 1,
  headerOrigin: 0,
  trimType: 1,
  title: 'LAB_FIXTURE NOT_MACHINE_VALIDATED',
  decimalPlaces: 2,
  includeVectors: true,
};

const WITHOUT_VECTORS: CompileCutPlanToPtxOptions = {
  headerVersion: 1,
  headerOrigin: 0,
  trimType: 0,
  title: 'LAB_FIXTURE NOT_MACHINE_VALIDATED',
  decimalPlaces: 2,
};

/** trim = 0 (the first candidate's supported trim policy), kerf 4. */
const BASE_CONFIG: CutPlanConfig = {
  ...DEFAULT_CUT_PLAN_CONFIG,
  sawKerfMm: 4,
  trim: { topMm: 0, bottomMm: 0, leftMm: 0, rightMm: 0 },
};

/** Remnant threshold low enough to keep the dossier's 1200×376 sheet rest useful. */
const DIDACTIC_CONFIG: CutPlanConfig = {
  ...BASE_CONFIG,
  minRemnantLengthMm: 400,
  minRemnantWidthMm: 300,
};

function makeRow(params: {
  quantity: number;
  lengthMm: number;
  widthMm: number;
  grain: 0 | 1;
  partCode: string;
  materialName?: string;
  materialCode?: string;
}): ProductionCutRow {
  return {
    quantity: params.quantity,
    lengthMm: params.lengthMm,
    widthMm: params.widthMm,
    description: `${params.partCode} lab`,
    materialName: params.materialName ?? 'Lab Board 18',
    materialCode: params.materialCode ?? (params.materialName ? 'SML18' : 'LAB18'),
    grain: params.grain,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
    partCode: params.partCode,
    partName: params.partCode,
    moduleCode: 'M01',
    thicknessMm: 18,
  };
}

/**
 * Local mirror of the domain's unrollRows for lab rows without edge banding
 * (L1..W2 are 0 in every fixture here, so the deduction is exactly zero):
 * same id format, same expansion, same order.
 */
function unroll(rows: readonly ProductionCutRow[]): {
  originalRow: ProductionCutRow;
  indexInUnrolled: number;
  length: number;
  width: number;
  grain: 0 | 1;
  id: string;
}[] {
  const result: {
    originalRow: ProductionCutRow;
    indexInUnrolled: number;
    length: number;
    width: number;
    grain: 0 | 1;
    id: string;
  }[] = [];
  let seq = 0;
  for (const row of rows) {
    const qty = Math.max(1, row.quantity);
    for (let i = 0; i < qty; i++) {
      seq++;
      result.push({
        originalRow: row,
        indexInUnrolled: seq,
        length: Math.max(1, row.lengthMm),
        width: Math.max(1, row.widthMm),
        grain: row.grain,
        id: `${row.partCode || 'P'}-${seq}`,
      });
    }
  }
  return result;
}

/** Structural stand-in for the optimizer's PlacementResult (not exported at the domain root). */
interface LabPlacement {
  readonly pieces: readonly CutPlanPlacedPiece[];
  readonly remnants: readonly CutPlanRemnant[];
  readonly instructions: readonly CutInstruction[];
  readonly sheetIndex: number;
  readonly sheetWidthMm: number;
  readonly sheetLengthMm: number;
  readonly materialCode: string;
  readonly materialName: string;
  readonly thicknessMm?: number;
  readonly strategy?: CutPlanSheet['strategy'];
  readonly cutProgram?: CutProgramInput;
}

function sheetFromPlacement(
  placement: LabPlacement,
  overrides: Partial<CutPlanSheet> = {},
): CutPlanSheet {
  const grossSheetAreaM2 = (placement.sheetLengthMm * placement.sheetWidthMm) / 1_000_000;
  const netPiecesAreaM2 = placement.pieces.reduce(
    (sum, piece) => sum + (piece.lengthMm * piece.widthMm) / 1_000_000,
    0,
  );
  const usableRemnantAreaM2 = placement.remnants.reduce(
    (sum, rem) => (rem.isUseful ? sum + rem.areaM2 : sum),
    0,
  );
  const wasteAreaM2 = Math.max(0, grossSheetAreaM2 - netPiecesAreaM2 - usableRemnantAreaM2);
  return {
    sheetIndex: placement.sheetIndex,
    strategy: placement.strategy ?? 'saw-guillotine',
    materialCode: placement.materialCode,
    materialName: placement.materialName,
    sheetWidthMm: placement.sheetWidthMm,
    sheetLengthMm: placement.sheetLengthMm,
    thicknessMm: placement.thicknessMm,
    pieces: placement.pieces,
    remnants: placement.remnants,
    instructions: placement.instructions,
    cutProgram: placement.cutProgram,
    netPiecesAreaM2,
    grossSheetAreaM2,
    usableRemnantAreaM2,
    wasteAreaM2,
    wastePercent: Math.round((wasteAreaM2 / grossSheetAreaM2) * 1000) / 10,
    yieldPercent: Math.round((netPiecesAreaM2 / grossSheetAreaM2) * 1000) / 10,
    ...overrides,
  };
}

function planFromSheets(
  sheets: readonly CutPlanSheet[],
  config: CutPlanConfig,
  projectId = 'lab-650',
): CutPlan {
  return {
    id: 'cutplan-lab-650',
    projectId,
    projectName: 'Lab 650',
    generatedAt: '2026-09-11T00:00:00.000Z',
    version: 1,
    isFrozen: false,
    config,
    sheets,
    stats: {
      totalSheets: sheets.length,
      totalPieces: sheets.reduce((sum, s) => sum + s.pieces.length, 0),
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

/** The full required chain over a real optimizeCutPlan result. */
function runFullChain(plan: CutPlan, options: CompileCutPlanToPtxOptions): PtxDocument {
  for (const sheet of plan.sheets) {
    expect(sheet.cutProgram).toBeDefined();
    expect(() => executeCutProgram(sheet.cutProgram!)).not.toThrow();
  }
  const compiled = compileCutPlanToPtxDocument(plan, options);
  expect(validatePtxDocument(compiled.document)).toEqual([]);
  const bytes = serializePtxDocumentBytes(compiled.document, {
    decimalPlaces: options.decimalPlaces,
  });
  const parsed = parsePtxDocumentBytes(bytes);
  expect(validatePtxDocument(parsed)).toEqual([]);
  expect(ptxDocumentsEqual(parsed, compiled.document)).toBe(true);
  expect(verifyCutPlanPtxReadback(parsed, plan, compiled.mapping, options)).toEqual([]);
  return parsed;
}

function cutsOf(doc: PtxDocument, patternIndex = 1): PtxCutRecord[] {
  return doc.records.filter(
    (record): record is PtxCutRecord => record.type === 'CUTS' && record.patternIndex === patternIndex,
  );
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

/** Serialize → apply a record-level mutation → parse (validity preserved). */
function mutateAndParse(doc: PtxDocument, mutate: (records: PtxRecord[]) => PtxRecord[]): PtxDocument {
  return parsePtxDocumentText(
    serializePtxDocument({ header: doc.header, records: mutate([...doc.records]) }),
  );
}

/** A placed piece literal for hand-built programs. */
function labPiece(
  id: string,
  rect: CutProgramRect,
  partCode: string,
  overrides: Partial<CutPlanPlacedPiece> = {},
): CutPlanPlacedPiece {
  return {
    id,
    partCode,
    partName: partCode,
    moduleCode: 'M01',
    labelRef: id,
    materialName: 'Lab Board 18',
    materialCode: 'LAB18',
    xMm: rect.xMm,
    yMm: rect.yMm,
    lengthMm: rect.lengthMm,
    widthMm: rect.widthMm,
    originalLengthMm: rect.lengthMm,
    originalWidthMm: rect.widthMm,
    grain: 1,
    rotated: false,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
    thicknessMm: 18,
    sheetIndex: 0,
    stripIndex: 0,
    cutSequenceNumber: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Caso A — básico (1 material, 1 tablero, 2 piezas, trim 0, kerf 4)
// ---------------------------------------------------------------------------

describe('Caso A — cadena completa sobre plan real básico', () => {
  const rows = [
    makeRow({ quantity: 1, lengthMm: 450, widthMm: 350, grain: 1, partCode: 'P1' }),
    makeRow({ quantity: 1, lengthMm: 450, widthMm: 350, grain: 1, partCode: 'P2' }),
  ];

  it('compila, valida, serializa, lee y comprueba semánticamente; máximo FUNCTION 2', () => {
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, BASE_CONFIG);
    expect(plan.sheets).toHaveLength(1);
    const parsed = runFullChain(plan, WITHOUT_VECTORS);
    const divisions = parsed.records.filter(
      (r): r is PtxCutRecord => r.type === 'CUTS' && r.sequence > 0,
    );
    expect(divisions.length).toBeGreaterThanOrEqual(2);
    for (const row of divisions) {
      expect(row.functionCode).toBeLessThanOrEqual(2);
    }
  });

  it('la misma cadena con vectores', () => {
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, BASE_CONFIG);
    runFullChain(plan, WITH_VECTORS);
  });

  it('es determinista: mismo documento, mismo mapping y mismos bytes', () => {
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, BASE_CONFIG);
    const first = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    const second = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    expect(second.document).toEqual(first.document);
    expect([...second.mapping.partIndexByPieceRef]).toEqual([...first.mapping.partIndexByPieceRef]);
    expect([...second.mapping.materialIndexByCode]).toEqual([...first.mapping.materialIndexByCode]);
    expect(second.mapping.pieceRefByPartIndex).toEqual(first.mapping.pieceRefByPartIndex);
    expect(second.mapping.offcutRegionRefByOffcutIndex).toEqual(first.mapping.offcutRegionRefByOffcutIndex);
    const bytesOf = (doc: PtxDocument): string =>
      JSON.stringify([...serializePtxDocumentBytes(doc, { decimalPlaces: 2 })]);
    expect(bytesOf(second.document)).toBe(bytesOf(first.document));
  });
});

// ---------------------------------------------------------------------------
// Caso B — tercera fase (ejercicio didáctico del dossier)
// ---------------------------------------------------------------------------

describe('Caso B — ejercicio didáctico (1200×700, kerf 4, A 450×320 + B 280×210)', () => {
  function buildDidacticPlan(): CutPlan {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'B' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      1200,
      700,
      DIDACTIC_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    return planFromSheets([sheetFromPlacement(sheet)], DIDACTIC_CONFIG);
  }

  it('reproduce las filas CUT_A..CUT_D documentadas y protege DIMENSION = 280 ≠ 734', () => {
    const plan = buildDidacticPlan();
    const compiled = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    const divisions = cutsOf(compiled.document).filter((r) => r.sequence > 0);

    expect(divisions).toHaveLength(4);
    // CUT_A: franja de 320 — fase 1, eje y → rip (1)
    expect(divisions[0]).toMatchObject({
      sequence: 1,
      functionCode: 1,
      dimension: 320,
      repeatQuantity: 1,
      partReference: { kind: 'none' },
      producedQuantity: 0,
      comment: 'strip-1',
    });
    // CUT_B: troceado de 450 que produce A — fase 2, eje x → cross (2)
    expect(divisions[1]).toMatchObject({
      sequence: 2,
      functionCode: 2,
      dimension: 450,
      partReference: { kind: 'part', partIndex: 1 },
      producedQuantity: 1,
      comment: 'place-1-x',
    });
    // CUT_C: bloque de 280 desde el resto de franja — fase 2, eje x → cross (2).
    // La coordenada global del borde conservado es 734: DIMENSION es 280.
    expect(divisions[2]).toMatchObject({
      sequence: 3,
      functionCode: 2,
      dimension: 280,
      partReference: { kind: 'none' },
      comment: 'place-2-x',
    });
    expect(divisions[2]!.dimension).not.toBe(734);
    // CUT_D: recorte de 210 que produce B — fase 3 → recut (3)
    expect(divisions[3]).toMatchObject({
      sequence: 4,
      functionCode: 3,
      dimension: 210,
      partReference: { kind: 'part', partIndex: 2 },
      producedQuantity: 1,
      comment: 'place-2-y',
    });

    const pattern = compiled.document.records.find(
      (r) => r.type === 'PATTERNS',
    ) as { patternType: number };
    expect(pattern.patternType).toBe(0); // staging por franja longitudinal
  });

  it('emite liberación QTY_RPT=0 para el retazo y OFFCUTS con sus medidas', () => {
    const plan = buildDidacticPlan();
    const compiled = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    const releases = cutsOf(compiled.document).filter((r) => r.sequence === 0);

    // El sobrante de franja 462×320 queda como desperdicio bajo la política
    // de retazos útiles del dominio (0.148 m² < 0.24 m²): no es stock
    // retornable y no se declara OFFCUTS. Sólo el resto de tablero 1200×376
    // vuelve como retazo con su fila de liberación.
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({
      sequence: 0,
      functionCode: 1, // producido por strip-1 (fase 1, eje y)
      dimension: 376, // resto a lo largo del eje de la división productora
      repeatQuantity: 0,
      partReference: { kind: 'offcut', offcutIndex: 1 },
      producedQuantity: 1,
    });

    const offcuts = compiled.document.records.filter((r) => r.type === 'OFFCUTS');
    expect(offcuts).toHaveLength(1);
    expect(offcuts[0]).toMatchObject({ offcutIndex: 1, length: 1200, width: 376 });
  });

  it('vectores: líneas absolutas del borde de banda alejado del lado conservado', () => {
    const plan = buildDidacticPlan();
    const compiled = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    const vectors = compiled.document.records.filter((r) => r.type === 'VECTORS');
    expect(vectors).toHaveLength(4);

    // CUT_A (strip-1): banda 320..324 desde abajo → yTop = 700 − 324 = 376,
    // abarcando el padre (tablero completo) en X.
    expect(vectors[0]).toMatchObject({
      patternIndex: 1,
      cutIndex: 1,
      xStart: 0,
      yStart: 376,
      xEnd: 1200,
      yEnd: 376,
    });
    // CUT_B (place-1-x): banda 450..454 → x = 454, franja y 0..320 → yTop 700..380.
    expect(vectors[1]).toMatchObject({
      cutIndex: 2,
      xStart: 454,
      yStart: 700,
      xEnd: 454,
      yEnd: 380,
    });
    // CUT_D (place-2-y): bloque en (454,0), banda 210..214 → yTop = 486, x 454..734.
    expect(vectors[3]).toMatchObject({
      cutIndex: 4,
      xStart: 454,
      yStart: 486,
      xEnd: 734,
      yEnd: 486,
    });
  });

  it('exact-fit: la pieza A llena la altura de su columna y no genera fila ficticia', () => {
    const plan = buildDidacticPlan();
    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    // 2 piezas pero sólo 4 pasadas: A queda terminal de place-1-x (su recorte
    // Y sería exact-fit) — ninguna fila CUTS existe sólo para asignarle
    // PART_INDEX.
    const divisions = cutsOf(compiled.document).filter((r) => r.sequence > 0);
    expect(divisions).toHaveLength(4);
    expect(divisions.map((r) => r.comment)).toEqual(['strip-1', 'place-1-x', 'place-2-x', 'place-2-y']);
    // place-1-x referencia la pieza A que su pasada hizo disponible.
    expect(divisions[1]).toMatchObject({
      partReference: { kind: 'part', partIndex: 1 },
      producedQuantity: 1,
    });
  });

  it('el preview (proyección de dominio) y el PTX muestran la misma operación', () => {
    const plan = buildDidacticPlan();
    const sheet = plan.sheets[0]!;
    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    const rowsByCutId = new Map(
      cutsOf(compiled.document)
        .filter((r) => r.sequence > 0)
        .map((r) => [compiled.mapping.sheets[0]!.cutIdByCutIndex[r.cutIndex - 1]!, r]),
    );
    const material = compiled.document.records.find((r) => r.type === 'MATERIALS') as {
      kerfRip: number;
    };

    const projection = projectCutProgram(
      executeCutProgram(sheet.cutProgram!),
      sheet.pieces,
      sheet.remnants,
    );
    expect(projection.steps).toHaveLength(4);
    for (const step of projection.steps) {
      const row = rowsByCutId.get(step.cutId);
      expect(row).toBeDefined();
      // MISMO dato fundamental: la medida relativa conservada, no la línea
      // global del preview.
      expect(row!.dimension).toBe(step.keptExtentMm);
      expect(row!.sequence).toBe(step.stepNumber);
      // Contexto de kerf compartido entre preview y MATERIALS.
      expect(step.nominalKerfMm).toBe(material.kerfRip);
      if (step.producedPiece) {
        expect(row!.partReference).toEqual({
          kind: 'part',
          partIndex: compiled.mapping.partIndexByPieceRef.get(step.producedPiece.id),
        });
      }
    }

    // Caso explícito del dossier: el preview dibuja la línea local de 280 mm
    // del bloque (cutLine.x1 = 734 global); el PTX lleva DIMENSION = 280.
    const blockStep = projection.steps.find((s) => s.cutId === 'place-2-x')!;
    expect(blockStep.keptExtentMm).toBe(280);
    expect(blockStep.cutLine.x1).toBe(734);
    expect(rowsByCutId.get('place-2-x')!.dimension).toBe(280);
    expect(rowsByCutId.get('place-2-x')!.dimension).not.toBe(blockStep.cutLine.x1);
  });
});

// ---------------------------------------------------------------------------
// Caso C — decimales (333.3 con kerf 3.2)
// ---------------------------------------------------------------------------

describe('Caso C — medidas decimales y representabilidad', () => {
  const DECIMAL_OPTIONS: CompileCutPlanToPtxOptions = {
    headerVersion: 1,
    headerOrigin: 0,
    trimType: 0,
    title: 'LAB_FIXTURE NOT_MACHINE_VALIDATED',
    decimalPlaces: 1,
  };
  const DECIMAL_CONFIG: CutPlanConfig = { ...BASE_CONFIG, sawKerfMm: 3.2 };
  const rows = [makeRow({ quantity: 1, lengthMm: 333.3, widthMm: 200, grain: 1, partCode: 'D1' })];

  it('conserva 333.3 y kerf 3.2 sin redondear', () => {
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, DECIMAL_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, DECIMAL_OPTIONS);
    const material = compiled.document.records.find((r) => r.type === 'MATERIALS') as {
      kerfRip: number;
      kerfCrosscut: number;
    };
    expect(material.kerfRip).toBe(3.2);
    expect(material.kerfCrosscut).toBe(3.2);
    const pieceRow = compiled.document.records.find((r) => r.type === 'PARTS_REQ') as {
      length: number;
    };
    expect(pieceRow.length).toBe(333.3);
    const divisionRows = compiled.document.records.filter(
      (r): r is PtxCutRecord => r.type === 'CUTS' && r.sequence > 0,
    );
    expect(divisionRows.some((r) => r.dimension === 333.3)).toBe(true);
    expect(verifyCutPlanPtxReadback(
      parsePtxDocumentBytes(
        serializePtxDocumentBytes(compiled.document, { decimalPlaces: DECIMAL_OPTIONS.decimalPlaces }),
      ),
      plan,
      compiled.mapping,
      DECIMAL_OPTIONS,
    )).toEqual([]);
  });

  it('falla cerrado cuando el valor no cabe en la resolución configurada', () => {
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, DECIMAL_CONFIG);
    expectCompilationError(
      () =>
        compileCutPlanToPtxDocument(plan, {
          ...DECIMAL_OPTIONS,
          decimalPlaces: 0,
        }),
      'ptx_compile.magnitude_not_representable',
    );
  });
});

// ---------------------------------------------------------------------------
// Caso D — offcut 500×796 con referencia Xn
// ---------------------------------------------------------------------------

describe('Caso D — retazo obligatorio 500×796 con Xn', () => {
  it('conserva el OFFCUT y la fila relacional QTY_RPT=0 sin pasada física', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 600, widthMm: 1000, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 500, widthMm: 200, grain: 1, partCode: 'B' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      1200,
      1000,
      DIDACTIC_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    const plan = planFromSheets([sheetFromPlacement(sheet)], DIDACTIC_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);

    const offcuts = compiled.document.records.filter((r) => r.type === 'OFFCUTS');
    expect(offcuts).toHaveLength(1);
    expect(offcuts[0]).toMatchObject({ offcutIndex: 1, length: 500, width: 796 });
    expect(compiled.mapping.offcutRegionRefByOffcutIndex).toEqual([
      { sheetIndex: 0, regionId: 'place-2-y:rest' },
    ]);

    const releases = cutsOf(compiled.document).filter((r) => r.sequence === 0);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({
      sequence: 0,
      repeatQuantity: 0,
      dimension: 796,
      partReference: { kind: 'offcut', offcutIndex: 1 },
    });
    // La liberación no añade una pasada: las divisiones reales son 3.
    expect(cutsOf(compiled.document).filter((r) => r.sequence > 0)).toHaveLength(3);

    expect(verifyCutPlanPtxReadback(
      parsePtxDocumentBytes(
        serializePtxDocumentBytes(compiled.document, { decimalPlaces: WITHOUT_VECTORS.decimalPlaces }),
      ),
      plan,
      compiled.mapping,
      WITHOUT_VECTORS,
    )).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Caso E — dos formatos del mismo material
// ---------------------------------------------------------------------------

describe('Caso E — dos formatos de stock del mismo material', () => {
  it('produce 1 MATERIALS y 2 BOARDS sin perder identidad de stock', () => {
    const rowA = [makeRow({ quantity: 1, lengthMm: 2000, widthMm: 1600, grain: 1, partCode: 'G1', materialCode: 'MDF18' })];
    const rowB = [makeRow({ quantity: 1, lengthMm: 2400, widthMm: 1500, grain: 1, partCode: 'G2', materialCode: 'MDF18' })];
    const first = packSingleSheetStrip(unroll(rowA), 0, 2440, 1830, BASE_CONFIG, 'MDF18', 'MDF Blanco 18', 18);
    const second = packSingleSheetStrip(unroll(rowB), 1, 2750, 1830, BASE_CONFIG, 'MDF18', 'MDF Blanco 18', 18);
    const plan = planFromSheets(
      [sheetFromPlacement(first.sheet), sheetFromPlacement(second.sheet)],
      BASE_CONFIG,
    );

    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    const materials = compiled.document.records.filter((r) => r.type === 'MATERIALS');
    const boards = compiled.document.records.filter((r) => r.type === 'BOARDS');
    const patterns = compiled.document.records.filter((r) => r.type === 'PATTERNS');
    expect(materials).toHaveLength(1);
    expect(boards).toHaveLength(2);
    expect(patterns).toHaveLength(2);
    expect(boards[0]).toMatchObject({ length: 2440, width: 1830 });
    expect(boards[1]).toMatchObject({ length: 2750, width: 1830 });
    expect(compiled.mapping.sheetIndexByPatternIndex).toEqual([0, 1]);
    // Campos distintos, nunca sinónimos: MATERIALS.BOOK (una fila por
    // material) vs PATTERNS.QTY_RUN/QTY_CYCLES/MAX_BOOK (una fila por
    // patrón) vs BOARDS.QTY_STOCK/QTY_USED (una fila por tablero).
    expect(materials[0]).toMatchObject({ bookQuantity: 1 });
    for (const pattern of patterns) {
      expect(pattern).toMatchObject({ runQuantity: 1, cyclesQuantity: 1, maxBook: 1 });
    }
    for (const board of boards) {
      expect(board).toMatchObject({ stockQuantity: 1, usedQuantity: 1 });
    }

    expect(verifyCutPlanPtxReadback(
      parsePtxDocumentBytes(
        serializePtxDocumentBytes(compiled.document, { decimalPlaces: WITHOUT_VECTORS.decimalPlaces }),
      ),
      plan,
      compiled.mapping,
      WITHOUT_VECTORS,
    )).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Caso F — múltiples sheets: los índices no se cruzan
// ---------------------------------------------------------------------------

describe('Caso F — plan multi-tablero con índices independientes', () => {
  it('reinicia CUT_INDEX por patrón y mantiene PART_INDEX único por job', () => {
    const rows = [
      makeRow({ quantity: 4, lengthMm: 450, widthMm: 350, grain: 1, partCode: 'P', materialName: 'Lab Small 18' }),
    ];
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, BASE_CONFIG);
    expect(plan.sheets.length).toBeGreaterThanOrEqual(2);

    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    const patterns = plan.sheets.map((_, i) => i + 1);
    for (const patternIndex of patterns) {
      const divisionRows = cutsOf(compiled.document, patternIndex).filter((r) => r.sequence > 0);
      expect(divisionRows.map((r) => r.cutIndex)).toEqual(
        divisionRows.map((_, i) => i + 1),
      );
    }
    const parts = compiled.document.records.filter((r) => r.type === 'PARTS_REQ');
    expect(parts.map((p) => (p as { partIndex: number }).partIndex)).toEqual([1, 2, 3, 4]);
    expect(compiled.mapping.pieceRefByPartIndex).toHaveLength(4);
    expect(new Set(compiled.mapping.pieceRefByPartIndex).size).toBe(4);

    expect(verifyCutPlanPtxReadback(
      parsePtxDocumentBytes(
        serializePtxDocumentBytes(compiled.document, { decimalPlaces: WITHOUT_VECTORS.decimalPlaces }),
      ),
      plan,
      compiled.mapping,
      WITHOUT_VECTORS,
    )).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Caso G — piezas idénticas: la identidad no se pierde ni se cruza
// ---------------------------------------------------------------------------

describe('Caso G — piezas idénticas con identidad separada', () => {
  it('dos PARTS_REQ correctos en vez de una agregación dudosa, sin cruces', () => {
    const rows = [makeRow({ quantity: 2, lengthMm: 450, widthMm: 350, grain: 1, partCode: 'SAME' })];
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, BASE_CONFIG);
    expect(plan.sheets).toHaveLength(1);

    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    const parts = compiled.document.records.filter((r) => r.type === 'PARTS_REQ');
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => (p as { partIndex: number }).partIndex)).toEqual([1, 2]);
    expect(parts.every((p) => (p as { code: string }).code === 'SAME')).toBe(true);
    expect(compiled.mapping.pieceRefByPartIndex[0]).not.toBe(compiled.mapping.pieceRefByPartIndex[1]);

    // Cada pasada que libera una pieza apunta a SU PART_INDEX.
    const pieceRows = cutsOf(compiled.document).filter((r) => r.partReference.kind === 'part');
    expect(pieceRows).toHaveLength(2);
    expect(new Set(pieceRows.map((r) => (r.partReference as { partIndex: number }).partIndex))).toEqual(new Set([1, 2]));

    expect(verifyCutPlanPtxReadback(
      parsePtxDocumentBytes(
        serializePtxDocumentBytes(compiled.document, { decimalPlaces: WITHOUT_VECTORS.decimalPlaces }),
      ),
      plan,
      compiled.mapping,
      WITHOUT_VECTORS,
    )).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Grain — mapeo explícito Granete → PtxGrain
// ---------------------------------------------------------------------------

describe('Grain — mapeo explícito al diccionario PTX', () => {
  it('grain 0 (libre) → 0 y grain 1 (sin giro respecto a longitud) → 1', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 350, grain: 0, partCode: 'FREE' }),
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 350, grain: 1, partCode: 'GRAINED' }),
    ];
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, BASE_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    const parts = compiled.document.records
      .filter((r): r is (PtxRecord & { grain: number; code: string }) => r.type === 'PARTS_REQ')
      .sort((a, b) => a.code.localeCompare(b.code));
    expect(parts.map((p) => [p.code, p.grain])).toEqual([
      ['FREE', 0],
      ['GRAINED', 1],
    ]);
  });
});

// ---------------------------------------------------------------------------
// CUT_INDEX (estructura) vs SEQUENCE (orden operativo)
// ---------------------------------------------------------------------------

describe('CUT_INDEX ≠ SEQUENCE — estructura y orden operativo no son intercambiables', () => {
  it('programa con subárboles intercalados: filas en preorder, SEQUENCE ejecución', () => {
    const board = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
    const dA = divideRegion(board, 'x', 900, 4); // board → K1 | R1
    const dB = divideRegion(dA.restRect!, 'y', 300, 4); // R1 → K2 | R2 (ejecución 2ª)
    const dC = divideRegion(dA.keptRect, 'y', 400, 4); // K1 → K3 | R3 (ejecución 3ª)
    // Orden de ejecución: dA, dB, dC (dB divide el resto ANTES de terminar el
    // subárbol conservado). Preorder estructural: dA, dC (kept primero), dB.
    const program: CutProgramInput = {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: 'board',
      regions: [
        { regionId: 'board', rect: board },
        { regionId: 'k1', rect: dA.keptRect },
        { regionId: 'r1', rect: dA.restRect! },
        { regionId: 'k2', rect: dB.keptRect },
        { regionId: 'r2', rect: dB.restRect! },
        { regionId: 'k3', rect: dC.keptRect },
        { regionId: 'r3', rect: dC.restRect! },
      ],
      divisions: [
        { cutId: 'cutA', parentRegionId: 'board', axis: 'x', keptExtentMm: 900, kerfMm: 4, keptRegionId: 'k1', restRegionId: 'r1' },
        { cutId: 'cutB', parentRegionId: 'r1', axis: 'y', keptExtentMm: 300, kerfMm: 4, keptRegionId: 'k2', restRegionId: 'r2' },
        { cutId: 'cutC', parentRegionId: 'k1', axis: 'y', keptExtentMm: 400, kerfMm: 4, keptRegionId: 'k3', restRegionId: 'r3' },
      ],
      terminals: [
        { regionId: 'k2', kind: 'piece', pieceRef: 'pB-s0' },
        { regionId: 'r2', kind: 'waste' },
        { regionId: 'k3', kind: 'piece', pieceRef: 'pC-s0' },
        { regionId: 'r3', kind: 'waste' },
      ],
    };
    const sheet: CutPlanSheet = sheetFromPlacement({
      pieces: [labPiece('pB-s0', dB.keptRect, 'PB'), labPiece('pC-s0', dC.keptRect, 'PC')],
      remnants: [],
      instructions: [],
      sheetIndex: 0,
      sheetWidthMm: 600,
      sheetLengthMm: 1000,
      materialCode: 'LAB18',
      materialName: 'Lab Board 18',
      thicknessMm: 18,
      cutProgram: program,
    });
    const plan = planFromSheets([sheet], BASE_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    const rows = cutsOf(compiled.document).filter((r) => r.sequence > 0);

    // Filas en preorder (cutA, cutC, cutB) con SEQUENCE de ejecución (1, 3, 2):
    // como el fragmento 03 del dossier, donde STRIP_B tiene SEQUENCE=2 y
    // CUT_INDEX posterior a los hijos de la primera franja.
    expect(rows.map((r) => [r.comment, r.cutIndex, r.sequence])).toEqual([
      ['cutA', 1, 1],
      ['cutC', 2, 3],
      ['cutB', 3, 2],
    ]);
    expect(compiled.mapping.sheets[0]!.cutIdByCutIndex).toEqual(['cutA', 'cutC', 'cutB']);

    expect(verifyCutPlanPtxReadback(
      parsePtxDocumentBytes(
        serializePtxDocumentBytes(compiled.document, { decimalPlaces: WITHOUT_VECTORS.decimalPlaces }),
      ),
      plan,
      compiled.mapping,
      WITHOUT_VECTORS,
    )).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FUNCTION — fase 3 sobre X es 3, nunca 1/2 por el eje
// ---------------------------------------------------------------------------

describe('FUNCTION — una operación sobre X en tercera fase produce 3', () => {
  it('clasifica por fase del árbol, no por eje global', () => {
    const board = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
    const d1 = divideRegion(board, 'y', 500, 4); // fase 1 (eje y → 1)
    const d2 = divideRegion(d1.keptRect, 'x', 400, 4); // fase 2 (eje x → 2)
    const d3 = divideRegion(d2.keptRect, 'x', 200, 4); // fase 3 SOBRE X → 3
    const program: CutProgramInput = {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: 'board',
      regions: [
        { regionId: 'board', rect: board },
        { regionId: 'k1', rect: d1.keptRect },
        { regionId: 'r1', rect: d1.restRect! },
        { regionId: 'k2', rect: d2.keptRect },
        { regionId: 'r2', rect: d2.restRect! },
        { regionId: 'k3', rect: d3.keptRect },
        { regionId: 'r3', rect: d3.restRect! },
      ],
      divisions: [
        { cutId: 'f1', parentRegionId: 'board', axis: 'y', keptExtentMm: 500, kerfMm: 4, keptRegionId: 'k1', restRegionId: 'r1' },
        { cutId: 'f2', parentRegionId: 'k1', axis: 'x', keptExtentMm: 400, kerfMm: 4, keptRegionId: 'k2', restRegionId: 'r2' },
        { cutId: 'f3', parentRegionId: 'k2', axis: 'x', keptExtentMm: 200, kerfMm: 4, keptRegionId: 'k3', restRegionId: 'r3' },
      ],
      terminals: [
        { regionId: 'k3', kind: 'piece', pieceRef: 'p1-s0' },
        { regionId: 'r1', kind: 'waste' },
        { regionId: 'r2', kind: 'waste' },
        { regionId: 'r3', kind: 'waste' },
      ],
    };
    const sheet: CutPlanSheet = sheetFromPlacement({
      pieces: [labPiece('p1-s0', d3.keptRect, 'P1')],
      remnants: [],
      instructions: [],
      sheetIndex: 0,
      sheetWidthMm: 600,
      sheetLengthMm: 1000,
      materialCode: 'LAB18',
      materialName: 'Lab Board 18',
      thicknessMm: 18,
      cutProgram: program,
    });
    const plan = planFromSheets([sheet], BASE_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    const rows = cutsOf(compiled.document).filter((r) => r.sequence > 0);
    expect(rows.map((r) => [r.comment, r.functionCode])).toEqual([
      ['f1', 1],
      ['f2', 2],
      ['f3', 3],
    ]);
    expect(rows[2]!.functionCode).not.toBe(1);
    expect(rows[2]!.functionCode).not.toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Mutaciones semánticas (bytes siguen parseando/validando; el significado no)
// ---------------------------------------------------------------------------

describe('verifyCutPlanPtxReadback — detección de mutaciones semánticas', () => {
  function buildMutatedDidactic(
    mutate: (records: PtxRecord[]) => PtxRecord[],
  ): { parsed: PtxDocument; plan: CutPlan; options: CompileCutPlanToPtxOptions } {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'B' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      1200,
      700,
      DIDACTIC_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    const plan = planFromSheets([sheetFromPlacement(sheet)], DIDACTIC_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    return { parsed: mutateAndParse(compiled.document, mutate), plan, options: WITH_VECTORS };
  }

  function expectReadbackIssues(
    parsed: PtxDocument,
    plan: CutPlan,
    options: CompileCutPlanToPtxOptions,
    code: string,
  ): void {
    const pristine = compileCutPlanToPtxDocument(plan, options);
    const issues = verifyCutPlanPtxReadback(parsed, plan, pristine.mapping, options);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.code)).toContain(code);
  }

  it('detecta una dimensión modificada aunque el CSV siga siendo válido', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) =>
      records.map((r) => (r.type === 'CUTS' && r.cutIndex === 1 && r.patternIndex === 1
        ? { ...r, dimension: 330 }
        : r)),
    );
    expectReadbackIssues(parsed, plan, options, 'cuts.dimension');
  });

  it('detecta una función de fase alterada (3 → 2 en el recorte) aunque el PTX siga siendo válido', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) =>
      records.map((r) => (r.type === 'CUTS' && r.cutIndex === 4 && r.patternIndex === 1
        ? { ...r, functionCode: 2 }
        : r)),
    );
    // La mutación es sintácticamente válida: el validator del formato sigue
    // verde. Sólo el verifier semántico (que deriva el expected desde la
    // traza, no desde el compiler) la detecta.
    expect(validatePtxDocument(parsed)).toEqual([]);
    expectReadbackIssues(parsed, plan, options, 'cuts.function');
  });

  it('detecta un SEQUENCE alterado (orden operativo)', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) =>
      records.map((r) => (r.type === 'CUTS' && r.cutIndex === 4 && r.patternIndex === 1
        ? { ...r, sequence: 5 }
        : r)),
    );
    expectReadbackIssues(parsed, plan, options, 'cuts.sequence');
  });

  it('detecta PART_INDEX cruzado entre dos piezas existentes', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) =>
      records.map((r) => {
        if (r.type !== 'CUTS' || r.patternIndex !== 1) return r;
        if (r.cutIndex === 2) return { ...r, partReference: { kind: 'part' as const, partIndex: 2 } };
        if (r.cutIndex === 4) return { ...r, partReference: { kind: 'part' as const, partIndex: 1 } };
        return r;
      }),
    );
    expectReadbackIssues(parsed, plan, options, 'cuts.part_ref');
  });

  it('detecta filas reordenadas físicamente (el orden de fila codifica el árbol)', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) => {
      const cuts = records.filter((r): r is PtxCutRecord => r.type === 'CUTS' && r.patternIndex === 1);
      const others = records.filter((r) => !(r.type === 'CUTS' && r.patternIndex === 1));
      const release = cuts.find((r) => r.sequence === 0)!;
      const divisions = cuts.filter((r) => r.sequence > 0);
      return [...others, release, ...divisions];
    });
    expectReadbackIssues(parsed, plan, options, 'cuts.index');
  });

  it('detecta kerf alterado en MATERIALS', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) =>
      records.map((r) => (r.type === 'MATERIALS' ? { ...r, kerfRip: 5, kerfCrosscut: 5 } : r)),
    );
    expectReadbackIssues(parsed, plan, options, 'materials.kerf');
  });

  it('detecta medidas de pieza alteradas en PARTS_REQ', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) =>
      records.map((r) => (r.type === 'PARTS_REQ' && r.partIndex === 1 ? { ...r, length: 440 } : r)),
    );
    expectReadbackIssues(parsed, plan, options, 'parts.dims');
  });

  it('detecta la dimensión de una liberación alterada', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) =>
      records.map((r) => (r.type === 'CUTS' && r.patternIndex === 1 && r.sequence === 0
        ? { ...r, dimension: 370 }
        : r)),
    );
    expectReadbackIssues(parsed, plan, options, 'release.dimension');
  });

  it('detecta un vector desplazado', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) =>
      records.map((r) => (r.type === 'VECTORS' && r.cutIndex === 1
        ? { ...r, yStart: 371, yEnd: 371 }
        : r)),
    );
    expectReadbackIssues(parsed, plan, options, 'vectors.line');
  });

  it('detecta una fila de corte borrada (hueco de índice)', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'B' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      1200,
      700,
      DIDACTIC_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    const plan = planFromSheets([sheetFromPlacement(sheet)], DIDACTIC_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    const text = serializePtxDocument(compiled.document, { decimalPlaces: WITH_VECTORS.decimalPlaces });
    const mutatedText = text
      .split('\r\n')
      .filter((line) => !line.startsWith('CUTS,1,1,3,'))
      .join('\r\n');
    const parsed = parsePtxDocumentText(mutatedText);
    const issues = verifyCutPlanPtxReadback(parsed, plan, compiled.mapping, WITH_VECTORS);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.code)).toContain('ptx_invalid.INDEX_NOT_CONTIGUOUS');
  });
});

// ---------------------------------------------------------------------------
// Fail-closed
// ---------------------------------------------------------------------------

describe('compileCutPlanToPtxDocument — fail closed', () => {
  function singlePiecePlan(overrides: {
    config?: CutPlanConfig;
    sheetOverrides?: Partial<CutPlanSheet>;
  }): CutPlan {
    const rows = [makeRow({ quantity: 1, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'P1' })];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      1000,
      600,
      overrides.config ?? BASE_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    return planFromSheets(
      [sheetFromPlacement(sheet, overrides.sheetOverrides)],
      overrides.config ?? BASE_CONFIG,
    );
  }

  it('rechaza trims positivos: no hay mapping documentado para 90..99 ni para head', () => {
    const plan = singlePiecePlan({ config: DEFAULT_CUT_PLAN_CONFIG }); // trims 10 mm
    const error = expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.trim_unsupported',
    );
    expect((error.context.trimCutIds as string[]).length).toBeGreaterThan(0);
  });

  it('rechaza hojas CNC nesting: dibujar rectángulos no demuestra guillotinabilidad', () => {
    const plan = singlePiecePlan({ sheetOverrides: { strategy: 'cnc-nesting' } });
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.nesting_not_representable',
    );
  });

  it('rechaza hojas legadas sin programa: no se inventa un árbol desde coordenadas', () => {
    const plan = singlePiecePlan({ sheetOverrides: { cutProgram: undefined } });
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.missing_cut_program',
    );
  });

  it('rechaza programas que no ejecutan (geometría declarada inconsistente)', () => {
    const board = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
    const geometry = divideRegion(board, 'x', 400, 4);
    const program: CutProgramInput = {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: 'board',
      regions: [
        { regionId: 'board', rect: board },
        { regionId: 'kept', rect: { ...geometry.keptRect, widthMm: 599 } }, // declaración corrupta
        { regionId: 'rest', rect: geometry.restRect! },
      ],
      divisions: [
        { cutId: 'cut-1', parentRegionId: 'board', axis: 'x', keptExtentMm: 400, kerfMm: 4, keptRegionId: 'kept', restRegionId: 'rest' },
      ],
      terminals: [
        { regionId: 'kept', kind: 'piece', pieceRef: 'p1-s0' },
        { regionId: 'rest', kind: 'waste' },
      ],
    };
    const sheet: CutPlanSheet = sheetFromPlacement({
      pieces: [labPiece('p1-s0', geometry.keptRect, 'P1')],
      remnants: [],
      instructions: [],
      sheetIndex: 0,
      sheetWidthMm: 600,
      sheetLengthMm: 1000,
      materialCode: 'LAB18',
      materialName: 'Lab Board 18',
      thicknessMm: 18,
      cutProgram: program,
    });
    const plan = planFromSheets([sheet], BASE_CONFIG);
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.program_invalid',
    );
  });

  it('rechaza planes sin tableros', () => {
    expectCompilationError(
      () => compileCutPlanToPtxDocument(planFromSheets([], BASE_CONFIG), WITHOUT_VECTORS),
      'ptx_compile.no_sheets',
    );
  });

  it('rechaza espesor industrial ausente (sin valor por defecto)', () => {
    const plan = singlePiecePlan({ sheetOverrides: { thicknessMm: undefined } });
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.material_thickness_missing',
    );
  });

  it('rechaza material de pieza sin tablero propio en el plan (material irresuelto)', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'P1' })];
    const { sheet } = packSingleSheetStrip(unroll(rows), 0, 1000, 600, BASE_CONFIG, 'LAB18', 'Lab Board 18', 18);
    const orphanPiece = { ...sheet.pieces[0]!, materialCode: 'OTHER18' };
    const plan = planFromSheets(
      [sheetFromPlacement(sheet, { pieces: [orphanPiece] })],
      BASE_CONFIG,
    );
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.material_without_boards',
    );
  });

  it('rechaza veta no mapeable al diccionario PTX', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'P1' })];
    const { sheet } = packSingleSheetStrip(unroll(rows), 0, 1000, 600, BASE_CONFIG, 'LAB18', 'Lab Board 18', 18);
    const oddGrainPiece = { ...sheet.pieces[0]!, grain: 2 } as unknown as CutPlanPlacedPiece;
    const plan = planFromSheets(
      [sheetFromPlacement(sheet, { pieces: [oddGrainPiece] })],
      BASE_CONFIG,
    );
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.piece_grain_invalid',
    );
  });

  it('rechaza pieza terminal inatribuible (tablero entero como pieza, sin pasada que la libere)', () => {
    const board = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
    const program: CutProgramInput = {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: 'board',
      regions: [{ regionId: 'board', rect: board }],
      divisions: [],
      terminals: [{ regionId: 'board', kind: 'piece', pieceRef: 'p1-s0' }],
    };
    expect(() => executeCutProgram(program)).not.toThrow();
    const sheet: CutPlanSheet = sheetFromPlacement({
      pieces: [labPiece('p1-s0', board, 'P1')],
      remnants: [],
      instructions: [],
      sheetIndex: 0,
      sheetWidthMm: 600,
      sheetLengthMm: 1000,
      materialCode: 'LAB18',
      materialName: 'Lab Board 18',
      thicknessMm: 18,
      cutProgram: program,
    });
    const plan = planFromSheets([sheet], BASE_CONFIG);
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.piece_unattributable',
    );
  });

  it('rechaza retazo terminal inatribuible (tablero entero como retazo)', () => {
    const board = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
    const program: CutProgramInput = {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: 'board',
      regions: [{ regionId: 'board', rect: board }],
      divisions: [],
      terminals: [{ regionId: 'board', kind: 'remnant' }],
    };
    expect(() => executeCutProgram(program)).not.toThrow();
    const sheet: CutPlanSheet = sheetFromPlacement({
      pieces: [],
      remnants: [],
      instructions: [],
      sheetIndex: 0,
      sheetWidthMm: 600,
      sheetLengthMm: 1000,
      materialCode: 'LAB18',
      materialName: 'Lab Board 18',
      thicknessMm: 18,
      cutProgram: program,
    });
    const plan = planFromSheets([sheet], BASE_CONFIG);
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.remnant_unattributable',
    );
  });

  it('rechaza kerf no uniforme entre programa y plan', () => {
    const board = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
    const geometry = divideRegion(board, 'x', 400, 3);
    const program: CutProgramInput = {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: 'board',
      regions: [
        { regionId: 'board', rect: board },
        { regionId: 'kept', rect: geometry.keptRect },
        { regionId: 'rest', rect: geometry.restRect! },
      ],
      divisions: [
        { cutId: 'cut-1', parentRegionId: 'board', axis: 'x', keptExtentMm: 400, kerfMm: 3, keptRegionId: 'kept', restRegionId: 'rest' },
      ],
      terminals: [
        { regionId: 'kept', kind: 'piece', pieceRef: 'p1-s0' },
        { regionId: 'rest', kind: 'waste' },
      ],
    };
    const sheet: CutPlanSheet = sheetFromPlacement({
      pieces: [labPiece('p1-s0', geometry.keptRect, 'P1')],
      remnants: [],
      instructions: [],
      sheetIndex: 0,
      sheetWidthMm: 600,
      sheetLengthMm: 1000,
      materialCode: 'LAB18',
      materialName: 'Lab Board 18',
      thicknessMm: 18,
      cutProgram: program,
    });
    const plan = planFromSheets([sheet], BASE_CONFIG); // plan kerf 4, programa kerf 3
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.kerf_not_uniform',
    );
  });

  it('rechaza fases más profundas que la fase 3 soportada', () => {
    const board = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
    const d1 = divideRegion(board, 'x', 900, 4);
    const d2 = divideRegion(d1.keptRect, 'y', 500, 4);
    const d3 = divideRegion(d2.keptRect, 'x', 800, 4);
    const d4 = divideRegion(d3.keptRect, 'y', 400, 4);
    const program: CutProgramInput = {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: 'board',
      regions: [
        { regionId: 'board', rect: board },
        { regionId: 'k1', rect: d1.keptRect },
        { regionId: 'r1', rect: d1.restRect! },
        { regionId: 'k2', rect: d2.keptRect },
        { regionId: 'r2', rect: d2.restRect! },
        { regionId: 'k3', rect: d3.keptRect },
        { regionId: 'r3', rect: d3.restRect! },
        { regionId: 'k4', rect: d4.keptRect },
        { regionId: 'r4', rect: d4.restRect! },
      ],
      divisions: [
        { cutId: 'd1', parentRegionId: 'board', axis: 'x', keptExtentMm: 900, kerfMm: 4, keptRegionId: 'k1', restRegionId: 'r1' },
        { cutId: 'd2', parentRegionId: 'k1', axis: 'y', keptExtentMm: 500, kerfMm: 4, keptRegionId: 'k2', restRegionId: 'r2' },
        { cutId: 'd3', parentRegionId: 'k2', axis: 'x', keptExtentMm: 800, kerfMm: 4, keptRegionId: 'k3', restRegionId: 'r3' },
        { cutId: 'd4', parentRegionId: 'k3', axis: 'y', keptExtentMm: 400, kerfMm: 4, keptRegionId: 'k4', restRegionId: 'r4' },
      ],
      terminals: [
        { regionId: 'k4', kind: 'piece', pieceRef: 'p1-s0' },
        { regionId: 'r1', kind: 'waste' },
        { regionId: 'r2', kind: 'waste' },
        { regionId: 'r3', kind: 'waste' },
        { regionId: 'r4', kind: 'waste' },
      ],
    };
    expect(() => executeCutProgram(program)).not.toThrow();
    const sheet: CutPlanSheet = sheetFromPlacement({
      pieces: [labPiece('p1-s0', d4.keptRect, 'P1')],
      remnants: [],
      instructions: [],
      sheetIndex: 0,
      sheetWidthMm: 600,
      sheetLengthMm: 1000,
      materialCode: 'LAB18',
      materialName: 'Lab Board 18',
      thicknessMm: 18,
      cutProgram: program,
    });
    const plan = planFromSheets([sheet], BASE_CONFIG);
    const error = expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.phase_unsupported',
    );
    expect(error.context.phase).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// R1 — independencia semántica del verifier respecto del compiler
// ---------------------------------------------------------------------------

describe('R1 — el verifier no comparte lógica productiva con el compiler', () => {
  it('verifyCutPlanPtxReadback sólo importa tipos del módulo del compiler', () => {
    const source = readFileSync(
      new URL('./verifyCutPlanPtxReadback.ts', import.meta.url),
      'utf8',
    );
    const importMatches = [
      ...source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'\.\/compileCutPlan';?/g),
    ];
    // Debe importar los tipos del contrato (permitido) y NADA de valor:
    // si derivara FUNCTION/preorder/TYPE/releases/vectores del compiler, un
    // bug industrial del writer se replicaría en el checker.
    expect(importMatches.length).toBeGreaterThan(0);
    for (const match of importMatches) {
      const typeKeyword = match[1];
      const specifiers = match[2] ?? '';
      if (typeKeyword) continue; // `import type {...}`: todo el import es de tipos
      for (const specifier of specifiers.split(',')) {
        const trimmed = specifier.trim();
        if (trimmed === '') continue;
        expect(
          trimmed.startsWith('type '),
          `el verifier importa '${trimmed}' como valor desde compileCutPlan`,
        ).toBe(true);
      }
    }
    for (const forbidden of [
      'planCutProgramDivisions',
      'ptxStructuralPreorder',
      'ptxPatternTypeForSheet',
      'planSheetReleases',
      'planSheetTrimProjection',
      'schedulePtxExecutionEvents',
      'ptxDivisionVector',
      'ptxAscii',
      'ptxResolveMagnitude',
      'compileCutPlanToPtxDocument',
    ]) {
      expect(source, `referencia prohibida a ${forbidden} como import`).not.toMatch(
        new RegExp(`import\\s*\\{[^}]*\\b${forbidden}\\b[^}]*\\}\\s*from`),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// R2 — identidad ASCII crítica no se mutila silenciosamente
// ---------------------------------------------------------------------------

describe('R2 — identidad ASCII crítica falla cerrado', () => {
  function planWithSheetMaterial(materialCode: string): CutPlan {
    const rows = [makeRow({ quantity: 1, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'P1' })];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      1000,
      600,
      BASE_CONFIG,
      materialCode,
      'Lab Board 18',
      18,
    );
    return planFromSheets(
      [
        sheetFromPlacement(sheet, {
          materialCode,
          pieces: sheet.pieces.map((piece) => ({ ...piece, materialCode })),
        }),
      ],
      BASE_CONFIG,
    );
  }

  it('materialCode ASCII normal compila', () => {
    const plan = planWithSheetMaterial('MDF18');
    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    expect((compiled.document.records.find((r) => r.type === 'MATERIALS') as { code: string }).code).toBe('MDF18');
  });

  it('materialCode con Á falla cerrado con identity_not_ascii', () => {
    const plan = planWithSheetMaterial('MDFÁ');
    const error = expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.identity_not_ascii',
    );
    expect(error.context.value).toBe('MDFÁ');
    expect(error.context.field).toContain('material');
  });

  it('dos códigos que colisionarían al filtrar nunca se fusionan', () => {
    // 'MDFÁ' y 'MDF' sanitizan igual ('MDF'): la política de identidad debe
    // rechazar el no-ASCII en lugar de fusionar dos entidades industriales.
    const rowsA = [makeRow({ quantity: 1, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'PA', materialCode: 'MDF' })];
    const rowsB = [makeRow({ quantity: 1, lengthMm: 350, widthMm: 250, grain: 1, partCode: 'PB', materialCode: 'MDFÁ' })];
    const first = packSingleSheetStrip(unroll(rowsA), 0, 1000, 600, BASE_CONFIG, 'MDF', 'M', 18);
    const second = packSingleSheetStrip(unroll(rowsB), 1, 1000, 600, BASE_CONFIG, 'MDFÁ', 'M', 18);
    const plan = planFromSheets(
      [
        sheetFromPlacement(first.sheet, { materialCode: 'MDF', pieces: first.sheet.pieces.map((p) => ({ ...p, materialCode: 'MDF' })) }),
        sheetFromPlacement(second.sheet, { materialCode: 'MDFÁ', pieces: second.sheet.pieces.map((p) => ({ ...p, materialCode: 'MDFÁ' })) }),
      ],
      BASE_CONFIG,
    );
    const error = expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.identity_not_ascii',
    );
    expect(error.context.value).toBe('MDFÁ');
  });

  it('partCode no ASCII falla cerrado (CODE de PARTS_REQ es identidad contractual)', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'P1' })];
    const { sheet } = packSingleSheetStrip(unroll(rows), 0, 1000, 600, BASE_CONFIG, 'LAB18', 'Lab Board 18', 18);
    const renamed = sheet.pieces.map((piece) => ({ ...piece, partCode: 'LARGUERO-Ñ' }));
    const plan = planFromSheets([sheetFromPlacement(sheet, { pieces: renamed })], BASE_CONFIG);
    const error = expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS),
      'ptx_compile.identity_not_ascii',
    );
    expect(error.context.value).toBe('LARGUERO-Ñ');
    expect(error.context.field).toContain('partCode');
  });

  it('partCode vacío genera código técnico explícito PART-n', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'P1' })];
    const { sheet } = packSingleSheetStrip(unroll(rows), 0, 1000, 600, BASE_CONFIG, 'LAB18', 'Lab Board 18', 18);
    const renamed = sheet.pieces.map((piece) => ({ ...piece, partCode: '' }));
    const plan = planFromSheets([sheetFromPlacement(sheet, { pieces: renamed })], BASE_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    expect((compiled.document.records.find((r) => r.type === 'PARTS_REQ') as { code: string }).code).toBe('PART-1');
  });
});

// ---------------------------------------------------------------------------
// R3 — MATERIALS.BOOK: sólo "cuenta tableros" está documentado (S03 pp.134–135)
// ---------------------------------------------------------------------------

describe('R3 — MATERIALS.BOOK usa la política conservadora BOOK=1', () => {
  it('dos sheets del mismo material: BOOK=1 (un tablero por ciclo), no el total del plan', () => {
    const rowA = [makeRow({ quantity: 1, lengthMm: 2000, widthMm: 1600, grain: 1, partCode: 'G1', materialCode: 'MDF18' })];
    const rowB = [makeRow({ quantity: 1, lengthMm: 2400, widthMm: 1500, grain: 1, partCode: 'G2', materialCode: 'MDF18' })];
    const first = packSingleSheetStrip(unroll(rowA), 0, 2440, 1830, BASE_CONFIG, 'MDF18', 'MDF Blanco 18', 18);
    const second = packSingleSheetStrip(unroll(rowB), 1, 2750, 1830, BASE_CONFIG, 'MDF18', 'MDF Blanco 18', 18);
    const plan = planFromSheets(
      [sheetFromPlacement(first.sheet), sheetFromPlacement(second.sheet)],
      BASE_CONFIG,
    );
    const compiled = compileCutPlanToPtxDocument(plan, WITHOUT_VECTORS);
    const materials = compiled.document.records.filter((r) => r.type === 'MATERIALS');
    expect(materials).toHaveLength(1);
    // El dossier sólo documenta que BOOK cuenta tableros (no milímetros);
    // "total de tableros del material en el job" NO está establecido, así
    // que el candidato emite el libro por ciclo: 1.
    expect(materials[0]).toMatchObject({ bookQuantity: 1 });
    expect(verifyCutPlanPtxReadback(
      parsePtxDocumentBytes(
        serializePtxDocumentBytes(compiled.document, { decimalPlaces: WITHOUT_VECTORS.decimalPlaces }),
      ),
      plan,
      compiled.mapping,
      WITHOUT_VECTORS,
    )).toEqual([]);
  });
});
