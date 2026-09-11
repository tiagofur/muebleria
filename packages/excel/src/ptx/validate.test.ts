import { describe, expect, it } from 'vitest';
import type {
  PtxCutRecord,
  PtxDocument,
  PtxPartsReqRecord,
  PtxPatternRecord,
  PtxRecord,
} from './records';
import { buildLabGuillotineDocument } from './fixtures';
import { assertValidPtxDocument, validatePtxDocument } from './validate';

function codes(doc: PtxDocument): string[] {
  return validatePtxDocument(doc).map((issue) => issue.code);
}

function mapCuts(
  doc: PtxDocument,
  cutIndex: number,
  mutate: (cut: PtxCutRecord) => PtxCutRecord,
): PtxDocument {
  return {
    ...doc,
    records: doc.records.map((record) =>
      record.type === 'CUTS' && record.cutIndex === cutIndex ? mutate(record) : record,
    ),
  };
}

function mapRecords(
  doc: PtxDocument,
  mutate: (record: PtxRecord, index: number) => PtxRecord,
): PtxDocument {
  return { ...doc, records: doc.records.map(mutate) };
}

describe('validatePtxDocument', () => {
  it('accepts the canonical lab document', () => {
    expect(validatePtxDocument(buildLabGuillotineDocument())).toEqual([]);
  });

  it('scopes index tables per job (two jobs may repeat part indexes)', () => {
    const doc = buildLabGuillotineDocument();
    const secondJob: readonly PtxRecord[] = doc.records
      .filter((r) => r.type !== 'VECTORS')
      .map((r) =>
        'jobIndex' in r
          ? ({ ...r, jobIndex: 2 } as PtxRecord)
          : r,
      );
    expect(codes({ ...doc, records: [...doc.records, ...secondJob] })).toEqual([]);
  });

  it('detects a deleted cut row as a non-contiguous index table', () => {
    const doc = buildLabGuillotineDocument();
    const mutated = {
      ...doc,
      records: doc.records.filter((r) => !(r.type === 'CUTS' && r.cutIndex === 3)),
    };
    const issues = validatePtxDocument(mutated);
    expect(issues.map((i) => i.code)).toContain('INDEX_NOT_CONTIGUOUS');
    expect(issues[0]?.message).toContain('a row may be missing');
  });

  it('detects duplicate indexes', () => {
    const doc = buildLabGuillotineDocument();
    const mutated = mapCuts(doc, 4, (cut) => ({ ...cut, cutIndex: 1 }));
    expect(codes(mutated)).toContain('DUPLICATE_INDEX');
  });

  it('detects unknown job references from any family', () => {
    const doc = buildLabGuillotineDocument();
    const mutated = mapRecords(doc, (record) =>
      record.type === 'VECTORS' ? { ...record, jobIndex: 2 } : record,
    );
    expect(codes(mutated)).toContain('UNKNOWN_JOB_REFERENCE');
  });

  it('detects broken references to materials, boards, patterns, parts, offcuts and cuts', () => {
    const doc = buildLabGuillotineDocument();

    const badMaterial = mapRecords(doc, (r) =>
      r.type === 'BOARDS' ? { ...r, materialIndex: 9 } : r,
    );
    expect(codes(badMaterial)).toContain('UNKNOWN_MATERIAL_REFERENCE');

    const badBoard = mapRecords(doc, (r) =>
      r.type === 'PATTERNS' ? { ...r, boardIndex: 2 } : r,
    );
    expect(codes(badBoard)).toContain('UNKNOWN_BOARD_REFERENCE');

    const badPattern = mapCuts(doc, 1, (cut) => ({ ...cut, patternIndex: 2 }));
    expect(codes(badPattern)).toContain('UNKNOWN_PATTERN_REFERENCE');

    const badPart = mapCuts(doc, 2, (cut) => ({
      ...cut,
      partReference: { kind: 'part', partIndex: 3 },
    }));
    expect(codes(badPart)).toContain('UNKNOWN_PART_REFERENCE');

    const badOffcut = mapCuts(doc, 5, (cut) => ({
      ...cut,
      partReference: { kind: 'offcut', offcutIndex: 2 },
    }));
    expect(codes(badOffcut)).toContain('UNKNOWN_OFFCUT_REFERENCE');

    const badVectorCut = mapRecords(doc, (r) =>
      r.type === 'VECTORS' ? { ...r, cutIndex: 99 } : r,
    );
    expect(codes(badVectorCut)).toContain('UNKNOWN_CUT_REFERENCE');
  });

  it('rejects invalid magnitudes (dimension must be a positive relative measure)', () => {
    const doc = buildLabGuillotineDocument();
    expect(codes(mapCuts(doc, 1, (c) => ({ ...c, dimension: 0 })))).toContain('INVALID_MAGNITUDE');
    expect(codes(mapCuts(doc, 1, (c) => ({ ...c, dimension: -5 })))).toContain('INVALID_MAGNITUDE');
    expect(
      codes(
        mapRecords(doc, (r) => (r.type === 'MATERIALS' ? { ...r, thickness: 0 } : r)),
      ),
    ).toContain('INVALID_MAGNITUDE');
    expect(
      codes(
        mapRecords(doc, (r) => (r.type === 'MATERIALS' ? { ...r, kerfRip: -1 } : r)),
      ),
    ).toContain('INVALID_MAGNITUDE');
    // Explicit zero kerf is a real override, not an error (empty ≠ zero).
    expect(
      codes(
        mapRecords(doc, (r) => (r.type === 'MATERIALS' ? { ...r, kerfRip: 0 } : r)),
      ),
    ).toEqual([]);
  });

  it('rejects invalid quantities and sequences', () => {
    const doc = buildLabGuillotineDocument();
    expect(
      codes(
        mapRecords(doc, (r) => (r.type === 'PARTS_REQ' ? { ...r, requiredQuantity: 0 } : r)),
      ),
    ).toContain('INVALID_QUANTITY');
    expect(codes(mapCuts(doc, 1, (c) => ({ ...c, sequence: -1 })))).toContain('INVALID_QUANTITY');
    expect(codes(mapCuts(doc, 1, (c) => ({ ...c, repeatQuantity: -1 })))).toContain('INVALID_QUANTITY');
    // SEQUENCE=0 and QTY_RPT=0 are legitimate for a no-pass row (fragment 04).
    expect(codes(mapCuts(doc, 1, (c) => ({ ...c, sequence: 0 })))).toEqual([]);
    expect(codes(mapCuts(doc, 1, (c) => ({ ...c, repeatQuantity: 0 })))).toEqual([]);
  });

  it('rejects function codes outside the documented dictionary', () => {
    const doc = buildLabGuillotineDocument();
    for (const badCode of [10, 50, 89, 100]) {
      expect(codes(mapCuts(doc, 1, (c) => ({ ...c, functionCode: badCode }))), `code ${badCode}`).toContain(
        'INVALID_FUNCTION_CODE',
      );
    }
  });

  it('rejects out-of-subset enums on hand-built records', () => {
    const doc = buildLabGuillotineDocument();
    expect(
      codes(
        mapRecords(doc, (r) => (r.type === 'PATTERNS' ? { ...r, patternType: 5 as unknown as PtxPatternRecord['patternType'] } : r)),
      ),
    ).toContain('INVALID_ENUM_VALUE');
    expect(
      codes(
        mapRecords(doc, (r) => (r.type === 'PARTS_REQ' ? { ...r, grain: 7 as unknown as PtxPartsReqRecord['grain'] } : r)),
      ),
    ).toContain('INVALID_ENUM_VALUE');
    expect(
      codes({ ...doc, header: { ...doc.header, version: 0 } }),
    ).toContain('INVALID_VERSION');
    expect(
      codes({ ...doc, header: { ...doc.header, units: 9 as unknown as PtxDocument['header']['units'] } }),
    ).toContain('INVALID_ENUM_VALUE');
  });

  it('rejects empty or non-ASCII text in required/optional fields', () => {
    const doc = buildLabGuillotineDocument();
    expect(
      codes(mapRecords(doc, (r) => (r.type === 'JOBS' ? { ...r, name: '' } : r))),
    ).toContain('INVALID_TEXT');
    expect(
      codes(mapRecords(doc, (r) => (r.type === 'JOBS' ? { ...r, name: 'CAÑA' } : r))),
    ).toContain('INVALID_TEXT');
    expect(
      codes(mapRecords(doc, (r) => (r.type === 'JOBS' ? { ...r, description: '' } : r))),
    ).toContain('INVALID_TEXT');
  });
});

