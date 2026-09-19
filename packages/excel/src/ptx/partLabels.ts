/**
 * Frozen industrial label projection per physical piece (#789 — r5 groundwork).
 *
 * PRINCIPLE (docs/machines/ptx-cadmatic4/07_plan_r5_receiver_labels_cnc.md
 * §5/§6, 06_dossier §7): the PTX serializer must never REBUILD label data.
 * Every PARTS_INF value comes from this projection — one entry per PHYSICAL
 * piece, assembled once from the engineering/release truth (finished
 * measures, edge side flags, frozen workshop occurrence ordinal, module
 * identity, room) and then only PROJECTED to columns by the compiler. The
 * projection builder is the ONLY place that translates Granete's workshop
 * side convention (L1/L2/W1/W2) to the four PTX EDGE columns, so an
 * orientation bug has exactly one place to live and one test to fail.
 *
 * Identity chain (issue #789):
 *
 *     physical piece
 *       ↔ manufacturingPartCode (= PARTS_REQ.CODE under the r4+ authority)
 *       ↔ PART_INDEX
 *       ↔ PARTS_INF row
 *       ↔ DRAWING (cncDrawingRef, D<hex12>) / BARCODE1 (scan token)
 *       ↔ future CNC artifact (MPR/MPRX basename) — NOT generated here.
 *
 * Authorities (each documented in 09_parts_inf_labels_cnc.md):
 * - finishedLength/WidthMm: COPIED verbatim from the engineering cut row
 *   (ProductionCutRow carries the finished convention — the optimizer's
 *   edge-band deduction is an optimization input, never pre-applied there
 *   and never re-derived here; see unrollRows for the single deduction site);
 * - edges: L2→EDGE1 (Btm length), L1→EDGE2 (Top length), W1→EDGE3 (Left
 *   width), W2→EDGE4 (Right width) — Granete's side convention is documented
 *   in packages/ui PlankEdgeDiagram (length horizontal, facing the viewer);
 *   the PTX column meanings are the §20 dictionary comments;
 * - product number: the FROZEN workshop occurrence ordinal of the unit
 *   (#781), never an array position;
 * - DRAWING: deterministic 48-bit digest of explicit frozen CNC/release
 *   scope + manufacturing code (`D<hex12>`, same collision discipline as the
 *   r4 `G<hex12>` filename); a piece without explicit machining authority
 *   carries NO drawing ref (empty cell) and no fake program is implied;
 * - LABEL_QTY: one label per physical piece — the candidate ships one row
 *   per piece, so the quantity is "1" by product policy, never copied from
 *   a field sample.
 *
 * What this module deliberately does NOT do: consult the live catalog,
 * SketchUp, BOM re-derivation or any name-based fallback; invent EDG_PG*
 * program codes; generate PARTS_UDI compact edge encodings (UNKNOWN); or
 * emit image/picture artifacts (presentation only — future follow-up).
 */

import { sha256Hex } from '../machines/digest';
import type { ProductionCutRow } from '@granete/domain';
import { PtxCompilationError } from './compileCutPlan';

// ---------------------------------------------------------------------------
// Frozen projection types
// ---------------------------------------------------------------------------

/**
 * One physical piece's frozen label data. `manufacturingPartCode` is the key
 * the compiler matches against PARTS_REQ.CODE (partCodeAuthority
 * 'workshop-labelref'): every placed piece needs exactly one entry when the
 * label projection is enabled, and an entry without a matching PARTS_REQ row
 * blocks compilation.
 */
