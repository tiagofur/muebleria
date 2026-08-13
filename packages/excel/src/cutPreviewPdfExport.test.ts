import { describe, expect, it } from 'vitest';
import type { ProductionCutRow } from '@muebles/domain';
import { ValidationError } from '@muebles/domain';
import {
  cutPreviewPdfExport,
  packCutRowsIntoSheets,
} from './cutPreviewPdfExport';

const mockCutRows: readonly ProductionCutRow[] = [
  {
    quantity: 2,
    lengthMm: 1200,
    widthMm: 600,
    description: 'P001 · Lateral · MOD-01',
    partName: 'Lateral',
    partCode: 'P001',
    moduleCode: 'MOD-01',
    materialName: 'Melamina 18mm',
    grain: 1,
    L1: 1,
    L2: 0,
    W1: 0,
    W2: 0,
  },
  {
    quantity: 3,
    lengthMm: 800,
    widthMm: 400,
    description: 'P002 · Estante · MOD-01',
    partName: 'Estante',
    partCode: 'P002',
    moduleCode: 'MOD-01',
    materialName: 'Melamina 18mm',
    grain: 0,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
  },
];

describe('packCutRowsIntoSheets', () => {
  it('packs pieces onto single sheet when within dimensions', () => {
    const sheets = packCutRowsIntoSheets(mockCutRows, 2440, 1830, 4);
    expect(sheets.length).toBe(1);
    expect(sheets[0]?.length).toBe(5); // 2 laterales + 3 estantes
  });

  it('respects saw kerf spacing between cuts', () => {
    const sheets = packCutRowsIntoSheets(mockCutRows, 2440, 1830, 10);
    const p1 = sheets[0]?.[0];
    const p2 = sheets[0]?.[1];
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p2!.x).toBe(p1!.x + p1!.w + 10);
  });

  it('paginates pieces onto multiple sheets when board space overflows', () => {
    // Small board size so pieces overflow
    const sheets = packCutRowsIntoSheets(mockCutRows, 1300, 700, 4);
    expect(sheets.length).toBeGreaterThan(1);
  });
});

describe('cutPreviewPdfExport', () => {
  it('throws ValidationError when cutRows is empty', async () => {
    await expect(
      cutPreviewPdfExport({
        projectId: 'P1',
        projectName: 'Test',
        cutRows: [],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('generates valid PDF bytes for cut preview', async () => {
    const pdfBytes = await cutPreviewPdfExport({
      projectId: 'P1',
      projectName: 'Cocina Lopez',
      customerName: 'Juan Lopez',
      cutRows: mockCutRows,
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(500);

    // Validate PDF header magic bytes %PDF-
    const header = String.fromCharCode(...pdfBytes.subarray(0, 5));
    expect(header).toBe('%PDF-');
  });
});
