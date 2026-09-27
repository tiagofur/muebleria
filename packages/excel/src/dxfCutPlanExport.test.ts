import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CutPlan, PartDrillingPattern } from '@granete/domain';
import { ValidationError } from '@granete/domain';
import {
  dxfCutPlanExport,
  generateDxfBySheet,
  generateDxfByPiece,
} from './dxfCutPlanExport';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function buildCutPlanFixture(): CutPlan {
  return {
    id: 'cutplan-test-1',
    projectId: 'proj-test-1',
    projectName: 'Cocina Test',
    generatedAt: '2026-08-20T00:00:00.000Z',
    version: 1,
    isFrozen: false,
    config: {
      sawKerfMm: 4,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: true,
      allowRotationNoGrain: true,
      minRemnantWidthMm: 400,
      minRemnantLengthMm: 600,
      preferLongitudinalRips: true,
      cutStrategy: 'cnc-nesting',
      toolSpacingMm: 8,
    },
    sheets: [
      {
        sheetIndex: 0,
        strategy: 'cnc-nesting',
        materialCode: 'MDF18',
        materialName: 'MDF Blanco 18mm',
        sheetWidthMm: 1830,
        sheetLengthMm: 2440,
        thicknessMm: 18,
        pieces: [
          {
            id: 'LAT-01-1-s0',
            partCode: 'LAT-01',
            partName: 'Lateral',
            moduleCode: 'M01',
            labelRef: 'A1',
            materialName: 'MDF Blanco 18mm',
            materialCode: 'MDF18',
            xMm: 10,
            yMm: 10,
            lengthMm: 800,
            widthMm: 500,
            originalLengthMm: 800,
            originalWidthMm: 500,
            grain: 1,
            rotated: false,
            L1: 1,
            L2: 1,
            W1: 0,
            W2: 0,
            thicknessMm: 18,
            sheetIndex: 0,
            stripIndex: 0,
            cutSequenceNumber: 1,
            status: 'pending',
          },
          {
            id: 'SEP-01-1-s0',
            partCode: 'SEP-01',
            partName: 'Separador',
            moduleCode: 'M01',
            labelRef: 'A2',
            materialName: 'MDF Blanco 18mm',
            materialCode: 'MDF18',
            xMm: 900,
            yMm: 10,
            lengthMm: 300,
            widthMm: 400,
            originalLengthMm: 400,
            originalWidthMm: 300,
            grain: 0,
            rotated: true,
            L1: 0,
            L2: 0,
            W1: 0,
            W2: 0,
            thicknessMm: 18,
            sheetIndex: 0,
            stripIndex: 0,
            cutSequenceNumber: 2,
            status: 'pending',
          },
        ],
        remnants: [
          {
            id: 'rem-s0-1',
            sheetIndex: 0,
            xMm: 10,
            yMm: 1400,
            lengthMm: 2400,
            widthMm: 400,
            areaM2: 0.96,
            materialName: 'MDF Blanco 18mm',
            materialCode: 'MDF18',
            isUseful: true,
          },
          {
            id: 'rem-s0-2',
            sheetIndex: 0,
            xMm: 10,
            yMm: 520,
            lengthMm: 100,
            widthMm: 100,
            areaM2: 0.01,
            materialName: 'MDF Blanco 18mm',
            materialCode: 'MDF18',
            isUseful: false,
          },
        ],
        instructions: [],
        netPiecesAreaM2: 0.52,
        grossSheetAreaM2: 4.47,
        usableRemnantAreaM2: 0.96,
        wasteAreaM2: 2.99,
        wastePercent: 66.9,
        yieldPercent: 11.6,
      },
    ],
    stats: {
      totalSheets: 1,
      totalPieces: 2,
      totalGrossAreaM2: 4.47,
      totalNetPiecesAreaM2: 0.52,
      totalUsefulRemnantsAreaM2: 0.96,
      totalWasteAreaM2: 2.99,
      globalWastePercent: 66.9,
      globalYieldPercent: 11.6,
      byMaterial: [],
    },
    usefulRemnants: [],
  };
}

