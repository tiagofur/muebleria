import { describe, it, expect } from 'vitest';
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
});
