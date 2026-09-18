/**
 * Strict Pattern Exchange specification preflight (#788 — r5 groundwork).
 *
 * r4 reached the field twice with a HEADER.TITLE of 43/31 characters while
 * the Pattern Exchange field dictionary documents a 25-character maximum.
 * That defect was objective (SPEC VIOLATION: CONFIRMED) but it was never the
 * PROVEN root cause of the CADLink rejections — this module makes no such
 * claim. Its job is narrower: no future candidate revision may ship bytes
 * that violate a documented limit of the exchange format.
 *
 * Boundaries (writer/validator independence — the point of #788):
 * - the rules below are derived from the PRIMARY SOURCE (S03: Magi-Cut
 *   Interface Guide V11, ch.3 Pattern Exchange) with a locator per limit;
 * - the bytes entry parses with the INDEPENDENT reader (parse.ts never
 *   imports the serializer), so a serializer bug cannot self-verify;
 * - this module never imports the compiler, the adapter or validate.ts:
 *   index/reference derivations are re-implemented here on purpose (the
 *   same deliberate-duplication policy as verifyCutPlanPtxReadback — a
 *   blind spot shared with the writer's own gate must not pass twice);
 * - `serializePtxDocumentBytesSpecChecked` is the fail-closed serialization
 *   boundary a future r5 route must call: bytes are returned only when the
 *   strict preflight accepts them. r2/r3/r4 do not call it — their bytes are
 *   frozen history and are EXPECTED to fail the title rule (that failure is
 *   the regression fixture, not something this PR repairs).
 *
 * Honesty rules that govern this catalog:
 * - every enforced limit carries classification + locator; nothing is
 *   invented, nothing is copied from the SAW side of the guide, and no
 *   CADmatic-SAW UTF-8 requirement is extrapolated to PTX;
 * - the guide itself warns (§4 p.118): "the limitations (eg. max length of
 *   material code) will vary according to the implementation and
 *   specification of the saw" — SPEC_REQUIRED is the FORMAT-level maximum,
 *   not a receiver compatibility claim. supportStatus stays NOT_TESTED.
 *
 * Documented but deliberately NOT enforced here (recorded, not invented
 * away): numeric QTY/DIM dictionary ranges (QTY max 99999, DIM 0.0–9999.9 in
 * mm mode — §20 p.166), the material-code space/upper-case import
 * normalization (§20 p.166 — receiver-side conversion, follow-up belongs
 * with the MATERIALS receiver tuning issue), and any PARTS_INF/PARTS_UDI
 * field (200-char info limits) until those families get their typed shape.
 */

import type {
  PtxDocument,
  PtxRecord,
} from './records';
import { parsePtxDocumentBytes, PtxParseError } from './parse';
import { serializePtxDocumentBytes, type PtxSerializationOptions } from './serialize';

// ---------------------------------------------------------------------------
// Authority model
// ---------------------------------------------------------------------------

/**
 * Classification of every restriction the preflight knows about:
 * - SPEC_REQUIRED: documented by the Pattern Exchange specification (S03)
 *   with a concrete locator — enforced by this preflight;
 * - RECEIVER_EVIDENCED: observed on real receiver files only;
 * - PRODUCT_POLICY: a Granete candidate decision (e.g. r4 part code max);
 * - UNKNOWN: documented ambiguously or not at all — never enforced.
 */
export type PtxSpecLimitClassification =
  | 'SPEC_REQUIRED'
  | 'RECEIVER_EVIDENCED'
  | 'PRODUCT_POLICY'
  | 'UNKNOWN';

/** Primary-source locator for one documented restriction. */
export interface PtxSpecLimitAuthority {
  readonly classification: PtxSpecLimitClassification;
  /** S03 = Magi-Cut Interface Guide V11 (docs/machines/ptx-cadmatic4/01 §2). */
  readonly locator: string;
}

const SPEC_REQUIRED = (locator: string): PtxSpecLimitAuthority => ({
  classification: 'SPEC_REQUIRED',
  locator,
});

// ---------------------------------------------------------------------------
// Documented limit catalog (S03 §20 "Summary of Data structure",
// printed pp. 166–178; header prose §4 p. 118 — quotes verbatim from the guide)
// ---------------------------------------------------------------------------