export interface PtxPartLabelData {
  readonly manufacturingPartCode: string;
  /** DESC — human part name/description from the engineering row. */
  readonly description?: string;
  /** FIN_LENGTH/FIN_WIDTH source measures (mm, finished convention), copied verbatim from the row. */
  readonly finishedLengthMm: number;
  readonly finishedWidthMm: number;
  /** ORDER — short work/release reference (e.g. "R3"); absent = empty cell. */
  readonly orderRef?: string;
  /** LABEL_QTY policy value; the candidate writes String(quantity). */
  readonly labelQuantity: number;
  /** EDGE1 (Btm length) band code when Granete's L2 side is banded. */
  readonly edge1?: string;
  /** EDGE2 (Top length) band code when Granete's L1 side is banded. */
  readonly edge2?: string;
  /** EDGE3 (Left width) band code when Granete's W1 side is banded. */
  readonly edge3?: string;
  /** EDGE4 (Right width) band code when Granete's W2 side is banded. */
  readonly edge4?: string;
  /** FACE_LAM/BACK_LAM — no separate lamination authority in Granete; stays unset. */
  readonly faceLaminate?: string;
  readonly backLaminate?: string;
  /** CORE_MAT — board material code authorized by ProductionCutRow.materialCode. */
  readonly coreMaterial?: string;
  /** DRAWING — short CNC drawing reference; absent for a piece without explicit machining authority. */
  readonly cncDrawingRef?: string;
  /** PRODUCT — furniture/module code. */
  readonly productCode?: string;
  /** PROD_INFO — furniture/module human name. */
  readonly productInfo?: string;
  /** PROD_WIDTH/HGT/DEPTH (mm) — final furniture dimensions. */
  readonly productWidthMm?: number;
  readonly productHeightMm?: number;
  readonly productDepthMm?: number;
  /** PROD_NUM — the frozen 1-based workshop occurrence ordinal of the physical unit. */
  readonly productNumber?: number;
  /** ROOM — named space/room of the project. */
  readonly room?: string;
  /** BARCODE1 — scan token linked to the CNC drawing ref. */
  readonly barcode1?: string;
  /** BARCODE2 — manufacturing part code (tracking token with real authority). */
  readonly barcode2?: string;
  /** COLOUR — no separate colour authority in Granete; stays unset. */
  readonly colour?: string;
  /** PARTS_UDI INFO1 — picture/label-artifact reference (presentation, never geometry authority). */
  readonly udiPictureRef?: string;
}

/** Furniture/module context of one physical unit (PROD_* + ROOM sources). */
export interface PtxPartLabelUnitContext {
  /** Frozen 1-based manufacturing occurrence ordinal (#781 release authority). */
  readonly workshopOccurrenceOrdinal: number;
  readonly moduleCode: string;
  readonly moduleName?: string;
  readonly moduleWidthMm?: number;
  readonly moduleHeightMm?: number;
  readonly moduleDepthMm?: number;
  /** Named space/room the unit is placed in (ModuleLabel.spaceName authority). */
  readonly room?: string;
}

export interface PtxPartLabelInput {
  /**
   * Engineering cut row (finished-measure convention): labelRef is the
   * manufacturing code of copy 1; quantity>1 rows expand per physical piece
   * with the SAME -C<n> suffix discipline as the optimizer's unrollRows.
   */
  readonly row: ProductionCutRow;
  readonly unit: PtxPartLabelUnitContext;
  /** ORDER — short release reference applied to every piece of the release. */
  readonly orderRef?: string;
  /**
   * Explicit CNC machining authority. Only true permits DRAWING/BARCODE1;
   * false or absent emits neither and never implies a fake program.
   */
  readonly hasCncMachining?: boolean;
  /** Frozen deterministic release/CNC scope required when hasCncMachining is true. */
  readonly cncScope?: string;
}

// ---------------------------------------------------------------------------
// CNC drawing reference (durable bridge, #789 §6)
// ---------------------------------------------------------------------------

/** Namespaced digest input so a drawing ref can never collide with a filename token by design. */
export const PTX_CNC_DRAWING_REF_NAMESPACE = 'granete:ptx-cnc-drawing' as const;

/**
 * Short CNC drawing reference: `D` + 12 uppercase hex chars (48 bits) of
 * sha256 over the namespaced manufacturing code — ASCII, deterministic,
 * stable within a release (the code is frozen), never a UUID, and suitable
 * as a future MPR/MPRX program basename. Same 48-bit collision discipline
 * as the r4 `G<hex12>.ptx` filename (#781): the compiler fails closed on a
 * collision instead of disambiguating silently.
 */
export async function ptxCncDrawingRef(
  manufacturingPartCode: string,
  cncScope: string,
): Promise<string> {
  const scope = cncScope.trim();
  if (scope === '') {
    throw new PtxCompilationError(
      'ptx_compile.label_invalid',
      'DRAWING exige un scope CNC/release congelado y explícito',
      { manufacturingPartCode, cncScope },
    );
  }
  requireAscii(scope, 'cncScope', manufacturingPartCode);
  const token = (
    await sha256Hex(`${PTX_CNC_DRAWING_REF_NAMESPACE}:${scope}:${manufacturingPartCode}`)
  ).slice(0, 12).toUpperCase();
  return `D${token}`;
}

/** Code 39 scan token wrapping (leading/trailing `*`), as evidenced by both field samples. */
export function ptxBarcodeToken(value: string): string {
  return `*${value}*`;
}

// ---------------------------------------------------------------------------
// Side mapping (the ONLY L/W → EDGE translation site)
// ---------------------------------------------------------------------------

