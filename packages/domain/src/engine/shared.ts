/**
 * Shared engine helpers: catalog lookups, edge-band flag math, and the parametric
 * formula evaluator.
 *
 * Extracted from the original engine.ts so that bom / pricing / cut / labels can
 * all reuse them without creating import cycles between those modules.
 */

import { ValidationError } from '../errors';
import type {
  Catalog,
  EdgeAssignment,
  EdgeBand,
  Grain,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
} from '../types';

/** Option-role convention for board-edge band choices (PRD §13.5). */
export const EDGE_OPTION_ROLE = 'EDGE';

export function findOptionGroup(
  catalog: Catalog,
  code: string,
): OptionGroup | undefined {
  return catalog.optionGroups.find((g) => g.code === code);
}

export function findMaterial(catalog: Catalog, id: string): MaterialBoard | undefined {
  return catalog.materials.find((m) => m.id === id);
}

export function findEdgeBand(catalog: Catalog, id: string): EdgeBand | undefined {
  return catalog.edges.find((e) => e.id === id);
}

export function findHardware(catalog: Catalog, id: string): Hardware | undefined {
  return catalog.hardware.find((h) => h.id === id);
}

export function findModule(catalog: Catalog, id: string): Module | undefined {
  return catalog.modules.find((m) => m.id === id);
}

export function edgeFlags(edges: readonly EdgeAssignment[]): {
  L1: number;
  L2: number;
  W1: number;
  W2: number;
} {
  const bySide = Object.fromEntries(
    edges.map((e) => [e.side, e.enabled ? 1 : 0]),
  ) as Record<string, number>;
  return {
    L1: bySide.L1 ?? 0,
    L2: bySide.L2 ?? 0,
    W1: bySide.W1 ?? 0,
    W2: bySide.W2 ?? 0,
  };
}

export function hasAnyEdgeEnabled(edges: readonly EdgeAssignment[]): boolean {
  return edges.some((e) => e.enabled);
}

// Grain kept as type-only import so the formula evaluator stays decoupled.
// (Referenced indirectly via the W/H/D substitution below.)
export type { Grain };

/**
 * Safely evaluates simple math formulas involving W, H, D, T, B, PW, PH, PD variables and numbers.
 * B = plinth / toe-kick height (zoclo), mm.
 */
export function evaluatePartFormula(
  formula: string,
  dims: {
    W: number;
    H: number;
    D: number;
    PW?: number;
    PH?: number;
    PD?: number;
    T?: number;
    B?: number;
    i?: number;
  },
  contextInfo?: { structureCode: string; partDescription: string; field: 'length' | 'width' | 'x' | 'y' | 'z' }
): number {
  const trimmed = formula.trim();
  if (!trimmed) {
    throw new ValidationError('La fórmula no puede estar vacía', {
      ...contextInfo,
      field: contextInfo?.field,
    });
  }

  // Validate allowed characters: digits, decimal point, W/H/D/P/T/B/L/i, operators, whitespace.
  // Decimal point is required for literals like "1.5" or "W * 1.5" (half-thickness, margins, etc.).
  const clean = trimmed.replace(/\s+/g, '');
  if (!/^[0-9.WHDTPBLi+\-*/()]+$/.test(clean)) {
    throw new ValidationError(`La fórmula "${formula}" contiene caracteres no válidos. Solo se permiten números (con decimal), W, H, D, P, T, B, L, i y operadores (+, -, *, /, paréntesis).`, {
      ...contextInfo,
      field: contextInfo?.field,
    });
  }

  // Determine parent vs component variables
  const pw = dims.PW !== undefined ? dims.PW : dims.W;
  const ph = dims.PH !== undefined ? dims.PH : dims.H;
  const pd = dims.PD !== undefined ? dims.PD : dims.D;
  const t = dims.T !== undefined ? dims.T : 0;
  const b = dims.B !== undefined ? dims.B : 0;

  // Substitute variables (multi-letter tokens before single letters)
  const expr = clean
    .replace(/PW/g, String(pw))
    .replace(/PH/g, String(ph))
    .replace(/PD/g, String(pd))
    .replace(/W/g, String(dims.W))
    .replace(/H/g, String(dims.H))
    .replace(/D/g, String(dims.D))
    .replace(/L/g, String(dims.D))
    .replace(/T/g, String(t))
    .replace(/B/g, String(b))
    .replace(/i/g, String(dims.i ?? 0));

  try {
    // Safe evaluation using Function context
    const result = new Function(`return (${expr})`)();
    if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
      throw new Error('No es un número válido');
    }
    return Math.round(result);
  } catch (err) {
    throw new ValidationError(`La fórmula "${formula}" no se pudo evaluar correctamente.`, {
      ...contextInfo,
      field: contextInfo?.field,
    });
  }
}
