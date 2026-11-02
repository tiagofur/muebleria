import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/hardwarePlacementAnchoring.contract.json';
import type {
  Hardware,
  HardwareDimensions,
  HardwareMachiningProfile,
  HardwarePlacement,
} from './types';
import { resolveHardwareDimensions, resolveHardwareFacePoint } from './hardwarePlacement';

/**
 * #1453 F2 — Go/TS parity of the placement mount point: panel refs
 * (min|max|center) + offsets − the hwAnchor shift (rotated by rotZ), with the
 * clamp applied only to the final point. Legacy rows (no refs, no anchor)
 * resolve byte-identically to the historical behavior.
 */
describe('hardware placement anchoring Go/TS parity (#1453 F2)', () => {
  const entry = (fixture.hardware as readonly {
    id: string;
    shape: string;
    sizeMm: number;
    diameterMm: number;
    projectionMm: number;
    dimensions: HardwareDimensions;
    machining: HardwareMachiningProfile;
  }[])[0]!;

  const hardware: Hardware = {
    id: entry.id,
    code: entry.id.toUpperCase(),
    name: entry.id,
    unit: 'piece',
    costPerUnit: 1,
    active: true,
    previewShape: entry.shape as Hardware['previewShape'],
    previewSizeMm: entry.sizeMm,
    previewDiameterMm: entry.diameterMm,
    previewProjectionMm: entry.projectionMm,
    dimensions: entry.dimensions,
    machining: entry.machining,
  };
  const dims = resolveHardwareDimensions(hardware);
  const env = {
    W: 600,
    L: 400,
    H: 400,
    D: 400,
    T: 18,
    PW: 600,
    PL: 400,
    PH: 400,
    PD: 400,
    PT: 18,
    HW: dims.widthMm,
    HH: dims.heightMm,
    HD: dims.depthMm,
  };

  it('resuelve cada caso del contrato compartido', () => {
    const cases = fixture.cases as readonly {
      name: string;
      placement: HardwarePlacement;
      faceDimXMm: number;
      faceDimYMm: number;
      expected: { xMm: number; yMm: number };
    }[];
    for (const c of cases) {
      const got = resolveHardwareFacePoint({
        placement: c.placement,
        hardware,
        machining: hardware.machining,
        faceDimXMm: c.faceDimXMm,
        faceDimYMm: c.faceDimYMm,
        env,
      });
      expect(got.xMm, `${c.name} · x`).toBe(c.expected.xMm);
      expect(got.yMm, `${c.name} · y`).toBe(c.expected.yMm);
    }
  });
});
