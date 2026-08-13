import { describe, expect, it } from 'vitest';
import { convertWorldDeltaToFaceMm, snapValue } from './hardwarePlacement';

describe('snapValue', () => {
  it('snaps value to the nearest step grid (default 5)', () => {
    expect(snapValue(12, 5)).toBe(10);
    expect(snapValue(13, 5)).toBe(15);
    expect(snapValue(17.4, 5)).toBe(15);
    expect(snapValue(17.6, 5)).toBe(20);
    expect(snapValue(0, 5)).toBe(0);
    expect(snapValue(-12, 5)).toBe(-10);
  });

  it('supports custom step grid (e.g. 10mm or 15°)', () => {
    expect(snapValue(42, 10)).toBe(40);
    expect(snapValue(47, 10)).toBe(50);
    expect(snapValue(43, 15)).toBe(45);
  });

  it('handles zero or invalid step gracefully', () => {
    expect(snapValue(12.345, 0)).toBe(12.35);
    expect(snapValue(12.345, -1)).toBe(12.35);
    expect(snapValue(NaN, 5)).toBe(0);
  });
});

describe('convertWorldDeltaToFaceMm', () => {
  it('converts delta [dx, dy, dz] for front and back faces (X, Z plane)', () => {
    expect(convertWorldDeltaToFaceMm([10, 5, 20], 'front')).toEqual({ dxMm: 10, dyMm: 20 });
    expect(convertWorldDeltaToFaceMm([10, 5, 20], 'back')).toEqual({ dxMm: 10, dyMm: 20 });
  });

  it('converts delta [dx, dy, dz] for left and right faces (Y, Z plane)', () => {
    expect(convertWorldDeltaToFaceMm([10, 5, 20], 'left')).toEqual({ dxMm: 5, dyMm: 20 });
    expect(convertWorldDeltaToFaceMm([10, 5, 20], 'right')).toEqual({ dxMm: 5, dyMm: 20 });
  });

  it('converts delta [dx, dy, dz] for top and bottom faces (X, Y plane)', () => {
    expect(convertWorldDeltaToFaceMm([10, 5, 20], 'top')).toEqual({ dxMm: 10, dyMm: 5 });
    expect(convertWorldDeltaToFaceMm([10, 5, 20], 'bottom')).toEqual({ dxMm: 10, dyMm: 5 });
  });
});
