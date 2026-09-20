/**
 * #792 — CADLink .RLT result parser, documented error catalog and Granete
 * diagnosis (R5-J of the #787 plan).
 *
 * Primary source: Magi-Cut CADLink help (V12 web help, Cadlink.htm) — the
 * same help already referenced by `06_dossier_r5_segundo_rechazo.md`. For an
 * ASCII PTX import the `.RLT` result file contains exactly three lines:
 * error number, field number, line number. Successful imports read 0/0/0.
 *
 * Boundaries (fail-closed by construction):
 * - the parser accepts only CRLF/LF, at most one final newline and exactly
 *   three integer values; anything else is a typed error — no OCR, no
 *   heuristics, no inferred values;
 * - `fieldNumber` is preserved VERBATIM. The source does not document whether
 *   the field index is zero/one-based or includes the family cell, so it is
 *   never converted into a field name;
 * - `lineNumber` is preserved verbatim too; the PTX family context is derived
 *   ONLY from the candidate bytes by reading the reported line (interpreted
 *   as a 1-based index into the candidate's text lines) and accepting the
 *   first cell only when it is a documented PTX family token;
 * - error numbers absent from the catalog still parse and classify as
 *   UNKNOWN_ERROR (`cadlink.unknown_error`) so future CADLink versions keep
 *   leaving evidence instead of being rejected at parse time.
 */

import { sha256Hex } from '../machines/digest';
import { PTX_PARSER_FAMILY_SPECS } from './parse';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** The three documented .RLT values, exactly as read (no transformation). */
export interface CadlinkRltResult {
  readonly errorNumber: number;
  readonly fieldNumber: number;
  readonly lineNumber: number;
}

export type CadlinkRltParseErrorCode =
  | 'cadlink_rlt.empty'
  | 'cadlink_rlt.not_ascii'
  | 'cadlink_rlt.line_ending_unsupported'
  | 'cadlink_rlt.missing_value'
  | 'cadlink_rlt.value_not_integer'
  | 'cadlink_rlt.extra_content';

export class CadlinkRltParseError extends Error {
  constructor(
    readonly code: CadlinkRltParseErrorCode,
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(`${message} [${code}]`);
    this.name = 'CadlinkRltParseError';
  }
}

const INTEGER_PATTERN = /^-?[0-9]+$/;

/**
 * Parse the raw bytes of a CADLink `.RLT` result file.
 *
 * Accepted: CRLF or LF line endings, an optional single final newline, and
 * exactly three integer lines (error, field, line — in that order). Leading
 * zeros are integers; signs are allowed because documented codes include
 * -1..-4. Everything else — blank values, non-integers, extra lines (even an
 * extra trailing blank line), lone CR, non-ASCII bytes — fails closed.
 */
export function parseCadlinkRlt(bytes: Uint8Array): CadlinkRltResult {
  if (bytes.byteLength === 0) {
    throw new CadlinkRltParseError('cadlink_rlt.empty', 'empty .RLT result file');
  }

  for (const [index, byte] of bytes.entries()) {
    const isTerminator = byte === 0x0a || byte === 0x0d;
    if ((byte < 0x20 || byte > 0x7e) && !isTerminator) {
      throw new CadlinkRltParseError(
        'cadlink_rlt.not_ascii',
        `.RLT byte ${index} (0x${byte.toString(16).padStart(2, '0')}) is not printable ASCII`,
      );
    }
  }

  const text = new TextDecoder('ascii').decode(bytes);
  const split = text.split(/\r\n|\n/);
  // One final line terminator is allowed; it shows up as a trailing ''.
  const lines = split[split.length - 1] === '' ? split.slice(0, -1) : split;

  for (const line of lines) {
    if (line.includes('\r')) {
      throw new CadlinkRltParseError(
        'cadlink_rlt.line_ending_unsupported',
        'lone CR line ending: only CRLF and LF are documented for .RLT files',
      );
    }
  }

  if (lines.length < 3) {
    throw new CadlinkRltParseError(
      'cadlink_rlt.missing_value',
      `.RLT carries ${lines.length} of the 3 documented values (error/field/line)`,
      { observedLines: lines.length },
    );
  }
  if (lines.length > 3) {
    throw new CadlinkRltParseError(
      'cadlink_rlt.extra_content',
      `.RLT carries ${lines.length} lines; exactly 3 values plus one final newline are accepted`,
      { observedLines: lines.length },
    );
  }

  const parseIntLine = (line: string, valueIndex: number): number => {
    if (!INTEGER_PATTERN.test(line) || !Number.isSafeInteger(Number(line))) {
      throw new CadlinkRltParseError(
        'cadlink_rlt.value_not_integer',
        `.RLT value ${valueIndex} '${line}' is not an integer`,
        { valueIndex, raw: line },
      );
    }
    return Number(line);
  };
  const [errorLine, fieldLine, lineLine] = lines;
  // Unreachable after the length checks above; the guard keeps the parser
  // total under noUncheckedIndexedAccess without asserting it away.
  if (errorLine === undefined || fieldLine === undefined || lineLine === undefined) {
    throw new CadlinkRltParseError(
      'cadlink_rlt.missing_value',
      '.RLT does not carry the 3 documented values (error/field/line)',
    );
  }

  return {
    errorNumber: parseIntLine(errorLine, 1),
    fieldNumber: parseIntLine(fieldLine, 2),
    lineNumber: parseIntLine(lineLine, 3),
  };
}

