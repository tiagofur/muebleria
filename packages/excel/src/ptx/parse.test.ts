import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PTX_RECORD_CONTENT_WIDTH } from './records';
import {
  PtxParseError,
  PTX_PARSER_FAMILY_SPECS,
  parsePtxDocumentText,
  parsePtxDocumentBytes,
  parsePtxText,
} from './parse';

const EXAMPLES_DIR = new URL('../../../../docs/machines/ptx-cadmatic4/examples/', import.meta.url);

function readExample(name: string): string {
  return readFileSync(new URL(name, EXAMPLES_DIR), 'utf8');
}

function captureParseError(fn: () => unknown): PtxParseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PtxParseError) return error;
    throw error;
  }
  throw new Error('expected parsing to throw PtxParseError');
}

describe('parsePtxText against the dossier fragments', () => {
  it('reads 01_recorte_tres_fases: phases, dimensions and part references', () => {
    const { header, records } = parsePtxText(readExample('01_recorte_tres_fases.ptx.txt'));
    expect(header).toBeNull();
    expect(records).toHaveLength(4);
    expect(records.every((r) => r.type === 'CUTS')).toBe(true);
    expect(records.map((r) => (r as { functionCode: number }).functionCode)).toEqual([1, 2, 2, 3]);
    expect(records.map((r) => (r as { dimension: number }).dimension)).toEqual([320, 450, 280, 210]);
    expect(records.map((r) => (r as { partReference: { kind: string } }).partReference.kind)).toEqual([
      'none',
      'part',
      'none',
      'part',
    ]);
    expect(
      records.reduce((sum, r) => sum + (r as { producedQuantity: number }).producedQuantity, 0),
    ).toBe(2);
  });

  it('reads 02_prefijo_identidad: header, job, parts, board, material, pattern', () => {
    const { header, records } = parsePtxText(readExample('02_prefijo_identidad.ptx.txt'));
    expect(header).toEqual({
      type: 'HEADER',
      version: 1,
      title: 'GRANETE-LAB-NONPRODUCTION',
      units: 0,
      origin: 0,
      trimType: 1,
    });
    const job = records.find((r) => r.type === 'JOBS');
    expect(job).toEqual({
      type: 'JOBS',
      jobIndex: 1,
      name: 'C4D001',
      description: 'EXAMPLE ONLY',
      orderDate: '10/09/2026',
      cutDate: undefined,
      customer: 'LAB',
      status: 1,
    });
    const material = records.find((r) => r.type === 'MATERIALS');
    expect(material).toEqual({
      type: 'MATERIALS',
      jobIndex: 1,
      materialIndex: 1,
      code: 'MDF_LAB18',
      description: 'LAB',
      thickness: 18,
      bookQuantity: 1,
      kerfRip: 4,
      kerfCrosscut: 4,
      trimFRip: 0,
      trimVRip: 0,
      trimFXct: 0,
      trimVXct: 0,
      trimHead: 0,
      trimFRct: 0,
      trimVRct: 0,
      rule1: 3,
      rule2: 0,
      rule3: 0,
      rule4: 0,
    });
    // Fragments may truncate trailing optional columns (JOBS stops at STATUS).
    expect(records).toHaveLength(6); // JOBS + 2 PARTS_REQ + BOARDS + MATERIALS + PATTERNS
  });

  it('reads 03_jerarquia_y_secuencia: row order preserved, SEQUENCE independent', () => {
    const { records } = parsePtxText(readExample('03_jerarquia_y_secuencia.ptx.txt'));
    expect(records.map((r) => (r as { cutIndex: number }).cutIndex)).toEqual([1, 2, 3, 4, 5]);
    // Second strip has SEQUENCE=2 although its CUT_INDEX is 5: nesting lives
    // in row order, not in SEQUENCE.
    expect(records.map((r) => (r as { sequence: number }).sequence)).toEqual([1, 3, 4, 5, 2]);
  });

  it('reads the 04 CUTS offcut row (no extra pass) but fails closed on its OFFCUTS inventory', () => {
    // The OFFCUTS row carries 2 columns beyond the certain subset
    // (JOB_INDEX..WIDTH); the documented inventory beyond them differs
    // between sources (investigation §9) — fail closed, do not guess.
    const offcutsError = captureParseError(() => parsePtxText(readExample('04_retazo_sin_pasada.ptx.txt')));
    expect(offcutsError.code).toBe('TOO_MANY_COLUMNS');
    expect(offcutsError.line).toBe(1);
    expect(offcutsError.message).toContain('OFFCUTS');

    const cutsLine = readExample('04_retazo_sin_pasada.ptx.txt')
      .split(/\r?\n/)
      .find((line) => line.startsWith('CUTS,'))!;
    const { records } = parsePtxText(cutsLine);
    expect(records).toEqual([
      {
        type: 'CUTS',
        jobIndex: 1,
        patternIndex: 1,
        cutIndex: 5,
        sequence: 0,
        functionCode: 2,
        dimension: 462,
        repeatQuantity: 0,
        partReference: { kind: 'offcut', offcutIndex: 1 },
        producedQuantity: 1,
        comment: 'RESTO',
      },
    ]);
  });

  it('reads 05_vector_auxiliar with absolute coordinates', () => {
    const { records } = parsePtxText(readExample('05_vector_auxiliar.ptx.txt'));
    expect(records).toEqual([
      {
        type: 'VECTORS',
        jobIndex: 1,
        patternIndex: 1,
        cutIndex: 1,
        xStart: 0,
        yStart: 324,
        xEnd: 1200,
        yEnd: 324,
      },
    ]);
  });
});

