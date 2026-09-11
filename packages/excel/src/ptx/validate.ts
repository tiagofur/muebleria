/**
 * Relation, column-position and magnitude validation for the documented PTX
 * subset (#650 PR 4 core).
 *
 * validatePtxDocument operates on the TYPED model, so it guards both parsed
 * documents and hand-built records (records → validate → serialize is a
 * legitimate pipeline). It never mutates and never reads bytes.
 *
 * Rules come from docs/machines/ptx-cadmatic4/01_investigacion_y_contrato.md
 * §4 and the examples; unknown-but-documented semantics are NOT enforced
 * (fail-closed on ambiguity means rejecting, not inventing rules).
 *
 * Index policy: PTX tables are per-job row tables (S03 pp.114–117), so every
 * index family must be contiguous 1..N within its job. A gap means a dropped
 * row (a deleted cut must be caught HERE, not by a lucky byte comparison).
 */

import {
  describePtxCutFunction,
  isDocumentedPtxCutFunctionCode,
  isSupportedPtxCutFunctionCode,
  PTX_SUPPORTED_CUT_FUNCTION_CODES,
  type PtxBoardRecord,
  type PtxCutRecord,
  type PtxDocument,
  type PtxJobRecord,
  type PtxMaterialRecord,
  type PtxOffcutRecord,
  type PtxPartsReqRecord,
  type PtxPatternRecord,
  type PtxRecord,
  type PtxVectorRecord,
} from './records';

export type PtxValidationCode =
  | 'INVALID_ENUM_VALUE'
  | 'INVALID_TEXT'
  | 'DUPLICATE_INDEX'
  | 'INDEX_NOT_CONTIGUOUS'
  | 'UNKNOWN_JOB_REFERENCE'
  | 'UNKNOWN_MATERIAL_REFERENCE'
  | 'UNKNOWN_BOARD_REFERENCE'
  | 'UNKNOWN_PATTERN_REFERENCE'
  | 'UNKNOWN_PART_REFERENCE'
  | 'UNKNOWN_OFFCUT_REFERENCE'
  | 'UNKNOWN_CUT_REFERENCE'
  | 'INVALID_FUNCTION_CODE'
  | 'UNSUPPORTED_FUNCTION_CODE'
  | 'INVALID_MAGNITUDE'
  | 'INVALID_QUANTITY'
  | 'INVALID_VERSION';

export interface PtxValidationIssue {
  readonly code: PtxValidationCode;
  readonly message: string;
}

type Issue = PtxValidationIssue;

/**
 * Thrown by validated boundaries (assertValidPtxDocument,
 * serializePtxDocument) — never a generic Error without cause: it carries the
 * validation issues that blocked the document.
 */
