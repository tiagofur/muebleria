/**
 * External-dialect structural reader (#788 — r5 groundwork).
 *
 * The two REAL working client files (sanitized copies R2201/R7301 under
 * docs/machines/ptx-cadmatic4/field/, originals never committed) do NOT have
 * the exact shape the Granete writer emits, and the Pattern Exchange
 * specification does not require them to:
 *
 * - records may carry MORE trailing optional fields than Granete models
 *   (R2201 BOARDS adds COST/STK_FLAG — documented §20 p.173 columns; PATTERNS
 *   adds the trailing PICTURE cell). The spec allows optional trailing
 *   fields, so a reader must distinguish the REQUIRED PREFIX (always
 *   present), MODELED optional columns, empty cells and OMITTED trailing
 *   fields instead of demanding the writer's exact width;
 * - the guide's own examples put SPACES after commas ("CUTS, 1,   1, …") and
 *   the samples separate sections with BLANK lines;
 * - documented families Granete does not model yet (PARTS_DST, PTN_UDI,
 *   NOTES — §20 pp.170–178) appear between the modeled ones; they are
 *   recorded opaque here and get their typed shape later (nothing in this
 *   reader may block that: the row view keeps every raw cell).
 *   PARTS_INF and PARTS_UDI got their typed shape in #789: external rows of
 *   those families now parse through the same modeled-family path (typed
 *   record + shape info), including their PART_INDEX → PARTS_REQ relations
 *   under the strict spec preflight — they stopped being opaque blobs.
 *
 * This reader changes NOTHING about the strict parsePtxText path used for
 * Granete's own bytes. It is for reading external evidence within the
 * supported subset — never a writer, never a spec verdict on the whole file
 * (unmodeled families are out of scope by construction).
 */

import { PtxParseError, PTX_PARSER_FAMILY_SPECS, parseHeaderRow, parseRecordRow } from './parse';
import type { PtxHeaderRecord, PtxRecord, PtxRecordType } from './records';

/** Documented (§20) families still without a typed Granete model (#790+). */
export const PTX_DOCUMENTED_UNMODELED_FAMILIES = [
  'PARTS_DST',
  'PTN_UDI',
  'NOTES',
] as const;

export type PtxDocumentedUnmodeledFamily = (typeof PTX_DOCUMENTED_UNMODELED_FAMILIES)[number];

const MODELED_FAMILIES = new Set(Object.keys(PTX_PARSER_FAMILY_SPECS));
const DOCUMENTED_UNMODELED = new Set<string>(PTX_DOCUMENTED_UNMODELED_FAMILIES);

/**
 * The four shapes of one optional column, distinguished explicitly:
 * - 'value': a non-empty cell was read;
 * - 'empty': the cell EXISTS but is empty (`,,` / `, ` — S06: empty ≠ zero,
 *   "no value imposed");
 * - 'omitted': the row ENDS before this column (a trailing optional field
 *   the emitter did not write — a different shape from an empty cell).
 */
export type PtxExternalCellPresence = 'value' | 'empty' | 'omitted';

/** Row-level shape info for one parsed record of a modeled family. */
export interface PtxExternalRowShape {
  readonly line: number;
  /** Cells observed after the family token (trailing comma included). */
  readonly cellsProvided: number;
  /** Documented/unmodeled trailing cells beyond the implemented width. */
  readonly extraTrailingCells: number;
  /** Modeled columns (0-based content position) that exist but are empty. */
  readonly emptyModeledColumns: readonly number[];
}

export interface PtxExternalHeaderRow extends PtxExternalRowShape {
  readonly family: 'HEADER';
  readonly record: PtxHeaderRecord;
}

export interface PtxExternalModeledRow extends PtxExternalRowShape {
  readonly family: PtxRecordType;
  readonly record: PtxRecord;
}

export interface PtxExternalUnmodeledRow {
  readonly family: PtxDocumentedUnmodeledFamily;
  readonly line: number;
  /** Raw cells after the family token, untouched (opaque evidence). */
  readonly cells: readonly string[];
}

export type PtxExternalRow = PtxExternalHeaderRow | PtxExternalModeledRow | PtxExternalUnmodeledRow;

export interface PtxExternalReadback {
  readonly header: PtxHeaderRecord | null;
  /** Modeled-subset records in file order (unmodeled families excluded). */
  readonly records: readonly PtxRecord[];
  /** Full row view, including opaque unmodeled families, in file order. */
  readonly rows: readonly PtxExternalRow[];
  /** Unmodeled-but-documented families present, with their row counts. */
  readonly unmodeledFamilyCounts: ReadonlyMap<string, number>;
}

// ---------------------------------------------------------------------------
// Tolerant cell reader (S06 quoting preserved verbatim inside quotes)
// ---------------------------------------------------------------------------

interface ReadCellsResult {
  readonly cells: string[];
  /** Whether each cell was quoted (quoted content is NEVER trimmed). */
  readonly quoted: boolean[];
}

