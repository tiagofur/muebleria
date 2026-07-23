/**
 * Snapping tests (F071, Fase 1 slice 1.4).
 */

import { describe, expect, it } from 'vitest';
import {
  snapToGrid,
  snapPositionToGrid,
  snapToPeer,
  snapPosition,
  screenDeltaToWorkshop,
} from './snapping';

describe('snapToGrid', () => {
  it('snaps to nearest multiple of gridSize', () => {
    expect(snapToGrid(73, 50)).toBe(50);
    expect(snapToGrid(27, 50)).toBe(50);
    expect(snapToGrid(100, 50)).toBe(100);
    expect(snapToGrid(125, 50)).toBe(150); // 2.5 rounds up
    expect(snapToGrid(175, 50)).toBe(200);
  });

  it('returns value unchanged when gridSize is 0', () => {
    expect(snapToGrid(73, 0)).toBe(73);
  });
});

describe('snapPositionToGrid', () => {
  it('snaps all 3 axes independently', () => {
    const [x, y, z] = snapPositionToGrid(73, 27, 125, 50);
    expect(x).toBe(50);
    expect(y).toBe(50);
    expect(z).toBe(150); // 2.5 rounds up
  });
});

describe('snapToPeer', () => {
  it('snaps to nearest peer within threshold', () => {
    expect(snapToPeer(52, [0, 100, 200], 10)).toBe(52); // no peer within 10
    expect(snapToPeer(95, [0, 100, 200], 10)).toBe(100);
    expect(snapToPeer(8, [0, 100, 200], 10)).toBe(0);
  });

  it('returns original when no peers', () => {
    expect(snapToPeer(50, [], 10)).toBe(50);
  });
});

describe('snapPosition', () => {
  it('grid only when peer disabled', () => {
    const [x, y, z] = snapPosition(73, 0, 125, {
      gridSize: 50,
      gridEnabled: true,
      peerEnabled: false,
    });
    expect(x).toBe(50);
    expect(z).toBe(150); // 2.5 rounds up
  });

  it('grid + peer when both enabled', () => {
    const [x, y, z] = snapPosition(73, 0, 95, {
      gridSize: 50,
      gridEnabled: true,
      peerXs: [100],
      peerZs: [100],
      peerEnabled: true,
      peerThreshold: 15,
    });
    // Grid snaps 73→50, then peer: 50 is >15 from 100, stays 50.
    expect(x).toBe(50);
    // Grid snaps 95→100, peer: 100 is exact match.
    expect(z).toBe(100);
  });

  it('no snapping when both disabled', () => {
    const [x, y, z] = snapPosition(73, 27, 125, {
      gridSize: 50,
      gridEnabled: false,
      peerEnabled: false,
    });
    expect(x).toBe(73);
    expect(y).toBe(27);
    expect(z).toBe(125);
  });
});

describe('screenDeltaToWorkshop', () => {
  it('right-only screen drag produces positive wsX, negative wsZ', () => {
    const [wsX, wsY, wsZ] = screenDeltaToWorkshop(100, 0, 1);
    expect(wsX).toBeGreaterThan(0);
    expect(wsZ).toBeLessThan(0);
    expect(wsY).toBe(0); // depth unchanged for planar drag
  });

  it('down-only screen drag produces positive wsX and wsZ', () => {
    const [wsX, , wsZ] = screenDeltaToWorkshop(0, 100, 1);
    expect(wsX).toBeGreaterThan(0);
    expect(wsZ).toBeGreaterThan(0);
  });

  it('scale divides the delta', () => {
    const [x1] = screenDeltaToWorkshop(100, 0, 1);
    const [x2] = screenDeltaToWorkshop(200, 0, 2);
    expect(x1).toBeCloseTo(x2, 5);
  });
});
