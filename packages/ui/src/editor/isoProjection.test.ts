/**
 * isoProjection tests (F068, Fase 1 slice 1.1).
 */

import { describe, expect, it } from 'vitest';
import {
  isoProject,
  boxCorners,
  isoBox,
  projectedBounds,
  viewBoxFromBounds,
} from './isoProjection';

describe('isoProject', () => {
  it('origin projects to (0, 0)', () => {
    expect(isoProject(0, 0, 0)).toEqual([0, 0]);
  });

  it('X axis goes right-down', () => {
    const [x, y] = isoProject(100, 0, 0);
    expect(x).toBeCloseTo(100 * Math.cos(Math.PI / 6));
    expect(y).toBeCloseTo(100 * Math.sin(Math.PI / 6));
    expect(y).toBeGreaterThan(0); // down
  });

  it('Z axis goes left-down', () => {
    const [x, y] = isoProject(0, 0, 100);
    expect(x).toBeCloseTo(-100 * Math.cos(Math.PI / 6));
    expect(y).toBeCloseTo(100 * Math.sin(Math.PI / 6));
    expect(x).toBeLessThan(0); // left
    expect(y).toBeGreaterThan(0); // down
  });

  it('Y axis goes up (negative screen Y)', () => {
    const [, y] = isoProject(0, 100, 0);
    expect(y).toBe(-100);
    expect(y).toBeLessThan(0);
  });
});

describe('boxCorners', () => {
  it('produces 8 corners for a unit box', () => {
    const c = boxCorners(0, 0, 0, 1, 1, 1);
    expect(c.bottom).toHaveLength(4);
    expect(c.top).toHaveLength(4);
    // Bottom Y = 0, top Y = height.
    expect(c.bottom[0][1]).toBe(0);
    expect(c.top[0][1]).toBe(1);
  });
});

describe('isoBox', () => {
  it('produces 3 faces (left, right, top)', () => {
    const faces = isoBox(0, 0, 0, 100, 18, 590);
    expect(faces).toHaveLength(3);
    expect(faces.map((f) => f.shade)).toEqual(['dark', 'medium', 'light']);
  });

  it('each face has 4 projected points', () => {
    const faces = isoBox(0, 0, 0, 100, 18, 590);
    for (const face of faces) {
      expect(face.points).toHaveLength(4);
      for (const pt of face.points) {
        expect(pt).toHaveLength(2);
        expect(typeof pt[0]).toBe('number');
        expect(typeof pt[1]).toBe('number');
      }
    }
  });

  it('faces are sorted back-to-front (left, right, top)', () => {
    const faces = isoBox(0, 0, 0, 100, 18, 590);
    // Top face should be last (drawn on top in painter's algorithm).
    expect(faces[2]!.shade).toBe('light');
  });
});

describe('projectedBounds', () => {
  it('computes min/max of all points', () => {
    const faces = isoBox(0, 0, 0, 100, 18, 590);
    const [minX, minY, maxX, maxY] = projectedBounds(faces);
    expect(minX).toBeLessThan(maxX);
    expect(minY).toBeLessThan(maxY);
  });
});

describe('viewBoxFromBounds', () => {
  it('produces a valid SVG viewBox string with padding', () => {
    const faces = isoBox(0, 0, 0, 100, 18, 590);
    const bounds = projectedBounds(faces);
    const vb = viewBoxFromBounds(bounds, 40);
    const parts = vb.split(' ').map(Number);
    expect(parts).toHaveLength(4);
    expect(parts[2]).toBeGreaterThan(0); // width > 0
    expect(parts[3]).toBeGreaterThan(0); // height > 0
  });
});
