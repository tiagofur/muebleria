/**
 * Cut-list (despiece) PDF for production pack (PROD-1.2).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ProductionCutRow } from '@muebles/domain';

export type ProductionDespiecePdfInput = {
  readonly projectName: string;
  readonly customerName?: string;
  readonly rows: readonly ProductionCutRow[];
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;

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

function edgesSummary(row: ProductionCutRow): string {
  const parts: string[] = [];
  if (row.L1) parts.push('L1');
  if (row.L2) parts.push('L2');
  if (row.W1) parts.push('W1');
  if (row.W2) parts.push('W2');
  return parts.length > 0 ? parts.join('+') : '—';
}

export async function productionDespiecePdfExport(
  input: ProductionDespiecePdfInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const header = (): void => {
    drawText(page, 'DESPIECE DE CORTE — PRODUCCION', MARGIN, y, fontBold, 13, rgb(0.1, 0.25, 0.45));
    y -= 14;
    drawText(page, `Proyecto: ${input.projectName}`, MARGIN, y, fontBold, 10);
    y -= 12;
    if (input.customerName) {
      drawText(page, `Cliente: ${input.customerName}`, MARGIN, y, font, 9);
      y -= 12;
    }
    drawText(page, `${input.rows.length} linea(s) de tablero`, MARGIN, y, font, 9);
    y -= 16;
    drawText(page, 'Cant', MARGIN, y, fontBold, 8);
    drawText(page, 'L x A', MARGIN + 30, y, fontBold, 8);
    drawText(page, 'Material', MARGIN + 100, y, fontBold, 8);
    drawText(page, 'Cantos', MARGIN + 280, y, fontBold, 8);
    drawText(page, 'Descripcion', MARGIN + 330, y, fontBold, 8);
    y -= 10;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= 12;
  };

  header();

  for (const row of input.rows) {
    if (y < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      header();
    }
    const desc = (row.description || row.partName || '—').slice(0, 42);
    drawText(page, String(row.quantity), MARGIN, y, font, 8);
    drawText(page, `${row.lengthMm}x${row.widthMm}`, MARGIN + 30, y, font, 8);
    drawText(page, (row.materialName || '—').slice(0, 28), MARGIN + 100, y, font, 8);
    drawText(page, edgesSummary(row), MARGIN + 280, y, font, 8);
    drawText(page, desc, MARGIN + 330, y, font, 7);
    y -= 11;
  }

  return doc.save();
}