describe('review R1 — documented FUNCTION codes vs supported by the Granete candidate', () => {
  it('accepts exactly 0/1/2/3 as supported', () => {
    const doc = buildLabGuillotineDocument();
    for (const code of [0, 1, 2, 3]) {
      expect(codes(mapCuts(doc, 1, (c) => ({ ...c, functionCode: code }))), `code ${code}`).toEqual([]);
    }
  });

  it('rejects documented-but-unsupported codes with UNSUPPORTED_FUNCTION_CODE, not as unknown', () => {
    const doc = buildLabGuillotineDocument();
    for (const code of [4, 5, 9, 90, 95, 99]) {
      const issues = validatePtxDocument(mapCuts(doc, 1, (c) => ({ ...c, functionCode: code })));
      const issueCodes = issues.map((i) => i.code);
      expect(issueCodes, `code ${code}`).toContain('UNSUPPORTED_FUNCTION_CODE');
      expect(issueCodes, `code ${code}`).not.toContain('INVALID_FUNCTION_CODE');
      expect(issues[0]?.message, `code ${code}`).toContain('documented but unsupported');
    }
  });

  it('rejects codes outside the documented dictionary (81 tension included) with INVALID_FUNCTION_CODE', () => {
    const doc = buildLabGuillotineDocument();
    for (const code of [10, 50, 81, 100]) {
      const issueCodes = validatePtxDocument(mapCuts(doc, 1, (c) => ({ ...c, functionCode: code }))).map(
        (i) => i.code,
      );
      expect(issueCodes, `code ${code}`).toContain('INVALID_FUNCTION_CODE');
      expect(issueCodes, `code ${code}`).not.toContain('UNSUPPORTED_FUNCTION_CODE');
    }
  });
});