export class PtxDocumentInvalidError extends Error {
  constructor(readonly issues: readonly PtxValidationIssue[]) {
    super(
      `PTX document is not valid (${issues.length} issue(s)): ${issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );
    this.name = 'PtxDocumentInvalidError';
  }
}

function isPrintableAscii(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

function textIssues(value: string | undefined, label: string, required: boolean, issues: Issue[]): void {
  if (value === undefined) {
    if (required) issues.push({ code: 'INVALID_TEXT', message: `${label} is required` });
    return;
  }
  if (value === '') {
    issues.push({ code: 'INVALID_TEXT', message: `${label} must be a non-empty string or undefined (empty cell means absent)` });
    return;
  }
  if (!isPrintableAscii(value)) {
    issues.push({ code: 'INVALID_TEXT', message: `${label} must be printable ASCII` });
  }
}

function magnitudeIssue(value: number, label: string, minExclusive: boolean, issues: Issue[]): void {
  // Finite first: NaN escapes `<= 0` and Infinity passes as positive, and the
  // validator — not the serializer — owns the "valid ⇒ representable" contract.
  if (!Number.isFinite(value)) {
    issues.push({
      code: 'INVALID_MAGNITUDE',
      message: `${label}=${value} must be a finite number`,
    });
    return;
  }
  if (minExclusive ? value <= 0 : value < 0) {
    issues.push({
      code: 'INVALID_MAGNITUDE',
      message: `${label}=${value} must be ${minExclusive ? '> 0' : '>= 0'}`,
    });
  }
}

function quantityIssue(value: number, label: string, min: number, issues: Issue[]): void {
  if (!Number.isInteger(value) || value < min) {
    issues.push({
      code: 'INVALID_QUANTITY',
      message: `${label}=${value} must be an integer >= ${min}`,
    });
  }
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

/**
 * Indexes of one family inside one job must be exactly 1..N in appearance
 * order. Duplicates and gaps are reported separately so a mutated file fails
 * for a concrete reason.
 */
function checkContiguousIndexes(
  values: readonly { readonly index: number; readonly label: string }[],
  issues: Issue[],
): void {
  const seen = new Set<number>();
  for (const { index, label } of values) {
    if (index < 1 || !Number.isInteger(index)) {
      issues.push({ code: 'INDEX_NOT_CONTIGUOUS', message: `${label}: index ${index} must be an integer >= 1` });
    }
    if (seen.has(index)) {
      issues.push({ code: 'DUPLICATE_INDEX', message: `${label}: duplicate index ${index}` });
    }
    seen.add(index);
  }
  const sorted = [...seen].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      issues.push({
        code: 'INDEX_NOT_CONTIGUOUS',
        message: `indices ${sorted.join(',')} are not contiguous 1..${sorted.length}; a row may be missing`,
      });
      break;
    }
  }
}

interface JobTables {
  readonly jobs: ReadonlySet<number>;
  readonly materials: ReadonlyMap<string, PtxMaterialRecord>;
  readonly parts: ReadonlyMap<string, PtxPartsReqRecord>;
  readonly boards: ReadonlyMap<string, PtxBoardRecord>;
  readonly patterns: ReadonlyMap<string, PtxPatternRecord>;
  readonly offcuts: ReadonlyMap<string, PtxOffcutRecord>;
  /** cutIndex set per `${job}:${pattern}` so VECTORS can resolve exact rows. */
  readonly cutsByPattern: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * Index tables are PER JOB (PTX tables are job-scoped, S03 pp.114–117);
   * cuts are per pattern. key: job for table families, `${job}:${pattern}`
   * for cuts.
   */
  readonly indexTables: ReadonlyMap<string, readonly { index: number; label: string }[]>;
}

function buildTables(doc: PtxDocument): JobTables {
  const jobs = new Set<number>();
  const materials = new Map<string, PtxMaterialRecord>();
  const parts = new Map<string, PtxPartsReqRecord>();
  const boards = new Map<string, PtxBoardRecord>();
  const patterns = new Map<string, PtxPatternRecord>();
  const offcuts = new Map<string, PtxOffcutRecord>();
  const cutsByPattern = new Map<string, Set<number>>();
  const indexTables = new Map<string, { index: number; label: string }[]>();

  const key = (job: number, index: number) => `${job}:${index}`;
  const pushIndex = (table: string, index: number, label: string) => {
    let list = indexTables.get(table);
    if (!list) {
      list = [];
      indexTables.set(table, list);
    }
    list.push({ index, label });
  };

  for (const record of doc.records) {
    switch (record.type) {
      case 'JOBS':
        jobs.add(record.jobIndex);
        // Job indexes form one file-wide table (1..N), unlike the per-job
        // row tables below.
        pushIndex('JOBS', record.jobIndex, recordLabel(record));
        break;
      case 'MATERIALS':
        materials.set(key(record.jobIndex, record.materialIndex), record);
        pushIndex(`MATERIALS/${record.jobIndex}`, record.materialIndex, recordLabel(record));
        break;
      case 'PARTS_REQ':
        parts.set(key(record.jobIndex, record.partIndex), record);
        pushIndex(`PARTS_REQ/${record.jobIndex}`, record.partIndex, recordLabel(record));
        break;
      case 'BOARDS':
        boards.set(key(record.jobIndex, record.boardIndex), record);
        pushIndex(`BOARDS/${record.jobIndex}`, record.boardIndex, recordLabel(record));
        break;
      case 'PATTERNS':
        patterns.set(key(record.jobIndex, record.patternIndex), record);
        pushIndex(`PATTERNS/${record.jobIndex}`, record.patternIndex, recordLabel(record));
        break;
      case 'OFFCUTS':
        offcuts.set(key(record.jobIndex, record.offcutIndex), record);
        pushIndex(`OFFCUTS/${record.jobIndex}`, record.offcutIndex, recordLabel(record));
        break;
      case 'CUTS': {
        const patternKey = key(record.jobIndex, record.patternIndex);
        let cuts = cutsByPattern.get(patternKey);
        if (!cuts) {
          cuts = new Set<number>();
          cutsByPattern.set(patternKey, cuts);
        }
        cuts.add(record.cutIndex);
        pushIndex(`CUTS/${patternKey}`, record.cutIndex, recordLabel(record));
        break;
      }
      default:
        break;
    }
  }
  return { jobs, materials, parts, boards, patterns, offcuts, cutsByPattern, indexTables };
}

function checkHeader(doc: PtxDocument, issues: Issue[]): void {
  const h = doc.header;
  if (h.units !== 0 && h.units !== 1) {
    issues.push({ code: 'INVALID_ENUM_VALUE', message: `HEADER.UNITS=${h.units} must be 0 (metric) or 1 (decimal inches)` });
  }
  if (h.trimType !== 0 && h.trimType !== 1) {
    issues.push({ code: 'INVALID_ENUM_VALUE', message: `HEADER.TRIM_TYPE=${h.trimType} must be 0 or 1` });
  }
  if (!Number.isFinite(h.version) || h.version <= 0) {
    issues.push({ code: 'INVALID_VERSION', message: `HEADER.VERSION=${h.version} must be > 0` });
  }
  if (!Number.isInteger(h.origin) || h.origin < 0) {
    issues.push({ code: 'INVALID_ENUM_VALUE', message: `HEADER.ORIGIN=${h.origin} must be a non-negative integer` });
  }
  textIssues(h.title, 'HEADER.TITLE', true, issues);
}

function checkJob(record: PtxJobRecord, issues: Issue[]): void {
  // JOB_INDEX is checked centrally by checkIndexFields.
  textIssues(record.name, `${recordLabel(record)} NAME`, true, issues);
  textIssues(record.description, `${recordLabel(record)} DESC`, false, issues);
  textIssues(record.orderDate, `${recordLabel(record)} ORD_DATE`, false, issues);
  textIssues(record.cutDate, `${recordLabel(record)} CUT_DATE`, false, issues);
  textIssues(record.customer, `${recordLabel(record)} CUSTOMER`, false, issues);
  textIssues(record.optParam, `${recordLabel(record)} OPT_PARAM`, false, issues);
  textIssues(record.sawParam, `${recordLabel(record)} SAW_PARAM`, false, issues);
  if (record.status !== undefined) quantityIssue(record.status, `${recordLabel(record)} STATUS`, 0, issues);
  if (record.cutTime !== undefined) magnitudeIssue(record.cutTime, `${recordLabel(record)} CUT_TIME`, false, issues);
  if (record.wastePercent !== undefined) magnitudeIssue(record.wastePercent, `${recordLabel(record)} WASTE_PCNT`, false, issues);
}

function checkPartsReq(record: PtxPartsReqRecord, issues: Issue[]): void {
  quantityIssue(record.requiredQuantity, `${recordLabel(record)} QTY_REQ`, 1, issues);
  if (record.overQuantity !== undefined) {
    quantityIssue(record.overQuantity, `${recordLabel(record)} QTY_OVER`, 0, issues);
  }
  if (record.underQuantity !== undefined) {
    quantityIssue(record.underQuantity, `${recordLabel(record)} QTY_UNDER`, 0, issues);
  }
  if (record.producedQuantity !== undefined) {
    quantityIssue(record.producedQuantity, `${recordLabel(record)} QTY_PROD`, 0, issues);
  }
  if (record.grain < 0 || record.grain > 2 || !Number.isInteger(record.grain)) {
    issues.push({ code: 'INVALID_ENUM_VALUE', message: `${recordLabel(record)} GRAIN=${record.grain} must be 0, 1 or 2` });
  }
  magnitudeIssue(record.length, `${recordLabel(record)} LENGTH`, true, issues);
  magnitudeIssue(record.width, `${recordLabel(record)} WIDTH`, true, issues);
  textIssues(record.code, `${recordLabel(record)} CODE`, true, issues);
}

function checkBoard(record: PtxBoardRecord, issues: Issue[]): void {
  magnitudeIssue(record.length, `${recordLabel(record)} LENGTH`, true, issues);
  magnitudeIssue(record.width, `${recordLabel(record)} WIDTH`, true, issues);
  textIssues(record.code, `${recordLabel(record)} CODE`, true, issues);
  if (record.stockQuantity !== undefined) {
    quantityIssue(record.stockQuantity, `${recordLabel(record)} QTY_STOCK`, 1, issues);
  }
  if (record.usedQuantity !== undefined) {
    quantityIssue(record.usedQuantity, `${recordLabel(record)} QTY_USED`, 0, issues);
  }
}

function checkMaterial(record: PtxMaterialRecord, issues: Issue[]): void {
  // Missing thickness or measures must BLOCK (investigation §4 BOARDS/MATERIALS
  // rule) — there is no default thickness here.
  magnitudeIssue(record.thickness, `${recordLabel(record)} THICK`, true, issues);
  quantityIssue(record.bookQuantity, `${recordLabel(record)} BOOK`, 1, issues);
  magnitudeIssue(record.kerfRip, `${recordLabel(record)} KERF_RIP`, false, issues);
  magnitudeIssue(record.kerfCrosscut, `${recordLabel(record)} KERF_XCT`, false, issues);
  for (const [field, value] of [
    ['TRIM_FRIP', record.trimFRip],
    ['TRIM_VRIP', record.trimVRip],
    ['TRIM_FXCT', record.trimFXct],
    ['TRIM_VXCT', record.trimVXct],
    ['TRIM_HEAD', record.trimHead],
    ['TRIM_FRCT', record.trimFRct],
    ['TRIM_VRCT', record.trimVRct],
  ] as const) {
    if (value !== undefined) magnitudeIssue(value, `${recordLabel(record)} ${field}`, false, issues);
  }
  textIssues(record.code, `${recordLabel(record)} CODE`, true, issues);
  textIssues(record.description, `${recordLabel(record)} DESC`, false, issues);
}

function checkPattern(record: PtxPatternRecord, issues: Issue[]): void {
  if (![0, 1, 2, 3, 4].includes(record.patternType)) {
    issues.push({
      code: 'INVALID_ENUM_VALUE',
      message: `${recordLabel(record)} TYPE=${record.patternType} is outside the first-profile subset [0..4] (5–8 are grain-matching templates, S12)`,
    });
  }
  if (record.runQuantity !== undefined) {
    quantityIssue(record.runQuantity, `${recordLabel(record)} QTY_RUN`, 1, issues);
  }
  if (record.cyclesQuantity !== undefined) {
    quantityIssue(record.cyclesQuantity, `${recordLabel(record)} QTY_CYCLES`, 1, issues);
  }
  if (record.maxBook !== undefined) {
    quantityIssue(record.maxBook, `${recordLabel(record)} MAX_BOOK`, 1, issues);
  }
}

function checkCut(record: PtxCutRecord, issues: Issue[]): void {
  quantityIssue(record.sequence, `${recordLabel(record)} SEQUENCE`, 0, issues);
  if (!Number.isInteger(record.functionCode) || !isDocumentedPtxCutFunctionCode(record.functionCode)) {
    issues.push({
      code: 'INVALID_FUNCTION_CODE',
      message: `${recordLabel(record)} FUNCTION=${record.functionCode} is outside the documented dictionary (0 head, 1 rip, 2 cross, 3..9 recut phase, 90..99 trim/waste)`,
    });
  } else if (!isSupportedPtxCutFunctionCode(record.functionCode)) {
    // Documented by the interface dictionary, but the current Granete
    // candidate does not produce/accept it yet — a different failure from
    // "unknown code", with the documented meaning attached.
    issues.push({
      code: 'UNSUPPORTED_FUNCTION_CODE',
      message: `${recordLabel(record)} FUNCTION=${record.functionCode} (${describePtxCutFunction(
        record.functionCode,
      )}) is documented but unsupported by the current Granete PTX candidate subset [${PTX_SUPPORTED_CUT_FUNCTION_CODES.join(
        ',',
      )}]`,
    });
  }
  // DIMENSION is the relative measure of the sub-panel, never a coordinate —
  // it must be positive even for trim rows (investigation §5).
  magnitudeIssue(record.dimension, `${recordLabel(record)} DIMENSION`, true, issues);
  quantityIssue(record.repeatQuantity, `${recordLabel(record)} QTY_RPT`, 0, issues);
  quantityIssue(record.producedQuantity, `${recordLabel(record)} QTY_PARTS`, 0, issues);
  textIssues(record.comment, `${recordLabel(record)} COMMENT`, false, issues);
}

function checkOffcut(record: PtxOffcutRecord, issues: Issue[]): void {
  magnitudeIssue(record.length, `${recordLabel(record)} LENGTH`, true, issues);
  magnitudeIssue(record.width, `${recordLabel(record)} WIDTH`, true, issues);
  textIssues(record.code, `${recordLabel(record)} CODE`, true, issues);
}

function checkVector(record: PtxVectorRecord, issues: Issue[]): void {
  magnitudeIssue(record.xStart, `${recordLabel(record)} X_START`, false, issues);
  magnitudeIssue(record.yStart, `${recordLabel(record)} Y_START`, false, issues);
  magnitudeIssue(record.xEnd, `${recordLabel(record)} X_END`, false, issues);
  magnitudeIssue(record.yEnd, `${recordLabel(record)} Y_END`, false, issues);
}

/**
 * Index fields of every record must be finite integers ≥ 1 — NaN/Infinity
 * must fail here, not later as a confusing reference error.
 */
function checkIndexFields(record: PtxRecord, issues: Issue[]): void {
  const label = recordLabel(record);
  quantityIssue(record.jobIndex, `${label} JOB_INDEX`, 1, issues);
  switch (record.type) {
    case 'PARTS_REQ':
      quantityIssue(record.partIndex, `${label} PART_INDEX`, 1, issues);
      quantityIssue(record.materialIndex, `${label} MAT_INDEX`, 1, issues);
      break;
    case 'BOARDS':
      quantityIssue(record.boardIndex, `${label} BRD_INDEX`, 1, issues);
      quantityIssue(record.materialIndex, `${label} MAT_INDEX`, 1, issues);
      break;
    case 'MATERIALS':
      quantityIssue(record.materialIndex, `${label} MAT_INDEX`, 1, issues);
      break;
    case 'PATTERNS':
      quantityIssue(record.patternIndex, `${label} PTN_INDEX`, 1, issues);
      quantityIssue(record.boardIndex, `${label} BRD_INDEX`, 1, issues);
      break;
    case 'CUTS':
      quantityIssue(record.patternIndex, `${label} PTN_INDEX`, 1, issues);
      quantityIssue(record.cutIndex, `${label} CUT_INDEX`, 1, issues);
      break;
    case 'OFFCUTS':
      quantityIssue(record.offcutIndex, `${label} OFFCUT_INDEX`, 1, issues);
      quantityIssue(record.materialIndex, `${label} MAT_INDEX`, 1, issues);
      break;
    case 'VECTORS':
      quantityIssue(record.patternIndex, `${label} PTN_INDEX`, 1, issues);
      quantityIssue(record.cutIndex, `${label} CUT_INDEX`, 1, issues);
      break;
    default:
      break;
  }
}

/**
 * Validates relations, index tables and magnitudes. An empty result means the
 * document is consistent for this subset; it does NOT certify receiver
 * compatibility (field validation stays a separate concern, investigation §3.2).
 */
export function validatePtxDocument(doc: PtxDocument): readonly Issue[] {
  const issues: Issue[] = [];
  checkHeader(doc, issues);

  const tables = buildTables(doc);

  for (const record of doc.records) {
    checkIndexFields(record, issues);
    switch (record.type) {
      case 'JOBS':
        checkJob(record, issues);
        break;
      case 'PARTS_REQ':
        checkPartsReq(record, issues);
        if (!tables.materials.has(`${record.jobIndex}:${record.materialIndex}`)) {
          issues.push({ code: 'UNKNOWN_MATERIAL_REFERENCE', message: `${recordLabel(record)} MAT_INDEX=${record.materialIndex} has no MATERIALS row in job ${record.jobIndex}` });
        }
        break;
      case 'BOARDS':
        checkBoard(record, issues);
        if (!tables.materials.has(`${record.jobIndex}:${record.materialIndex}`)) {
          issues.push({ code: 'UNKNOWN_MATERIAL_REFERENCE', message: `${recordLabel(record)} MAT_INDEX=${record.materialIndex} has no MATERIALS row in job ${record.jobIndex}` });
        }
        break;
      case 'MATERIALS':
        checkMaterial(record, issues);
        break;
      case 'PATTERNS':
        checkPattern(record, issues);
        if (!tables.boards.has(`${record.jobIndex}:${record.boardIndex}`)) {
          issues.push({ code: 'UNKNOWN_BOARD_REFERENCE', message: `${recordLabel(record)} BRD_INDEX=${record.boardIndex} has no BOARDS row in job ${record.jobIndex}` });
        }
        break;
      case 'OFFCUTS':
        checkOffcut(record, issues);
        if (!tables.materials.has(`${record.jobIndex}:${record.materialIndex}`)) {
          issues.push({ code: 'UNKNOWN_MATERIAL_REFERENCE', message: `${recordLabel(record)} MAT_INDEX=${record.materialIndex} has no MATERIALS row in job ${record.jobIndex}` });
        }
        break;
      case 'CUTS':
        checkCut(record, issues);
        if (!tables.patterns.has(`${record.jobIndex}:${record.patternIndex}`)) {
          issues.push({ code: 'UNKNOWN_PATTERN_REFERENCE', message: `${recordLabel(record)} PTN_INDEX=${record.patternIndex} has no PATTERNS row in job ${record.jobIndex}` });
        }
        if (record.partReference.kind === 'part' && !tables.parts.has(`${record.jobIndex}:${record.partReference.partIndex}`)) {
          issues.push({ code: 'UNKNOWN_PART_REFERENCE', message: `${recordLabel(record)} PART_INDEX=${record.partReference.partIndex} has no PARTS_REQ row in job ${record.jobIndex}` });
        }
        if (record.partReference.kind === 'offcut' && !tables.offcuts.has(`${record.jobIndex}:${record.partReference.offcutIndex}`)) {
          issues.push({ code: 'UNKNOWN_OFFCUT_REFERENCE', message: `${recordLabel(record)} PART_INDEX=X${record.partReference.offcutIndex} has no OFFCUTS row in job ${record.jobIndex}` });
        }
        break;
      case 'VECTORS': {
        checkVector(record, issues);
        if (!tables.patterns.has(`${record.jobIndex}:${record.patternIndex}`)) {
          issues.push({ code: 'UNKNOWN_PATTERN_REFERENCE', message: `${recordLabel(record)} PTN_INDEX=${record.patternIndex} has no PATTERNS row in job ${record.jobIndex}` });
          break;
        }
        const cuts = tables.cutsByPattern.get(`${record.jobIndex}:${record.patternIndex}`);
        if (!cuts || !cuts.has(record.cutIndex)) {
          issues.push({ code: 'UNKNOWN_CUT_REFERENCE', message: `${recordLabel(record)} CUT_INDEX=${record.cutIndex} has no CUTS row in pattern ${record.patternIndex} of job ${record.jobIndex}` });
        }
        break;
      }
    }
  }

  // Every record must belong to a declared job.
  for (const record of doc.records) {
    if (record.type !== 'JOBS' && !tables.jobs.has(record.jobIndex)) {
      issues.push({ code: 'UNKNOWN_JOB_REFERENCE', message: `${recordLabel(record)} JOB_INDEX=${record.jobIndex} has no JOBS row` });
    }
  }

  // Per-job (and per-pattern for cuts) contiguity of every index table.
  for (const indexes of tables.indexTables.values()) {
    checkContiguousIndexes(indexes, issues);
  }

  return issues;
}

/** Throws PtxDocumentInvalidError (with every issue) when the document is not valid. */
export function assertValidPtxDocument(doc: PtxDocument): void {
  const issues = validatePtxDocument(doc);
  if (issues.length > 0) {
    throw new PtxDocumentInvalidError(issues);
  }
}
