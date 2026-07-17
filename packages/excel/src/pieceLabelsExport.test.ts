import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { ValidationError, type PieceLabel } from '@muebles/domain';
import { pieceLabelsPdfExport } from './pieceLabelsExport';

const sampleLabel: PieceLabel = {
  moduleCode: 'MOD-GAB-01',
  moduleName: 'Gabinete 1 puerta',
  partCode: 'P01',
  description: 'Costado Derecho',
  quantity: 2,
  lengthMm: 720,
  widthMm: 560,
  materialCode: 'TAB-ARA-BLA',
  materialName: 'Arauco Blanco',
  edgeBandCode: 'CAN-05',
  edgeBandName: 'Canto Blanco',
  L1: true,
  L2: true,
  W1: false,
  W2: false,
  edgeBandingInstruction: 'Encintar L1 y L2 con Canto Blanco 0.5 mm (CAN-05)',
};

describe('pieceLabelsPdfExport (F046 / #96)', () => {
  it('writes a valid PDF with at least one page', async () => {
    const bytes = await pieceLabelsPdfExport({
      projectId: 'proj-demo',
      projectName: 'Cocina demo',
      customerName: 'Cliente Test',
      labels: [sampleLabel],
    });
    expect(bytes.byteLength).toBeGreaterThan(100);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('splits many labels across pages', async () => {
    const labels = Array.from({ length: 8 }, (_, i) => ({
      ...sampleLabel,
      description: `Pieza ${i + 1}`,
      partCode: `P${String(i + 1).padStart(2, '0')}`,
    }));
    const bytes = await pieceLabelsPdfExport({
      projectId: 'proj-demo',
      projectName: 'Proyecto grande',
      labels,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it('rejects empty labels', async () => {
    await expect(
      pieceLabelsPdfExport({ projectId: 'p', projectName: 'X', labels: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
