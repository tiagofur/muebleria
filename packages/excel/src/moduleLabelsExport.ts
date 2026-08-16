/**
 * Module & package labels PDF writer — workshop and shipping printout (F092).
 *
 * Produces high-visibility A4 printable tags (4 large cards per page) with:
 * - Prominent Bulto numbering (e.g. "BULTO 3 DE 8")
 * - Project & Customer identification
 * - Module Factory Code, Name and Dimensions
 * - Layout Location (Space & Wall placement)
 * - BOM component count summary
 * - Scannable 2D QR code for floor tracking and loading checklist verification
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFImage,
} from 'pdf-lib';
import QRCode from 'qrcode';
import type { ModuleLabel } from '@muebles/domain';
import {
  moduleLabelQrPayload,
  moduleLabelQrPayloadUrl,
  ValidationError,
} from '@muebles/domain';

export interface ModuleLabelsPdfInput {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerName?: string;
  readonly labels: readonly ModuleLabel[];
  /** Production order revision — printed in the header for traceability. */
  readonly revision?: string;
  /** QR form (F091 / D7): 'json' (default) or 'url' deep link. */
  readonly qrFormat?: 'json' | 'url';
  readonly qrHost?: string;
}

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const LABEL_GAP = 12;
const LABELS_PER_PAGE = 4;
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
  color = rgb(0.1, 0.1, 0.12),
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
    color,
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
    width: 256,
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