// ---------------------------------------------------------------------------
// Versioned error catalog (documented codes only — nothing invented)
// ---------------------------------------------------------------------------

export type CadlinkErrorCatalogScope = 'GENERAL' | 'CAD3_SPECIFIC';

export interface CadlinkErrorCatalogEntry {
  readonly errorNumber: number;
  /** Stable Granete diagnostic code (cadlink.* namespace). */
  readonly diagnosticCode: string;
  /** Documented meaning, verbatim from the primary source. */
  readonly documentedMeaning: string;
  /**
   * GENERAL for mode-independent codes. CAD3_SPECIFIC for the documented
   * CADmatic 3-only codes (18..21): they are NOT expected problems of the
   * /CAD4 mode this field test runs in.
   */
  readonly documentedScope: CadlinkErrorCatalogScope;
}

export interface CadlinkErrorCatalog {
  readonly version: 'cadlink-error-catalog-v1';
  readonly source: 'Magi-Cut CADLink help (V12 web help, Cadlink.htm)';
  readonly sourceUrl: 'https://www.magi-cut.co.uk/files/html/V12webhelp/Cadlink.htm';
  readonly entries: readonly CadlinkErrorCatalogEntry[];
}

export const CADLINK_ERROR_CATALOG_V1: CadlinkErrorCatalog = {
  version: 'cadlink-error-catalog-v1',
  source: 'Magi-Cut CADLink help (V12 web help, Cadlink.htm)',
  sourceUrl: 'https://www.magi-cut.co.uk/files/html/V12webhelp/Cadlink.htm',
  entries: [
    { errorNumber: -1, diagnosticCode: 'cadlink.no_security_key', documentedMeaning: 'No security key (or incorrect modules for mode)', documentedScope: 'GENERAL' },
    { errorNumber: -2, diagnosticCode: 'cadlink.access_denied_source', documentedMeaning: 'Access denied to source path (read)', documentedScope: 'GENERAL' },
    { errorNumber: -3, diagnosticCode: 'cadlink.access_denied_destination', documentedMeaning: 'Access denied to destination path (write)', documentedScope: 'GENERAL' },
    { errorNumber: -4, diagnosticCode: 'cadlink.initialization_error', documentedMeaning: 'Program initialisation error', documentedScope: 'GENERAL' },
    { errorNumber: 0, diagnosticCode: 'cadlink.import_success', documentedMeaning: 'Import successful', documentedScope: 'GENERAL' },
    { errorNumber: 1, diagnosticCode: 'cadlink.file_not_found', documentedMeaning: 'File not found', documentedScope: 'GENERAL' },
    { errorNumber: 2, diagnosticCode: 'cadlink.bad_format', documentedMeaning: 'Bad format', documentedScope: 'GENERAL' },
    { errorNumber: 3, diagnosticCode: 'cadlink.too_many_jobs', documentedMeaning: 'Too many jobs', documentedScope: 'GENERAL' },
    { errorNumber: 4, diagnosticCode: 'cadlink.duplicate_jobs', documentedMeaning: 'Duplicate jobs', documentedScope: 'GENERAL' },
    { errorNumber: 5, diagnosticCode: 'cadlink.too_many_part_types', documentedMeaning: 'Too many part types', documentedScope: 'GENERAL' },
    { errorNumber: 6, diagnosticCode: 'cadlink.too_many_board_types', documentedMeaning: 'Too many board types', documentedScope: 'GENERAL' },
    { errorNumber: 7, diagnosticCode: 'cadlink.too_many_patterns', documentedMeaning: 'Too many patterns', documentedScope: 'GENERAL' },
    { errorNumber: 8, diagnosticCode: 'cadlink.too_many_cuts', documentedMeaning: 'Too many cuts', documentedScope: 'GENERAL' },
    { errorNumber: 9, diagnosticCode: 'cadlink.illegal_part_index', documentedMeaning: 'Illegal part index', documentedScope: 'GENERAL' },
    { errorNumber: 10, diagnosticCode: 'cadlink.illegal_board_index', documentedMeaning: 'Illegal board index', documentedScope: 'GENERAL' },
    { errorNumber: 11, diagnosticCode: 'cadlink.illegal_pattern_index', documentedMeaning: 'Illegal pattern index', documentedScope: 'GENERAL' },
    { errorNumber: 12, diagnosticCode: 'cadlink.illegal_cut_index', documentedMeaning: 'Illegal cut index', documentedScope: 'GENERAL' },
    { errorNumber: 13, diagnosticCode: 'cadlink.illegal_offcut_index', documentedMeaning: 'Illegal Offcut index', documentedScope: 'GENERAL' },
    { errorNumber: 14, diagnosticCode: 'cadlink.cadplan_too_many_parts', documentedMeaning: 'Cadplan - Too many parts to optimise', documentedScope: 'GENERAL' },
    { errorNumber: 15, diagnosticCode: 'cadlink.cadplan_too_many_boards', documentedMeaning: 'Cadplan - Too many boards to optimise', documentedScope: 'GENERAL' },
    { errorNumber: 16, diagnosticCode: 'cadlink.cadplan_fatal_error', documentedMeaning: 'Cadplan - Optimiser fatal error', documentedScope: 'GENERAL' },
    { errorNumber: 17, diagnosticCode: 'cadlink.illegal_material_index', documentedMeaning: 'Illegal material index', documentedScope: 'GENERAL' },
    { errorNumber: 18, diagnosticCode: 'cadlink.cad3_invalid_job_name', documentedMeaning: 'CADmatic 3 - Job name not valid (contains spaces or > 8 chrs)', documentedScope: 'CAD3_SPECIFIC' },
    { errorNumber: 19, diagnosticCode: 'cadlink.cad3_code_too_long', documentedMeaning: 'CADmatic 3 - Part, board or material code too long (> 25 chrs)', documentedScope: 'CAD3_SPECIFIC' },
    { errorNumber: 20, diagnosticCode: 'cadlink.cad3_illegal_pattern_type', documentedMeaning: 'CADmatic 3 - Illegal pattern type (no templates allowed)', documentedScope: 'CAD3_SPECIFIC' },
    { errorNumber: 21, diagnosticCode: 'cadlink.cad3_illegal_recuts', documentedMeaning: 'CADmatic 3 - Illegal recuts. Pattern number in field value', documentedScope: 'CAD3_SPECIFIC' },
  ],
};

