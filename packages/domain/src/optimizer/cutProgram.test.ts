import { describe, it, expect } from 'vitest';
import { ValidationError } from '../errors';
import {
  CUT_PROGRAM_SCHEMA_VERSION,
  checkExpectedPieces,
  divideRegion,
  executeCutProgram,
  type CutProgramInput,
} from './cutProgram';
import {
  threePhaseExerciseExpectedPieces,
  threePhaseExerciseProgram,
  verticalCounterexampleExpectedPieces,
  verticalCounterexampleProgram,
} from '../__fixtures__/cutProgramScenarios';

function expectCutProgramError(
  fn: () => unknown,
  code: string,
  contextMatch: Record<string, unknown> = {},
): void {
  let caught: unknown = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  const err = caught as ValidationError;
  expect(err.context?.code).toBe(code);
  for (const [key, value] of Object.entries(contextMatch)) {
    expect(err.context).toMatchObject({ [key]: value });
  }
}

/** Deeply-writable mirror of CutProgramInput for negative-test mutation. */
interface MutableCutProgram {
  schemaVersion: string;
  boardRegionId: string;
  regions: {
    regionId: string;
    rect: { xMm: number; yMm: number; lengthMm: number; widthMm: number };
  }[];
  divisions: {
    cutId: string;
    parentRegionId: string;
    axis: 'x' | 'y';
    keptExtentMm: number;
    kerfMm: number;
    keptRegionId: string;
    restRegionId: string;
  }[];
  terminals: {
    regionId: string;
    kind: 'piece' | 'remnant' | 'waste';
    pieceRef?: string;
  }[];
}

