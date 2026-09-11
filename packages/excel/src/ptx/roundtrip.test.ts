import { describe, expect, it } from 'vitest';
import { buildLabGuillotineDocument } from './fixtures';
import { ptxDocumentDifference, ptxDocumentsEqual } from './equivalence';
import { parsePtxDocumentBytes, parsePtxDocumentText } from './parse';
import { serializePtxDocument, serializePtxDocumentBytes } from './serialize';
import { validatePtxDocument } from './validate';

describe('PTX core roundtrip: records → serialize → bytes → parse → model', () => {
  it('rebuilds an equivalent model from its own bytes', () => {
    const original = buildLabGuillotineDocument();
    const bytes = serializePtxDocumentBytes(original);
    const parsed = parsePtxDocumentBytes(bytes);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentDifference(parsed, original)).toBeNull();
    expect(ptxDocumentsEqual(parsed, original)).toBe(true);
    expect(parsed).toEqual(original);
  });

  it('roundtrips through the text form as well', () => {
    const original = buildLabGuillotineDocument();
    const parsed = parsePtxDocumentText(serializePtxDocument(original));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(parsed).toEqual(original);
  });

  it('roundtrips with LF line endings and higher decimal resolution', () => {
    const original = {
      ...buildLabGuillotineDocument(),
      records: buildLabGuillotineDocument().records.map((record) => {
        if (record.type === 'CUTS' && record.cutIndex === 1) {
          return { ...record, dimension: 462.46 };
        }
        if (record.type === 'MATERIALS') {
          return { ...record, kerfRip: 4.4, kerfCrosscut: 4.4 };
        }
        return record;
      }),
    };
    const parsed = parsePtxDocumentBytes(
      serializePtxDocumentBytes(original, { decimalPlaces: 2, lineEnding: '\n' }),
    );
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(parsed).toEqual(original);
  });

  it('roundtrips quoted text containing commas and quotes', () => {
    const original = {
      ...buildLabGuillotineDocument(),
      header: { ...buildLabGuillotineDocument().header, title: 'GRANETE, "LAB"' },
    };
    const parsed = parsePtxDocumentBytes(serializePtxDocumentBytes(original));
    expect(parsed.header.title).toBe('GRANETE, "LAB"');
    expect(parsed).toEqual(original);
  });
});

describe('PTX core mutation detection (independent readback)', () => {
  // Every mutation below keeps the CSV syntactically parseable: detection
  // must come from validation or equivalence, never from a byte fluke.
  it('detects a modified dimension', () => {
    const original = buildLabGuillotineDocument();
    const mutated = {
      ...original,
      records: original.records.map((r) =>
        r.type === 'CUTS' && r.cutIndex === 2 ? { ...r, dimension: 460 } : r,
      ),
    };
    const parsed = parsePtxDocumentBytes(serializePtxDocumentBytes(mutated));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
    expect(ptxDocumentDifference(parsed, original)).toContain('dimension');
  });

  it('detects a crossed PART_INDEX (both targets exist)', () => {
    const original = buildLabGuillotineDocument();
    const mutated = {
      ...original,
      records: original.records.map((r) => {
        if (r.type !== 'CUTS') return r;
        if (r.cutIndex === 2) return { ...r, partReference: { kind: 'part' as const, partIndex: 2 } };
        if (r.cutIndex === 4) return { ...r, partReference: { kind: 'part' as const, partIndex: 1 } };
        return r;
      }),
    };
    const parsed = parsePtxDocumentBytes(serializePtxDocumentBytes(mutated));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
  });

  it('detects rows physically reordered by SEQUENCE (order encodes the tree)', () => {
    const original = buildLabGuillotineDocument();
    const mutated = {
      ...original,
      records: [...original.records].sort((a, b) => {
        const seq = (r: typeof a) => (r.type === 'CUTS' ? r.sequence : Number.MAX_SAFE_INTEGER);
        return seq(a) - seq(b);
      }),
    };
    const parsed = parsePtxDocumentBytes(serializePtxDocumentBytes(mutated));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
  });

  it('detects a changed pattern TYPE and HEADER units', () => {
    const original = buildLabGuillotineDocument();
    const typeMutated = {
      ...original,
      records: original.records.map((r) => (r.type === 'PATTERNS' ? { ...r, patternType: 1 as const } : r)),
    };
    expect(ptxDocumentsEqual(parsePtxDocumentBytes(serializePtxDocumentBytes(typeMutated)), original)).toBe(false);

    const unitsMutated = { ...original, header: { ...original.header, units: 1 as const } };
    expect(ptxDocumentsEqual(parsePtxDocumentBytes(serializePtxDocumentBytes(unitsMutated)), original)).toBe(false);
  });

  it('detects an extra kerf on the material', () => {
    const original = buildLabGuillotineDocument();
    const mutated = {
      ...original,
      records: original.records.map((r) => (r.type === 'MATERIALS' ? { ...r, kerfRip: 5 } : r)),
    };
    const parsed = parsePtxDocumentBytes(serializePtxDocumentBytes(mutated));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
  });

  it('detects an empty cell turned into an explicit zero', () => {
    const original = buildLabGuillotineDocument();
    const text = serializePtxDocument(original);
    // JOBS line ends with the empty WASTE_PCNT (and CUT_TIME) optional cells.
    const mutatedText = text
      .split('\r\n')
      .map((line) => (line.startsWith('JOBS,') ? line.replace(/,$/, '0') : line))
      .join('\r\n');
    expect(mutatedText).not.toBe(text);
    const parsed = parsePtxDocumentText(mutatedText);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
  });

  it('detects a deleted cut row through validation (index gap)', () => {
    const original = buildLabGuillotineDocument();
    const text = serializePtxDocument(original);
    const mutatedText = text
      .split('\r\n')
      .filter((line) => !line.startsWith('CUTS,1,1,3,'))
      .join('\r\n');
    const parsed = parsePtxDocumentText(mutatedText);
    const issues = validatePtxDocument(parsed);
    expect(issues.map((i) => i.code)).toContain('INDEX_NOT_CONTIGUOUS');
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
  });
});
