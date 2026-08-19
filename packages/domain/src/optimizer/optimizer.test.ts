import { describe, it, expect } from 'vitest';
import type { MaterialBoard, ProductionCutRow } from '../types';
import { optimizeCutPlan } from './guillotine';
import { DEFAULT_CUT_PLAN_CONFIG, type CutPlanConfig } from './types';

describe('2D Guillotine Cut Plan Optimizer', () => {
  const catalogMaterials: MaterialBoard[] = [
    {
      id: 'mat-mdf-18',
      code: 'MDF18',
      name: 'MDF Blanco 18mm',
      costPerM2: 25,
      wastePercent: 10,
      lengthMm: 2440,
      widthMm: 1830,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 111.63,
      active: true,
    },
    {
      id: 'mat-mdf-15',
      code: 'MDF15',
      name: 'MDF Roble 15mm',
      costPerM2: 28,
      wastePercent: 12,
      lengthMm: 2440,
      widthMm: 1220,
      thicknessMm: 15,
      grainDefault: true,
      boardPrice: 83.35,
      active: true,
    },
  ];

  const sampleCutRows: ProductionCutRow[] = [
    {
      quantity: 2,
      lengthMm: 800,
      widthMm: 500,
      description: 'Lateral Izq · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 1, // Veta estricta
      L1: 1,
      L2: 1,
      W1: 0,
      W2: 0,
      partCode: 'LAT-IZQ',
      partName: 'Lateral Izquierdo',
      moduleCode: 'M01',
      thicknessMm: 18,
    },
    {
      quantity: 2,
      lengthMm: 800,
      widthMm: 500,
      description: 'Lateral Der · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 1,
      L1: 1,
      L2: 1,
      W1: 0,
      W2: 0,
      partCode: 'LAT-DER',
      partName: 'Lateral Derecho',
      moduleCode: 'M01',
      thicknessMm: 18,
    },
    {
      quantity: 4,
      lengthMm: 600,
      widthMm: 400,
      description: 'Estante · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 0, // Sin veta (puede rotar)
      L1: 1,
      L2: 0,
      W1: 0,
      W2: 0,
      partCode: 'EST-01',
      partName: 'Estante Regulable',
      moduleCode: 'M01',
      thicknessMm: 18,
    },
  ];

  it('optimizes a cut plan and calculates exact board sheets for warehouse', () => {
    const plan = optimizeCutPlan('proj-123', sampleCutRows, catalogMaterials, DEFAULT_CUT_PLAN_CONFIG);

    expect(plan.projectId).toBe('proj-123');
    expect(plan.sheets.length).toBeGreaterThan(0);
    expect(plan.stats.totalSheets).toBe(plan.sheets.length);
    expect(plan.stats.totalPieces).toBe(8); // 2 + 2 + 4
    expect(plan.stats.byMaterial.length).toBe(1);
    expect(plan.stats.byMaterial[0]?.materialCode).toBe('MDF18');
    expect(plan.stats.byMaterial[0]?.sheetsNeeded).toBe(plan.sheets.length);
    expect(plan.stats.globalYieldPercent).toBeGreaterThan(0);
    expect(plan.stats.globalYieldPercent).toBeLessThanOrEqual(100);
  });

  it('places pieces without overlapping and within board usable bounds', () => {
    const customConfig: CutPlanConfig = {
      ...DEFAULT_CUT_PLAN_CONFIG,
      sawKerfMm: 4,
      trim: { topMm: 15, bottomMm: 15, leftMm: 10, rightMm: 10 },
    };

    const plan = optimizeCutPlan('proj-123', sampleCutRows, catalogMaterials, customConfig);

    for (const sheet of plan.sheets) {
      const minX = customConfig.trim.leftMm;
      const minY = customConfig.trim.bottomMm;
      const maxX = sheet.sheetLengthMm - customConfig.trim.rightMm;
      const maxY = sheet.sheetWidthMm - customConfig.trim.topMm;

      for (let i = 0; i < sheet.pieces.length; i++) {
        const p1 = sheet.pieces[i]!;

        // Check boundaries
        expect(p1.xMm).toBeGreaterThanOrEqual(minX);
        expect(p1.yMm).toBeGreaterThanOrEqual(minY);
        expect(p1.xMm + p1.lengthMm).toBeLessThanOrEqual(maxX);
        expect(p1.yMm + p1.widthMm).toBeLessThanOrEqual(maxY);

        // Check non-overlapping with kerf
        for (let j = i + 1; j < sheet.pieces.length; j++) {
          const p2 = sheet.pieces[j]!;
          const overlapX =
            p1.xMm < p2.xMm + p2.lengthMm && p1.xMm + p1.lengthMm > p2.xMm;
          const overlapY =
            p1.yMm < p2.yMm + p2.widthMm && p1.yMm + p1.widthMm > p2.yMm;
          const overlap = overlapX && overlapY;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('strictly respects grain direction (grain: 1 is never rotated)', () => {
    const plan = optimizeCutPlan('proj-123', sampleCutRows, catalogMaterials, DEFAULT_CUT_PLAN_CONFIG);

    for (const sheet of plan.sheets) {
      for (const piece of sheet.pieces) {
        if (piece.grain === 1) {
          expect(piece.rotated).toBe(false);
          expect(piece.lengthMm).toBe(piece.originalLengthMm);
          expect(piece.widthMm).toBe(piece.originalWidthMm);
        }
      }
    }
  });

  it('respects configurable 4-sided trim margins', () => {
    const asymmetricTrim: CutPlanConfig = {
      ...DEFAULT_CUT_PLAN_CONFIG,
      trim: {
        topMm: 25,
        bottomMm: 30,
        leftMm: 40,
        rightMm: 50,
      },
    };

    const plan = optimizeCutPlan('proj-123', sampleCutRows, catalogMaterials, asymmetricTrim);

    for (const sheet of plan.sheets) {
      for (const piece of sheet.pieces) {
        expect(piece.xMm).toBeGreaterThanOrEqual(40);
        expect(piece.yMm).toBeGreaterThanOrEqual(30);
        expect(piece.xMm + piece.lengthMm).toBeLessThanOrEqual(sheet.sheetLengthMm - 50);
        expect(piece.yMm + piece.widthMm).toBeLessThanOrEqual(sheet.sheetWidthMm - 25);
      }
    }
  });

  it('groups multiple materials into separate sheet plans', () => {
    const multiMaterialRows: ProductionCutRow[] = [
      ...sampleCutRows,
      {
        quantity: 3,
        lengthMm: 1000,
        widthMm: 450,
        description: 'Tapa Roble · M02',
        materialName: 'MDF Roble 15mm',
        materialCode: 'MDF15',
        grain: 1,
        L1: 1,
        L2: 1,
        W1: 1,
        W2: 1,
        partCode: 'TAP-01',
        partName: 'Tapa Superior',
        moduleCode: 'M02',
        thicknessMm: 15,
      },
    ];

    const plan = optimizeCutPlan('proj-multi', multiMaterialRows, catalogMaterials, DEFAULT_CUT_PLAN_CONFIG);

    expect(plan.stats.byMaterial.length).toBe(2);
    const mdf18Stat = plan.stats.byMaterial.find((m) => m.materialCode === 'MDF18');
    const mdf15Stat = plan.stats.byMaterial.find((m) => m.materialCode === 'MDF15');

    expect(mdf18Stat).toBeDefined();
    expect(mdf15Stat).toBeDefined();
    expect(mdf18Stat?.piecesCount).toBe(8);
    expect(mdf15Stat?.piecesCount).toBe(3);

    const mdf15Sheets = plan.sheets.filter((s) => s.materialCode === 'MDF15');
    expect(mdf15Sheets.length).toBe(mdf15Stat?.sheetsNeeded);
    expect(mdf15Sheets[0]?.sheetWidthMm).toBe(1220); // Uses the 1220 width from catalog
  });

  it('generates cutting instructions and detects useful remnants', () => {
    const plan = optimizeCutPlan('proj-123', sampleCutRows, catalogMaterials, DEFAULT_CUT_PLAN_CONFIG);

    expect(plan.sheets[0]?.instructions.length).toBeGreaterThan(0);
    const firstInstr = plan.sheets[0]?.instructions[0];
    expect(firstInstr?.phase).toBe(1); // Trim cut

    // Check remnants
    const sheetRemnants = plan.sheets[0]?.remnants ?? [];
    expect(sheetRemnants.length).toBeGreaterThanOrEqual(0);
    for (const rem of sheetRemnants) {
      if (rem.lengthMm >= 300 && rem.widthMm >= 300) {
        expect(rem.isUseful).toBe(true);
      }
    }
  });

  it('respects deductEdgeBand toggle (sobrecorte negativo vs pre-fresado medida final)', () => {
    const rowWithEdges: ProductionCutRow[] = [
      {
        quantity: 1,
        lengthMm: 720,
        widthMm: 400,
        description: 'Puerta con cantos 2mm',
        materialName: 'MDF Blanco 18mm',
        materialCode: 'MDF18',
        grain: 1,
        L1: 1,
        L2: 1,
        W1: 1,
        W2: 1,
        edgeBandThicknessMm: 2,
      },
    ];

    // Case 1: deductEdgeBand = true (enchapado manual: descuenta 2mm por lado -> 716x396)
    const planDeduct = optimizeCutPlan(
      'proj-1',
      rowWithEdges,
      catalogMaterials,
      { ...DEFAULT_CUT_PLAN_CONFIG, deductEdgeBand: true },
    );
    const pieceDeduct = planDeduct.sheets[0]?.pieces[0];
    expect(pieceDeduct?.originalLengthMm).toBe(720);
    expect(pieceDeduct?.originalWidthMm).toBe(400);
    expect(pieceDeduct?.lengthMm).toBe(716); // 720 - 2 - 2
    expect(pieceDeduct?.widthMm).toBe(396);  // 400 - 2 - 2

    // Case 2: deductEdgeBand = false (máquina con pre-fresado: corte a medida final 720x400)
    const planFinal = optimizeCutPlan(
      'proj-2',
      rowWithEdges,
      catalogMaterials,
      { ...DEFAULT_CUT_PLAN_CONFIG, deductEdgeBand: false },
    );
    const pieceFinal = planFinal.sheets[0]?.pieces[0];
    expect(pieceFinal?.originalLengthMm).toBe(720);
    expect(pieceFinal?.originalWidthMm).toBe(400);
    expect(pieceFinal?.lengthMm).toBe(720); // Medida final sin descuento
    expect(pieceFinal?.widthMm).toBe(400);  // Medida final sin descuento
  });
});
