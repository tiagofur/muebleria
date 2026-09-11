/**
 * Deterministic serializer for the documented PTX subset (#650 PR 4 core).
 *
 * Properties required by docs/machines/ptx-cadmatic4/02_plan_de_implementacion.md
 * (Entrega B):
 * - pure function of (document, options): no clock, no randomness, so the
 *   same records always produce the same bytes;
 * - ASCII + CRLF by default (conservative first-candidate choice from the
 *   investigation §3.1, NOT a claim about what CADmatic 4 rejects);
 * - full implemented column width per family: absent optionals are written
 *   as EMPTY cells, explicit zeros as `0` — empty and zero are different
 *   semantics (S06) and middle empties never shift columns;
 * - magnitudes are emitted with the configured resolution and a magnitude
 *   that is not exactly representable at that resolution is an ERROR: no
 *   silent per-end rounding (investigation §7 quantization rule).
 *
 * Public boundary is fail-closed: serializePtxDocument (and the Bytes
 * variant) first runs validatePtxDocument and throws PtxDocumentInvalidError
 * with the blocking issues, so `bytes returned ⇒ document valid`. The
 * relational rules stay in validate.ts — nothing is duplicated here.
 * serializePtxDocumentUnchecked skips validation on purpose: it is the
 * format-level helper for unit tests of CSV/number emission and is NOT
 * exported from the package index.
 *
 * This module never imports the parser: readback independence is the point.
 */

import type {
  PtxBoardRecord,
  PtxCutRecord,
  PtxDocument,
  PtxJobRecord,
  PtxMaterialRecord,
  PtxOffcutRecord,
  PtxPartsReqRecord,
  PtxPatternRecord,
  PtxVectorRecord,
} from './records';
import { PtxDocumentInvalidError, validatePtxDocument } from './validate';

export type PtxFormatErrorCode =
  | 'TEXT_NOT_PRINTABLE_ASCII'
  | 'EMPTY_REQUIRED_TEXT'
  | 'EMPTY_OPTIONAL_TEXT'
  | 'NUMBER_NOT_FINITE'
  | 'NUMBER_OUT_OF_RANGE'
  | 'MAGNITUDE_NOT_REPRESENTABLE'
  | 'VERSION_NOT_REPRESENTABLE';

export class PtxFormatError extends Error {
  constructor(
    readonly code: PtxFormatErrorCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'PtxFormatError';
  }
}

export interface PtxSerializationOptions {
  /**
   * Fixed decimal resolution for real magnitudes (lengths, kerfs, trims,
   * dimensions…). Default 1 — the form used by the dossier examples; a
   * candidate choice, not a receiver-verified claim.
   */
  readonly decimalPlaces?: number;
  /** Line ending. Default CRLF (conservative first-candidate choice). */
  readonly lineEnding?: '\r\n' | '\n';
}

const DEFAULT_DECIMAL_PLACES = 1;
const DEFAULT_LINE_ENDING = '\r\n' as const;
/** Sanity bound so formatted numbers never degrade into exponent notation. */
const MAX_ABS_NUMBER = 1_000_000_000;

