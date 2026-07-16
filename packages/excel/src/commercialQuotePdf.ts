/**
 * Commercial quote PDF writer — client-facing (F045 / #90).
 * Sale price only: never embeds workshop cost stack (even for admin).
 *
 * Variants:
 * - detailed: project header + furniture lines + sale total
 * - summary: project header + sale total only (no furniture list)
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { ValidationError } from '@muebles/domain';
import type { CommercialQuoteLine } from './commercialQuoteExport';

export type CommercialQuotePdfVariant = 'detailed' | 'summary';

export type CommercialQuotePdfInput = {
  readonly projectName: string;
  readonly customerName: string;
  readonly currency: string;
  readonly statusLabel: string;
  readonly dateLabel: string;
  readonly items: readonly CommercialQuoteLine[];
  /** Client-facing total only. */
  readonly salePrice: number;
  readonly pricesFrozen: boolean;
  readonly variant: CommercialQuotePdfVariant;
};

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

function money(n: number, currency: string): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? '-' : ''}$${formatted} ${currency}`;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    const trial = `${current} ${word}`;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      current = trial;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

type DrawCtx = {
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
  y: number;
  doc: PDFDocument;
};

function ensureSpace(ctx: DrawCtx, need: number): void {
  if (ctx.y - need >= MARGIN) return;
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function drawLine(
  ctx: DrawCtx,
  text: string,
  opts: {
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    indent?: number;
  } = {},
): void {
  const size = opts.size ?? 11;
  const font = opts.bold ? ctx.fontBold : ctx.font;
  const color = opts.color ?? rgb(0.12, 0.12, 0.14);
  const indent = opts.indent ?? 0;
  const maxW = CONTENT_W - indent;
  const lines = wrapText(text, font, size, maxW);
  for (const line of lines) {
    ensureSpace(ctx, size + 4);
    ctx.page.drawText(line, {
      x: MARGIN + indent,
      y: ctx.y,
      size,
      font,
      color,
    });
    ctx.y -= size + 4;
  }
}

function drawKeyValue(
  ctx: DrawCtx,
  label: string,
  value: string,
): void {
  ensureSpace(ctx, 16);
  const labelText = `${label}: `;
  const size = 11;
  ctx.page.drawText(labelText, {
    x: MARGIN,
    y: ctx.y,
    size,
    font: ctx.fontBold,
    color: rgb(0.25, 0.28, 0.32),
  });
  const labelW = ctx.fontBold.widthOfTextAtSize(labelText, size);
  const valueLines = wrapText(value, ctx.font, size, CONTENT_W - labelW);
  ctx.page.drawText(valueLines[0] ?? '', {
    x: MARGIN + labelW,
    y: ctx.y,
    size,
    font: ctx.font,
    color: rgb(0.12, 0.12, 0.14),
  });
  ctx.y -= size + 6;
  for (let i = 1; i < valueLines.length; i++) {
    ensureSpace(ctx, size + 4);
    ctx.page.drawText(valueLines[i]!, {
      x: MARGIN + labelW,
      y: ctx.y,
      size,
      font: ctx.font,
      color: rgb(0.12, 0.12, 0.14),
    });
    ctx.y -= size + 4;
  }
}

/**
 * Build a client-facing commercial quote PDF.
 * Client never receives cost/margin internals.
 */
export async function commercialQuotePdfExport(
  input: CommercialQuotePdfInput,
): Promise<Uint8Array> {
  if (input.items.length === 0) {
    throw new ValidationError('no hay muebles en la cotización', {
      field: 'items',
    });
  }

  const doc = await PDFDocument.create();
  doc.setTitle(`Cotización — ${input.projectName}`);
  doc.setCreator('muebles');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const ctx: DrawCtx = {
    page,
    font,
    fontBold,
    y: PAGE_H - MARGIN,
    doc,
  };

  const title =
    input.variant === 'summary'
      ? 'Cotización comercial — Resumen'
      : 'Cotización comercial — Listado';

  drawLine(ctx, title, { size: 18, bold: true, color: rgb(0.12, 0.1, 0.35) });
  ctx.y -= 8;

  drawKeyValue(ctx, 'Proyecto', input.projectName);
  drawKeyValue(ctx, 'Cliente', input.customerName);
  drawKeyValue(ctx, 'Fecha', input.dateLabel);
  drawKeyValue(ctx, 'Moneda', input.currency);
  drawKeyValue(ctx, 'Estado', input.statusLabel);
  if (input.pricesFrozen) {
    drawKeyValue(ctx, 'Precios', 'Congelados (snapshot)');
  }

  ctx.y -= 10;

  if (input.variant === 'detailed') {
    drawLine(ctx, 'Muebles', {
      size: 13,
      bold: true,
      color: rgb(0.12, 0.1, 0.35),
    });
    ctx.y -= 4;

    // Column header
    ensureSpace(ctx, 18);
    const colX = {
      code: MARGIN,
      name: MARGIN + 72,
      qty: MARGIN + 280,
      opts: MARGIN + 320,
    };
    const headerSize = 9;
    ctx.page.drawText('Código', {
      x: colX.code,
      y: ctx.y,
      size: headerSize,
      font: fontBold,
      color: rgb(0.35, 0.37, 0.4),
    });
    ctx.page.drawText('Mueble', {
      x: colX.name,
      y: ctx.y,
      size: headerSize,
      font: fontBold,
      color: rgb(0.35, 0.37, 0.4),
    });
    ctx.page.drawText('Cant.', {
      x: colX.qty,
      y: ctx.y,
      size: headerSize,
      font: fontBold,
      color: rgb(0.35, 0.37, 0.4),
    });
    ctx.page.drawText('Opciones', {
      x: colX.opts,
      y: ctx.y,
      size: headerSize,
      font: fontBold,
      color: rgb(0.35, 0.37, 0.4),
    });
    ctx.y -= 14;
    // rule
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y + 6 },
      end: { x: PAGE_W - MARGIN, y: ctx.y + 6 },
      thickness: 0.5,
      color: rgb(0.75, 0.76, 0.78),
    });

    for (const item of input.items) {
      ensureSpace(ctx, 28);
      const nameLines = wrapText(item.moduleName, font, 10, 200);
      const optLines = wrapText(item.optionsSummary || '—', font, 9, 180);
      const blockLines = Math.max(nameLines.length, optLines.length, 1);

      ctx.page.drawText(item.moduleCode.slice(0, 14), {
        x: colX.code,
        y: ctx.y,
        size: 9,
        font,
        color: rgb(0.12, 0.12, 0.14),
      });
      ctx.page.drawText(String(item.quantity), {
        x: colX.qty,
        y: ctx.y,
        size: 10,
        font,
        color: rgb(0.12, 0.12, 0.14),
      });

      for (let i = 0; i < blockLines; i++) {
        if (i > 0) {
          ctx.y -= 12;
          ensureSpace(ctx, 14);
        }
        if (nameLines[i]) {
          ctx.page.drawText(nameLines[i]!, {
            x: colX.name,
            y: ctx.y,
            size: 10,
            font,
            color: rgb(0.12, 0.12, 0.14),
          });
        }
        if (optLines[i]) {
          ctx.page.drawText(optLines[i]!, {
            x: colX.opts,
            y: ctx.y,
            size: 9,
            font,
            color: rgb(0.3, 0.32, 0.35),
          });
        }
      }
      ctx.y -= 16;
    }
  } else {
    // summary: project-only narrative without furniture breakdown
    const totalQty = input.items.reduce((s, it) => s + it.quantity, 0);
    drawLine(ctx, 'Resumen del proyecto', {
      size: 13,
      bold: true,
      color: rgb(0.12, 0.1, 0.35),
    });
    ctx.y -= 4;
    drawLine(
      ctx,
      `Incluye ${input.items.length} tipo${input.items.length === 1 ? '' : 's'} de mueble` +
        ` (${totalQty} unidad${totalQty === 1 ? '' : 'es'} en total).`,
      { size: 11 },
    );
    drawLine(
      ctx,
      'Este resumen no detalla cada mueble ni sus opciones. Pedí el PDF listado si necesitás el desglose.',
      { size: 10, color: rgb(0.4, 0.42, 0.45) },
    );
  }

  ctx.y -= 16;
  ensureSpace(ctx, 40);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y + 10 },
    end: { x: PAGE_W - MARGIN, y: ctx.y + 10 },
    thickness: 0.8,
    color: rgb(0.55, 0.5, 0.85),
  });

  drawLine(ctx, 'Total (precio de venta)', {
    size: 12,
    bold: true,
    color: rgb(0.12, 0.1, 0.35),
  });
  drawLine(ctx, money(input.salePrice, input.currency), {
    size: 16,
    bold: true,
    color: rgb(0.18, 0.15, 0.45),
  });

  drawLine(
    ctx,
    'Documento comercial para el cliente. No incluye costos internos del taller.',
    { size: 8, color: rgb(0.45, 0.47, 0.5) },
  );

  const bytes = await doc.save();
  return bytes;
}
