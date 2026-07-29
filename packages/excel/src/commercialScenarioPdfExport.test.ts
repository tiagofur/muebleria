import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { plantillaGabOnlyProject, plantillaCatalogWithModules } from '@muebles/domain/fixtures';
import { calcProjectBreakdown } from '@muebles/domain';
import { commercialScenarioPdfExport } from './commercialScenarioPdfExport';

describe('commercialScenarioPdfExport (Issue #137)', () => {
  it('generates a valid client-facing A/B scenario comparison PDF', async () => {
    const bdA = calcProjectBreakdown(plantillaGabOnlyProject, plantillaCatalogWithModules);

    const bytes = await commercialScenarioPdfExport({
      projectName: plantillaGabOnlyProject.name,
      customerName: 'Cliente Ejemplo',
      currency: 'MXN',
      roleName: 'Material Frentes (FRENTE)',
      optionA: {
        name: 'MDF 18mm Roble Natural',
        salePrice: bdA.salePrice,
        breakdown: bdA,
      },
      optionB: {
        name: 'MDF 18mm Blanco Premium',
        salePrice: bdA.salePrice * 1.15,
        breakdown: {
          ...bdA,
          boardCost: bdA.boardCost * 1.2,
          salePrice: bdA.salePrice * 1.15,
        },
      },
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
