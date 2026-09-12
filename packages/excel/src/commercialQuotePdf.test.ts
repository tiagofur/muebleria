import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { ValidationError } from '@granete/domain';
import type { ExactCommercialQuoteExportModel } from './commercialQuoteExport';
import {
  commercialQuotePdfExport,
  type CommercialQuotePdfInput,
} from './commercialQuotePdf';

const q2Model: ExactCommercialQuoteExportModel = {
  revisionNumber: 2,
  statusLabel: 'Aceptada',
  dateLabel: '11/09/2026',
  projectName: 'Cocina Pedro',
  customerName: 'Pedro Pérez',
  currency: 'MXN',
  capturedAt: '2026-09-10T09:00:00.000Z',
  lines: [
    {
      quoteLineId: '11111111-1111-4111-8111-111111111111',
      moduleCode: 'MOD-GAB-01',
      moduleName: 'Bajo mesada 600',
      quantity: 2,
      salePrice: 405,
      units: [
        {
          furnitureInstanceId: '21111111-1111-4111-8111-111111111111',
          lifecycleStatusLabel: 'Activa',
          dimensionsLabel: '600×720×560 mm',
          optionsSummary: 'Interior: Melamina blanca',
        },
        {
          furnitureInstanceId: '22222222-2222-4222-8222-222222222222',
          lifecycleStatusLabel: 'Activa',
          dimensionsLabel: '600×720×560 mm',
          optionsSummary: 'Interior: Melamina blanca',
        },
      ],
    },
    {
      quoteLineId: '33333333-3333-4333-8333-333333333333',
      moduleCode: 'MOD-ALT-01',
      moduleName: 'Alacena 650',
      quantity: 1,
      salePrice: 0,
      units: [
        {
          furnitureInstanceId: '44444444-4444-4444-8444-444444444444',
          lifecycleStatusLabel: 'Activa',
          dimensionsLabel: '650×720×560 mm',
          optionsSummary: 'Interior: Roble caramelado',
        },
      ],
    },
  ],
  saleTotal: 405,
};

/**
 * WinAnsi byte decoder: standard fonts encode text in WinAnsi, which differs
 * from latin1 in the 0x80–0x9F range (em-dash, quotes, etc.).
 */
const WINANSI_HIGH: Record<number, string> = {
  0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E',
  0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6',
  0x89: '\u2030', 0x8A: '\u0160', 0x8B: '\u2039', 0x8C: '\u0152',
  0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C',
  0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
  0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A',
  0x9C: '\u0153', 0x9E: '\u017E', 0x9F: '\u0178',
};

function decodeWinAnsi(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += WINANSI_HIGH[byte] ?? String.fromCharCode(byte);
  }
  return out;
}

/**
 * Semantic PDF text extraction (#642 golden policy): pdf-lib writes each
 * drawText call as a hex `<...> Tj` operator inside FLATE-compressed content
 * streams. Inflating every stream and decoding the shown strings yields the
 * document's visible text without external dependencies.
 */
function extractPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const chunks: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw.toString('latin1'))) !== null) {
    const segment = Buffer.from(match[1]!, 'latin1');
    let content: string;
    try {
      content = inflateSync(segment).toString('latin1');
    } catch {
      continue; // non-Flate streams (fonts, images) carry no Tj text
    }
    const textRe = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRe.exec(content)) !== null) {
      const hex = textMatch[1]!.replace(/\s+/g, '');
      chunks.push(decodeWinAnsi(Buffer.from(hex, 'hex')));
    }
  }
  // Adjacent drawText chunks (key labels and their values) concatenate: the
  // content-stream order preserves the visual key/value adjacency.
  return chunks.join('');
}

describe('commercialQuotePdfExport — exact QuoteRevision model (#642)', () => {
  it('identifies the exact revision in title, header and metadata', async () => {
    const input: CommercialQuotePdfInput = { model: q2Model, variant: 'detailed' };
    const bytes = await commercialQuotePdfExport(input);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe('Cotización Q2 — Cocina Pedro — Pedro Pérez');

    const text = extractPdfText(bytes);
    expect(text).toContain('Cotización Q2 — Listado');
    expect(text).toContain('Revisión: Q2');
    expect(text).toContain('Estado: Aceptada');
    expect(text).toContain('Precios: Congelados (revisión Q2)');
    expect(text).toContain('Proyecto: Cocina Pedro');
    expect(text).toContain('Cliente: Pedro Pérez');
    expect(text).toContain('Moneda: MXN');
  });

  it('detailed variant lists frozen lines with quantity, dimensions and options', async () => {
    const bytes = await commercialQuotePdfExport({ model: q2Model, variant: 'detailed' });
    const text = extractPdfText(bytes);
    expect(text).toContain('MOD-GAB-01');
    expect(text).toContain('Bajo mesada 600 (600×720×560 mm)');
    expect(text).toContain('Alacena 650 (650×720×560 mm)');
    expect(text).toContain('Interior: Melamina blanca');
    expect(text).toContain('Interior: Roble caramelado');
    expect(text).toContain('Total (precio de venta)');
    expect(text).toContain('$405.00 MXN');
  });

  it('preserves distinct per-unit configurations instead of merging them', async () => {
    const model: ExactCommercialQuoteExportModel = {
      ...q2Model,
      lines: [
        {
          ...q2Model.lines[0]!,
          units: [
            { ...q2Model.lines[0]!.units[0]!, dimensionsLabel: '600×720×560 mm' },
            { ...q2Model.lines[0]!.units[1]!, dimensionsLabel: '650×720×560 mm' },
          ],
        },
      ],
    };
    const bytes = await commercialQuotePdfExport({ model, variant: 'detailed' });
    const text = extractPdfText(bytes);
    expect(text).toContain('U1: 600×720×560 mm');
    expect(text).toContain('U2: 650×720×560 mm');
  });

  it('summary variant keeps revision identity without the furniture list', async () => {
    const bytes = await commercialQuotePdfExport({ model: q2Model, variant: 'summary' });
    const text = extractPdfText(bytes);
    expect(text).toContain('Cotización Q2 — Resumen');
    expect(text).toContain('Total (precio de venta)');
    expect(text).not.toContain('MOD-GAB-01');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('never renders the workshop cost stack', async () => {
    const bytes = await commercialQuotePdfExport({ model: q2Model, variant: 'detailed' });
    const text = extractPdfText(bytes);
    for (const forbidden of [
      'Materiales',
      'Cantos',
      'Herrajes',
      'MO modular',
      'Costo directo',
      'Factor margen',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('is byte-deterministic for the same exact model', async () => {
    const first = await commercialQuotePdfExport({ model: q2Model, variant: 'detailed' });
    const second = await commercialQuotePdfExport({ model: q2Model, variant: 'detailed' });
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });

  it('rejects a revision with no lines', async () => {
    await expect(
      commercialQuotePdfExport({
        model: { ...q2Model, lines: [] },
        variant: 'detailed',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('renders optional gallery page when photos are provided (CRM Phase 4)', async () => {
    // 1x1 transparent PNG buffer
    const png1x1 = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
      0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120,
      156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68,
      174, 66, 96, 130,
    ]);

    const bytes = await commercialQuotePdfExport({
      model: q2Model,
      variant: 'detailed',
      photos: [
        {
          imageBytes: png1x1,
          caption: 'Foto de cocina terminada',
          isPng: true,
        },
      ],
    });

    const doc = await PDFDocument.load(bytes);
    // Base 1 page + 1 gallery page = 2 pages
    expect(doc.getPageCount()).toBe(2);
  });
});
