/**
 * Material summary & board sheet estimate PDF generator for Production Pack.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  generateProjectMaterialSummary,
  estimateBoardSheets,
  ValidationError,
  type Catalog,
  type Project,
} from '@granete/domain';

export interface MaterialSummaryPdfInput {
  readonly project: Project;
  readonly catalog: Catalog;
  readonly customerName?: string;
}

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;

function drawText(
  page: PDFPage,
  text: string | undefined | null,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = rgb(0.1, 0.1, 0.12),
): void {
  const str = String(text ?? '');
  page.drawText(str, { x, y, size, font, color });
}

/**
 * Build the section header label for board sheets, deriving the sheet size
 * from the catalog instead of hardcoding a standard size. Handles three cases:
 * - one shared sheet size → "1830 × 2440 mm"
 * - multiple distinct sizes → "tamaños por material" (no single claim)
 * - no board materials / unknown sizes → generic label
 */
export function boardSheetsSectionLabel(sheets: readonly {
  readonly sheetWidthMm: number;
  readonly sheetLengthMm: number;
}[]): string {
  const known = sheets.filter((s) => s.sheetWidthMm > 0 && s.sheetLengthMm > 0);
  if (known.length === 0) return '1. Tableros y Pliegos Estimados';
  const distinct = new Set(known.map((s) => `${s.sheetWidthMm}×${s.sheetLengthMm}`));
  if (distinct.size === 1) {
    const { sheetWidthMm, sheetLengthMm } = known[0]!;
    return `1. Tableros y Pliegos Estimados (${sheetWidthMm} × ${sheetLengthMm} mm)`;
  }
  return '1. Tableros y Pliegos Estimados (tamaños por material)';
}