function drawModuleCard(
  page: PDFPage,
  label: ModuleLabel,
  x: number,
  yTop: number,
  width: number,
  height: number,
  font: PDFFont,
  fontBold: PDFFont,
  qrImage: PDFImage | null,
): void {
  const pad = 10;
  // Outer card background and border
  page.drawRectangle({
    x,
    y: yTop - height,
    width,
    height,
    borderColor: rgb(0.75, 0.78, 0.82),
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });

  // Top header banner (Dark accent background for high contrast)
  const headerH = 26;
  page.drawRectangle({
    x,
    y: yTop - headerH,
    width,
    height: headerH,
    color: rgb(0.12, 0.15, 0.2), // Dark slate
  });

  // Header texts
  const bultoTitle = `BULTO ${label.packageIndex} DE ${label.totalPackages}`;
  page.drawText(bultoTitle, {
    x: x + pad,
    y: yTop - headerH + 7,
    size: 12,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  const projHeader = label.revision
    ? `Obra: ${label.projectName} (Rev ${label.revision})`
    : `Obra: ${label.projectName}`;
  const headerRightW = font.widthOfTextAtSize(projHeader, 9);
  page.drawText(projHeader, {
    x: Math.max(x + pad + 160, x + width - pad - headerRightW),
    y: yTop - headerH + 8,
    size: 9,
    font,
    color: rgb(0.85, 0.88, 0.92),
  });

  // Layout sizing
  const qrSize = qrImage ? Math.min(88, height - headerH - pad * 2) : 0;
  const qrX = x + width - pad - qrSize;
  const maxTextW = width - pad * 2 - (qrSize > 0 ? qrSize + 16 : 0);

  let cursorY = yTop - headerH - pad - 12;

  // Module identification
  const moduleTitle = `${label.factoryCode} — ${label.moduleName}`;
  cursorY -= drawText(page, moduleTitle, x + pad, cursorY, fontBold, 13, maxTextW, rgb(0.08, 0.1, 0.15));

  // Measures (Prominent)
  const dimsText = `Medidas: ${label.measuresLabel}`;
  cursorY -= drawText(page, dimsText, x + pad, cursorY, fontBold, 10.5, maxTextW, rgb(0.15, 0.2, 0.3));

  // Location (Space & Wall)
  const locText = `Ambiente: ${label.spaceName || 'General'}${label.wallName ? ` · Muro: ${label.wallName}` : ''}`;
  cursorY -= drawText(page, locText, x + pad, cursorY, font, 9.5, maxTextW);

  // BOM and Unit summary
  const summaryText = `Unidad ${label.unitIndex} de ${label.unitQuantity} · Piezas: ${label.boardPartCount} · Herrajes: ${label.hardwareCount}`;
  cursorY -= drawText(page, summaryText, x + pad, cursorY, font, 9, maxTextW, rgb(0.3, 0.35, 0.4));

  // Customer line
  if (label.customerName) {
    const custText = `Cliente: ${label.customerName}`;
    drawText(page, custText, x + pad, cursorY, font, 8.5, maxTextW, rgb(0.4, 0.45, 0.5));
  }

  // Draw QR Image on the right
  if (qrImage) {
    const qrY = yTop - height + pad + 14;
    page.drawImage(qrImage, {
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
    });

    const qrTag = 'CONTROL DE DESPACHO';
    const tagW = font.widthOfTextAtSize(qrTag, 6.5);
    const tagX = qrX + (qrSize - tagW) / 2;
    page.drawText(qrTag, {
      x: Math.max(qrX, tagX),
      y: qrY - 9,
      size: 6.5,
      font: fontBold,
      color: rgb(0.35, 0.4, 0.45),
    });
  }
}

/**
 * Build a multi-page PDF of workshop module / package labels (F092).
 */
export async function moduleLabelsPdfExport(
  input: ModuleLabelsPdfInput,
): Promise<Uint8Array> {
  if (input.labels.length === 0) {
    throw new ValidationError('no hay muebles para etiquetar', {
      field: 'labels',
    });
  }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  const chunks: ModuleLabel[][] = [];
  for (let i = 0; i < input.labels.length; i += LABELS_PER_PAGE) {
    chunks.push(input.labels.slice(i, i + LABELS_PER_PAGE));
  }

  for (const chunk of chunks) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const headerY = PAGE_HEIGHT - MARGIN + 4;
    const headerTitle = input.revision
      ? `Etiquetas de Muebles / Bultos — ${input.projectName} · OP rev. ${input.revision}`
      : `Etiquetas de Muebles / Bultos — ${input.projectName}`;

    page.drawText(headerTitle, {
      x: MARGIN,
      y: headerY,
      size: 9,
      font: fontBold,
      color: rgb(0.2, 0.25, 0.3),
    });

    const pageCountNote = `Total bultos obra: ${input.labels.length}`;
    const noteW = font.widthOfTextAtSize(pageCountNote, 8);
    page.drawText(pageCountNote, {
      x: PAGE_WIDTH - MARGIN - noteW,
      y: headerY,
      size: 8,
      font,
      color: rgb(0.4, 0.45, 0.5),
    });

    let currentYTop = PAGE_HEIGHT - MARGIN - 10;

    for (const label of chunk) {
      const qrFields = {
        projectId: label.projectId,
        itemId: label.itemId,
        factoryCode: label.factoryCode,
        moduleCode: label.moduleCode,
        moduleName: label.moduleName,
        packageIndex: label.packageIndex,
        totalPackages: label.totalPackages,
        unitIndex: label.unitIndex,
        unitQuantity: label.unitQuantity,
        widthMm: label.widthMm,
        heightMm: label.heightMm,
        depthMm: label.depthMm,
        revision: input.revision ?? label.revision,
      };

      const payload =
        input.qrFormat === 'url'
          ? moduleLabelQrPayloadUrl(qrFields, { host: input.qrHost })
          : moduleLabelQrPayload(qrFields);

      let qrImage: PDFImage | null = null;
      try {
        const png = await qrPngBytes(payload);
        qrImage = await doc.embedPng(png);
      } catch {
        qrImage = null;
      }

      drawModuleCard(
        page,
        label,
        MARGIN,
        currentYTop,
        contentWidth,
        LABEL_HEIGHT,
        font,
        fontBold,
        qrImage,
      );

      currentYTop -= LABEL_HEIGHT + LABEL_GAP;
    }
  }

  return doc.save();
}
