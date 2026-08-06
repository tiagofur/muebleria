/**
 * Production order cover PDF (PROD-1.2 pack).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type ProductionCoverPdfInput = {
  readonly projectName: string;
  readonly customerName?: string;
  readonly status: string;
  readonly moduleUnitCount: number;
  readonly cutRowCount: number;
  readonly readyToCut: boolean;
  readonly notes?: string;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = rgb(0.1, 0.1, 0.12),
): void {
  const safe = text.replace(/[^\x20-\x7EÁÉÍÓÚáéíóúÑñÜü°]/g, '?');
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

export async function productionCoverPdfExport(
  input: ProductionCoverPdfInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  drawText(page, 'ORDEN DE PRODUCCION', MARGIN, y, fontBold, 18, rgb(0.1, 0.25, 0.45));
  y -= 28;
  drawText(page, input.projectName, MARGIN, y, fontBold, 14);
  y -= 18;
  if (input.customerName) {
    drawText(page, `Cliente: ${input.customerName}`, MARGIN, y, font, 11);
    y -= 14;
  }
  drawText(page, `Estado: ${input.status}`, MARGIN, y, font, 11);
  y -= 24;

  drawText(page, 'Resumen de fabrica', MARGIN, y, fontBold, 12);
  y -= 16;
  drawText(page, `Modulos (unidades): ${input.moduleUnitCount}`, MARGIN, y, font, 11);
  y -= 14;
  drawText(page, `Piezas de tablero (lineas): ${input.cutRowCount}`, MARGIN, y, font, 11);
  y -= 14;
  drawText(
    page,
    input.readyToCut
      ? 'Checklist: listo para generar pack y cortar'
      : 'Checklist: revisar despiece antes de cortar',
    MARGIN,
    y,
    font,
    11,
  );
  y -= 28;

  drawText(page, 'Contenido tipico del pack ZIP', MARGIN, y, fontBold, 11);
  y -= 14;
  for (const line of [
    '· Optimizer (plan de corte Excel)',
    '· Lista de herrajes',
    '· Etiquetas de pieza',
    '· Resumen de materiales / pliegos',
    '· Elevaciones por muro (si hay layout)',
    '· Despiece PDF',
  ]) {
    drawText(page, line, MARGIN, y, font, 10);
    y -= 12;
  }

  if (input.notes) {
    y -= 12;
    drawText(page, 'Notas', MARGIN, y, fontBold, 11);
    y -= 14;
    drawText(page, input.notes.slice(0, 200), MARGIN, y, font, 10);
  }

  y = MARGIN + 24;
  drawText(
    page,
    'Documento de fabrica — no edita el diseno. Fuente: modulo Produccion.',
    MARGIN,
    y,
    font,
    8,
    rgb(0.4, 0.4, 0.45),
  );

  return doc.save();
}
