import { describe, it, expect } from 'vitest';
import type { MaterialBoard, ProductionCutRow } from '../types';
import { optimizeCutPlan } from './guillotine';
import { DEFAULT_CUT_PLAN_CONFIG, type CutPlanConfig } from './types';

describe('CNC Nesting (MaxRects) strategy', () => {
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
      id: 'mat-cuadrado',
      code: 'CUAD',
      name: 'Tablero Cuadrado 18mm',
      costPerM2: 25,
      wastePercent: 10,
      lengthMm: 1020,
      widthMm: 1020,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 51.02,
      active: true,
    },
  ];

  const nestingConfig: CutPlanConfig = {
    ...DEFAULT_CUT_PLAN_CONFIG,
    cutStrategy: 'cnc-nesting',
    toolSpacingMm: 8,
  };

  const mixedRows: ProductionCutRow[] = [
    {
      quantity: 2,
      lengthMm: 2000,
      widthMm: 800,
      description: 'Lateral · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 1,
      L1: 1,
      L2: 1,
      W1: 0,
      W2: 0,
      partCode: 'LAT-01',
      partName: 'Lateral',
      moduleCode: 'M01',
      thicknessMm: 18,
    },
    {
      quantity: 3,
      lengthMm: 1200,
      widthMm: 600,
      description: 'Frente · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 1,
      L1: 1,
      L2: 0,
      W1: 0,
      W2: 0,
      partCode: 'FRE-01',
      partName: 'Frente',
      moduleCode: 'M01',
      thicknessMm: 18,
    },
    {
      quantity: 8,
      lengthMm: 400,
      widthMm: 300,
      description: 'Separador · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 0,
      L1: 0,
      L2: 0,
      W1: 0,
      W2: 0,
      partCode: 'SEP-01',
      partName: 'Separador',
      moduleCode: 'M01',
      thicknessMm: 18,
    },
    {
      quantity: 4,
      lengthMm: 200,
      widthMm: 150,
      description: 'Tapa regleta · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 0,
      L1: 0,
      L2: 0,
      W1: 0,
      W2: 0,
      partCode: 'TAP-01',
      partName: 'Tapa regleta',
      moduleCode: 'M01',
      thicknessMm: 18,
    },
  ];

  it('registra la estrategia nesting en config y tableros, sin instrucciones de corte', () => {
    const plan = optimizeCutPlan('proj-1', mixedRows, catalogMaterials, nestingConfig, 'Cocina');

    expect(plan.config.cutStrategy).toBe('cnc-nesting');
    expect(plan.config.toolSpacingMm).toBe(8);
    expect(plan.sheets.length).toBeGreaterThan(0);
    for (const sheet of plan.sheets) {
      expect(sheet.strategy).toBe('cnc-nesting');
      expect(sheet.instructions).toEqual([]);
    }
  });

  it('coloca todas las piezas sin solapes, dentro del área útil y respetando el espaciado', () => {
    const plan = optimizeCutPlan('proj-1', mixedRows, catalogMaterials, nestingConfig, 'Cocina');
    const trim = nestingConfig.trim;
    const spacing = nestingConfig.toolSpacingMm ?? 8;
    const totalPieces = plan.sheets.reduce((sum, s) => sum + s.pieces.length, 0);
    expect(totalPieces).toBe(17);

    const separationIssues: string[] = [];
    for (const sheet of plan.sheets) {
      for (const p of sheet.pieces) {
        expect(p.xMm).toBeGreaterThanOrEqual(trim.leftMm);
        expect(p.yMm).toBeGreaterThanOrEqual(trim.bottomMm);
        expect(p.xMm + p.lengthMm).toBeLessThanOrEqual(sheet.sheetLengthMm - trim.rightMm);
        expect(p.yMm + p.widthMm).toBeLessThanOrEqual(sheet.sheetWidthMm - trim.topMm);
      }

      for (let i = 0; i < sheet.pieces.length; i++) {
        for (let j = i + 1; j < sheet.pieces.length; j++) {
          const a = sheet.pieces[i]!;
          const b = sheet.pieces[j]!;
          const separatedX =
            a.xMm + a.lengthMm + spacing <= b.xMm || b.xMm + b.lengthMm + spacing <= a.xMm;
          const separatedY =
            a.yMm + a.widthMm + spacing <= b.yMm || b.yMm + b.widthMm + spacing <= a.yMm;
          if (!separatedX && !separatedY) {
            separationIssues.push(
              `${a.partCode}@${a.xMm},${a.yMm} (${a.lengthMm}x${a.widthMm}) vs ` +
                `${b.partCode}@${b.xMm},${b.yMm} (${b.lengthMm}x${b.widthMm}) en tablero ${sheet.sheetIndex}`,
            );
          }
        }
      }
    }
    expect(separationIssues).toEqual([]);
  });

  it('nunca rota piezas con veta (grain=1)', () => {
    const plan = optimizeCutPlan('proj-1', mixedRows, catalogMaterials, nestingConfig, 'Cocina');
    const vetadas = plan.sheets.flatMap((s) => s.pieces).filter((p) => p.grain === 1);
    expect(vetadas.length).toBe(5);
    for (const p of vetadas) {
      expect(p.rotated).toBe(false);
    }
  });

  it('mezcla piezas grandes y chicas usando menos tableros que sierra con kerf grueso', () => {
    const rows: ProductionCutRow[] = [
      {
        quantity: 2,
        lengthMm: 498,
        widthMm: 500,
        description: 'Puerta · M02',
        materialName: 'Tablero Cuadrado 18mm',
        materialCode: 'CUAD',
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
        partCode: 'PUE-02',
        partName: 'Puerta',
        moduleCode: 'M02',
        thicknessMm: 18,
      },
      {
        quantity: 2,
        lengthMm: 498,
        widthMm: 490,
        description: 'Cajón · M02',
        materialName: 'Tablero Cuadrado 18mm',
        materialCode: 'CUAD',
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
        partCode: 'CAJ-02',
        partName: 'Cajón',
        moduleCode: 'M02',
        thicknessMm: 18,
      },
    ];

    // Área útil 1000×1000 (tablero 1020×1020, refilado 10mm por lado).
    // Con kerf 12 la sierra no puede acomodar dos piezas de 498 lado a lado
    // (498+12+498 = 1008 > 1000) ni apilar 500+490 (1002 > 1000): terminan
    // en 3 tableros (A, A, B+B). Con espaciado de fresa 4 el nesting
    // acomoda las 4 piezas en un solo tablero (994 ≤ 1000 en ambos ejes).
    const sawConfig: CutPlanConfig = { ...DEFAULT_CUT_PLAN_CONFIG, sawKerfMm: 12 };
    const nestConfig: CutPlanConfig = {
      ...DEFAULT_CUT_PLAN_CONFIG,
      cutStrategy: 'cnc-nesting',
      toolSpacingMm: 4,
    };

    const sawPlan = optimizeCutPlan('proj-2', rows, catalogMaterials, sawConfig);
    const nestPlan = optimizeCutPlan('proj-2', rows, catalogMaterials, nestConfig);

    expect(sawPlan.stats.totalSheets).toBe(3);
    expect(nestPlan.stats.totalSheets).toBe(1);
    expect(nestPlan.sheets[0]!.pieces.length).toBe(4);
    expect(nestPlan.stats.globalYieldPercent).toBeGreaterThan(sawPlan.stats.globalYieldPercent);
  });

  it('sin cutStrategy el plan sigue siendo sierra guillotina (retrocompatible)', () => {
    const plan = optimizeCutPlan('proj-1', mixedRows, catalogMaterials, DEFAULT_CUT_PLAN_CONFIG);
    expect(plan.config.cutStrategy).toBeUndefined();
    for (const sheet of plan.sheets) {
      expect(sheet.strategy).toBe('saw-guillotine');
      expect(sheet.instructions.length).toBeGreaterThan(0);
    }
  });
});
