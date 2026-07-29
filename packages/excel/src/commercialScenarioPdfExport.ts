/**
 * Commercial scenario PDF writer — client-facing A/B comparison (#137).
 * Compares Option A vs Option B with cost breakdown summary for presentation.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { ValidationError, type QuoteBreakdown } from '@muebles/domain';

export type CommercialScenarioPdfInput = {
  readonly projectName: string;
  readonly customerName?: string;
  readonly currency: string;
  readonly roleName: string;
  readonly optionA: {
    readonly name: string;
    readonly salePrice: number;
    readonly breakdown?: QuoteBreakdown;
  };
  readonly optionB: {
    readonly name: string;
    readonly salePrice: number;
    readonly breakdown?: QuoteBreakdown;
  };
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

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = rgb(0.1, 0.1, 0.12),
): void {
  page.drawText(text, { x, y, size, font, color });
}

export async function commercialScenarioPdfExport(
  input: CommercialScenarioPdfInput,
): Promise<Uint8Array> {
  if (!input.projectName.trim()) {
    throw new ValidationError('Nombre de proyecto invalido', { field: 'projectName' });
  }

  const doc = await PDFDocument.create();
  doc.setTitle(`Comparativa A/B — ${input.projectName}`);
  doc.setCreator('muebles');

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  let y = PAGE_H - MARGIN;

  // Header Banner
  page.drawRectangle({
    x: MARGIN,
    y: y - 44,
    width: CONTENT_W,
    height: 52,
    color: rgb(0.08, 0.18, 0.38),
  });

  drawText(page, 'COTIZACIÓN COMPARATIVA DE ESCENARIOS A/B', MARGIN + 16, y - 20, fontBold, 13, rgb(1, 1, 1));
  drawText(page, `Proyecto: ${input.projectName} | Cliente: ${input.customerName || 'Cliente'}`, MARGIN + 16, y - 36, font, 9, rgb(0.85, 0.9, 0.98));

  y -= 65;

  // Group Badge
  drawText(page, `Variación comparada: ${input.roleName}`, MARGIN, y, fontBold, 11, rgb(0.2, 0.3, 0.5));
  y -= 20;

  // Side-by-side Cards
  const cardW = (CONTENT_W - 20) / 2;

  // Card A
  page.drawRectangle({
    x: MARGIN,
    y: y - 130,
    width: cardW,
    height: 130,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.8, 0.84, 0.9),
    borderWidth: 1,
  });

  drawText(page, 'ESCENARIO A (Actual)', MARGIN + 12, y - 20, fontBold, 10, rgb(0.2, 0.25, 0.35));
  drawText(page, input.optionA.name, MARGIN + 12, y - 36, font, 9, rgb(0.3, 0.3, 0.3));

  drawText(page, 'Precio Final de Venta', MARGIN + 12, y - 75, font, 9, rgb(0.4, 0.4, 0.45));
  drawText(page, money(input.optionA.salePrice, input.currency), MARGIN + 12, y - 96, fontBold, 15, rgb(0.1, 0.2, 0.4));

  // Card B
  const xB = MARGIN + cardW + 20;
  page.drawRectangle({
    x: xB,
    y: y - 130,
    width: cardW,
    height: 130,
    color: rgb(0.94, 0.98, 0.95),
    borderColor: rgb(0.7, 0.88, 0.75),
    borderWidth: 1,
  });

  drawText(page, 'ESCENARIO B (Propuesta)', xB + 12, y - 20, fontBold, 10, rgb(0.1, 0.4, 0.2));
  drawText(page, input.optionB.name, xB + 12, y - 36, font, 9, rgb(0.3, 0.3, 0.3));

  drawText(page, 'Precio Final de Venta', xB + 12, y - 75, font, 9, rgb(0.4, 0.4, 0.45));
  drawText(page, money(input.optionB.salePrice, input.currency), xB + 12, y - 96, fontBold, 15, rgb(0.08, 0.45, 0.2));

  y -= 150;

  // Delta Summary Box
  const delta = input.optionB.salePrice - input.optionA.salePrice;
  const pct = input.optionA.salePrice > 0 ? (delta / input.optionA.salePrice) * 100 : 0;
  const isUp = delta > 0;

  page.drawRectangle({
    x: MARGIN,
    y: y - 48,
    width: CONTENT_W,
    height: 48,
    color: isUp ? rgb(0.99, 0.95, 0.95) : rgb(0.95, 0.99, 0.95),
    borderColor: isUp ? rgb(0.9, 0.7, 0.7) : rgb(0.7, 0.9, 0.7),
    borderWidth: 1,
  });

  const deltaText = `${isUp ? '+' : ''}${money(delta, input.currency)} (${isUp ? '+' : ''}${pct.toFixed(1)}%)`;
  drawText(page, 'Diferencia de inversión:', MARGIN + 16, y - 20, fontBold, 10, isUp ? rgb(0.6, 0.1, 0.1) : rgb(0.1, 0.5, 0.2));
  drawText(page, deltaText, MARGIN + 150, y - 20, fontBold, 12, isUp ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.5, 0.2));
  drawText(
    page,
    isUp ? 'El escenario B representa un incremento en la inversión.' : 'El escenario B representa un ahorro en la inversión.',
    MARGIN + 16,
    y - 36,
    font,
    8,
    rgb(0.4, 0.4, 0.4),
  );

  y -= 70;

  // Detailed Cost Breakdown Table (if breakdowns provided)
  if (input.optionA.breakdown && input.optionB.breakdown) {
    drawText(page, 'Desglose Comparativo de Costos y Componentes', MARGIN, y, fontBold, 11, rgb(0.2, 0.25, 0.35));
    y -= 16;

    // Table Header
    page.drawRectangle({
      x: MARGIN,
      y: y - 16,
      width: CONTENT_W,
      height: 18,
      color: rgb(0.9, 0.92, 0.95),
    });

    drawText(page, 'Componente / Concepto', MARGIN + 6, y - 12, fontBold, 8, rgb(0.2, 0.25, 0.35));
    drawText(page, 'Escenario A', MARGIN + 220, y - 12, fontBold, 8, rgb(0.2, 0.25, 0.35));
    drawText(page, 'Escenario B', MARGIN + 330, y - 12, fontBold, 8, rgb(0.2, 0.25, 0.35));
    drawText(page, 'Diferencia (+/-)', MARGIN + 440, y - 12, fontBold, 8, rgb(0.2, 0.25, 0.35));
    y -= 22;

    const rows = [
      { label: 'Tableros / Placas (Materia prima)', valA: input.optionA.breakdown.boardCost, valB: input.optionB.breakdown.boardCost },
      { label: 'Tapacantos (Metros lineales)', valA: input.optionA.breakdown.edgeCost, valB: input.optionB.breakdown.edgeCost },
      { label: 'Herrajes (Unidades)', valA: input.optionA.breakdown.hardwareCost, valB: input.optionB.breakdown.hardwareCost },
      { label: 'Mano de obra y taller', valA: input.optionA.breakdown.laborCost, valB: input.optionB.breakdown.laborCost },
      { label: 'Total Costos de Producción', valA: input.optionA.breakdown.totalCost, valB: input.optionB.breakdown.totalCost, bold: true },
      { label: 'Precio Final de Venta', valA: input.optionA.breakdown.salePrice, valB: input.optionB.breakdown.salePrice, bold: true, highlight: true },
    ];

    for (const r of rows) {
      if (r.highlight) {
        page.drawRectangle({
          x: MARGIN,
          y: y - 14,
          width: CONTENT_W,
          height: 16,
          color: rgb(0.92, 0.96, 1.0),
        });
      }

      const rowFont = r.bold ? fontBold : font;
      const rowColor = r.highlight ? rgb(0.1, 0.2, 0.4) : rgb(0.2, 0.2, 0.2);
      const rowDelta = r.valB - r.valA;

      drawText(page, r.label, MARGIN + 6, y - 10, rowFont, 8, rowColor);
      drawText(page, money(r.valA, input.currency), MARGIN + 220, y - 10, rowFont, 8, rowColor);
      drawText(page, money(r.valB, input.currency), MARGIN + 330, y - 10, rowFont, 8, rowColor);
      drawText(
        page,
        `${rowDelta > 0 ? '+' : ''}${money(rowDelta, input.currency)}`,
        MARGIN + 440,
        y - 10,
        rowFont,
        8,
        rowDelta > 0 ? rgb(0.6, 0.1, 0.1) : rowDelta < 0 ? rgb(0.1, 0.5, 0.2) : rgb(0.4, 0.4, 0.4),
      );

      y -= 16;
    }
  }

  // Footer Note
  drawText(
    page,
    'Cotización comparativa orientativa para evaluación comercial. Sujeta a confirmación por el taller.',
    MARGIN,
    MARGIN + 10,
    font,
    8,
    rgb(0.5, 0.5, 0.5),
  );

  const bytes = await doc.save();
  return bytes;
}
