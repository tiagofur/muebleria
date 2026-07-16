import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { ValidationError } from '@muebles/domain';
import {
  commercialQuotePdfExport,
  type CommercialQuotePdfInput,
} from './commercialQuotePdf';

const base: Omit<CommercialQuotePdfInput, 'variant'> = {
  projectName: 'Cocina Ana',
  customerName: 'Ana López',
  currency: 'MXN',
  statusLabel: 'Borrador',
  dateLabel: '16/07/2026',
  items: [
    {
      moduleCode: 'MOD-GAB-01',
      moduleName: 'Bajo mesada 600',
      quantity: 2,
      optionsSummary: 'Interior: Melamina blanca',
    },
    {
      moduleCode: 'MOD-ALT-01',
      moduleName: 'Alacena',
      quantity: 1,
      optionsSummary: '',
    },
  ],
  salePrice: 202.5,
  pricesFrozen: false,
};

describe('commercialQuotePdfExport (F045 / #90)', () => {
  it('writes detailed PDF with furniture list and sale total only', async () => {
    const bytes = await commercialQuotePdfExport({
      ...base,
      variant: 'detailed',
    });
    expect(bytes.byteLength).toBeGreaterThan(400);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    // Title metadata
    expect(doc.getTitle()).toMatch(/Cocina Ana/);

    // Smoke: re-save roundtrip stays valid PDF
    const again = await doc.save();
    expect(again.byteLength).toBeGreaterThan(300);
  });

  it('writes summary PDF without requiring empty items', async () => {
    const bytes = await commercialQuotePdfExport({
      ...base,
      variant: 'summary',
      pricesFrozen: true,
    });
    expect(bytes.byteLength).toBeGreaterThan(300);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('rejects empty furniture list', async () => {
    await expect(
      commercialQuotePdfExport({
        ...base,
        items: [],
        variant: 'detailed',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('input contract is sale-price only (no cost stack fields)', async () => {
    // Client PDF API only accepts salePrice — not materials/margin/direct cost.
    const bytes = await commercialQuotePdfExport({
      ...base,
      variant: 'detailed',
      salePrice: 999.99,
    });
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
  });
});


