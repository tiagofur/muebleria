/**
 * Strict Pattern Exchange specification preflight (#788 — r5 groundwork).
 *
 * History (corrected per independent review): earlier Granete candidates were
 * rejected in the field; r4 — the second real candidate documented in the
 * dossier (#787) — carried a HEADER.TITLE of 43 industrial / 31-33 lab
 * characters while the Pattern Exchange field dictionary documents a
 * 25-character maximum. That defect was objective (SPEC VIOLATION:
 * CONFIRMED) but it was never the PROVEN root cause of the CADLink
 * rejections — this module makes no such claim. Its job is narrower: no
 * future candidate revision may ship bytes that violate a documented limit
 * of the exchange format.
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
 * SPEC vs PRODUCT CAPABILITY (#788 review): this preflight only reports
 * SPEC_INVALID findings (documented-format violations). A value can be
 * Pattern-Exchange-valid and still be outside what the Granete candidate
 * produces/accepts — that is SPEC_VALID_BUT_PRODUCT_UNSUPPORTED, owned by
 * validate.ts/compiler policy, never described here as "invalid Pattern
 * Exchange" (see classifyPtxDocumentedEnumSupport for the typed taxonomy:
 * PATTERNS.TYPE 5..8 grain templates, CUTS.FUNCTION 4..9 / 90..91 / 93..99).
 *
 * Honesty rules that govern this catalog:
 * - every enforced limit carries classification + locator; nothing is
 *   invented, nothing is copied from the SAW side of the guide, and no
 *   CADmatic-SAW UTF-8 requirement is extrapolated to PTX;
 * - the guide itself warns (§4 p.118): "the limitations (eg. max length of
 *   material code) will vary according to the implementation and
 *   specification of the saw" — SPEC_REQUIRED is the FORMAT-level maximum,
 *   not a receiver compatibility claim. supportStatus stays NOT_TESTED;
 * - HEADER.VERSION: only the FORM (positive finite number) is spec-checked;
 *   the exact header value stays UNKNOWN until a receiver profile pins it
 *   with evidence (the guide itself is contradictory: §20 p.167 'Set to
 *   1.06', §4 p.118 '(1.08)', every example uses 1 — investigation §9). The
 *   r5 profile must fix its version explicitly; a PASS here never means
 *   "receiver-verified version".
 *
 * Documented but deliberately NOT enforced here (recorded, not invented
 * away): the material-code space/upper-case import normalization (§20 p.166
 * — receiver-side conversion, follow-up belongs with the MATERIALS receiver
 * tuning issue), and any PARTS_INF/PARTS_UDI field (200-char info limits)
 * until those families get their typed shape (#789).
 */

import type {
  PtxDocument,
  PtxRecord,
} from './records';
import { PTX_PATTERN_TYPE, PTX_SUPPORTED_CUT_FUNCTION_CODES } from './records';
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

/**
 * Dictionary DIM type (§20 p.166): "Dimension. Number single. When working
 * in millimetres these range from 0.0 to 9999.9. When working in decimal
 * inches dimensions must range from 0.000 to 999.9." The bound is resolved
 * against HEADER.UNITS at check time. Only the documented MAGNITUDE range is
 * enforced — decimal FORM/precision stays the serializer's quantization
 * policy, and semantic minima (> 0 for real measures) stay product/domain
 * policy (never invented here).
 */
export interface PtxSpecDimLimit {
  readonly kind: 'dim-range';
  readonly field: string;
  readonly min: 0;
  readonly metricMax: number;
  readonly inchesMax: number;
  readonly authority: PtxSpecLimitAuthority;
}

/**
 * Dictionary QTY type (§20 p.166): "A long integer used to store quantity.
 * No quantity can be greater than 99999." Both documented properties are
 * enforced: LONG INTEGER (a decimal QTY is spec-invalid) and the MAXIMUM.
 * Minima stay product/domain policy.
 */
