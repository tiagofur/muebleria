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
 * "Información y remanentes" and §9): PARTS_DST, PTN_UDI, NOTES, and every
 * optional column beyond the implemented width of each family (documented per
 * record below). PARTS_INF and PARTS_UDI got their full typed shape in #789
 * (see the per-record documentation below). The reader fails closed on
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
 * The DOCUMENTED Pattern Exchange domain of PATTERNS.TYPE is INT 0-8
 * (§20 p.175). The record model carries the documented domain so readers
 * (parser, spec preflight) can represent and inspect every documented value:
 * 5–8 are SPEC-valid grain-matching templates (S12). The candidate's
 * productive subset remains PTX_PATTERN_TYPE (0–4) — validate.ts/compiler
 * own that PRODUCT restriction and nothing here enables emitting 5–8.
 */
export type PtxDocumentedPatternType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

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
 * parse and validate: 0 head, 1 rip, 2 cross, 3 third-phase recut, and 92 —
 * the phase-2 trim/waste pass demonstrated by the two field samples
 * (04_contrato_r3_refilados.md §6; #661). FUNCTION 92 rows carry extra
 * semantic requirements enforced by validate.ts (QTY_RPT=1, PART_INDEX=Xn,
 * SEQUENCE > 0) and are emitted ONLY by the r3 candidate policy for the
 * demonstrated rest-side phase-2 remnant subset.
 *
 * Deliberately NOT supported (documented ≠ supported — "the manual
 * enumerates the code" is never "Granete can emit it"):
 * - 4 fourth-phase recut: waits for an explicit phase-4 fixture with its
 *   semantics before being enabled;
 * - 5..9 deeper recut phases: no case needs them;
 * - 81 tension: excluded from the first candidate (investigation §9);
 * - 90, 91, 93..99 trims/waste: no demonstrated mapping from Granete
 *   geometry; the perimeter trims are projected to MATERIALS.TRIM_* instead.
 */
export const PTX_SUPPORTED_CUT_FUNCTION_CODES = [0, 1, 2, 3, 92] as const;

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
  /** Documented domain 0–8 (§20 p.175); the productive subset is PTX_PATTERN_TYPE. */
  readonly patternType: PtxDocumentedPatternType;
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
 *
 * QTY_PARTS is OPTIONAL: a physical FUNCTION 92 offcut-release pass (#661,
 * 04_contrato_r3_refilados.md §6.2) carries it ABSENT — an empty cell, never
 * 0 and never 1 — because the pass produces an Xn offcut, not a PARTS_REQ
 * part. Every other row emits an explicit value (0 or 1) as before.
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
  readonly producedQuantity?: number;
  /** Auxiliary description; never machining authority. */
  readonly comment?: string;
}

/**
 * OFFCUTS,JOB_INDEX,OFFCUT_INDEX,CODE,MAT_INDEX,LENGTH,WIDTH[,OFC_QTY]
 * (r2/r3 implemented width: 7 cells with family; r4 (#781) adds the eighth
 * cell OFC_QTY demonstrated by the two field samples — see producedQuantity).
 * The documented inventory beyond these certain columns differs between the
 * abbreviated headers, examples and manual tables (investigation §9), so
 * nothing beyond OFC_QTY is modeled and rows carrying extra columns fail
 * closed instead of being guessed. Referenced from CUTS via `Xn`. Create
 * only from terminal rectangular leaves of the tree.
 */
export interface PtxOffcutRecord {
  readonly type: 'OFFCUTS';
  readonly jobIndex: number;
  readonly offcutIndex: number;
  /**
   * OFFCUTS.CODE (#781 r4 micro-fix): the two functional field samples
   * (R2201/R7301) carry an EMPTY code cell (`OFFCUTS,1,1,,2,1718.601,862.601,1`).
   * The industrial r4 file therefore serializes this cell empty (undefined);
   * Granete's internal remnant identity (regionId, e.g. `place-3-1:rest`)
   * lives in the compilation mapping / CutProgram / verifier — never in this
   * cell. Absent (undefined) = empty cell; a defined value serializes
   * verbatim (r2/r3 historical rows keep their codes byte-exact).
   */
  readonly code?: string;
  readonly materialIndex: number;
  readonly length: number;
  readonly width: number;
  /**
   * OFC_QTY (#781 r4): count of physical remnants this record represents.
   * Field evidence (R2201/R7301 sanitized samples) shows the column with
   * value 1. ABSENT under r2/r3 (those revisions end the row at WIDTH and
   * stay byte-exact). Undefined ≠ 0: absent means the revision's row has no
   * such column, while 0 would be an explicit "no offcuts" value that the
   * demonstrated subset never shows.
   */
  readonly producedQuantity?: number;
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

/**
 * PARTS_INF,JOB_INDEX,PART_INDEX,DESC,LABEL_QTY,FIN_LENGTH,FIN_WIDTH,ORDER,
 * EDGE1,EDGE2,EDGE3,EDGE4,EDG_PG1,EDG_PG2,EDG_PG3,EDG_PG4,FACE_LAM,BACK_LAM,
 * CORE_MAT,PALLET,DRAWING,PRODUCT,PROD_INFO,PROD_WIDTH,PROD_HGT,PROD_DEPTH,
 * PROD_NUM,ROOM,BARCODE1,BARCODE2,COLOUR,SECOND_CUT_LENGTH,SECOND_CUT_WIDTH
 * (32 content cells — the FULL documented §20 width, #789).
 *
 * Documented per-field authority (S03 V11 Interface Guide §20 pp.168–169,
 * extracted 2026-09-19): JOB_INDEX "IDX 1-250", PART_INDEX "IDX 1-9999" and
 * EVERY other column is `TXT 200 chars max.` — including LABEL_QTY,
 * FIN_LENGTH, FIN_WIDTH, PROD_WIDTH/HGT/DEPTH and PROD_NUM. The dictionary
 * types them as TEXT, so the record model carries them as strings and never
 * coerces numbers on read; numeric FORM on write is the candidate's own
 * policy (compileCutPlan formats frozen magnitudes deterministically).
 *
 * Documented side semantics (§20 p.168, verbatim column comments): EDGE1
 * "Btm length edge code", EDGE2 "Top length edge code", EDGE3 "Left width
 * edge code", EDGE4 "Right width edge code"; EDG_PG1..4 are the per-side
 * edge PROGRAM columns. The mapping from Granete's L1/L2/W1/W2 workshop
 * sides (L1=top long, L2=bottom long, W1=left short, W2=right short —
 * packages/ui PlankEdgeDiagram convention, zplLabels uses the same) is
 * L2→EDGE1, L1→EDGE2, W1→EDGE3, W2→EDGE4 and lives in partLabels.ts (the
 * industrial projection), never in the serializer.
 *
 * Fields without real authority stay `undefined` (empty cell) — PALLET,
 * SECOND_CUT_LENGTH/WIDTH are modeled for the documented width but Granete
 * has no pallet/second-cut authority, so the compiler never fills them.
 */
export interface PtxPartsInfRecord {
  readonly type: 'PARTS_INF';
  readonly jobIndex: number;
  readonly partIndex: number;
  /** DESC "Second part desc" — human part name when Granete has one. */
  readonly description?: string;
  /** LABEL_QTY "Label quantity" (TXT): candidate policy writes one label per physical piece ("1"). */
  readonly labelQuantity?: string;
  /** FIN_LENGTH "Finished length" (TXT): the frozen finished measure, never re-derived from cut dims. */
  readonly finishedLength?: string;
  readonly finishedWidth?: string;
  /** ORDER "Original order" — short work/release reference. */
  readonly order?: string;
  /** EDGE1 "Btm length edge code" — edge band code when Granete's L2 side is banded. */
  readonly edge1?: string;
  /** EDGE2 "Top length edge code" — edge band code when Granete's L1 side is banded. */
  readonly edge2?: string;
  /** EDGE3 "Left width edge code" — edge band code when Granete's W1 side is banded. */
  readonly edge3?: string;
  /** EDGE4 "Right width edge code" — edge band code when Granete's W2 side is banded. */
  readonly edge4?: string;
  /** EDG_PG1..4 "Bottom/Top/Left/Right edge program" — only with a real operation/program authority (#789: never filled). */
  readonly edgeProgram1?: string;
  readonly edgeProgram2?: string;
  readonly edgeProgram3?: string;
  readonly edgeProgram4?: string;
  readonly faceLaminate?: string;
  readonly backLaminate?: string;
  /** CORE_MAT "Core material" — board material code authorized by ProductionCutRow.materialCode. */
  readonly coreMaterial?: string;
  readonly pallet?: string;
  /** DRAWING "Name of drawing file" — short deterministic CNC drawing reference (D<hex12>), never a UUID. */
  readonly drawing?: string;
  readonly product?: string;
  readonly productInfo?: string;
  readonly productWidth?: string;
  readonly productHeight?: string;
  readonly productDepth?: string;
  /** PROD_NUM "Product number" (TXT) — the frozen workshop occurrence ordinal of the physical unit. */
  readonly productNumber?: string;
  /** ROOM "Room/group" — the named space of the project when the unit is placed in one. */
  readonly room?: string;
  readonly barcode1?: string;
  readonly barcode2?: string;
  readonly colour?: string;
  readonly secondCutLength?: string;
  readonly secondCutWidth?: string;
}

/**
 * PARTS_UDI,JOB_INDEX,PART_INDEX,INFO1..INFO60 (62 content cells documented;
 * §20 pp.169–171 list exactly 60 homogeneous "Information field N" columns of
 * type TXT 200). The guide gives INFO1..60 NO semantics — they are free
 * user-defined per-part fields. The R2201/R7301 field samples evidence the
 * client's optimizer writing INFO1=<picture>.png, INFO2=<compact edge code>,
 * INFO3/INFO4=<finish>, but that usage is RECEIVER_EVIDENCED, not standard:
 * the compact encoding (e.g. `2WE2LE`) is UNKNOWN and Granete NEVER
 * generates it (#789 decision).
 *
 * The typed model keeps the documented homogeneous shape as a positional
 * array (`info[i - 1]` is INFO<i>); trailing undefined entries are OMITTED
 * cells (the row ends after the last defined INFO), matching the field
 * samples' short rows. Mid-row undefined entries are EMPTY cells.
 */
export interface PtxPartsUdiRecord {
  readonly type: 'PARTS_UDI';
  readonly jobIndex: number;
  readonly partIndex: number;
  /** INFO1..INFO60 (position i-1 = INFO i); all TXT 200. */
  readonly info: readonly (string | undefined)[];
}

/** Documented maximum INFO column count (§20 pp.169–171). */
export const PTX_PARTS_UDI_INFO_COLUMN_COUNT = 60;

export type PtxRecord =
  | PtxJobRecord
  | PtxPartsReqRecord
  | PtxPartsInfRecord
  | PtxPartsUdiRecord
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
 * OFFCUTS counts the full r4 form (#781): the trailing OFC_QTY cell is
 * OPTIONAL — r2/r3 rows omit the cell entirely (no trailing comma) and stay
 * byte-exact, r4 rows carry the evidenced quantity.
 */
export const PTX_RECORD_CONTENT_WIDTH: Readonly<Record<PtxRecordType | 'HEADER', number>> = {
  HEADER: 5,
  JOBS: 11,
  PARTS_REQ: 11,
  PARTS_INF: 32,
  PARTS_UDI: 62,
  BOARDS: 8,
  MATERIALS: 19,
  PATTERNS: 7,
  CUTS: 10,
  OFFCUTS: 7,
  VECTORS: 7,
};
