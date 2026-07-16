/**
 * Optimizer.xlsx writer — serializes ProductionCutRow[] to Plantilla_Optimizer layout.
 */

import ExcelJS from 'exceljs';
import type { ProductionCutRow } from '@muebles/domain';
import { ValidationError } from '@muebles/domain';

/** Row 2 data headers (columns A–J), matching Plantilla_Optimizer.xlsx. */
export const OPTIMIZER_DATA_HEADERS = [
  'Cantidad',
  'Largo',
  'Ancho',
  'Descripcion',
  'Materia Prima',
  'veta',
  'Largo 1',
  'Largo 2',
  'Ancho 1',
  'Ancho 2',
] as const;

const SHEET_NAME = 'Plantilla';

const HEADER_GROUP_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1B5E20' },
};

const HEADER_DATA_FILL: ExcelJS.Fill = {
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

const COLUMN_WIDTHS = [8, 5.33, 6.16, 17, 23.16, 4.5, 6.66, 6.66, 7.5, 7.5];

function styleHeaderCell(
  cell: ExcelJS.Cell,
  fill: ExcelJS.Fill,
  value: string,
): void {
  cell.value = value;
  cell.font = HEADER_FONT;
  cell.fill = fill;
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

/**
 * Normalize exceljs writeBuffer output for Node + browser (no Node Buffer).
 * Browser has no global Buffer — returning Uint8Array keeps web export working.
 */
export function workbookBytes(
  data: ArrayBuffer | Uint8Array | ArrayBufferView,
): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

/**
 * Build Optimizer workbook buffer from cut-list rows (PRD §14 / EXP-01).
 * Headers: row 1 Material/Cubrecanto merges; row 2 data headers; data from row 3.
 * Returns Uint8Array (browser-safe; Node Buffer is not available in Vite web).
 */
export async function optimizerExport(
  rows: readonly ProductionCutRow[],
): Promise<Uint8Array> {
  if (rows.length === 0) {
    throw new ValidationError('no hay piezas de tablero para exportar', {
      field: 'rows',
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'muebles';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  for (let i = 0; i < COLUMN_WIDTHS.length; i++) {
    sheet.getColumn(i + 1).width = COLUMN_WIDTHS[i];
  }

  // Row 1 — group headers (Material A–E, Cubrecanto F–J)
  const row1 = sheet.getRow(1);
  for (let col = 1; col <= 5; col++) {
    styleHeaderCell(row1.getCell(col), HEADER_GROUP_FILL, 'Material');
  }
  for (let col = 6; col <= 10; col++) {
    styleHeaderCell(row1.getCell(col), HEADER_GROUP_FILL, 'Cubrecanto');
  }
  sheet.mergeCells('A1:E1');
  sheet.mergeCells('F1:J1');
  row1.height = 15;

  // Row 2 — column headers A–J
  const row2 = sheet.getRow(2);
  OPTIMIZER_DATA_HEADERS.forEach((header, index) => {
    styleHeaderCell(row2.getCell(index + 1), HEADER_DATA_FILL, header);
  });
  row2.height = 15;

  // Data rows from row 3 — columns A–J only (Optimizer contract)
  rows.forEach((cut, index) => {
    const excelRow = sheet.getRow(index + 3);
    const values: (string | number)[] = [
      cut.quantity,
      cut.lengthMm,
      cut.widthMm,
      cut.description,
      cut.materialName,
      cut.grain,
      cut.L1,
      cut.L2,
      cut.W1,
      cut.W2,
    ];

    values.forEach((value, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1);
      cell.value = value;
      cell.font = DATA_FONT;
      if (colIndex <= 2) {
        cell.alignment = { horizontal: 'right' };
      } else if (colIndex >= 6) {
        cell.alignment = { horizontal: 'center' };
      } else if (colIndex === 5) {
        cell.alignment = { horizontal: 'left' };
      } else {
        cell.alignment = { horizontal: 'left' };
      }
    });
    excelRow.height = 15;
  });

  // F048: workshop reference sheet (does not affect Optimizer columns A–J)
  addReferencesSheet(workbook, rows);

  const raw = await workbook.xlsx.writeBuffer();
  return workbookBytes(raw as ArrayBuffer | Uint8Array);
}

const REF_HEADERS = [
  'Ref etiqueta',
  'Código pieza',
  'Módulo',
  'Pieza',
  'Cantidad',
  'Largo',
  'Ancho',
  'Materia Prima',
  'Encintado',
] as const;

function edgeBandingShort(cut: ProductionCutRow): string {
  const sides: string[] = [];
  if (cut.L1) sides.push('L1');
  if (cut.L2) sides.push('L2');
  if (cut.W1) sides.push('W1');
  if (cut.W2) sides.push('W2');
  return sides.length > 0 ? sides.join('+') : '—';
}

function addReferencesSheet(
  workbook: ExcelJS.Workbook,
  rows: readonly ProductionCutRow[],
): void {
  const sheet = workbook.addWorksheet('Referencias', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const widths = [16, 16, 12, 22, 8, 8, 8, 18, 12];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const header = sheet.getRow(1);
  REF_HEADERS.forEach((title, i) => {
    styleHeaderCell(header.getCell(i + 1), HEADER_DATA_FILL, title);
  });
  header.height = 15;

  rows.forEach((cut, index) => {
    const excelRow = sheet.getRow(index + 2);
    const values: (string | number)[] = [
      cut.labelRef ?? cut.partCode ?? cut.description,
      cut.partCode ?? '',
      cut.moduleCode ?? '',
      cut.partName ?? cut.description,
      cut.quantity,
      cut.lengthMm,
      cut.widthMm,
      cut.materialName,
      edgeBandingShort(cut),
    ];
    values.forEach((value, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1);
      cell.value = value;
      cell.font = DATA_FONT;
    });
    excelRow.height = 15;
  });
}