export interface PtxSpecQtyLimit {
  readonly kind: 'qty-max';
  readonly field: string;
  readonly max: number;
  readonly authority: PtxSpecLimitAuthority;
}

/** Dictionary INT whose documented domain is a union of ranges (e.g. FUNCTION 0-9, 90-99). */
export interface PtxSpecIntRangesLimit {
  readonly kind: 'int-ranges';
  readonly field: string;
  readonly ranges: readonly (readonly [number, number])[];
  readonly authority: PtxSpecLimitAuthority;
}

/**
 * Dictionary INT type FORM: the value must be an INTEGER when present.
 * `knownValues` documents the KNOWN codes (e.g. JOBS.STATUS 0/1/2) WITHOUT
 * claiming exhaustiveness — the guide itself warns for STATUS that "there may
 * be a range of other error codes" (§5 p.120), so other integers are NOT
 * spec-invalid merely for being outside the known set. Restricting them is
 * PRODUCT/RECEIVER policy, never this preflight.
 */
export interface PtxSpecIntFormLimit {
  readonly kind: 'int-form';
  readonly field: string;
  readonly knownValues?: readonly number[];
  readonly authority: PtxSpecLimitAuthority;
}

export type PtxSpecLimit =
  | PtxSpecTextLimit
  | PtxSpecIntRangeLimit
  | PtxSpecIntEnumLimit
  | PtxSpecDimLimit
  | PtxSpecQtyLimit
  | PtxSpecIntRangesLimit
  | PtxSpecIntFormLimit;

const P167 = 'S03 V11 Interface Guide §20 p.167';
const P118 = 'S03 V11 Interface Guide §4 p.118';
const P166 = 'S03 V11 Interface Guide §20 p.166';
const QTY_QUOTE =
  "S03 V11 Interface Guide §20 p.166 'QTY A long integer used to store quantity. No quantity can be greater than 99999.'";
