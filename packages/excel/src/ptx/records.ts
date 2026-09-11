/**
 * Typed record model for the documented PTX subset (#650 PR 4 core).
 *
 * Column layouts, code dictionaries and semantics come from
 * docs/machines/ptx-cadmatic4/01_investigacion_y_contrato.md §4 (which carries
 * the S03/Magi-Cut Interface Guide ch.3 locators) and the fragments under
 * docs/machines/ptx-cadmatic4/examples/. This core is intentionally NOT
 * connected to the optimizer CutProgram, the CADmatic profiles or the legacy
 * ptxCutPlanExport serializer — it must demonstrate
 * records → serialize → bytes → parse → equivalent model on its own.
 *
 * Units: every magnitude is expressed in the HEADER record units
 * (PtxUnits.Metric = mm). Field names therefore carry no unit suffix.
 *
 * Empty vs zero (S06, investigation §4 MATERIALS): an optional numeric
 * `undefined` serializes as an EMPTY cell and means "no value imposed";
 * an explicit 0 serializes as "0" and is a real override. `value || 0`
 * completions are forbidden around this model.
 *
 * Deliberately NOT implemented (first-profile subset, investigation §4
 * "Información y remanentes" and §9): PARTS_INF, PARTS_UDI, PARTS_DST,
 * PTN_UDI, NOTES, and every optional column beyond the implemented width of
 * each family (documented per record below). The reader fails closed on
 * unmodeled columns instead of guessing them.
 */

// ---------------------------------------------------------------------------
// Documented enumerations
// ---------------------------------------------------------------------------

/** HEADER UNITS: 0 metric (mm), 1 decimal inches. [S03 p.118] */
export const PTX_UNITS = { metric: 0, decimalInches: 1 } as const;
export type PtxUnits = (typeof PTX_UNITS)[keyof typeof PTX_UNITS];

/**
 * HEADER TRIM_TYPE: 0 waste first, 1 fixed trim first. [S03 p.118]
 */
export const PTX_TRIM_TYPE = { wasteFirst: 0, fixedTrimFirst: 1 } as const;
export type PtxTrimType = (typeof PTX_TRIM_TYPE)[keyof typeof PTX_TRIM_TYPE];

/**
 * PARTS_REQ GRAIN: 0 free; 1 no rotation of the part with respect to length;
 * 2 transverse orientation required. Distinct from the board's initial turn.
 * [S03 pp.122–123; S06]
 */
export const PTX_GRAIN = { free: 0, length: 1, transverse: 2 } as const;
export type PtxGrain = (typeof PTX_GRAIN)[keyof typeof PTX_GRAIN];

/**
 * PATTERNS TYPE: 0 longitudinal rip; 1 initial board turn; 2/3 transversal /
 * longitudinal heading; 4 cutting only. Values 5–8 relate to grain-matching
 * templates and stay OUT of the first profile (S12; investigation §4).
 * [S03 p.139]
 */
export const PTX_PATTERN_TYPE = {
  longitudinalRip: 0,
  initialTurn: 1,
  transversalHead: 2,
  longitudinalHead: 3,
  cuttingOnly: 4,
} as const;
export type PtxPatternType = (typeof PTX_PATTERN_TYPE)[keyof typeof PTX_PATTERN_TYPE];

/**
 * CUTS FUNCTION dictionary [S03 pp.142–145; table p.178; S05]. Supporting a
 * code in the schema does NOT mean the target saw can execute that depth —
 * machine profiles govern the allowed subset.
 */
export function describePtxCutFunction(code: number): string | undefined {
  if (code === 0) return 'head';
  if (code === 1) return 'rip';
  if (code === 2) return 'cross';
  if (code >= 3 && code <= 9) return `recut_phase_${code}`;
  if (code >= 90 && code <= 99) return `trim_or_waste_phase_${code - 90}`;
  return undefined;
}

/** Whether the code belongs to the documented interface dictionary. */
export function isDocumentedPtxCutFunctionCode(code: number): boolean {
  return describePtxCutFunction(code) !== undefined;
}

/**
 * FUNCTION codes the current Granete PTX candidate is willing to produce,
 * parse and validate: 0 head, 1 rip, 2 cross, 3 third-phase recut.
 *
 * Deliberately NOT supported yet (documented ≠ supported — "the manual
 * enumerates the code" is never "Granete can emit it"):
 * - 4 fourth-phase recut: waits for an explicit phase-4 fixture with its
 *   semantics before being enabled;
 * - 5..9 deeper recut phases: no case needs them;
 * - 81 tension: excluded from the first candidate (investigation §9);
 * - 90..99 trims/waste: wait for the CutProgram compiler and an explicit
 *   decision on which code/phase each generated trim maps to.
 */
export const PTX_SUPPORTED_CUT_FUNCTION_CODES = [0, 1, 2, 3] as const;

