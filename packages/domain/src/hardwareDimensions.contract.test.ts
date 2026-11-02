import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/hardwareDimensions.contract.json';
import type { Hardware, HardwareDimensions } from './types';
import { resolveHardwareDimensions } from './hardwarePlacement';
import { evaluatePartFormula } from './engine/shared';

interface FixtureHardware {
  readonly id: string;
  readonly shape?: string;
  readonly sizeMm?: number;
  readonly diameterMm?: number;
  readonly projectionMm?: number;
  readonly dimensions?: HardwareDimensions;
}

function toHardware(entry: FixtureHardware): Hardware {
  return {
    id: entry.id,
    code: entry.id.toUpperCase(),
    name: entry.id,
    unit: 'piece',
    costPerUnit: 0,
    active: true,
    ...(entry.shape ? { previewShape: entry.shape as Hardware['previewShape'] } : {}),
    ...(entry.sizeMm !== undefined ? { previewSizeMm: entry.sizeMm } : {}),
    ...(entry.diameterMm !== undefined ? { previewDiameterMm: entry.diameterMm } : {}),
    ...(entry.projectionMm !== undefined ? { previewProjectionMm: entry.projectionMm } : {}),
    ...(entry.dimensions ? { dimensions: entry.dimensions } : {}),
  };
}

const entries = fixture.hardware as readonly FixtureHardware[];
const byId = new Map(entries.map((h) => [h.id, h]));

describe('hardware dimensions Go/TS parity (#1453 F1)', () => {
  it('resuelve las dimensiones efectivas HW/HH/HD por familia', () => {
    const expected = fixture.expected as Readonly<
      Record<string, { HW: number; HH: number; HD: number }>
    >;
    for (const entry of entries) {
      const dims = resolveHardwareDimensions(toHardware(entry));
      expect(dims.widthMm, `${entry.id}.HW`).toBe(expected[entry.id]!.HW);
      expect(dims.heightMm, `${entry.id}.HH`).toBe(expected[entry.id]!.HH);
      expect(dims.depthMm, `${entry.id}.HD`).toBe(expected[entry.id]!.HD);
    }
  });

  it('evalúa las fórmulas HW/HH/HD con redondeo a mm entero', () => {
    const cases = fixture.formulaCases as readonly {
      name: string;
      hwId: string;
      formula: string;
      env: Record<string, number>;
      expected: number;
    }[];
    for (const c of cases) {
      const hw = resolveHardwareDimensions(toHardware(byId.get(c.hwId)!));
      const result = evaluatePartFormula(c.formula, {
        W: c.env.W ?? 0,
        H: c.env.H ?? 0,
        D: c.env.D ?? 0,
        T: c.env.T ?? 0,
        PW: c.env.PW ?? 0,
        PH: c.env.PH ?? 0,
        PD: c.env.PD ?? 0,
        HW: hw.widthMm,
        HH: hw.heightMm,
        HD: hw.depthMm,
      });
      expect(result, c.name).toBe(c.expected);
    }
  });
});