const DIM_QUOTE =
  "S03 V11 Interface Guide §20 p.166 'DIM Dimension. Number single. When working in millimetres these range from 0.0 to 9999.9. When working in decimal inches dimensions must range from 0.000 to 999.9'";

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
  // Enums/ranges of already-modeled fields, classified as SPEC here instead
  // of relying on validate.ts (whose checks stay as the product-side gate).
  // JOBS.STATUS is deliberately NOT an int-enum: the guide documents 0/1/2 as
  // the KNOWN codes and explicitly warns "there may be a range of other error
  // codes" (§5 p.120) — other integers are not spec-invalid by value; only
  // the INT FORM is enforced here.
  { kind: 'int-form', field: 'JOBS.STATUS', knownValues: [0, 1, 2], authority: SPEC_REQUIRED(`${P167} 'STATUS Job status INT 0,1,2' + §5 p.120 '0 - not optimised 1 - optimised 2 - optimise failed Note: there may be a range of other error codes' (conocidos, NO exhaustivos)`) },
  { kind: 'int-form', field: 'JOBS.CUT_TIME', authority: SPEC_REQUIRED(`${P167} 'CUT_TIME Total cut time INT' + §5 p.121 'Total cutting time for the job in seconds'`) },
  { kind: 'int-form', field: 'CUTS.SEQUENCE', authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.178 \'SEQUENCE Cut sequence INT Number-Integer\'') },
  { kind: 'int-enum', field: 'PARTS_REQ.GRAIN', values: [0, 1, 2], authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.168 \'GRAIN Grain INT 0,1,2\' + §6 pp.122–123 enumera exactamente 0/1/2 sin salvedad') },
  { kind: 'int-enum', field: 'MATERIALS.RULE2', values: [0, 1], authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.174 \'RULE2 Optimising rule 2 INT 0,1\'') },
  { kind: 'int-enum', field: 'MATERIALS.RULE3', values: [0, 1], authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.174 \'RULE3 Optimising rule 3 INT 0,1\'') },
  { kind: 'int-enum', field: 'MATERIALS.RULE4', values: [0, 1], authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.174 \'RULE4 Optimising rule 4 INT 0,1\'') },
  { kind: 'int-range', field: 'MATERIALS.RULE1', min: 1, max: 9, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.174 \'RULE1 Optimising rule 1 INT 1-9\'') },
  // PATTERNS.TYPE documented 0-8. SPEC range only: 5..8 (grain-matching
  // templates, S12) are Pattern-Exchange-VALID — their absence from the
  // Granete candidate subset is PRODUCT policy (validate.ts), never a spec
  // finding here. See classifyPtxDocumentedEnumSupport.
  { kind: 'int-range', field: 'PATTERNS.TYPE', min: 0, max: 8, authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.175 \'TYPE Pattern type INT 0-8\'') },
  // CUTS.FUNCTION documented dictionary 0-9 / 90-99. Codes inside the
  // dictionary that the candidate does not produce (4..9, 90, 91, 93..99)
  // are SPEC_VALID_BUT_PRODUCT_UNSUPPORTED — not flagged here.
  { kind: 'int-ranges', field: 'CUTS.FUNCTION', ranges: [[0, 9], [90, 99]], authority: SPEC_REQUIRED('S03 V11 Interface Guide §20 p.178 \'FUNCTION Cut type INT 0-9, 90-99\'') },
  // Dictionary DIM type (§20 p.166): metric 0.0..9999.9 / decimal inches
  // 0.000..999.9. VECTORS deliberately has NO dim-range entry: §20 carries
  // no VECTORS row (§17 p.146 documents it in prose only) — no invented cap.
  { kind: 'dim-range', field: 'PARTS_REQ.LENGTH', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.168 LENGTH/WIDTH DIM`) },
  { kind: 'dim-range', field: 'PARTS_REQ.WIDTH', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.168 'WIDTH Part width DIM'`) },
  { kind: 'dim-range', field: 'BOARDS.LENGTH', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.173 'LENGTH Board length DIM'`) },
  { kind: 'dim-range', field: 'BOARDS.WIDTH', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.173 'WIDTH Board width DIM'`) },
  { kind: 'dim-range', field: 'MATERIALS.THICK', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.173 'THICK Material thickness DIM'`) },
  { kind: 'dim-range', field: 'MATERIALS.KERF_RIP', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.173 'KERF_RIP Saw blade thickness (rip) DIM'`) },
  { kind: 'dim-range', field: 'MATERIALS.KERF_XCT', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.173 'KERF_XCT Saw blade thickness (crosscut) DIM'`) },
  { kind: 'dim-range', field: 'MATERIALS.TRIM_FRIP', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.173 'TRIM_FRIP Fixed rip trim DIM'`) },
  { kind: 'dim-range', field: 'MATERIALS.TRIM_VRIP', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.174 'TRIM_VRIP Min waste rip trim DIM'`) },
  { kind: 'dim-range', field: 'MATERIALS.TRIM_FXCT', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.174 'TRIM_FXCT Fixed crosscut trim DIM'`) },
  { kind: 'dim-range', field: 'MATERIALS.TRIM_VXCT', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.174 'TRIM_VXCT Min waste crosscut trim DIM'`) },
  { kind: 'dim-range', field: 'MATERIALS.TRIM_HEAD', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.174 'TRIM_HEAD Internal Head trim DIM'`) },
  { kind: 'dim-range', field: 'MATERIALS.TRIM_FRCT', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.174 'TRIM_FRCT Fixed recut trim DIM'`) },
  { kind: 'dim-range', field: 'MATERIALS.TRIM_VRCT', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.174 'TRIM_VRCT Min waste recut trim DIM'`) },
  { kind: 'dim-range', field: 'OFFCUTS.LENGTH', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.175 'LENGTH Offcut length DIM'`) },
  { kind: 'dim-range', field: 'OFFCUTS.WIDTH', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.175 'WIDTH Offcut width DIM'`) },
  { kind: 'dim-range', field: 'CUTS.DIMENSION', min: 0, metricMax: 9999.9, inchesMax: 999.9, authority: SPEC_REQUIRED(`${DIM_QUOTE} + §20 p.178 'DIMENSION Size of cut DIM'`) },
  // Dictionary QTY type (§20 p.166): "No quantity can be greater than 99999."
  { kind: 'qty-max', field: 'PARTS_REQ.QTY_REQ', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.168 'QTY_REQ … QTY Max 99999'`) },
  { kind: 'qty-max', field: 'PARTS_REQ.QTY_OVER', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.168 'QTY_OVER … QTY Max 99999'`) },
  { kind: 'qty-max', field: 'PARTS_REQ.QTY_UNDER', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.168 'QTY_UNDER … QTY Max 99999'`) },
  { kind: 'qty-max', field: 'PARTS_REQ.QTY_PROD', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.168 'QTY_PROD … QTY Max 99999'`) },
  { kind: 'qty-max', field: 'BOARDS.QTY_STOCK', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.173 'QTY_STOCK … QTY Max 99999'`) },
  { kind: 'qty-max', field: 'BOARDS.QTY_USED', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.173 'QTY_USED … QTY Max 99999'`) },
  { kind: 'qty-max', field: 'MATERIALS.BOOK', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.173 'BOOK Max sheets per book QTY'`) },
  { kind: 'qty-max', field: 'OFFCUTS.OFC_QTY', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.175 'OFC_QTY Offcut quantity QTY Max 99999'`) },
  { kind: 'qty-max', field: 'PATTERNS.QTY_RUN', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.175 'QTY_RUN Run quantity QTY'`) },
  { kind: 'qty-max', field: 'PATTERNS.QTY_CYCLES', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.175 'QTY_CYCLES Cycle quantity QTY'`) },
  { kind: 'qty-max', field: 'PATTERNS.MAX_BOOK', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.175 'MAX_BOOK Max sheets per book QTY'`) },
  { kind: 'qty-max', field: 'CUTS.QTY_RPT', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.178 'QTY_RPT Cut quantity QTY'`) },
  { kind: 'qty-max', field: 'CUTS.QTY_PARTS', max: 99999, authority: SPEC_REQUIRED(`${QTY_QUOTE} + §20 p.178 'QTY_PARTS Total part quantity QTY Max 99999'`) },
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
  | 'ptx_spec.enum_value_invalid'
  | 'ptx_spec.function_code_invalid'
  | 'ptx_spec.dimension_out_of_range'
  | 'ptx_spec.quantity_out_of_range'
  | 'ptx_spec.quantity_not_integer'
  | 'ptx_spec.int_not_integer'
  | 'ptx_spec.job_scope_ambiguous'
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