/**
 * Granete workshop sides → PTX EDGE columns. Granete's convention (PlankEdgeDiagram,
 * zplLabels): L1 = top LONG edge, L2 = bottom LONG edge, W1 = left SHORT
 * edge, W2 = right SHORT edge (plank flat, length horizontal, facing the
 * viewer). The §20 dictionary comments: EDGE1 "Btm length edge code", EDGE2
 * "Top length edge code", EDGE3 "Left width edge code", EDGE4 "Right width
 * edge code". Both look at the same face the same way up, so:
 *
 *     EDGE1 ← L2 (bottom length)   EDGE2 ← L1 (top length)
 *     EDGE3 ← W1 (left width)      EDGE4 ← W2 (right width)
 *
 * Deliberate NON-symmetry (L1 does NOT feed EDGE1): the asymmetric-trap
 * tests in partLabels.test.ts fail on any swap of this mapping.
 */
export const PTX_EDGE_COLUMN_BY_WORKSHOP_SIDE: Readonly<
  Record<'L1' | 'L2' | 'W1' | 'W2', 'edge1' | 'edge2' | 'edge3' | 'edge4'>
> = {
  L1: 'edge2',
  L2: 'edge1',
  W1: 'edge3',
  W2: 'edge4',
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function isPrintableAscii(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

function requireAscii(value: string, field: string, code: string): string {
  if (value === '' || !isPrintableAscii(value)) {
    throw new PtxCompilationError(
      'ptx_compile.identity_not_ascii',
      `Identidad de etiqueta '${field}' no es ASCII de impresión: rechazada en vez de mutilarse`,
      { field, value, manufacturingPartCode: code },
    );
  }
  return value;
}

function auxiliaryText(value: string | undefined, field: string, code: string): string | undefined {
  if (value === undefined) return undefined;
  const filtered = requireAsciiFilter(value, field, code);
  return filtered === '' ? undefined : filtered;
}

/** Auxiliary label text: printable-ASCII filter; empty result stays undefined (empty cell). */
function requireAsciiFilter(value: string, field: string, code: string): string {
  if (isPrintableAscii(value)) return value;
  let out = '';
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) out += ch;
  }
  if (out === '') {
    throw new PtxCompilationError(
      'ptx_compile.identity_not_ascii',
      `Texto de etiqueta '${field}' sin representación ASCII de impresión: rechazado en vez de reescribirse`,
      { field, value, manufacturingPartCode: code },
    );
  }
  return out;
}

function requirePositiveInteger(value: number | undefined, field: string, code: string): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    throw new PtxCompilationError(
      'ptx_compile.label_invalid',
      `'${field}' debe ser un entero >= 1 (autoridad de etiqueta congelada)`,
      { field, value, manufacturingPartCode: code },
    );
  }
  return value;
}

function requireFiniteMagnitude(value: number | undefined, field: string, code: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new PtxCompilationError(
      'ptx_compile.label_invalid',
      `'${field}' debe ser un número finito > 0 (medida final congelada)`,
      { field, value, manufacturingPartCode: code },
    );
  }
  return value;
}

function requirePositiveIntegerOptional(
  value: number | undefined,
  field: string,
  code: string,
): number | undefined {
  if (value === undefined) return undefined;
  return requirePositiveInteger(value, field, code);
}

function requireFiniteMagnitudeOptional(
  value: number | undefined,
  field: string,
  code: string,
): number | undefined {
  if (value === undefined) return undefined;
  return requireFiniteMagnitude(value, field, code);
}

/**
 * Builds the frozen label data of ONE physical piece copy. `copy` is 1-based
 * within the row; copies 2..N carry the optimizer's `-C<n>` suffix so the
 * manufacturing code stays unique per physical piece (same discipline as
 * unrollRows — the two must agree, tested in partLabels.test.ts).
 */
