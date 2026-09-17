import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { optimizeCutPlan, DEFAULT_CUT_PLAN_CONFIG, type MaterialBoard, type ProductionCutRow } from '@granete/domain';
import { cutPlanPdfExport } from './cutPlanPdfExport';
import { PDFDocument } from 'pdf-lib';

describe('cutPlanPdfExport', () => {
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
  ];

  const sampleCutRows: ProductionCutRow[] = [
    {
      quantity: 2,
      lengthMm: 800,
      widthMm: 500,
      description: 'Lateral Izq · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 1,
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
      quantity: 4,
      lengthMm: 600,
      widthMm: 400,
      description: 'Estante · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 0,
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

  it('generates a valid PDF with cover page and board layout pages', async () => {
    const cutPlan = optimizeCutPlan('proj-123', sampleCutRows, catalogMaterials, DEFAULT_CUT_PLAN_CONFIG, 'Cocina Residencial');
    const pdfBytes = await cutPlanPdfExport({
      cutPlan,
      projectName: 'Cocina Residencial',
      customerName: 'Juan Pérez',
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    // Verify PDF header %PDF
    const header = String.fromCharCode(...pdfBytes.slice(0, 4));
    expect(header).toBe('%PDF');

    // Parse with PDFDocument to verify page count (1 cover page + N sheets)
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1 + cutPlan.sheets.length);
  });

  it('throws ValidationError if cutPlan has no sheets', async () => {
    const emptyCutPlan = optimizeCutPlan('proj-empty', [], catalogMaterials);
    await expect(
      cutPlanPdfExport({
        cutPlan: emptyCutPlan,
      }),
    ).rejects.toThrow('El plan de corte no contiene tableros para exportar.');
  });

  // #778 — pdf-lib stamps wall-clock CreationDate/ModDate on every document;
  // two renders of the SAME plan that straddle a wall-clock second boundary
  // used to produce different bytes (CI flake of the byte-exact download
  // comparison in engineering-cutting-demand.spec.ts).
  it('renders byte-identical PDFs for the same plan across a wall-clock second boundary', async () => {
    const cutPlan = {
      ...optimizeCutPlan('proj-778', sampleCutRows, catalogMaterials, DEFAULT_CUT_PLAN_CONFIG, 'Obra 778'),
      generatedAt: '2026-09-17T20:45:12.345Z',
      id: 'cutplan-778-frozen',
    };
    const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

    vi.useFakeTimers({ now: new Date('2026-09-17T20:45:59.900Z') });
    try {
      const beforeBoundary = await cutPlanPdfExport({ cutPlan, projectName: cutPlan.projectName });
      // 200 ms later the wall clock sits in the NEXT second: the exact race
      // between the browser download render and the reference render in CI.
      vi.advanceTimersByTime(200);
      const afterBoundary = await cutPlanPdfExport({ cutPlan, projectName: cutPlan.projectName });
      expect(sha256(afterBoundary)).toBe(sha256(beforeBoundary));

      // updateMetadata: false — load() would otherwise re-stamp ModDate with
      // the (possibly faked) clock before the readback. PDF dates are
      // second-granular, so .345 is serialized as :12.000.
      const doc = await PDFDocument.load(beforeBoundary, { updateMetadata: false });
      expect(doc.getCreationDate()?.toISOString()).toBe('2026-09-17T20:45:12.000Z');
      expect(doc.getModificationDate()?.toISOString()).toBe('2026-09-17T20:45:12.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pins document metadata dates to the explicit dateIso override', async () => {
    const cutPlan = {
      ...optimizeCutPlan('proj-778-override', sampleCutRows, catalogMaterials, DEFAULT_CUT_PLAN_CONFIG, 'Obra 778'),
      generatedAt: '2026-09-17T20:45:12.345Z',
    };
    const bytes = await cutPlanPdfExport({ cutPlan, dateIso: '2026-01-02T03:04:05.000Z' });
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getCreationDate()?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(doc.getModificationDate()?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });
});
