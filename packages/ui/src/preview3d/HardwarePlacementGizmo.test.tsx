/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  HardwarePlacementGizmo,
  computeNextPosition,
  computeNextRotation,
} from './HardwarePlacementGizmo';

describe('computeNextPosition', () => {
  it('adds delta and snaps to grid step (5mm by default)', () => {
    const next = computeNextPosition({ xMm: 50, yMm: 100 }, { dxMm: 8, dyMm: -3 });
    expect(next).toEqual({ xMm: 60, yMm: 95 });
  });

  it('respects custom snap step', () => {
    const next = computeNextPosition({ xMm: 50, yMm: 100 }, { dxMm: 8, dyMm: -3 }, 10);
    expect(next).toEqual({ xMm: 60, yMm: 100 });
  });
});

describe('computeNextRotation', () => {
  it('adds rotation delta and snaps to angle grid (5° by default)', () => {
    const next = computeNextRotation({ x: 0, y: 0, z: 0 }, 'z', 43);
    expect(next).toEqual({ x: 0, y: 0, z: 45 });
  });

  it('updates specific axis without affecting other axes', () => {
    const next = computeNextRotation({ x: 90, y: 0, z: 10 }, 'y', 14);
    expect(next).toEqual({ x: 90, y: 15, z: 10 });
  });
});

describe('HardwarePlacementGizmo component', () => {
  it('is an exported React component function', () => {
    expect(typeof HardwarePlacementGizmo).toBe('function');
  });
});
