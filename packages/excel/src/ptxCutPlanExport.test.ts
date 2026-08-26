import { describe, it, expect } from 'vitest';
import {
  ptxCutPlanExport,
  generatePtxString,
  generatePtxByMaterial,
} from './ptxCutPlanExport';
import { ValidationError, type CutPlan } from '@granete/domain';

function buildCutPlanFixture(): CutPlan {
  return {
    id: 'cutplan-test-01',
    projectId: 'PRJ-1042',
    projectName: 'Cocina Moderna',
    generatedAt: '2026-08-20T10:00:00.000Z',
    version: 1,
    isFrozen: false,
    config: {
      sawKerfMm: 4.4,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: true,
      allowRotationNoGrain: true,
      minRemnantLengthMm: 600,
      minRemnantWidthMm: 400,
      preferLongitudinalRips: true,
      heuristic: 'guillotine-hybrid',
    },
    sheets: [
      {
        sheetIndex: 0,
        strategy: 'saw-guillotine',
        materialCode: 'MEL_BLANCO_18',
        materialName: 'MDF Melamina Blanco 18mm',
        sheetLengthMm: 2750,
        sheetWidthMm: 1830,
        thicknessMm: 18,
        netPiecesAreaM2: 2.15,
        grossSheetAreaM2: 5.0325,
        usableRemnantAreaM2: 1.2,
        wasteAreaM2: 1.6825,
        wastePercent: 33.4,
        yieldPercent: 42.7,
        instructions: [],
        remnants: [
          {
            id: 'rem-01',
            sheetIndex: 0,
            xMm: 1500,
            yMm: 800,
            lengthMm: 1200,
            widthMm: 1000,
            areaM2: 1.2,
            materialName: 'MDF Melamina Blanco 18mm',
            materialCode: 'MEL_BLANCO_18',
            isUseful: true,
          },
        ],
        pieces: [
          {
            id: 'p-01',
            partCode: 'LAT_IZQ',
            partName: 'Lateral Izquierdo',
            moduleCode: 'BAJO_60',
            labelRef: 'BAR-LAT-01',
            materialName: 'MDF Melamina Blanco 18mm',
            materialCode: 'MEL_BLANCO_18',
            xMm: 10,
            yMm: 10,
            lengthMm: 716,
            widthMm: 578,
            originalLengthMm: 720,
            originalWidthMm: 580,
            grain: 1,
            rotated: false,
            L1: 1,
            L2: 1,
            W1: 1,
            W2: 0,
            edgeBandThicknessMm: 2.0,
            edgeBandName: 'PVC 2mm',
            sheetIndex: 0,
            stripIndex: 0,
            cutSequenceNumber: 1,
          },
          {
            id: 'p-02',
            partCode: 'BASE_60',
            partName: 'Base Mueble',
            moduleCode: 'BAJO_60',
            labelRef: 'BAR-BASE-01',
            materialName: 'MDF Melamina Blanco 18mm',
            materialCode: 'MEL_BLANCO_18',
            xMm: 730.4,
            yMm: 10,
            lengthMm: 564,
            widthMm: 578,
            originalLengthMm: 564,
            originalWidthMm: 580,
            grain: 0,
            rotated: false,
            L1: 0,
            L2: 0,
            W1: 1,
            W2: 0,
            edgeBandThicknessMm: 2.0,
            edgeBandName: 'PVC 2mm',
            sheetIndex: 0,
            stripIndex: 0,
            cutSequenceNumber: 2,
          },
        ],
      },
    ],
    stats: {
      totalSheets: 1,
      totalPieces: 2,
      totalGrossAreaM2: 5.0325,
      totalNetPiecesAreaM2: 2.15,
      totalUsefulRemnantsAreaM2: 1.2,
      totalWasteAreaM2: 1.6825,
      globalWastePercent: 33.4,
      globalYieldPercent: 42.7,
      byMaterial: [],
    },
    usefulRemnants: [],
  };
}