function enumIssue(
  value: number,
  field: string,
  rowLabel: string,
  issues: PtxSpecIssue[],
): void {
  const limit = LIMIT_BY_FIELD.get(field) as PtxSpecIntEnumLimit | undefined;
  if (!limit) return;
  if (!limit.values.includes(value)) {
    issues.push({
      code: 'ptx_spec.enum_value_invalid',
      message: `${rowLabel} ${field}=${value} no está en el diccionario documentado [${limit.values.join(', ')}]`,
      field,
      classification: limit.authority.classification,
      locator: limit.authority.locator,
      observed: value,
    });
  }
}

/**
 * Dictionary DIM range (units-aware). Only magnitude is enforced: decimal
 * precision stays the serializer's quantization policy and semantic minima
 * stay product/domain policy (§20 p.166 documents 0.0 as the range floor).
 */
function dimIssue(
  value: number,
  field: string,
  units: number,
  rowLabel: string,
  issues: PtxSpecIssue[],
): void {
  const limit = LIMIT_BY_FIELD.get(field) as PtxSpecDimLimit | undefined;
  if (!limit) return;
  const max = units === 1 ? limit.inchesMax : limit.metricMax;
  if (!Number.isFinite(value) || value < limit.min || value > max) {
    issues.push({
      code: 'ptx_spec.dimension_out_of_range',
      message: `${rowLabel} ${field}=${value} fuera del rango DIM documentado [${limit.min.toFixed(1)}..${max}] (${units === 1 ? 'decimal inches' : 'millimetres'})`,
      field,
      classification: limit.authority.classification,
      locator: limit.authority.locator,
      observed: value,
      minimum: limit.min,
      maximum: max,
    });
  }
}

