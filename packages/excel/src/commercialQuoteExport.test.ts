import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ValidationError } from '@muebles/domain';
import {
  commercialQuoteExport,
  type CommercialQuoteExportInput,
} from './commercialQuoteExport';

const sample: CommercialQuoteExportInput = {
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
  ],
  totals: {
    materialsCost: 100,
    edgeTotal: 20,
    hardwareTotal: 30,
    laborModular: 0,
    laborFixedCost: 0,
    directCost: 150,
    marginFactor: 1.35,
    salePrice: 202.5,
  },
  pricesFrozen: false,
};

describe('commercialQuoteExport (F030 / #36)', () => {
  it('writes a workbook with header block, lines, and sale price', async () => {
    const bytes = await commercialQuoteExport(sample);
    expect(bytes.byteLength).toBeGreaterThan(500);

    const workbook = new ExcelJS.Workbook();
    // exceljs load accepts Buffer/Uint8Array
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Cotización');
    expect(sheet).toBeTruthy();
    expect(sheet!.getCell('A1').value).toBe('Cotización comercial');
    expect(sheet!.getCell('B3').value).toBe('Cocina Ana');
    expect(sheet!.getCell('B4').value).toBe('Ana López');
    // Line header row 7, first data row 8
    expect(sheet!.getCell('A7').value).toBe('Código');
    expect(sheet!.getCell('A8').value).toBe('MOD-GAB-01');
    expect(sheet!.getCell('C8').value).toBe(2);

    // Find Precio de venta label
    let foundSale = false;
    sheet!.eachRow((row) => {
      if (row.getCell(1).value === 'Precio de venta') {
        expect(row.getCell(2).value).toBe(202.5);
        foundSale = true;
      }
    });
    expect(foundSale).toBe(true);
  });

  it('marks frozen prices when snapshot flag is set', async () => {
    const bytes = await commercialQuoteExport({
      ...sample,
      pricesFrozen: true,
      statusLabel: 'Cotizado',
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Cotización')!;
    expect(sheet.getCell('D5').value).toMatch(/Congelados/);
  });

  it('rejects empty item list', async () => {
    await expect(
      commercialQuoteExport({ ...sample, items: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
