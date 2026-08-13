/**
 * Visual cut plan PDF generator for manual workshops (F072).
 *
 * Draws piece layout rectangles over standard board sheets (default 2440×1830 mm)
 * with saw kerf spacing, multi-board pagination, and summary metrics.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ProductionCutRow } from '@muebles/domain';
import { ValidationError } from '@muebles/domain';

export interface CutPreviewPdfInput {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerName?: string;
  readonly cutRows: readonly ProductionCutRow[];
  readonly sheetWidthMm?: number;
  readonly sheetHeightMm?: number;
  readonly sawKerfMm?: number;
}

export interface PlacedPieceInSheet {
  readonly row: ProductionCutRow;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly sheetIndex: number;
}

const DEFAULT_SHEET_W = 2440;
const DEFAULT_SHEET_H = 1830;
const DEFAULT_SAW_KERF = 4;

const PAGE_WIDTH = 841.89; // A4 Landscape
const PAGE_HEIGHT = 595.28;
const MARGIN = 36;

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  maxWidth: number,
): void {
  let clipped = text;
  if (font.widthOfTextAtSize(text, size) > maxWidth) {
    let t = text;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) {
      t = t.slice(0, -1);
    }
    clipped = `${t}…`;
  }
  page.drawText(clipped, {
    x,
    y,
    size,
    font,
    color: rgb(0.1, 0.12, 0.16),
  });
}

/**
 * Multi-board packing algorithm: packs pieces left-to-right, top-to-bottom
 * with saw kerf margins. Opens new sheets as pieces overflow. Pure.
 */
export function packCutRowsIntoSheets(
  cutRows: readonly ProductionCutRow[],
  sheetW: number = DEFAULT_SHEET_W,
  sheetH: number = DEFAULT_SHEET_H,
  sawKerf: number = DEFAULT_SAW_KERF,
): PlacedPieceInSheet[][] {
  const unrolled: ProductionCutRow[] = [];
  for (const row of cutRows) {
    const count = Math.max(1, row.quantity);
    for (let i = 0; i < count; i++) {
      unrolled.push({ ...row, quantity: 1 });
    }
  }

  const sheets: PlacedPieceInSheet[][] = [];
  let currentSheet: PlacedPieceInSheet[] = [];
  let cursorX = sawKerf;
  let cursorY = sawKerf;
  let rowMaxH = 0;

  for (const piece of unrolled) {
    const w = Math.min(piece.lengthMm, sheetW - sawKerf * 2);
    const h = Math.min(piece.widthMm, sheetH - sawKerf * 2);

    if (cursorX + w + sawKerf > sheetW) {
      // Move to next row on current sheet
      cursorX = sawKerf;
      cursorY += rowMaxH + sawKerf;
      rowMaxH = 0;
    }

    if (cursorY + h + sawKerf > sheetH) {
      // Board full — start a new sheet
      if (currentSheet.length > 0) {
        sheets.push(currentSheet);
      }
      currentSheet = [];
      cursorX = sawKerf;
      cursorY = sawKerf;
      rowMaxH = 0;
    }

    currentSheet.push({
      row: piece,
      x: cursorX,
      y: cursorY,
      w,
      h,
      sheetIndex: sheets.length,
    });

    cursorX += w + sawKerf;
    rowMaxH = Math.max(rowMaxH, h);
  }

  if (currentSheet.length > 0) {
    sheets.push(currentSheet);
  }

  return sheets;
}

/**
 * Build vector PDF preview for manual cut plan (F072).
 */
export async function cutPreviewPdfExport(
  input: CutPreviewPdfInput,
): Promise<Uint8Array> {
  if (input.cutRows.length === 0) {
    throw new ValidationError('no hay piezas de corte para generar preview PDF', {
      field: 'cutRows',
    });
  }

  const sheetW = input.sheetWidthMm ?? DEFAULT_SHEET_W;
  const sheetH = input.sheetHeightMm ?? DEFAULT_SHEET_H;
  const kerf = input.sawKerfMm ?? DEFAULT_SAW_KERF;

  const sheets = packCutRowsIntoSheets(input.cutRows, sheetW, sheetH, kerf);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const maxDrawW = PAGE_WIDTH - MARGIN * 2;
  const maxDrawH = PAGE_HEIGHT - MARGIN * 2 - 70; // Leave space for header & footer
  const scale = Math.min(maxDrawW / sheetW, maxDrawH / sheetH);

  const drawW = sheetW * scale;
  const drawH = sheetH * scale;

  const originX = MARGIN + (maxDrawW - drawW) / 2;
  const originY = MARGIN + 40 + (maxDrawH - drawH) / 2;

  let totalPieceAreaM2 = 0;
  for (const r of input.cutRows) {
    totalPieceAreaM2 += (r.lengthMm * r.widthMm * Math.max(1, r.quantity)) / 1e6;
  }

  for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
    const sheetPieces = sheets[sIdx] ?? [];
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    // Header
    let headerY = PAGE_HEIGHT - MARGIN + 4;
    page.drawText(`Plan de Corte Visual (Corte Manual) — ${input.projectName}`, {
      x: MARGIN,
      y: headerY,
      size: 12,
      font: fontBold,
      color: rgb(0.1, 0.12, 0.18),
    });

    if (input.customerName) {
      page.drawText(`Cliente: ${input.customerName}`, {
        x: MARGIN + 380,
        y: headerY,
        size: 9,
        font,
        color: rgb(0.3, 0.35, 0.4),
      });
    }

    headerY -= 14;
    page.drawText(
      `Tablero ${sIdx + 1} de ${sheets.length} (${sheetW} × ${sheetH} mm) · Disco/Kerf: ${kerf} mm · ${sheetPieces.length} piezas`,
      {
        x: MARGIN,
        y: headerY,
        size: 9,
        font,
        color: rgb(0.35, 0.38, 0.45),
      },
    );

    // Outer sheet box
    page.drawRectangle({
      x: originX,
      y: originY,
      width: drawW,
      height: drawH,
      borderColor: rgb(0.2, 0.25, 0.32),
      borderWidth: 2,
      color: rgb(0.96, 0.97, 0.98),
    });

    // Draw pieces
    for (const p of sheetPieces) {
      const px = originX + p.x * scale;
      // Invert Y for PDF coordinate system (origin bottom-left)
      const py = originY + drawH - (p.y + p.h) * scale;
      const pw = p.w * scale;
      const ph = p.h * scale;

      page.drawRectangle({
        x: px,
        y: py,
        width: pw,
        height: ph,
        borderColor: rgb(0.25, 0.3, 0.38),
        borderWidth: 1,
        color: rgb(0.88, 0.92, 0.96),
      });

      if (pw > 28 && ph > 14) {
        const labelText = p.row.partCode || p.row.partName || p.row.description;
        const dimsText = `${p.w}×${p.h}`;

        drawText(page, labelText, px + 3, py + ph - 10, fontBold, 7, pw - 6);
        if (ph > 22) {
          drawText(page, dimsText, px + 3, py + ph - 18, font, 6.5, pw - 6);
        }
      }
    }

    // Legend Footer
    const footerY = MARGIN + 10;
    page.drawText(
      `Totales: ${sheets.length} tableros · Área total piezas: ${totalPieceAreaM2.toFixed(2)} m² · Material dominante: ${input.cutRows[0]?.materialName ?? 'N/A'}`,
      {
        x: MARGIN,
        y: footerY,
        size: 8.5,
        font: fontBold,
        color: rgb(0.2, 0.25, 0.3),
      },
    );
  }

  return doc.save();
}