/**
 * Dictionary QTY maximum AND integrality ("A long integer used to store
 * quantity. No quantity can be greater than 99999." §20 p.166): a decimal QTY
 * is spec-invalid independently of validate.ts.
 */
function qtyIssue(
  value: number,
  field: string,
  rowLabel: string,
  issues: PtxSpecIssue[],
): void {
  const limit = LIMIT_BY_FIELD.get(field) as PtxSpecQtyLimit | undefined;
  if (!limit) return;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    issues.push({
      code: 'ptx_spec.quantity_not_integer',
      message: `${rowLabel} ${field}=${value} no es un entero (QTY documentado como LONG INTEGER; un QTY decimal es inválido de especificación)`,
      field,
      classification: limit.authority.classification,
      locator: limit.authority.locator,
      observed: value,
    });
    return;
  }
  if (value > limit.max) {
    issues.push({
      code: 'ptx_spec.quantity_out_of_range',
      message: `${rowLabel} ${field}=${value} supera el máximo QTY documentado (${limit.max})`,
      field,
      classification: limit.authority.classification,
      locator: limit.authority.locator,
      observed: value,
      maximum: limit.max,
    });
  }
}

/**
 * Dictionary INT FORM: integer when present. Known codes (if any) are
 * documented in the issue message WITHOUT exhaustiveness claims.
 */
function intFormIssue(
  value: number,
  field: string,
  rowLabel: string,
  issues: PtxSpecIssue[],
): void {
  const limit = LIMIT_BY_FIELD.get(field) as PtxSpecIntFormLimit | undefined;
  if (!limit) return;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    issues.push({
      code: 'ptx_spec.int_not_integer',
      message: `${rowLabel} ${field}=${value} no es un entero (INT documentado${limit.knownValues ? `; códigos conocidos [${limit.knownValues.join(', ')}], no exhaustivos` : ''})`,
      field,
      classification: limit.authority.classification,
      locator: limit.authority.locator,
      observed: value,
    });
  }
}

