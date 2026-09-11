import { describe, expect, it } from 'vitest';
import { PTX_RECORD_CONTENT_WIDTH } from './records';
import type { PtxDocument, PtxMaterialRecord } from './records';
import { buildLabGuillotineDocument } from './fixtures';
import { PtxFormatError, serializePtxDocument, serializePtxDocumentBytes } from './serialize';

function captureFormatError(fn: () => unknown): PtxFormatError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PtxFormatError) return error;
    throw error;
  }
  throw new Error('expected serializePtxDocument to throw PtxFormatError');
}

function minimalDoc(records: readonly PtxDocument['records'][number][]): PtxDocument {
  return {
    header: { type: 'HEADER', version: 1, title: 'LAB', units: 0, origin: 0, trimType: 1 },
    records,
  };
}

describe('serializePtxDocument', () => {
  it('emits documented column counts per family (full implemented width)', () => {
    const text = serializePtxDocument(buildLabGuillotineDocument());
    const lines = text.split('\r\n').filter((line) => line !== '');
    expect(lines).toHaveLength(14); // HEADER + 13 records

    const byFamily = new Map<string, string[]>();
    for (const line of lines) {
      const cells = line.split(',');
      const family = cells[0]!;
      if (!byFamily.has(family)) byFamily.set(family, cells);
    }
    // cells include the family token, so length = content width + 1.
    for (const [family, cells] of byFamily) {
      expect(cells, family).toHaveLength(PTX_RECORD_CONTENT_WIDTH[family as keyof typeof PTX_RECORD_CONTENT_WIDTH] + 1);
    }
    expect(byFamily.get('HEADER')).toHaveLength(6);
    expect(byFamily.get('JOBS')).toHaveLength(12);
    expect(byFamily.get('PARTS_REQ')).toHaveLength(12);
    expect(byFamily.get('BOARDS')).toHaveLength(9);
    expect(byFamily.get('MATERIALS')).toHaveLength(20);
    expect(byFamily.get('PATTERNS')).toHaveLength(8);
    expect(byFamily.get('CUTS')).toHaveLength(11);
    expect(byFamily.get('OFFCUTS')).toHaveLength(7);
    expect(byFamily.get('VECTORS')).toHaveLength(8);
  });

  it('produces the documented line forms with CRLF and a final line ending', () => {
    const text = serializePtxDocument(buildLabGuillotineDocument());
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.includes('\n\r')).toBe(false);
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('HEADER,1,GRANETE-LAB-NONPRODUCTION,0,0,1');
    expect(lines[1]).toBe('JOBS,1,C4D001,EXAMPLE ONLY,10/09/2026,,LAB,1,,,,');
    expect(lines[2]).toBe('PARTS_REQ,1,1,PART_A,1,450,320,1,0,0,0,1');
    expect(lines[5]).toBe('MATERIALS,1,1,MDF_LAB18,LAB,18,1,4,4,0,0,0,0,0,0,0,3,0,0,0');
    expect(lines[7]).toBe('CUTS,1,1,1,1,1,320,1,0,0,CUT_A');
    // Empty ≠ zero: optional JOBS cells after STATUS are empty, not 0.
    expect(lines[1]).not.toContain('JOBS,1,C4D001,EXAMPLE ONLY,10/09/2026,,LAB,1,0,0,0,0');
  });

  it('is deterministic: same document, same bytes', () => {
    const doc = buildLabGuillotineDocument();
    expect(serializePtxDocument(doc)).toBe(serializePtxDocument(doc));
    expect(serializePtxDocumentBytes(doc)).toEqual(serializePtxDocumentBytes(doc));
  });

  it('emits ASCII-only bytes', () => {
    for (const byte of serializePtxDocumentBytes(buildLabGuillotineDocument())) {
      expect(byte).toBeLessThanOrEqual(0x7f);
    }
  });

  it('keeps explicit zero and absent value different (S06)', () => {
    const base: PtxMaterialRecord = {
      type: 'MATERIALS',
      jobIndex: 1,
      materialIndex: 1,
      code: 'MAT',
      thickness: 18,
      bookQuantity: 1,
      kerfRip: 4,
      kerfCrosscut: 4,
    };
    const withZero = serializePtxDocument(minimalDoc([{ ...base, trimFRip: 0 }]));
    const absent = serializePtxDocument(minimalDoc([base]));
    expect(withZero).toContain('MATERIALS,1,1,MAT,,18,1,4,4,0,');
    expect(absent).toContain('MATERIALS,1,1,MAT,,18,1,4,4,,');
    expect(withZero).not.toBe(absent);
  });

  it('rejects magnitudes not representable at the chosen resolution', () => {
    const doc = buildLabGuillotineDocument();
    const mutated = {
      ...doc,
      records: doc.records.map((r) =>
        r.type === 'CUTS' && r.cutIndex === 1 ? { ...r, dimension: 462.46 } : r,
      ),
    };
    const error = captureFormatError(() => serializePtxDocument(mutated));
    expect(error.code).toBe('MAGNITUDE_NOT_REPRESENTABLE');
    expect(error.field).toBe('CUTS.DIMENSION');
    // Explicit quantization is fine.
    expect(serializePtxDocument(mutated, { decimalPlaces: 2 })).toContain('CUTS,1,1,1,1,1,462.46,');
  });

  it('quotes CSV text only when needed and doubles quotes (S06)', () => {
    const comma = serializePtxDocument(
      minimalDoc([{ type: 'JOBS', jobIndex: 1, name: 'A,B' }]),
    );
    expect(comma).toContain('JOBS,1,"A,B"');
    const quoted = serializePtxDocument(
      minimalDoc([{ type: 'JOBS', jobIndex: 1, name: 'A"B' }]),
    );
    expect(quoted).toContain('JOBS,1,"A""B"');
    const plain = serializePtxDocument(minimalDoc([{ type: 'JOBS', jobIndex: 1, name: 'LAB-1' }]));
    expect(plain).toContain('JOBS,1,LAB-1');
  });

  it('rejects non-ASCII or control text instead of silently rewriting it', () => {
    expect(
      captureFormatError(() =>
        serializePtxDocument({ ...minimalDoc([]), header: { ...minimalDoc([]).header, title: 'Café' } }),
      ).code,
    ).toBe('TEXT_NOT_PRINTABLE_ASCII');
    expect(
      captureFormatError(() =>
        serializePtxDocument({ ...minimalDoc([]), header: { ...minimalDoc([]).header, title: 'A\tB' } }),
      ).code,
    ).toBe('TEXT_NOT_PRINTABLE_ASCII');
  });

  it('rejects empty strings for required and optional text (undefined means absent)', () => {
    expect(
      captureFormatError(() => serializePtxDocument(minimalDoc([{ type: 'JOBS', jobIndex: 1, name: '' }]))).code,
    ).toBe('EMPTY_REQUIRED_TEXT');
    expect(
      captureFormatError(() =>
        serializePtxDocument(minimalDoc([{ type: 'JOBS', jobIndex: 1, name: 'X', description: '' }])),
      ).code,
    ).toBe('EMPTY_OPTIONAL_TEXT');
  });

  it('rejects non-finite and oversized numbers', () => {
    expect(
      captureFormatError(() =>
        serializePtxDocument(minimalDoc([{ type: 'JOBS', jobIndex: Number.NaN, name: 'X' }])),
      ).code,
    ).toBe('NUMBER_NOT_FINITE');
    expect(
      captureFormatError(() =>
        serializePtxDocument(minimalDoc([{ type: 'JOBS', jobIndex: 1e12, name: 'X' }])),
      ).code,
    ).toBe('NUMBER_OUT_OF_RANGE');
  });

  it('formats HEADER.VERSION in the documented plain form (1, 1.08, 1.17)', () => {
    const base = minimalDoc([]);
    expect(serializePtxDocument({ ...base, header: { ...base.header, version: 1.17 } })).toContain('HEADER,1.17,');
    expect(serializePtxDocument({ ...base, header: { ...base.header, version: 1.08 } })).toContain('HEADER,1.08,');
    expect(
      captureFormatError(() =>
        serializePtxDocument({ ...base, header: { ...base.header, version: 1.234 } }),
      ).code,
    ).toBe('VERSION_NOT_REPRESENTABLE');
  });

  it('supports explicit LF line ending', () => {
    const text = serializePtxDocument(minimalDoc([]), { lineEnding: '\n' });
    expect(text).toBe('HEADER,1,LAB,0,0,1\n');
    expect(text.includes('\r')).toBe(false);
  });
});
