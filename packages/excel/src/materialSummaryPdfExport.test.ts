import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { plantillaGabOnlyProject, plantillaCatalogWithModules } from '@muebles/domain/fixtures';
import { materialSummaryPdfExport } from './materialSummaryPdfExport';

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