const drillingFixture: PartDrillingPattern[] = [
  {
    pieceCode: 'LAT-01',
    moduleCode: 'M01',
    partName: 'Lateral',
    lengthMm: 800,
    widthMm: 500,
    materialName: 'MDF Blanco 18mm',
    holes: [
      // Face-plane convention: front x along width (≤500), y along length (≤800).
      { face: 'front', xMm: 100, yMm: 50, diameterMm: 10, depthMm: 12, type: 'dowel' },
      { face: 'front', xMm: 400, yMm: 750, diameterMm: 35, depthMm: 12, type: 'minifix' },
      { face: 'left', xMm: 9, yMm: 250, diameterMm: 8, depthMm: 30, type: 'screw' },
    ],
  },
  {
    pieceCode: 'SEP-01',
    moduleCode: 'M01',
    partName: 'Separador',
    lengthMm: 400,
    widthMm: 300,
    materialName: 'MDF Blanco 18mm',
    holes: [
      { face: 'front', xMm: 20, yMm: 20, diameterMm: 5, depthMm: 10, type: 'dowel' },
    ],
  },
];

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function countEntities(dxf: string, entityType: string): number {
  return dxf.split(`0\n${entityType}\n`).length - 1;
}

function countLayerEntities(dxf: string, entityType: string, layer: string): number {
  return dxf.split(`0\n${entityType}\n8\n${layer}\n`).length - 1;
}

function circleEntities(dxf: string): Array<{ layer: string; x: number; y: number; radius: number }> {
  const section = dxf.split('0\nSECTION\n2\nENTITIES\n')[1]?.split('0\nENDSEC\n')[0];
  if (section === undefined) throw new Error('Missing DXF ENTITIES section');
  const pairs = section.trimEnd().split('\n');
  const circles: Array<{ layer: string; x: number; y: number; radius: number }> = [];
  for (let i = 0; i < pairs.length; i += 2) {
    if (pairs[i] !== '0' || pairs[i + 1] !== 'CIRCLE') continue;
    const values = new Map<string, string>();
    for (i += 2; i < pairs.length && pairs[i] !== '0'; i += 2) {
      values.set(pairs[i]!, pairs[i + 1]!);
    }
    i -= 2;
    circles.push({
      layer: values.get('8') ?? '',
      x: Number(values.get('10')),
      y: Number(values.get('20')),
      radius: Number(values.get('40')),
    });
  }
  return circles;
}

function projectionFixture(rotated: boolean) {
  const base = buildCutPlanFixture();
  const sheet = base.sheets[0]!;
  const piece = {
    ...sheet.pieces[1]!, labelRef: 'ROT-1', xMm: 1000, yMm: 200,
    lengthMm: rotated ? 400 : 600, widthMm: rotated ? 600 : 400,
    originalLengthMm: 600, originalWidthMm: 400, rotated,
  };
  const plan: CutPlan = { ...base, sheets: [{ ...sheet, pieces: [piece], remnants: [] }] };
  const pattern: PartDrillingPattern = {
    pieceCode: piece.labelRef, moduleCode: piece.moduleCode, partName: piece.partName,
    lengthMm: 600, widthMm: 400, materialName: piece.materialName,
    holes: [
      { face: 'front', xMm: 40, yMm: 100, diameterMm: 5, depthMm: 10, type: 'dowel' },
      { face: 'back', xMm: 70, yMm: 450, diameterMm: 8, depthMm: 12, type: 'screw' },
    ],
  };
  return { plan, piece, pattern };
}

