import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ValidationError } from '@granete/domain';
import {
  commercialQuoteExport,
  type ExactCommercialQuoteExportModel,
} from './commercialQuoteExport';

const q2Model: ExactCommercialQuoteExportModel = {
  revisionNumber: 2,
  statusLabel: 'Aceptada',
  dateLabel: '11/09/2026',
  projectName: 'Cocina Pedro',
  customerName: 'Pedro Pérez',
  currency: 'MXN',
  capturedAt: '2026-09-10T09:00:00.000Z',
  lines: [
    {
      quoteLineId: '11111111-1111-4111-8111-111111111111',
      moduleCode: 'MOD-GAB-01',
      moduleName: 'Bajo mesada 600',
      quantity: 2,
      salePrice: 405,
      units: [
        {
          furnitureInstanceId: '21111111-1111-4111-8111-111111111111',
          lifecycleStatusLabel: 'Activa',
          dimensionsLabel: '600×720×560 mm',
          optionsSummary: 'Interior: Melamina blanca',
        },
        {
          furnitureInstanceId: '22222222-2222-4222-8222-222222222222',
          lifecycleStatusLabel: 'Activa',
          dimensionsLabel: '600×720×560 mm',
          optionsSummary: 'Interior: Melamina blanca',
        },
      ],
    },
    {
      quoteLineId: '33333333-3333-4333-8333-333333333333',
      moduleCode: 'MOD-ALT-01',
      moduleName: 'Alacena 650',
      quantity: 1,
      salePrice: 0,
      units: [
        {
          furnitureInstanceId: '44444444-4444-4444-8444-444444444444',
          lifecycleStatusLabel: 'Activa',
          dimensionsLabel: '650×720×560 mm',
          optionsSummary: 'Interior: Roble caramelado',
        },
      ],
    },
  ],
  saleTotal: 405,
};

async function loadSheet(bytes: Uint8Array): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet('Cotización');
  expect(sheet).toBeTruthy();
  return sheet!;
}

describe('commercialQuoteExport — exact QuoteRevision model (#642)', () => {
  it('writes the exact revision identity block (QN, status, frozen parties)', async () => {
    const sheet = await loadSheet(await commercialQuoteExport(q2Model));
    expect(sheet.getCell('A1').value).toBe('Cotización Q2');
    expect(sheet.getCell('B3').value).toBe('Cocina Pedro');
    expect(sheet.getCell('B4').value).toBe('Pedro Pérez');
    expect(sheet.getCell('D3').value).toBe('11/09/2026');
    expect(sheet.getCell('D4').value).toBe('MXN');
    expect(sheet.getCell('B5').value).toBe('Q2');
    expect(sheet.getCell('D5').value).toBe('Aceptada');
    expect(sheet.getCell('B6').value).toBe('Congelados (revisión Q2)');
  });

  it('writes exact lines with quantity, dimensions, options and authorized line prices', async () => {
    const sheet = await loadSheet(await commercialQuoteExport(q2Model));
    // header row 8, data rows 9-10
    expect(sheet.getCell('A8').value).toBe('Código');
    expect(sheet.getCell('F8').value).toBe('Precio línea');
    expect(sheet.getCell('A9').value).toBe('MOD-GAB-01');
    expect(sheet.getCell('B9').value).toBe('Bajo mesada 600');
    expect(sheet.getCell('C9').value).toBe(2);
    expect(sheet.getCell('D9').value).toBe('600×720×560 mm');
    expect(sheet.getCell('E9').value).toBe('Interior: Melamina blanca');
    expect(sheet.getCell('F9').value).toBe(405);
    expect(sheet.getCell('A10').value).toBe('MOD-ALT-01');
    expect(sheet.getCell('D10').value).toBe('650×720×560 mm');
    // A legitimate frozen 0.00 line price is preserved — never redacted to blank.
    expect(sheet.getCell('F10').value).toBe(0);
  });

  it('preserves distinct per-unit configurations instead of merging them', async () => {
    const model: ExactCommercialQuoteExportModel = {
      ...q2Model,
      lines: [
        {
          ...q2Model.lines[0]!,
          units: [
            {
              ...q2Model.lines[0]!.units[0]!,
              dimensionsLabel: '600×720×560 mm',
              optionsSummary: 'Interior: Melamina blanca',
            },
            {
              ...q2Model.lines[0]!.units[1]!,
              dimensionsLabel: '650×720×560 mm',
              optionsSummary: 'Interior: Roble caramelado',
            },
          ],
        },
      ],
    };
    const sheet = await loadSheet(await commercialQuoteExport(model));
    expect(sheet.getCell('D9').value).toBe(
      'U1: 600×720×560 mm  U2: 650×720×560 mm',
    );
    expect(sheet.getCell('E9').value).toBe(
      'U1: Interior: Melamina blanca  U2: Interior: Roble caramelado',
    );
  });

  it('omits the line-price column entirely when amounts are not authorized', async () => {
    const model: ExactCommercialQuoteExportModel = {
      ...q2Model,
      lines: q2Model.lines.map((line) => ({ ...line, salePrice: null })),
    };
    const sheet = await loadSheet(await commercialQuoteExport(model));
    expect(sheet.getCell('E8').value).toBe('Opciones');
    expect(sheet.getCell('F8').value).toBeNull();
    // The frozen sale total stays visible (server policy keeps it for the client).
    const totalRow = sheet.getRow(14);
    expect(totalRow.getCell(1).value).toBe('Total (precio de venta)');
    expect(totalRow.getCell(2).value).toBe(405);
  });

  it('never writes the workshop cost stack (client-facing policy)', async () => {
    const sheet = await loadSheet(await commercialQuoteExport(q2Model));
    const labels: string[] = [];
    sheet.eachRow((row) => {
      const value = row.getCell(1).value;
      if (typeof value === 'string') labels.push(value);
    });
    expect(labels).toContain('Total (precio de venta)');
    for (const forbidden of [
      'Materiales',
      'Cantos',
      'Herrajes',
      'MO modular',
      'MO fija',
      'Costo directo',
      'Factor margen',
    ]) {
      expect(labels).not.toContain(forbidden);
    }
  });

  it('fails closed on a revision with no lines', async () => {
    const model: ExactCommercialQuoteExportModel = { ...q2Model, lines: [] };
    await expect(commercialQuoteExport(model)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
