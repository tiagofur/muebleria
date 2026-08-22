import { describe, expect, it } from 'vitest';
import {
  alignSelectionCommand,
  centerSelectionOnWallCommand,
  compactSelectionOnWallCommand,
  distributeSelectionCommand,
} from './kitchenArrangementCommands';
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
    wallId: 'w1',
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

describe('compact / distribute / center on wall', () => {
  it('compactar une la corrida con gap estándar desde el primero', () => {
    const layout = layoutOf([placement('i1', 0, 0), placement('i2', 0, 900), placement('i3', 0, 1800)]);
    const result = compactSelectionOnWallCommand({
      layout,
      footprints: ['i1', 'i2', 'i3'].map((id) => footprint(id, 0)),
      keys: ['i1#0', 'i2#0', 'i3#0'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offsets = result.layout.placements
      .filter((p) => p.wallId === 'w1')
      .map((p) => p.offsetMm)
      .sort((a, b) => a - b);
    expect(offsets).toEqual([0, 620, 1240]);
  });

  it('distribuir iguala los gaps conservando extremos', () => {
    // 3×600 en muro 3000: offsets 0, 1200, 2400 → gaps iguales de 0? span total 3000-1800=1200/2=600
    const layout = layoutOf([placement('i1', 0, 0), placement('i2', 0, 1200), placement('i3', 0, 2400)]);
    const result = distributeSelectionCommand({
      layout,
      footprints: ['i1', 'i2', 'i3'].map((id) => footprint(id, 0)),
      keys: ['i1#0', 'i2#0', 'i3#0'],
      axis: 'wall',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offsets = result.layout.placements
      .filter((p) => p.wallId === 'w1')
      .map((p) => p.offsetMm)
      .sort((a, b) => a - b);
    expect(offsets).toEqual([0, 1200, 2400]);
  });

  it('distribuir rechaza con menos de 3', () => {
    const layout = layoutOf([placement('i1', 0, 0), placement('i2', 0, 900)]);
    const result = distributeSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0', 'i2#0'],
      axis: 'wall',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too-few');
  });

  it('centrar una unidad en el muro', () => {
    const layout = layoutOf([placement('i1', 0, 0)]);
    const result = centerSelectionOnWallCommand({
      layout,
      footprints: [footprint('i1', 0)],
      keys: ['i1#0'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.placements[0]?.offsetMm).toBe(1200);
  });

  it('centrar un grupo conserva el span', () => {
    const layout = layoutOf([placement('i1', 0, 0), placement('i2', 0, 620)]);
    const result = centerSelectionOnWallCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0', 'i2#0'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offsets = result.layout.placements.map((p) => p.offsetMm).sort((a, b) => a - b);
    // span 1220 → start = (3000-1220)/2 = 890
    expect(offsets).toEqual([890, 1510]);
  });

  it('rechaza selección que mezcla muros', () => {
    const layout = layoutOf([placement('i1', 0, 0), placement('i2', 0, 0, 'w2')]);
    const result = centerSelectionOnWallCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0', 'i2#0'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('multi-wall');
  });

  it('rechaza islas en comandos de muro con mensaje que enseña', () => {
    const layout = layoutOf([freePlacement('i1', 0, 0, 0)]);
    const result = centerSelectionOnWallCommand({
      layout,
      footprints: [footprint('i1', 0)],
      keys: ['i1#0'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('mixed-placement');
  });
});

describe('align / distribute islas', () => {
  function islandLayout(): ProjectKitchenLayout {
    return layoutOf([
      freePlacement('i1', 0, 0, 0),
      freePlacement('i2', 0, 1000, 2000),
      freePlacement('i3', 0, 2000, 4000),
    ]);
  }

  it('alinea bordes izquierdos (minX)', () => {
    const result = alignSelectionCommand({
      layout: islandLayout(),
      footprints: ['i1', 'i2', 'i3'].map((id) => footprint(id, 0)),
      keys: ['i1#0', 'i2#0', 'i3#0'],
      mode: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xs = result.layout.placements.map((p) => p.freeXMm);
    expect(new Set(xs).size).toBe(1);
    expect(xs[0]).toBe(0);
  });

  it('alinear colisionando rechaza con overlap', () => {
    // dos islas a 100mm en X: alinearlas al mismo borde las superpone
    const layout = layoutOf([freePlacement('i1', 0, 0, 0), freePlacement('i2', 0, 100, 0)]);
    const result = alignSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0', 'i2#0'],
      mode: 'left',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('overlap');
  });

  it('distribuir islas en X iguala centros conservando extremos', () => {
    // centros 300 · 1300 · 2900 → paso 1300: el del medio pasa a x=1300
    const layout = layoutOf([
      freePlacement('i1', 0, 0, 0),
      freePlacement('i2', 0, 1000, 2000),
      freePlacement('i3', 0, 2600, 4000),
    ]);
    const result = distributeSelectionCommand({
      layout,
      footprints: ['i1', 'i2', 'i3'].map((id) => footprint(id, 0)),
      keys: ['i1#0', 'i2#0', 'i3#0'],
      axis: 'x',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xs = result.layout.placements
      .slice()
      .sort((a, b) => (a.freeXMm ?? 0) - (b.freeXMm ?? 0))
      .map((p) => p.freeXMm);
    expect(xs).toEqual([0, 1300, 2600]);
  });

  it('alinear requiere islas: muebles de muro reciben mensaje que enseña', () => {
    const layout = layoutOf([placement('i1', 0, 0), placement('i2', 0, 620)]);
    const result = alignSelectionCommand({
      layout,
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0', 'i2#0'],
      mode: 'left',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('mixed-placement');
    expect(result.message).toContain('Compactar');
  });
});