/** Whether the code belongs to the subset supported by the current candidate. */
export function isSupportedPtxCutFunctionCode(code: number): boolean {
  return (PTX_SUPPORTED_CUT_FUNCTION_CODES as readonly number[]).includes(code);
}

/**
 * CUTS PART_INDEX reference dictionary [S03 pp.142–145]:
 * `0` no part, positive integer = PARTS_REQ index within the same job,
 * `Xn` = OFFCUTS index n within the same job. `X3` is NOT an axis or a turn.
 */
export type PtxPartReference =
  | { readonly kind: 'none' }
  | { readonly kind: 'part'; readonly partIndex: number }
  | { readonly kind: 'offcut'; readonly offcutIndex: number };

// ---------------------------------------------------------------------------
// Records (one interface per PTX family; column order is fixed)
// ---------------------------------------------------------------------------

/**
 * HEADER,VERSION,TITLE,UNITS,ORIGIN,TRIM_TYPE — exactly one per file, first
 * record. ORIGIN affects VECTORS; CUTS assumes top-left origin.
 *
 * Do NOT set VERSION from the controller name: keep the documented PTX file
 * version, the adopted header value and the controller version separate
 * (investigation §4 HEADER rule).
 */
export interface PtxHeaderRecord {
  readonly type: 'HEADER';
  /** Documented PTX version written in the file (examples use 1; guide text mentions 1.08/V1.17 — investigation §9 keeps this open). */
  readonly version: number;
  readonly title: string;
  readonly units: PtxUnits;
  /** Affects VECTORS coordinates. Value semantics are S03 territory; we carry the caller's explicit choice. */
  readonly origin: number;
  readonly trimType: PtxTrimType;
}

/**
 * JOBS,JOB_INDEX,NAME,DESC,ORD_DATE,CUT_DATE,CUSTOMER,STATUS,OPT_PARAM,
 * SAW_PARAM,CUT_TIME,WASTE_PCNT (12 cells with family). Optional dates must
 * not shift columns: absent dates serialize as empty cells, never removed.
 * The PTX optimization STATUS is not Granete's approval state.
 */
export interface PtxJobRecord {
  readonly type: 'JOBS';
  readonly jobIndex: number;
  readonly name: string;
  readonly description?: string;
  readonly orderDate?: string;
  readonly cutDate?: string;
  readonly customer?: string;
  readonly status?: number;
  readonly optParam?: string;
  readonly sawParam?: string;
  readonly cutTime?: number;
  readonly wastePercent?: number;
}

/**
 * PARTS_REQ,JOB_INDEX,PART_INDEX,CODE,MAT_INDEX,LENGTH,WIDTH,QTY_REQ,
 * QTY_OVER,QTY_UNDER,GRAIN,QTY_PROD (12 cells). LENGTH/WIDTH are the resolved
 * cut measures — edge-band deduction must never be re-derived here.
 */
export interface PtxPartsReqRecord {
  readonly type: 'PARTS_REQ';
  readonly jobIndex: number;
  readonly partIndex: number;
  readonly code: string;
  readonly materialIndex: number;
  readonly length: number;
  readonly width: number;
  readonly requiredQuantity: number;
  readonly overQuantity?: number;
  readonly underQuantity?: number;
  readonly grain: PtxGrain;
  readonly producedQuantity?: number;
}

/**
 * BOARDS,JOB_INDEX,BRD_INDEX,CODE,MAT_INDEX,LENGTH,WIDTH,QTY_STOCK,QTY_USED
 * (implemented width: 9 cells with family). Documented columns COST..SUPPLIER
 * are not needed by the first profile and are not modeled — the reader fails
 * closed on them. Two board formats of the same finish/thickness need
 * distinct stock identities (investigation §4 BOARDS rule).
 */
export interface PtxBoardRecord {
  readonly type: 'BOARDS';
  readonly jobIndex: number;
  readonly boardIndex: number;
  readonly code: string;
  readonly materialIndex: number;
  readonly length: number;
  readonly width: number;
  readonly stockQuantity?: number;
  readonly usedQuantity?: number;
}

/**
 * MATERIALS,JOB_INDEX,MAT_INDEX,CODE,DESC,THICK,BOOK,KERF_RIP,KERF_XCT,
 * TRIM_FRIP,TRIM_VRIP,TRIM_FXCT,TRIM_VXCT,TRIM_HEAD,TRIM_FRCT,TRIM_VRCT,
 * RULE1,RULE2,RULE3,RULE4 (implemented width: 20 cells with family).
 * MAT_PARAM/GRAIN/PICTURE/DENSITY are documented but not modeled — reader
 * fails closed. BOOK counts boards, not millimetres. Trims include kerf
 * [S03 pp.134–135]. RULE1 limits depth; RULE2 enables headings; RULE3 board
 * turn; RULE4 duplicate separation.
 */
