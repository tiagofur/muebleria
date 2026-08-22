import { describe, expect, it } from 'vitest';
import { nudgeSelectionCommand } from './kitchenPrecisionCommands';
import type { KitchenFootprint } from './kitchenLayout';
import type {
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from './types';

const WALL_A = { id: 'w1', lengthMm: 3000, angleDeg: 0, originXMm: 0, originYMm: 0, name: 'Muro A' };
const WALL_B = { id: 'w2', lengthMm: 2000, angleDeg: 90, originXMm: 3000, originYMm: 0, name: 'Muro B' };

function placement(
  itemId: string,
  instanceIndex: number,
  offsetMm: number,
  wallId = 'w1',
  elevation: ProjectItemPlacement['elevation'] = 'floor',
): ProjectItemPlacement {
  return { itemId, instanceIndex, wallId, offsetMm, elevation };
}

function freePlacement(
  itemId: string,
  instanceIndex: number,
  freeXMm: number,
  freeYMm: number,
): ProjectItemPlacement {
  return {
    itemId,
    instanceIndex,
    wallId: '',
    offsetMm: 0,
    elevation: 'floor',
    mode: 'free',
    freeXMm,
    freeYMm,
  };
}

function footprint(itemId: string, instanceIndex: number, width = 600, depth = 580): KitchenFootprint {
  return { itemId, instanceIndex, width, height: 720, depth };
}

function layoutOf(
  placements: readonly ProjectItemPlacement[],
  walls = [WALL_A, WALL_B],
): ProjectKitchenLayout {
  return { walls, placements };
}

describe('nudgeSelectionCommand — muros', () => {
  it('traslada la selección conservando el arreglo relativo', () => {
    const layout = layoutOf([
      placement('i1', 0, 0),
      placement('i2', 0, 620),
      placement('i3', 0, 1400), // no seleccionado
    ]);
    const res = nudgeSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0), footprint('i3', 0)],
      keys: ['i1#0', 'i2#0'],
      deltaWallMm: 50,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byKey = new Map(res.layout.placements.map((p) => [`${p.itemId}#${p.instanceIndex}`, p]));
    expect(byKey.get('i1#0')!.offsetMm).toBe(50);
    expect(byKey.get('i2#0')!.offsetMm).toBe(670);
    expect(byKey.get('i3#0')!.offsetMm).toBe(1400);
  });

  it('multi-muro: cada muro valida contra sus propios pares', () => {
    const layout = layoutOf([
      placement('i1', 0, 0, 'w1'),
      placement('i2', 0, 100, 'w2'),
    ]);
    const res = nudgeSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0', 'i2#0'],
      deltaWallMm: 30,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.layout.placements.map((p) => p.offsetMm)).toEqual([30, 130]);
  });

  it('rechaza overflow del muro sin tocar nada (all-or-nothing)', () => {
    const layout = layoutOf([placement('i1', 0, 0), placement('i2', 0, 620)]);
    const res = nudgeSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0', 'i2#0'],
      deltaWallMm: 2000, // 620+2000+600 > 3000
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('no-space');
    expect(res.message).toContain('Muro A');
  });

  it('rechaza colisión con un no-seleccionado y enseña', () => {
    const layout = layoutOf([
      placement('i1', 0, 0),
      placement('i2', 0, 700), // no seleccionado
    ]);
    const res = nudgeSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0'],
      deltaWallMm: 200, // 200..800 choca con 700..1300
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('overlap');
    expect(res.message).toContain('chocaría');
  });

  it('piso y colgado no chocan entre sí (elevaciones distintas)', () => {
    const layout = layoutOf([
      placement('i1', 0, 0, 'w1', 'floor'),
      placement('i2', 0, 100, 'w1', 'wall'), // no seleccionado
    ]);
    const res = nudgeSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0'],
      deltaWallMm: 100,
    });
    expect(res.ok).toBe(true);
  });
});

describe('nudgeSelectionCommand — islas', () => {
  it('mueve islas seleccionadas en plano', () => {
    const layout = layoutOf([
      freePlacement('i1', 0, 0, 0),
      freePlacement('i2', 0, 2000, 0),
    ]);
    const res = nudgeSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0'],
      deltaXMm: 100,
      deltaYMm: -50,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const moved = res.layout.placements.find((p) => p.itemId === 'i1')!;
    expect(moved.freeXMm).toBe(100);
    expect(moved.freeYMm).toBe(-50);
  });

  it('rechaza superposición con isla no seleccionada', () => {
    const layout = layoutOf([
      freePlacement('i1', 0, 0, 0),
      freePlacement('i2', 0, 700, 0),
    ]);
    const res = nudgeSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0'],
      deltaXMm: 200, // 200..800 pisa 700..1300
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('overlap');
    expect(res.message).toContain('islas');
  });
});

describe('nudgeSelectionCommand — mixto y bordes', () => {
  it('selección mixta mueve muros por muro e islas en plano', () => {
    const layout = layoutOf([
      placement('i1', 0, 0),
      freePlacement('i2', 0, 0, 0),
    ]);
    const res = nudgeSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0', 'i2#0'],
      deltaWallMm: 40,
      deltaXMm: 100,
      deltaYMm: 100,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.layout.placements.find((p) => p.itemId === 'i1')!.offsetMm).toBe(40);
    const island = res.layout.placements.find((p) => p.itemId === 'i2')!;
    expect(island.freeXMm).toBe(100);
    expect(island.freeYMm).toBe(100);
  });

  it('selección vacía rechaza', () => {
    const res = nudgeSelectionCommand({
      layout: layoutOf([]),
      footprints: [],
      keys: [],
      deltaWallMm: 10,
    });
    expect(res.ok).toBe(false);
  });

  it('keys sin placement rechazan con not-placed', () => {
    const res = nudgeSelectionCommand({
      layout: layoutOf([placement('i1', 0, 0)]),
      footprints: [footprint('i9', 0)],
      keys: ['i9#0'],
      deltaWallMm: 10,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not-placed');
  });
});