describe('ptxCutPlanExport', () => {
  it('generates valid PTX v1.14 ASCII content with all mandatory blocks', () => {
    const plan = buildCutPlanFixture();
    const ptx = generatePtxString({
      cutPlan: plan,
      customerName: 'Juan Pérez',
      projectName: 'Cocina Moderna 2026',
      projectCode: 'PRJ-1042',
    });

    // Check CRLF endings
    expect(ptx).toContain('\r\n');

    // [HEADER]
    expect(ptx).toContain('[HEADER]');
    expect(ptx).toContain('VERSION=1.14');
    expect(ptx).toContain('SYSTEM=GRANETE_APP');
    expect(ptx).toContain('JOB_NAME=Cocina Moderna 2026');
    expect(ptx).toContain('PROJECT_CODE=PRJ-1042');
    expect(ptx).toContain('CUSTOMER=Juan Perez');
    expect(ptx).toContain('KERF=4.4');
    expect(ptx).toContain('TRIM_TOP=10.0');
    expect(ptx).toContain('DEDUCT_EDGEBAND=1');
    expect(ptx).toContain('TOTAL_SHEETS=1');
    expect(ptx).toContain('TOTAL_PIECES=2');

    // [MATERIALS]
    expect(ptx).toContain('[MATERIALS]');
    expect(ptx).toContain('"MEL_BLANCO_18", "MDF Melamina Blanco 18mm", 2750.0, 1830.0, 18.0, 10.0, 10.0, 10.0, 10.0, 4.4, 1');

    // [PARTS]
    expect(ptx).toContain('[PARTS]');
    expect(ptx).toContain('"P_1", "LAT_IZQ", "Lateral Izquierdo", "MEL_BLANCO_18", 720.0, 580.0, 716.0, 578.0, 1, 1, 0, "2.0", "2.0", "2.0", "0.0", "BAR-LAT-01", "", "BAJO_60", "BAR-LAT-01", "PRJ-1042"');
    expect(ptx).toContain('"P_2", "BASE_60", "Base Mueble", "MEL_BLANCO_18", 564.0, 580.0, 564.0, 578.0, 1, 0, 0, "0.0", "0.0", "2.0", "0.0", "BAR-BASE-01", "", "BAJO_60", "BAR-BASE-01", "PRJ-1042"');

    // [PATTERNS]
    expect(ptx).toContain('[PATTERNS]');
    expect(ptx).toContain('"PAT_1", 1, "MEL_BLANCO_18", 2750.0, 1830.0, 1, 42.7, 2, 33.4');

    // [CUTS]
    expect(ptx).toContain('[CUTS]');
    expect(ptx).toContain('"PAT_1", 1, 0, "TRIM_BOTTOM", 10.0, 2750.0, ""');
    expect(ptx).toContain('"PAT_1", 2, 0, "TRIM_LEFT", 10.0, 1830.0, ""');
    expect(ptx).toContain('"PAT_1", 5, 1, "RIP_STRIP_1", 588.0, 2750.0, "STRIP_1"');
    expect(ptx).toContain('"PAT_1", 6, 2, "CROSS_CUT", 726.0, 578.0, "LAT_IZQ"');
    expect(ptx).toContain('"PAT_1", 7, 2, "CROSS_CUT", 1294.4, 578.0, "BASE_60"');

    // [REMNANTS]
    expect(ptx).toContain('[REMNANTS]');
    expect(ptx).toContain('"REM_1", "PAT_1", 1500.0, 800.0, 1200.0, 1000.0, 1.2, 1');
  });

  it('allows overriding saw kerf via options', () => {
    const plan = buildCutPlanFixture();
    const ptx = generatePtxString({
      cutPlan: plan,
      sawKerfMm: 4.0,
    });

    expect(ptx).toContain('KERF=4.0');
    expect(ptx).toContain('2750.0, 1830.0, 18.0, 10.0, 10.0, 10.0, 10.0, 4.0, 1');
  });

  it('returns Uint8Array buffer in ptxCutPlanExport', () => {
    const plan = buildCutPlanFixture();
    const bytes = ptxCutPlanExport({ cutPlan: plan });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);

    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toContain('[HEADER]');
    expect(decoded).toContain('[PATTERNS]');
  });

  it('generates separate PTX files per material with generatePtxByMaterial', () => {
    const basePlan = buildCutPlanFixture();
    // Add a second sheet with a different material (FONDO_3)
    const multiMatPlan: CutPlan = {
      ...basePlan,
      sheets: [
        ...basePlan.sheets,
        {
          sheetIndex: 1,
          strategy: 'saw-guillotine',
          materialCode: 'FONDO_3',
          materialName: 'MDF Fondo Blanco 3mm',
          sheetLengthMm: 2440,
          sheetWidthMm: 1220,
          thicknessMm: 3,
          netPiecesAreaM2: 1.0,
          grossSheetAreaM2: 2.9768,
          usableRemnantAreaM2: 0,
          wasteAreaM2: 1.9768,
          wastePercent: 66.4,
          yieldPercent: 33.6,
          instructions: [],
          remnants: [],
          pieces: [
            {
              id: 'p-03',
              partCode: 'FONDO_BAJO',
              partName: 'Fondo Bajo 60',
              moduleCode: 'BAJO_60',
              labelRef: 'BAR-FONDO-01',
              materialName: 'MDF Fondo Blanco 3mm',
              materialCode: 'FONDO_3',
              xMm: 10,
              yMm: 10,
              lengthMm: 680,
              widthMm: 560,
              originalLengthMm: 680,
              originalWidthMm: 560,
              grain: 0,
              rotated: false,
              L1: 0,
              L2: 0,
              W1: 0,
              W2: 0,
              edgeBandThicknessMm: 0,
              sheetIndex: 1,
              stripIndex: 0,
              cutSequenceNumber: 1,
            },
          ],
        },
      ],
      stats: {
        ...basePlan.stats,
        totalSheets: 2,
        totalPieces: 3,
      },
    };

    const files = generatePtxByMaterial({
      cutPlan: multiMatPlan,
      projectName: 'Proyecto Integral',
    });

    expect(files).toHaveLength(2);

    // First file: MEL_BLANCO_18
    const f1 = files.find((f) => f.materialCode === 'MEL_BLANCO_18');
    expect(f1).toBeDefined();
    expect(f1!.fileName).toBe('Proyecto-Integral_MEL_BLANCO_18.ptx');
    expect(f1!.sheetsCount).toBe(1);
    expect(f1!.piecesCount).toBe(2);
    expect(f1!.ptxContent).toContain('TOTAL_PIECES=2');
    expect(f1!.ptxContent).toContain('MEL_BLANCO_18');
    expect(f1!.ptxContent).not.toContain('FONDO_3');

    // Second file: FONDO_3
    const f2 = files.find((f) => f.materialCode === 'FONDO_3');
    expect(f2).toBeDefined();
    expect(f2!.fileName).toBe('Proyecto-Integral_FONDO_3.ptx');
    expect(f2!.sheetsCount).toBe(1);
    expect(f2!.piecesCount).toBe(1);
    expect(f2!.ptxContent).toContain('TOTAL_PIECES=1');
    expect(f2!.ptxContent).toContain('FONDO_3');
    expect(f2!.ptxContent).not.toContain('MEL_BLANCO_18');
  });

  it('throws ValidationError when cutPlan has no sheets', () => {
    const plan = { ...buildCutPlanFixture(), sheets: [] };
    expect(() => ptxCutPlanExport({ cutPlan: plan })).toThrow(ValidationError);
  });

  it('throws ValidationError when cutPlan has no pieces', () => {
    const plan = {
      ...buildCutPlanFixture(),
      sheets: [{ ...buildCutPlanFixture().sheets[0]!, pieces: [] }],
    };
    expect(() => ptxCutPlanExport({ cutPlan: plan })).toThrow(ValidationError);
  });
});

