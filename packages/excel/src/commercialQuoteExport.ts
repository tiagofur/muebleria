/**
 * Exact commercial quote XLSX writer — client-facing cotización (#642 / 3).
 *
 * Renders ONE shared export model derived exclusively from an exact
 * QuoteRevision + commercialSnapshot (frozen identity, lines, units, totals).
 * The same model feeds the PDF renderer; presentation rules live here, never
 * commercial joins. Client-facing policy: sale amounts only — the workshop
 * cost stack (materials/edge/hardware/labor/direct cost/margin) is never
 * written, even for cost-visible actors.
 */

import ExcelJS from 'exceljs';
import { ValidationError } from '@granete/domain';
import { workbookBytes } from './optimizerExport';

/**
 * Frozen per-unit configuration of one exported line. Order is the snapshot's
 * own unit order; distinct configurations between units of the same line are
 * preserved (never merged into a single pretended-identical summary).
 */
export type ExactCommercialQuoteExportUnit = {
  readonly furnitureInstanceId: string;
  readonly lifecycleStatusLabel: string;
  /** `${w}×${h}×${d} mm` or null when the frozen parameters carry no dims. */
  readonly dimensionsLabel: string | null;
  /** Frozen `GroupLabel: ChoiceLabel` pairs joined with `; `. */
  readonly optionsSummary: string;
};

export type ExactCommercialQuoteExportLine = {
  readonly quoteLineId: string;
  readonly moduleCode: string;
  readonly moduleName: string;
  /** Commercial quantity of the line (snapshot truth, not unit count). */
  readonly quantity: number;
  /**
   * Line total sale amount. `null` = not authorized for this actor — a
   * redacted amount must render as absence, never as a misleading 0.
   */
  readonly salePrice: number | null;
  readonly units: readonly ExactCommercialQuoteExportUnit[];
};

/**
 * The single export projection shared by the XLSX and PDF renderers (#642
 * Delivery 3). Every field is frozen commercial truth of one exact revision:
 * mutable Project/catalog/customer state has no representation here.
 */
export type ExactCommercialQuoteExportModel = {
  /** QN — identifies the exported revision in title, status rows and filename. */
  readonly revisionNumber: number;
  readonly statusLabel: string;
  /** Commercial lifecycle date label (acceptedAt → publishedAt → createdAt). */
  readonly dateLabel: string;
  readonly projectName: string;
  readonly customerName: string;
  readonly currency: string;
  /**
   * Frozen snapshot capture instant — owns the workbook metadata timestamps so
   * the document reflects the frozen revision, not the export moment.
   */
  readonly capturedAt: string;
  readonly lines: readonly ExactCommercialQuoteExportLine[];
  /** Client-facing total only (frozen snapshot breakdown salePrice). */
  readonly saleTotal: number;
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

/**
 * One display value per line column. When the units of a line disagree the
 * per-unit values are joined (`U1: …; U2: …`) so distinct frozen
 * configurations are never silently merged.
 */
function perUnitValue(
  units: readonly ExactCommercialQuoteExportUnit[],
  pick: (unit: ExactCommercialQuoteExportUnit) => string | null,
): string {
  const values = units.map(pick);
  if (values.length <= 1) return values[0] ?? '';
  const allEqual = values.every((v) => v === values[0]);
  if (allEqual) return values[0] ?? '';
  return values.map((v, i) => `U${i + 1}: ${v ?? '—'}`).join('  ');
}

/**
 * Build the client-facing workbook for one exact QuoteRevision.
 */
export async function commercialQuoteExport(
  input: ExactCommercialQuoteExportModel,
): Promise<Uint8Array> {
  if (input.lines.length === 0) {
    throw new ValidationError('no hay muebles en la cotización', {
      field: 'items',
    });
  }

  const showLinePrices = input.lines.some((line) => line.salePrice !== null);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Granete';
  // The workbook metadata carries the FROZEN capture instant, not the export
  // moment — the document belongs to the exact revision it reproduces.
  const captured = new Date(input.capturedAt);
  workbook.created = Number.isNaN(captured.getTime()) ? new Date(0) : captured;
  workbook.modified = workbook.created;

  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 8 }],
  });

  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 32;
  sheet.getColumn(3).width = 10;
  sheet.getColumn(4).width = 26;
  sheet.getColumn(5).width = 44;
  sheet.getColumn(6).width = 16;

  // Title block
  sheet.mergeCells('A1:F1');
  const title = sheet.getCell('A1');
  title.value = `Cotización Q${input.revisionNumber}`;
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

  sheet.getCell('A5').value = 'Revisión';
  sheet.getCell('A5').font = LABEL_FONT;
  sheet.getCell('B5').value = `Q${input.revisionNumber}`;
  sheet.getCell('B5').font = DATA_FONT;

  sheet.getCell('C5').value = 'Estado';
  sheet.getCell('C5').font = LABEL_FONT;
  sheet.getCell('D5').value = input.statusLabel;
  sheet.getCell('D5').font = DATA_FONT;

  sheet.getCell('A6').value = 'Precios';
  sheet.getCell('A6').font = LABEL_FONT;
  sheet.getCell('B6').value = `Congelados (revisión Q${input.revisionNumber})`;
  sheet.getCell('B6').font = DATA_FONT;

  // Line items table
  const headerRowIndex = 8;
  const headerRow = sheet.getRow(headerRowIndex);
  const headers = showLinePrices
    ? ['Código', 'Mueble', 'Cant.', 'Medidas', 'Opciones', 'Precio línea']
    : ['Código', 'Mueble', 'Cant.', 'Medidas', 'Opciones'];
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.height = 18;

  input.lines.forEach((line, index) => {
    const row = sheet.getRow(headerRowIndex + 1 + index);
    row.getCell(1).value = line.moduleCode;
    row.getCell(2).value = line.moduleName;
    row.getCell(3).value = line.quantity;
    row.getCell(4).value = perUnitValue(line.units, (u) => u.dimensionsLabel);
    row.getCell(5).value = perUnitValue(line.units, (u) => u.optionsSummary || null);
    if (showLinePrices) {
      row.getCell(6).value = line.salePrice ?? '';
    }
    const lastCol = showLinePrices ? 6 : 5;
    for (let c = 1; c <= lastCol; c++) {
      row.getCell(c).font = DATA_FONT;
    }
    row.getCell(3).alignment = { horizontal: 'right' };
    if (showLinePrices) {
      const priceCell = row.getCell(6);
      priceCell.alignment = { horizontal: 'right' };
      priceCell.numFmt = '#,##0.00';
    }
    row.height = 16;
  });

  // Totals block — client-facing total only.
  const totalsStart = headerRowIndex + 1 + input.lines.length + 2;
  sheet.getCell(`A${totalsStart}`).value = 'Totales';
  sheet.getCell(`A${totalsStart}`).font = TITLE_FONT;

  sheet.getCell(`A${totalsStart + 1}`).value = 'Total (precio de venta)';
  sheet.getCell(`A${totalsStart + 1}`).font = { ...LABEL_FONT, bold: true };
  const totalCell = sheet.getCell(`B${totalsStart + 1}`);
  totalCell.value = input.saleTotal;
  totalCell.font = { ...DATA_FONT, bold: true, size: 12 };
  totalCell.alignment = { horizontal: 'right' };
  totalCell.numFmt = '#,##0.00';

  const raw = await workbook.xlsx.writeBuffer();
  return workbookBytes(raw as ArrayBuffer | Uint8Array);
}
