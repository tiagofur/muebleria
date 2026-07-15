/**
 * Hardware purchase-list writer — serializes HardwarePurchaseRow[] to XLSX/CSV (EXP-08).
 */

import ExcelJS from 'exceljs';
import type { HardwarePurchaseRow, HardwareUnit } from '@muebles/domain';
import { ValidationError } from '@muebles/domain';

/** Purchase-list column headers (Código → Costo total). */
export const HARDWARE_LIST_HEADERS = [
  'Código',
  'Descripción',
  'Unidad',
  'Cantidad',
  'Costo unit.',
  'Costo total',
] as const;

const SHEET_NAME = 'Herrajes';

const UNIT_LABELS: Record<HardwareUnit, string> = {
  piece: 'Pieza',
  set: 'Juego',
  meter: 'Metro',
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF2563EB' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 11,
  color: { argb: 'FFFFFFFF' },
  name: 'Calibri',
};

const DATA_FONT: Partial<ExcelJS.Font> = {
  size: 11,
  color: { argb: 'FF000000' },
  name: 'Calibri',
};

const COLUMN_WIDTHS = [14, 28, 10, 10, 12, 12];

function unitLabel(unit: HardwareUnit): string {
  return UNIT_LABELS[unit];
}

function styleHeaderCell(cell: ExcelJS.Cell, value: string): void {
  cell.value = value;
  cell.font = HEADER_FONT;
  cell.fill = HEADER_FILL;
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

/**
 * Build a clean purchase-list workbook from aggregated hardware rows (EXP-08).
 */
export async function hardwareListExport(
  rows: readonly HardwarePurchaseRow[],
): Promise<Buffer> {
  if (rows.length === 0) {
    throw new ValidationError('no hay herrajes para exportar', {
      field: 'rows',
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'muebles';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  for (let i = 0; i < COLUMN_WIDTHS.length; i++) {
    sheet.getColumn(i + 1).width = COLUMN_WIDTHS[i];
  }

  const headerRow = sheet.getRow(1);
  HARDWARE_LIST_HEADERS.forEach((header, index) => {
    styleHeaderCell(headerRow.getCell(index + 1), header);
  });
  headerRow.height = 18;

  rows.forEach((row, index) => {
    const excelRow = sheet.getRow(index + 2);
    const values: (string | number)[] = [
      row.code,
      row.description,
      unitLabel(row.unit),
      row.quantity,
      row.costPerUnit,
      row.lineCost,
    ];

    values.forEach((value, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1);
      cell.value = value;
      cell.font = DATA_FONT;
      if (colIndex >= 3) {
        cell.alignment = { horizontal: 'right' };
        if (colIndex >= 4) {
          cell.numFmt = '0.00';
        }
      } else {
        cell.alignment = { horizontal: 'left' };
      }
    });
    excelRow.height = 15;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function csvEscape(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * UTF-8 CSV purchase list (same columns as XLSX) for quick open in sheets.
 */
export function hardwareListExportCsv(
  rows: readonly HardwarePurchaseRow[],
): string {
  if (rows.length === 0) {
    throw new ValidationError('no hay herrajes para exportar', {
      field: 'rows',
    });
  }

  const lines: string[] = [HARDWARE_LIST_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.code),
        csvEscape(row.description),
        csvEscape(unitLabel(row.unit)),
        csvEscape(row.quantity),
        csvEscape(row.costPerUnit),
        csvEscape(row.lineCost),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