describe('dxfCutPlanExport', () => {
  describe('DXF-only CCW drilling projection', () => {
    it('uses the specified front/back coordinates in all four routes', () => {
      const rotated = projectionFixture(true);
      const unrotated = projectionFixture(false);
      const boardExpected = [
        { layer: 'PERF_F5', x: 1360, y: 300, radius: 2.5 },
        { layer: 'PERF_B8', x: 1070, y: 650, radius: 4 },
      ];
      const isolatedExpected = [
        { layer: 'PERF_F5', x: 360, y: 100, radius: 2.5 },
        { layer: 'PERF_B8', x: 70, y: 450, radius: 4 },
      ];
      expect(circleEntities(decode(dxfCutPlanExport({ cutPlan: rotated.plan, variant: 'sheets', drilling: [rotated.pattern] })))).toEqual(boardExpected);
      expect(circleEntities(generateDxfBySheet({ cutPlan: rotated.plan, drilling: [rotated.pattern] })[0]!.dxfContent)).toEqual(boardExpected);
      expect(circleEntities(generateDxfByPiece({ cutPlan: rotated.plan, drilling: [rotated.pattern] })[0]!.dxfContent)).toEqual(isolatedExpected);
      expect(circleEntities(decode(dxfCutPlanExport({ cutPlan: rotated.plan, variant: 'pieces', drilling: [rotated.pattern] })))).toEqual([
        { layer: 'PERF_F5', x: 360, y: 280, radius: 2.5 },
        { layer: 'PERF_B8', x: 70, y: 630, radius: 4 },
      ]);
      const unrotatedExpected = [
        { layer: 'PERF_F5', x: 1100, y: 240, radius: 2.5 },
        { layer: 'PERF_B8', x: 1450, y: 530, radius: 4 },
      ];
      expect(circleEntities(decode(dxfCutPlanExport({ cutPlan: unrotated.plan, variant: 'sheets', drilling: [unrotated.pattern] })))).toEqual(unrotatedExpected);
      expect(circleEntities(generateDxfBySheet({ cutPlan: unrotated.plan, drilling: [unrotated.pattern] })[0]!.dxfContent)).toEqual(unrotatedExpected);
    });

    it('rotates all corners, asymmetric square drilling, and four edge reference points', () => {
      const { plan, piece, pattern } = projectionFixture(true);
      const holes: PartDrillingPattern['holes'][number][] = [
        { face: 'front', xMm: 0, yMm: 0, diameterMm: 1, depthMm: 1, type: 'dowel' },
        { face: 'front', xMm: 0, yMm: 600, diameterMm: 2, depthMm: 1, type: 'dowel' },
        { face: 'front', xMm: 400, yMm: 600, diameterMm: 3, depthMm: 1, type: 'dowel' },
        { face: 'front', xMm: 400, yMm: 0, diameterMm: 4, depthMm: 1, type: 'dowel' },
        { face: 'left', xMm: 9, yMm: 100, diameterMm: 5, depthMm: 1, type: 'screw' },
        { face: 'right', xMm: 9, yMm: 100, diameterMm: 6, depthMm: 1, type: 'screw' },
        { face: 'bottom', xMm: 40, yMm: 9, diameterMm: 7, depthMm: 1, type: 'screw' },
        { face: 'top', xMm: 40, yMm: 9, diameterMm: 8, depthMm: 1, type: 'screw' },
      ];
      const dxf = generateDxfByPiece({ cutPlan: plan, drilling: [{ ...pattern, holes }] })[0]!.dxfContent;
      expect(circleEntities(dxf)).toEqual([
        { layer: 'PERF_F1', x: 400, y: 0, radius: 0.5 },
        { layer: 'PERF_F2', x: 400, y: 600, radius: 1 },
        { layer: 'PERF_F3', x: 0, y: 600, radius: 1.5 },
        { layer: 'PERF_F4', x: 0, y: 0, radius: 2 },
        { layer: 'PERF_CANTO5', x: 400, y: 100, radius: 2.5 },
        { layer: 'PERF_CANTO6', x: 0, y: 100, radius: 3 },
        { layer: 'PERF_CANTO7', x: 360, y: 0, radius: 3.5 },
        { layer: 'PERF_CANTO8', x: 360, y: 600, radius: 4 },
      ]);
      const square = { ...piece, lengthMm: 400, widthMm: 400 };
      const squarePlan: CutPlan = { ...plan, sheets: [{ ...plan.sheets[0]!, pieces: [square] }] };
      const squarePattern = { ...pattern, lengthMm: 400, holes: [
        { face: 'front' as const, xMm: 80, yMm: 20, diameterMm: 5, depthMm: 10, type: 'dowel' as const },
      ] };
      expect(circleEntities(generateDxfByPiece({ cutPlan: squarePlan, drilling: [squarePattern] })[0]!.dxfContent)).toEqual([
        { layer: 'PERF_F5', x: 320, y: 20, radius: 2.5 },
      ]);
    });

    it('binds repeated part codes by exact occurrence and offsets later sheets once', () => {
      const { plan, piece, pattern } = projectionFixture(true);
      const later = { ...piece, id: 'second', labelRef: 'ROT-2', sheetIndex: 1 };
      const secondSheet = { ...plan.sheets[0]!, sheetIndex: 1, pieces: [later] };
      const multi: CutPlan = { ...plan, sheets: [...plan.sheets, secondSheet] };
      const secondPattern = { ...pattern, pieceCode: 'ROT-2', holes: [pattern.holes[1]!] };
      const dxf = decode(dxfCutPlanExport({ cutPlan: multi, variant: 'sheets', drilling: [pattern, secondPattern] }));
      expect(circleEntities(dxf)).toEqual([
        { layer: 'PERF_F5', x: 1360, y: 300, radius: 2.5 },
        { layer: 'PERF_B8', x: 1070, y: 650, radius: 4 },
        { layer: 'PERF_B8', x: 3710, y: 650, radius: 4 },
      ]);
      const files = generateDxfBySheet({ cutPlan: multi, drilling: [pattern, secondPattern] });
      expect(files).toHaveLength(2);
      expect(circleEntities(files[1]!.dxfContent)).toEqual([{ layer: 'PERF_B8', x: 1070, y: 650, radius: 4 }]);
    });

    it('rejects ambiguous identity, duplicate keys, frame mismatch, and invalid holes before any batch result', () => {
      const { plan, piece, pattern } = projectionFixture(true);
      const second = { ...piece, id: 'second', labelRef: 'ROT-2' };
      const repeated: CutPlan = { ...plan, sheets: [{ ...plan.sheets[0]!, pieces: [piece, second] }] };
      expect(() => generateDxfByPiece({ cutPlan: repeated, drilling: [{ ...pattern, pieceCode: piece.partCode }] })).toThrow(/Ambiguous/);
      const aliasCollision: CutPlan = {
        ...plan,
        sheets: [{ ...plan.sheets[0]!, pieces: [piece, { ...second, partCode: piece.labelRef }] }],
      };
      expect(() => generateDxfByPiece({ cutPlan: aliasCollision, drilling: [pattern] })).toThrow(/Ambiguous/);
      expect(() => generateDxfByPiece({ cutPlan: plan, drilling: [pattern, pattern] })).toThrow(/Duplicate/);
      expect(() => generateDxfBySheet({ cutPlan: { ...plan, sheets: [] }, drilling: [pattern] })).toThrow(/unmatched/);
      const mismatch = { ...pattern, widthMm: 399 };
      expect(() => generateDxfBySheet({ cutPlan: plan, drilling: [mismatch] })).toThrow(/frame differs/);
      expect(() => generateDxfByPiece({ cutPlan: plan, drilling: [{ ...pattern, lengthMm: NaN }] })).toThrow(ValidationError);
      const invalidPlacement: CutPlan = {
        ...plan, sheets: [{ ...plan.sheets[0]!, pieces: [{ ...piece, xMm: Infinity }] }],
      };
      expect(() => generateDxfBySheet({ cutPlan: invalidPlacement, drilling: [pattern] })).toThrow(ValidationError);
      const invalids = [
        { ...pattern.holes[0]!, xMm: Number.NaN },
        { ...pattern.holes[0]!, xMm: 401 },
        { ...pattern.holes[0]!, diameterMm: Infinity },
        { ...pattern.holes[0]!, depthMm: 0 },
        { ...pattern.holes[0]!, face: 'unknown' as 'front' },
      ];
      for (const hole of invalids) {
        expect(() => dxfCutPlanExport({ cutPlan: plan, variant: 'sheets', drilling: [{ ...pattern, holes: [hole] }] })).toThrow(ValidationError);
      }
      const lateBad = { ...pattern, pieceCode: 'ROT-2', widthMm: 399 };
      expect(() => generateDxfBySheet({ cutPlan: repeated, drilling: [pattern, lateBad] })).toThrow(/frame differs/);
    });

    it('rejects a partially supplied drilling batch in every route, while accepting explicit zero-hole coverage', () => {
      const cutPlan = buildCutPlanFixture();
      const partial = [drillingFixture[0]!];
      const complete = [partial[0]!, { ...drillingFixture[1]!, holes: [] }];
      const routes = [
        (drilling?: readonly PartDrillingPattern[]) => dxfCutPlanExport({ cutPlan, variant: 'sheets', drilling }),
        (drilling?: readonly PartDrillingPattern[]) => dxfCutPlanExport({ cutPlan, variant: 'pieces', drilling }),
        (drilling?: readonly PartDrillingPattern[]) => generateDxfBySheet({ cutPlan, drilling }),
        (drilling?: readonly PartDrillingPattern[]) => generateDxfByPiece({ cutPlan, drilling }),
      ];

      for (const route of routes) {
        expect(() => route(partial)).toThrow(/Missing DXF drilling pattern/);
        expect(() => route(complete)).not.toThrow();
        expect(() => route()).not.toThrow();
      }

      const sheet = cutPlan.sheets[0]!;
      const laterPiece = { ...sheet.pieces[1]!, sheetIndex: 1 };
      const multiSheet: CutPlan = {
        ...cutPlan,
        sheets: [
          { ...sheet, pieces: [sheet.pieces[0]!] },
          { ...sheet, sheetIndex: 1, pieces: [laterPiece] },
        ],
      };
      expect(() => generateDxfBySheet({ cutPlan: multiSheet, drilling: partial })).toThrow(/Missing DXF drilling pattern/);
    });

    it('is deterministic, does not mutate inputs, and marks the output policy', () => {
      const { plan, pattern } = projectionFixture(true);
      const before = JSON.stringify({ plan, pattern });
      const first = generateDxfByPiece({ cutPlan: plan, drilling: [pattern] })[0]!.dxfContent;
      const second = generateDxfByPiece({ cutPlan: plan, drilling: [pattern] })[0]!.dxfContent;
      expect(first).toBe(second);
      expect(JSON.stringify({ plan, pattern })).toBe(before);
      expect(first).toContain('999\ngranete.dxf-cut-plan-projection.v1\n');
    });
  });

  it('golden: variante sheets (tableros nesteados)', () => {
    const dxf = decode(dxfCutPlanExport({ cutPlan: buildCutPlanFixture(), variant: 'sheets', drilling: drillingFixture }));
    const fixturePath = join(FIXTURES_DIR, 'cutPlanDxfSheets.expected.dxf');
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(fixturePath, dxf, 'utf8');
    }
    expect(dxf).toBe(readFileSync(fixturePath, 'utf8'));
  });

  it('golden: variante pieces (piezas sueltas)', () => {
    const dxf = decode(dxfCutPlanExport({ cutPlan: buildCutPlanFixture(), variant: 'pieces', drilling: drillingFixture }));
    const fixturePath = join(FIXTURES_DIR, 'cutPlanDxfPieces.expected.dxf');
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(fixturePath, dxf, 'utf8');
    }
    expect(dxf).toBe(readFileSync(fixturePath, 'utf8'));
  });

  it('estructura R12: secciones, capas declaradas y EOF', () => {
    const dxf = decode(dxfCutPlanExport({ cutPlan: buildCutPlanFixture(), variant: 'sheets' }));
    expect(dxf.startsWith('0\nSECTION\n2\nHEADER')).toBe(true);
    for (const section of ['HEADER', 'TABLES', 'ENTITIES']) {
      expect(dxf).toContain(`2\n${section}`);
    }
    expect(dxf.trimEnd().endsWith('0\nEOF')).toBe(true);
    for (const layer of ['TABLERO', 'PIEZA', 'ETIQUETA', 'VETA', 'PERF', 'RETAZO']) {
      expect(dxf).toContain(`2\n${layer}\n70\n0`);
    }
  });

  it('variante sheets: contornos de tablero, piezas, retazo útil (no el inútil) y perforaciones', () => {
    const dxf = decode(dxfCutPlanExport({ cutPlan: buildCutPlanFixture(), variant: 'sheets', drilling: drillingFixture }));
    // 1 contorno tablero + 2 piezas + 1 retazo útil = 4 polilíneas
    expect(countEntities(dxf, 'POLYLINE')).toBe(4);
    expect(countLayerEntities(dxf, 'POLYLINE', 'TABLERO')).toBe(1);
    expect(countLayerEntities(dxf, 'POLYLINE', 'PIEZA')).toBe(2);
    expect(countLayerEntities(dxf, 'POLYLINE', 'RETAZO')).toBe(1);
    // LAT-01 has two front holes and one edge reference; rotated SEP-01 adds Ø5.
    expect(countLayerEntities(dxf, 'CIRCLE', 'PERF_F10')).toBe(1);
    expect(countLayerEntities(dxf, 'CIRCLE', 'PERF_F35')).toBe(1);
    expect(countLayerEntities(dxf, 'CIRCLE', 'PERF_CANTO8')).toBe(1);
    expect(countLayerEntities(dxf, 'CIRCLE', 'PERF_F5')).toBe(1);
    // encabezado del tablero con material y espesor
    expect(dxf).toContain('TABLERO #1 - MDF Blanco 18mm 18mm');
    // etiqueta de retazo con medidas redondeadas
    expect(dxf).toContain('RETAZO 2400x400');
  });

  it('variante pieces: sin contornos de tablero ni retazos, con material en etiqueta', () => {
    const dxf = decode(dxfCutPlanExport({ cutPlan: buildCutPlanFixture(), variant: 'pieces' }));
    expect(countLayerEntities(dxf, 'POLYLINE', 'TABLERO')).toBe(0);
    expect(countLayerEntities(dxf, 'POLYLINE', 'RETAZO')).toBe(0);
    expect(countLayerEntities(dxf, 'POLYLINE', 'PIEZA')).toBe(2);
    expect(dxf).toContain('MDF Blanco 18mm');
  });

  it('sanitiza el texto a ASCII y marca la veta con flecha en capa VETA', () => {
    const dxf = decode(dxfCutPlanExport({ cutPlan: buildCutPlanFixture(), variant: 'sheets' }));
    expect(dxf).toMatch(/^[\x20-\x7E\n]+$/);
    expect(countLayerEntities(dxf, 'LINE', 'VETA')).toBe(3);
    expect(dxf).toContain('Cantos: L1+L2');
  });

  it('rechaza planes vacíos con ValidationError accionable', () => {
    const plan = buildCutPlanFixture();
    expect(() =>
      dxfCutPlanExport({ cutPlan: { ...plan, sheets: [] }, variant: 'sheets' }),
    ).toThrow(ValidationError);
    expect(() =>
      dxfCutPlanExport({
        cutPlan: { ...plan, sheets: [{ ...plan.sheets[0]!, pieces: [] }] },
        variant: 'pieces',
      }),
    ).toThrow(/no tiene piezas/);
  });

  describe('generateDxfBySheet', () => {
    it('genera un archivo DXF individual para cada tablero con origen (0,0)', () => {
      const plan = buildCutPlanFixture();
      const files = generateDxfBySheet({ cutPlan: plan, projectName: 'Cocina Especial', drilling: drillingFixture });

      expect(files).toHaveLength(1);
      const sheetFile = files[0]!;
      expect(sheetFile.sheetIndex).toBe(0);
      expect(sheetFile.fileName).toBe('Cocina-Especial_Tablero-01_MDF18_2440x1830.dxf');
      expect(sheetFile.sheetLengthMm).toBe(2440);
      expect(sheetFile.sheetWidthMm).toBe(1830);

      const dxf = decode(sheetFile.bytes);
      expect(dxf.startsWith('0\nSECTION\n2\nHEADER')).toBe(true);
      expect(dxf.trimEnd().endsWith('0\nEOF')).toBe(true);
      // Header EXTMAX adaptado al tablero individual
      expect(dxf).toContain('9\n$EXTMAX\n10\n2440.00\n20\n1950.00\n30\n0.0');
      // Contornos
      expect(countLayerEntities(dxf, 'POLYLINE', 'TABLERO')).toBe(1);
      expect(countLayerEntities(dxf, 'POLYLINE', 'PIEZA')).toBe(2);
      expect(countLayerEntities(dxf, 'CIRCLE', 'PERF_F10')).toBe(1);
      expect(countLayerEntities(dxf, 'CIRCLE', 'PERF_F35')).toBe(1);
    });

    it('retorna array vacío si el plan no tiene tableros', () => {
      const plan = buildCutPlanFixture();
      const files = generateDxfBySheet({ cutPlan: { ...plan, sheets: [] } });
      expect(files).toEqual([]);
    });
  });

  describe('generateDxfByPiece', () => {
    it('emits all front drilling entities for an asymmetric rotated piece', () => {
      const plan = buildCutPlanFixture();
      const sheet = plan.sheets[0]!;
      const rotatedPiece = sheet.pieces[1]!;
      const drilling: PartDrillingPattern[] = [{
        pieceCode: rotatedPiece.partCode,
        moduleCode: rotatedPiece.moduleCode,
        partName: rotatedPiece.partName,
        lengthMm: rotatedPiece.originalLengthMm,
        widthMm: rotatedPiece.originalWidthMm,
        materialName: rotatedPiece.materialName,
        holes: [
          { face: 'front', xMm: 20, yMm: 35, diameterMm: 5, depthMm: 10, type: 'dowel' },
          { face: 'front', xMm: 235, yMm: 310, diameterMm: 12, depthMm: 8, type: 'minifix' },
        ],
      }];
      const rotatedPlan: CutPlan = {
        ...plan,
        sheets: [{ ...sheet, pieces: [rotatedPiece] }],
      };

      expect(rotatedPiece.rotated).toBe(true);
      expect(rotatedPiece.lengthMm).not.toBe(rotatedPiece.widthMm);
      const [file] = generateDxfByPiece({ cutPlan: rotatedPlan, drilling });
      expect(file?.partCode).toBe(rotatedPiece.partCode);
      const dxf = decode(file!.bytes);
      expect(dxf).toContain('2\nPERF_F5\n70\n0');
      expect(dxf).toContain('2\nPERF_F12\n70\n0');

      const readCircles = (content: string): Array<{ layer: string; radius: number }> => {
        const entitySection = content.split('0\nSECTION\n2\nENTITIES\n')[1]?.split('0\nENDSEC\n')[0];
        expect(entitySection).toBeDefined();
        const pairs = entitySection!.trimEnd().split('\n');
        const circles: Array<{ layer: string; radius: number }> = [];
        for (let i = 0; i < pairs.length; i += 2) {
          if (pairs[i] !== '0' || pairs[i + 1] !== 'CIRCLE') continue;
          let layer = '';
          let radius = NaN;
          for (i += 2; i < pairs.length && pairs[i] !== '0'; i += 2) {
            if (pairs[i] === '8') layer = pairs[i + 1]!;
            if (pairs[i] === '40') radius = Number(pairs[i + 1]);
          }
          i -= 2;
          circles.push({ layer, radius });
        }
        return circles;
      };
      const expectedCircles = [
        { layer: 'PERF_F5', radius: 2.5 },
        { layer: 'PERF_F12', radius: 6 },
      ];
      const unrotatedControl = {
        ...rotatedPiece,
        rotated: false,
        lengthMm: rotatedPiece.originalLengthMm,
        widthMm: rotatedPiece.originalWidthMm,
      };
      const [controlFile] = generateDxfByPiece({
        cutPlan: { ...rotatedPlan, sheets: [{ ...sheet, pieces: [unrotatedControl] }] },
        drilling,
      });
      expect(readCircles(decode(controlFile!.bytes))).toEqual(expectedCircles);
      expect(readCircles(dxf)).toEqual(expectedCircles);
    });

    it('genera un archivo DXF individual para cada pieza con origen (0,0)', () => {
      const plan = buildCutPlanFixture();
      const files = generateDxfByPiece({ cutPlan: plan, projectName: 'Cocina Especial', drilling: drillingFixture });

      expect(files).toHaveLength(2);

      const [p1, p2] = files;
      expect(p1!.partCode).toBe('LAT-01');
      expect(p1!.fileName).toBe('Cocina-Especial_LAT-01_M01_A1.dxf');
      expect(p1!.lengthMm).toBe(800);
      expect(p1!.widthMm).toBe(500);

      const dxf1 = decode(p1!.bytes);
      expect(dxf1.startsWith('0\nSECTION\n2\nHEADER')).toBe(true);
      expect(dxf1.trimEnd().endsWith('0\nEOF')).toBe(true);
      expect(countLayerEntities(dxf1, 'POLYLINE', 'TABLERO')).toBe(0);
      expect(countLayerEntities(dxf1, 'POLYLINE', 'PIEZA')).toBe(1);
      expect(countLayerEntities(dxf1, 'CIRCLE', 'PERF_F10')).toBe(1); // LAT-01 holes por capa
      expect(countLayerEntities(dxf1, 'CIRCLE', 'PERF_F35')).toBe(1);

      expect(p2!.partCode).toBe('SEP-01');
      expect(p2!.fileName).toBe('Cocina-Especial_SEP-01_M01_A2.dxf');
      const dxf2 = decode(p2!.bytes);
      expect(countLayerEntities(dxf2, 'POLYLINE', 'PIEZA')).toBe(1);
    });

    it('desambigua nombres si varias piezas tienen el mismo código', () => {
      const plan = buildCutPlanFixture();
      const sheet = plan.sheets[0]!;
      const duplicatePiece = { ...sheet.pieces[0]!, id: 'LAT-01-dup' };
      const planWithDups: CutPlan = {
        ...plan,
        sheets: [{ ...sheet, pieces: [sheet.pieces[0]!, duplicatePiece] }],
      };

      const files = generateDxfByPiece({ cutPlan: planWithDups, projectName: 'Cocina' });
      expect(files).toHaveLength(2);
      expect(files[0]!.fileName).toBe('Cocina_LAT-01_M01_A1.dxf');
      expect(files[1]!.fileName).toBe('Cocina_LAT-01_M01_A1_2.dxf');
    });
  });
});
