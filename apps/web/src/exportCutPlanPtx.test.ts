import { describe, it, expect, vi } from 'vitest';
import {
  downloadCutPlanPtx,
  ptxFileName,
  ptxZipFileName,
} from './exportCutPlanPtx';
import type { CutPlan } from '@granete/domain';
import type { DownloadDeps } from './exportOptimizer';

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
        remnants: [],
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
            sheetIndex: 0,
            stripIndex: 0,
            cutSequenceNumber: 1,
          },
        ],
      },
    ],
    stats: {
      totalSheets: 1,
      totalPieces: 1,
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

describe('exportCutPlanPtx', () => {
  it('ptxFileName sanitizes and formats names with .ptx extension', () => {
    expect(ptxFileName('Cocina Moderna 2026!')).toBe('Cocina-Moderna-2026.ptx');
    expect(ptxFileName('')).toBe('plan-de-corte.ptx');
  });

  it('ptxZipFileName formats zip file name', () => {
    expect(ptxZipFileName('Cocina Moderna')).toBe('seccionadora-materiales-Cocina-Moderna.zip');
  });

  it('downloadCutPlanPtx triggers download using injected deps (unified mode)', async () => {
    const plan = buildCutPlanFixture();
    const createdAnchors: any[] = [];
    const appendedNodes: any[] = [];
    const removedNodes: any[] = [];

    const fakeAnchor: any = {
      href: '',
      download: '',
      rel: '',
      click: vi.fn(),
    };

    const deps: DownloadDeps = {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
      createElement: vi.fn(() => {
        createdAnchors.push(fakeAnchor);
        return fakeAnchor;
      }),
      appendChild: vi.fn((node) => appendedNodes.push(node)),
      removeChild: vi.fn((node) => removedNodes.push(node)),
    };

    await downloadCutPlanPtx(
      plan,
      { projectName: 'Cocina Prueba', customerName: 'Cliente A', mode: 'unified' },
      'seccionadora.ptx',
      deps,
    );

    expect(deps.createObjectURL).toHaveBeenCalled();
    expect(fakeAnchor.download).toBe('seccionadora.ptx');
    expect(fakeAnchor.click).toHaveBeenCalled();
    expect(deps.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('downloadCutPlanPtx bundles multiple materials into a ZIP in by-material mode', async () => {
    const basePlan = buildCutPlanFixture();
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
          netPiecesAreaM2: 0.5,
          grossSheetAreaM2: 2.9768,
          usableRemnantAreaM2: 0,
          wasteAreaM2: 2.4768,
          wastePercent: 83.2,
          yieldPercent: 16.8,
          instructions: [],
          remnants: [],
          pieces: [
            {
              id: 'p-02',
              partCode: 'FONDO',
              partName: 'Fondo',
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
        totalPieces: 2,
      },
    };

    const fakeAnchor: any = {
      href: '',
      download: '',
      rel: '',
      click: vi.fn(),
    };

    const deps: DownloadDeps = {
      createObjectURL: vi.fn(() => 'blob:mock-zip-url'),
      revokeObjectURL: vi.fn(),
      createElement: vi.fn(() => fakeAnchor),
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    await downloadCutPlanPtx(
      multiMatPlan,
      { projectName: 'Cocina Integral', mode: 'by-material' },
      undefined,
      deps,
    );

    expect(deps.createObjectURL).toHaveBeenCalled();
    expect(fakeAnchor.download).toBe('seccionadora-materiales-Cocina-Integral.zip');
    expect(fakeAnchor.click).toHaveBeenCalled();
  });
});
