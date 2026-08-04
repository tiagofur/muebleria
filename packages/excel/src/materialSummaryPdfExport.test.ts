import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { plantillaGabOnlyProject, plantillaCatalogWithModules } from '@muebles/domain/fixtures';
import { boardSheetsSectionLabel, materialSummaryPdfExport } from './materialSummaryPdfExport';

describe('materialSummaryPdfExport (Issue #135)', () => {
  it('generates a valid PDF with material summary and board estimates', async () => {
    const bytes = await materialSummaryPdfExport({
      project: plantillaGabOnlyProject,
      catalog: plantillaCatalogWithModules,
      customerName: 'Cliente Test',
    });

    expect(bytes.byteLength).toBeGreaterThan(500);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('boardSheetsSectionLabel (sheet-size copy drift)', () => {
  // Regression: header used to hardcode "2440 × 1220 mm std" regardless of the
  // actual catalog sheet size. The plantilla fixture uses 1830 × 2440 boards,
  // so the label must reflect THAT size, not an invented standard.
  it('derives the size from the catalog (1830 × 2440, not 2440 × 1220)', () => {
    const label = boardSheetsSectionLabel([
      { sheetWidthMm: 1830, sheetLengthMm: 2440 },
      { sheetWidthMm: 1830, sheetLengthMm: 2440 },
    ]);
    expect(label).toBe('1. Tableros y Pliegos Estimados (1830 × 2440 mm)');
    expect(label).not.toContain('2440 × 1220');
  });

  it('reports "tamaños por material" when sheets have distinct sizes', () => {
    const label = boardSheetsSectionLabel([
      { sheetWidthMm: 1830, sheetLengthMm: 2440 },
      { sheetWidthMm: 1220, sheetLengthMm: 2440 },
    ]);
    expect(label).toBe('1. Tableros y Pliegos Estimados (tamaños por material)');
  });

  it('falls back to a generic label when no sheet size is known', () => {
    expect(boardSheetsSectionLabel([])).toBe('1. Tableros y Pliegos Estimados');
    expect(
      boardSheetsSectionLabel([{ sheetWidthMm: 0, sheetLengthMm: 0 }]),
    ).toBe('1. Tableros y Pliegos Estimados');
  });
});
