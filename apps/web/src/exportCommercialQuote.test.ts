import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildCommercialQuoteExport,
  commercialQuoteFileName,
} from './exportCommercialQuote';
import { exactQ1Fixture, exactQ2Fixture } from './exports/exactCommercialQuoteFixtures';

async function loadSheet(bytes: Uint8Array): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet('Cotización');
  expect(sheet).toBeTruthy();
  return sheet!;
}

function saleTotalCell(sheet: ExcelJS.Worksheet): ExcelJS.Cell {
  let cell: ExcelJS.Cell | undefined;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === 'Total (precio de venta)') {
      cell = row.getCell(2);
    }
  });
  expect(cell).toBeTruthy();
  return cell!;
}

describe('commercialQuoteFileName — exact revision identity (#642)', () => {
  it('names the obra, the frozen customer and the revision number', () => {
    expect(commercialQuoteFileName('Cocina Pedro', 'Pedro Pérez', 2)).toBe(
      'Cotizacion-Cocina-Pedro-Pedro-Pérez-Q2.xlsx',
    );
  });

  it('sanitizes unsafe characters and falls back when identity is empty', () => {
    expect(commercialQuoteFileName('Cocina/Ana: fina', '  ', 1)).toBe(
      'Cotizacion-CocinaAna-fina-Q1.xlsx',
    );
    expect(commercialQuoteFileName('   ', '   ', 3)).toBe(
      'Cotizacion-cotizacion-Q3.xlsx',
    );
  });
});

describe('buildCommercialQuoteExport — exact QuoteRevision authority (#642)', () => {
  it('exports Q1 with the frozen 600 mm lines and Q1 totals', async () => {
    const q1 = exactQ1Fixture();
    const result = await buildCommercialQuoteExport(q1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toBe('Cotizacion-Cocina-Pedro-Pedro-Pérez-Q1.xlsx');
    const sheet = await loadSheet(result.bytes);
    expect(sheet.getCell('A1').value).toBe('Cotización Q1');
    expect(sheet.getCell('B5').value).toBe('Q1');
    expect(sheet.getCell('D9').value).toBe('600×720×560 mm');
    expect(saleTotalCell(sheet).value).toBe(155.25);
  });

  it('exports Q2 with the frozen 650 mm lines and Q2 totals (determinism pair)', async () => {
    const q2 = exactQ2Fixture();
    const result = await buildCommercialQuoteExport(q2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toBe('Cotizacion-Cocina-Pedro-Pedro-Pérez-Q2.xlsx');
    const sheet = await loadSheet(result.bytes);
    expect(sheet.getCell('A1').value).toBe('Cotización Q2');
    expect(sheet.getCell('D5').value).toBe('Aceptada');
    expect(sheet.getCell('D9').value).toBe('650×720×560 mm');
    expect(saleTotalCell(sheet).value).toBe(184.95);
  });

  it('is immune to post-freeze mutations: the same frozen revision exports the same document', async () => {
    // The builder receives ONLY the frozen revision + snapshot — there is no
    // mutable Project/catalog/customer argument to drift. Building the same
    // frozen Q2 twice reproduces the same semantic document; the workbook
    // metadata carries the FROZEN capture instant, not the export moment
    // (zip container timestamps make byte equality impossible by design).
    const q2 = exactQ2Fixture();
    const first = await buildCommercialQuoteExport(q2);
    const second = await buildCommercialQuoteExport(q2);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.fileName).toBe(first.fileName);

    const loadAll = async (bytes: Uint8Array): Promise<ExcelJS.Workbook> => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
      return wb;
    };
    const [wb1, wb2] = await Promise.all([loadAll(first.bytes), loadAll(second.bytes)]);
    expect(wb2.created?.toISOString()).toBe('2026-09-10T09:00:00.000Z');
    const cellsOf = (wb: ExcelJS.Workbook): string[] => {
      const values: string[] = [];
      wb.getWorksheet('Cotización')!.eachRow((row) => {
        row.eachCell({ includeEmpty: true }, (cell) => values.push(String(cell.value ?? '')));
      });
      return values;
    };
    expect(cellsOf(wb2)).toEqual(cellsOf(wb1));
  });

  it('omits line prices when amounts are not authorized but keeps the frozen total', async () => {
    const q2 = exactQ2Fixture();
    const result = await buildCommercialQuoteExport(q2, {
      amountsVisible: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sheet = await loadSheet(result.bytes);
    expect(sheet.getCell('E8').value).toBe('Opciones');
    expect(sheet.getCell('F8').value).toBeNull();
    expect(saleTotalCell(sheet).value).toBe(184.95);
  });

  it('fails closed when the frozen revision has no lines', async () => {
    const q2 = exactQ2Fixture();
    const empty = {
      revision: q2.revision,
      snapshot: { ...q2.snapshot, lines: [], units: [] },
    };
    const result = await buildCommercialQuoteExport(empty);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toMatch(/mueble/i);
    }
  });
});