export interface PtxMaterialRecord {
  readonly type: 'MATERIALS';
  readonly jobIndex: number;
  readonly materialIndex: number;
  readonly code: string;
  readonly description?: string;
  readonly thickness: number;
  readonly bookQuantity: number;
  readonly kerfRip: number;
  readonly kerfCrosscut: number;
  readonly trimFRip?: number;
  readonly trimVRip?: number;
  readonly trimFXct?: number;
  readonly trimVXct?: number;
  readonly trimHead?: number;
  readonly trimFRct?: number;
  readonly trimVRct?: number;
  readonly rule1?: number;
  readonly rule2?: number;
  readonly rule3?: number;
  readonly rule4?: number;
}

/**
 * PATTERNS,JOB_INDEX,PTN_INDEX,BRD_INDEX,TYPE,QTY_RUN,QTY_CYCLES,MAX_BOOK
 * (implemented width: 8 cells with family). PICTURE/CYCLE_TIME/TOTAL_TIME
 * are documented but not modeled — reader fails closed. First candidate:
 * one board per cycle, no pattern compression unless a test needs it.
 */
export interface PtxPatternRecord {
  readonly type: 'PATTERNS';
  readonly jobIndex: number;
  readonly patternIndex: number;
  readonly boardIndex: number;
  readonly patternType: PtxPatternType;
  readonly runQuantity?: number;
  readonly cyclesQuantity?: number;
  readonly maxBook?: number;
}

/**
 * CUTS,JOB_INDEX,PTN_INDEX,CUT_INDEX,SEQUENCE,FUNCTION,DIMENSION,QTY_RPT,
 * PART_INDEX,QTY_PARTS,COMMENT (11 cells). DIMENSION is the RELATIVE measure
 * of the sub-panel, never a global coordinate (investigation §5: the C cut
 * edge sits at global X=734 but its dimension is 280). CUT_INDEX preserves
 * nesting; SEQUENCE expresses execution order — reordering rows by SEQUENCE
 * destroys the tree. QTY_RPT=0 rows (e.g. an offcut release) are valid and
 * must not be animated as an extra saw pass.
 */
export interface PtxCutRecord {
  readonly type: 'CUTS';
  readonly jobIndex: number;
  readonly patternIndex: number;
  readonly cutIndex: number;
  readonly sequence: number;
  readonly functionCode: number;
  readonly dimension: number;
  readonly repeatQuantity: number;
  readonly partReference: PtxPartReference;
  readonly producedQuantity: number;
  /** Auxiliary description; never machining authority. */
  readonly comment?: string;
}

/**
 * OFFCUTS,JOB_INDEX,OFFCUT_INDEX,CODE,MAT_INDEX,LENGTH,WIDTH (implemented
 * width: 7 cells with family). The documented inventory beyond these certain
 * columns differs between the abbreviated headers, examples and manual tables
 * (investigation §9), so nothing beyond WIDTH is modeled and rows carrying
 * extra columns fail closed instead of being guessed. Referenced from CUTS
 * via `Xn`. Create only from terminal rectangular leaves of the tree.
 */
export interface PtxOffcutRecord {
  readonly type: 'OFFCUTS';
  readonly jobIndex: number;
  readonly offcutIndex: number;
  readonly code: string;
  readonly materialIndex: number;
  readonly length: number;
  readonly width: number;
}

/**
 * VECTORS,JOB_INDEX,PTN_INDEX,CUT_INDEX,X_START,Y_START,X_END,Y_END
 * (8 cells). Absolute positions including kerf per the documented
 * convention (CUTS uses relative measures instead) [S03 pp.146–147].
 * Geometry must come from the node; never a second optimizer.
 */
export interface PtxVectorRecord {
  readonly type: 'VECTORS';
  readonly jobIndex: number;
  readonly patternIndex: number;
  readonly cutIndex: number;
  readonly xStart: number;
  readonly yStart: number;
  readonly xEnd: number;
  readonly yEnd: number;
}

export type PtxRecord =
  | PtxJobRecord
  | PtxPartsReqRecord
  | PtxBoardRecord
  | PtxMaterialRecord
  | PtxPatternRecord
  | PtxCutRecord
  | PtxOffcutRecord
  | PtxVectorRecord;

export type PtxRecordType = PtxRecord['type'];

/** A whole PTX file: one HEADER plus the remaining records in file order. */
export interface PtxDocument {
  readonly header: PtxHeaderRecord;
  readonly records: readonly PtxRecord[];
}

/**
 * Implemented content width per family (cells AFTER the family token).
 * Mirrors the per-record documentation above; the reader in parse.ts keeps
 * an independent table and the tests cross-check both against the dossier.
 */
export const PTX_RECORD_CONTENT_WIDTH: Readonly<Record<PtxRecordType | 'HEADER', number>> = {
  HEADER: 5,
  JOBS: 11,
  PARTS_REQ: 11,
  BOARDS: 8,
  MATERIALS: 19,
  PATTERNS: 7,
  CUTS: 10,
  OFFCUTS: 6,
  VECTORS: 7,
};