const CATALOG_BY_NUMBER: ReadonlyMap<number, CadlinkErrorCatalogEntry> = new Map(
  CADLINK_ERROR_CATALOG_V1.entries.map((entry) => [entry.errorNumber, entry]),
);

export function cadlinkErrorCatalogEntry(errorNumber: number): CadlinkErrorCatalogEntry | undefined {
  return CATALOG_BY_NUMBER.get(errorNumber);
}

// ---------------------------------------------------------------------------
// Outcome classification + Granete diagnosis
// ---------------------------------------------------------------------------

export type CadlinkRltOutcome = 'SUCCESS' | 'FAILURE' | 'INCONSISTENT_RESULT' | 'UNKNOWN_ERROR';

/**
 * Classify a parsed triple:
 * - 0/0/0 → SUCCESS;
 * - error 0 with a nonzero field and/or line → INCONSISTENT_RESULT (never a
 *   silent success);
 * - documented error → FAILURE (CAD3_SPECIFIC entries stay FAILURE with their
 *   scope visible — they are documented, not CAD4-mode expectations);
 * - any other integer → UNKNOWN_ERROR.
 */
export function classifyCadlinkRlt(result: CadlinkRltResult): CadlinkRltOutcome {
  if (result.errorNumber === 0) {
    return result.fieldNumber === 0 && result.lineNumber === 0
      ? 'SUCCESS'
      : 'INCONSISTENT_RESULT';
  }
  return CATALOG_BY_NUMBER.has(result.errorNumber) ? 'FAILURE' : 'UNKNOWN_ERROR';
}

