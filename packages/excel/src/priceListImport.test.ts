import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  guessPriceListColumns,
  parseLocaleNumber,
  parsePriceListCsv,
  parsePriceListFile,
} from './priceListImport';

describe('parseLocaleNumber (#1651)', () => {
  it.each([
    ['1234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['$ 1234,5', 1234.5],
    ['1.234.567', 1234567],
    ['1,234,567', 1234567],
    ['850', 850],
    ['12,5', 12.5],
    ['1500 ARS', 1500],
  ])('%s → %s', (raw, expected) => {
    expect(parseLocaleNumber(raw)).toBe(expected);
  });

  it.each(['', 'abc', '12-3', '1,2,3x'])('%s no es número', (raw) => {
    expect(parseLocaleNumber(raw)).toBeNull();
  });
});

describe('parsePriceListCsv (#1651)', () => {
  it('detecta «;», respeta comillas y omite filas vacías', () => {
    const parsed = parsePriceListCsv('﻿Código;Descripción;Precio\nMEL-18;"Melamina; blanca";1.234,56\n\nMDF-15;MDF;980\n');
    expect(parsed.headers).toEqual(['Código', 'Descripción', 'Precio']);
    expect(parsed.rows).toEqual([
      { line: 2, cells: ['MEL-18', 'Melamina; blanca', '1.234,56'] },
      { line: 4, cells: ['MDF-15', 'MDF', '980'] },
    ]);
  });

  it('adivina columnas de código y precio', () => {
    expect(guessPriceListColumns(['Artículo', 'Descripción', 'Precio lista'])).toEqual({ code: 0, price: 2 });
    expect(guessPriceListColumns(['SKU', 'Costo'])).toEqual({ code: 0, price: 1 });
    expect(guessPriceListColumns(['A', 'B'])).toEqual({ code: -1, price: -1 });
  });
});

describe('parsePriceListFile XLSX (#1651)', () => {
  it('lee la primera hoja con la primera fila como encabezado', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lista');
    ws.addRow(['Codigo', 'Precio']);
    ws.addRow(['MEL-18', 1100.5]);
    ws.addRow(['TER-3', '300,25']);
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const parsed = await parsePriceListFile('lista.XLSX', buffer);
    expect(parsed.headers).toEqual(['Codigo', 'Precio']);
    expect(parsed.rows).toEqual([
      { line: 2, cells: ['MEL-18', '1100.5'] },
      { line: 3, cells: ['TER-3', '300,25'] },
    ]);
  });

  it('rechaza formatos desconocidos', async () => {
    await expect(parsePriceListFile('lista.pdf', new ArrayBuffer(0))).rejects.toThrow('Formato no soportado');
  });
});
