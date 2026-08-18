/**
 * Factory totals from a resolved cut list (Production module).
 * Board area per material + edge-band meters per assigned band — what the
 * workshop buys and loads, derived from the same rows the Optimizer exports.
 */

import type { ProductionCutRow } from './types';

export type ProductionMaterialTotal = {
  /** Grouping key: material code when present, else material name. */
  readonly key: string;
  readonly name: string;
  readonly materialCode?: string;
  readonly thicknessMm?: number;
  readonly pieces: number;
  readonly lines: number;
  readonly areaM2: number;
};

export type ProductionEdgeTotal = {
  /** Grouping key: edge band code when present, else band name. */
  readonly key: string;
  readonly name: string;
  readonly edgeBandCode?: string;
  readonly thicknessMm?: number;
  readonly ml: number;
};

export type ProductionTotals = {
  readonly materials: readonly ProductionMaterialTotal[];
  readonly edges: readonly ProductionEdgeTotal[];
  readonly totalAreaM2: number;
  readonly totalEdgeMl: number;
  /** Total board pieces across all materials. */
  readonly totalPieces: number;
};

function bandedLengthMm(row: ProductionCutRow): number {
  let mm = 0;
  if (row.L1) mm += row.lengthMm;
  if (row.L2) mm += row.lengthMm;
  if (row.W1) mm += row.widthMm;
  if (row.W2) mm += row.widthMm;
  return mm * row.quantity;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type MutableMaterialAcc = {
  key: string;
  name: string;
  materialCode?: string;
  thicknessMm?: number;
  pieces: number;
  lines: number;
  areaMm2: number;
};

type MutableEdgeAcc = {
  key: string;
  name: string;
  edgeBandCode?: string;
  thicknessMm?: number;
  mlmm: number;
};

export function computeProductionTotals(
  rows: readonly ProductionCutRow[],
): ProductionTotals {
  const materials = new Map<string, MutableMaterialAcc>();
  const edges = new Map<string, MutableEdgeAcc>();

  for (const row of rows) {
    const mKey = row.materialCode ?? row.materialName ?? 'Sin material';
    const mat = materials.get(mKey) ?? {
      key: mKey,
      name: row.materialName,
      materialCode: row.materialCode,
      thicknessMm: row.thicknessMm,
      pieces: 0,
      lines: 0,
      areaMm2: 0,
    };
    mat.pieces += row.quantity;
    mat.lines += 1;
    mat.areaMm2 += row.lengthMm * row.widthMm * row.quantity;
    materials.set(mKey, mat);

    const bandedMm = bandedLengthMm(row);
    if (bandedMm > 0) {
      const eKey =
        row.edgeBandCode ?? row.edgeBandName ?? 'Sin canto asignado';
      const edge = edges.get(eKey) ?? {
        key: eKey,
        name: row.edgeBandName ?? 'Sin canto asignado',
        edgeBandCode: row.edgeBandCode,
        thicknessMm: row.edgeBandThicknessMm,
        mlmm: 0,
      };
      edge.mlmm += bandedMm;
      edges.set(eKey, edge);
    }
  }

  const materialTotals: ProductionMaterialTotal[] = [...materials.values()]
    .map(({ areaMm2, ...rest }) => ({
      ...rest,
      areaM2: round2(areaMm2 / 1_000_000),
    }))
    .sort((a, b) => b.areaM2 - a.areaM2);

  const edgeTotals: ProductionEdgeTotal[] = [...edges.values()]
    .map(({ mlmm, ...rest }) => ({
      ...rest,
      ml: round2(mlmm / 1_000),
    }))
    .sort((a, b) => b.ml - a.ml);

  return {
    materials: materialTotals,
    edges: edgeTotals,
    totalAreaM2: round2(materialTotals.reduce((s, m) => s + m.areaM2, 0)),
    totalEdgeMl: round2(edgeTotals.reduce((s, e) => s + e.ml, 0)),
    totalPieces: materialTotals.reduce((s, m) => s + m.pieces, 0),
  };
}

export const summarizeProductionTotals = computeProductionTotals;