function cloneProgram(program: CutProgramInput): MutableCutProgram {
  return structuredClone(program) as MutableCutProgram;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

describe('divideRegion', () => {
  it('divide sobre el eje X: kept conserva el origen del padre y el resto queda tras el kerf', () => {
    const parent = { xMm: 0, yMm: 0, lengthMm: 1200, widthMm: 700 };
    const geometry = divideRegion(parent, 'x', 450, 4);
    expect(geometry.keptRect).toEqual({ xMm: 0, yMm: 0, lengthMm: 450, widthMm: 700 });
    expect(geometry.kerfBandRect).toEqual({ xMm: 450, yMm: 0, lengthMm: 4, widthMm: 700 });
    expect(geometry.restRect).toEqual({ xMm: 454, yMm: 0, lengthMm: 746, widthMm: 700 });
  });

  it('divide sobre el eje Y: la medida avanza sobre Y y la banda cruza el largo del padre', () => {
    const parent = { xMm: 0, yMm: 0, lengthMm: 1200, widthMm: 700 };
    const geometry = divideRegion(parent, 'y', 320, 4);
    expect(geometry.keptRect).toEqual({ xMm: 0, yMm: 0, lengthMm: 1200, widthMm: 320 });
    expect(geometry.kerfBandRect).toEqual({ xMm: 0, yMm: 320, lengthMm: 1200, widthMm: 4 });
    expect(geometry.restRect).toEqual({ xMm: 0, yMm: 324, lengthMm: 1200, widthMm: 376 });
  });

  it('región desplazada: la medida es local al padre y las coordenadas resultantes son globales', () => {
    const parent = { xMm: 100, yMm: 50, lengthMm: 800, widthMm: 600 };
    const geometry = divideRegion(parent, 'x', 300, 4);
    expect(geometry.keptExtentMm).toBe(300);
    expect(geometry.keptRect).toEqual({ xMm: 100, yMm: 50, lengthMm: 300, widthMm: 600 });
    expect(geometry.kerfBandRect.xMm).toBe(400);
    expect(geometry.restRect).toEqual({ xMm: 404, yMm: 50, lengthMm: 496, widthMm: 600 });
  });

  it('magnitudes decimales se reproducen sin tolerancia de fabricación', () => {
    const parent = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
    const geometry = divideRegion(parent, 'x', 333.3, 4);
    expect(geometry.kerfBandRect.xMm).toBeCloseTo(333.3, 9);
    expect(geometry.restRect.xMm).toBeCloseTo(337.3, 9);
    expect(geometry.restRect.lengthMm).toBeCloseTo(662.7, 9);
  });

  it('kerf cero es válido: banda de área nula que no fabrica una región física', () => {
    const parent = { xMm: 0, yMm: 0, lengthMm: 500, widthMm: 400 };
    const geometry = divideRegion(parent, 'y', 200, 0);
    expect(geometry.kerfBandRect.widthMm).toBe(0);
    expect(geometry.kerfBandRect.lengthMm * geometry.kerfBandRect.widthMm).toBe(0);
    expect(geometry.restRect).toEqual({ xMm: 0, yMm: 200, lengthMm: 500, widthMm: 200 });
  });

  it('rechaza medida fuera del dominio: cero, negativa, mayor que el padre o NaN/Infinity', () => {
    const parent = { xMm: 0, yMm: 0, lengthMm: 1200, widthMm: 700 };
    expectCutProgramError(() => divideRegion(parent, 'x', 0, 4), 'cut_program.measure_invalid');
    expectCutProgramError(() => divideRegion(parent, 'x', -10, 4), 'cut_program.measure_invalid');
    expectCutProgramError(() => divideRegion(parent, 'x', Number.NaN, 4), 'cut_program.measure_invalid');
    expectCutProgramError(
      () => divideRegion(parent, 'x', Number.POSITIVE_INFINITY, 4),
      'cut_program.measure_invalid',
    );
  });

  it('rechaza corte al borde con limitación explícita: resto de extensión cero no es una pasada', () => {
    const parent = { xMm: 0, yMm: 0, lengthMm: 1200, widthMm: 700 };
    expectCutProgramError(
      () => divideRegion(parent, 'x', 1200, 4),
      'cut_program.cut_at_border_unsupported',
    );
    expectCutProgramError(
      () => divideRegion(parent, 'x', 1197, 4),
      'cut_program.cut_at_border_unsupported',
      { keptExtentMm: 1197, kerfMm: 4 },
    );
  });

  it('rechaza kerf inválido: negativo, NaN o Infinity', () => {
    const parent = { xMm: 0, yMm: 0, lengthMm: 1200, widthMm: 700 };
    expectCutProgramError(() => divideRegion(parent, 'x', 450, -1), 'cut_program.kerf_invalid');
    expectCutProgramError(() => divideRegion(parent, 'x', 450, Number.NaN), 'cut_program.kerf_invalid');
    expectCutProgramError(
      () => divideRegion(parent, 'x', 450, Number.POSITIVE_INFINITY),
      'cut_program.kerf_invalid',
    );
  });

  it('rechaza rectángulo padre con dimensiones no finitas o no positivas', () => {
    expectCutProgramError(
      () => divideRegion({ xMm: 0, yMm: 0, lengthMm: Number.NaN, widthMm: 700 }, 'x', 100, 4),
      'cut_program.region_invalid',
    );
    expectCutProgramError(
      () => divideRegion({ xMm: 0, yMm: 0, lengthMm: 1200, widthMm: Number.POSITIVE_INFINITY }, 'y', 100, 4),
      'cut_program.region_invalid',
    );
    expectCutProgramError(
      () => divideRegion({ xMm: 0, yMm: 0, lengthMm: 0, widthMm: 700 }, 'x', 100, 4),
      'cut_program.region_invalid',
    );
  });
});

describe('executeCutProgram — ejercicio documental de tercera fase', () => {
  it('reproduce las cuatro operaciones con geometría y orden exactos', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    expect(trace.divisions).toHaveLength(4);
    expect(trace.divisions.map((d) => d.order)).toEqual([1, 2, 3, 4]);
    expect(trace.divisions.map((d) => d.cutId)).toEqual(['CUT_A', 'CUT_B', 'CUT_C', 'CUT_D']);

    const cutA = trace.divisions[0]!;
    expect(cutA.parentRegionId).toBe('BOARD');
    expect(cutA.axis).toBe('y');
    expect(cutA.keptExtentMm).toBe(320);
    expect(cutA.kerfBandRect).toEqual({ xMm: 0, yMm: 320, lengthMm: 1200, widthMm: 4 });

    const cutB = trace.divisions[1]!;
    expect(cutB.parentRegionId).toBe('STRIP');
    expect(cutB.kerfBandRect).toEqual({ xMm: 450, yMm: 0, lengthMm: 4, widthMm: 320 });
  });

  it('el bloque B empieza en X=454, su borde conservado termina en X=734 y la medida del corte es 280, no 734', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    const cutC = trace.divisions[2]!;
    expect(cutC.cutId).toBe('CUT_C');
    expect(cutC.keptRegionId).toBe('BLOCK_B');
    expect(cutC.keptRect.xMm).toBe(454);
    expect(cutC.keptRect.xMm + cutC.keptRect.lengthMm).toBe(734);
    expect(cutC.kerfBandRect.xMm).toBe(734);
    expect(cutC.keptExtentMm).toBe(280);
  });

  it('el cuarto corte queda limitado al bloque B: su banda no cruza el tablero ni la pieza A', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    const cutD = trace.divisions[3]!;
    expect(cutD.parentRegionId).toBe('BLOCK_B');
    expect(cutD.parentRect).toEqual({ xMm: 454, yMm: 0, lengthMm: 280, widthMm: 320 });
    expect(cutD.kerfBandRect).toEqual({ xMm: 454, yMm: 210, lengthMm: 280, widthMm: 4 });
    expect(cutD.kerfBandRect.lengthMm).toBeLessThan(1200);
  });

  it('conserva la superficie: 831520 de hojas + 8480 de kerf = 840000 del tablero', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    expect(trace.boardAreaMm2).toBe(840000);
    expect(trace.leafAreaMm2).toBe(831520);
    expect(trace.kerfAreaMm2).toBe(8480);
    expect(trace.leafAreaMm2 + trace.kerfAreaMm2).toBe(trace.boardAreaMm2);
  });

  it('produce exactamente las hojas terminales esperadas con sus bandas de kerf identificadas', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    expect(trace.terminals.map((t) => t.regionId).sort()).toEqual(
      ['PART_A', 'PART_B', 'REM_B', 'REM_RIGHT', 'REM_TOP'].sort(),
    );
    expect(trace.kerfBands.map((b) => b.bandId)).toEqual([
      'kerf:CUT_A',
      'kerf:CUT_B',
      'kerf:CUT_C',
      'kerf:CUT_D',
    ]);
    expect(trace.regionRects.size).toBe(9);
  });

  it('valida las piezas esperadas del fixture documental', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    expect(() =>
      checkExpectedPieces(trace, threePhaseExerciseExpectedPieces),
    ).not.toThrow();
  });
});

