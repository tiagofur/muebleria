import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { ValidationError, type ModuleLabel } from '@granete/domain';
import { moduleLabelsPdfExport } from './moduleLabelsExport';

const sampleModuleLabel: ModuleLabel = {
  itemId: 'item-101',
  factoryCode: 'GAB-01',
  moduleCode: 'GAB-01',
  moduleName: 'Bajo Fregadero 2P',
  projectId: 'proj-demo',
  projectName: 'Cocina Residencial',
  customerName: 'Cliente Test',
  packageIndex: 1,
  totalPackages: 4,
  unitIndex: 1,
  unitQuantity: 1,
  widthMm: 800,
  heightMm: 850,
  depthMm: 600,
  measuresLabel: '800×850×600 mm',
  spaceName: 'Cocina Principal',
  wallName: 'Muro Norte',
  floorStatus: 'cut',
  boardPartCount: 5,
  hardwareCount: 8,
  revision: '2',
};

describe('moduleLabelsPdfExport (F092)', () => {
  it('writes a valid PDF with 4 cards per page', async () => {
    const bytes = await moduleLabelsPdfExport({
      projectId: 'proj-demo',
      projectName: 'Cocina Residencial',
      customerName: 'Cliente Test',
      labels: [sampleModuleLabel],
      revision: '2',
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('splits more than 4 labels across multiple pages', async () => {
    const labels: ModuleLabel[] = Array.from({ length: 6 }, (_, i) => ({
      ...sampleModuleLabel,
      packageIndex: i + 1,
      totalPackages: 6,
      factoryCode: `GAB-0${i + 1}`,
      moduleName: `Módulo ${i + 1}`,
    }));

    const bytes = await moduleLabelsPdfExport({
      projectId: 'proj-demo',
      projectName: 'Cocina Grande',
      labels,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it('supports URL qrFormat with qrHost', async () => {
    const bytes = await moduleLabelsPdfExport({
      projectId: 'proj-demo',
      projectName: 'Cocina URL QR',
      labels: [sampleModuleLabel],
      qrFormat: 'url',
      qrHost: 'app.muebles.com',
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('throws ValidationError if labels array is empty', async () => {
    await expect(
      moduleLabelsPdfExport({
        projectId: 'proj-demo',
        projectName: 'Vacio',
        labels: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
