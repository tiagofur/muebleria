import { describe, expect, it } from 'vitest';
import type { Module, Project } from './types';
import {
  buildProductionElevations,
  hasProductionElevations,
} from './productionElevations';

const modules: Module[] = [
  {
    id: 'm1',
    code: 'GAB-01',
    name: 'Gabinete',
    active: true,
    externalDims: { width: 600, height: 720, depth: 560 },
    boardParts: [],
    hardwareLines: [],
  } as Module,
  {
    id: 'm2',
    code: 'ALT-01',
    name: 'Alacena',
    active: true,
    externalDims: { width: 800, height: 720, depth: 350 },
    boardParts: [],
    hardwareLines: [],
  } as Module,
];

function baseProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Cocina',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
      { id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {} },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

describe('buildProductionElevations (PROD-1.1)', () => {
  it('returns empty walls without layout', () => {
    const r = buildProductionElevations(baseProject(), modules);
    expect(r.walls).toHaveLength(0);
    expect(r.unplaced).toHaveLength(2);
    expect(hasProductionElevations(r)).toBe(false);
  });

  it('builds wall elevation with modules sorted by offset', () => {
    const r = buildProductionElevations(
      baseProject({
        kitchenLayout: {
          walls: [
            { id: 'w1', lengthMm: 3200, angleDeg: 0, name: 'Muro A' },
          ],
          placements: [
            {
              itemId: 'i2',
              instanceIndex: 0,
              wallId: 'w1',
              offsetMm: 700,
              elevation: 'wall',
            },
            {
              itemId: 'i1',
              instanceIndex: 0,
              wallId: 'w1',
              offsetMm: 100,
              elevation: 'floor',
            },
          ],
        },
      }),
      modules,
    );
    expect(r.walls).toHaveLength(1);
    expect(r.walls[0]!.wallName).toBe('Muro A');
    expect(r.walls[0]!.wallLengthMm).toBe(3200);
    expect(r.walls[0]!.units).toHaveLength(2);
    expect(r.walls[0]!.units[0]!.moduleCode).toBe('GAB-01');
    expect(r.walls[0]!.units[0]!.offsetMm).toBe(100);
    expect(r.walls[0]!.units[0]!.elevation).toBe('floor');
    expect(r.walls[0]!.units[1]!.moduleCode).toBe('ALT-01');
    expect(r.walls[0]!.units[1]!.elevation).toBe('wall');
    expect(r.unplaced).toHaveLength(0);
    expect(hasProductionElevations(r)).toBe(true);
  });

  it('returns island units with dims, plan position and space (no fake wall positions)', () => {
    const r = buildProductionElevations(
      baseProject({
        kitchenLayout: {
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
              itemId: 'i2',
              instanceIndex: 0,
              wallId: '',
              offsetMm: 0,
              elevation: 'floor',
              mode: 'free',
              freeXMm: 1000,
              freeYMm: 500,
              freeYawDeg: 90,
              baseClearanceMm: 120,
            },
          ],
        },
      }),
      modules,
    );
    expect(r.walls[0]!.units).toHaveLength(1);
    expect(r.islands).toHaveLength(1);
    const island = r.islands[0]!;
    expect(island.moduleCode).toBe('ALT-01');
    expect(island.widthMm).toBe(800);
    expect(island.heightMm).toBe(720);
    expect(island.depthMm).toBe(350);
    expect(island.freeXMm).toBe(1000);
    expect(island.freeYMm).toBe(500);
    expect(island.freeYawDeg).toBe(90);
    expect(island.baseClearanceMm).toBe(120);
    expect(island.bottomZMm).toBe(120);
    expect(island.spaceName).toBeTruthy();
    expect(r.unplaced).toHaveLength(0);
  });

  it('island-only project (no walls) yields islands and drawable sheets', () => {
    const r = buildProductionElevations(
      baseProject({
        kitchenLayout: {
          walls: [],
          placements: [
            {
              itemId: 'i1',
              instanceIndex: 0,
              wallId: '',
              offsetMm: 0,
              elevation: 'floor',
              mode: 'free',
              freeXMm: 0,
              freeYMm: 0,
            },
          ],
        },
      }),
      modules,
    );
    expect(r.walls).toHaveLength(0);
    expect(r.islands).toHaveLength(1);
    expect(r.islands[0]!.moduleCode).toBe('GAB-01');
    expect(hasProductionElevations(r)).toBe(true);
  });

  it('multi-space islands carry their ambiente name', () => {
    const banoIsland = {
      itemId: 'i2',
      instanceIndex: 0,
      wallId: '',
      offsetMm: 0,
      elevation: 'floor' as const,
      mode: 'free' as const,
      freeXMm: 400,
      freeYMm: 300,
    };
    const r = buildProductionElevations(
      baseProject({
        kitchenLayout: {
          walls: [],
          placements: [banoIsland],
          activeSpaceId: 'space-bano',
          spaces: [
            {
              id: 'space-cocina',
              name: 'Cocina',
              walls: [{ id: 'w1', lengthMm: 3200, angleDeg: 0, name: 'Muro A' }],
              placements: [
                {
                  itemId: 'i1',
                  instanceIndex: 0,
                  wallId: 'w1',
                  offsetMm: 100,
                  elevation: 'floor',
                },
              ],
            },
            {
              id: 'space-bano',
              name: 'Baño',
              walls: [],
              placements: [banoIsland],
            },
          ],
        },
      }),
      modules,
    );
    expect(r.islands).toHaveLength(1);
    expect(r.islands[0]!.spaceId).toBe('space-bano');
    expect(r.islands[0]!.spaceName).toBe('Baño');
    expect(r.walls[0]!.units).toHaveLength(1);
  });

  it('includes walls from every multi-space ambiente (not only active top-level)', () => {
    // Top-level mirrors active space (real store shape after setActiveKitchenSpace).
    const banoWall = { id: 'w2', lengthMm: 2000, angleDeg: 0, name: 'Muro B' };
    const banoPlacement = {
      itemId: 'i2',
      instanceIndex: 0,
      wallId: 'w2',
      offsetMm: 50,
      elevation: 'wall' as const,
    };
    const r = buildProductionElevations(
      baseProject({
        kitchenLayout: {
          walls: [banoWall],
          placements: [banoPlacement],
          activeSpaceId: 'space-bano',
          spaces: [
            {
              id: 'space-cocina',
              name: 'Cocina',
              walls: [{ id: 'w1', lengthMm: 3200, angleDeg: 0, name: 'Muro A' }],
              placements: [
                {
                  itemId: 'i1',
                  instanceIndex: 0,
                  wallId: 'w1',
                  offsetMm: 100,
                  elevation: 'floor',
                },
              ],
            },
            {
              id: 'space-bano',
              name: 'Baño',
              walls: [banoWall],
              placements: [banoPlacement],
            },
          ],
        },
      }),
      modules,
    );
    expect(r.walls).toHaveLength(2);
    expect(r.walls.map((w) => w.wallName).join('|')).toContain('Cocina');
    expect(r.walls.map((w) => w.wallName).join('|')).toContain('Baño');
    const allCodes = r.walls.flatMap((w) => w.units.map((u) => u.moduleCode));
    expect(allCodes).toContain('GAB-01');
    expect(allCodes).toContain('ALT-01');
    expect(r.unplaced).toHaveLength(0);
  });
});
