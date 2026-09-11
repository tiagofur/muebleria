import { describe, expect, it } from 'vitest';
import {
  verticalCounterexampleExpectedPieces,
  verticalCounterexampleProgram,
} from '../__fixtures__/cutProgramScenarios';
import {
  generateCuttingInstructionsFromProgram,
  projectCutProgram,
  projectSheetCutProgram,
} from './cutProgramProjection';
import { executeCutProgram, type CutProgramInput } from './cutProgram';
import { CutProgramSheetBuilder, registerTrimDivisions } from './cutProgramBuilder';
import { optimizeCutPlan, packSingleSheetStrip } from './guillotine';
import { unrollRows } from './pieces';
import {
  DEFAULT_CUT_PLAN_CONFIG,
  type CutPlanPlacedPiece,
  type CutPlanSheet,
} from './types';
import type { MaterialBoard, ProductionCutRow } from '../types';

describe('cutProgramProjection (dominio)', () => {
  it('primer corte sobre X y recorte limitado al bloque correspondiente (counterexample)', () => {
    const trace = executeCutProgram(verticalCounterexampleProgram);
    const mockPieces: CutPlanPlacedPiece[] = [
      {
        id: 'PIEZA-A',
        partCode: 'PIEZA-A',
        partName: 'Lateral A',
        moduleCode: 'M1',
        labelRef: 'A1',
        materialName: 'MDF 18',
        xMm: 0,
        yMm: 0,
        lengthMm: 400,
        widthMm: 600,
        originalLengthMm: 400,
        originalWidthMm: 600,
        grain: 0,
        rotated: false,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
        sheetIndex: 0,
        stripIndex: 0,
        cutSequenceNumber: 1,
      },
      {
        id: 'PIEZA-B',
        partCode: 'PIEZA-B',
        partName: 'Piso B',
        moduleCode: 'M1',
        labelRef: 'A2',
        materialName: 'MDF 18',
        xMm: 404,
        yMm: 0,
        lengthMm: 596,
        widthMm: 196,
        originalLengthMm: 596,
        originalWidthMm: 196,
        grain: 0,
        rotated: false,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
        sheetIndex: 0,
        stripIndex: 1,
        cutSequenceNumber: 2,
      },
    ];

    const projection = projectCutProgram(trace, mockPieces);

    expect(projection.status).toBe('valid');
    expect(projection.primaryCut).not.toBeNull();
    // First cut is strictly along X at 400 mm
    expect(projection.primaryCut?.axis).toBe('x');
    expect(projection.primaryCut?.coordinateMm).toBe(400);
    expect(projection.primaryCut?.label).toContain('1er corte: X = 400 mm');
    // First cut spans the full board height (0 to 600)
    expect(projection.primaryCut?.line).toEqual({ x1: 400, y1: 0, x2: 400, y2: 600 });

    // Second cut (CUT_2) is along Y, limited to RIGHT region (x: 404..1000), NEVER spanning 0..400
    const cut2 = projection.cuts[1]!;
    expect(cut2.cutId).toBe('CUT_2');
    expect(cut2.axis).toBe('y');
    expect(cut2.parentRect).toEqual({ xMm: 404, yMm: 0, lengthMm: 596, widthMm: 600 });
    expect(cut2.cutLine).toEqual({ x1: 404, y1: 196, x2: 1000, y2: 196 });

    // Step 2 produces piece PIEZA-B
    const step2 = projection.steps[1]!;
    expect(step2.producedPiece?.id).toBe('PIEZA-B');
    expect(step2.relativeMeasureMm).toBe(196);
    expect(step2.instruction.positionMm).toBe(196);
    expect(step2.instruction.phase).toBe(3);
    expect(step2.instruction.cutType).toBe('cross');
  });

  it('primer corte sobre Y y separación longitudinal en franja', () => {
    // Construct program with first cut on Y (horizontal rip)
    const builder = new CutProgramSheetBuilder({
      boardRegionId: 'board',
      x: 0,
      y: 0,
      length: 2440,
      width: 1830,
    });
    // First cut along Y at keptExtent = 400
    const strip1 = builder.divide({
      parentRegionId: 'board',
      axis: 'y',
      keptExtentMm: 400,
      kerfMm: 4,
      cutId: 'rip-1',
    });
    builder.markTerminal(strip1.kept.regionId, 'waste');
    if (strip1.rest) {
      builder.markTerminal(strip1.rest.regionId, 'waste');
    }
    const program = builder.build();
    const trace = executeCutProgram(program);
    const projection = projectCutProgram(trace);

    expect(projection.primaryCut?.axis).toBe('y');
    expect(projection.primaryCut?.coordinateMm).toBe(400);
    expect(projection.primaryCut?.label).toContain('1er corte: Y = 400 mm');
    expect(projection.primaryCut?.line).toEqual({ x1: 0, y1: 400, x2: 2440, y2: 400 });
  });

  it('refilados con margen total y disco separados, y leadingBand sobre lados cercanos', () => {
    const builder = new CutProgramSheetBuilder({
      boardRegionId: 'board',
      x: 0,
      y: 0,
      length: 2440,
      width: 1830,
    });
    // Trim margins: left: 10, right: 10, bottom: 10, top: 10 with kerf 4
    const usable = registerTrimDivisions(
      builder,
      { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      4,
    );
    builder.markTerminal(usable.regionId, 'waste');
    const program = builder.build();
    const trace = executeCutProgram(program);
    const projection = projectCutProgram(trace);

    expect(projection.cuts.length).toBe(4);

    // trim:left is on X with leadingBand = true
    const trimLeft = projection.cuts[0]!;
    expect(trimLeft.cutId).toBe('trim:left');
    expect(trimLeft.axis).toBe('x');
    expect(trimLeft.leadingBand).toBe(true);
    expect(trimLeft.isTrim).toBe(true);
    // Consumed band is 4mm located at 6..10
    expect(trimLeft.kerfBandRect).toEqual({ xMm: 6, yMm: 0, lengthMm: 4, widthMm: 1830 });
    // Cut line sits at X=10
    expect(trimLeft.cutLine).toEqual({ x1: 10, y1: 0, x2: 10, y2: 1830 });

    // trim:bottom is on Y with leadingBand = true
    const trimBottom = projection.cuts[2]!;
    expect(trimBottom.cutId).toBe('trim:bottom');
    expect(trimBottom.axis).toBe('y');
    expect(trimBottom.leadingBand).toBe(true);
    expect(trimBottom.isTrim).toBe(true);
    // Consumed band is 4mm at Y=6..10
    expect(trimBottom.kerfBandRect).toEqual({ xMm: 10, yMm: 6, lengthMm: 2420, widthMm: 4 });
    expect(trimBottom.cutLine).toEqual({ x1: 10, y1: 10, x2: 2430, y2: 10 });
  });

  it('kerf_only produce pasada real sin región rest fantasma', () => {
    const builder = new CutProgramSheetBuilder({
      boardRegionId: 'board',
      x: 0,
      y: 0,
      length: 1000,
      width: 500,
    });
    // Parent length 1000, kept 996, kerf 4 -> gap = 4 == kerf -> kerf_only
    const sep = builder.divide({
      parentRegionId: 'board',
      axis: 'x',
      keptExtentMm: 996,
      kerfMm: 4,
      cutId: 'kerf-only-cut',
    });
    expect(sep.cutHappened).toBe(true);
    expect(sep.rest).toBeNull();
    builder.markTerminal(sep.kept.regionId, 'waste');
    const program = builder.build();
    const trace = executeCutProgram(program);
    const projection = projectCutProgram(trace);

    expect(projection.steps.length).toBe(1);
    const step = projection.steps[0]!;
    expect(step.cutId).toBe('kerf-only-cut');
    expect(step.restRect).toBeNull();
    expect(step.kerfBandRect).toEqual({ xMm: 996, yMm: 0, lengthMm: 4, widthMm: 500 });
  });

  it('pieza de tamaño exacto no inventa pasada ficticia', () => {
    // In verticalCounterexampleProgram, PART_D is an exact_fit leaf without pass
    const trace = executeCutProgram(verticalCounterexampleProgram);
    const projection = projectCutProgram(trace);

    // 4 pieces in terminals, but only 3 divisions in the program
    expect(trace.terminals.filter((t) => t.kind === 'piece').length).toBe(4);
    expect(projection.steps.length).toBe(3);
    expect(projection.cuts.length).toBe(3);
  });

  it('salida de disco (blade exits parent) muestra ancho nominal y consumo nuevo diferenciados', () => {
    const builder = new CutProgramSheetBuilder({
      boardRegionId: 'board',
      x: 0,
      y: 0,
      length: 1000,
      width: 500,
    });
    // Parent 1000, kept 998, kerf 4 -> gap = 2 < kerf 4 -> bladeExitsParent
    const sep = builder.divide({
      parentRegionId: 'board',
      axis: 'x',
      keptExtentMm: 998,
      kerfMm: 4,
      cutId: 'exit-cut',
    });
    builder.markTerminal(sep.kept.regionId, 'waste');
    const program = builder.build();
    const trace = executeCutProgram(program);
    const projection = projectCutProgram(trace);

    const step = projection.steps[0]!;
    expect(step.bladeExitsParent).toBe(true);
    expect(step.nominalKerfMm).toBe(4);
    expect(step.consumedKerfMm).toBe(2);
    // Consumed band inside parent is clipped to 2mm (998..1000)
    expect(step.kerfBandRect).toEqual({ xMm: 998, yMm: 0, lengthMm: 2, widthMm: 500 });
    // Nominal tool footprint is full 4mm (998..1002)
    expect(step.toolFootprintRect).toEqual({ xMm: 998, yMm: 0, lengthMm: 4, widthMm: 500 });
  });

  it('retazo útil 500 × 796 de la regresión de #654: proyección fiel desde el programa real', () => {
    // Exact inputs of the #654 R3 regression: strip packing on a 1200×1000
    // board, kerf 4, no trim; B's strip recut frees a 500×796 remnant.
    const config = {
      ...DEFAULT_CUT_PLAN_CONFIG,
      sawKerfMm: 4,
      trim: { topMm: 0, bottomMm: 0, leftMm: 0, rightMm: 0 },
      allowRotationNoGrain: false,
    };
    const rows: ProductionCutRow[] = [
      {
        description: 'A test',
        partCode: 'A',
        partName: 'A',
        moduleCode: 'M01',
        materialName: 'Tablero Test 18mm',
        materialCode: 'TEST',
        lengthMm: 600,
        widthMm: 1000,
        quantity: 1,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
        thicknessMm: 18,
      },
      {
        description: 'B test',
        partCode: 'B',
        partName: 'B',
        moduleCode: 'M01',
        materialName: 'Tablero Test 18mm',
        materialCode: 'TEST',
        lengthMm: 500,
        widthMm: 200,
        quantity: 1,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
        thicknessMm: 18,
      },
    ];

    const { sheet } = packSingleSheetStrip(
      unrollRows(rows),
      0,
      1200,
      1000,
      config,
      'TEST',
      'Tablero Test 18mm',
      18,
    );
    expect(sheet.cutProgram).toBeDefined();

    const projection = projectSheetCutProgram(sheet);
    expect(projection.status).toBe('valid');

    // The exact regression remnant is surfaced with its exact geometry.
    const useful = projection.usefulRemnants.find(
      (r) => r.lengthMm === 500 && r.widthMm === 796,
    );
    expect(useful).toBeDefined();
    expect(useful).toMatchObject({ xMm: 604, yMm: 204, isUseful: true });

    // Some step of the program directly isolates it. That same pass also
    // produces piece B (kept side), so the human instruction describes the
    // piece while the remnant travels in the structured fields (the UI step
    // summary shows it as "Retazo útil").
    const remnantStep = projection.steps.find(
      (s) =>
        s.producedRemnant &&
        Math.round(s.producedRemnant.lengthMm) === 500 &&
        Math.round(s.producedRemnant.widthMm) === 796,
    );
    expect(remnantStep).toBeDefined();
    expect(remnantStep!.instruction.partCode).toBe('B');
    expect(remnantStep!.instruction.cutType).toBe('cross');
    expect(remnantStep!.instruction.relativeMeasureMm).toBe(
      remnantStep!.instruction.positionMm,
    );
  });

  it('instrucciones describen medidas relativas a la región padre, no coordenadas globales', () => {
    const trace = executeCutProgram(verticalCounterexampleProgram);
    const instructions = generateCuttingInstructionsFromProgram(
      verticalCounterexampleProgram,
      [],
    );

    expect(instructions.length).toBe(3);
    // Step 1: on BOARD (0..1000), kept 400
    expect(instructions[0]?.positionMm).toBe(400);
    // Step 2: on RIGHT (x:404, y:0..600), kept 196
    expect(instructions[1]?.positionMm).toBe(196);
    expect(instructions[1]?.parentRect?.xMm).toBe(404);
    expect(instructions[1]?.description).toContain('196 mm');
    // Step 3: on MID (x:404, y:200..600), kept 196
    expect(instructions[2]?.positionMm).toBe(196);
    expect(instructions[2]?.parentRect?.yMm).toBe(200);
  });

  it('maneja plan sin programa (missing): reporta estado missing sin inventar cortes', () => {
    const legacySheet: CutPlanSheet = {
      sheetIndex: 0,
      materialCode: 'MDF18',
      materialName: 'MDF 18',
      sheetWidthMm: 1830,
      sheetLengthMm: 2440,
      pieces: [],
      remnants: [],
      instructions: [],
      netPiecesAreaM2: 0,
      grossSheetAreaM2: 4.47,
      usableRemnantAreaM2: 0,
      wasteAreaM2: 4.47,
      wastePercent: 100,
      yieldPercent: 0,
    };

    const projection = projectSheetCutProgram(legacySheet);
    expect(projection.status).toBe('missing');
    expect(projection.steps).toEqual([]);
    expect(projection.cuts).toEqual([]);
    expect(projection.primaryCut).toBeNull();
  });

  it('maneja programa inválido: reporta error y bloquea secuencia sin fallback heurístico', () => {
    const invalidProgram = {
      ...verticalCounterexampleProgram,
      // Corrupt a measure so executeCutProgram fails
      divisions: [
        {
          ...verticalCounterexampleProgram.divisions[0]!,
          keptExtentMm: 9999, // exceeds parent
        },
      ],
    } as CutProgramInput;

    const corruptSheet: CutPlanSheet = {
      sheetIndex: 0,
      materialCode: 'MDF18',
      materialName: 'MDF 18',
      sheetWidthMm: 1830,
      sheetLengthMm: 2440,
      pieces: [],
      remnants: [],
      instructions: [],
      netPiecesAreaM2: 0,
      grossSheetAreaM2: 4.47,
      usableRemnantAreaM2: 0,
      wasteAreaM2: 4.47,
      wastePercent: 100,
      yieldPercent: 0,
      cutProgram: invalidProgram,
    };

    const projection = projectSheetCutProgram(corruptSheet);
    expect(projection.status).toBe('invalid');
    expect(projection.errorMessage).toBeDefined();
    expect(projection.steps).toEqual([]);
    expect(projection.cuts).toEqual([]);
    expect(projection.primaryCut).toBeNull();
  });

  it('maneja CNC nesting: reporta cnc-nesting sin decoración de sierra', () => {
    const nestingSheet: CutPlanSheet = {
      sheetIndex: 0,
      strategy: 'cnc-nesting',
      materialCode: 'MDF18',
      materialName: 'MDF 18',
      sheetWidthMm: 1830,
      sheetLengthMm: 2440,
      pieces: [],
      remnants: [],
      instructions: [],
      netPiecesAreaM2: 0,
      grossSheetAreaM2: 4.47,
      usableRemnantAreaM2: 0,
      wasteAreaM2: 4.47,
      wastePercent: 100,
      yieldPercent: 0,
    };

    const projection = projectSheetCutProgram(nestingSheet);
    expect(projection.status).toBe('cnc-nesting');
    expect(projection.cuts).toEqual([]);
    expect(projection.primaryCut).toBeNull();
  });

  it('refilado se clasifica por metadato estructurado, nunca por el nombre del cutId', () => {
    // A trim-flagged division with an arbitrary cutId IS a trim.
    const flagged = new CutProgramSheetBuilder({
      boardRegionId: 'board',
      x: 0,
      y: 0,
      length: 1000,
      width: 500,
    });
    const flaggedSep = flagged.divide({
      parentRegionId: 'board',
      axis: 'x',
      leadingBand: true,
      keptExtentMm: 990,
      kerfMm: 4,
      cutId: 'completely-arbitrary-name',
      trim: true,
    });
    flagged.markTerminal(flaggedSep.kept.regionId, 'waste');
    if (flaggedSep.rest) {
      // Solid rest WITHOUT liberated declaration: only the flag can classify it.
      flagged.markTerminal(flaggedSep.rest.regionId, 'waste');
    }
    const flaggedProjection = projectCutProgram(executeCutProgram(flagged.build()));
    expect(flaggedProjection.cuts[0]!.isTrim).toBe(true);
    expect(flaggedProjection.steps[0]!.instruction.cutType).toBe('trim');
    expect(flaggedProjection.steps[0]!.instruction.phase).toBe(1);

    // A "trim:"-looking cutId WITHOUT the flag and without liberated leaves
    // is NOT a trim: names are not industrial authority.
    const named = new CutProgramSheetBuilder({
      boardRegionId: 'board',
      x: 0,
      y: 0,
      length: 1000,
      width: 500,
    });
    const namedSep = named.divide({
      parentRegionId: 'board',
      axis: 'x',
      keptExtentMm: 600,
      kerfMm: 4,
      cutId: 'trim:fake',
    });
    named.markTerminal(namedSep.kept.regionId, 'waste');
    if (namedSep.rest) {
      named.markTerminal(namedSep.rest.regionId, 'waste');
    }
    const namedProjection = projectCutProgram(executeCutProgram(named.build()));
    expect(namedProjection.cuts[0]!.isTrim).toBe(false);
    expect(namedProjection.steps[0]!.instruction.cutType).not.toBe('trim');
  });

  it('las descripciones de instrucciones son codificables en WinAnsi (export PDF/etiquetas)', () => {
    // Real plan with trims + pieces + remnant-producing separations: every
    // description must survive the WinAnsi standard fonts used by exports.
    const board: MaterialBoard = {
      id: 'b1',
      code: 'MDF18',
      name: 'MDF 18',
      lengthMm: 2440,
      widthMm: 1830,
      thicknessMm: 18,
      grainDefault: false,
      boardPrice: 100,
      wastePercent: 10,
      costPerM2: 25,
      active: true,
    };
    const rows: ProductionCutRow[] = [
      {
        description: 'Pieza 1',
        materialName: 'MDF 18',
        lengthMm: 1000,
        widthMm: 500,
        quantity: 1,
        grain: 0,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
      {
        description: 'Pieza 2',
        materialName: 'MDF 18',
        lengthMm: 600,
        widthMm: 500,
        quantity: 1,
        grain: 0,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ];
    const plan = optimizeCutPlan('proj-test', rows, [board], {
      ...DEFAULT_CUT_PLAN_CONFIG,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      sawKerfMm: 4,
    });

    for (const sheet of plan.sheets) {
      expect(sheet.cutProgram).toBeDefined();
      expect(sheet.instructions.length).toBeGreaterThan(0);
      for (const inst of sheet.instructions) {
        expect(inst.cutId).toBeDefined();
        expect(inst.positionMm).toBeGreaterThan(0);
        expect(inst.relativeMeasureMm).toBe(inst.positionMm);
        for (const ch of inst.description) {
          expect(ch.codePointAt(0)!).toBeLessThanOrEqual(0xff);
        }
      }
      const projection = projectSheetCutProgram(sheet);
      expect(projection.primaryCut?.label).toBeDefined();
      for (const ch of projection.primaryCut!.label) {
        expect(ch.codePointAt(0)!).toBeLessThanOrEqual(0xff);
      }
    }
  });

  it('varios tableros con IDs locales repetidos: proyecciones independientes y fieles por tablero', () => {
    // Two sheets of the SAME material: their programs repeat the same local
    // ids ('board' root, 'trim:*' cuts, per-sheet cut sequences). Each
    // projection stays valid and geometrically faithful to its own sheet.
    const board: MaterialBoard = {
      id: 'b1',
      code: 'MDF18',
      name: 'MDF 18',
      lengthMm: 1000,
      widthMm: 600,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 100,
      wastePercent: 10,
      costPerM2: 25,
      active: true,
    };
    const rows: ProductionCutRow[] = [
      {
        description: 'Gran pieza',
        materialName: 'MDF 18',
        lengthMm: 900,
        widthMm: 560,
        quantity: 3,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ];
    const plan = optimizeCutPlan('proj-multi', rows, [board], {
      ...DEFAULT_CUT_PLAN_CONFIG,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      sawKerfMm: 4,
    });
    expect(plan.sheets.length).toBeGreaterThanOrEqual(2);

    const projections = plan.sheets.map((sheet) => {
      expect(sheet.cutProgram).toBeDefined();
      const projection = projectSheetCutProgram(sheet);
      expect(projection.status).toBe('valid');
      return projection;
    });

    // Local ids repeat across boards ('trim:left' exists in every program).
    const cutIdSets = plan.sheets.map(
      (sheet) => new Set(sheet.cutProgram!.divisions.map((d) => d.cutId)),
    );
    for (const idSet of cutIdSets) {
      expect(idSet.has('trim:left')).toBe(true);
    }

    // Yet each projection only contains its own board's pieces and geometry.
    for (const [idx, projection] of projections.entries()) {
      const sheet = plan.sheets[idx]!;
      const pieceIds = new Set(sheet.pieces.map((p) => p.id));
      for (const step of projection.steps) {
        if (step.producedPiece) {
          expect(pieceIds.has(step.producedPiece.id)).toBe(true);
        }
      }
      expect(projection.boardRect).toEqual({
        xMm: 0,
        yMm: 0,
        lengthMm: sheet.sheetLengthMm,
        widthMm: sheet.sheetWidthMm,
      });
    }
  });
});