describe('executeCutProgram — contraejemplo vertical documental', () => {
  it('primera separación avanza en X=400; los cortes siguientes quedan limitados a la región derecha', () => {
    const trace = executeCutProgram(verticalCounterexampleProgram);
    const first = trace.divisions[0]!;
    expect(first.axis).toBe('x');
    expect(first.keptExtentMm).toBe(400);
    expect(first.kerfBandRect).toEqual({ xMm: 400, yMm: 0, lengthMm: 4, widthMm: 600 });

    const cut2 = trace.divisions[1]!;
    expect(cut2.parentRegionId).toBe('RIGHT');
    expect(cut2.kerfBandRect).toEqual({ xMm: 404, yMm: 196, lengthMm: 596, widthMm: 4 });

    const cut3 = trace.divisions[2]!;
    expect(cut3.parentRegionId).toBe('MID');
    expect(cut3.kerfBandRect).toEqual({ xMm: 404, yMm: 396, lengthMm: 596, widthMm: 4 });
  });

  it('dimensiones y cantidades finales correctas con conservación geométrica bajo kerf', () => {
    const trace = executeCutProgram(verticalCounterexampleProgram);
    expect(trace.terminals).toHaveLength(4);
    expect(trace.boardAreaMm2).toBe(600000);
    expect(trace.leafAreaMm2).toBe(592832);
    expect(trace.kerfAreaMm2).toBe(7168);
    expect(() =>
      checkExpectedPieces(trace, verticalCounterexampleExpectedPieces),
    ).not.toThrow();
  });

  it('dos piezas idénticas con referencias distintas conservan identidades separadas', () => {
    const trace = executeCutProgram(verticalCounterexampleProgram);
    const pieceB = trace.terminals.find((t) => t.pieceRef === 'PIEZA-B')!;
    const pieceC = trace.terminals.find((t) => t.pieceRef === 'PIEZA-C')!;
    expect(pieceB.regionId).toBe('PART_B');
    expect(pieceC.regionId).toBe('PART_C');
    expect(pieceB.regionId).not.toBe(pieceC.regionId);
    expect(pieceB.rect.lengthMm).toBe(pieceC.rect.lengthMm);
    expect(pieceB.rect.widthMm).toBe(pieceC.rect.widthMm);
    expect(pieceB.rect.yMm).not.toBe(pieceC.rect.yMm);
  });

  it('la pieza D es una hoja de tamaño exacto sin pasada adicional', () => {
    const trace = executeCutProgram(verticalCounterexampleProgram);
    const pieceD = trace.terminals.find((t) => t.pieceRef === 'PIEZA-D')!;
    expect(pieceD.regionId).toBe('PART_D');
    expect(trace.divisions.some((d) => d.parentRegionId === 'PART_D')).toBe(false);
    expect(pieceD.rect).toEqual({ xMm: 404, yMm: 400, lengthMm: 596, widthMm: 200 });
  });
});