describe('parsePtxText syntax rules', () => {
  it('accepts equivalent numeric forms 450, 450.0 and 450.00', () => {
    const dims = ['450', '450.0', '450.00'].map((dim) =>
      parsePtxText(`PARTS_REQ,1,1,P,1,${dim},320,1,,,0,1`).records[0],
    );
    expect(dims.map((r) => (r as { length: number }).length)).toEqual([450, 450, 450]);
  });

  it('accepts CRLF and LF endings plus one trailing blank line', () => {
    const crlf = 'CUTS,1,1,1,1,1,320,1,0,0,A\r\nCUTS,1,1,2,2,2,450,1,1,1,B\r\n';
    const lf = 'CUTS,1,1,1,1,1,320,1,0,0,A\nCUTS,1,1,2,2,2,450,1,1,1,B\n';
    expect(parsePtxText(crlf).records).toEqual(parsePtxText(lf).records);
    expect(parsePtxText(crlf).records).toHaveLength(2);
  });

  it('reads quoted cells with commas and doubled quotes (S06)', () => {
    const { header } = parsePtxText('HEADER,1,"GRANETE, LAB",0,0,1');
    expect(header?.title).toBe('GRANETE, LAB');
    const { header: h2 } = parsePtxText('HEADER,1,"A""B",0,0,1');
    expect(h2?.title).toBe('A"B');
  });

  it('rejects unknown families, wrong column counts and bad cells', () => {
    expect(captureParseError(() => parsePtxText('WIDGETS,1,2')).code).toBe('UNKNOWN_RECORD_FAMILY');
    expect(captureParseError(() => parsePtxText('JOBS,1')).code).toBe('TOO_FEW_COLUMNS');
    expect(captureParseError(() => parsePtxText('BOARDS,1,1,B,1,100,50,1,1,EXTRA')).code).toBe(
      'TOO_MANY_COLUMNS',
    );
    expect(captureParseError(() => parsePtxText('JOBS,,X')).code).toBe('REQUIRED_FIELD_EMPTY');
    expect(captureParseError(() => parsePtxText('JOBS,1.5,X')).code).toBe('INVALID_INTEGER');
    expect(captureParseError(() => parsePtxText('JOBS,-1,X')).code).toBe('INVALID_INTEGER');
    expect(captureParseError(() => parsePtxText('PARTS_REQ,1,1,P,1,12x,320,1,,,0,1')).code).toBe(
      'INVALID_NUMBER',
    );
    expect(captureParseError(() => parsePtxText('CUTS,1,1,1,1,1,320,1,Z1,0,C')).code).toBe(
      'INVALID_PART_REFERENCE',
    );
  });

  it('rejects non-ASCII text and non-ASCII bytes', () => {
    expect(captureParseError(() => parsePtxText('HEADER,1,CAÑA,0,0,1')).code).toBe('NOT_PRINTABLE_ASCII');
    const badBytes = new TextEncoder().encode('HEADER,1,CAFÉ,0,0,1');
    expect(captureParseError(() => parsePtxDocumentBytes(badBytes)).code).toBe('NOT_PRINTABLE_ASCII');
  });

  it('rejects malformed quoting', () => {
    expect(captureParseError(() => parsePtxText('JOBS,1,"UNCLOSED')).code).toBe('QUOTE_UNCLOSED');
    expect(captureParseError(() => parsePtxText('JOBS,1,"AB"C')).code).toBe('QUOTE_UNEXPECTED');
    expect(captureParseError(() => parsePtxText('JOBS,1,AB"C')).code).toBe('QUOTE_UNEXPECTED');
  });

  it('rejects structural line problems', () => {
    expect(captureParseError(() => parsePtxText('JOBS,1,A\n\nJOBS,2,B')).code).toBe('BLANK_LINE');
    expect(captureParseError(() => parsePtxText('JOBS,1,A\rJOBS,2,B')).code).toBe('LONE_CARRIAGE_RETURN');
    expect(captureParseError(() => parsePtxText('JOBS,1,A\nHEADER,1,T,0,0,1')).code).toBe('HEADER_NOT_FIRST');
    expect(captureParseError(() => parsePtxText('HEADER,1,T,0,0,1\nHEADER,1,T,0,0,1')).code).toBe(
      'DUPLICATE_HEADER',
    );
  });

  it('requires a HEADER for a full document', () => {
    expect(captureParseError(() => parsePtxDocumentText('JOBS,1,A')).code).toBe('MISSING_HEADER');
  });

  it('rejects out-of-dictionary enum values at parse time', () => {
    expect(captureParseError(() => parsePtxText('HEADER,1,T,2,0,1')).code).toBe('INVALID_ENUM_VALUE');
    expect(captureParseError(() => parsePtxText('PARTS_REQ,1,1,P,1,10,20,1,,,7,1')).code).toBe(
      'INVALID_ENUM_VALUE',
    );
    expect(captureParseError(() => parsePtxText('PATTERNS,1,1,1,9')).code).toBe('INVALID_ENUM_VALUE');
  });

  it('review R4 — PARTS_REQ required prefix reaches GRAIN past empty optionals', () => {
    // 10 content columns: QTY_OVER/QTY_UNDER empty, GRAIN present, QTY_PROD absent.
    expect(() => parsePtxText('PARTS_REQ,1,1,P,1,10,20,1,,,0')).not.toThrow();
    // Physically truncated before GRAIN: TOO_FEW_COLUMNS, not a later empty-required fluke.
    expect(captureParseError(() => parsePtxText('PARTS_REQ,1,1,P,1,10,20,1,,')).code).toBe('TOO_FEW_COLUMNS');
    // Same width with GRAIN physically empty: REQUIRED_FIELD_EMPTY.
    expect(captureParseError(() => parsePtxText('PARTS_REQ,1,1,P,1,10,20,1,,,')).code).toBe(
      'REQUIRED_FIELD_EMPTY',
    );
  });

  it('review R4 — MATERIALS required prefix reaches KERF_XCT', () => {
    expect(() => parsePtxText('MATERIALS,1,1,M,D,18,1,4,4')).not.toThrow();
    expect(captureParseError(() => parsePtxText('MATERIALS,1,1,M,D,18,1,4')).code).toBe('TOO_FEW_COLUMNS');
    expect(captureParseError(() => parsePtxText('MATERIALS,1,1,M,D,18,1,4,')).code).toBe(
      'REQUIRED_FIELD_EMPTY',
    );
  });
});

