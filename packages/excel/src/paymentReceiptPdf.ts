/**
 * #1649 — Recibo de cobro (no fiscal) de UN pago exacto registrado por el
 * servidor. Todo dato viene del ledger (monto, moneda, fecha real, medio,
 * referencia, anulación) y del saldo calculado por el backend; este módulo
 * sólo lo dibuja. Un pago anulado se imprime marcado como ANULADO con su motivo.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface PaymentReceiptPdfInput {
  readonly workshopName: string;
  readonly projectName: string;
  readonly customerName?: string;
  readonly payment: {
    readonly id: string;
    readonly kind: 'deposit' | 'payment';
    readonly amount: number;
    readonly currency: string;
    readonly paymentMethod?: string;
    readonly reference?: string;
    readonly receivedAt: string;
    readonly recordedAt: string;
    readonly void?: { readonly reason: string; readonly voidedAt: string };
  };
  /** Server-computed balance; omitted without an accepted quote. */
  readonly balance?: { readonly amount: number; readonly currency: string; readonly quoteLabel: string };
}

const METHOD_LABELS: Readonly<Record<string, string>> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
  check: 'Cheque',
  other: 'Otro',
};

export function formatReceiptMoney(amount: number, currency: string): string {
  const formatted = Math.abs(amount).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? '-' : ''}$${formatted} ${currency}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** Lines of the receipt, exported for tests and an on-screen preview. */
export function paymentReceiptLines(input: PaymentReceiptPdfInput): readonly (readonly [string, string])[] {
  const p = input.payment;
  const lines: [string, string][] = [
    ['Recibo N.º', p.id.slice(0, 8).toUpperCase()],
    ['Obra', input.projectName],
  ];
  if (input.customerName) lines.push(['Cliente', input.customerName]);
  lines.push(
    ['Concepto', p.kind === 'deposit' ? 'Anticipo' : 'Pago a cuenta'],
    ['Monto', formatReceiptMoney(p.amount, p.currency)],
    ['Fecha del pago', formatDate(p.receivedAt)],
  );
  if (p.paymentMethod) lines.push(['Medio de pago', METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod]);
  if (p.reference) lines.push(['Referencia', p.reference]);
  if (input.balance) {
    lines.push([
      input.balance.amount < 0 ? 'Saldo a favor del cliente' : 'Saldo pendiente',
      `${formatReceiptMoney(Math.abs(input.balance.amount), input.balance.currency)} (${input.balance.quoteLabel})`,
    ]);
  }
  if (p.void) lines.push(['ANULADO', `${formatDate(p.void.voidedAt)}: ${p.void.reason}`]);
  return lines;
}

export async function paymentReceiptPdfExport(input: PaymentReceiptPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Recibo ${input.payment.id.slice(0, 8).toUpperCase()}`);
  const page = doc.addPage([595.28, 420.94]); // A5 apaisado
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.13, 0.15);
  const muted = rgb(0.42, 0.44, 0.48);
  let y = 380;
  page.drawText(input.workshopName, { x: 40, y, size: 16, font: bold, color: ink });
  y -= 22;
  page.drawText('Recibo de cobro', { x: 40, y, size: 12, font, color: muted });
  page.drawText('Documento no fiscal', { x: 430, y, size: 9, font, color: muted });
  y -= 30;
  for (const [label, value] of paymentReceiptLines(input)) {
    const danger = label === 'ANULADO';
    page.drawText(label, { x: 40, y, size: 10, font: bold, color: danger ? rgb(0.7, 0.1, 0.1) : muted });
    page.drawText(value.length > 70 ? `${value.slice(0, 67)}...` : value, { x: 190, y, size: 11, font, color: ink });
    y -= 20;
  }
  y -= 10;
  page.drawText(`Registrado por el sistema el ${formatDate(input.payment.recordedAt)}.`, {
    x: 40,
    y,
    size: 8,
    font,
    color: muted,
  });
  return doc.save();
}
