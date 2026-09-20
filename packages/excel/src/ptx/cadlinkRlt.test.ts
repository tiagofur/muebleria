import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CADLINK_ERROR_CATALOG_V1,
  cadlinkErrorCatalogEntry,
  classifyCadlinkRlt,
  diagnoseCadlinkRlt,
  parseCadlinkRlt,
  CadlinkRltParseError,
} from './cadlinkRlt';
import { buildGoldenR5Candidate } from './cutPlanPtxGoldenR5';

const GOLDEN_R5_SHA256 = '239e9f7c8989c5f3756545da94a184b7b79aa1bdda797755c065301917201932';

function rlt(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Independent line split of the candidate bytes (CRLF/LF, one trailing newline dropped). */
/** 1-based line accessor for the independent recomputation (fails loud, never invents). */
function lineAt(lines: readonly string[], oneBased: number): string {
  const line = lines[oneBased - 1];
  if (line === undefined) throw new Error(`golden candidate has no line ${oneBased}`);
  return line;
}

function goldenLines(bytes: Uint8Array): readonly string[] {
  const text = new TextDecoder().decode(bytes);
  const split = text.split(/\r\n|\n/);
  return split[split.length - 1] === '' ? split.slice(0, -1) : split;
}

describe('#792 CADLink .RLT parser', () => {
  it('parses success 0/0/0 with CRLF and a final newline', () => {
    expect(parseCadlinkRlt(rlt('0\r\n0\r\n0\r\n'))).toEqual({
      errorNumber: 0,
      fieldNumber: 0,
      lineNumber: 0,
    });
  });

  it('parses with LF and without a final newline', () => {
    expect(parseCadlinkRlt(rlt('0\n0\n0'))).toEqual({
      errorNumber: 0,
      fieldNumber: 0,
      lineNumber: 0,
    });
  });

  it('rejects a missing third value', () => {
    expect(() => parseCadlinkRlt(rlt('0\r\n0\r\n'))).toThrowError(CadlinkRltParseError);
    expect(() => parseCadlinkRlt(rlt('0\r\n0'))).toThrowError(
      expect.objectContaining({ code: 'cadlink_rlt.missing_value' }) as Error,
    );
  });

  it('rejects non-integer values', () => {
    for (const broken of ['x\r\n0\r\n0', '0\r\n1.5\r\n0', '0\r\n 1\r\n0', '0\r\n+1\r\n0', '\r\n0\r\n0']) {
      expect(() => parseCadlinkRlt(rlt(broken)), broken).toThrowError(
        expect.objectContaining({ code: 'cadlink_rlt.value_not_integer' }) as Error,
      );
    }
  });

  it('rejects extra non-empty content', () => {
    expect(() => parseCadlinkRlt(rlt('0\r\n0\r\n0\r\njunk'))).toThrowError(
      expect.objectContaining({ code: 'cadlink_rlt.extra_content' }) as Error,
    );
  });

  it('rejects an extra blank line beyond the single allowed final newline', () => {
    expect(() => parseCadlinkRlt(rlt('0\n0\n0\n\n'))).toThrowError(
      expect.objectContaining({ code: 'cadlink_rlt.extra_content' }) as Error,
    );
  });

  it('rejects a lone CR line ending', () => {
    expect(() => parseCadlinkRlt(rlt('0\r0\n0'))).toThrowError(
      expect.objectContaining({ code: 'cadlink_rlt.line_ending_unsupported' }) as Error,
    );
  });

  it('rejects non-ASCII bytes', () => {
    const bytes = new Uint8Array([0x30, 0x0a, 0xe9, 0x0a, 0x30]);
    expect(() => parseCadlinkRlt(bytes)).toThrowError(
      expect.objectContaining({ code: 'cadlink_rlt.not_ascii' }) as Error,
    );
  });

  it('rejects an empty file', () => {
    expect(() => parseCadlinkRlt(new Uint8Array(0))).toThrowError(
      expect.objectContaining({ code: 'cadlink_rlt.empty' }) as Error,
    );
  });

  it('keeps documented negative environment codes parseable', () => {
    expect(parseCadlinkRlt(rlt('-1\r\n0\r\n0\r\n')).errorNumber).toBe(-1);
  });
});

describe('#792 CADLink error catalog V1', () => {
  it('contains exactly the documented codes with unique numbers', () => {
    const numbers = CADLINK_ERROR_CATALOG_V1.entries.map((entry) => entry.errorNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect([...numbers].sort((a, b) => a - b)).toEqual([
      -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21,
    ]);
    expect(CADLINK_ERROR_CATALOG_V1.version).toBe('cadlink-error-catalog-v1');
    expect(CADLINK_ERROR_CATALOG_V1.sourceUrl).toBe(
      'https://www.magi-cut.co.uk/files/html/V12webhelp/Cadlink.htm',
    );
  });

  it('classifies 18..21 as documented CAD3-specific, not CAD4 expectations', () => {
    for (const errorNumber of [18, 19, 20, 21]) {
      const entry = cadlinkErrorCatalogEntry(errorNumber);
      expect(entry?.documentedScope).toBe('CAD3_SPECIFIC');
      expect(entry?.diagnosticCode.startsWith('cadlink.cad3_')).toBe(true);
    }
    expect(cadlinkErrorCatalogEntry(2)?.documentedScope).toBe('GENERAL');
  });

  it('keeps unknown integers parseable and classified as UNKNOWN_ERROR', () => {
    expect(cadlinkErrorCatalogEntry(47)).toBeUndefined();
    expect(classifyCadlinkRlt({ errorNumber: 47, fieldNumber: 0, lineNumber: 0 })).toBe(
      'UNKNOWN_ERROR',
    );
    expect(classifyCadlinkRlt({ errorNumber: -9, fieldNumber: 0, lineNumber: 0 })).toBe(
      'UNKNOWN_ERROR',
    );
  });
});

describe('#792 CADLink RLT classification', () => {
  it('treats 0/0/0 as SUCCESS and error 0 with nonzero field/line as INCONSISTENT_RESULT', () => {
    expect(classifyCadlinkRlt({ errorNumber: 0, fieldNumber: 0, lineNumber: 0 })).toBe('SUCCESS');
    expect(classifyCadlinkRlt({ errorNumber: 0, fieldNumber: 5, lineNumber: 0 })).toBe(
      'INCONSISTENT_RESULT',
    );
    expect(classifyCadlinkRlt({ errorNumber: 0, fieldNumber: 0, lineNumber: 42 })).toBe(
      'INCONSISTENT_RESULT',
    );
    expect(classifyCadlinkRlt({ errorNumber: 2, fieldNumber: 0, lineNumber: 12 })).toBe('FAILURE');
  });
});

describe('#792 Granete RLT diagnosis against the golden r5 candidate', () => {
  it('diagnoses success 0/0/0 without inventing extra context', async () => {
    const candidate = await buildGoldenR5Candidate();
    const diagnosis = await diagnoseCadlinkRlt(
      parseCadlinkRlt(rlt('0\r\n0\r\n0\r\n')),
      candidate.bytes,
    );

    expect(diagnosis.outcome).toBe('SUCCESS');
    expect(diagnosis.diagnosticCode).toBe('cadlink.import_success');
    expect(diagnosis.documentedMeaning).toBe('Import successful');
    expect(diagnosis.errorNumber).toBe(0);
    expect(diagnosis.fieldNumber).toBe(0);
    expect(diagnosis.lineNumber).toBe(0);
    expect(diagnosis.candidateSha256).toBe(GOLDEN_R5_SHA256);
  });

  it('diagnoses bad format (2/0/12) with the PTX family derived from line 12 of the bytes', async () => {
    const candidate = await buildGoldenR5Candidate();
    const diagnosis = await diagnoseCadlinkRlt(parseCadlinkRlt(rlt('2\n0\n12\n')), candidate.bytes);

    expect(diagnosis.outcome).toBe('FAILURE');
    expect(diagnosis.diagnosticCode).toBe('cadlink.bad_format');
    expect(diagnosis.documentedMeaning).toBe('Bad format');
    expect(diagnosis.lineNumber).toBe(12);
    // The family is derived from the REAL candidate bytes, independently
    // recomputed here from the same line split the diagnosis claims to use.
    const expectedLine = lineAt(goldenLines(candidate.bytes), 12);
    const expectedFirstCell = expectedLine.split(',')[0];
    expect(diagnosis.ptxLine?.family).toBe(expectedFirstCell);
    expect(diagnosis.ptxLine?.cellCount).toBe(expectedLine.split(',').length);
    expect(diagnosis.ptxLine?.rawLineSha256).toBe(
      createHash('sha256').update(expectedLine).digest('hex'),
    );
  });

  it('diagnoses illegal part index (9/8/42) preserving field 8 verbatim', async () => {
    const candidate = await buildGoldenR5Candidate();
    const diagnosis = await diagnoseCadlinkRlt(parseCadlinkRlt(rlt('9\r\n8\r\n42\r\n')), candidate.bytes);

    expect(diagnosis.outcome).toBe('FAILURE');
    expect(diagnosis.diagnosticCode).toBe('cadlink.illegal_part_index');
    expect(diagnosis.documentedMeaning).toBe('Illegal part index');
    expect(diagnosis.errorNumber).toBe(9);
    expect(diagnosis.fieldNumber).toBe(8);
    expect(diagnosis.lineNumber).toBe(42);
    expect(goldenLines(candidate.bytes).length).toBeGreaterThanOrEqual(42);
    expect(diagnosis.ptxLine?.family).toBe(lineAt(goldenLines(candidate.bytes), 42).split(',')[0]);
    // Verbatim field: the diagnosis never converts it into a field name.
    expect('fieldName' in diagnosis).toBe(false);
    expect(JSON.stringify(diagnosis)).not.toContain('MAT_INDEX');
  });

  it('diagnoses illegal material index (17/4/23)', async () => {
    const candidate = await buildGoldenR5Candidate();
    const diagnosis = await diagnoseCadlinkRlt(parseCadlinkRlt(rlt('17\n4\n23\n')), candidate.bytes);

    expect(diagnosis.outcome).toBe('FAILURE');
    expect(diagnosis.diagnosticCode).toBe('cadlink.illegal_material_index');
    expect(diagnosis.documentedMeaning).toBe('Illegal material index');
    expect(diagnosis.fieldNumber).toBe(4);
    expect(diagnosis.lineNumber).toBe(23);
    expect(diagnosis.ptxLine?.family).toBe(lineAt(goldenLines(candidate.bytes), 23).split(',')[0]);
    expect(diagnosis.candidateSha256).toBe(sha256(candidate.bytes));
  });

  it('marks error 0 with nonzero field/line as inconsistent, not silent success', async () => {
    const candidate = await buildGoldenR5Candidate();
    const diagnosis = await diagnoseCadlinkRlt(parseCadlinkRlt(rlt('0\n3\n7\n')), candidate.bytes);

    expect(diagnosis.outcome).toBe('INCONSISTENT_RESULT');
    expect(diagnosis.diagnosticCode).toBe('cadlink.inconsistent_result');
    expect(diagnosis.documentedMeaning).toBeUndefined();
  });

  it('diagnoses unknown future error codes as cadlink.unknown_error with evidence preserved', async () => {
    const candidate = await buildGoldenR5Candidate();
    const diagnosis = await diagnoseCadlinkRlt(parseCadlinkRlt(rlt('47\n0\n0\n')), candidate.bytes);

    expect(diagnosis.outcome).toBe('UNKNOWN_ERROR');
    expect(diagnosis.diagnosticCode).toBe('cadlink.unknown_error');
    expect(diagnosis.errorNumber).toBe(47);
    expect(diagnosis.documentedMeaning).toBeUndefined();
    expect(diagnosis.candidateSha256).toBe(GOLDEN_R5_SHA256);
  });

  it('returns no line context when the reported line is outside the candidate bytes', async () => {
    const candidate = await buildGoldenR5Candidate();
    const diagnosis = await diagnoseCadlinkRlt(parseCadlinkRlt(rlt('2\n0\n9999\n')), candidate.bytes);
    expect(diagnosis.ptxLine).toBeUndefined();
  });
});