describe('executeCutProgram — casos estructurales adicionales', () => {
  it('tablero desplazado: la traza trabaja en coordenadas globales con medida relativa local', () => {
    const program: CutProgramInput = {
      schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
      boardRegionId: 'BOARD',
      regions: [
        { regionId: 'BOARD', rect: { xMm: 100, yMm: 50, lengthMm: 800, widthMm: 600 } },
        { regionId: 'KEPT', rect: { xMm: 100, yMm: 50, lengthMm: 300, widthMm: 600 } },
        { regionId: 'REST', rect: { xMm: 404, yMm: 50, lengthMm: 496, widthMm: 600 } },
      ],
      divisions: [
        {
          cutId: 'CUT_1',
          parentRegionId: 'BOARD',
          axis: 'x',
          keptExtentMm: 300,
          kerfMm: 4,
          keptRegionId: 'KEPT',
          restRegionId: 'REST',
        },
      ],
      terminals: [
        { regionId: 'KEPT', kind: 'piece', pieceRef: 'P1' },
        { regionId: 'REST', kind: 'remnant' },
      ],
    };
    const trace = executeCutProgram(program);
    expect(trace.divisions[0]!.keptExtentMm).toBe(300);
    expect(trace.divisions[0]!.kerfBandRect).toEqual({ xMm: 400, yMm: 50, lengthMm: 4, widthMm: 600 });
    expect(() =>
      checkExpectedPieces(trace, [{ pieceRef: 'P1', lengthMm: 300, widthMm: 600 }]),
    ).not.toThrow();
  });

  it('magnitudes decimales en un programa completo', () => {
    const program: CutProgramInput = {
      schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
      boardRegionId: 'BOARD',
      regions: [
        { regionId: 'BOARD', rect: { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 } },
        { regionId: 'P1', rect: { xMm: 0, yMm: 0, lengthMm: 333.3, widthMm: 600 } },
        { regionId: 'REST', rect: { xMm: 337.3, yMm: 0, lengthMm: 662.7, widthMm: 600 } },
      ],
      divisions: [
        {
          cutId: 'CUT_1',
          parentRegionId: 'BOARD',
          axis: 'x',
          keptExtentMm: 333.3,
          kerfMm: 4,
          keptRegionId: 'P1',
          restRegionId: 'REST',
        },
      ],
      terminals: [
        { regionId: 'P1', kind: 'piece', pieceRef: 'P1' },
        { regionId: 'REST', kind: 'remnant' },
      ],
    };
    const trace = executeCutProgram(program);
    expect(trace.leafAreaMm2 + trace.kerfAreaMm2).toBeCloseTo(600000, 6);
    expect(() =>
      checkExpectedPieces(trace, [{ pieceRef: 'P1', lengthMm: 333.3, widthMm: 600 }]),
    ).not.toThrow();
  });

  it('kerf cero: sin región fantasma y con conservación exacta', () => {
    const program: CutProgramInput = {
      schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
      boardRegionId: 'BOARD',
      regions: [
        { regionId: 'BOARD', rect: { xMm: 0, yMm: 0, lengthMm: 500, widthMm: 400 } },
        { regionId: 'TOP', rect: { xMm: 0, yMm: 0, lengthMm: 500, widthMm: 200 } },
        { regionId: 'BOTTOM', rect: { xMm: 0, yMm: 200, lengthMm: 500, widthMm: 200 } },
      ],
      divisions: [
        {
          cutId: 'CUT_1',
          parentRegionId: 'BOARD',
          axis: 'y',
          keptExtentMm: 200,
          kerfMm: 0,
          keptRegionId: 'TOP',
          restRegionId: 'BOTTOM',
        },
      ],
      terminals: [
        { regionId: 'TOP', kind: 'piece', pieceRef: 'P1' },
        { regionId: 'BOTTOM', kind: 'remnant' },
      ],
    };
    const trace = executeCutProgram(program);
    expect(trace.kerfAreaMm2).toBe(0);
    expect(trace.regionRects.size).toBe(3);
    expect(trace.leafAreaMm2).toBe(200000);
    expect(trace.leafAreaMm2).toBe(trace.boardAreaMm2);
  });

  it('mismo input produce el mismo resultado y no muta los argumentos', () => {
    const frozenProgram = deepFreeze(cloneProgram(threePhaseExerciseProgram));
    const pristine = cloneProgram(threePhaseExerciseProgram);
    const first = executeCutProgram(frozenProgram);
    const second = executeCutProgram(frozenProgram);
    expect(first).toEqual(second);
    expect(frozenProgram).toEqual(pristine);
    expect(() =>
      checkExpectedPieces(first, structuredClone(threePhaseExerciseExpectedPieces)),
    ).not.toThrow();
  });
});