export async function materialSummaryPdfExport(
  input: MaterialSummaryPdfInput,
): Promise<Uint8Array> {
  const summary = generateProjectMaterialSummary(input.project, input.catalog);
  const sheets = estimateBoardSheets(summary.materials, input.catalog.materials);

  if (summary.materials.length === 0 && summary.hardware.length === 0) {
    throw new ValidationError('no hay materiales ni herrajes en el proyecto', {
      field: 'project',
    });
  }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  // Title & Header
  drawText(page, 'RESUMEN DE MATERIALES Y PLIEGOS', MARGIN, cursorY, fontBold, 14, rgb(0.1, 0.25, 0.45));
  cursorY -= 18;
  drawText(page, `Proyecto: ${input.project.name}`, MARGIN, cursorY, fontBold, 10);
  if (input.customerName) {
    drawText(page, `Cliente: ${input.customerName}`, MARGIN + 260, cursorY, font, 10);
  }
  cursorY -= 14;
  drawText(
    page,
    `Fecha: ${new Date().toLocaleDateString('es-AR')} · Total Área: ${summary.totalAreaM2.toFixed(2)} m² · Herrajes: ${summary.hardware.length} un.`,
    MARGIN,
    cursorY,
    font,
    8,
    rgb(0.35, 0.38, 0.42),
  );
  cursorY -= 20;

  // Section 1: Board Sheets & Materials
  page.drawRectangle({
    x: MARGIN,
    y: cursorY - 1,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 16,
    color: rgb(0.92, 0.94, 0.96),
  });
  drawText(page, boardSheetsSectionLabel(sheets), MARGIN + 6, cursorY + 2, fontBold, 9, rgb(0.1, 0.25, 0.45));
  cursorY -= 22;

  // Table header
  drawText(page, 'Código', MARGIN, cursorY, fontBold, 8);
  drawText(page, 'Material / Tablero', MARGIN + 70, cursorY, fontBold, 8);
  drawText(page, 'Área (m²)', MARGIN + 270, cursorY, fontBold, 8);
  drawText(page, 'Merma %', MARGIN + 350, cursorY, fontBold, 8);
  drawText(page, 'Pliegos Est.', MARGIN + 430, cursorY, fontBold, 8);
  cursorY -= 12;

  page.drawLine({
    start: { x: MARGIN, y: cursorY + 4 },
    end: { x: PAGE_WIDTH - MARGIN, y: cursorY + 4 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  for (const sheet of sheets) {
    drawText(page, sheet.code, MARGIN, cursorY, font, 8);
    drawText(page, sheet.name, MARGIN + 70, cursorY, font, 8);
    drawText(page, `${sheet.areaM2.toFixed(2)} m²`, MARGIN + 270, cursorY, font, 8);
    drawText(page, `${sheet.wastePercent}%`, MARGIN + 350, cursorY, font, 8);
    drawText(page, `${sheet.estimatedSheets} pliego${sheet.estimatedSheets > 1 ? 's' : ''}`, MARGIN + 430, cursorY, fontBold, 8, rgb(0.1, 0.45, 0.2));
    cursorY -= 14;
  }
  if (sheets.length === 0) {
    drawText(page, 'Sin piezas de tablero.', MARGIN, cursorY, font, 8, rgb(0.5, 0.5, 0.5));
    cursorY -= 14;
  }
  cursorY -= 16;

  // Section 2: Edge Banding / Cantos
  page.drawRectangle({
    x: MARGIN,
    y: cursorY - 1,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 16,
    color: rgb(0.92, 0.94, 0.96),
  });
  drawText(page, '2. Cantos y Cintillas (Metros Lineales)', MARGIN + 6, cursorY + 2, fontBold, 9, rgb(0.1, 0.25, 0.45));
  cursorY -= 22;

  drawText(page, 'Código', MARGIN, cursorY, fontBold, 8);
  drawText(page, 'Nombre del Canto', MARGIN + 70, cursorY, fontBold, 8);
  drawText(page, 'Metros Lineales (mL)', MARGIN + 270, cursorY, fontBold, 8);
  cursorY -= 12;

  page.drawLine({
    start: { x: MARGIN, y: cursorY + 4 },
    end: { x: PAGE_WIDTH - MARGIN, y: cursorY + 4 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  for (const edge of summary.edges) {
    drawText(page, edge.code, MARGIN, cursorY, font, 8);
    drawText(page, edge.name, MARGIN + 70, cursorY, font, 8);
    drawText(page, `${edge.edgeMl.toFixed(2)} mL`, MARGIN + 270, cursorY, font, 8);
    cursorY -= 14;
  }
  if (summary.edges.length === 0) {
    drawText(page, 'Sin cantos asignados.', MARGIN, cursorY, font, 8, rgb(0.5, 0.5, 0.5));
    cursorY -= 14;
  }
  cursorY -= 16;

  // Section 3: Hardware
  page.drawRectangle({
    x: MARGIN,
    y: cursorY - 1,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 16,
    color: rgb(0.92, 0.94, 0.96),
  });
  drawText(page, '3. Herrajes Consolidados', MARGIN + 6, cursorY + 2, fontBold, 9, rgb(0.1, 0.25, 0.45));
  cursorY -= 22;

  drawText(page, 'Código', MARGIN, cursorY, fontBold, 8);
  drawText(page, 'Descripción del Herraje', MARGIN + 70, cursorY, fontBold, 8);
  drawText(page, 'Cantidad Total', MARGIN + 350, cursorY, fontBold, 8);
  cursorY -= 12;

  page.drawLine({
    start: { x: MARGIN, y: cursorY + 4 },
    end: { x: PAGE_WIDTH - MARGIN, y: cursorY + 4 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  for (const hw of summary.hardware) {
    drawText(page, hw.code ?? '', MARGIN, cursorY, font, 8);
    drawText(page, hw.description ?? '', MARGIN + 70, cursorY, font, 8);
    drawText(page, `${hw.quantity} un.`, MARGIN + 350, cursorY, fontBold, 8);
    cursorY -= 14;
  }
  if (summary.hardware.length === 0) {
    drawText(page, 'Sin herrajes asignados.', MARGIN, cursorY, font, 8, rgb(0.5, 0.5, 0.5));
    cursorY -= 14;
  }

  return doc.save();
}
