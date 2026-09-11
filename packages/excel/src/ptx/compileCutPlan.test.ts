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
 * (CUT_A..CUT_D) — same functions, same relative dimensions, same part
 * references — plus the offcut release rows.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUT_PLAN_CONFIG,
  divideRegion,
  executeCutProgram,
  optimizeCutPlan,
  packSingleSheetStrip,
  type CutInstruction,
  type CutPlan,
  type CutPlanConfig,
  type CutPlanPlacedPiece,
  type CutPlanRemnant,
  type CutPlanSheet,
  type CutProgramInput,
  type MaterialBoard,
  type ProductionCutRow,
} from '@granete/domain';
import type { PtxCutRecord, PtxDocument, PtxRecord } from './records';
import { ptxDocumentsEqual } from './equivalence';
import { parsePtxDocumentBytes, parsePtxDocumentText } from './parse';
import { serializePtxDocumentBytes, serializePtxDocument } from './serialize';
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
    id: 'mat-alt',
    code: 'ALT15',
    name: 'Lab Alt 15',
    costPerM2: 12,
    wastePercent: 10,
    lengthMm: 800,
    widthMm: 400,
    thicknessMm: 15,
    grainDefault: true,
    boardPrice: 6,
    active: true,
  },
];

const WITH_VECTORS: CompileCutPlanToPtxOptions = {
  headerVersion: 1,
  headerOrigin: 0,
  trimType: 1,
  decimalPlaces: 2,
  includeVectors: true,
};

const WITHOUT_VECTORS: CompileCutPlanToPtxOptions = {
  headerVersion: 1,
  headerOrigin: 0,
  trimType: 0,
  decimalPlaces: 2,
};

/** No trims, kerf 4, remnant threshold low enough to keep 462×320 useful (dossier exercise). */
const DIDACTIC_CONFIG: CutPlanConfig = {
  ...DEFAULT_CUT_PLAN_CONFIG,
  sawKerfMm: 4,
  trim: { topMm: 0, bottomMm: 0, leftMm: 0, rightMm: 0 },
  minRemnantLengthMm: 400,
  minRemnantWidthMm: 300,
};