describe('executeCutProgram — rechazos', () => {
  it('padre inexistente', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.divisions[1]!.parentRegionId = 'GHOST';
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.reference_missing',
      { cutId: 'CUT_B', regionId: 'GHOST' },
    );
  });

  it('padre todavía no disponible: el corte se ejecuta antes de que la región exista', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    const [cutA, cutB, ...rest] = program.divisions;
    program.divisions = [cutB!, cutA!, ...rest];
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.parent_not_yet_available',
      { cutId: 'CUT_B', regionId: 'STRIP', executedDivisions: 0 },
    );
  });

  it('consumo doble de una región', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.divisions.push({
      cutId: 'CUT_E',
      parentRegionId: 'STRIP',
      axis: 'x',
      keptExtentMm: 100,
      kerfMm: 4,
      keptRegionId: 'EXTRA_1',
      restRegionId: 'EXTRA_2',
    });
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.parent_already_consumed',
      { cutId: 'CUT_E', regionId: 'STRIP' },
    );
  });

  it('regionId duplicado', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.regions.push(structuredClone(program.regions[1]!));
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.region_duplicate_id',
      { regionId: 'STRIP' },
    );
  });

  it('cutId duplicado', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.divisions.push({ ...structuredClone(program.divisions[1]!), cutId: 'CUT_B' });
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.cut_duplicate_id',
      { cutId: 'CUT_B' },
    );
  });

  it('referencia huérfana en resultado de corte', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.divisions[1]!.keptRegionId = 'GHOST';
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.reference_missing',
      { cutId: 'CUT_B', regionId: 'GHOST' },
    );
  });

  it('región declarada que ningún corte produce', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.regions.push({ regionId: 'LONE', rect: { xMm: 0, yMm: 0, lengthMm: 10, widthMm: 10 } });
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.orphan_region',
      { regionId: 'LONE' },
    );
  });

  it('región producida por dos cortes (ciclo desconectado)', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.divisions[3]!.keptRegionId = 'PART_A';
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.region_produced_twice',
      { cutId: 'CUT_D', regionId: 'PART_A', previousCutId: 'CUT_B' },
    );
  });

  it('medida fuera de límites dentro de un programa', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.divisions[0]!.keptExtentMm = 704;
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.cut_at_border_unsupported',
      { cutId: 'CUT_A', keptExtentMm: 704, kerfMm: 4, parentExtent: 700 },
    );
  });

  it('kerf inválido dentro de un programa (NaN e Infinity)', () => {
    const nanProgram = cloneProgram(threePhaseExerciseProgram);
    nanProgram.divisions[0]!.kerfMm = Number.NaN;
    expectCutProgramError(
      () => executeCutProgram(nanProgram),
      'cut_program.kerf_invalid',
      { cutId: 'CUT_A' },
    );

    const infProgram = cloneProgram(threePhaseExerciseProgram);
    infProgram.divisions[1]!.kerfMm = Number.POSITIVE_INFINITY;
    expectCutProgramError(
      () => executeCutProgram(infProgram),
      'cut_program.kerf_invalid',
      { cutId: 'CUT_B' },
    );
  });

  it('medida NaN dentro de un programa', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.divisions[1]!.keptExtentMm = Number.NaN;
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.measure_invalid',
      { cutId: 'CUT_B' },
    );
  });

  it('tablero con dimensiones NaN o Infinity', () => {
    const nanProgram = cloneProgram(threePhaseExerciseProgram);
    nanProgram.regions[0]!.rect = { xMm: 0, yMm: 0, lengthMm: Number.NaN, widthMm: 700 };
    expectCutProgramError(() => executeCutProgram(nanProgram), 'cut_program.region_invalid', {
      regionId: 'BOARD',
    });

    const infProgram = cloneProgram(threePhaseExerciseProgram);
    infProgram.regions[0]!.rect = { xMm: 0, yMm: 0, lengthMm: 1200, widthMm: Number.POSITIVE_INFINITY };
    expectCutProgramError(() => executeCutProgram(infProgram), 'cut_program.region_invalid', {
      regionId: 'BOARD',
    });
  });

  it('geometría hija alterada no coincide con la recalculada desde padre, eje, medida y kerf', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.regions[3]!.rect = { xMm: 0, yMm: 0, lengthMm: 451, widthMm: 320 };
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.geometry_mismatch',
      {
        cutId: 'CUT_B',
        regionId: 'PART_A',
        declared: { xMm: 0, yMm: 0, lengthMm: 451, widthMm: 320 },
        expected: { xMm: 0, yMm: 0, lengthMm: 450, widthMm: 320 },
      },
    );
  });

  it('geometría hija desplazada invade la banda de kerf (solape) y se rechaza', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.regions[4]!.rect = { xMm: 452, yMm: 0, lengthMm: 748, widthMm: 320 };
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.geometry_mismatch',
      { cutId: 'CUT_B', regionId: 'STRIP_REST' },
    );
  });

  it('región terminal consumida por un corte', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.terminals.push({ regionId: 'STRIP', kind: 'remnant' });
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.terminal_consumed',
      { cutId: 'CUT_B', regionId: 'STRIP' },
    );
  });

  it('programa incompleto presentado como terminado: hoja sin declaración terminal', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.terminals = program.terminals.filter((t) => t.regionId !== 'REM_B');
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.incomplete_program',
      { regionId: 'REM_B' },
    );
  });

  it('terminal duplicada sobre la misma región', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.terminals.push({ regionId: 'REM_B', kind: 'waste' });
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.terminal_duplicate',
      { regionId: 'REM_B' },
    );
  });

  it('esquema no soportado', () => {
    const program = cloneProgram(threePhaseExerciseProgram);
    program.schemaVersion = 'granete.cut-program.v0';
    expectCutProgramError(() => executeCutProgram(program), 'cut_program.schema_unsupported');
  });
});