function readCellsTolerant(line: string, lineNo: number): ReadCellsResult {
  const cells: string[] = [];
  const quoted: boolean[] = [];
  let cell = '';
  let inQuotes = false;
  let cellClosed = false;
  let isQuoted = false;
  let i = 0;
  const push = (): void => {
    cells.push(cell);
    quoted.push(isQuoted);
    cell = '';
    cellClosed = false;
    isQuoted = false;
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
    // Padding BEFORE a cell (quoted or not) is dialect: the samples and the
    // guide's own examples write `, "TITLE"` / `,   1`. Leading whitespace of
    // a not-yet-started cell is skipped so the opening quote can be seen;
    // INTERNAL spaces of a value are preserved.
    if ((ch === ' ' || ch === '\t') && cell === '' && !cellClosed) {
      i += 1;
      continue;
    }
    if (ch === '"' && cell === '' && !cellClosed) {
      inQuotes = true;
      isQuoted = true;
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
  // Spaces around UNQUOTED cells are part of the documented dialect (the
  // guide's own examples pad numbers); quoted content is preserved verbatim.
  for (let c = 0; c < cells.length; c++) {
    if (!quoted[c]) cells[c] = cells[c]!.trim();
  }
  return { cells, quoted };
}

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

function splitLinesTolerant(text: string): string[] {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r' && text[i + 1] !== '\n') {
      throw new PtxParseError('LONE_CARRIAGE_RETURN', 'lone CR is not a line ending', 1);
    }
  }
  return text
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.trim() !== '');
}

function rowShape(
  cells: readonly string[],
  specColumns: readonly string[],
  line: number,
): PtxExternalRowShape {
  const emptyModeledColumns: number[] = [];
  const modeled = Math.min(cells.length, specColumns.length);
  for (let column = 0; column < modeled; column++) {
    if (cells[column] === '') emptyModeledColumns.push(column);
  }
  return {
    line,
    cellsProvided: cells.length,
    extraTrailingCells: Math.max(0, cells.length - specColumns.length),
    emptyModeledColumns,
  };
}

/**
 * Reads an external PTX file structurally within the Granete-modeled subset.
 * Throws PtxParseError for violations that are NOT shape tolerance: broken
 * CSV quoting, non-ASCII bytes, an unknown (undocumented) family, a row
 * shorter than its REQUIRED PREFIX, or invalid values in modeled columns.
 */
export function parsePtxExternalText(text: string): PtxExternalReadback {
  const lines = splitLinesTolerant(text);
  const rows: PtxExternalRow[] = [];
  const records: PtxRecord[] = [];
  const unmodeledFamilyCounts = new Map<string, number>();
  let header: PtxHeaderRecord | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i]!;
    assertPrintableAscii(line, lineNo);
    const { cells } = readCellsTolerant(line, lineNo);
    const family = cells[0];
    if (family === undefined || family === '') {
      throw new PtxParseError('UNKNOWN_RECORD_FAMILY', 'empty record family', lineNo);
    }
    const content = cells.slice(1);

    if (DOCUMENTED_UNMODELED.has(family)) {
      rows.push({ family: family as PtxDocumentedUnmodeledFamily, line: lineNo, cells: content });
      unmodeledFamilyCounts.set(family, (unmodeledFamilyCounts.get(family) ?? 0) + 1);
      continue;
    }
    const spec = PTX_PARSER_FAMILY_SPECS[family];
    if (!spec) {
      throw new PtxParseError(
        'UNKNOWN_RECORD_FAMILY',
        `record family '${family}' is neither modeled nor a documented Pattern Exchange family`,
        lineNo,
      );
    }
    if (content.length < spec.required) {
      throw new PtxParseError(
        'TOO_FEW_COLUMNS',
        `${family} needs at least ${spec.required} column(s) [${spec.columns.slice(0, spec.required).join(',')}], got ${content.length}`,
        lineNo,
      );
    }
    // Required prefix + modeled optionals are read; documented-but-unmodeled
    // trailing cells are structurally tolerated (counted in the row shape,
    // never silently dropped).
    const modeled = content.slice(0, spec.columns.length);
    const shape = rowShape(content, spec.columns, lineNo);
    if (family === 'HEADER') {
      if (header !== null) {
        throw new PtxParseError('DUPLICATE_HEADER', 'HEADER may only appear once', lineNo);
      }
      if (rows.length > 0) {
        throw new PtxParseError('HEADER_NOT_FIRST', 'HEADER must be the first record', lineNo);
      }
      header = parseHeaderRow(modeled, lineNo);
      rows.push({ family: 'HEADER', record: header, ...shape });
      continue;
    }
    const record = parseRecordRow(family, modeled, lineNo);
    records.push(record);
    rows.push({ family: family as PtxRecordType, record, ...shape });
  }
  return { header, records, rows, unmodeledFamilyCounts };
}

/** Decodes bytes (printable-ASCII dialect) and reads them structurally. */
export function parsePtxExternalBytes(bytes: Uint8Array): PtxExternalReadback {
  let text = '';
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new PtxParseError('NOT_PRINTABLE_ASCII', `byte 0x${byte.toString(16)} outside ASCII`, 1);
    }
    text += String.fromCharCode(byte);
  }
  return parsePtxExternalText(text);
}

/**
 * Presence of one modeled optional column within a row (the empty-vs-omitted
 * distinction, exposed per column for tests and future PARTS_INF/PARTS_UDI
 * consumers).
 */
export function ptxExternalColumnPresence(
  row: PtxExternalHeaderRow | PtxExternalModeledRow,
  column: number,
): PtxExternalCellPresence {
  if (column >= row.cellsProvided) return 'omitted';
  return row.emptyModeledColumns.includes(column) ? 'empty' : 'value';
}

/** Whether the row belongs to a modeled family (carries a typed record + shape). */
export function hasPtxExternalShape(row: PtxExternalRow): row is PtxExternalHeaderRow | PtxExternalModeledRow {
  return 'record' in row;
}
