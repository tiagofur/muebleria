import { describe, expect, it } from 'vitest';
import {
  createDefaultLWalls,
  seedDefaultLWallsIfEmpty,
  layoutKitchenPlacements,
  nextOffsetOnWall,
  pruneKitchenLayout,
  pruneKitchenLayoutOrClear,
  isKitchenLayoutEmpty,
  reorderPlacementOnWall,
  resolveWallFrames,
  kitchenLayoutWarnings,
  wallDirectionYawDeg,
  offsetMmFromPlanPoint,
  snapOffsetOnWall,
  repackPlacementsOnWall,
  DEFAULT_BASE_CLEARANCE_MM,
  resolveBaseClearanceMm,
  resolveWallCabinetZMm,
  ensureKitchenSpaces,
  setActiveKitchenSpace,
  addKitchenSpace,
  renameKitchenSpace,
  removeKitchenSpace,
  allKitchenPlacements,
  syncActiveKitchenSpace,
  DEFAULT_KITCHEN_SPACE_ID,
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

  it('seedDefaultLWallsIfEmpty seeds only when active walls are empty', () => {
    let n = 0;
    const newId = () => `w${++n}`;
    const empty = ensureKitchenSpaces({ walls: [], placements: [] });
    const seeded = seedDefaultLWallsIfEmpty(empty, newId);
    expect(seeded.walls).toHaveLength(2);
    expect(seeded.walls[0]!.name).toBe('Muro A');
    expect(seeded.walls[1]!.name).toBe('Muro B');
    // Active space mirrored
    expect(seeded.spaces?.[0]?.walls).toHaveLength(2);

    const again = seedDefaultLWallsIfEmpty(seeded, newId);
    expect(again.walls).toEqual(seeded.walls);
    expect(again.walls[0]!.id).toBe(seeded.walls[0]!.id);
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
    // Floor units sit on default zoclo/patas clearance.
    expect(result.placements[0]!.originZ).toBe(DEFAULT_BASE_CLEARANCE_MM);
    expect(result.placements[0]!.baseClearanceMm).toBe(DEFAULT_BASE_CLEARANCE_MM);
    expect(result.placements[0]!.yawDeg).toBe(0);
    expect(result.placements[1]!.originX).toBe(620);
    expect(result.placements[2]!.originY).toBe(100);
    expect(result.placements[2]!.originZ).toBe(1400);
    expect(result.placements[2]!.baseClearanceMm).toBe(0);
    expect(result.placements[2]!.yawDeg).toBe(90);
  });

  it('applies layout and per-placement baseClearance for floor units', () => {
    const layout: ProjectKitchenLayout = {
      baseClearanceMm: 120,
      walls: [
        {
          id: 'w1',
          lengthMm: 3000,
          angleDeg: 0,
          originXMm: 0,
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
          offsetMm: 700,
          elevation: 'floor',
          baseClearanceMm: 80,
        },
        {
          itemId: 'i3',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 1400,
          elevation: 'floor',
          baseClearanceMm: 0,
        },
      ],
    };
    const fps = [
      { itemId: 'i1', instanceIndex: 0, width: 600, height: 720, depth: 560 },
      { itemId: 'i2', instanceIndex: 0, width: 600, height: 720, depth: 560 },
      { itemId: 'i3', instanceIndex: 0, width: 600, height: 720, depth: 560 },
    ];
    const result = layoutKitchenPlacements(layout, fps);
    expect(result.placements[0]!.originZ).toBe(120);
    expect(result.placements[1]!.originZ).toBe(80);
    expect(result.placements[2]!.originZ).toBe(0);
  });

  it('resolveBaseClearanceMm ignores wall elevation', () => {
    expect(
      resolveBaseClearanceMm(
        { walls: [], placements: [], baseClearanceMm: 150 },
        { elevation: 'wall' },
      ),
    ).toBe(0);
  });

  it('snaps offset to peer edge with gap', () => {
    const snapped = snapOffsetOnWall({
      offsetMm: 615,
      moduleWidthMm: 600,
      wallLengthMm: 3000,
      peers: [{ offsetMm: 0, widthMm: 600 }],
      thresholdMm: 20,
      gapMm: 20,
    });
    // peer ends at 600; + gap 20 → 620
    expect(snapped).toBe(620);
  });

  it('uses layout wallCabinetZMm for wall-hung units', () => {
    const layout: ProjectKitchenLayout = {
      wallCabinetZMm: 1500,
      walls: [
        {
          id: 'w1',
          lengthMm: 2000,
          angleDeg: 0,
          originXMm: 0,
          originYMm: 0,
        },
      ],
      placements: [
        {
          itemId: 'i1',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 0,
          elevation: 'wall',
        },
      ],
    };
    const fps = [
      { itemId: 'i1', instanceIndex: 0, width: 600, height: 720, depth: 350 },
    ];
    const result = layoutKitchenPlacements(layout, fps);
    expect(resolveWallCabinetZMm(layout)).toBe(1500);
    expect(result.placements[0]!.originZ).toBe(1500);
    expect(result.placements[0]!.elevation).toBe('wall');
  });

  it('does not snap when outside threshold', () => {
    expect(
      snapOffsetOnWall({
        offsetMm: 200,
        moduleWidthMm: 600,
        wallLengthMm: 3000,
        peers: [{ offsetMm: 0, widthMm: 600 }],
        thresholdMm: 10,
        gapMm: 20,
      }),
    ).toBe(200);
  });

  it('repacks placements on a wall with gap', () => {
    const layout: ProjectKitchenLayout = {
      walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
      placements: [
        {
          itemId: 'a',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 50,
          elevation: 'floor',
        },
        {
          itemId: 'b',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 900,
          elevation: 'floor',
        },
      ],
    };
    const fps = [
      { itemId: 'a', instanceIndex: 0, width: 600, height: 720, depth: 560 },
      { itemId: 'b', instanceIndex: 0, width: 400, height: 720, depth: 560 },
    ];
    const next = repackPlacementsOnWall(layout, 'w1', fps, 20);
    const a = next.placements.find((p) => p.itemId === 'a')!;
    const b = next.placements.find((p) => p.itemId === 'b')!;
    expect(a.offsetMm).toBe(0);
    expect(b.offsetMm).toBe(620);
  });

  it('snaps wall angles to cardinal yaw', () => {
    expect(wallDirectionYawDeg(0)).toBe(0);
    expect(wallDirectionYawDeg(90)).toBe(90);
    expect(wallDirectionYawDeg(180)).toBe(180);
    expect(wallDirectionYawDeg(270)).toBe(270);
    expect(wallDirectionYawDeg(-10)).toBe(0);
  });

  it('projects plan points to wall offset with clamp', () => {
    const wallX = {
      originXMm: 0,
      originYMm: 0,
      angleDeg: 0,
      lengthMm: 3000,
    };
    expect(offsetMmFromPlanPoint(wallX, 620, 10, 600)).toBe(620);
    expect(offsetMmFromPlanPoint(wallX, -50, 0, 600)).toBe(0);
    expect(offsetMmFromPlanPoint(wallX, 5000, 0, 600)).toBe(2400);

    const wallY = {
      originXMm: 3000,
      originYMm: 0,
      angleDeg: 90,
      lengthMm: 2500,
    };
    expect(offsetMmFromPlanPoint(wallY, 3000, 400, 600)).toBe(400);
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

  it('places free (island) modules by freeX/Y/yaw without wall id', () => {
    const layout: ProjectKitchenLayout = {
      walls: [
        {
          id: 'w1',
          lengthMm: 3000,
          angleDeg: 0,
          originXMm: 0,
          originYMm: 0,
        },
      ],
      placements: [
        {
          itemId: 'island',
          instanceIndex: 0,
          wallId: '',
          offsetMm: 0,
          elevation: 'floor',
          mode: 'free',
          freeXMm: 1200,
          freeYMm: 900,
          freeYawDeg: 90,
        },
      ],
    };
    const fps = [
      {
        itemId: 'island',
        instanceIndex: 0,
        width: 1200,
        height: 900,
        depth: 600,
      },
    ];
    const result = layoutKitchenPlacements(layout, fps);
    expect(result.placements).toHaveLength(1);
    const pl = result.placements[0]!;
    expect(pl.originX).toBe(1200);
    expect(pl.originY).toBe(900);
    expect(pl.yawDeg).toBe(90);
    expect(pl.wallId).toBe('');
  });

  it('keeps free placements when pruning even without matching wall', () => {
    const layout: ProjectKitchenLayout = {
      walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
      placements: [
        {
          itemId: 'island',
          instanceIndex: 0,
          wallId: 'deleted-wall',
          offsetMm: 0,
          elevation: 'floor',
          mode: 'free',
          freeXMm: 500,
          freeYMm: 400,
        },
        {
          itemId: 'wall-unit',
          instanceIndex: 0,
          wallId: 'gone-wall',
          offsetMm: 0,
          elevation: 'floor',
        },
      ],
    };
    const items: ProjectItem[] = [
      { id: 'island', moduleId: 'm1', quantity: 1, optionChoices: {} },
      { id: 'wall-unit', moduleId: 'm1', quantity: 1, optionChoices: {} },
    ];
    const pruned = pruneKitchenLayout(layout, items);
    expect(pruned.placements).toHaveLength(1);
    expect(pruned.placements[0]!.itemId).toBe('island');
    expect(pruned.placements[0]!.mode).toBe('free');
  });

  it('does not warn free placements for missing wall or wall overhang', () => {
    const layout: ProjectKitchenLayout = {
      walls: [{ id: 'w1', lengthMm: 500, angleDeg: 0 }],
      placements: [
        {
          itemId: 'island',
          instanceIndex: 0,
          wallId: '',
          offsetMm: 0,
          elevation: 'floor',
          mode: 'free',
          freeXMm: 100,
          freeYMm: 200,
        },
      ],
    };
    const items: ProjectItem[] = [
      { id: 'island', moduleId: 'm1', quantity: 1, optionChoices: {} },
    ];
    const fps = [
      {
        itemId: 'island',
        instanceIndex: 0,
        width: 1200,
        height: 900,
        depth: 600,
      },
    ];
    const w = kitchenLayoutWarnings(layout, items, fps);
    expect(w.some((s) => s.includes('Muro no encontrado'))).toBe(false);
    expect(w.some((s) => s.includes('sobresale'))).toBe(false);
  });

  it('prunes invalid instanceIndex when qty shrinks', () => {
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
        {
          itemId: 'i1',
          instanceIndex: 2,
          wallId: 'w1',
          offsetMm: 620,
          elevation: 'floor',
        },
      ],
    };
    const items: ProjectItem[] = [
      { id: 'i1', moduleId: 'm1', quantity: 2, optionChoices: {} },
    ];
    const pruned = pruneKitchenLayout(layout, items);
    expect(pruned.placements).toHaveLength(1);
    expect(pruned.placements[0]!.instanceIndex).toBe(0);
  });

  it('pruneKitchenLayoutOrClear clears empty layout', () => {
    expect(
      pruneKitchenLayoutOrClear(
        { walls: [], placements: [] },
        [],
      ),
    ).toBeUndefined();
  });

  it('isKitchenLayoutEmpty is false when only inactive space has content', () => {
    expect(
      isKitchenLayoutEmpty({
        walls: [],
        placements: [],
        activeSpaceId: 'b',
        spaces: [
          {
            id: 'a',
            name: 'Cocina',
            walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
            placements: [],
          },
          { id: 'b', name: 'Baño', walls: [], placements: [] },
        ],
      }),
    ).toBe(false);
    expect(isKitchenLayoutEmpty({ walls: [], placements: [] })).toBe(true);
  });

  it('ensureKitchenSpaces wraps legacy layout as Cocina', () => {
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
    const next = ensureKitchenSpaces(layout);
    expect(next.spaces).toHaveLength(1);
    expect(next.spaces![0]!.name).toBe('Cocina');
    expect(next.activeSpaceId).toBe(DEFAULT_KITCHEN_SPACE_ID);
    expect(next.walls).toHaveLength(1);
    expect(next.placements).toHaveLength(1);
  });

  it('switches spaces while keeping each space content', () => {
    let layout: ProjectKitchenLayout = {
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
    layout = ensureKitchenSpaces(layout);
    layout = addKitchenSpace(layout, 'Baño', () => 'space-bath');
    expect(layout.activeSpaceId).toBe('space-bath');
    expect(layout.walls).toHaveLength(0);
    expect(layout.placements).toHaveLength(0);
    // Place on baño
    layout = syncActiveKitchenSpace({
      ...layout,
      walls: [{ id: 'wb', lengthMm: 2000, angleDeg: 0 }],
      placements: [
        {
          itemId: 'i2',
          instanceIndex: 0,
          wallId: 'wb',
          offsetMm: 0,
          elevation: 'floor',
        },
      ],
    });
    layout = setActiveKitchenSpace(layout, DEFAULT_KITCHEN_SPACE_ID);
    expect(layout.walls[0]!.id).toBe('w1');
    expect(layout.placements[0]!.itemId).toBe('i1');
    layout = setActiveKitchenSpace(layout, 'space-bath');
    expect(layout.walls[0]!.id).toBe('wb');
    expect(layout.placements[0]!.itemId).toBe('i2');
    expect(allKitchenPlacements(layout)).toHaveLength(2);
  });

  it('rename and remove kitchen spaces', () => {
    let layout = ensureKitchenSpaces({
      walls: [],
      placements: [],
    });
    layout = addKitchenSpace(layout, 'Living', () => 'space-living');
    layout = renameKitchenSpace(layout, 'space-living', 'Living comedor');
    expect(layout.spaces!.find((s) => s.id === 'space-living')!.name).toBe(
      'Living comedor',
    );
    layout = removeKitchenSpace(layout, 'space-living');
    expect(layout.spaces).toHaveLength(1);
    // Cannot remove last space
    const only = removeKitchenSpace(layout, layout.spaces![0]!.id);
    expect(only.spaces).toHaveLength(1);
  });

  it('prunes placements in inactive spaces', () => {
    const layout: ProjectKitchenLayout = {
      walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
      placements: [],
      activeSpaceId: 'a',
      spaces: [
        {
          id: 'a',
          name: 'Cocina',
          walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
          placements: [],
        },
        {
          id: 'b',
          name: 'Baño',
          walls: [{ id: 'wb', lengthMm: 2000, angleDeg: 0 }],
          placements: [
            {
              itemId: 'gone',
              instanceIndex: 0,
              wallId: 'wb',
              offsetMm: 0,
              elevation: 'floor',
            },
            {
              itemId: 'keep',
              instanceIndex: 0,
              wallId: 'wb',
              offsetMm: 100,
              elevation: 'floor',
            },
          ],
        },
      ],
    };
    const items: ProjectItem[] = [
      { id: 'keep', moduleId: 'm1', quantity: 1, optionChoices: {} },
    ];
    const pruned = pruneKitchenLayout(layout, items);
    const bath = pruned.spaces!.find((s) => s.id === 'b')!;
    expect(bath.placements).toHaveLength(1);
    expect(bath.placements[0]!.itemId).toBe('keep');
  });

  it('reorders on wall by re-packing offsets', () => {
    const layout: ProjectKitchenLayout = {
      walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
      placements: [
        {
          itemId: 'a',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 0,
          elevation: 'floor',
        },
        {
          itemId: 'b',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 620,
          elevation: 'floor',
        },
      ],
    };
    const fps = [
      { itemId: 'a', instanceIndex: 0, width: 600, height: 720, depth: 560 },
      { itemId: 'b', instanceIndex: 0, width: 400, height: 720, depth: 560 },
    ];
    const next = reorderPlacementOnWall(layout, 'a', 0, 1, fps, 20);
    const a = next.placements.find((p) => p.itemId === 'a')!;
    const b = next.placements.find((p) => p.itemId === 'b')!;
    expect(b.offsetMm).toBe(0);
    expect(a.offsetMm).toBe(400 + 20);
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