describe('executeCutProgram — regresión R1: particiones decimales válidas', () => {
  it('acepta el programa decimal 2440×1830 con kept 100.1 y kerf 3.2 rechazado por contención estricta', () => {
    const program: CutProgramInput = {
      schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
      boardRegionId: 'BOARD',
      regions: [
        { regionId: 'BOARD', rect: { xMm: 0, yMm: 0, lengthMm: 2440, widthMm: 1830 } },
        { regionId: 'KEPT', rect: { xMm: 0, yMm: 0, lengthMm: 100.1, widthMm: 1830 } },
        { regionId: 'REST', rect: { xMm: 103.3, yMm: 0, lengthMm: 2336.7, widthMm: 1830 } },
      ],
      divisions: [
        {
          cutId: 'CUT1',
          parentRegionId: 'BOARD',
          axis: 'x',
          keptExtentMm: 100.1,
          kerfMm: 3.2,
          keptRegionId: 'KEPT',
          restRegionId: 'REST',
        },
      ],
      terminals: [
        { regionId: 'KEPT', kind: 'piece', pieceRef: 'PIECE1' },
        { regionId: 'REST', kind: 'remnant' },
      ],
    };
    const trace = executeCutProgram(program);
    expect(trace.divisions[0]!.kerfBandRect.xMm).toBeCloseTo(100.1, 9);
    expect(trace.regionRects.get('REST')!.xMm).toBeCloseTo(103.3, 9);
    expect(trace.leafAreaMm2 + trace.kerfAreaMm2).toBeCloseTo(4465200, 6);
    expect(() =>
      checkExpectedPieces(trace, [{ pieceRef: 'PIECE1', lengthMm: 100.1, widthMm: 1830 }]),
    ).not.toThrow();
  });

  it('acepta el caso equivalente sobre el eje Y (1000 de ancho, kept 100.3, kerf 4.4)', () => {
    const program: CutProgramInput = {
      schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
      boardRegionId: 'BOARD',
      regions: [
        { regionId: 'BOARD', rect: { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 1000 } },
        { regionId: 'KEPT', rect: { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 100.3 } },
        { regionId: 'REST', rect: { xMm: 0, yMm: 104.7, lengthMm: 600, widthMm: 895.3 } },
      ],
      divisions: [
        {
          cutId: 'CUT1',
          parentRegionId: 'BOARD',
          axis: 'y',
          keptExtentMm: 100.3,
          kerfMm: 4.4,
          keptRegionId: 'KEPT',
          restRegionId: 'REST',
        },
      ],
      terminals: [
        { regionId: 'KEPT', kind: 'piece', pieceRef: 'PIECE1' },
        { regionId: 'REST', kind: 'remnant' },
      ],
    };
    const trace = executeCutProgram(program);
    expect(trace.divisions[0]!.kerfBandRect.yMm).toBeCloseTo(100.3, 9);
    expect(trace.regionRects.get('REST')!.yMm).toBeCloseTo(104.7, 9);
    expect(trace.leafAreaMm2 + trace.kerfAreaMm2).toBeCloseTo(600000, 6);
  });

  it('acepta una partición decimal con región inicial desplazada', () => {
    const program: CutProgramInput = {
      schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
      boardRegionId: 'BOARD',
      regions: [
        { regionId: 'BOARD', rect: { xMm: 100, yMm: 50, lengthMm: 2440, widthMm: 1830 } },
        { regionId: 'KEPT', rect: { xMm: 100, yMm: 50, lengthMm: 100.1, widthMm: 1830 } },
        { regionId: 'REST', rect: { xMm: 203.3, yMm: 50, lengthMm: 2336.7, widthMm: 1830 } },
      ],
      divisions: [
        {
          cutId: 'CUT1',
          parentRegionId: 'BOARD',
          axis: 'x',
          keptExtentMm: 100.1,
          kerfMm: 3.2,
          keptRegionId: 'KEPT',
          restRegionId: 'REST',
        },
      ],
      terminals: [
        { regionId: 'KEPT', kind: 'piece', pieceRef: 'PIECE1' },
        { regionId: 'REST', kind: 'remnant' },
      ],
    };
    const trace = executeCutProgram(program);
    expect(trace.boardRect.xMm).toBe(100);
    expect(trace.regionRects.get('REST')!.xMm).toBeCloseTo(203.3, 9);
    expect(trace.leafAreaMm2 + trace.kerfAreaMm2).toBeCloseTo(4465200, 6);
  });

  it('permite dividir una región creada por un corte decimal y conserva una sola geometría ejecutada', () => {
    const program: CutProgramInput = {
      schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
      boardRegionId: 'BOARD',
      regions: [
        { regionId: 'BOARD', rect: { xMm: 0, yMm: 0, lengthMm: 2440, widthMm: 1830 } },
        { regionId: 'KEPT1', rect: { xMm: 0, yMm: 0, lengthMm: 100.1, widthMm: 1830 } },
        { regionId: 'REST1', rect: { xMm: 103.3, yMm: 0, lengthMm: 2336.7, widthMm: 1830 } },
        { regionId: 'KEPT2', rect: { xMm: 103.3, yMm: 0, lengthMm: 500, widthMm: 1830 } },
        { regionId: 'REST2', rect: { xMm: 606.5, yMm: 0, lengthMm: 1833.5, widthMm: 1830 } },
      ],
      divisions: [
        {
          cutId: 'CUT1',
          parentRegionId: 'BOARD',
          axis: 'x',
          keptExtentMm: 100.1,
          kerfMm: 3.2,
          keptRegionId: 'KEPT1',
          restRegionId: 'REST1',
        },
        {
          cutId: 'CUT2',
          parentRegionId: 'REST1',
          axis: 'x',
          keptExtentMm: 500,
          kerfMm: 3.2,
          keptRegionId: 'KEPT2',
          restRegionId: 'REST2',
        },
      ],
      terminals: [
        { regionId: 'KEPT1', kind: 'piece', pieceRef: 'P1' },
        { regionId: 'KEPT2', kind: 'piece', pieceRef: 'P2' },
        { regionId: 'REST2', kind: 'remnant' },
      ],
    };
    const trace = executeCutProgram(program);
    expect(trace.divisions).toHaveLength(2);
    expect(trace.divisions[1]!.parentRegionId).toBe('REST1');
    expect(trace.divisions[1]!.parentRect).toEqual(trace.divisions[0]!.restRect);
    expect(trace.divisions[1]!.parentRect.xMm).toBeCloseTo(103.3, 9);
    expect(trace.divisions[1]!.keptRect.xMm).toBeCloseTo(103.3, 9);
    expect(trace.divisions[1]!.keptRect.lengthMm).toBe(500);
    expect(trace.regionRects.get('KEPT2')!.lengthMm).toBe(500);
    expect(trace.regionRects.get('REST2')!.xMm).toBeCloseTo(606.5, 9);
    expect(trace.leafAreaMm2 + trace.kerfAreaMm2).toBeCloseTo(4465200, 6);
    expect(() =>
      checkExpectedPieces(trace, [
        { pieceRef: 'P1', lengthMm: 100.1, widthMm: 1830 },
        { pieceRef: 'P2', lengthMm: 500, widthMm: 1830 },
      ]),
    ).not.toThrow();
  });

  it('una desviación geométrica real (1 mm) sigue siendo rechazada pese a la tolerancia aritmética', () => {
    const program: CutProgramInput = {
      schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
      boardRegionId: 'BOARD',
      regions: [
        { regionId: 'BOARD', rect: { xMm: 0, yMm: 0, lengthMm: 2440, widthMm: 1830 } },
        { regionId: 'KEPT', rect: { xMm: 0, yMm: 0, lengthMm: 101.1, widthMm: 1830 } },
        { regionId: 'REST', rect: { xMm: 103.3, yMm: 0, lengthMm: 2336.7, widthMm: 1830 } },
      ],
      divisions: [
        {
          cutId: 'CUT1',
          parentRegionId: 'BOARD',
          axis: 'x',
          keptExtentMm: 100.1,
          kerfMm: 3.2,
          keptRegionId: 'KEPT',
          restRegionId: 'REST',
        },
      ],
      terminals: [
        { regionId: 'KEPT', kind: 'piece', pieceRef: 'PIECE1' },
        { regionId: 'REST', kind: 'remnant' },
      ],
    };
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.geometry_mismatch',
      { cutId: 'CUT1', regionId: 'KEPT' },
    );
  });
});

