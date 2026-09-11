import { describe, it, expect } from 'vitest';
import type { MaterialBoard, ProductionCutRow } from '../types';
import { ValidationError } from '../errors';
import {
  optimizeCutPlan,
  packSingleSheetGuillotineBestFit,
  packSingleSheetStrip,
  pickWinningStrategyCandidate,
  type StrategyCandidate,
} from './guillotine';
import { unrollRows, type PlacementResult } from './pieces';
import { DEFAULT_CUT_PLAN_CONFIG, type CutPlanConfig, type CutPlanSheet } from './types';
import {
  CUT_PROGRAM_SCHEMA_VERSION,
  checkExpectedPieces,
  executeCutProgram,
  type CutProgramInput,
  type CutProgramTrace,
} from './cutProgram';

const catalogMaterials: MaterialBoard[] = [
  {
    id: 'mat-test',
    code: 'TEST',
    name: 'Tablero Test 18mm',
    costPerM2: 20,
    wastePercent: 10,
    lengthMm: 1000,
    widthMm: 600,
    thicknessMm: 18,
    grainDefault: true,
    boardPrice: 12,
    active: true,
  },
  {
    id: 'mat-alt',
    code: 'ALT',
    name: 'Tablero Alt 15mm',
    costPerM2: 22,
    wastePercent: 10,
    lengthMm: 800,
    widthMm: 400,
    thicknessMm: 15,
    grainDefault: true,
    boardPrice: 7,
    active: true,
  },
];

function makeRow(params: {
  quantity: number;
  lengthMm: number;
  widthMm: number;
  grain: 0 | 1;
  partCode: string;
  materialName?: string;
  edgeBandThicknessMm?: number;
}): ProductionCutRow {
  return {
    quantity: params.quantity,
    lengthMm: params.lengthMm,
    widthMm: params.widthMm,
    description: `${params.partCode} test`,
    materialName: params.materialName ?? 'Tablero Test 18mm',
    materialCode: params.materialName ? 'ALT' : 'TEST',
    grain: params.grain,
    L1: params.edgeBandThicknessMm !== undefined ? 1 : 0,
    L2: params.edgeBandThicknessMm !== undefined ? 1 : 0,
    W1: params.edgeBandThicknessMm !== undefined ? 1 : 0,
    W2: params.edgeBandThicknessMm !== undefined ? 1 : 0,
    edgeBandThicknessMm: params.edgeBandThicknessMm,
    partCode: params.partCode,
    partName: params.partCode,
    moduleCode: 'M01',
    thicknessMm: 18,
  };
}

const flatConfig: CutPlanConfig = {
  ...DEFAULT_CUT_PLAN_CONFIG,
  sawKerfMm: 4,
  trim: { topMm: 0, bottomMm: 0, leftMm: 0, rightMm: 0 },
};

function expectValidationError(fn: () => unknown, code: string): ValidationError {
  let caught: unknown = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  const err = caught as ValidationError;
  expect(err.context?.code).toBe(code);
  return err;
}

/**
 * Executes the sheet program with the real core and proves the leaves
 * correspond to the real placements (identity, dimensions and position).
 */
function validateSheetProgram(sheet: CutPlanSheet | PlacementResult): CutProgramTrace {
  const program = sheet.cutProgram;
  expect(program).toBeDefined();
  const trace = executeCutProgram(program as CutProgramInput);
  const pieces = 'pieces' in sheet ? sheet.pieces : [];
  expect(() =>
    checkExpectedPieces(
      trace,
      pieces.map((p) => ({ pieceRef: p.id, lengthMm: p.lengthMm, widthMm: p.widthMm })),
    ),
  ).not.toThrow();
  for (const piece of pieces) {
    const leaf = trace.terminals.find((t) => t.kind === 'piece' && t.pieceRef === piece.id);
    expect(leaf).toBeDefined();
    expect(leaf!.rect.xMm).toBeCloseTo(piece.xMm, 9);
    expect(leaf!.rect.yMm).toBeCloseTo(piece.yMm, 9);
    expect(leaf!.rect.lengthMm).toBeCloseTo(piece.lengthMm, 9);
    expect(leaf!.rect.widthMm).toBeCloseTo(piece.widthMm, 9);
  }
  expect(trace.leafAreaMm2 + trace.kerfAreaMm2).toBeCloseTo(trace.boardAreaMm2, 6);
  expect(program!.schemaVersion).toBe(CUT_PROGRAM_SCHEMA_VERSION);
  return trace;
}