export async function buildPtxPartLabelData(
  input: PtxPartLabelInput,
  copy: number,
): Promise<PtxPartLabelData> {
  const { row, unit, orderRef } = input;
  const baseCode = (row.labelRef ?? '').trim() || row.partCode?.trim() || '';
  if (baseCode === '') {
    throw new PtxCompilationError(
      'ptx_compile.label_invalid',
      'La fila de ingeniería no tiene labelRef ni partCode: la pieza física no tiene código de fabricación',
      { rowPartCode: row.partCode ?? null },
    );
  }
  const manufacturingPartCode = copy > 1 ? `${baseCode}-C${copy}` : baseCode;
  requireAscii(manufacturingPartCode, 'manufacturingPartCode', manufacturingPartCode);

  const band = row.edgeBandCode?.trim() || undefined;
  if (band !== undefined) {
    requireAscii(band, 'edgeBandCode', manufacturingPartCode);
  }
  const edgeFlags = (['L1', 'L2', 'W1', 'W2'] as const).filter((side) => row[side] === 1);
  if (edgeFlags.length > 0 && band === undefined) {
    throw new PtxCompilationError(
      'ptx_compile.label_invalid',
      'Una bandera de canto exige edgeBandCode autoritativo no vacío',
      { manufacturingPartCode, edgeFlags },
    );
  }
  // The ONLY L/W → EDGE translation: banded side carries the band code,
  // unbanded side stays undefined (empty cell). Never a synthesized value.
  const edgeOf = (side: 'L1' | 'L2' | 'W1' | 'W2'): string | undefined =>
    row[side] === 1 ? band : undefined;

  const hasCnc = input.hasCncMachining === true;
  const cncDrawingRef = hasCnc
    ? await ptxCncDrawingRef(manufacturingPartCode, input.cncScope ?? '')
    : undefined;

  return {
    manufacturingPartCode,
    description: auxiliaryText(row.partName ?? row.description, 'description', manufacturingPartCode),
    // Finished measures are COPIED from the engineering row — the single
    // deduction site stays unrollRows (optimizer); nothing is added back here.
    finishedLengthMm: requireFiniteMagnitude(row.lengthMm, 'finishedLengthMm', manufacturingPartCode),
    finishedWidthMm: requireFiniteMagnitude(row.widthMm, 'finishedWidthMm', manufacturingPartCode),
    orderRef: auxiliaryText(orderRef, 'orderRef', manufacturingPartCode),
    labelQuantity: 1,
    edge1: edgeOf('L2'),
    edge2: edgeOf('L1'),
    edge3: edgeOf('W1'),
    edge4: edgeOf('W2'),
    coreMaterial: requireAscii(row.materialCode, 'materialCode', manufacturingPartCode),
    cncDrawingRef,
    productCode: auxiliaryText(unit.moduleCode, 'productCode', manufacturingPartCode),
    productInfo: auxiliaryText(unit.moduleName, 'productInfo', manufacturingPartCode),
    productWidthMm: requireFiniteMagnitudeOptional(unit.moduleWidthMm, 'productWidthMm', manufacturingPartCode),
    productHeightMm: requireFiniteMagnitudeOptional(unit.moduleHeightMm, 'productHeightMm', manufacturingPartCode),
    productDepthMm: requireFiniteMagnitudeOptional(unit.moduleDepthMm, 'productDepthMm', manufacturingPartCode),
    productNumber: requirePositiveIntegerOptional(
      unit.workshopOccurrenceOrdinal,
      'workshopOccurrenceOrdinal',
      manufacturingPartCode,
    ),
    room: auxiliaryText(unit.room, 'room', manufacturingPartCode),
    barcode1: cncDrawingRef !== undefined ? ptxBarcodeToken(cncDrawingRef) : undefined,
    barcode2: manufacturingPartCode,
  };
}

/**
 * Builds the full projection: one label per PHYSICAL piece, expanding
 * quantity>1 rows with the -C<n> copy suffix (the same expansion the
 * optimizer performs), in row order. Deterministic; fails closed on any
 * non-ASCII identity, missing code, or non-finite measure.
 */
export async function buildPtxPartLabels(
  inputs: readonly PtxPartLabelInput[],
): Promise<readonly PtxPartLabelData[]> {
  const labels: PtxPartLabelData[] = [];
  for (const input of inputs) {
    const quantity = input.row.quantity;
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1) {
      throw new PtxCompilationError(
        'ptx_compile.label_invalid',
        'row.quantity debe ser un entero finito >= 1 para emitir etiquetas físicas',
        { quantity, rowPartCode: input.row.partCode ?? null, labelRef: input.row.labelRef ?? null },
      );
    }
    for (let copy = 1; copy <= quantity; copy++) {
      labels.push(await buildPtxPartLabelData(input, copy));
    }
  }
  const seen = new Map<string, PtxPartLabelData>();
  for (const label of labels) {
    const previous = seen.get(label.manufacturingPartCode);
    if (previous !== undefined) {
      throw new PtxCompilationError(
        'ptx_compile.label_code_duplicate',
        'Dos piezas físicas comparten el código de fabricación de la proyección de etiqueta',
        { manufacturingPartCode: label.manufacturingPartCode },
      );
    }
    seen.set(label.manufacturingPartCode, label);
  }
  return labels;
}