describe('executeCutProgram — regresión R2: aislamiento entre input y traza ejecutada', () => {
  function buildIsolationProgram(): MutableCutProgram {
    return {
      schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
      boardRegionId: 'BOARD',
      regions: [
        { regionId: 'BOARD', rect: { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 } },
        { regionId: 'KEPT', rect: { xMm: 0, yMm: 0, lengthMm: 300, widthMm: 600 } },
        { regionId: 'REST', rect: { xMm: 304, yMm: 0, lengthMm: 696, widthMm: 600 } },
      ],
      divisions: [
        {
          cutId: 'CUT1',
          parentRegionId: 'BOARD',
          axis: 'x',
          keptExtentMm: 300,
          kerfMm: 4,
          keptRegionId: 'KEPT',
          restRegionId: 'REST',
        },
      ],
      terminals: [
        { regionId: 'KEPT', kind: 'piece', pieceRef: 'PIEZA1' },
        { regionId: 'REST', kind: 'remnant' },
      ],
    };
  }

  it('modificar el input después de ejecutar no altera la traza devuelta', () => {
    const program = buildIsolationProgram();
    const trace = executeCutProgram(program);
    const leafAreaBefore = trace.leafAreaMm2;
    const kerfAreaBefore = trace.kerfAreaMm2;

    program.regions[1]!.rect.lengthMm = 999;

    const keptTerminal = trace.terminals.find((t) => t.regionId === 'KEPT')!;
    expect(keptTerminal.rect.lengthMm).toBe(300);
    expect(trace.divisions[0]!.keptRect.lengthMm).toBe(300);
    expect(trace.regionRects.get('KEPT')!.lengthMm).toBe(300);
    expect(trace.leafAreaMm2).toBe(leafAreaBefore);
    expect(trace.kerfAreaMm2).toBe(kerfAreaBefore);
    expect(trace.leafAreaMm2 + trace.kerfAreaMm2).toBe(600000);
  });

  it('el resultado no comparte rectángulos mutables con la entrada', () => {
    const program = buildIsolationProgram();
    const trace = executeCutProgram(program);
    expect(trace.boardRect).not.toBe(program.regions[0]!.rect);
    for (const region of program.regions) {
      expect(trace.regionRects.get(region.regionId)).not.toBe(region.rect);
    }
    for (const terminal of trace.terminals) {
      const declared = program.regions.find((r) => r.regionId === terminal.regionId)!;
      expect(terminal.rect).not.toBe(declared.rect);
    }
  });

  it('las geometrías de una misma región coinciden en divisiones, terminales, mapa y padres posteriores', () => {
    const program = buildIsolationProgram();
    program.regions.push({ regionId: 'KEPT_B', rect: { xMm: 304, yMm: 0, lengthMm: 200, widthMm: 600 } });
    program.regions.push({ regionId: 'REST_B', rect: { xMm: 508, yMm: 0, lengthMm: 492, widthMm: 600 } });
    program.divisions.push({
      cutId: 'CUT2',
      parentRegionId: 'REST',
      axis: 'x',
      keptExtentMm: 200,
      kerfMm: 4,
      keptRegionId: 'KEPT_B',
      restRegionId: 'REST_B',
    });
    program.terminals[1] = { regionId: 'KEPT_B', kind: 'piece', pieceRef: 'PIEZA2' };
    program.terminals.push({ regionId: 'REST_B', kind: 'remnant' });

    const trace = executeCutProgram(program);
    const executedRest = trace.divisions[0]!.restRect;
    expect(trace.divisions[1]!.parentRect).toEqual(executedRest);
    expect(trace.regionRects.get('REST')).toEqual(executedRest);
    const restTerminal = trace.terminals.find((t) => t.regionId === 'KEPT_B')!;
    expect(restTerminal.rect).toEqual(trace.divisions[1]!.keptRect);
    expect(trace.leafAreaMm2 + trace.kerfAreaMm2).toBe(600000);
  });

  it('una diferencia declarada admisible como ruido aritmético no se propaga como segunda geometría', () => {
    const program = buildIsolationProgram();
    program.regions[1]!.rect.lengthMm = 300.0000001;

    const trace = executeCutProgram(program);
    expect(trace.divisions[0]!.keptRect.lengthMm).toBe(300);
    expect(trace.regionRects.get('KEPT')!.lengthMm).toBe(300);
    const keptTerminal = trace.terminals.find((t) => t.regionId === 'KEPT')!;
    expect(keptTerminal.rect.lengthMm).toBe(300);
    expect(trace.boardAreaMm2).toBe(600000);
    expect(trace.kerfAreaMm2).toBe(2400);
    expect(trace.leafAreaMm2).toBe(597600);
    expect(() =>
      checkExpectedPieces(trace, [{ pieceRef: 'PIEZA1', lengthMm: 300, widthMm: 600 }]),
    ).not.toThrow();
  });

  it('una diferencia geométrica real en la declaración sigue siendo rechazada', () => {
    const program = buildIsolationProgram();
    program.regions[1]!.rect.lengthMm = 301;
    expectCutProgramError(
      () => executeCutProgram(program),
      'cut_program.geometry_mismatch',
      { cutId: 'CUT1', regionId: 'KEPT' },
    );
  });
});

