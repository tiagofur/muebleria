/**
 * Independent parser/readback for the documented PTX subset (#650 PR 4).
 *
 * By design this reader does NOT reuse the writer's builders, column tables
 * or formatters (docs/machines/ptx-cadmatic4/02_plan_de_implementacion.md,
 * "Comprobación inversa independiente"): it carries its own copy of the
 * documented column layouts, its own CSV cell reader and its own number
 * readers, so a roundtrip agreement is real evidence and not the serializer
 * confirming itself. Tests cross-check both tables against the dossier.
 *
 * Column policy (investigation §4 + §9):
 * - a row must carry at least the family's required columns and at most the
 *   implemented width; documented-but-unmodeled trailing columns are a
 *   TOO_MANY_COLUMNS error (fail closed — the OFFCUTS/MATERIALS/etc.
 *   inventories beyond this subset are explicitly unresolved ambiguities);
 * - trailing optional columns may be absent (the dossier fragments truncate
 *   them) and mid-row optional columns may be empty — both read back as
 *   `undefined`, never as 0 (empty ≠ zero, S06);
 * - rows keep FILE ORDER: CUT_INDEX nesting is encoded in row order and
 *   reordering by SEQUENCE would destroy the tree (S03 pp.142–145).

 * ASCII + printable cells; CRLF or LF endings; one optional trailing blank
 * line; quotes per S06 (quoted cells, `""` escapes a quote).
 */

import type {
  PtxDocument,
  PtxGrain,
  PtxHeaderRecord,
  PtxPatternType,
  PtxPartReference,
  PtxRecord,
  PtxTrimType,
  PtxUnits,
} from './records';

export type PtxParseErrorCode =
  | 'NOT_PRINTABLE_ASCII'
  | 'LONE_CARRIAGE_RETURN'
  | 'BLANK_LINE'
  | 'HEADER_NOT_FIRST'
  | 'DUPLICATE_HEADER'
  | 'MISSING_HEADER'
  | 'UNKNOWN_RECORD_FAMILY'
  | 'TOO_FEW_COLUMNS'
  | 'TOO_MANY_COLUMNS'
  | 'QUOTE_UNCLOSED'
  | 'QUOTE_UNEXPECTED'
  | 'REQUIRED_FIELD_EMPTY'
  | 'INVALID_INTEGER'
  | 'INVALID_NUMBER'
  | 'INVALID_PART_REFERENCE'
  | 'INVALID_ENUM_VALUE';

export class PtxParseError extends Error {
  constructor(
    readonly code: PtxParseErrorCode,
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = 'PtxParseError';
  }
}

// ---------------------------------------------------------------------------
// Parser-side column tables — the documented layouts, kept independently
// from serialize.ts on purpose.
// ---------------------------------------------------------------------------

interface FamilySpec {
  /** Column names after the family token (documented order). */
  readonly columns: readonly string[];
  /** How many of those columns are required (prefix). */
  readonly required: number;
}
export type { FamilySpec as PtxParserFamilySpec };

