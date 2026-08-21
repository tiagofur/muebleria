import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import type { CutPlan } from '@muebles/domain';
import type { DownloadDeps } from './exportOptimizer';
import {
  downloadCutPlanDxf,
  dxfZipFileName,
} from './exportCutPlanDxf';

function buildCutPlanFixture(): CutPlan {
  return {
    id: 'cutplan-nest-01',
    projectId: 'PRJ-2001',
    projectName: 'Cocina Especial',
    generatedAt: '2026-08-20T12:00:00.000Z',
    version: 1,
    isFrozen: false,
    config: {
      sawKerfMm: 4,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: true,
      allowRotationNoGrain: true,
      minRemnantLengthMm: 600,
      minRemnantWidthMm: 400,
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
        sheetLengthMm: 2440,
        sheetWidthMm: 1830,
        thicknessMm: 18,
        netPiecesAreaM2: 0.5,
        grossSheetAreaM2: 4.46,
        usableRemnantAreaM2: 0,
        wasteAreaM2: 3.96,
        wastePercent: 88,
        yieldPercent: 12,
        instructions: [],
        remnants: [],
        pieces: [
          {
            id: 'p-01',
            partCode: 'LAT-IZQ',
            partName: 'Lateral Izquierdo',
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
            sheetIndex: 0,
            stripIndex: 0,
            cutSequenceNumber: 1,
          },
          {
            id: 'p-02',
            partCode: 'LAT-DER',
            partName: 'Lateral Derecho',
            moduleCode: 'M01',
            labelRef: 'A2',
            materialName: 'MDF Blanco 18mm',
            materialCode: 'MDF18',
            xMm: 820,
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
      totalGrossAreaM2: 4.46,
      totalNetPiecesAreaM2: 0.5,
      totalUsefulRemnantsAreaM2: 0,
      totalWasteAreaM2: 3.96,
      globalWastePercent: 88,
      globalYieldPercent: 12,
      byMaterial: [],
    },
    usefulRemnants: [],
  };
}

describe('exportCutPlanDxf', () => {
  it('dxfZipFileName formats zip file name for sheets and pieces', () => {
    expect(dxfZipFileName('Cocina Moderna', 'sheets')).toBe('Cocina-Moderna-nesting-tableros.zip');
    expect(dxfZipFileName('Cocina Moderna', 'pieces')).toBe('Cocina-Moderna-nesting-piezas.zip');
    expect(dxfZipFileName('', 'sheets')).toBe('plan-de-corte-nesting-tableros.zip');
  });

  it('descarga un archivo DXF individual si hay 1 solo tablero', async () => {
    const plan = buildCutPlanFixture();
    const fakeAnchor: any = {
      href: '',
      download: '',
      rel: '',
      click: vi.fn(),
    };

    let downloadedBlob: Blob | null = null;
    const deps: DownloadDeps = {
      createObjectURL: vi.fn((blob: Blob) => {
        downloadedBlob = blob;
        return 'blob:mock-dxf';
      }),
      revokeObjectURL: vi.fn(),
      createElement: vi.fn(() => fakeAnchor),
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    await downloadCutPlanDxf(plan, 'sheets', undefined, deps);

    expect(deps.createObjectURL).toHaveBeenCalled();
    expect(fakeAnchor.download).toBe('Cocina-Especial_Tablero-01_MDF18_2440x1830.dxf');
    expect(fakeAnchor.click).toHaveBeenCalled();

    expect(downloadedBlob).not.toBeNull();
    const text = await (downloadedBlob as unknown as Blob).text();
    expect(text).toContain('SECTION');
    expect(text).toContain('TABLERO');
  });

  it('empaqueta múltiples tableros en un ZIP con archivos individuales por tablero', async () => {
    const basePlan = buildCutPlanFixture();
    const multiSheetPlan: CutPlan = {
      ...basePlan,
      sheets: [
        ...basePlan.sheets,
        {
          ...basePlan.sheets[0]!,
          sheetIndex: 1,
          materialCode: 'MEL15',
          materialName: 'Melamina 15mm',
        },
      ],
      stats: {
        ...basePlan.stats,
        totalSheets: 2,
        totalPieces: 4,
      },
    };

    const fakeAnchor: any = {
      href: '',
      download: '',
      rel: '',
      click: vi.fn(),
    };

    let downloadedBlob: Blob | null = null;
    const deps: DownloadDeps = {
      createObjectURL: vi.fn((blob: Blob) => {
        downloadedBlob = blob;
        return 'blob:mock-zip';
      }),
      revokeObjectURL: vi.fn(),
      createElement: vi.fn(() => fakeAnchor),
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    await downloadCutPlanDxf(multiSheetPlan, 'sheets', undefined, deps);

    expect(fakeAnchor.download).toBe('Cocina-Especial-nesting-tableros.zip');
    expect(fakeAnchor.click).toHaveBeenCalled();

    expect(downloadedBlob).not.toBeNull();
    const arrayBuffer = await (downloadedBlob as unknown as Blob).arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const filenames = Object.keys(zip.files);

    expect(filenames).toHaveLength(2);
    expect(filenames).toContain('Cocina-Especial_Tablero-01_MDF18_2440x1830.dxf');
    expect(filenames).toContain('Cocina-Especial_Tablero-02_MEL15_2440x1830.dxf');

    const sheet1Dxf = await zip.file('Cocina-Especial_Tablero-01_MDF18_2440x1830.dxf')!.async('string');
    expect(sheet1Dxf).toContain('TABLERO #1 - MDF Blanco 18mm');
    expect(sheet1Dxf).toContain('0\nEOF');
  });

  it('empaqueta múltiples piezas sueltas en un ZIP con 1 DXF individual por pieza', async () => {
    const plan = buildCutPlanFixture();
    const fakeAnchor: any = {
      href: '',
      download: '',
      rel: '',
      click: vi.fn(),
    };

    let downloadedBlob: Blob | null = null;
    const deps: DownloadDeps = {
      createObjectURL: vi.fn((blob: Blob) => {
        downloadedBlob = blob;
        return 'blob:mock-zip';
      }),
      revokeObjectURL: vi.fn(),
      createElement: vi.fn(() => fakeAnchor),
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    await downloadCutPlanDxf(plan, 'pieces', undefined, deps);

    expect(fakeAnchor.download).toBe('Cocina-Especial-nesting-piezas.zip');
    expect(fakeAnchor.click).toHaveBeenCalled();

    expect(downloadedBlob).not.toBeNull();
    const arrayBuffer = await (downloadedBlob as unknown as Blob).arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const filenames = Object.keys(zip.files);

    expect(filenames).toHaveLength(2);
    expect(filenames).toContain('Cocina-Especial_LAT-IZQ_M01_A1.dxf');
    expect(filenames).toContain('Cocina-Especial_LAT-DER_M01_A2.dxf');

    const piece1Dxf = await zip.file('Cocina-Especial_LAT-IZQ_M01_A1.dxf')!.async('string');
    expect(piece1Dxf).toContain('LAT-IZQ');
    expect(piece1Dxf).toContain('MDF Blanco 18mm');
    expect(piece1Dxf).toContain('0\nEOF');
  });
});