export interface PtxSpecTextLimit {
  readonly kind: 'text-length';
  readonly field: string;
  readonly maxLength: number;
  readonly authority: PtxSpecLimitAuthority;
}

export interface PtxSpecIntRangeLimit {
  readonly kind: 'int-range';
  readonly field: string;
  readonly min: number;
  readonly max: number;
  readonly authority: PtxSpecLimitAuthority;
}

export interface PtxSpecIntEnumLimit {
  readonly kind: 'int-enum';
  readonly field: string;
  readonly values: readonly number[];
  readonly authority: PtxSpecLimitAuthority;
}

export type PtxSpecLimit = PtxSpecTextLimit | PtxSpecIntRangeLimit | PtxSpecIntEnumLimit;

const P167 = 'S03 V11 Interface Guide §20 p.167';
const P118 = 'S03 V11 Interface Guide §4 p.118';

/**
 * Every limit enforced by ptxSpecPreflightDocument, each with its authority.
 * The dictionary types are the guide's own: TXT ("The maximum length of each
 * text field is listed in the comment column", §20 p.166) and IDX ("integer
 * values which are used to link records", with the per-record range in the
 * comment column).
 */
export const PTX_SPEC_LIMITS: readonly PtxSpecLimit[] = [
  // HEADER (§20 p.167: TITLE "TXT 25 chars max.", UNITS "INT 0,1",
  // ORIGIN "INT 0-3", TRIM_TYPE "INT 0,1"; §4 p.118 prose enumerates the
  // four ORIGIN quadrants and the UNITS/TRIM_TYPE meanings).
  { kind: 'text-length', field: 'HEADER.TITLE', maxLength: 25, authority: SPEC_REQUIRED(`${P167} 'TITLE File title TXT 25 chars max.'`) },
  { kind: 'int-enum', field: 'HEADER.UNITS', values: [0, 1], authority: SPEC_REQUIRED(`${P167} 'UNITS Measurement mode INT 0,1'; ${P118} '0 (metric), 1 (decimal inches)'`) },
  { kind: 'int-enum', field: 'HEADER.ORIGIN', values: [0, 1, 2, 3], authority: SPEC_REQUIRED(`${P167} 'ORIGIN Pattern origin INT 0-3'; ${P118} enumerates 0..3 (top/bottom × left/right)`) },
  { kind: 'int-enum', field: 'HEADER.TRIM_TYPE', values: [0, 1], authority: SPEC_REQUIRED(`${P167} 'TRIM_TYPE Fixed trim front or rear? INT 0,1'`) },
  // JOBS (§20 p.167).
  { kind: 'int-range', field: 'JOBS.JOB_INDEX', min: 1, max: 250, authority: SPEC_REQUIRED(`${P167} 'JOB_INDEX Job index IDX 1-250'`) },
  { kind: 'text-length', field: 'JOBS.NAME', maxLength: 50, authority: SPEC_REQUIRED(`${P167} 'NAME Job number/name TXT 50 chars max.'`) },
  { kind: 'text-length', field: 'JOBS.DESC', maxLength: 50, authority: SPEC_REQUIRED(`${P167} 'DESC Job description TXT 50 chars max'`) },
  { kind: 'text-length', field: 'JOBS.CUSTOMER', maxLength: 100, authority: SPEC_REQUIRED(`${P167} 'CUSTOMER Customer code TXT 100 chars max.'`) },
  { kind: 'text-length', field: 'JOBS.OPT_PARAM', maxLength: 50, authority: SPEC_REQUIRED(`${P167} 'OPT_PARAM Optimising parameters TXT 50 chars max.'`) },
  { kind: 'text-length', field: 'JOBS.SAW_PARAM', maxLength: 50, authority: SPEC_REQUIRED(`${P167} 'SAW_PARAM Saw parameters TXT 50 chars max.'`) },
  // PARTS_REQ (§20 p.168).
  { kind: 'int-range', field: 'PARTS_REQ.PART_INDEX', min: 1, max: 9999, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.168 \'PART_INDEX Part index IDX 1-9999\'') },
  { kind: 'int-range', field: 'PARTS_REQ.MAT_INDEX', min: 1, max: 9999, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.168 \'MAT_INDEX Material index IDX 1-9999\'') },
  { kind: 'text-length', field: 'PARTS_REQ.CODE', maxLength: 50, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.168 \'CODE Part code TXT 50 chars max.\'') },
  // BOARDS (§20 p.173).
  { kind: 'int-range', field: 'BOARDS.BRD_INDEX', min: 1, max: 5000, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.173 \'BRD_INDEX Board index IDX 1-5000\'') },
  { kind: 'int-range', field: 'BOARDS.MAT_INDEX', min: 1, max: 9999, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.173 \'MAT_INDEX Material index IDX 1-9999\'') },
  { kind: 'text-length', field: 'BOARDS.CODE', maxLength: 50, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.173 \'CODE Board code TXT 50 chars max\'') },
  // MATERIALS (§20 pp.173–174).
  { kind: 'int-range', field: 'MATERIALS.MAT_INDEX', min: 1, max: 9999, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.173 \'MAT_INDEX Material index IDX 1-9999\'') },
  { kind: 'text-length', field: 'MATERIALS.CODE', maxLength: 50, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.173 \'CODE Material code TXT 50 chars max\'') },
  { kind: 'text-length', field: 'MATERIALS.DESC', maxLength: 50, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.173 \'DESC Material description TXT 50 chars max\'') },
  // PATTERNS (§20 p.175).
  { kind: 'int-range', field: 'PATTERNS.PTN_INDEX', min: 1, max: 5000, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.175 \'PTN_INDEX Pattern index IDX 1-5000\'') },
  { kind: 'int-range', field: 'PATTERNS.BRD_INDEX', min: 1, max: 5000, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.175 \'BRD_INDEX Board index IDX 1-5000\'') },
  // OFFCUTS (§20 p.175).
  { kind: 'int-range', field: 'OFFCUTS.OFC_INDEX', min: 1, max: 7500, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.175 \'OFC_INDEX Offcut index IDX 1-7500\'') },
  { kind: 'int-range', field: 'OFFCUTS.MAT_INDEX', min: 1, max: 9999, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.175 \'MAT_INDEX Material index IDX 1-9999\'') },
  { kind: 'text-length', field: 'OFFCUTS.CODE', maxLength: 50, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.175 \'CODE Offcut code TXT 50 chars max\'') },
  // CUTS (§20 p.178).
  { kind: 'int-range', field: 'CUTS.CUT_INDEX', min: 1, max: 5000, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.178 \'CUT_INDEX Cut index IDX 1-5000\'') },
  { kind: 'text-length', field: 'CUTS.COMMENT', maxLength: 100, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.178 \'COMMENT Additional comment TXT 100 chars max\'') },
  // CUTS.PART_INDEX is a TXT reference '1-9999 or X1-X7500' (§20 p.178) —
  // enforced as a reference-range pair below.
  { kind: 'int-range', field: 'CUTS.PART_INDEX', min: 1, max: 9999, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.178 \'PART_INDEX Part/Offcut Index TXT 1-9999 or X1-X7500\'') },
  { kind: 'int-range', field: 'CUTS.PART_INDEX_X', min: 1, max: 7500, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.178 \'PART_INDEX Part/Offcut Index TXT 1-9999 or X1-X7500\'') },
];