describe('optimizer cut programs — registro durante el empaquetado', () => {
  it('Best Fit con primera división sobre X registra el programa real de la colocación', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'P1' })];
    const { sheet } = packSingleSheetGuillotineBestFit(
      unrollRows(rows), 0, 1000, 600, flatConfig, 'TEST', 'Tablero Test 18mm', 18, true,
    );

    expect(sheet.pieces[0]).toMatchObject({ xMm: 0, yMm: 0, lengthMm: 400, widthMm: 300 });
    const trace = validateSheetProgram(sheet);
    expect(trace.divisions[0]!.axis).toBe('x');
    expect(trace.divisions[0]!.keptExtentMm).toBe(400);
    expect(trace.divisions[0]!.restRect).toEqual({ xMm: 404, yMm: 0, lengthMm: 596, widthMm: 600 });
    expect(trace.divisions[1]!.axis).toBe('y');
    expect(trace.divisions[1]!.keptExtentMm).toBe(300);
    expect(trace.divisions[1]!.restRect).toEqual({ xMm: 0, yMm: 304, lengthMm: 400, widthMm: 296 });
    expect(trace.boardRect).toEqual({ xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 });
  });

  it('Best Fit con primera división sobre Y usa la otra secuencia, no la misma', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'P1' })];
    const { sheet } = packSingleSheetGuillotineBestFit(
      unrollRows(rows), 0, 1000, 600, flatConfig, 'TEST', 'Tablero Test 18mm', 18, false,
    );

    const trace = validateSheetProgram(sheet);
    expect(trace.divisions[0]!.axis).toBe('y');
    expect(trace.divisions[0]!.restRect).toEqual({ xMm: 0, yMm: 304, lengthMm: 1000, widthMm: 296 });
    expect(trace.divisions[1]!.axis).toBe('x');
    expect(trace.divisions[1]!.restRect).toEqual({ xMm: 404, yMm: 0, lengthMm: 596, widthMm: 300 });
  });

  it('Strip/Shelf registra separación de franja, troceado y el recorte de pieza menor que la franja', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'B' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unrollRows(rows), 0, 1000, 600, flatConfig, 'TEST', 'Tablero Test 18mm', 18,
    );

    expect(sheet.pieces).toHaveLength(2);
    const trace = validateSheetProgram(sheet);

    const stripDivision = trace.divisions.find((d) => d.cutId === 'strip-1');
    expect(stripDivision).toBeDefined();
    expect(stripDivision!.axis).toBe('y');
    expect(stripDivision!.keptExtentMm).toBe(320);
    expect(stripDivision!.keptRect).toEqual({ xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 320 });

    // Recorte explícito de la pieza B (210) dentro de la franja de 320: el
    // programa separa el sobrante sólido de 106 mm más el disco de 4 mm.
    const recut = trace.divisions.find((d) => d.cutId === 'place-2-y');
    expect(recut).toBeDefined();
    expect(recut!.axis).toBe('y');
    expect(recut!.keptExtentMm).toBe(210);
    expect(recut!.restRect).toEqual({ xMm: 454, yMm: 214, lengthMm: 280, widthMm: 106 });
    const underRest = trace.terminals.find(
      (t) => t.regionId === recut!.restRegionId,
    );
    expect(underRest?.kind).toBe('waste');

    const pieceB = sheet.pieces.find((p) => p.partCode === 'B')!;
    const leafB = trace.terminals.find((t) => t.kind === 'piece' && t.pieceRef === pieceB.id);
    expect(leafB).toBeDefined();
    expect(leafB!.rect).toEqual({ xMm: 454, yMm: 0, lengthMm: 280, widthMm: 210 });
  });

  it('R3: el retazo útil del recorte de franja (500×796) aparece en sheet.remnants y en el programa', () => {
    const config: CutPlanConfig = {
      ...flatConfig,
      allowRotationNoGrain: false,
    };
    const rows = [
      makeRow({ quantity: 1, lengthMm: 600, widthMm: 1000, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 500, widthMm: 200, grain: 1, partCode: 'B' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unrollRows(rows), 0, 1200, 1000, config, 'TEST', 'Tablero Test 18mm', 18,
    );

    // El recorte de B (franja 1000, pieza 200) libera 500×796 en X=604, Y=204.
    const useful = sheet.remnants.find(
      (r) => r.lengthMm === 500 && r.widthMm === 796,
    );
    expect(useful).toBeDefined();
    expect(useful).toMatchObject({ xMm: 604, yMm: 204, isUseful: true });
    expect(useful!.areaM2).toBeCloseTo(0.398, 6);

    const trace = validateSheetProgram(sheet);
    const terminal = trace.terminals.find(
      (t) => t.rect.lengthMm === 500 && t.rect.widthMm === 796,
    );
    expect(terminal?.kind).toBe('remnant');
    expect(terminal?.rect).toEqual({ xMm: 604, yMm: 204, lengthMm: 500, widthMm: 796 });

    // El sobrante derecho de 92×1000 sigue presente (política de presentación)
    // aunque no cumpla los umbrales de retazo útil.
    const rightLeftover = sheet.remnants.find((r) => r.lengthMm === 92);
    expect(rightLeftover).toBeDefined();
    expect(rightLeftover!.isUseful).toBe(false);
  });

  it('R3: correspondencia bidireccional entre terminales útiles del programa y lista de retazos', () => {
    const config: CutPlanConfig = {
      ...flatConfig,
      allowRotationNoGrain: false,
    };
    const rows = [
      makeRow({ quantity: 1, lengthMm: 600, widthMm: 1000, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 500, widthMm: 200, grain: 1, partCode: 'B' }),
      makeRow({ quantity: 1, lengthMm: 480, widthMm: 300, grain: 1, partCode: 'C' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unrollRows(rows), 0, 1200, 1000, config, 'TEST', 'Tablero Test 18mm', 18,
    );

    const trace = validateSheetProgram(sheet);
    const usefulTerminals = trace.terminals.filter((t) => t.kind === 'remnant');
    const usefulRemnants = sheet.remnants.filter((r) => r.isUseful);
    expect(usefulRemnants.length).toBe(usefulTerminals.length);
    const missing = usefulTerminals.filter(
      (terminal) =>
        !usefulRemnants.some(
          (r) =>
            r.xMm === terminal.rect.xMm &&
            r.yMm === terminal.rect.yMm &&
            r.lengthMm === terminal.rect.lengthMm &&
            r.widthMm === terminal.rect.widthMm,
        ),
    );
    expect(missing.map((t) => t.regionId)).toEqual([]);
    // Sin duplicados: ninguna geometría repetida en la lista.
    const keys = sheet.remnants.map((r) => `${r.xMm}:${r.yMm}:${r.lengthMm}x${r.widthMm}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Área útil coincidente entre programa y resultado.
    const programUseful = usefulTerminals.reduce(
      (sum, t) => sum + (t.rect.lengthMm * t.rect.widthMm) / 1_000_000,
      0,
    );
    const resultUseful = usefulRemnants.reduce((sum, r) => sum + r.areaM2, 0);
    expect(resultUseful).toBeCloseTo(programUseful, 9);
  });

  it('R3: varios tableros y materiales conservan la correspondencia retazos↔terminales', () => {
    const rows = [
      makeRow({ quantity: 3, lengthMm: 450, widthMm: 300, grain: 1, partCode: 'LAT' }),
      makeRow({ quantity: 2, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'BASE' }),
      makeRow({ quantity: 2, lengthMm: 300, widthMm: 200, grain: 1, partCode: 'T2', materialName: 'Tablero Alt 15mm' }),
    ];
    const plan = optimizeCutPlan('proj-r3-multi', rows, catalogMaterials, flatConfig);
    expect(plan.stats.byMaterial).toHaveLength(2);
    for (const sheet of plan.sheets) {
      const trace = validateSheetProgram(sheet);
      const usefulTerminals = trace.terminals.filter((t) => t.kind === 'remnant');
      const usefulRemnants = sheet.remnants.filter((r) => r.isUseful);
      expect(usefulRemnants.length).toBe(usefulTerminals.length);
      const missing = usefulTerminals.filter(
        (terminal) =>
          !usefulRemnants.some(
            (r) =>
              r.xMm === terminal.rect.xMm &&
              r.yMm === terminal.rect.yMm &&
              r.lengthMm === terminal.rect.lengthMm &&
              r.widthMm === terminal.rect.widthMm &&
              r.materialCode === sheet.materialCode &&
              r.sheetIndex === sheet.sheetIndex,
          ),
      );
      expect(missing.map((t) => `${t.regionId} en sheet ${sheet.sheetIndex}`)).toEqual([]);
      // Las estadísticas del tablero usan la misma verdad.
      const expectedUsefulM2 = usefulRemnants.reduce((sum, r) => sum + r.areaM2, 0);
      expect(sheet.usableRemnantAreaM2).toBeCloseTo(expectedUsefulM2, 6);
    }
  });

  it('la candidata ganadora conserva piezas, programa y terminales de la misma ejecución', () => {
    const rows = [
      makeRow({ quantity: 3, lengthMm: 450, widthMm: 300, grain: 1, partCode: 'LAT' }),
      makeRow({ quantity: 2, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'BASE' }),
    ];
    const plan = optimizeCutPlan('proj-candidate', rows, catalogMaterials, flatConfig);

    expect(plan.sheets.length).toBeGreaterThan(0);
    for (const sheet of plan.sheets) {
      const trace = validateSheetProgram(sheet);
      // Ninguna hoja de pieza ajena a este tablero: todos los pieceRef son
      // colocaciones de este sheet y todos los placed tienen su hoja.
      const pieceRefs = new Set(trace.terminals.filter((t) => t.kind === 'piece').map((t) => t.pieceRef));
      expect(pieceRefs.size).toBe(sheet.pieces.length);
    }
    const totalPlaced = plan.sheets.reduce((n, s) => n + s.pieces.length, 0);
    expect(totalPlaced).toBe(5);
  });

  it('pickWinningStrategyCandidate excluye a la candidata incompleta aunque use menos tableros', () => {
    const sheets: PlacementResult[] = [
      {
        pieces: [], remnants: [], instructions: [], sheetIndex: 0,
        sheetWidthMm: 600, sheetLengthMm: 1000, materialCode: 'TEST', materialName: 't',
      },
    ];
    const incomplete: StrategyCandidate = {
      strategy: 'strip',
      sheets,
      remaining: [
        { originalRow: makeRow({ quantity: 1, lengthMm: 900, widthMm: 500, grain: 1, partCode: 'X' }), indexInUnrolled: 1, length: 900, width: 500, grain: 1, id: 'X-1' },
      ],
      rejection: { code: 'cut_plan.pieces_not_placed', message: 'dejó piezas sin colocar' },
    };
    const complete: StrategyCandidate = {
      strategy: 'best-fit-v',
      sheets: [...sheets, ...sheets.map((s) => ({ ...s, sheetIndex: 1 }))],
      remaining: [],
    };

    const winner = pickWinningStrategyCandidate([incomplete, complete]);
    expect(winner.strategy).toBe('best-fit-v');
    expect(winner.sheets).toHaveLength(2);

    const error = expectValidationError(
      () => pickWinningStrategyCandidate([incomplete]),
      'cut_plan.no_representable_candidate',
    );
    expect(JSON.stringify(error.context)).toContain('cut_plan.pieces_not_placed');
  });
});

describe('optimizer cut programs — geometría y cantidades', () => {
  it('magnitudes decimales de #652 se mantienen válidas dentro del optimizador', () => {
    const config: CutPlanConfig = {
      ...flatConfig,
      sawKerfMm: 4.4,
    };
    const rows = [makeRow({ quantity: 2, lengthMm: 333.3, widthMm: 250.5, grain: 1, partCode: 'DEC' })];
    const plan = optimizeCutPlan('proj-dec', rows, catalogMaterials, config);

    for (const sheet of plan.sheets) {
      validateSheetProgram(sheet);
    }
    expect(plan.sheets[0]!.pieces[0]!.lengthMm).toBeCloseTo(333.3, 9);
  });

  it('trims asimétricos con kerf real: desperdicio sólido, banda de disco y área útil por separado', () => {
    const config: CutPlanConfig = {
      ...flatConfig,
      trim: { topMm: 7, bottomMm: 13, leftMm: 5, rightMm: 11 },
    };
    const rows = [makeRow({ quantity: 1, lengthMm: 900, widthMm: 500, grain: 1, partCode: 'TR' })];
    const plan = optimizeCutPlan('proj-trim', rows, catalogMaterials, config);

    const sheet = plan.sheets[0]!;
    // Coordenadas del área útil conservadas bajo la semántica de margen total.
    expect(sheet.pieces[0]).toMatchObject({ xMm: 5, yMm: 13, lengthMm: 900, widthMm: 500 });
    const trace = validateSheetProgram(sheet);

    const byCut = new Map(trace.divisions.map((d) => [d.cutId, d]));
    // Izquierda (margen 5, disco 4): sólido 0..1, banda 1..5, útil desde 5.
    const left = byCut.get('trim:left')!;
    expect(left.leadingBand).toBe(true);
    expect(left.kerfMm).toBe(4);
    expect(left.restRect).toEqual({ xMm: 0, yMm: 0, lengthMm: 1, widthMm: 600 });
    expect(left.kerfBandRect).toEqual({ xMm: 1, yMm: 0, lengthMm: 4, widthMm: 600 });
    expect(left.keptRect.xMm).toBe(5);
    // Derecha (margen 11, disco 4): útil hasta 989, banda 989..993, sólido 993..1000.
    const right = byCut.get('trim:right')!;
    expect(right.leadingBand).toBe(false);
    expect(right.kerfMm).toBe(4);
    expect(right.keptRect).toEqual({ xMm: 5, yMm: 0, lengthMm: 984, widthMm: 600 });
    expect(right.kerfBandRect).toEqual({ xMm: 989, yMm: 0, lengthMm: 4, widthMm: 600 });
    expect(right.restRect).toEqual({ xMm: 993, yMm: 0, lengthMm: 7, widthMm: 600 });
    // Abajo (margen 13, disco 4): sólido y 0..9, banda 9..13, útil desde 13.
    const bottom = byCut.get('trim:bottom')!;
    expect(bottom.leadingBand).toBe(true);
    expect(bottom.restRect).toEqual({ xMm: 5, yMm: 0, lengthMm: 984, widthMm: 9 });
    expect(bottom.kerfBandRect).toEqual({ xMm: 5, yMm: 9, lengthMm: 984, widthMm: 4 });
    expect(bottom.keptRect.yMm).toBe(13);
    // Arriba (margen 7, disco 4): útil hasta 593, banda 593..597, sólido 597..600.
    const top = byCut.get('trim:top')!;
    expect(top.leadingBand).toBe(false);
    expect(top.kerfBandRect).toEqual({ xMm: 5, yMm: 593, lengthMm: 984, widthMm: 4 });
    expect(top.restRect).toEqual({ xMm: 5, yMm: 597, lengthMm: 984, widthMm: 3 });

    // Identidad padre/hijas: el padre de cada trim es la región viva de la cadena.
    expect(left.parentRegionId).toBe('board');
    expect(right.parentRegionId).toBe(left.keptRegionId);
    expect(bottom.parentRegionId).toBe(right.keptRegionId);
    expect(top.parentRegionId).toBe(bottom.keptRegionId);

    // Separación desperdicio sólido / kerf y conservación del tablero crudo.
    const trimTerminals = trace.terminals.filter((t) => t.regionId.startsWith('trim:'));
    expect(trimTerminals).toHaveLength(4);
    expect(trimTerminals.every((t) => t.kind === 'waste')).toBe(true);
    const solidArea = trimTerminals.reduce((sum, t) => sum + t.rect.lengthMm * t.rect.widthMm, 0);
    const trimBandArea = [left, right, bottom, top].reduce(
      (sum, d) => sum + d.kerfBandRect.lengthMm * d.kerfBandRect.widthMm,
      0,
    );
    expect(solidArea).toBe((1 + 7) * 600 + (9 + 3) * 984);
    expect(trimBandArea).toBe((4 + 4) * 600 + (4 + 4) * 984);
    expect(trace.boardRect).toEqual({ xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 });
    expect(trace.leafAreaMm2 + trace.kerfAreaMm2).toBe(600000);
  });

  it('margen izquierdo 10 con disco 4: sólido 0..6, banda 6..10, útil desde 10, sin doble conteo', () => {
    const config: CutPlanConfig = {
      ...flatConfig,
      trim: { topMm: 0, bottomMm: 0, leftMm: 10, rightMm: 0 },
    };
    const rows = [makeRow({ quantity: 1, lengthMm: 900, widthMm: 500, grain: 1, partCode: 'TR' })];
    const plan = optimizeCutPlan('proj-trim-left', rows, catalogMaterials, config);

    const sheet = plan.sheets[0]!;
    expect(sheet.pieces[0]!.xMm).toBe(10);
    const trace = validateSheetProgram(sheet);
    const left = trace.divisions.find((d) => d.cutId === 'trim:left')!;
    expect(left.restRect).toEqual({ xMm: 0, yMm: 0, lengthMm: 6, widthMm: 600 });
    expect(left.kerfBandRect).toEqual({ xMm: 6, yMm: 0, lengthMm: 4, widthMm: 600 });
    expect(left.keptRect.xMm).toBe(10);
    // 3600 de sólido + 2400 de disco = 6000 retirados; ni 6000+2400 ni disco de área cero.
    expect(left.restRect!.lengthMm * left.restRect!.widthMm).toBe(3600);
    expect(left.kerfBandRect.lengthMm * left.kerfBandRect.widthMm).toBe(2400);
  });

  it('margen igual al kerf: toda la banda retirada es disco, sin sólido ni región de área cero', () => {
    const config: CutPlanConfig = {
      ...flatConfig,
      trim: { topMm: 0, bottomMm: 0, leftMm: 4, rightMm: 4 },
    };
    const rows = [makeRow({ quantity: 1, lengthMm: 900, widthMm: 500, grain: 1, partCode: 'TR' })];
    const plan = optimizeCutPlan('proj-trim-eq', rows, catalogMaterials, config);

    const sheet = plan.sheets[0]!;
    expect(sheet.pieces[0]!.xMm).toBe(4);
    expect(sheet.pieces[0]!.xMm + sheet.pieces[0]!.lengthMm).toBe(904);
    const trace = validateSheetProgram(sheet);
    const left = trace.divisions.find((d) => d.cutId === 'trim:left')!;
    expect(left.restRect).toBeNull();
    expect(left.kerfBandRect).toEqual({ xMm: 0, yMm: 0, lengthMm: 4, widthMm: 600 });
    const right = trace.divisions.find((d) => d.cutId === 'trim:right')!;
    expect(right.restRect).toBeNull();
    expect(right.kerfBandRect).toEqual({ xMm: 996, yMm: 0, lengthMm: 4, widthMm: 600 });
    expect(
      left.kerfBandRect.lengthMm * left.kerfBandRect.widthMm +
        right.kerfBandRect.lengthMm * right.kerfBandRect.widthMm,
    ).toBe(4800);
  });

  it('margen menor que el kerf: banda recortada al margen y disco que sale del tablero, con política explícita', () => {
    const config: CutPlanConfig = {
      ...flatConfig,
      trim: { topMm: 0, bottomMm: 0, leftMm: 2, rightMm: 0 },
    };
    const rows = [makeRow({ quantity: 1, lengthMm: 900, widthMm: 500, grain: 1, partCode: 'TR' })];
    const plan = optimizeCutPlan('proj-trim-lt', rows, catalogMaterials, config);

    const sheet = plan.sheets[0]!;
    expect(sheet.pieces[0]!.xMm).toBe(2);
    const trace = validateSheetProgram(sheet);
    const left = trace.divisions.find((d) => d.cutId === 'trim:left')!;
    expect(left.bladeExitsParent).toBe(true);
    expect(left.leadingBand).toBe(true);
    expect(left.kerfMm).toBe(4);
    expect(left.kerfBandRect).toEqual({ xMm: 0, yMm: 0, lengthMm: 2, widthMm: 600 });
    expect(left.restRect).toBeNull();
    expect(left.kerfBandRect.lengthMm * left.kerfBandRect.widthMm).toBe(1200);
  });

  it('kerf configurado a cero: el sólido cubre todo el margen y la banda es nula, sin confundir configuraciones', () => {
    const zeroKerfConfig: CutPlanConfig = {
      ...flatConfig,
      sawKerfMm: 0,
      trim: { topMm: 0, bottomMm: 0, leftMm: 10, rightMm: 0 },
    };
    const rows = [makeRow({ quantity: 1, lengthMm: 900, widthMm: 500, grain: 1, partCode: 'TR' })];
    const plan = optimizeCutPlan('proj-trim-zero', rows, catalogMaterials, zeroKerfConfig);

    const sheet = plan.sheets[0]!;
    expect(sheet.pieces[0]!.xMm).toBe(10);
    const trace = validateSheetProgram(sheet);
    const left = trace.divisions.find((d) => d.cutId === 'trim:left')!;
    expect(left.kerfMm).toBe(0);
    expect(left.restRect).toEqual({ xMm: 0, yMm: 0, lengthMm: 10, widthMm: 600 });
    expect(left.kerfBandRect.lengthMm).toBe(0);
    expect(trace.kerfAreaMm2).toBe(0);
  });

  it('el canto se deduce una sola vez: la hoja mide exactamente la medida de corte', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 720, widthMm: 400, grain: 1, partCode: 'PU', edgeBandThicknessMm: 2 }),
    ];
    const plan = optimizeCutPlan('proj-edge', rows, catalogMaterials, flatConfig);

    const sheet = plan.sheets[0]!;
    expect(sheet.pieces[0]!.lengthMm).toBe(716);
    expect(sheet.pieces[0]!.widthMm).toBe(396);
    const trace = validateSheetProgram(sheet);
    const leaf = trace.terminals.find((t) => t.kind === 'piece')!;
    expect(leaf.rect.lengthMm).toBe(716);
    expect(leaf.rect.widthMm).toBe(396);
  });

  it('pieza rotada (sin veta) y pieza con veta no rotada: el programa refleja la orientación colocada', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 950, widthMm: 580, grain: 1, partCode: 'FIJA' }),
      makeRow({ quantity: 1, lengthMm: 550, widthMm: 40, grain: 0, partCode: 'LIBRE' }),
    ];
    const { sheet } = packSingleSheetGuillotineBestFit(
      unrollRows(rows), 0, 1000, 600, flatConfig, 'TEST', 'Tablero Test 18mm', 18, true,
    );

    const fixed = sheet.pieces.find((p) => p.partCode === 'FIJA')!;
    const free = sheet.pieces.find((p) => p.partCode === 'LIBRE')!;
    expect(fixed.rotated).toBe(false);
    expect(free.rotated).toBe(true);
    expect(free).toMatchObject({ xMm: 954, yMm: 0, lengthMm: 40, widthMm: 550 });

    const trace = validateSheetProgram(sheet);
    const freeLeaf = trace.terminals.find((t) => t.kind === 'piece' && t.pieceRef === free.id)!;
    expect(freeLeaf.rect).toEqual({ xMm: 954, yMm: 0, lengthMm: 40, widthMm: 550 });
  });

  it('piezas idénticas con referencias distintas conservan identidades separadas', () => {
    const rows = [makeRow({ quantity: 3, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'DUP' })];
    const plan = optimizeCutPlan('proj-dup', rows, catalogMaterials, flatConfig);

    const refs = new Set<string>();
    for (const sheet of plan.sheets) {
      const trace = validateSheetProgram(sheet);
      for (const terminal of trace.terminals.filter((t) => t.kind === 'piece')) {
        refs.add(terminal.pieceRef!);
      }
    }
    expect(refs.size).toBe(3);
  });

  it('encaje exacto con kerf-only: hay pasada real y ninguna región de área cero', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 996, widthMm: 596, grain: 1, partCode: 'EXACTO' })];
    const plan = optimizeCutPlan('proj-exacto', rows, catalogMaterials, flatConfig);

    const sheet = plan.sheets[0]!;
    const trace = validateSheetProgram(sheet);
    expect(trace.divisions).toHaveLength(2);
    expect(trace.divisions.every((d) => d.restRect === null)).toBe(true);
    expect(trace.divisions.every((d) => d.bladeExitsParent === false)).toBe(true);
    const pieceLeaf = trace.terminals.find((t) => t.kind === 'piece')!;
    expect(pieceLeaf.rect).toEqual({ xMm: 0, yMm: 0, lengthMm: 996, widthMm: 596 });
    // 593616 de pieza + 2400 + 3984 de disco = 600000 del tablero.
    expect(trace.leafAreaMm2).toBe(593616);
    expect(trace.kerfAreaMm2).toBe(6384);
  });

  it('encaje exacto total en un eje: hoja terminal sin pasada ficticia', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 996, widthMm: 600, grain: 1, partCode: 'PLENO' })];
    const plan = optimizeCutPlan('proj-pleno', rows, catalogMaterials, flatConfig);

    const sheet = plan.sheets[0]!;
    const trace = validateSheetProgram(sheet);
    expect(trace.divisions).toHaveLength(1);
    expect(trace.divisions[0]!.axis).toBe('x');
    expect(trace.terminals).toHaveLength(1);
    expect(trace.terminals[0]!.kind).toBe('piece');
    expect(trace.terminals[0]!.rect).toEqual({ xMm: 0, yMm: 0, lengthMm: 996, widthMm: 600 });
  });

  it('sobrantes menores que el umbral visual siguen siendo terminales reales del programa', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' }),
      makeRow({ quantity: 1, lengthMm: 540, widthMm: 320, grain: 1, partCode: 'B' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unrollRows(rows), 0, 1000, 600, flatConfig, 'TEST', 'Tablero Test 18mm', 18,
    );

    // El remanente de franja de 2 mm no entra en la lista histórica (>10)...
    expect(sheet.remnants.every((r) => r.lengthMm > 10)).toBe(true);
    // ...pero el programa no lo borra para cuadrar cifras.
    const trace = validateSheetProgram(sheet);
    const tiny = trace.terminals.find((t) => t.rect.lengthMm === 2);
    expect(tiny).toBeDefined();
    expect(tiny!.rect).toEqual({ xMm: 998, yMm: 0, lengthMm: 2, widthMm: 320 });
    expect(tiny!.kind).toBe('waste');
  });

  it('varios tableros: cada tablero lleva su propio programa validado', () => {
    const rows = [makeRow({ quantity: 4, lengthMm: 450, widthMm: 580, grain: 1, partCode: 'GRAN' })];
    const plan = optimizeCutPlan('proj-multi-sheet', rows, catalogMaterials, flatConfig);

    expect(plan.sheets.length).toBeGreaterThanOrEqual(2);
    for (const sheet of plan.sheets) {
      expect(sheet.cutProgram).toBeDefined();
      validateSheetProgram(sheet);
      const trace = executeCutProgram(sheet.cutProgram!);
      expect(trace.terminals.filter((t) => t.kind === 'piece')).toHaveLength(sheet.pieces.length);
    }
  });

  it('varios materiales: los programas corresponden a su propio tablero y piezas', () => {
    const rows = [
      makeRow({ quantity: 2, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'T1' }),
      makeRow({ quantity: 2, lengthMm: 300, widthMm: 200, grain: 1, partCode: 'T2', materialName: 'Tablero Alt 15mm' }),
    ];
    const plan = optimizeCutPlan('proj-multi-mat', rows, catalogMaterials, flatConfig);

    expect(plan.stats.byMaterial).toHaveLength(2);
    for (const sheet of plan.sheets) {
      const trace = validateSheetProgram(sheet);
      expect(trace.boardRect.lengthMm).toBe(sheet.sheetLengthMm);
      expect(trace.boardRect.widthMm).toBe(sheet.sheetWidthMm);
      for (const piece of sheet.pieces) {
        expect(piece.materialCode).toBe(sheet.materialCode);
      }
    }
  });

  it('rechaza una demanda con una pieza imposible de colocar, con las piezas involucradas', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 400, widthMm: 300, grain: 1, partCode: 'OK' }),
      makeRow({ quantity: 1, lengthMm: 1200, widthMm: 300, grain: 1, partCode: 'IMPOSIBLE' }),
    ];
    const error = expectValidationError(
      () => optimizeCutPlan('proj-imp', rows, catalogMaterials, flatConfig),
      'cut_plan.no_representable_candidate',
    );
    const rejections = (error.context as unknown as { rejections: { code: string; context?: { pieces?: { partCode: string }[] } }[] }).rejections;
    expect(rejections).toHaveLength(3);
    expect(rejections.every((r) => r.code === 'cut_plan.pieces_not_placed')).toBe(true);
    expect(rejections.every((r) => r.context?.pieces?.some((p) => p.partCode === 'IMPOSIBLE'))).toBe(true);
  });

  it('demanda realmente vacía: política explícita y compatible (cero tableros, sin error)', () => {
    const plan = optimizeCutPlan('proj-empty', [], catalogMaterials, flatConfig);
    expect(plan.sheets).toHaveLength(0);
    expect(plan.stats.totalSheets).toBe(0);
  });
});

describe('optimizer cut programs — integración del resultado', () => {
  const rows = [
    makeRow({ quantity: 3, lengthMm: 450, widthMm: 300, grain: 1, partCode: 'LAT' }),
    makeRow({ quantity: 2, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'BASE' }),
  ];

  it('buildSheetModels conserva el programa de cada tablero aceptado', () => {
    const plan = optimizeCutPlan('proj-build', rows, catalogMaterials, flatConfig);
    expect(plan.sheets.length).toBeGreaterThan(0);
    for (const sheet of plan.sheets) {
      expect(sheet.cutProgram).toBeDefined();
      validateSheetProgram(sheet);
    }
  });

  it('el dato serializable sobrevive el round-trip JSON y reproduce la misma traza', () => {
    const plan = optimizeCutPlan('proj-json', rows, catalogMaterials, flatConfig);
    for (const sheet of plan.sheets) {
      const roundTripped = JSON.parse(JSON.stringify(sheet.cutProgram)) as CutProgramInput;
      const before = executeCutProgram(sheet.cutProgram!);
      const after = executeCutProgram(roundTripped);
      expect(after).toEqual(before);
    }
  });

  it('eliminar una división del programa serializado no pasa la validación', () => {
    const plan = optimizeCutPlan('proj-neg1', rows, catalogMaterials, flatConfig);
    const program = JSON.parse(JSON.stringify(plan.sheets[0]!.cutProgram)) as CutProgramInput;
    const mutated: CutProgramInput = { ...program, divisions: program.divisions.slice(0, -1) };
    expectValidationError(() => executeCutProgram(mutated), 'cut_program.orphan_region');
  });

  it('eliminar una hoja terminal del programa serializado no pasa la validación', () => {
    const plan = optimizeCutPlan('proj-neg2', rows, catalogMaterials, flatConfig);
    const program = JSON.parse(JSON.stringify(plan.sheets[0]!.cutProgram)) as CutProgramInput;
    const mutated: CutProgramInput = { ...program, terminals: program.terminals.slice(0, -1) };
    expectValidationError(() => executeCutProgram(mutated), 'cut_program.incomplete_program');
  });

  it('cnc-nesting no produce ni exige programas guillotina (sin degradación)', () => {
    const nestConfig: CutPlanConfig = {
      ...flatConfig,
      cutStrategy: 'cnc-nesting',
      toolSpacingMm: 8,
    };
    const plan = optimizeCutPlan('proj-nest', rows, catalogMaterials, nestConfig);
    expect(plan.sheets.length).toBeGreaterThan(0);
    for (const sheet of plan.sheets) {
      expect(sheet.strategy).toBe('cnc-nesting');
      expect(sheet.cutProgram).toBeUndefined();
    }
  });
});

describe('optimizer cut programs — determinismo y no mutación', () => {
  const rows = [
    makeRow({ quantity: 3, lengthMm: 450, widthMm: 300, grain: 1, partCode: 'LAT' }),
    makeRow({ quantity: 2, lengthMm: 280, widthMm: 210, grain: 0, partCode: 'BASE' }),
  ];

  it('mismo input produce el mismo programa y la misma selección', () => {
    const first = optimizeCutPlan('proj-det', rows, catalogMaterials, flatConfig);
    const second = optimizeCutPlan('proj-det', rows, catalogMaterials, flatConfig);
    // El envoltorio CutPlan lleva id/generatedAt temporales: la igualdad
    // geométrica se comprueba sobre sheets (piezas + programas + terminales).
    expect(first.sheets).toEqual(second.sheets);
    expect(first.stats).toEqual(second.stats);
  });

  it('no muta cutRows, catálogo ni configuración', () => {
    const frozenRows = deepFreeze(JSON.parse(JSON.stringify(rows))) as ProductionCutRow[];
    const frozenCatalog = deepFreeze(JSON.parse(JSON.stringify(catalogMaterials))) as MaterialBoard[];
    const frozenConfig = deepFreeze(JSON.parse(JSON.stringify(flatConfig))) as CutPlanConfig;

    const plan = optimizeCutPlan('proj-frozen', frozenRows, frozenCatalog, frozenConfig);
    expect(plan.sheets.length).toBeGreaterThan(0);
    expect(frozenRows).toEqual(JSON.parse(JSON.stringify(rows)));
    expect(frozenCatalog).toEqual(JSON.parse(JSON.stringify(catalogMaterials)));
    expect(frozenConfig).toEqual(JSON.parse(JSON.stringify(flatConfig)));
  });
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
