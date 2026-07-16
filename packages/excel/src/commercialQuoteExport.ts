/**
 * Commercial quote Excel writer — client-facing cotización (F030 / issue #36).
 * Presentation only: totals and lines are supplied by the shell (domain-calculated).
 */

import ExcelJS from 'exceljs';
import { ValidationError } from '@muebles/domain';
import { workbookBytes } from './optimizerExport';

export type CommercialQuoteLine = {
  readonly moduleCode: string;
  readonly moduleName: string;
  readonly quantity: number;
  readonly optionsSummary: string;
};

export type CommercialQuoteTotals = {
  readonly materialsCost: number;
  readonly edgeTotal: number;
  readonly hardwareTotal: number;
  readonly laborModular: number;
  readonly laborFixedCost: number;
  readonly directCost: number;
  readonly marginFactor: number;
  readonly salePrice: number;
};

export type CommercialQuoteExportInput = {
  readonly projectName: string;
  readonly customerName: string;
  readonly currency: string;
  readonly statusLabel: string;
  /** Display date (already formatted or ISO). */
  readonly dateLabel: string;
  readonly items: readonly CommercialQuoteLine[];
  readonly totals: CommercialQuoteTotals;
  /** True when prices come from priceSnapshot (quoted/accepted). */
  readonly pricesFrozen: boolean;
};

const SHEET_NAME = 'Cotización';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF4338CA' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 11,
  color: { argb: 'FFFFFFFF' },
  name: 'Calibri',
};

const TITLE_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 16,
  color: { argb: 'FF1E1B4B' },
  name: 'Calibri',
};

const LABEL_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 11,
  color: { argb: 'FF374151' },
  name: 'Calibri',
};

const DATA_FONT: Partial<ExcelJS.Font> = {
  size: 11,
  color: { argb: 'FF111827' },
  name: 'Calibri',
};

const LINE_HEADERS = [
  'Código',
  'Mueble',
  'Cantidad',
  'Opciones',
] as const;

/**
 * Build a simple client-facing quote workbook.
 */
export async function commercialQuoteExport(
  input: CommercialQuoteExportInput,
): Promise<Uint8Array> {
  if (input.items.length === 0) {
    throw new ValidationError('no hay muebles en la cotización', {
      field: 'items',
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'muebles';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 8 }],
  });

  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 32;
  sheet.getColumn(3).width = 12;
  sheet.getColumn(4).width = 48;
  sheet.getColumn(5).width = 16;

  // Title block
  sheet.mergeCells('A1:D1');
  const title = sheet.getCell('A1');
  title.value = 'Cotización comercial';
  title.font = TITLE_FONT;

  sheet.getCell('A3').value = 'Proyecto / nombre';
  sheet.getCell('A3').font = LABEL_FONT;
  sheet.getCell('B3').value = input.projectName;
  sheet.getCell('B3').font = DATA_FONT;

  sheet.getCell('A4').value = 'Cliente';
  sheet.getCell('A4').font = LABEL_FONT;
  sheet.getCell('B4').value = input.customerName;
  sheet.getCell('B4').font = DATA_FONT;

  sheet.getCell('C3').value = 'Fecha';
  sheet.getCell('C3').font = LABEL_FONT;
  sheet.getCell('D3').value = input.dateLabel;
  sheet.getCell('D3').font = DATA_FONT;

  sheet.getCell('C4').value = 'Moneda';
  sheet.getCell('C4').font = LABEL_FONT;
  sheet.getCell('D4').value = input.currency;
  sheet.getCell('D4').font = DATA_FONT;

  sheet.getCell('A5').value = 'Estado';
  sheet.getCell('A5').font = LABEL_FONT;
  sheet.getCell('B5').value = input.statusLabel;
  sheet.getCell('B5').font = DATA_FONT;

  if (input.pricesFrozen) {
    sheet.getCell('C5').value = 'Precios';
    sheet.getCell('C5').font = LABEL_FONT;
    sheet.getCell('D5').value = 'Congelados (snapshot)';
    sheet.getCell('D5').font = DATA_FONT;
  }

  // Line items table
  const headerRowIndex = 7;
  const headerRow = sheet.getRow(headerRowIndex);
  LINE_HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.height = 18;

  input.items.forEach((line, index) => {
    const row = sheet.getRow(headerRowIndex + 1 + index);
    row.getCell(1).value = line.moduleCode;
    row.getCell(2).value = line.moduleName;
    row.getCell(3).value = line.quantity;
    row.getCell(4).value = line.optionsSummary || '—';
    for (let c = 1; c <= 4; c++) {
      row.getCell(c).font = DATA_FONT;
    }
    row.getCell(3).alignment = { horizontal: 'right' };
    row.height = 16;
  });

  // Totals block
  const totalsStart = headerRowIndex + 1 + input.items.length + 2;
  const t = input.totals;
  const totalRows: [string, number | string, boolean?][] = [
    ['Materiales', t.materialsCost, true],
    ['Cantos', t.edgeTotal, true],
    ['Herrajes', t.hardwareTotal, true],
    ['MO modular', t.laborModular, true],
    ['MO fija', t.laborFixedCost, true],
    ['Costo directo', t.directCost, true],
    ['Factor margen', t.marginFactor, false],
    ['Precio de venta', t.salePrice, true],
  ];

  sheet.getCell(`A${totalsStart}`).value = 'Totales';
  sheet.getCell(`A${totalsStart}`).font = TITLE_FONT;

  totalRows.forEach(([label, value, isMoney], i) => {
    const r = totalsStart + 1 + i;
    sheet.getCell(`A${r}`).value = label;
    sheet.getCell(`A${r}`).font =
      label === 'Precio de venta' ? { ...LABEL_FONT, bold: true } : LABEL_FONT;
    const cell = sheet.getCell(`B${r}`);
    cell.value = value;
    cell.font = DATA_FONT;
    cell.alignment = { horizontal: 'right' };
    if (isMoney) {
      cell.numFmt = '#,##0.00';
    } else {
      cell.numFmt = '0.00';
    }
    if (label === 'Precio de venta') {
      cell.font = { ...DATA_FONT, bold: true, size: 12 };
    }
  });

  const raw = await workbook.xlsx.writeBuffer();
  return workbookBytes(raw as ArrayBuffer | Uint8Array);
}
