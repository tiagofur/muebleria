/**
 * Opening front contract v2 (#1529, ADR-0009 Amendment 1 A3): one gap per
 * edge of the front stack. TS parity of the Go engine's
 * ResolveOpeningEdgeStack through contracts/openingFrontEdgeStack.contract.json
 * — the server resolve is the authority; this is never a second resolver.
 *
 * Measured from the cabinet height H (z = 0 at the body bottom):
 *   - top edge:    H − D_top + r_bottom with a top grip, else H − r_top;
 *   - bottom edge: −X with a bottom overhang X, else r_bottom;
 *   - gap below row i: D_between when that edge has a grip, else the
 *     catalog gap;
 *   - remaining = top − bottom − Σ gaps, split by row weight.
 *
 * Precision: inputs are multiples of 0.5 mm; the math runs in integer half
 * millimetres; leftover half millimetres go to the lowest row first.
 */

import type { OpeningResolutionErrorCode } from './openingFront';

export const OPENING_FRONT_CONTRACT_V2 = 'granete.opening-front.v2' as const;

export type OpeningEdgeStackRow = { readonly id: string; readonly weight: number };

export type OpeningEdgeBetweenGrip = { readonly upperRowId: string; readonly discountMm: number };

export type OpeningEdgeStackInput = {
  readonly cabinetHeightMm: number;
  /** Rows top → bottom; fronts side by side share a row. */
  readonly rows: readonly OpeningEdgeStackRow[];
  readonly topRevealMm: number;
  readonly bottomRevealMm: number;
  /** Catalog gap below each row except the last (length rows − 1). */
  readonly gapsMm: readonly number[];
  readonly topDiscountMm?: number;
  readonly betweenGrips?: readonly OpeningEdgeBetweenGrip[];
  readonly bottomOverhangMm?: number;
};

export type OpeningEdgeStackResolvedRow = {
  readonly id: string;
  readonly bottomMm: number;
  readonly heightMm: number;
};

export type OpeningEdgeStackResolution = {
  readonly contract: typeof OPENING_FRONT_CONTRACT_V2;
  readonly topEdgeMm: number;
  readonly bottomEdgeMm: number;
  readonly rows: readonly OpeningEdgeStackResolvedRow[];
  readonly remainderRowId: string;
};

export type OpeningEdgeStackResult =
  | { readonly ok: true; readonly resolution: OpeningEdgeStackResolution }
  | { readonly ok: false; readonly errorCode: OpeningResolutionErrorCode; readonly message: string };

class EdgeStackError extends Error {
  constructor(readonly errorCode: OpeningResolutionErrorCode, message: string) {
    super(message);
  }
}

function toHalfMm(value: number, field: string): number {
  const half = value * 2;
  const rounded = Math.round(half);
  if (!Number.isFinite(value) || Math.abs(half - rounded) > 1e-6) {
    throw new EdgeStackError('OPENING_LAYOUT_INVALID', `${field} debe ser múltiplo de 0,5 mm (${value})`);
  }
  return rounded;
}

/** Applies A3 to a stack of fronts. Pure; identical to the Go engine. */
export function resolveOpeningEdgeStack(input: OpeningEdgeStackInput): OpeningEdgeStackResult {
  try {
    return { ok: true, resolution: resolve(input) };
  } catch (error) {
    if (error instanceof EdgeStackError) {
      return { ok: false, errorCode: error.errorCode, message: error.message };
    }
    throw error;
  }
}

