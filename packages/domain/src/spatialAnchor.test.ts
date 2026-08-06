import { describe, expect, it } from 'vitest';
import {
  groupPositionFromMinCorner,
  localBoxMinCornerRenderOffset,
  localOriginWorkshopFromMinCorner,
} from './spatialAnchor';

describe('spatialAnchor (min-corner convention)', () => {
  it('identity rotation: min corner is local origin (offset 0)', () => {
    expect(
      localBoxMinCornerRenderOffset(
        { widthMm: 100, thicknessMm: 18, lengthMm: 200 },
        {},
      ),
    ).toEqual([0, 0, 0]);
  });

  it('rotateY 90 (base/piso): width grows −Z so min Z is −width', () => {
    const off = localBoxMinCornerRenderOffset(
      { widthMm: 560, thicknessMm: 18, lengthMm: 300 },
      { rotateY: 90 },
    );
    expect(off[0]).toBeCloseTo(0, 6); // length +X
    expect(off[1]).toBeCloseTo(0, 6); // thick +Y
    expect(off[2]).toBeCloseTo(-560, 6); // width −Z
  });

  it('door [90,180,0]: width −X, thick +Z, length +Y → min X = −width', () => {
    const off = localBoxMinCornerRenderOffset(
      { widthMm: 296, thicknessMm: 18, lengthMm: 717 },
      { rotateX: 90, rotateY: 180 },
    );
    expect(off[0]).toBeCloseTo(-296, 6);
    expect(off[1]).toBeCloseTo(0, 6);
    expect(off[2]).toBeCloseTo(0, 6);
  });

  it('groupPositionFromMinCorner puts min AABB at the requested workshop corner', () => {
    // Base: min at (T, 0, 0) with rotY 90, size W=PD L=PW-2T
    const pos = groupPositionFromMinCorner(
      { x: 18, y: 0, z: 0 },
      { widthMm: 560, thicknessMm: 18, lengthMm: 564 },
      { rotateY: 90 },
    );
    // three = (x - ox, z - oy, y - oz) with offset (0,0,-560)
    // → (18 - 0, 0 - 0, 0 - (-560)) = (18, 0, 560)
    expect(pos[0]).toBeCloseTo(18, 6);
    expect(pos[1]).toBeCloseTo(0, 6);
    expect(pos[2]).toBeCloseTo(560, 6);
  });

  it('localOriginWorkshopFromMinCorner is inverse of the visual offset', () => {
    const min = { x: 2, y: 560, z: 2 };
    const size = { widthMm: 296, thicknessMm: 18, lengthMm: 717 };
    const rot = { rotateX: 90, rotateY: 180, rotateZ: 0 };
    const origin = localOriginWorkshopFromMinCorner(min, size, rot);
    // With width −X, local origin is at right edge: x = 2 + 296 = 298
    expect(origin.x).toBeCloseTo(298, 6);
    expect(origin.y).toBeCloseTo(560, 6);
    expect(origin.z).toBeCloseTo(2, 6);
  });
});
