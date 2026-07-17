import { describe, expect, it } from 'vitest';
import {
  createDefaultLWalls,
  layoutKitchenPlacements,
  nextOffsetOnWall,
  pruneKitchenLayout,
  resolveWallFrames,
  kitchenLayoutWarnings,
} from './kitchenLayout';
import type { ProjectItem, ProjectKitchenLayout } from './types';

describe('kitchenLayout', () => {
  it('chains L walls by default', () => {
    const walls = createDefaultLWalls(() => 'w' + Math.random());
    // stable ids for test
    const fixed = [
      { ...walls[0]!, id: 'a', originXMm: 0, originYMm: 0 },
      { ...walls[1]!, id: 'b', originXMm: 3000, originYMm: 0 },
    ];
    const frames = resolveWallFrames(fixed);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.endXMm).toBe(3000);
    expect(frames[1]!.angleDeg).toBe(90);
    expect(frames[1]!.endYMm).toBe(2500);
  });

  it('places modules on walls with floor/wall elevation', () => {
    const layout: ProjectKitchenLayout = {
      walls: [
        {
          id: 'w1',
          lengthMm: 3000,
          angleDeg: 0,
          originXMm: 0,
          originYMm: 0,
        },
        {
          id: 'w2',
          lengthMm: 2000,
          angleDeg: 90,
          originXMm: 3000,
          originYMm: 0,
        },
      ],
      placements: [
        {
          itemId: 'i1',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 0,
          elevation: 'floor',
        },
        {
          itemId: 'i2',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 620,
          elevation: 'floor',
        },
        {
          itemId: 'i3',
          instanceIndex: 0,
          wallId: 'w2',
          offsetMm: 100,
          elevation: 'wall',
        },
      ],
    };
    const fps = [
      { itemId: 'i1', instanceIndex: 0, width: 600, height: 720, depth: 560 },
      { itemId: 'i2', instanceIndex: 0, width: 600, height: 720, depth: 560 },
      { itemId: 'i3', instanceIndex: 0, width: 600, height: 720, depth: 350 },
    ];
    const result = layoutKitchenPlacements(layout, fps);
    expect(result.placements).toHaveLength(3);
    expect(result.placements[0]!.originX).toBe(0);
    expect(result.placements[0]!.originZ).toBe(0);
    expect(result.placements[1]!.originX).toBe(620);
    expect(result.placements[2]!.originY).toBe(100);
    expect(result.placements[2]!.originZ).toBe(1400);
  });

  it('warns when module overhangs wall', () => {
    const layout: ProjectKitchenLayout = {
      walls: [{ id: 'w1', lengthMm: 500, angleDeg: 0 }],
      placements: [
        {
          itemId: 'i1',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 0,
          elevation: 'floor',
        },
      ],
    };
    const items: ProjectItem[] = [
      { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
    ];
    const fps = [
      { itemId: 'i1', instanceIndex: 0, width: 600, height: 720, depth: 560 },
    ];
    const w = kitchenLayoutWarnings(layout, items, fps);
    expect(w.some((s) => s.includes('sobresale'))).toBe(true);
  });

  it('prunes orphan placements', () => {
    const layout: ProjectKitchenLayout = {
      walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
      placements: [
        {
          itemId: 'gone',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 0,
          elevation: 'floor',
        },
        {
          itemId: 'keep',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 100,
          elevation: 'floor',
        },
      ],
    };
    const items: ProjectItem[] = [
      { id: 'keep', moduleId: 'm1', quantity: 1, optionChoices: {} },
    ];
    const pruned = pruneKitchenLayout(layout, items);
    expect(pruned.placements).toHaveLength(1);
    expect(pruned.placements[0]!.itemId).toBe('keep');
  });

  it('suggests next offset after last on wall', () => {
    const layout: ProjectKitchenLayout = {
      walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
      placements: [
        {
          itemId: 'i1',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 0,
          elevation: 'floor',
        },
      ],
    };
    const fps = [
      { itemId: 'i1', instanceIndex: 0, width: 600, height: 720, depth: 560 },
    ];
    expect(nextOffsetOnWall(layout, 'w1', fps, 20)).toBe(620);
  });
});