describe('checkExpectedPieces — rechazos', () => {
  it('pieza esperada omitida por el programa', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    expectCutProgramError(
      () =>
        checkExpectedPieces(trace, [
          ...threePhaseExerciseExpectedPieces,
          { pieceRef: 'PIEZA-C', lengthMm: 100, widthMm: 50 },
        ]),
      'cut_program.piece_missing',
      { pieceRef: 'PIEZA-C' },
    );
  });

  it('pieza producida con dimensiones incorrectas: la suma de superficies no la salva', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    expectCutProgramError(
      () =>
        checkExpectedPieces(trace, [
          { pieceRef: 'PIEZA-A', lengthMm: 320, widthMm: 450 },
          { pieceRef: 'PIEZA-B', lengthMm: 280, widthMm: 210 },
        ]),
      'cut_program.piece_dimension_mismatch',
      {
        pieceRef: 'PIEZA-A',
        expected: { lengthMm: 320, widthMm: 450 },
        received: { lengthMm: 450, widthMm: 320 },
      },
    );
  });

  it('pieza esperada duplicada en el fixture', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    expectCutProgramError(
      () =>
        checkExpectedPieces(trace, [
          ...threePhaseExerciseExpectedPieces,
          { pieceRef: 'PIEZA-A', lengthMm: 450, widthMm: 320 },
        ]),
      'cut_program.piece_expected_duplicate',
      { pieceRef: 'PIEZA-A' },
    );
  });

  it('hoja de pieza inesperada que ningún fixture justifica', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    const withExtraPiece = {
      ...trace,
      terminals: [
        ...trace.terminals,
        { regionId: 'REM_B', rect: trace.regionRects.get('REM_B')!, kind: 'piece' as const, pieceRef: 'PIEZA-X' },
      ],
    };
    expectCutProgramError(
      () => checkExpectedPieces(withExtraPiece, threePhaseExerciseExpectedPieces),
      'cut_program.piece_unexpected',
      { pieceRef: 'PIEZA-X', regionId: 'REM_B' },
    );
  });

  it('pieza esperada con dimensiones inválidas', () => {
    const trace = executeCutProgram(threePhaseExerciseProgram);
    expectCutProgramError(
      () => checkExpectedPieces(trace, [{ pieceRef: 'PIEZA-A', lengthMm: 0, widthMm: 320 }]),
      'cut_program.piece_expected_invalid',
      { pieceRef: 'PIEZA-A' },
    );
  });
});