const FAMILY_SPECS: Readonly<Record<string, FamilySpec>> = {
  HEADER: { columns: ['VERSION', 'TITLE', 'UNITS', 'ORIGIN', 'TRIM_TYPE'], required: 5 },
  JOBS: {
    columns: [
      'JOB_INDEX', 'NAME', 'DESC', 'ORD_DATE', 'CUT_DATE', 'CUSTOMER', 'STATUS',
      'OPT_PARAM', 'SAW_PARAM', 'CUT_TIME', 'WASTE_PCNT',
    ],
    required: 2,
  },
  PARTS_REQ: {
    columns: [
      'JOB_INDEX', 'PART_INDEX', 'CODE', 'MAT_INDEX', 'LENGTH', 'WIDTH',
      'QTY_REQ', 'QTY_OVER', 'QTY_UNDER', 'GRAIN', 'QTY_PROD',
    ],
    required: 8,
  },
  BOARDS: {
    columns: ['JOB_INDEX', 'BRD_INDEX', 'CODE', 'MAT_INDEX', 'LENGTH', 'WIDTH', 'QTY_STOCK', 'QTY_USED'],
    required: 6,
  },
  MATERIALS: {
    columns: [
      'JOB_INDEX', 'MAT_INDEX', 'CODE', 'DESC', 'THICK', 'BOOK', 'KERF_RIP', 'KERF_XCT',
      'TRIM_FRIP', 'TRIM_VRIP', 'TRIM_FXCT', 'TRIM_VXCT', 'TRIM_HEAD', 'TRIM_FRCT', 'TRIM_VRCT',
      'RULE1', 'RULE2', 'RULE3', 'RULE4',
    ],
    required: 7,
  },
  PATTERNS: {
    columns: ['JOB_INDEX', 'PTN_INDEX', 'BRD_INDEX', 'TYPE', 'QTY_RUN', 'QTY_CYCLES', 'MAX_BOOK'],
    required: 4,
  },
  CUTS: {
    columns: [
      'JOB_INDEX', 'PTN_INDEX', 'CUT_INDEX', 'SEQUENCE', 'FUNCTION', 'DIMENSION',
      'QTY_RPT', 'PART_INDEX', 'QTY_PARTS', 'COMMENT',
    ],
    required: 9,
  },
  OFFCUTS: { columns: ['JOB_INDEX', 'OFFCUT_INDEX', 'CODE', 'MAT_INDEX', 'LENGTH', 'WIDTH'], required: 6 },
  VECTORS: {
    columns: ['JOB_INDEX', 'PTN_INDEX', 'CUT_INDEX', 'X_START', 'Y_START', 'X_END', 'Y_END'],
    required: 7,
  },
};

/** The parser's own table, exported for cross-checks against the dossier. */
export const PTX_PARSER_FAMILY_SPECS: Readonly<Record<string, FamilySpec>> = FAMILY_SPECS;

// ---------------------------------------------------------------------------
// Line/cell primitives (own implementations — nothing shared with the writer)
// ---------------------------------------------------------------------------

function assertPrintableAscii(line: string, lineNo: number): void {
  for (const ch of line) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new PtxParseError(
        'NOT_PRINTABLE_ASCII',
        `byte/char U+${code.toString(16).toUpperCase().padStart(4, '0')} outside printable ASCII`,
        lineNo,
      );
    }
  }
}

function splitLines(text: string): string[] {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r' && text[i + 1] !== '\n') {
      throw new PtxParseError('LONE_CARRIAGE_RETURN', 'lone CR is not a line ending', 1 + countChar(text.slice(0, i), '\n'));
    }
  }
  let lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  // Exactly one trailing blank line (final line ending) is normal.
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines = lines.slice(0, -1);
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') {
      throw new PtxParseError('BLANK_LINE', 'blank lines are not part of the format', i + 1);
    }
  }
  return lines;
}

function countChar(text: string, ch: string): number {
  let count = 0;
  for (const c of text) if (c === ch) count++;
  return count;
}

/** RFC-style CSV row reader for one line (S06: commas, quoted cells, "" escape). */
function readCells(line: string, lineNo: number): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellClosed = false;
  let i = 0;
  const push = () => {
    cells.push(cell);
    cell = '';
    cellClosed = false;
  };
  while (i < line.length) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        cellClosed = true;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === '' && !cellClosed) {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      throw new PtxParseError('QUOTE_UNEXPECTED', 'double quote outside a quoted cell', lineNo);
    }
    if (ch === ',') {
      push();
      i += 1;
      continue;
    }
    if (cellClosed && ch !== ',') {
      throw new PtxParseError('QUOTE_UNEXPECTED', 'content after a closing quote', lineNo);
    }
    cell += ch;
    i += 1;
  }
  if (inQuotes) {
    throw new PtxParseError('QUOTE_UNCLOSED', 'quoted cell not closed before end of line', lineNo);
  }
  push();
  return cells;
}

// ---------------------------------------------------------------------------
// Cell readers (own number interpretations)
// ---------------------------------------------------------------------------

const INTEGER_PATTERN = /^\d+$/;
const NUMBER_PATTERN = /^\d+(\.\d+)?$/;

class CellCursor {
  constructor(
    private readonly cells: readonly string[],
    private readonly lineNo: number,
    private readonly family: string,
  ) {}

  private cell(column: number): string | undefined {
    return this.cells[column];
  }

