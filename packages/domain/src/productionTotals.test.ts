import { describe, expect, it } from 'vitest';
import { summarizeProductionTotals } from './productionTotals';
import type { ProductionCutRow } from './types';

function row(overrides: Partial<ProductionCutRow> = {}): ProductionCutRow {
  return {
    quantity: 1,
    lengthMm: 1000,
    widthMm: 500,
    description: 'Lateral',
    materialName: 'Melamina Blanca',
    grain: 0,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
    ...overrides,
  };
}

describe('summarizeProductionTotals', () => {
  it('aggregates area per material with code+thickness', () => {
    const totals = summarizeProductionTotals([
      row({ quantity: 2, materialCode: 'MAT-BLA', thicknessMm: 18 }),
      row({
        quantity: 1,
        lengthMm: 2000,
        materialName: 'Roble',
        materialCode: 'MAT-ROB',
        thicknessMm: 15,
      }),
    ]);
    // 2 × (1000×500) = 1 m² ; 2000×500 = 1 m²
    expect(totals.materials).toHaveLength(2);
    expect(totals.totalAreaM2).toBe(2);
    const bla = totals.materials.find((m) => m.materialCode === 'MAT-BLA')!;
    expect(bla.pieces).toBe(2);
    expect(bla.lines).toBe(1);
    expect(bla.areaM2).toBe(1);
    expect(bla.thicknessMm).toBe(18);
  });

  it('edge meters group by assigned band: L-sides count length, W-sides width', () => {
    const totals = summarizeProductionTotals([
      row({
        quantity: 2,
        L1: 1,
        W2: 1,
        edgeBandCode: 'CANT-ABS',
        edgeBandName: 'ABS Blanco 1 mm',
        edgeBandThicknessMm: 1,
      }),
      row({ quantity: 1, L1: 1, L2: 1, edgeBandCode: 'CANT-ABS' }),
    ]);
    // First row: (1000 + 500) × 2 = 3000mm. Second: (1000+1000) × 1 = 2000mm.
    const abs = totals.edges.find((e) => e.edgeBandCode === 'CANT-ABS')!;
    expect(abs.ml).toBe(5);
    expect(abs.name).toBe('ABS Blanco 1 mm');
    expect(abs.thicknessMm).toBe(1);
    expect(totals.totalEdgeMl).toBe(5);
  });

  it('banded rows without an assigned band land in "Sin canto asignado"', () => {
    const totals = summarizeProductionTotals([row({ L1: 1 })]);
    expect(totals.edges).toHaveLength(1);
    expect(totals.edges[0]!.name).toBe('Sin canto asignado');
    expect(totals.edges[0]!.ml).toBe(1);
  });

  it('rows without banded sides produce no edge totals', () => {
    const totals = summarizeProductionTotals([row(), row({ W1: 0 })]);
    expect(totals.edges).toHaveLength(0);
    expect(totals.totalEdgeMl).toBe(0);
  });

  it('groups materials by code first, tolerating name collisions', () => {
    const totals = summarizeProductionTotals([
      row({ materialCode: 'MAT-A' }),
      row({ materialCode: 'MAT-B' }),
    ]);
    expect(totals.materials).toHaveLength(2);
  });
});
