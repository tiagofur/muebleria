/**
 * Piece labels PDF writer — workshop printout with edge-banding instruction (F046 / #96).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import QRCode from 'qrcode';
import type { PieceLabel } from '@muebles/domain';
import { pieceLabelQrPayload, ValidationError } from '@muebles/domain';

export interface PieceLabelsPdfInput {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerName?: string;
  readonly labels: readonly PieceLabel[];
}

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const LABEL_GAP = 10;
const LABELS_PER_PAGE = 6;
const LABEL_HEIGHT =
  (PAGE_HEIGHT - MARGIN * 2 - LABEL_GAP * (LABELS_PER_PAGE - 1)) /
  LABELS_PER_PAGE;

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  maxWidth: number,
): number {
  const clipped =
    font.widthOfTextAtSize(text, size) <= maxWidth
      ? text
      : truncateToWidth(text, font, size, maxWidth);
  page.drawText(clipped, {
    x,
    y,
    size,
    font,
    color: rgb(0.1, 0.1, 0.12),
  });
  return size + 3;
}

function truncateToWidth(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

async function qrPngBytes(payload: string): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 128,
    color: { dark: '#111111', light: '#ffffff' },
  });
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function drawLabelCard(
  page: PDFPage,
  label: PieceLabel,
  x: number,
  yTop: number,
  width: number,
  height: number,
  font: PDFFont,
  fontBold: PDFFont,
  qrImage: PDFImage | null,
): void {
  const pad = 8;
  page.drawRectangle({
    x,
    y: yTop - height,
    width,
    height,
    borderColor: rgb(0.55, 0.58, 0.62),
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });

  const qrSize = qrImage ? Math.min(52, height - pad * 2) : 0;
  let cursorY = yTop - pad - 11;
  const maxW = width - pad * 2 - (qrSize > 0 ? qrSize + 8 : 0);
  const title = label.partCode
    ? `${label.partCode} · ${label.description}`
    : label.description;
  cursorY -= drawText(page, title, x + pad, cursorY, fontBold, 10, maxW);
  cursorY -= drawText(
    page,
    `Módulo: ${label.moduleCode} — ${label.moduleName}`,
    x + pad,
    cursorY,
    font,
    8,
    maxW,
  );
  cursorY -= drawText(
    page,
    `Medida: ${label.lengthMm} × ${label.widthMm} mm · Cant: ${label.quantity}`,
    x + pad,
    cursorY,
    font,
    9,
    maxW,
  );
  cursorY -= drawText(
    page,
    `Material: ${label.materialName} (${label.materialCode})`,
    x + pad,
    cursorY,
    font,
    8,
    maxW,
  );
  cursorY -= drawText(
    page,
    `Encintado: ${label.edgeBandingInstruction}`,
    x + pad,
    cursorY,
    fontBold,
    9,
    maxW,
  );
  if (qrImage) {
    page.drawImage(qrImage, {
      x: x + width - pad - qrSize,
      y: yTop - height + pad,
      width: qrSize,
      height: qrSize,
    });
  }
  void cursorY;
}

/**
 * Build a multi-page PDF of workshop piece labels (F046).
 */
export async function pieceLabelsPdfExport(
  input: PieceLabelsPdfInput,
): Promise<Uint8Array> {
  if (input.labels.length === 0) {
    throw new ValidationError('no hay piezas de tablero para etiquetar', {
      field: 'labels',
    });
  }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  const chunks: PieceLabel[][] = [];
  for (let i = 0; i < input.labels.length; i += LABELS_PER_PAGE) {
    chunks.push(input.labels.slice(i, i + LABELS_PER_PAGE));
  }

  for (const chunk of chunks) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let headerY = PAGE_HEIGHT - MARGIN + 4;
    page.drawText(`Etiquetas — ${input.projectName}`, {
      x: MARGIN,
      y: headerY,
      size: 9,
      font: fontBold,
      color: rgb(0.25, 0.28, 0.32),
    });
    if (input.customerName) {
      page.drawText(input.customerName, {
        x: MARGIN + 220,
        y: headerY,
        size: 8,
        font,
        color: rgb(0.35, 0.38, 0.42),
      });
    }

    let top = PAGE_HEIGHT - MARGIN - 8;
    for (const label of chunk) {
      const payload = pieceLabelQrPayload({
        projectId: input.projectId,
        moduleCode: label.moduleCode,
        partCode: label.partCode,
        description: label.description,
        materialCode: label.materialCode,
        lengthMm: label.lengthMm,
        widthMm: label.widthMm,
      });
      let qrImage: PDFImage | null = null;
      try {
        const png = await qrPngBytes(payload);
        qrImage = await doc.embedPng(png);
      } catch {
        qrImage = null;
      }
      drawLabelCard(
        page,
        label,
        MARGIN,
        top,
        contentWidth,
        LABEL_HEIGHT,
        font,
        fontBold,
        qrImage,
      );
      top -= LABEL_HEIGHT + LABEL_GAP;
    }
  }

  return doc.save();
}