const LIMIT_BY_FIELD = new Map(PTX_SPEC_LIMITS.map((limit) => [limit.field, limit]));

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type PtxSpecIssueCode =
  | 'ptx_spec.header_version_invalid'
  | 'ptx_spec.header_title_too_long'
  | 'ptx_spec.header_units_invalid'
  | 'ptx_spec.header_origin_invalid'
  | 'ptx_spec.header_trim_type_invalid'
  | 'ptx_spec.text_too_long'
  | 'ptx_spec.index_out_of_range'
  | 'ptx_spec.index_duplicate'
  | 'ptx_spec.index_not_consecutive'
  | 'ptx_spec.reference_unknown'
  | 'ptx_spec.parse_error';

export interface PtxSpecIssue {
  readonly code: PtxSpecIssueCode;
  readonly message: string;
  /** PTX dictionary field (e.g. 'HEADER.TITLE'). */
  readonly field: string;
  readonly classification: PtxSpecLimitClassification;
  readonly locator: string;
  readonly observed?: number | string;
  readonly maximum?: number;
  readonly minimum?: number;
}

/** Thrown by the spec-checked serialization boundary — never a bare Error. */
export class PtxSpecPreflightError extends Error {
  constructor(readonly issues: readonly PtxSpecIssue[]) {
    super(
      `PTX spec preflight BLOCK (${issues.length} violación(es) documentada(s)): ${issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );
    this.name = 'PtxSpecPreflightError';
  }
}

// ---------------------------------------------------------------------------
// Independent derivations (own tables — nothing shared with validate.ts)
// ---------------------------------------------------------------------------

interface SpecTables {
  readonly jobs: ReadonlySet<number>;
  readonly materialsByJob: ReadonlyMap<string, true>;
  readonly partsByJob: ReadonlyMap<string, true>;
  readonly boardsByJob: ReadonlyMap<string, true>;
  readonly patternsByJob: ReadonlyMap<string, true>;
  readonly offcutsByJob: ReadonlyMap<string, true>;
  /** key `${job}:${pattern}` → cutIndex set (VECTORS resolve exact rows). */
  readonly cutsByPattern: ReadonlyMap<string, ReadonlySet<number>>;
  /** Index samples per table key for the consecutive-from-1 rule. */
  readonly indexSamples: ReadonlyMap<string, { readonly index: number; readonly label: string }[]>;
}

function recordLabel(record: PtxRecord): string {
  switch (record.type) {
    case 'JOBS':
      return `JOBS job=${record.jobIndex}`;
    case 'PARTS_REQ':
      return `PARTS_REQ job=${record.jobIndex} part=${record.partIndex}`;
    case 'BOARDS':
      return `BOARDS job=${record.jobIndex} board=${record.boardIndex}`;
    case 'MATERIALS':
      return `MATERIALS job=${record.jobIndex} material=${record.materialIndex}`;
    case 'PATTERNS':
      return `PATTERNS job=${record.jobIndex} pattern=${record.patternIndex}`;
    case 'CUTS':
      return `CUTS job=${record.jobIndex} pattern=${record.patternIndex} cut=${record.cutIndex}`;
    case 'OFFCUTS':
      return `OFFCUTS job=${record.jobIndex} offcut=${record.offcutIndex}`;
    case 'VECTORS':
      return `VECTORS job=${record.jobIndex} pattern=${record.patternIndex} cut=${record.cutIndex}`;
  }
}

function buildSpecTables(doc: PtxDocument): SpecTables {
  const jobs = new Set<number>();
  const materialsByJob = new Map<string, true>();
  const partsByJob = new Map<string, true>();
  const boardsByJob = new Map<string, true>();
  const patternsByJob = new Map<string, true>();
  const offcutsByJob = new Map<string, true>();
  const cutsByPattern = new Map<string, Set<number>>();
  const indexSamples = new Map<string, { index: number; label: string }[]>();
  const sample = (table: string, index: number, label: string): void => {
    const list = indexSamples.get(table) ?? [];
    list.push({ index, label });
    indexSamples.set(table, list);
  };

  for (const record of doc.records) {
    switch (record.type) {
      case 'JOBS':
        jobs.add(record.jobIndex);
        sample('JOBS', record.jobIndex, recordLabel(record));
        break;
      case 'MATERIALS':
        materialsByJob.set(`${record.jobIndex}:${record.materialIndex}`, true);
        sample(`MATERIALS@${record.jobIndex}`, record.materialIndex, recordLabel(record));
        break;
      case 'PARTS_REQ':
        partsByJob.set(`${record.jobIndex}:${record.partIndex}`, true);
        sample(`PARTS_REQ@${record.jobIndex}`, record.partIndex, recordLabel(record));
        break;
      case 'BOARDS':
        boardsByJob.set(`${record.jobIndex}:${record.boardIndex}`, true);
        sample(`BOARDS@${record.jobIndex}`, record.boardIndex, recordLabel(record));
        break;
      case 'PATTERNS':
        patternsByJob.set(`${record.jobIndex}:${record.patternIndex}`, true);
        sample(`PATTERNS@${record.jobIndex}`, record.patternIndex, recordLabel(record));
        break;
      case 'OFFCUTS':
        offcutsByJob.set(`${record.jobIndex}:${record.offcutIndex}`, true);
        sample(`OFFCUTS@${record.jobIndex}`, record.offcutIndex, recordLabel(record));
        break;
      case 'CUTS': {
        const key = `${record.jobIndex}:${record.patternIndex}`;
        const cuts = cutsByPattern.get(key) ?? new Set<number>();
        cuts.add(record.cutIndex);
        cutsByPattern.set(key, cuts);
        sample(`CUTS@${key}`, record.cutIndex, recordLabel(record));
        break;
      }
      default:
        break;
    }
  }
  return { jobs, materialsByJob, partsByJob, boardsByJob, patternsByJob, offcutsByJob, cutsByPattern, indexSamples };
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function checkHeaderSpec(doc: PtxDocument, issues: PtxSpecIssue[]): void {
  const h = doc.header;
  // VERSION: the guide's own texts disagree (§20 p.167 'Set to 1.06', §4
  // p.118 '(1.08)', every example uses 1 — investigation §9 keeps this open),
  // so the enforced rule is only "a positive finite version number". Pinning
  // one exact value would invent a limit.
  if (!Number.isFinite(h.version) || h.version <= 0) {
    issues.push({
      code: 'ptx_spec.header_version_invalid',
      message: `HEADER.VERSION=${h.version} no es un número de versión positivo finito (el valor exacto documentado es ambiguo: 1.06 vs 1.08 vs ejemplos con 1 — investigación §9; no se fija un único valor)`,
      field: 'HEADER.VERSION',
      classification: 'SPEC_REQUIRED',
      locator: `${P167} 'VERSION File version TXT Set to 1.06'; ${P118} '(1.08)'; ejemplos §3/§18 usan 1`,
      observed: String(h.version),
    });
  }
  const title = LIMIT_BY_FIELD.get('HEADER.TITLE') as PtxSpecTextLimit;
  if (h.title.length > title.maxLength) {
    issues.push({
      code: 'ptx_spec.header_title_too_long',
      message: `HEADER.TITLE tiene ${h.title.length} caracteres y el máximo documentado es ${title.maxLength} ('${h.title}' no se trunca ni se reescribe: fail closed)`,
      field: 'HEADER.TITLE',
      classification: title.authority.classification,
      locator: title.authority.locator,
      observed: h.title.length,
      maximum: title.maxLength,
    });
  }
  const enumChecks = [
    { field: 'HEADER.UNITS', value: h.units, code: 'ptx_spec.header_units_invalid' as const, meaning: '0 (metric), 1 (decimal inches)' },
    { field: 'HEADER.ORIGIN', value: h.origin, code: 'ptx_spec.header_origin_invalid' as const, meaning: '0..3 (cuadrantes top/bottom × left/right)' },
    { field: 'HEADER.TRIM_TYPE', value: h.trimType, code: 'ptx_spec.header_trim_type_invalid' as const, meaning: '0 waste first, 1 fixed trim first' },
  ];
  for (const check of enumChecks) {
    const limit = LIMIT_BY_FIELD.get(check.field) as PtxSpecIntEnumLimit;
    if (!limit.values.includes(check.value)) {
      issues.push({
        code: check.code,
        message: `${check.field}=${check.value} no está en el diccionario documentado [${limit.values.join(', ')}] (${check.meaning})`,
        field: check.field,
        classification: limit.authority.classification,
        locator: limit.authority.locator,
        observed: check.value,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Per-record field limits
// ---------------------------------------------------------------------------

function textIssue(
  value: string,
  field: string,
  rowLabel: string,
  issues: PtxSpecIssue[],
): void {
  const limit = LIMIT_BY_FIELD.get(field) as PtxSpecTextLimit | undefined;
  if (!limit || value.length <= limit.maxLength) return;
  issues.push({
    code: 'ptx_spec.text_too_long',
    message: `${rowLabel} ${field} tiene ${value.length} caracteres y el máximo documentado es ${limit.maxLength}`,
    field,
    classification: limit.authority.classification,
    locator: limit.authority.locator,
    observed: value.length,
    maximum: limit.maxLength,
  });
}

function intRangeIssue(
  value: number,
  field: string,
  rowLabel: string,
  issues: PtxSpecIssue[],
): void {
  const limit = LIMIT_BY_FIELD.get(field) as PtxSpecIntRangeLimit | undefined;
  if (!limit) return;
  if (!Number.isInteger(value) || value < limit.min || value > limit.max) {
    issues.push({
      code: 'ptx_spec.index_out_of_range',
      message: `${rowLabel} ${field}=${value} fuera del rango documentado [${limit.min}..${limit.max}]`,
      field,
      classification: limit.authority.classification,
      locator: limit.authority.locator,
      observed: value,
      minimum: limit.min,
      maximum: limit.max,
    });
  }
}

function checkRecordFields(record: PtxRecord, issues: PtxSpecIssue[]): void {
  const label = recordLabel(record);
  switch (record.type) {
    case 'JOBS':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      textIssue(record.name, 'JOBS.NAME', label, issues);
      if (record.description !== undefined) textIssue(record.description, 'JOBS.DESC', label, issues);
      if (record.customer !== undefined) textIssue(record.customer, 'JOBS.CUSTOMER', label, issues);
      if (record.optParam !== undefined) textIssue(record.optParam, 'JOBS.OPT_PARAM', label, issues);
      if (record.sawParam !== undefined) textIssue(record.sawParam, 'JOBS.SAW_PARAM', label, issues);
      break;
    case 'PARTS_REQ':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.partIndex, 'PARTS_REQ.PART_INDEX', label, issues);
      intRangeIssue(record.materialIndex, 'PARTS_REQ.MAT_INDEX', label, issues);
      textIssue(record.code, 'PARTS_REQ.CODE', label, issues);
      break;
    case 'BOARDS':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.boardIndex, 'BOARDS.BRD_INDEX', label, issues);
      intRangeIssue(record.materialIndex, 'BOARDS.MAT_INDEX', label, issues);
      textIssue(record.code, 'BOARDS.CODE', label, issues);
      break;
    case 'MATERIALS':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.materialIndex, 'MATERIALS.MAT_INDEX', label, issues);
      textIssue(record.code, 'MATERIALS.CODE', label, issues);
      if (record.description !== undefined) textIssue(record.description, 'MATERIALS.DESC', label, issues);
      break;
    case 'PATTERNS':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.patternIndex, 'PATTERNS.PTN_INDEX', label, issues);
      intRangeIssue(record.boardIndex, 'PATTERNS.BRD_INDEX', label, issues);
      break;
    case 'OFFCUTS':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.offcutIndex, 'OFFCUTS.OFC_INDEX', label, issues);
      intRangeIssue(record.materialIndex, 'OFFCUTS.MAT_INDEX', label, issues);
      if (record.code !== undefined) textIssue(record.code, 'OFFCUTS.CODE', label, issues);
      break;
    case 'CUTS': {
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.patternIndex, 'PATTERNS.PTN_INDEX', label, issues);
      intRangeIssue(record.cutIndex, 'CUTS.CUT_INDEX', label, issues);
      if (record.comment !== undefined) textIssue(record.comment, 'CUTS.COMMENT', label, issues);
      const ref = record.partReference;
      if (ref.kind === 'part') {
        intRangeIssue(ref.partIndex, 'CUTS.PART_INDEX', label, issues);
      } else if (ref.kind === 'offcut') {
        intRangeIssue(ref.offcutIndex, 'CUTS.PART_INDEX_X', label, issues);
      }
      break;
    }
    case 'VECTORS':
      // §20 has no VECTORS row (§17 p.146 documents it in prose); only the
      // referential checks below apply — no numeric caps are invented here.
      break;
  }
}

// ---------------------------------------------------------------------------
// Index consecutiveness + references (own derivation)
// ---------------------------------------------------------------------------

function checkIndexConsecutiveness(tables: SpecTables, issues: PtxSpecIssue[]): void {
  // §20 p.166: "The job records must have unique job index numbers starting
  // at 1, and incrementing consecutively within specified range. The part,
  // board and pattern records must each have their respective index numbers
  // unique within the job, and again be numbered from 1 and incremented
  // consecutively." §4 p.118 extends it to ALL index numbers.
  for (const [table, samples] of tables.indexSamples) {
    const seen = new Set<number>();
    for (const { index, label } of samples) {
      if (index < 1 || !Number.isInteger(index)) {
        issues.push({
          code: 'ptx_spec.index_out_of_range',
          message: `${label}: índice ${index} debe ser un entero ≥ 1`,
          field: table.split('@')[0]!,
          classification: 'SPEC_REQUIRED',
          locator: `${P118} 'All 'index numbers' must be integer values, starting at 1 …'`,
          observed: index,
        });
      }
      if (seen.has(index)) {
        issues.push({
          code: 'ptx_spec.index_duplicate',
          message: `${label}: índice ${index} duplicado en la tabla ${table}`,
          field: table.split('@')[0]!,
          classification: 'SPEC_REQUIRED',
          locator: 'S03 V11 Interface Guide §20 p.166 \'…index numbers unique within the job…\'',
          observed: index,
        });
      }
      seen.add(index);
    }
    const sorted = [...seen].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        issues.push({
          code: 'ptx_spec.index_not_consecutive',
          message: `tabla ${table}: índices [${sorted.join(',')}] no son consecutivos desde 1 (faltan filas o hay saltos ilegales)`,
          field: table.split('@')[0]!,
          classification: 'SPEC_REQUIRED',
          locator: `${P118} '…starting at 1 for the first record, and incrementing consecutively up to the maximum specified'`,
          observed: sorted.join(','),
        });
        break;
      }
    }
  }
}

function checkReferences(doc: PtxDocument, tables: SpecTables, issues: PtxSpecIssue[]): void {
  const unknown = (
    code: 'ptx_spec.reference_unknown',
    message: string,
    field: string,
    observed: number | string,
  ): void => {
    issues.push({ code, message, field, classification: 'SPEC_REQUIRED', locator: `${P118} '…all part, board, pattern and cutting records must contain the appropriate job index number…' + §20 tablas IDX`, observed });
  };
  for (const record of doc.records) {
    const label = recordLabel(record);
    if (record.type !== 'JOBS' && !tables.jobs.has(record.jobIndex)) {
      unknown('ptx_spec.reference_unknown', `${label} JOB_INDEX=${record.jobIndex} no tiene fila JOBS`, 'JOB_INDEX', record.jobIndex);
    }
    switch (record.type) {
      case 'PARTS_REQ':
        if (!tables.materialsByJob.has(`${record.jobIndex}:${record.materialIndex}`)) {
          unknown('ptx_spec.reference_unknown', `${label} MAT_INDEX=${record.materialIndex} sin MATERIALS en el job ${record.jobIndex}`, 'PARTS_REQ.MAT_INDEX', record.materialIndex);
        }
        break;
      case 'BOARDS':
        if (!tables.materialsByJob.has(`${record.jobIndex}:${record.materialIndex}`)) {
          unknown('ptx_spec.reference_unknown', `${label} MAT_INDEX=${record.materialIndex} sin MATERIALS en el job ${record.jobIndex}`, 'BOARDS.MAT_INDEX', record.materialIndex);
        }
        break;
      case 'OFFCUTS':
        if (!tables.materialsByJob.has(`${record.jobIndex}:${record.materialIndex}`)) {
          unknown('ptx_spec.reference_unknown', `${label} MAT_INDEX=${record.materialIndex} sin MATERIALS en el job ${record.jobIndex}`, 'OFFCUTS.MAT_INDEX', record.materialIndex);
        }
        break;
      case 'PATTERNS':
        if (!tables.boardsByJob.has(`${record.jobIndex}:${record.boardIndex}`)) {
          unknown('ptx_spec.reference_unknown', `${label} BRD_INDEX=${record.boardIndex} sin BOARDS en el job ${record.jobIndex}`, 'PATTERNS.BRD_INDEX', record.boardIndex);
        }
        break;
      case 'CUTS':
        if (!tables.patternsByJob.has(`${record.jobIndex}:${record.patternIndex}`)) {
          unknown('ptx_spec.reference_unknown', `${label} PTN_INDEX=${record.patternIndex} sin PATTERNS en el job ${record.jobIndex}`, 'CUTS.PTN_INDEX', record.patternIndex);
        }
        if (record.partReference.kind === 'part' && !tables.partsByJob.has(`${record.jobIndex}:${record.partReference.partIndex}`)) {
          unknown('ptx_spec.reference_unknown', `${label} PART_INDEX=${record.partReference.partIndex} sin PARTS_REQ en el job ${record.jobIndex}`, 'CUTS.PART_INDEX', record.partReference.partIndex);
        }
        if (record.partReference.kind === 'offcut' && !tables.offcutsByJob.has(`${record.jobIndex}:${record.partReference.offcutIndex}`)) {
          unknown('ptx_spec.reference_unknown', `${label} PART_INDEX=X${record.partReference.offcutIndex} sin OFFCUTS en el job ${record.jobIndex}`, 'CUTS.PART_INDEX', `X${record.partReference.offcutIndex}`);
        }
        break;
      case 'VECTORS':
        if (!tables.patternsByJob.has(`${record.jobIndex}:${record.patternIndex}`)) {
          unknown('ptx_spec.reference_unknown', `${label} PTN_INDEX=${record.patternIndex} sin PATTERNS en el job ${record.jobIndex}`, 'VECTORS.PTN_INDEX', record.patternIndex);
        } else if (!tables.cutsByPattern.get(`${record.jobIndex}:${record.patternIndex}`)?.has(record.cutIndex)) {
          unknown('ptx_spec.reference_unknown', `${label} CUT_INDEX=${record.cutIndex} sin fila CUTS en el patrón ${record.patternIndex} del job ${record.jobIndex}`, 'VECTORS.CUT_INDEX', record.cutIndex);
        }
        break;
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Strict Pattern Exchange spec validation of a typed document. An empty
 * result means "no documented limit is violated" — NOT receiver
 * compatibility (NOT_TESTED/notClaimed is unchanged by a PASS here).
 */
export function ptxSpecPreflightDocument(doc: PtxDocument): readonly PtxSpecIssue[] {
  const issues: PtxSpecIssue[] = [];
  checkHeaderSpec(doc, issues);
  const tables = buildSpecTables(doc);
  for (const record of doc.records) {
    checkRecordFields(record, issues);
  }
  checkIndexConsecutiveness(tables, issues);
  checkReferences(doc, tables, issues);
  return issues;
}

/**
 * Strict spec preflight of serialized BYTES: decodes and parses with the
 * independent reader, then applies the same rule set. A serializer/column
 * defect surfaces here even when the in-memory document looked valid — the
 * check never consults the writer's own state.
 */
export function ptxSpecPreflightBytes(bytes: Uint8Array): readonly PtxSpecIssue[] {
  let doc: PtxDocument;
  try {
    doc = parsePtxDocumentBytes(bytes);
  } catch (error) {
    const detail = error instanceof PtxParseError ? error.message : error instanceof Error ? error.message : String(error);
    return [
      {
        code: 'ptx_spec.parse_error',
        message: `los bytes no se dejan leer como Pattern Exchange del subconjunto soportado: ${detail}`,
        field: '(bytes)',
        classification: 'SPEC_REQUIRED',
        locator: `${P118} estructura CSV/registros del Pattern Exchange`,
      },
    ];
  }
  return ptxSpecPreflightDocument(doc);
}

/**
 * Fail-closed serialization boundary for candidate revisions that declare
 * Pattern Exchange spec conformance (#788): the bytes are produced by the
 * normal serializer and returned ONLY when the strict spec preflight accepts
 * them; otherwise PtxSpecPreflightError carries every ptx_spec.* issue.
 * r2/r3/r4 do not use this boundary — their bytes are frozen history.
 */
export function serializePtxDocumentBytesSpecChecked(
  doc: PtxDocument,
  options: PtxSerializationOptions = {},
): Uint8Array {
  const bytes = serializePtxDocumentBytes(doc, options);
  const issues = ptxSpecPreflightBytes(bytes);
  if (issues.length > 0) {
    throw new PtxSpecPreflightError(issues);
  }
  return bytes;
}

/**
 * The candidate revision token understood by the compiler option and this
 * preflight ('pattern-exchange-v1' = the S03 V11 documented limit set above).
 */
export const PTX_SPEC_PREFLIGHT_REVISION = 'pattern-exchange-v1' as const;
export type PtxSpecPreflightRevision = typeof PTX_SPEC_PREFLIGHT_REVISION;