function checkRecordFields(record: PtxRecord, units: number, issues: PtxSpecIssue[]): void {
  const label = recordLabel(record);
  switch (record.type) {
    case 'JOBS':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      // STATUS: INT FORM only — 0/1/2 are the documented KNOWN codes and the
      // guide warns other error codes may exist (§5 p.120); other integers
      // are NOT spec-invalid by value (restricting them is product policy).
      if (record.status !== undefined) intFormIssue(record.status, 'JOBS.STATUS', label, issues);
      if (record.cutTime !== undefined) intFormIssue(record.cutTime, 'JOBS.CUT_TIME', label, issues);
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
      dimIssue(record.length, 'PARTS_REQ.LENGTH', units, label, issues);
      dimIssue(record.width, 'PARTS_REQ.WIDTH', units, label, issues);
      qtyIssue(record.requiredQuantity, 'PARTS_REQ.QTY_REQ', label, issues);
      if (record.overQuantity !== undefined) qtyIssue(record.overQuantity, 'PARTS_REQ.QTY_OVER', label, issues);
      if (record.underQuantity !== undefined) qtyIssue(record.underQuantity, 'PARTS_REQ.QTY_UNDER', label, issues);
      if (record.producedQuantity !== undefined) qtyIssue(record.producedQuantity, 'PARTS_REQ.QTY_PROD', label, issues);
      enumIssue(record.grain, 'PARTS_REQ.GRAIN', label, issues);
      break;
    case 'BOARDS':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.boardIndex, 'BOARDS.BRD_INDEX', label, issues);
      intRangeIssue(record.materialIndex, 'BOARDS.MAT_INDEX', label, issues);
      textIssue(record.code, 'BOARDS.CODE', label, issues);
      dimIssue(record.length, 'BOARDS.LENGTH', units, label, issues);
      dimIssue(record.width, 'BOARDS.WIDTH', units, label, issues);
      if (record.stockQuantity !== undefined) qtyIssue(record.stockQuantity, 'BOARDS.QTY_STOCK', label, issues);
      if (record.usedQuantity !== undefined) qtyIssue(record.usedQuantity, 'BOARDS.QTY_USED', label, issues);
      break;
    case 'MATERIALS':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.materialIndex, 'MATERIALS.MAT_INDEX', label, issues);
      textIssue(record.code, 'MATERIALS.CODE', label, issues);
      if (record.description !== undefined) textIssue(record.description, 'MATERIALS.DESC', label, issues);
      dimIssue(record.thickness, 'MATERIALS.THICK', units, label, issues);
      qtyIssue(record.bookQuantity, 'MATERIALS.BOOK', label, issues);
      dimIssue(record.kerfRip, 'MATERIALS.KERF_RIP', units, label, issues);
      dimIssue(record.kerfCrosscut, 'MATERIALS.KERF_XCT', units, label, issues);
      if (record.trimFRip !== undefined) dimIssue(record.trimFRip, 'MATERIALS.TRIM_FRIP', units, label, issues);
      if (record.trimVRip !== undefined) dimIssue(record.trimVRip, 'MATERIALS.TRIM_VRIP', units, label, issues);
      if (record.trimFXct !== undefined) dimIssue(record.trimFXct, 'MATERIALS.TRIM_FXCT', units, label, issues);
      if (record.trimVXct !== undefined) dimIssue(record.trimVXct, 'MATERIALS.TRIM_VXCT', units, label, issues);
      if (record.trimHead !== undefined) dimIssue(record.trimHead, 'MATERIALS.TRIM_HEAD', units, label, issues);
      if (record.trimFRct !== undefined) dimIssue(record.trimFRct, 'MATERIALS.TRIM_FRCT', units, label, issues);
      if (record.trimVRct !== undefined) dimIssue(record.trimVRct, 'MATERIALS.TRIM_VRCT', units, label, issues);
      if (record.rule1 !== undefined) intRangeIssue(record.rule1, 'MATERIALS.RULE1', label, issues);
      if (record.rule2 !== undefined) enumIssue(record.rule2, 'MATERIALS.RULE2', label, issues);
      if (record.rule3 !== undefined) enumIssue(record.rule3, 'MATERIALS.RULE3', label, issues);
      if (record.rule4 !== undefined) enumIssue(record.rule4, 'MATERIALS.RULE4', label, issues);
      break;
    case 'PATTERNS':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.patternIndex, 'PATTERNS.PTN_INDEX', label, issues);
      intRangeIssue(record.boardIndex, 'PATTERNS.BRD_INDEX', label, issues);
      // SPEC range is the documented 0..8. 5..8 (grain templates) would be
      // SPEC_VALID_BUT_PRODUCT_UNSUPPORTED — the model cannot carry them and
      // validate.ts owns that product-side rejection; nothing here mislabels
      // them as invalid Pattern Exchange.
      intRangeIssue(record.patternType, 'PATTERNS.TYPE', label, issues);
      if (record.runQuantity !== undefined) qtyIssue(record.runQuantity, 'PATTERNS.QTY_RUN', label, issues);
      if (record.cyclesQuantity !== undefined) qtyIssue(record.cyclesQuantity, 'PATTERNS.QTY_CYCLES', label, issues);
      if (record.maxBook !== undefined) qtyIssue(record.maxBook, 'PATTERNS.MAX_BOOK', label, issues);
      break;
    case 'OFFCUTS':
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.offcutIndex, 'OFFCUTS.OFC_INDEX', label, issues);
      intRangeIssue(record.materialIndex, 'OFFCUTS.MAT_INDEX', label, issues);
      if (record.code !== undefined) textIssue(record.code, 'OFFCUTS.CODE', label, issues);
      dimIssue(record.length, 'OFFCUTS.LENGTH', units, label, issues);
      dimIssue(record.width, 'OFFCUTS.WIDTH', units, label, issues);
      if (record.producedQuantity !== undefined) qtyIssue(record.producedQuantity, 'OFFCUTS.OFC_QTY', label, issues);
      break;
    case 'CUTS': {
      intRangeIssue(record.jobIndex, 'JOBS.JOB_INDEX', label, issues);
      intRangeIssue(record.patternIndex, 'PATTERNS.PTN_INDEX', label, issues);
      intRangeIssue(record.cutIndex, 'CUTS.CUT_INDEX', label, issues);
      // §20 p.178 'SEQUENCE Cut sequence INT': integer form by the spec's own
      // authority (validate.ts also checks it — this is the independent gate).
      intFormIssue(record.sequence, 'CUTS.SEQUENCE', label, issues);
      if (record.comment !== undefined) textIssue(record.comment, 'CUTS.COMMENT', label, issues);
      dimIssue(record.dimension, 'CUTS.DIMENSION', units, label, issues);
      qtyIssue(record.repeatQuantity, 'CUTS.QTY_RPT', label, issues);
      if (record.producedQuantity !== undefined) qtyIssue(record.producedQuantity, 'CUTS.QTY_PARTS', label, issues);
      // Documented FUNCTION dictionary 0-9 / 90-99. Codes inside it that the
      // candidate does not emit (4..9, 90, 91, 93..99) are NOT flagged here:
      // product support is validate.ts/compiler territory (#791 owns 92
      // semantics; nothing in this check interprets any code).
      const functionLimit = LIMIT_BY_FIELD.get('CUTS.FUNCTION') as PtxSpecIntRangesLimit;
      if (
        !Number.isInteger(record.functionCode) ||
        !functionLimit.ranges.some(([lo, hi]) => record.functionCode >= lo && record.functionCode <= hi)
      ) {
        issues.push({
          code: 'ptx_spec.function_code_invalid',
          message: `${label} FUNCTION=${record.functionCode} fuera del diccionario documentado ${functionLimit.ranges.map(([lo, hi]) => `${lo}-${hi}`).join(' / ')}`,
          field: 'CUTS.FUNCTION',
          classification: functionLimit.authority.classification,
          locator: functionLimit.authority.locator,
          observed: record.functionCode,
        });
      }
      const ref = record.partReference;
      if (ref.kind === 'part') {
        intRangeIssue(ref.partIndex, 'CUTS.PART_INDEX', label, issues);
      } else if (ref.kind === 'offcut') {
        intRangeIssue(ref.offcutIndex, 'CUTS.PART_INDEX_X', label, issues);
      }
      break;
    }
    case 'VECTORS':
      // §20 has no VECTORS row (§17 p.146 documents it in prose only): no
      // documented DIM/INT ranges exist for its coordinates — none invented.
      // Referential checks below still apply.
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
  // JOBS is OPTIONAL under the spec (guide §5 p.120: "These records are
  // optional and in the absence of job records all parts and patterns are
  // assumed to belong to the same job."). Two separated concerns:
  // A) SPEC: with no JOBS rows, every record belongs to ONE implicit job —
  //    valid; more than one distinct JOB_INDEX in that case cannot be
  //    justified from the guide and fails closed (job_scope_ambiguous).
  // B) PRODUCT: the Granete compiler keeps EMITTING an explicit JOBS row
  //    (r5 policy) — that requirement lives in the compiler/validate side,
  //    never as a "spec invalid" claim here.
  const hasJobs = tables.jobs.size > 0;
  if (!hasJobs) {
    const distinctJobIndexes = new Set(
      doc.records.filter((record) => record.type !== 'JOBS').map((record) => record.jobIndex),
    );
    if (distinctJobIndexes.size > 1) {
      issues.push({
        code: 'ptx_spec.job_scope_ambiguous',
        message: `sin filas JOBS la especificación sólo define UN job implícito ('in the absence of job records all parts and patterns are assumed to belong to the same job'), pero los registros declaran ${distinctJobIndexes.size} JOB_INDEX distintos [${[...distinctJobIndexes].join(', ')}]: fail closed`,
        field: 'JOB_INDEX',
        classification: 'SPEC_REQUIRED',
        locator: 'S03 V11 Interface Guide §5 p.120 (JOBS JOB RECORD)',
        observed: [...distinctJobIndexes].join(','),
      });
    }
  }
  for (const record of doc.records) {
    const label = recordLabel(record);
    if (record.type !== 'JOBS' && hasJobs && !tables.jobs.has(record.jobIndex)) {
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
  // DIM bounds resolve against HEADER.UNITS (dictionary DIM is units-aware);
  // an invalid UNITS already carries its own header issue and blocks.
  const units = doc.header.units;
  for (const record of doc.records) {
    checkRecordFields(record, units, issues);
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

// ---------------------------------------------------------------------------
// SPEC vs PRODUCT CAPABILITY taxonomy (#788 review; consumed by #790/#791)
// ---------------------------------------------------------------------------

/**
 * What a value means across the two independent axes:
 * - SPEC_INVALID: violates the documented Pattern Exchange dictionary —
 *   reported by this preflight;
 * - SPEC_VALID_BUT_PRODUCT_UNSUPPORTED: Pattern-Exchange-valid, but outside
 *   what the Granete candidate produces/accepts (validate.ts/compiler own
 *   that rejection — never described as "invalid Pattern Exchange");
 * - PRODUCT_SUPPORTED: documented AND within the candidate's subset.
 */
export type PtxSpecCapabilityVerdict =
  | 'SPEC_INVALID'
  | 'SPEC_VALID_BUT_PRODUCT_UNSUPPORTED'
  | 'PRODUCT_SUPPORTED';

/**
 * Classifies a documented-enum value WITHOUT enabling any new capability:
 * the product subsets come from the existing records.ts constants (writer
 * capability data), so this function only names the gap explicitly for
 * diagnostics, docs and the receiver work in #790/#791.
 */
export function classifyPtxDocumentedEnumSupport(
  field: 'CUTS.FUNCTION' | 'PATTERNS.TYPE',
  value: number,
): PtxSpecCapabilityVerdict {
  if (field === 'CUTS.FUNCTION') {
    const inDictionary = value >= 0 && value <= 9 || (value >= 90 && value <= 99);
    if (!Number.isInteger(value) || !inDictionary) return 'SPEC_INVALID';
    return (PTX_SUPPORTED_CUT_FUNCTION_CODES as readonly number[]).includes(value)
      ? 'PRODUCT_SUPPORTED'
      : 'SPEC_VALID_BUT_PRODUCT_UNSUPPORTED';
  }
  if (!Number.isInteger(value) || value < 0 || value > 8) return 'SPEC_INVALID';
  const productSubset = Object.values(PTX_PATTERN_TYPE) as readonly number[];
  return productSubset.includes(value) ? 'PRODUCT_SUPPORTED' : 'SPEC_VALID_BUT_PRODUCT_UNSUPPORTED';
}
