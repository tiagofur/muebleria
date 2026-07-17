import { describe, expect, it } from 'vitest';
import { estimateBoardSheets } from './boardSheetEstimate';
import type { MaterialBoard, MaterialUsageRow } from './types';

const mat: MaterialBoard = {
  id: 'm1',
  code: 'MEL-18',
  name: 'Melamina blanca',
  widthMm: 1830,
  lengthMm: 2750,
  thicknessMm: 18,
  grainDefault: false,
  boardPrice: 100,
  wastePercent: 10,
  costPerM2: 20,
  active: true,
};

function usage(areaM2: number, materialId = 'm1'): MaterialUsageRow {
  return {
    materialId,
    code: 'MEL-18',
    name: 'Melamina blanca',
    areaM2,
    edgeMl: 0,
    boardCost: 0,
  };
}

describe('estimateBoardSheets', () => {
  it('estimates sheets with waste on catalog sheet size', () => {
    // One sheet ≈ 1830*2750/1e6 = 5.0325 m²
    // 4 m² net * 1.10 waste = 4.4 → ceil(4.4/5.0325) = 1
    const rows = estimateBoardSheets([usage(4)], [mat]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.estimatedSheets).toBe(1);
    expect(rows[0]!.sheetAreaM2).toBeCloseTo((1830 * 2750) / 1_000_000, 5);
  });

  it('rounds up when net area exceeds one sheet after waste', () => {
    // 5 m² * 1.1 = 5.5 > 5.0325 → 2 sheets
    const rows = estimateBoardSheets([usage(5)], [mat]);
    expect(rows[0]!.estimatedSheets).toBe(2);
  });

  it('returns 0 sheets when sheet size unknown', () => {
    const rows = estimateBoardSheets(
      [
        {
          materialId: 'missing',
          code: 'X',
          name: 'X',
          areaM2: 2,
          edgeMl: 0,
          boardCost: 0,
        },
      ],
      [mat],
    );
    expect(rows[0]!.estimatedSheets).toBe(0);
    expect(rows[0]!.sheetAreaM2).toBe(0);
  });
});