/**
 * Local mirror of the domain's unrollRows for lab rows without edge banding
 * (L1..W2 are 0 in every fixture here, so the deduction is exactly zero):
 * same id format, same expansion, same sort-free order.
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

function makeRow(params: {  quantity: number;
  lengthMm: number;
  widthMm: number;
  grain: 0 | 1;
  partCode: string;
  materialName?: string;
}): ProductionCutRow {
  return {
    quantity: params.quantity,
    lengthMm: params.lengthMm,
    widthMm: params.widthMm,
    description: `${params.partCode} lab`,
    materialName: params.materialName ?? 'Lab Board 18',
    materialCode: params.materialName ? 'ALT15' : 'LAB18',
    grain: params.grain,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
    partCode: params.partCode,
    partName: params.partCode,
    moduleCode: 'M01',
    thicknessMm: params.materialName ? 15 : 18,
  };
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

function planFromSheets(sheets: readonly CutPlanSheet[], config: CutPlanConfig): CutPlan {
  return {
    id: 'cutplan-lab-650',
    projectId: 'lab-650',
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
function runFullChain(plan: CutPlan, options: CompileCutPlanToPtxOptions): void {
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

// ---------------------------------------------------------------------------
// Flagship chain over real optimizeCutPlan output
// ---------------------------------------------------------------------------

describe('compileCutPlanToPtxDocument — cadena completa sobre plan real', () => {
  it('compila, valida, serializa, lee y comprueba semánticamente (con vectores)', () => {
    const rows = [
      makeRow({ quantity: 2, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'B' }),
    ];
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, {
      ...DEFAULT_CUT_PLAN_CONFIG,
      minRemnantLengthMm: 400,
      minRemnantWidthMm: 300,
    });
    expect(plan.sheets.length).toBeGreaterThanOrEqual(1);
    runFullChain(plan, WITH_VECTORS);
  });

  it('la misma cadena sin vectores (estructura relativa únicamente)', () => {
    const rows = [
      makeRow({ quantity: 2, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'B' }),
    ];
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, DEFAULT_CUT_PLAN_CONFIG);
    runFullChain(plan, WITHOUT_VECTORS);
  });

  it('plan multi-material: dos MATERIALS/BOARDS/PATTERNS y PARTS_REQ contiguos', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' }),
      makeRow({
        quantity: 2,
        lengthMm: 300,
        widthMm: 200,
        grain: 0,
        partCode: 'C',
        materialName: 'Lab Alt 15',
      }),
    ];
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, DEFAULT_CUT_PLAN_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    const materials = compiled.document.records.filter((r) => r.type === 'MATERIALS');
    const boards = compiled.document.records.filter((r) => r.type === 'BOARDS');
    const patterns = compiled.document.records.filter((r) => r.type === 'PATTERNS');
    const parts = compiled.document.records.filter((r) => r.type === 'PARTS_REQ');
    expect(materials).toHaveLength(2);
    expect(boards).toHaveLength(plan.sheets.length);
    expect(patterns).toHaveLength(plan.sheets.length);
    expect(parts.map((p) => (p as { partIndex: number }).partIndex)).toEqual([
      ...Array(plan.sheets.reduce((sum, s) => sum + s.pieces.length, 0)).keys(),
    ].map((i) => i + 1));
    expect(compiled.mapping.materialIndexByCode.get('LAB18')).toBe(1);
    expect(compiled.mapping.materialIndexByCode.get('ALT15')).toBe(2);
    expect(verifyCutPlanPtxReadback(
      parsePtxDocumentBytes(
        serializePtxDocumentBytes(compiled.document, { decimalPlaces: WITH_VECTORS.decimalPlaces }),
      ),
      plan,
      compiled.mapping,
      WITH_VECTORS,
    )).toEqual([]);
  });

  it('es determinista: dos compilaciones del mismo plan son iguales', () => {
    const rows = [
      makeRow({ quantity: 2, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'B' }),
    ];
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, DEFAULT_CUT_PLAN_CONFIG);
    const first = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    const second = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    expect(second.document).toEqual(first.document);
    expect(second.mapping.partIndexByPieceRef).toEqual(first.mapping.partIndexByPieceRef);
    expect([...second.mapping.materialIndexByCode]).toEqual([...first.mapping.materialIndexByCode]);
  });

  it('marca el documento como candidato no productivo', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' })];
    const plan = optimizeCutPlan('lab-650', rows, LAB_MATERIALS, DEFAULT_CUT_PLAN_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    expect(compiled.document.header.title).toContain('GRANETE-NONPRODUCTION-');
    const job = compiled.document.records.find((r) => r.type === 'JOBS');
    expect(job && (job as { description?: string }).description).toBe(
      'GRANETE NON-PRODUCTION PTX CANDIDATE',
    );
  });
});

// ---------------------------------------------------------------------------
// Dossier didactic exercise through the real strip heuristic
// ---------------------------------------------------------------------------

describe('compileCutPlanToPtxDocument — ejercicio didáctico del dossier (1200×700, kerf 4)', () => {
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

  it('reproduce las filas CUT_A..CUT_D documentadas (función, dimensión relativa, referencia)', () => {
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
    // CUT_C: bloque de 280 desde el resto de franja — fase 2, eje x → cross (2)
    expect(divisions[2]).toMatchObject({
      sequence: 3,
      functionCode: 2,
      dimension: 280,
      partReference: { kind: 'none' },
      comment: 'place-2-x',
    });
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

  it('emite filas de liberación QTY_RPT=0 para los retazos y OFFCUTS con sus medidas', () => {
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

  it('vectores: líneas absolutas del borde de banda alejado del lado conservado, origen superior izquierdo', () => {
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

    expect(verifyCutPlanPtxReadback(
      parsePtxDocumentBytes(
        serializePtxDocumentBytes(compiled.document, { decimalPlaces: WITH_VECTORS.decimalPlaces }),
      ),
      plan,
      compiled.mapping,
      WITH_VECTORS,
    )).toEqual([]);
  });

  it('incluye los cuatro refilados como pasadas reales de fase 1 con medidas relativas', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' })];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      2440,
      1830,
      DEFAULT_CUT_PLAN_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    const plan = planFromSheets([sheetFromPlacement(sheet)], DEFAULT_CUT_PLAN_CONFIG);
    const compiled = compileCutPlanToPtxDocument(plan, WITH_VECTORS);
    const divisions = cutsOf(compiled.document).filter((r) => r.sequence > 0);

    const trims = divisions.filter((r) => (r.comment ?? '').startsWith('trim:'));
    expect(trims.map((r) => r.comment)).toEqual(['trim:left', 'trim:right', 'trim:bottom', 'trim:top']);
    // Margen total 10 con disco 4: kept X 2430/2420 e Y 1820/1810.
    expect(trims.map((r) => r.dimension)).toEqual([2430, 2420, 1820, 1810]);
    // Fase 1 por eje: trim:left/right avanzan sobre X → cross (2); bottom/top sobre Y → rip (1).
    expect(trims.map((r) => r.functionCode)).toEqual([2, 2, 1, 1]);

    expect(verifyCutPlanPtxReadback(
      parsePtxDocumentBytes(
        serializePtxDocumentBytes(compiled.document, { decimalPlaces: WITH_VECTORS.decimalPlaces }),
      ),
      plan,
      compiled.mapping,
      WITH_VECTORS,
    )).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Semantic mutation detection (bytes stay parseable/valid; meaning changes)
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
    // Rebuild mapping with a pristine compile (the mutation only touches bytes).
    const pristine = compileCutPlanToPtxDocument(plan, options);
    const issues = verifyCutPlanPtxReadback(parsed, plan, pristine.mapping, options);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.code)).toContain(code);
  }

  it('detecta una dimensión modificada', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) =>
      records.map((r) => (r.type === 'CUTS' && r.cutIndex === 1 && r.patternIndex === 1
        ? { ...r, dimension: 330 }
        : r)),
    );
    expectReadbackIssues(parsed, plan, options, 'cuts.dimension');
  });

  it('detecta una función de fase alterada (3 → 2 en el recorte)', () => {
    const { parsed, plan, options } = buildMutatedDidactic((records) =>
      records.map((r) => (r.type === 'CUTS' && r.cutIndex === 4 && r.patternIndex === 1
        ? { ...r, functionCode: 2 }
        : r)),
    );
    expectReadbackIssues(parsed, plan, options, 'cuts.function');
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

  it('detecta filas reordenadas físicamente (el orden codifica el árbol)', () => {
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
        ? { ...r, dimension: 460 }
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
// Fail-closed compilation
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
      overrides.config ?? DIDACTIC_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    return planFromSheets(
      [sheetFromPlacement(sheet, overrides.sheetOverrides)],
      overrides.config ?? DIDACTIC_CONFIG,
    );
  }

  it('rechaza hojas CNC nesting: dibujar rectángulos no demuestra guillotinabilidad', () => {
    const plan = singlePiecePlan({ sheetOverrides: { strategy: 'cnc-nesting' } });
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITH_VECTORS),
      'ptx_compile.nesting_not_representable',
    );
  });

  it('rechaza hojas legadas sin programa: no se inventa un árbol desde coordenadas', () => {
    const plan = singlePiecePlan({ sheetOverrides: { cutProgram: undefined } });
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITH_VECTORS),
      'ptx_compile.missing_cut_program',
    );
  });

  it('rechaza planes sin tableros', () => {
    expectCompilationError(
      () => compileCutPlanToPtxDocument(planFromSheets([], DIDACTIC_CONFIG), WITH_VECTORS),
      'ptx_compile.no_sheets',
    );
  });

  it('rechaza espesor industrial ausente (sin valor por defecto)', () => {
    const plan = singlePiecePlan({ sheetOverrides: { thicknessMm: undefined } });
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITH_VECTORS),
      'ptx_compile.material_thickness_missing',
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
        {
          cutId: 'cut-1',
          parentRegionId: 'board',
          axis: 'x',
          keptExtentMm: 400,
          kerfMm: 3,
          keptRegionId: 'kept',
          restRegionId: 'rest',
        },
      ],
      terminals: [
        { regionId: 'kept', kind: 'piece', pieceRef: 'p1-s0' },
        { regionId: 'rest', kind: 'waste' },
      ],
    };
    const sheet: CutPlanSheet = {
      ...sheetFromPlacement({
        pieces: [{
          id: 'p1-s0',
          partCode: 'P1',
          partName: 'P1',
          moduleCode: 'M01',
          labelRef: 'p1',
          materialName: 'Lab Board 18',
          materialCode: 'LAB18',
          xMm: 0,
          yMm: 0,
          lengthMm: 400,
          widthMm: 600,
          originalLengthMm: 400,
          originalWidthMm: 600,
          grain: 1,
          rotated: false,
          L1: 0, L2: 0, W1: 0, W2: 0,
          thicknessMm: 18,
          sheetIndex: 0,
          stripIndex: 0,
          cutSequenceNumber: 1,
        }],
        remnants: [],
        instructions: [],
        sheetIndex: 0,
        sheetWidthMm: 600,
        sheetLengthMm: 1000,
        materialCode: 'LAB18',
        materialName: 'Lab Board 18',
        thicknessMm: 18,
        cutProgram: program,
      }),
    };
    const plan = planFromSheets([sheet], DIDACTIC_CONFIG); // plan kerf 4, programa kerf 3
    expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITH_VECTORS),
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
      pieces: [{
        id: 'p1-s0',
        partCode: 'P1',
        partName: 'P1',
        moduleCode: 'M01',
        labelRef: 'p1',
        materialName: 'Lab Board 18',
        materialCode: 'LAB18',
        xMm: d4.keptRect.xMm,
        yMm: d4.keptRect.yMm,
        lengthMm: d4.keptRect.lengthMm,
        widthMm: d4.keptRect.widthMm,
        originalLengthMm: d4.keptRect.lengthMm,
        originalWidthMm: d4.keptRect.widthMm,
        grain: 1,
        rotated: false,
        L1: 0, L2: 0, W1: 0, W2: 0,
        thicknessMm: 18,
        sheetIndex: 0,
        stripIndex: 0,
        cutSequenceNumber: 1,
      }],
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
    const plan = planFromSheets([sheet], DIDACTIC_CONFIG);
    const error = expectCompilationError(
      () => compileCutPlanToPtxDocument(plan, WITH_VECTORS),
      'ptx_compile.phase_unsupported',
    );
    expect(error.context.phase).toBe(4);
  });
});