function resolve(input: OpeningEdgeStackInput): OpeningEdgeStackResolution {
  const { rows } = input;
  if (rows.length === 0) {
    throw new EdgeStackError('OPENING_LAYOUT_INVALID', 'la pila de frentes no tiene filas');
  }
  if (input.gapsMm.length !== rows.length - 1) {
    throw new EdgeStackError(
      'OPENING_LAYOUT_INVALID',
      `la pila de ${rows.length} filas necesita ${rows.length - 1} huecos entre frentes`,
    );
  }
  const seen = new Set<string>();
  let weightSum = 0;
  for (const row of rows) {
    if (row.id === '' || seen.has(row.id)) {
      throw new EdgeStackError('OPENING_LAYOUT_INVALID', `fila sin id o repetida "${row.id}"`);
    }
    seen.add(row.id);
    if (!(row.weight > 0)) {
      throw new EdgeStackError('OPENING_LAYOUT_INVALID', `la fila ${row.id} tiene un peso inválido`);
    }
    weightSum += row.weight;
  }
  const h = toHalfMm(input.cabinetHeightMm, 'el alto del mueble');
  const rTop = toHalfMm(input.topRevealMm, 'la holgura superior');
  const rBottom = toHalfMm(input.bottomRevealMm, 'la holgura inferior');
  if (h <= 0 || rTop < 0 || rBottom < 0) {
    throw new EdgeStackError('OPENING_LAYOUT_INVALID', 'el alto debe ser positivo y las holguras no negativas');
  }

  let top = h - rTop;
  if (input.topDiscountMm !== undefined) {
    const discount = toHalfMm(input.topDiscountMm, 'el descuento del frente arriba');
    if (discount <= 0) {
      throw new EdgeStackError('OPENING_LAYOUT_INVALID', 'el descuento del frente arriba debe ser mayor a 0');
    }
    top = h - discount + rBottom;
  }
  let bottom = rBottom;
  if (input.bottomOverhangMm !== undefined) {
    const overhang = toHalfMm(input.bottomOverhangMm, 'el rebase');
    if (overhang <= 0) {
      throw new EdgeStackError('OPENING_LAYOUT_INVALID', 'el rebase debe ser mayor a 0');
    }
    bottom = -overhang;
  }

  const rowIndex = new Map(rows.map((row, i) => [row.id, i] as const));
  const betweenByIndex = new Map<number, number>();
  for (const grip of input.betweenGrips ?? []) {
    const index = rowIndex.get(grip.upperRowId);
    if (index === undefined || index >= rows.length - 1) {
      throw new EdgeStackError(
        'OPENING_BOUNDARY_INVALID',
        `la gola entre frentes bajo "${grip.upperRowId}" no tiene un frente debajo`,
      );
    }
    if (betweenByIndex.has(index)) {
      throw new EdgeStackError('OPENING_BOUNDARY_DUPLICATE', `gola entre frentes repetida bajo "${grip.upperRowId}"`);
    }
    betweenByIndex.set(index, grip.discountMm);
  }
  const gaps: number[] = [];
  let gapSum = 0;
  input.gapsMm.forEach((gapMm, i) => {
    let gap = toHalfMm(gapMm, 'el hueco entre frentes');
    const discount = betweenByIndex.get(i);
    if (discount !== undefined) {
      gap = toHalfMm(discount, 'el descuento entre frentes');
      if (gap <= 0) {
        throw new EdgeStackError('OPENING_LAYOUT_INVALID', 'el descuento entre frentes debe ser mayor a 0');
      }
    }
    if (gap < 0) {
      throw new EdgeStackError('OPENING_LAYOUT_INVALID', 'el hueco entre frentes no puede ser negativo');
    }
    gaps.push(gap);
    gapSum += gap;
  });

  const remaining = top - bottom - gapSum;
  if (remaining <= 0) {
    throw new EdgeStackError('OPENING_LAYOUT_INVALID', 'los descuentos consumen más que el alto del mueble');
  }
  const heights = rows.map((row) => Math.floor((remaining * row.weight) / weightSum));
  let used = heights.reduce((sum, height) => sum + height, 0);
  for (let i = rows.length - 1; i >= 0 && used < remaining; i--) {
    heights[i] = (heights[i] ?? 0) + 1;
    used++;
  }
  heights.forEach((height, i) => {
    if (height <= 0) {
      throw new EdgeStackError('OPENING_LAYOUT_INVALID', `la fila ${rows[i]?.id} queda sin altura`);
    }
  });

  let cursor = top;
  const resolved = rows.map((row, i) => {
    const height = heights[i] ?? 0;
    cursor -= height;
    const out = { id: row.id, bottomMm: cursor / 2, heightMm: height / 2 };
    if (i < gaps.length) cursor -= gaps[i] ?? 0;
    return out;
  });
  return {
    contract: OPENING_FRONT_CONTRACT_V2,
    topEdgeMm: top / 2,
    bottomEdgeMm: bottom / 2,
    rows: resolved,
    remainderRowId: rows[rows.length - 1]?.id ?? '',
  };
}
