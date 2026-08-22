import { describe, expect, it } from 'vitest';
import {
  copySelectionToClipboard,
  duplicateSelectionCommand,
  firstFreeOffsetOnWall,
  pasteClipboardCommand,
  pasteRelativeCommand,
  type ClipboardEntry,
} from './kitchenLayoutCommands';
import {
  alignSelectionCommand,
  centerSelectionOnWallCommand,
  compactSelectionOnWallCommand,
  distributeSelectionCommand,
} from './kitchenArrangementCommands';
import { pruneKitchenLayout } from './kitchenLayout';
import type { KitchenFootprint } from './kitchenLayout';
import type {
  ProjectItem,
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from './types';

const WALL_A = { id: 'w1', lengthMm: 3000, angleDeg: 0, originXMm: 0, originYMm: 0, name: 'Muro A' };
const WALL_B = { id: 'w2', lengthMm: 2000, angleDeg: 90, originXMm: 3000, originYMm: 0, name: 'Muro B' };

function item(id: string, quantity = 1): ProjectItem {
  return { id, moduleId: 'm1', quantity, optionChoices: {} };
}

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

describe('parsePlacementKey / prune extraInstanceKeys', () => {
  it('prune mantiene el índice nuevo de un duplicate hasta que llegue el quantity', () => {
    const layout = layoutOf([placement('i1', 0, 0), placement('i1', 1, 620)]);
    // items todavía con quantity 1 (el bump llega un render después)
    const items = [item('i1')];
    const pruned = pruneKitchenLayout(layout, items, [], ['i1#1']);
    expect(pruned.placements).toHaveLength(2);
    // sin extra, el índice 1 se purga (comportamiento legacy intacto)
    const legacy = pruneKitchenLayout(layout, items);
    expect(legacy.placements).toHaveLength(1);
  });
});

describe('duplicateSelectionCommand', () => {
  it('duplica una instancia: quantity+1 y copia a la derecha con gap', () => {
    const layout = layoutOf([placement('i1', 0, 0)]);
    const result = duplicateSelectionCommand({
      layout,
      items: [item('i1')],
      footprints: [footprint('i1', 0)],
      keys: ['i1#0'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itemPatches).toEqual([{ itemId: 'i1', quantity: 2 }]);
    expect(result.createdKeys).toEqual(['i1#1']);
    const copy = result.layout.placements.find((p) => p.instanceIndex === 1);
    expect(copy?.offsetMm).toBe(620);
  });

  it('multi-selección conserva el arreglo relativo (traslada el span)', () => {
    // i1@0 (600) · i2@620 (600) → copias a partir de 1240
    const layout = layoutOf([placement('i1', 0, 0), placement('i2', 0, 620)]);
    const result = duplicateSelectionCommand({
      layout,
      items: [item('i1'), item('i2')],
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0', 'i2#0'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copyA = result.layout.placements.find((p) => p.itemId === 'i1' && p.instanceIndex === 1);
    const copyB = result.layout.placements.find((p) => p.itemId === 'i2' && p.instanceIndex === 1);
    expect(copyA?.offsetMm).toBe(1240);
    expect(copyB?.offsetMm).toBe(1860);
  });

  it('caé al primer lugar libre cuando la derecha no entra', () => {
    // i1@2400 llena el extremo del muro 3000 → la copia cae al hueco 620 (tras i2@0)
    const layout = layoutOf([placement('i1', 0, 2400), placement('i2', 0, 0)]);
    const result = duplicateSelectionCommand({
      layout,
      items: [item('i1'), item('i2')],
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = result.layout.placements.find((p) => p.itemId === 'i1' && p.instanceIndex === 1);
    expect(copy?.offsetMm).toBe(620);
  });

  it('rechaza con mensaje que enseña cuando el muro no tiene lugar', () => {
    const full = layoutOf([
      placement('i1', 0, 0),
      placement('i2', 0, 620),
      placement('i3', 0, 1240),
      placement('i4', 0, 1860),
      placement('i5', 0, 2480),
    ]);
    const result = duplicateSelectionCommand({
      layout: full,
      items: ['i1', 'i2', 'i3', 'i4', 'i5'].map((id) => item(id)),
      footprints: ['i1', 'i2', 'i3', 'i4', 'i5'].map((id) => footprint(id, 0)),
      keys: ['i5#0'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-space');
    expect(result.message).toContain('Muro A');
  });

  it('duplica una isla al costado (o debajo si el costado está ocupado)', () => {
    const layout = layoutOf([
      freePlacement('i1', 0, 0, 0),
      freePlacement('i2', 0, 620, 0),
    ]);
    const result = duplicateSelectionCommand({
      layout,
      items: [item('i1'), item('i2')],
      footprints: [footprint('i1', 0), footprint('i2', 0)],
      keys: ['i1#0'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = result.layout.placements.find((p) => p.itemId === 'i1' && p.instanceIndex === 1);
    // derecha ocupada por i2 → cae debajo
    expect(copy?.freeYMm).toBe(600);
    expect(copy?.freeXMm).toBe(0);
  });

  it('duplicar una fuente sin colocar crea una copia sin colocar', () => {
    const layout = layoutOf([]);
    const result = duplicateSelectionCommand({
      layout,
      items: [item('i1')],
      footprints: [footprint('i1', 0)],
      keys: ['i1#0'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itemPatches).toEqual([{ itemId: 'i1', quantity: 2 }]);
    expect(result.layout.placements).toHaveLength(0);
  });

  it('agrega quantity por instancia cuando el mismo ítem aparece dos veces', () => {
    const layout = layoutOf([placement('i1', 0, 0), placement('i1', 1, 620)]);
    const result = duplicateSelectionCommand({
      layout,
      items: [item('i1', 2)],
      footprints: [footprint('i1', 0), footprint('i1', 1)],
      keys: ['i1#0', 'i1#1'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itemPatches).toEqual([{ itemId: 'i1', quantity: 4 }]);
    expect(result.createdKeys).toEqual(['i1#2', 'i1#3']);
  });
});

describe('copy/paste', () => {
  it('pega a la derecha de la fuente y el cursor avanza en la segunda pasada', () => {
    const layout = layoutOf([placement('i1', 0, 0)]);
    const items = [item('i1')];
    const fps = [footprint('i1', 0)];
    const entries = copySelectionToClipboard({ layout, keys: ['i1#0'], footprints: fps });
    const first = pasteClipboardCommand({ layout, items, footprints: fps, entries });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.layout.placements).toHaveLength(2);
    expect(first.nextCursorByWall?.['w1']).toBe(1220);
    // el proyecto ahora refleja quantity 2
    const itemsAfter = [item('i1', 2)];
    const fpsAfter = [footprint('i1', 0), footprint('i1', 1)];
    const second = pasteClipboardCommand({
      layout: first.layout,
      items: itemsAfter,
      footprints: fpsAfter,
      entries,
      cursorByWall: first.nextCursorByWall,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const copy2 = second.layout.placements.find((p) => p.itemId === 'i1' && p.instanceIndex === 2);
    expect(copy2?.offsetMm).toBe(1240);
  });

  it('rechaza pegar cuando el ítem copiado fue eliminado', () => {
    const layout = layoutOf([placement('i1', 0, 0)]);
    const entries = copySelectionToClipboard({
      layout,
      keys: ['i1#0'],
      footprints: [footprint('i1', 0)],
    });
    const result = pasteClipboardCommand({
      layout,
      items: [],
      footprints: [],
      entries,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-item');
  });

  it('paste atómico: si una entrada no tiene lugar, no crea nada', () => {
    const full = layoutOf([
      placement('i1', 0, 0),
      placement('i2', 0, 620),
      placement('i3', 0, 1240),
      placement('i4', 0, 1860),
      placement('i5', 0, 2480),
    ]);
    const items = ['i1', 'i2', 'i3', 'i4', 'i5'].map((id) => item(id));
    const fps = ['i1', 'i2', 'i3', 'i4', 'i5'].map((id) => footprint(id, 0));
    const entries = copySelectionToClipboard({ layout: full, keys: ['i5#0'], footprints: fps });
    const result = pasteClipboardCommand({ layout: full, items, footprints: fps, entries });
    expect(result.ok).toBe(false);
  });
});

describe('pasteRelativeCommand', () => {
  const layout = layoutOf([placement('i1', 0, 1000)]);
  const items = [item('i1'), item('i2')];
  const fps = [footprint('i1', 0), footprint('i2', 0, 500)];
  const entries: readonly ClipboardEntry[] = [
    { key: 'i2#0', itemId: 'i2', instanceIndex: 0, widthMm: 500, placement: null },
  ];

  it('pega a la derecha de la referencia', () => {
    const result = pasteRelativeCommand({
      layout,
      items,
      footprints: fps,
      entries,
      refKey: 'i1#0',
      side: 'right',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = result.layout.placements.find((p) => p.itemId === 'i2' && p.instanceIndex === 1);
    expect(copy?.offsetMm).toBe(1620);
  });

  it('pega a la izquierda de la referencia', () => {
    const result = pasteRelativeCommand({
      layout,
      items,
      footprints: fps,
      entries,
      refKey: 'i1#0',
      side: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = result.layout.placements.find((p) => p.itemId === 'i2' && p.instanceIndex === 1);
    expect(copy?.offsetMm).toBe(480);
  });

  it('pega a la esquina (offset 0)', () => {
    const result = pasteRelativeCommand({
      layout,
      items,
      footprints: fps,
      entries,
      refKey: 'i1#0',
      side: 'corner',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = result.layout.placements.find((p) => p.itemId === 'i2' && p.instanceIndex === 1);
    expect(copy?.offsetMm).toBe(0);
  });

  it('rechaza cuando chocaría, sin fallback silencioso', () => {
    const busy = layoutOf([placement('i1', 0, 1000), placement('i3', 0, 1650)]);
    const result = pasteRelativeCommand({
      layout: busy,
      items: [item('i1'), item('i2'), item('i3')],
      footprints: [...fps, footprint('i3', 0, 500)],
      entries,
      refKey: 'i1#0',
      side: 'right',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('overlap');
  });

  it('exige una referencia anclada a muro', () => {
    const island = layoutOf([freePlacement('i1', 0, 0, 0)]);
    const result = pasteRelativeCommand({
      layout: island,
      items,
      footprints: fps,
      entries,
      refKey: 'i1#0',
      side: 'right',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-placed');
  });
});

describe('firstFreeOffsetOnWall', () => {
  it('encuentra el hueco con gap a ambos lados', () => {
    const offset = firstFreeOffsetOnWall({
      spans: [
        { start: 0, end: 600, elevation: 'floor' },
        { start: 1240, end: 1840, elevation: 'floor' },
      ],
      widthMm: 500,
      elevation: 'floor',
      wallLengthMm: 3000,
    });
    expect(offset).toBe(620);
  });

  it('piso y colgado no compiten por el mismo espacio', () => {
    const offset = firstFreeOffsetOnWall({
      spans: [{ start: 0, end: 2400, elevation: 'floor' }],
      widthMm: 600,
      elevation: 'wall',
      wallLengthMm: 3000,
    });
    expect(offset).toBe(0);
  });

  it('null cuando no hay lugar', () => {
    const offset = firstFreeOffsetOnWall({
      spans: [{ start: 0, end: 3000, elevation: 'floor' }],
      widthMm: 600,
      elevation: 'floor',
      wallLengthMm: 3000,
    });
    expect(offset).toBeNull();
  });
});
