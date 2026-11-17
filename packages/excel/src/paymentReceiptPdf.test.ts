import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { paymentReceiptLines, paymentReceiptPdfExport, type PaymentReceiptPdfInput } from './paymentReceiptPdf';

const input: PaymentReceiptPdfInput = {
  workshopName: 'Taller Demo',
  projectName: 'Cocina Pérez',
  customerName: 'Ana Pérez',
  payment: {
    id: '0f8e7d6c-0000-4000-8000-000000000001',
    kind: 'deposit',
    amount: 2500,
    currency: 'MXN',
    paymentMethod: 'transfer',
    reference: 'TRF-1',
    receivedAt: '2026-11-10T12:00:00Z',
    recordedAt: '2026-11-10T12:05:00Z',
  },
  balance: { amount: 7500, currency: 'MXN', quoteLabel: 'Q2' },
};

describe('paymentReceiptPdf (#1649)', () => {
  it('describe el pago exacto y el saldo calculado por el servidor', () => {
    const lines = Object.fromEntries(paymentReceiptLines(input));
    expect(lines['Recibo N.º']).toBe('0F8E7D6C');
    expect(lines['Concepto']).toBe('Anticipo');
    expect(lines['Monto']).toBe('$2,500.00 MXN');
    expect(lines['Medio de pago']).toBe('Transferencia');
    expect(lines['Saldo pendiente']).toBe('$7,500.00 MXN (Q2)');
    expect(lines['ANULADO']).toBeUndefined();
  });

  it('marca el pago anulado y el saldo a favor', () => {
    const lines = Object.fromEntries(
      paymentReceiptLines({
        ...input,
        payment: { ...input.payment, void: { reason: 'devuelto', voidedAt: '2026-11-12T00:00:00Z' } },
        balance: { amount: -100, currency: 'MXN', quoteLabel: 'Q2' },
      }),
    );
    expect(lines['ANULADO']).toContain('devuelto');
    expect(lines['Saldo a favor del cliente']).toBe('$100.00 MXN (Q2)');
  });

  it('genera un PDF válido de una página', async () => {
    const bytes = await paymentReceiptPdfExport(input);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
