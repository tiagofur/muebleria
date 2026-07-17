import { describe, expect, it } from 'vitest';
import { layoutProjectRun, PROJECT_RUN_GAP_MM } from './project3dLayout';

describe('layoutProjectRun', () => {
  it('places two modules along X with gap', () => {
    const layout = layoutProjectRun([
      { id: 'a', width: 600, height: 720, depth: 560, quantity: 1 },
      { id: 'b', width: 400, height: 720, depth: 560, quantity: 1 },
    ]);
    expect(layout.placements).toHaveLength(2);
    expect(layout.placements[0]!.originX).toBe(0);
    expect(layout.placements[1]!.originX).toBe(600 + PROJECT_RUN_GAP_MM);
    expect(layout.totalWidth).toBe(600 + PROJECT_RUN_GAP_MM + 400);
    expect(layout.totalHeight).toBe(720);
    expect(layout.totalDepth).toBe(560);
  });

  it('expands quantity into side-by-side instances', () => {
    const layout = layoutProjectRun([
      { id: 'a', width: 300, height: 700, depth: 500, quantity: 3 },
    ]);
    expect(layout.placements).toHaveLength(3);
    expect(layout.placements.map((p) => p.originX)).toEqual([
      0,
      300 + PROJECT_RUN_GAP_MM,
      2 * (300 + PROJECT_RUN_GAP_MM),
    ]);
    expect(layout.placements[2]!.instanceKey).toBe('a#2');
  });
});