describe('review R2 — non-finite magnitudes must fail validation', () => {
  it('rejects NaN/Infinity magnitudes with INVALID_MAGNITUDE', () => {
    const doc = buildLabGuillotineDocument();
    expect(codes(mapCuts(doc, 1, (c) => ({ ...c, dimension: Number.NaN })))).toContain('INVALID_MAGNITUDE');
    expect(codes(mapCuts(doc, 1, (c) => ({ ...c, dimension: Number.POSITIVE_INFINITY })))).toContain(
      'INVALID_MAGNITUDE',
    );
    expect(
      codes(mapRecords(doc, (r) => (r.type === 'MATERIALS' ? { ...r, thickness: Number.POSITIVE_INFINITY } : r))),
    ).toContain('INVALID_MAGNITUDE');
    expect(
      codes(mapRecords(doc, (r) => (r.type === 'BOARDS' ? { ...r, length: Number.NaN } : r))),
    ).toContain('INVALID_MAGNITUDE');
    expect(
      codes(mapRecords(doc, (r) => (r.type === 'VECTORS' ? { ...r, xEnd: Number.POSITIVE_INFINITY } : r))),
    ).toContain('INVALID_MAGNITUDE');
  });

  it('rejects non-finite optional magnitudes and quantities', () => {
    const doc = buildLabGuillotineDocument();
    expect(
      codes(mapRecords(doc, (r) => (r.type === 'JOBS' ? { ...r, cutTime: Number.NaN } : r))),
    ).toContain('INVALID_MAGNITUDE');
    expect(
      codes(mapRecords(doc, (r) => (r.type === 'MATERIALS' ? { ...r, trimHead: Number.POSITIVE_INFINITY } : r))),
    ).toContain('INVALID_MAGNITUDE');
    // Quantities/index fields must not admit NaN either.
    expect(
      codes(mapRecords(doc, (r) => (r.type === 'PARTS_REQ' ? { ...r, requiredQuantity: Number.NaN } : r))),
    ).toContain('INVALID_QUANTITY');
    expect(codes(mapCuts(doc, 1, (c) => ({ ...c, jobIndex: Number.NaN })))).toContain('INVALID_QUANTITY');
  });

  it('assertValidPtxDocument also fails on non-finite magnitudes', () => {
    const doc = mapCuts(buildLabGuillotineDocument(), 1, (c) => ({ ...c, dimension: Number.NaN }));
    expect(() => assertValidPtxDocument(doc)).toThrow();
  });
});