  int(column: number, field: string): number {
    const raw = this.cell(column);
    if (raw === undefined || raw === '') {
      throw new PtxParseError('REQUIRED_FIELD_EMPTY', `${this.family}.${field} is required`, this.lineNo);
    }
    if (!INTEGER_PATTERN.test(raw)) {
      throw new PtxParseError('INVALID_INTEGER', `${this.family}.${field}: '${raw}' is not a non-negative integer`, this.lineNo);
    }
    return Number(raw);
  }

  optionalInt(column: number, field: string): number | undefined {
    const raw = this.cell(column);
    if (raw === undefined || raw === '') return undefined;
    if (!INTEGER_PATTERN.test(raw)) {
      throw new PtxParseError('INVALID_INTEGER', `${this.family}.${field}: '${raw}' is not a non-negative integer`, this.lineNo);
    }
    return Number(raw);
  }

  real(column: number, field: string): number {
    const raw = this.cell(column);
    if (raw === undefined || raw === '') {
      throw new PtxParseError('REQUIRED_FIELD_EMPTY', `${this.family}.${field} is required`, this.lineNo);
    }
    if (!NUMBER_PATTERN.test(raw)) {
      throw new PtxParseError('INVALID_NUMBER', `${this.family}.${field}: '${raw}' is not a non-negative decimal number`, this.lineNo);
    }
    return Number(raw);
  }

  optionalReal(column: number, field: string): number | undefined {
    const raw = this.cell(column);
    if (raw === undefined || raw === '') return undefined;
    if (!NUMBER_PATTERN.test(raw)) {
      throw new PtxParseError('INVALID_NUMBER', `${this.family}.${field}: '${raw}' is not a non-negative decimal number`, this.lineNo);
    }
    return Number(raw);
  }

  text(column: number, field: string): string {
    const raw = this.cell(column);
    if (raw === undefined || raw === '') {
      throw new PtxParseError('REQUIRED_FIELD_EMPTY', `${this.family}.${field} is required`, this.lineNo);
    }
    return raw;
  }

  optionalText(column: number): string | undefined {
    const raw = this.cell(column);
    return raw === undefined || raw === '' ? undefined : raw;
  }

  enum<T extends number>(column: number, field: string, allowed: readonly T[]): T {
    const value = this.int(column, field);
    if (!(allowed as readonly number[]).includes(value)) {
      throw new PtxParseError(
        'INVALID_ENUM_VALUE',
        `${this.family}.${field}: ${value} is not one of the documented values [${allowed.join(', ')}]`,
        this.lineNo,
      );
    }
    return value as T;
  }
}

function parsePartReference(raw: string, lineNo: number): PtxPartReference {
  if (raw === '0') return { kind: 'none' };
  if (INTEGER_PATTERN.test(raw)) return { kind: 'part', partIndex: Number(raw) };
  const offcut = /^X(\d+)$/.exec(raw);
  if (offcut) return { kind: 'offcut', offcutIndex: Number(offcut[1]) };
  throw new PtxParseError(
    'INVALID_PART_REFERENCE',
    `CUTS.PART_INDEX: '${raw}' is not 0, a PARTS_REQ index or an X<OFFCUTS index> reference`,
    lineNo,
  );
}

// ---------------------------------------------------------------------------
// Row → record
// ---------------------------------------------------------------------------

function parseHeaderRow(cells: readonly string[], lineNo: number): PtxHeaderRecord {
  const c = new CellCursor(cells, lineNo, 'HEADER');
  return {
    type: 'HEADER',
    version: c.real(0, 'VERSION'),
    title: c.text(1, 'TITLE'),
    units: c.enum<PtxUnits>(2, 'UNITS', [0, 1]),
    origin: c.int(3, 'ORIGIN'),
    trimType: c.enum<PtxTrimType>(4, 'TRIM_TYPE', [0, 1]),
  };
}

