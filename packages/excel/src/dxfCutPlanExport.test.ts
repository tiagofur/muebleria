import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CutPlan, PartDrillingPattern } from '@muebles/domain';
import { ValidationError } from '@muebles/domain';
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

describe('dxfCutPlanExport', () => {
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
    // perforaciones solo en la pieza no rotada (LAT-01: 2 agujeros)
    // F130: agujeros por cara+Ø — LAT-01 tiene 2 front (Ø10 y Ø35); el left (Ø8)
    // proyecta al canto. Espejo: no hay back en este fixture.
    expect(countLayerEntities(dxf, 'CIRCLE', 'PERF_F10')).toBe(1);
    expect(countLayerEntities(dxf, 'CIRCLE', 'PERF_F35')).toBe(1);
    expect(countLayerEntities(dxf, 'CIRCLE', 'PERF_CANTO8')).toBe(1);
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
