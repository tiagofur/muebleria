/**
 * Assembly sheets PDF — one page per module line (PROD-4.1 / #239).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  buildAssemblySheets,
  ITEM_FLOOR_STATUS_LABELS_ES,
  type AssemblySheet,
  type Catalog,
  type Project,
} from '@muebles/domain';

export type AssemblySheetsPdfInput = {
  readonly project: Project;
  readonly catalog: Catalog;
  readonly customerName?: string;
  readonly itemIds?: ReadonlySet<string> | null;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
/** ~12–14 mm margins for A4 workshop print. */
const MARGIN = 42;

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = rgb(0.1, 0.1, 0.12),
): void {
  const safe = text.replace(/[^\x20-\x7EÁÉÍÓÚáéíóúÑñÜü°×·]/g, '?');
  try {
    page.drawText(safe, { x, y, size, font, color });
  } catch {
    page.drawText(safe.replace(/[^\x20-\x7E]/g, '?'), {
      x,
      y,
      size,
      font,
      color,
    });
  }
}

function drawSheetPage(
  page: PDFPage,
  sheet: AssemblySheet,
  projectName: string,
  customerName: string | undefined,
  font: PDFFont,
  fontBold: PDFFont,
  pageIndex: number,
  pageCount: number,
): void {
  let y = PAGE_H - MARGIN;
  drawText(page, 'HOJA DE ARMADO — PRODUCCION', MARGIN, y, fontBold, 14, rgb(0.1, 0.25, 0.45));
  y -= 16;
  drawText(page, `Proyecto: ${projectName}`, MARGIN, y, fontBold, 10);
  y -= 12;
  if (customerName) {
    drawText(page, `Cliente: ${customerName}`, MARGIN, y, font, 9);
    y -= 12;
  }
  drawText(page, `Pagina ${pageIndex + 1} / ${pageCount}`, MARGIN, y, font, 8, rgb(0.4, 0.4, 0.45));
  y -= 20;

  drawText(page, sheet.factoryCode, MARGIN, y, fontBold, 16);
  y -= 16;
  drawText(page, sheet.moduleName, MARGIN, y, font, 12);
  y -= 14;
  drawText(page, `Codigo modulo: ${sheet.moduleCode}`, MARGIN, y, font, 9);
  y -= 12;
  drawText(page, `Cantidad: ${sheet.quantity}`, MARGIN, y, font, 10);
  y -= 12;
  drawText(page, `Medidas: ${sheet.measuresLabel}`, MARGIN, y, font, 10);
  y -= 12;
  drawText(
    page,
    `Estado piso: ${ITEM_FLOOR_STATUS_LABELS_ES[sheet.floorStatus]}`,
    MARGIN,
    y,
    font,
    10,
  );
  y -= 12;
  drawText(
    page,
    `Piezas de tablero (lineas BOM): ${sheet.boardPartLines}`,
    MARGIN,
    y,
    font,
    10,
  );
  y -= 22;

  drawText(page, 'Herrajes para este modulo', MARGIN, y, fontBold, 11);
  y -= 14;
  if (sheet.hardware.length === 0) {
    drawText(page, 'Sin herrajes en el BOM de esta linea.', MARGIN, y, font, 9);
    y -= 12;
  } else {
    for (const h of sheet.hardware) {
      if (y < MARGIN + 40) break;
      drawText(
        page,
        `· ${h.code}  x${h.quantity} ${h.unit}  —  ${h.description.slice(0, 50)}`,
        MARGIN,
        y,
        font,
        9,
      );
      y -= 11;
    }
  }

  y = MARGIN + 20;
  drawText(
    page,
    'Solo lectura de diseno. Avance de piso en app Produccion.',
    MARGIN,
    y,
    font,
    8,
    rgb(0.45, 0.45, 0.5),
  );
}

export async function assemblySheetsPdfExport(
  input: AssemblySheetsPdfInput,
): Promise<Uint8Array> {
  const sheets = buildAssemblySheets(
    input.project,
    input.catalog,
    input.itemIds,
  );
  if (sheets.length === 0) {
    throw new Error('No hay modulos para hojas de armado');
  }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  sheets.forEach((sheet, index) => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawSheetPage(
      page,
      sheet,
      input.project.name,
      input.customerName,
      font,
      fontBold,
      index,
      sheets.length,
    );
  });

  return doc.save();
}