function isPrintableAscii(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

/** CSV cell quoting (S06): quote a field only when it needs it; `"` doubles. */
function csvCell(value: string): string {
  if (value.includes(',') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function requiredText(value: string, field: string): string {
  if (value === '') throw new PtxFormatError('EMPTY_REQUIRED_TEXT', `${field} must not be empty`, field);
  if (!isPrintableAscii(value)) {
    throw new PtxFormatError('TEXT_NOT_PRINTABLE_ASCII', `${field} must be printable ASCII`, field);
  }
  return csvCell(value);
}

function optionalText(value: string | undefined, field: string): string {
  if (value === undefined) return '';
  if (value === '') throw new PtxFormatError('EMPTY_OPTIONAL_TEXT', `${field} is either undefined or non-empty (empty cell means absent)`, field);
  return requiredText(value, field);
}

function checkFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new PtxFormatError('NUMBER_NOT_FINITE', `${field} must be finite`, field);
  }
  if (Math.abs(value) > MAX_ABS_NUMBER) {
    throw new PtxFormatError('NUMBER_OUT_OF_RANGE', `${field} exceeds the serializer sanity bound`, field);
  }
}

/**
 * Minimal deterministic representation: integer values without decimals,
 * otherwise fixed at `decimalPlaces` with trailing zeros stripped
 * ("462.5", "18", "0"). Throws when the value is not exactly representable
 * at the chosen resolution — callers must quantize deliberately.
 */
function formatMagnitude(value: number, field: string, decimalPlaces: number): string {
  checkFinite(value, field);
  const fixed = value.toFixed(decimalPlaces);
  if (Number.parseFloat(fixed) !== value) {
    throw new PtxFormatError(
      'MAGNITUDE_NOT_REPRESENTABLE',
      `${field}=${value} is not exactly representable at ${decimalPlaces} decimal place(s); quantize before serializing`,
      field,
    );
  }
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

function formatInteger(value: number, field: string): string {
  checkFinite(value, field);
  if (!Number.isInteger(value)) {
    throw new PtxFormatError('MAGNITUDE_NOT_REPRESENTABLE', `${field}=${value} must be an integer`, field);
  }
  return String(value);
}

function optionalNumber(
  value: number | undefined,
  field: string,
  format: (v: number, f: string) => string,
): string {
  return value === undefined ? '' : format(value, field);
}

/** HEADER VERSION keeps the documented form (1, 1.08, 1.17); max 2 decimals. */
function formatVersion(value: number, field: string): string {
  checkFinite(value, field);
  const text = String(value);
  if (text.includes('e') || text.includes('E')) {
    throw new PtxFormatError('VERSION_NOT_REPRESENTABLE', `${field}=${value} has no plain decimal form`, field);
  }
  const decimals = text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
  if (decimals > 2) {
    throw new PtxFormatError('VERSION_NOT_REPRESENTABLE', `${field}=${value} exceeds 2 decimals`, field);
  }
  return text;
}

function partReferenceCell(record: PtxCutRecord): string {
  const ref = record.partReference;
  if (ref.kind === 'none') return '0';
  if (ref.kind === 'part') return String(ref.partIndex);
  return `X${ref.offcutIndex}`;
}

function headerLine(doc: PtxDocument): string {
  const h = doc.header;
  return [
    'HEADER',
    formatVersion(h.version, 'HEADER.VERSION'),
    requiredText(h.title, 'HEADER.TITLE'),
    formatInteger(h.units, 'HEADER.UNITS'),
    formatInteger(h.origin, 'HEADER.ORIGIN'),
    formatInteger(h.trimType, 'HEADER.TRIM_TYPE'),
  ].join(',');
}

function jobLine(r: PtxJobRecord, f: Fmt): string {
  return [
    'JOBS',
    f.int(r.jobIndex, 'JOBS.JOB_INDEX'),
    f.text(r.name, 'JOBS.NAME'),
    f.optText(r.description, 'JOBS.DESC'),
    f.optText(r.orderDate, 'JOBS.ORD_DATE'),
    f.optText(r.cutDate, 'JOBS.CUT_DATE'),
    f.optText(r.customer, 'JOBS.CUSTOMER'),
    f.optInt(r.status, 'JOBS.STATUS'),
    f.optText(r.optParam, 'JOBS.OPT_PARAM'),
    f.optText(r.sawParam, 'JOBS.SAW_PARAM'),
    f.optNum(r.cutTime, 'JOBS.CUT_TIME', f.real),
    f.optNum(r.wastePercent, 'JOBS.WASTE_PCNT', f.real),
  ].join(',');
}

function partsReqLine(r: PtxPartsReqRecord, f: Fmt): string {
  return [
    'PARTS_REQ',
    f.int(r.jobIndex, 'PARTS_REQ.JOB_INDEX'),
    f.int(r.partIndex, 'PARTS_REQ.PART_INDEX'),
    f.text(r.code, 'PARTS_REQ.CODE'),
    f.int(r.materialIndex, 'PARTS_REQ.MAT_INDEX'),
    f.real(r.length, 'PARTS_REQ.LENGTH'),
    f.real(r.width, 'PARTS_REQ.WIDTH'),
    f.int(r.requiredQuantity, 'PARTS_REQ.QTY_REQ'),
    f.optInt(r.overQuantity, 'PARTS_REQ.QTY_OVER'),
    f.optInt(r.underQuantity, 'PARTS_REQ.QTY_UNDER'),
    f.int(r.grain, 'PARTS_REQ.GRAIN'),
    f.optInt(r.producedQuantity, 'PARTS_REQ.QTY_PROD'),
  ].join(',');
}

function boardLine(r: PtxBoardRecord, f: Fmt): string {
  return [
    'BOARDS',
    f.int(r.jobIndex, 'BOARDS.JOB_INDEX'),
    f.int(r.boardIndex, 'BOARDS.BRD_INDEX'),
    f.text(r.code, 'BOARDS.CODE'),
    f.int(r.materialIndex, 'BOARDS.MAT_INDEX'),
    f.real(r.length, 'BOARDS.LENGTH'),
    f.real(r.width, 'BOARDS.WIDTH'),
    f.optInt(r.stockQuantity, 'BOARDS.QTY_STOCK'),
    f.optInt(r.usedQuantity, 'BOARDS.QTY_USED'),
  ].join(',');
}

function materialLine(r: PtxMaterialRecord, f: Fmt): string {
  return [
    'MATERIALS',
    f.int(r.jobIndex, 'MATERIALS.JOB_INDEX'),
    f.int(r.materialIndex, 'MATERIALS.MAT_INDEX'),
    f.text(r.code, 'MATERIALS.CODE'),
    f.optText(r.description, 'MATERIALS.DESC'),
    f.real(r.thickness, 'MATERIALS.THICK'),
    f.int(r.bookQuantity, 'MATERIALS.BOOK'),
    f.real(r.kerfRip, 'MATERIALS.KERF_RIP'),
    f.real(r.kerfCrosscut, 'MATERIALS.KERF_XCT'),
    f.optNum(r.trimFRip, 'MATERIALS.TRIM_FRIP', f.real),
    f.optNum(r.trimVRip, 'MATERIALS.TRIM_VRIP', f.real),
    f.optNum(r.trimFXct, 'MATERIALS.TRIM_FXCT', f.real),
    f.optNum(r.trimVXct, 'MATERIALS.TRIM_VXCT', f.real),
    f.optNum(r.trimHead, 'MATERIALS.TRIM_HEAD', f.real),
    f.optNum(r.trimFRct, 'MATERIALS.TRIM_FRCT', f.real),
    f.optNum(r.trimVRct, 'MATERIALS.TRIM_VRCT', f.real),
    f.optInt(r.rule1, 'MATERIALS.RULE1'),
    f.optInt(r.rule2, 'MATERIALS.RULE2'),
    f.optInt(r.rule3, 'MATERIALS.RULE3'),
    f.optInt(r.rule4, 'MATERIALS.RULE4'),
  ].join(',');
}

function patternLine(r: PtxPatternRecord, f: Fmt): string {
  return [
    'PATTERNS',
    f.int(r.jobIndex, 'PATTERNS.JOB_INDEX'),
    f.int(r.patternIndex, 'PATTERNS.PTN_INDEX'),
    f.int(r.boardIndex, 'PATTERNS.BRD_INDEX'),
    f.int(r.patternType, 'PATTERNS.TYPE'),
    f.optInt(r.runQuantity, 'PATTERNS.QTY_RUN'),
    f.optInt(r.cyclesQuantity, 'PATTERNS.QTY_CYCLES'),
    f.optInt(r.maxBook, 'PATTERNS.MAX_BOOK'),
  ].join(',');
}

function cutLine(r: PtxCutRecord, f: Fmt): string {
  return [
    'CUTS',
    f.int(r.jobIndex, 'CUTS.JOB_INDEX'),
    f.int(r.patternIndex, 'CUTS.PTN_INDEX'),
    f.int(r.cutIndex, 'CUTS.CUT_INDEX'),
    f.int(r.sequence, 'CUTS.SEQUENCE'),
    f.int(r.functionCode, 'CUTS.FUNCTION'),
    f.real(r.dimension, 'CUTS.DIMENSION'),
    f.int(r.repeatQuantity, 'CUTS.QTY_RPT'),
    partReferenceCell(r),
    f.int(r.producedQuantity, 'CUTS.QTY_PARTS'),
    f.optText(r.comment, 'CUTS.COMMENT'),
  ].join(',');
}

function offcutLine(r: PtxOffcutRecord, f: Fmt): string {
  return [
    'OFFCUTS',
    f.int(r.jobIndex, 'OFFCUTS.JOB_INDEX'),
    f.int(r.offcutIndex, 'OFFCUTS.OFFCUT_INDEX'),
    f.text(r.code, 'OFFCUTS.CODE'),
    f.int(r.materialIndex, 'OFFCUTS.MAT_INDEX'),
    f.real(r.length, 'OFFCUTS.LENGTH'),
    f.real(r.width, 'OFFCUTS.WIDTH'),
  ].join(',');
}

function vectorLine(r: PtxVectorRecord, f: Fmt): string {
  return [
    'VECTORS',
    f.int(r.jobIndex, 'VECTORS.JOB_INDEX'),
    f.int(r.patternIndex, 'VECTORS.PTN_INDEX'),
    f.int(r.cutIndex, 'VECTORS.CUT_INDEX'),
    f.real(r.xStart, 'VECTORS.X_START'),
    f.real(r.yStart, 'VECTORS.Y_START'),
    f.real(r.xEnd, 'VECTORS.X_END'),
    f.real(r.yEnd, 'VECTORS.Y_END'),
  ].join(',');
}

interface Fmt {
  readonly int: (value: number, field: string) => string;
  readonly real: (value: number, field: string) => string;
  readonly optInt: (value: number | undefined, field: string) => string;
  readonly optNum: (
    value: number | undefined,
    field: string,
    format: (v: number, f: string) => string,
  ) => string;
  readonly text: (value: string, field: string) => string;
  readonly optText: (value: string | undefined, field: string) => string;
}

function makeFmt(decimalPlaces: number): Fmt {
  return {
    int: formatInteger,
    real: (value, field) => formatMagnitude(value, field, decimalPlaces),
    optInt: (value, field) => optionalNumber(value, field, formatInteger),
    optNum: optionalNumber,
    text: requiredText,
    optText: optionalText,
  };
}

/**
 * Serializes the document to PTX text (ASCII, deterministic).
 *
 * Fail-closed public boundary: validates first and throws
 * PtxDocumentInvalidError (carrying the issues) when the model is not valid,
 * so no bytes can be produced for a document validatePtxDocument rejects.
 */
export function serializePtxDocument(
  doc: PtxDocument,
  options: PtxSerializationOptions = {},
): string {
  const issues = validatePtxDocument(doc);
  if (issues.length > 0) {
    throw new PtxDocumentInvalidError(issues);
  }
  return serializePtxDocumentUnchecked(doc, options);
}

/**
 * Format-level serialization without the validation pass. Internal helper
 * for unit tests of CSV/number emission ONLY — never exported from the
 * package index; every real caller goes through serializePtxDocument.
 */
export function serializePtxDocumentUnchecked(
  doc: PtxDocument,
  options: PtxSerializationOptions = {},
): string {
  const decimalPlaces = options.decimalPlaces ?? DEFAULT_DECIMAL_PLACES;
  const lineEnding = options.lineEnding ?? DEFAULT_LINE_ENDING;
  const f = makeFmt(decimalPlaces);

  const lines: string[] = [headerLine(doc)];
  for (const record of doc.records) {
    switch (record.type) {
      case 'JOBS':
        lines.push(jobLine(record, f));
        break;
      case 'PARTS_REQ':
        lines.push(partsReqLine(record, f));
        break;
      case 'BOARDS':
        lines.push(boardLine(record, f));
        break;
      case 'MATERIALS':
        lines.push(materialLine(record, f));
        break;
      case 'PATTERNS':
        lines.push(patternLine(record, f));
        break;
      case 'CUTS':
        lines.push(cutLine(record, f));
        break;
      case 'OFFCUTS':
        lines.push(offcutLine(record, f));
        break;
      case 'VECTORS':
        lines.push(vectorLine(record, f));
        break;
    }
  }
  return `${lines.join(lineEnding)}${lineEnding}`;
}

/** Serializes a VALIDATED document to bytes (ASCII inside a Uint8Array). */
export function serializePtxDocumentBytes(
  doc: PtxDocument,
  options: PtxSerializationOptions = {},
): Uint8Array {
  // ASCII-only contract: every code point is ≤ 0x7F, so UTF-8 bytes == ASCII.
  return new TextEncoder().encode(serializePtxDocument(doc, options));
}