function parseRecordRow(family: string, cells: readonly string[], lineNo: number): PtxRecord {
  const c = new CellCursor(cells, lineNo, family);
  switch (family) {
    case 'JOBS':
      return {
        type: 'JOBS',
        jobIndex: c.int(0, 'JOB_INDEX'),
        name: c.text(1, 'NAME'),
        description: c.optionalText(2),
        orderDate: c.optionalText(3),
        cutDate: c.optionalText(4),
        customer: c.optionalText(5),
        status: c.optionalInt(6, 'STATUS'),
        optParam: c.optionalText(7),
        sawParam: c.optionalText(8),
        cutTime: c.optionalReal(9, 'CUT_TIME'),
        wastePercent: c.optionalReal(10, 'WASTE_PCNT'),
      };
    case 'PARTS_REQ':
      return {
        type: 'PARTS_REQ',
        jobIndex: c.int(0, 'JOB_INDEX'),
        partIndex: c.int(1, 'PART_INDEX'),
        code: c.text(2, 'CODE'),
        materialIndex: c.int(3, 'MAT_INDEX'),
        length: c.real(4, 'LENGTH'),
        width: c.real(5, 'WIDTH'),
        requiredQuantity: c.int(6, 'QTY_REQ'),
        overQuantity: c.optionalInt(7, 'QTY_OVER'),
        underQuantity: c.optionalInt(8, 'QTY_UNDER'),
        grain: c.enum<PtxGrain>(9, 'GRAIN', [0, 1, 2]),
        producedQuantity: c.optionalInt(10, 'QTY_PROD'),
      };
    case 'BOARDS':
      return {
        type: 'BOARDS',
        jobIndex: c.int(0, 'JOB_INDEX'),
        boardIndex: c.int(1, 'BRD_INDEX'),
        code: c.text(2, 'CODE'),
        materialIndex: c.int(3, 'MAT_INDEX'),
        length: c.real(4, 'LENGTH'),
        width: c.real(5, 'WIDTH'),
        stockQuantity: c.optionalInt(6, 'QTY_STOCK'),
        usedQuantity: c.optionalInt(7, 'QTY_USED'),
      };
    case 'MATERIALS':
      return {
        type: 'MATERIALS',
        jobIndex: c.int(0, 'JOB_INDEX'),
        materialIndex: c.int(1, 'MAT_INDEX'),
        code: c.text(2, 'CODE'),
        description: c.optionalText(3),
        thickness: c.real(4, 'THICK'),
        bookQuantity: c.int(5, 'BOOK'),
        kerfRip: c.real(6, 'KERF_RIP'),
        kerfCrosscut: c.real(7, 'KERF_XCT'),
        trimFRip: c.optionalReal(8, 'TRIM_FRIP'),
        trimVRip: c.optionalReal(9, 'TRIM_VRIP'),
        trimFXct: c.optionalReal(10, 'TRIM_FXCT'),
        trimVXct: c.optionalReal(11, 'TRIM_VXCT'),
        trimHead: c.optionalReal(12, 'TRIM_HEAD'),
        trimFRct: c.optionalReal(13, 'TRIM_FRCT'),
        trimVRct: c.optionalReal(14, 'TRIM_VRCT'),
        rule1: c.optionalInt(15, 'RULE1'),
        rule2: c.optionalInt(16, 'RULE2'),
        rule3: c.optionalInt(17, 'RULE3'),
        rule4: c.optionalInt(18, 'RULE4'),
      };
    case 'PATTERNS':
      return {
        type: 'PATTERNS',
        jobIndex: c.int(0, 'JOB_INDEX'),
        patternIndex: c.int(1, 'PTN_INDEX'),
        boardIndex: c.int(2, 'BRD_INDEX'),
        patternType: c.enum<PtxPatternType>(3, 'TYPE', [0, 1, 2, 3, 4]),
        runQuantity: c.optionalInt(4, 'QTY_RUN'),
        cyclesQuantity: c.optionalInt(5, 'QTY_CYCLES'),
        maxBook: c.optionalInt(6, 'MAX_BOOK'),
      };
    case 'CUTS':
      return {
        type: 'CUTS',
        jobIndex: c.int(0, 'JOB_INDEX'),
        patternIndex: c.int(1, 'PTN_INDEX'),
        cutIndex: c.int(2, 'CUT_INDEX'),
        sequence: c.int(3, 'SEQUENCE'),
        functionCode: c.int(4, 'FUNCTION'),
        dimension: c.real(5, 'DIMENSION'),
        repeatQuantity: c.int(6, 'QTY_RPT'),
        partReference: parsePartReference(c.text(7, 'PART_INDEX'), lineNo),
        producedQuantity: c.int(8, 'QTY_PARTS'),
        comment: c.optionalText(9),
      };
    case 'OFFCUTS':
      return {
        type: 'OFFCUTS',
        jobIndex: c.int(0, 'JOB_INDEX'),
        offcutIndex: c.int(1, 'OFFCUT_INDEX'),
        code: c.text(2, 'CODE'),
        materialIndex: c.int(3, 'MAT_INDEX'),
        length: c.real(4, 'LENGTH'),
        width: c.real(5, 'WIDTH'),
      };
    case 'VECTORS':
      return {
        type: 'VECTORS',
        jobIndex: c.int(0, 'JOB_INDEX'),
        patternIndex: c.int(1, 'PTN_INDEX'),
        cutIndex: c.int(2, 'CUT_INDEX'),
        xStart: c.real(3, 'X_START'),
        yStart: c.real(4, 'Y_START'),
        xEnd: c.real(5, 'X_END'),
        yEnd: c.real(6, 'Y_END'),
      };
    default:
      // Unreachable: dispatch is guarded by FAMILY_SPECS.
      throw new PtxParseError('UNKNOWN_RECORD_FAMILY', `record family '${family}' is not implemented`, lineNo);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Readback of a PTX text where the HEADER may be absent (fragments). */
export interface PtxRecordsReadback {
  readonly header: PtxHeaderRecord | null;
  readonly records: readonly PtxRecord[];
}

/**
 * Parses record rows (and an optional leading HEADER) from PTX text.
 * Syntax/column level only — use validatePtxDocument for relations.
 */
export function parsePtxText(text: string): PtxRecordsReadback {
  const lines = splitLines(text);
  let header: PtxHeaderRecord | null = null;
  const records: PtxRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i]!;
    assertPrintableAscii(line, lineNo);
    const cells = readCells(line, lineNo);
    const family = cells[0];
    if (family === undefined) {
      throw new PtxParseError('UNKNOWN_RECORD_FAMILY', 'empty record family', lineNo);
    }
    const spec = FAMILY_SPECS[family];
    if (!spec) {
      throw new PtxParseError('UNKNOWN_RECORD_FAMILY', `record family '${family}' is not implemented`, lineNo);
    }
    const content = cells.slice(1);
    if (content.length < spec.required) {
      throw new PtxParseError(
        'TOO_FEW_COLUMNS',
        `${family} needs at least ${spec.required} column(s) [${spec.columns.slice(0, spec.required).join(',')}], got ${content.length}`,
        lineNo,
      );
    }
    if (content.length > spec.columns.length) {
      throw new PtxParseError(
        'TOO_MANY_COLUMNS',
        `${family} implements ${spec.columns.length} column(s) [${spec.columns.join(',')}]; the extra ${content.length - spec.columns.length} column(s) are outside the documented subset (fail closed)`,
        lineNo,
      );
    }
    if (family === 'HEADER') {
      if (header !== null) {
        throw new PtxParseError('DUPLICATE_HEADER', 'HEADER may only appear once', lineNo);
      }
      if (i !== 0) {
        throw new PtxParseError('HEADER_NOT_FIRST', 'HEADER must be the first record', lineNo);
      }
      header = parseHeaderRow(content, lineNo);
      continue;
    }
    records.push(parseRecordRow(family, content, lineNo));
  }
  return { header, records };
}

/** Parses a complete PTX document (HEADER required, first record). */
export function parsePtxDocumentText(text: string): PtxDocument {
  const readback = parsePtxText(text);
  if (readback.header === null) {
    throw new PtxParseError('MISSING_HEADER', 'a PTX document requires a HEADER record', 1);
  }
  return { header: readback.header, records: readback.records };
}

/** Decodes bytes (strict printable-ASCII contract) and parses the document. */
export function parsePtxDocumentBytes(bytes: Uint8Array): PtxDocument {
  let text = '';
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new PtxParseError('NOT_PRINTABLE_ASCII', `byte 0x${byte.toString(16)} outside ASCII`, 1);
    }
    text += String.fromCharCode(byte);
  }
  return parsePtxDocumentText(text);
}