/** PTX line context derived from the candidate bytes, never from assumptions. */
export interface CadlinkRltPtxLineContext {
  /**
   * First cell of the reported line, only when it is a documented PTX family
   * token; otherwise absent. No field-name mapping is attempted.
   */
  readonly family?: string;
  readonly cellCount: number;
  readonly rawLineSha256: string;
}

export interface CadlinkRltDiagnosis {
  readonly outcome: CadlinkRltOutcome;
  readonly diagnosticCode: string;
  readonly errorNumber: number;
  /** Verbatim; NEVER converted to a field name (base/offset undocumented). */
  readonly fieldNumber: number;
  /** Verbatim; the PTX family context below is the only derivation. */
  readonly lineNumber: number;
  readonly documentedMeaning?: string;
  readonly documentedScope?: CadlinkErrorCatalogScope;
  readonly catalogVersion?: string;
  readonly ptxLine?: CadlinkRltPtxLineContext;
  readonly candidateSha256: string;
}

/** Split candidate PTX bytes into text lines (CRLF/LF tolerant, one trailing newline dropped). */
function candidateLines(ptxBytes: Uint8Array): readonly string[] {
  const text = new TextDecoder('ascii').decode(ptxBytes);
  const split = text.split(/\r\n|\n/);
  return split[split.length - 1] === '' ? split.slice(0, -1) : split;
}

/**
 * Derive the reported line's context from the candidate bytes. The reported
 * number is read as a 1-based index into the candidate's text lines; when the
 * line exists and its first cell is a documented PTX family token the family
 * is reported, otherwise nothing is invented.
 */
export async function ptxLineContextAt(
  ptxBytes: Uint8Array,
  lineNumber: number,
): Promise<CadlinkRltPtxLineContext | undefined> {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return undefined;
  const lines = candidateLines(ptxBytes);
  const raw = lines[lineNumber - 1];
  if (raw === undefined) return undefined;
  const cells = raw.split(',');
  const firstCell = cells[0] ?? '';
  const family = Object.prototype.hasOwnProperty.call(PTX_PARSER_FAMILY_SPECS, firstCell)
    ? firstCell
    : undefined;
  return {
    family,
    cellCount: cells.length,
    rawLineSha256: await sha256Hex(raw),
  };
}

/**
 * Build the Granete diagnosis for a parsed .RLT triple against the exact
 * candidate PTX bytes. Documents the documented meaning verbatim (when the
 * catalog knows the code), preserves field/line verbatim and adds the PTX
 * family context when the reported line can be identified in the bytes.
 * Never invents a root cause: `error 2 = Bad format` does NOT mean "HEADER
 * incorrect" unless the reported line/field shows it.
 */
export async function diagnoseCadlinkRlt(
  result: CadlinkRltResult,
  ptxBytes: Uint8Array,
): Promise<CadlinkRltDiagnosis> {
  const outcome = classifyCadlinkRlt(result);
  const entry = CATALOG_BY_NUMBER.get(result.errorNumber);
  const diagnosticCode =
    outcome === 'INCONSISTENT_RESULT'
      ? 'cadlink.inconsistent_result'
      : outcome === 'UNKNOWN_ERROR'
        ? 'cadlink.unknown_error'
        : (entry?.diagnosticCode ?? 'cadlink.unknown_error');
  const showMeaning = outcome === 'SUCCESS' || outcome === 'FAILURE';

  return {
    outcome,
    diagnosticCode,
    errorNumber: result.errorNumber,
    fieldNumber: result.fieldNumber,
    lineNumber: result.lineNumber,
    documentedMeaning: showMeaning ? entry?.documentedMeaning : undefined,
    documentedScope: showMeaning ? entry?.documentedScope : undefined,
    catalogVersion: CADLINK_ERROR_CATALOG_V1.version,
    ptxLine: await ptxLineContextAt(ptxBytes, result.lineNumber),
    candidateSha256: await sha256Hex(ptxBytes),
  };
}
