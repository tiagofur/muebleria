import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  buildCommercialQuotePdfExport,
  commercialQuotePdfFileName,
} from './exportCommercialQuotePdf';
import { exactQ1Fixture, exactQ2Fixture } from './exports/exactCommercialQuoteFixtures';

describe('commercialQuotePdfFileName — exact revision identity (#642)', () => {
  it('names the obra, the frozen customer, the revision and the variant', () => {
    expect(
      commercialQuotePdfFileName('Cocina Pedro', 'Pedro Pérez', 2, 'detailed'),
    ).toBe('Cotizacion-Cocina-Pedro-Pedro-Pérez-Q2-listado.pdf');
    expect(
      commercialQuotePdfFileName('Cocina Pedro', 'Pedro Pérez', 2, 'summary'),
    ).toBe('Cotizacion-Cocina-Pedro-Pedro-Pérez-Q2-resumen.pdf');
  });
});

describe('buildCommercialQuotePdfExport — exact QuoteRevision authority (#642)', () => {
  it('exports Q1 with the frozen identity and Q1 revision metadata', async () => {
    const q1 = exactQ1Fixture();
    const result = await buildCommercialQuotePdfExport(q1, {
      variant: 'detailed',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toBe(
      'Cotizacion-Cocina-Pedro-Pedro-Pérez-Q1-listado.pdf',
    );
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getTitle()).toBe('Cotización Q1 — Cocina Pedro — Pedro Pérez');
  });

  it('exports Q2 with the frozen identity and Q2 revision metadata (determinism pair)', async () => {
    const q2 = exactQ2Fixture();
    const result = await buildCommercialQuotePdfExport(q2, {
      variant: 'summary',
      workshopName: 'Carpintería Granete',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toBe(
      'Cotizacion-Cocina-Pedro-Pedro-Pérez-Q2-resumen.pdf',
    );
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getTitle()).toBe('Cotización Q2 — Cocina Pedro — Pedro Pérez');
  });

  it('reproduces byte-identical PDFs from the same frozen revision', async () => {
    const q2 = exactQ2Fixture();
    const first = await buildCommercialQuotePdfExport(q2, { variant: 'detailed' });
    const second = await buildCommercialQuotePdfExport(q2, { variant: 'detailed' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
  });

  it('fails closed when the frozen revision has no lines', async () => {
    const q2 = exactQ2Fixture();
    const empty = {
      revision: q2.revision,
      snapshot: { ...q2.snapshot, lines: [], units: [] },
    };
    const result = await buildCommercialQuotePdfExport(empty, {
      variant: 'detailed',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toMatch(/mueble/i);
    }
  });
});