describe('parser column tables (independent witness of the documented layouts)', () => {
  it('matches the dossier column inventory per family', () => {
    expect(PTX_PARSER_FAMILY_SPECS['HEADER']?.columns).toEqual(['VERSION', 'TITLE', 'UNITS', 'ORIGIN', 'TRIM_TYPE']);
    expect(PTX_PARSER_FAMILY_SPECS['JOBS']?.columns).toEqual([
      'JOB_INDEX', 'NAME', 'DESC', 'ORD_DATE', 'CUT_DATE', 'CUSTOMER', 'STATUS',
      'OPT_PARAM', 'SAW_PARAM', 'CUT_TIME', 'WASTE_PCNT',
    ]);
    expect(PTX_PARSER_FAMILY_SPECS['PARTS_REQ']?.columns).toEqual([
      'JOB_INDEX', 'PART_INDEX', 'CODE', 'MAT_INDEX', 'LENGTH', 'WIDTH',
      'QTY_REQ', 'QTY_OVER', 'QTY_UNDER', 'GRAIN', 'QTY_PROD',
    ]);
    expect(PTX_PARSER_FAMILY_SPECS['BOARDS']?.columns).toEqual([
      'JOB_INDEX', 'BRD_INDEX', 'CODE', 'MAT_INDEX', 'LENGTH', 'WIDTH', 'QTY_STOCK', 'QTY_USED',
    ]);
    expect(PTX_PARSER_FAMILY_SPECS['MATERIALS']?.columns).toEqual([
      'JOB_INDEX', 'MAT_INDEX', 'CODE', 'DESC', 'THICK', 'BOOK', 'KERF_RIP', 'KERF_XCT',
      'TRIM_FRIP', 'TRIM_VRIP', 'TRIM_FXCT', 'TRIM_VXCT', 'TRIM_HEAD', 'TRIM_FRCT', 'TRIM_VRCT',
      'RULE1', 'RULE2', 'RULE3', 'RULE4',
    ]);
    expect(PTX_PARSER_FAMILY_SPECS['PATTERNS']?.columns).toEqual([
      'JOB_INDEX', 'PTN_INDEX', 'BRD_INDEX', 'TYPE', 'QTY_RUN', 'QTY_CYCLES', 'MAX_BOOK',
    ]);
    expect(PTX_PARSER_FAMILY_SPECS['CUTS']?.columns).toEqual([
      'JOB_INDEX', 'PTN_INDEX', 'CUT_INDEX', 'SEQUENCE', 'FUNCTION', 'DIMENSION',
      'QTY_RPT', 'PART_INDEX', 'QTY_PARTS', 'COMMENT',
    ]);
    expect(PTX_PARSER_FAMILY_SPECS['OFFCUTS']?.columns).toEqual([
      'JOB_INDEX', 'OFFCUT_INDEX', 'CODE', 'MAT_INDEX', 'LENGTH', 'WIDTH',
    ]);
    expect(PTX_PARSER_FAMILY_SPECS['VECTORS']?.columns).toEqual([
      'JOB_INDEX', 'PTN_INDEX', 'CUT_INDEX', 'X_START', 'Y_START', 'X_END', 'Y_END',
    ]);
  });

  it('agrees with the writer-side implemented widths (records.ts)', () => {
    for (const [family, spec] of Object.entries(PTX_PARSER_FAMILY_SPECS)) {
      expect(spec.columns, family).toHaveLength(
        PTX_RECORD_CONTENT_WIDTH[family as keyof typeof PTX_RECORD_CONTENT_WIDTH],
      );
    }
  });
});
