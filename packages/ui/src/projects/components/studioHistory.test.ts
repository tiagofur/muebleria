import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLAN_HISTORY_COALESCE_MS,
  PLAN_HISTORY_LIMIT,
  pushPlanHistory,
  redoLabelOf,
  undoLabelOf,
} from './studioHistory';
import type { ProjectItem, ProjectKitchenLayout } from '@granete/domain';

function layout(tag: string): ProjectKitchenLayout {
  return { walls: [], placements: [], activeSpaceId: tag } as ProjectKitchenLayout;
}

function item(id: string, width = 600): ProjectItem {
  return {
    id,
    moduleId: 'm1',
    quantity: 1,
    optionChoices: {},
    customDims: { widthMm: width, heightMm: 720, depthMm: 560 },
  };
}

describe('pushPlanHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('apila entradas con etiqueta y respeta el límite', () => {
    let stack = pushPlanHistory([], {
      intent: 'Duplicar',
      layout: layout('a'),
      itemSnapshots: [],
      ts: Date.now(),
    });
    for (let i = 0; i < PLAN_HISTORY_LIMIT + 5; i++) {
      stack = pushPlanHistory(stack, {
        intent: 'Mover',
        layout: layout(`s${i}`),
        itemSnapshots: [],
        ts: Date.now() + i + 1,
      });
    }
    expect(stack).toHaveLength(PLAN_HISTORY_LIMIT);
    expect(undoLabelOf(stack)).toBe('Mover');
  });

  it('coalesce: ráfaga de nudge = 1 entrada que conserva el before original', () => {
    const t0 = Date.now();
    let stack = pushPlanHistory([], {
      intent: 'Mover',
      layout: layout('original'),
      itemSnapshots: [],
      coalesceKey: 'nudge',
      ts: t0,
    });
    stack = pushPlanHistory(stack, {
      intent: 'Mover',
      layout: layout('paso1'),
      itemSnapshots: [],
      coalesceKey: 'nudge',
      ts: t0 + 100,
    });
    stack = pushPlanHistory(stack, {
      intent: 'Mover',
      layout: layout('paso2'),
      itemSnapshots: [],
      coalesceKey: 'nudge',
      ts: t0 + 200,
    });
    expect(stack).toHaveLength(1);
    // El before sigue siendo el estado original (previo a la ráfaga).
    expect(stack[0]!.layout.activeSpaceId).toBe('original');
    // El ts se refresca (extiende la ventana).
    expect(stack[0]!.ts).toBe(t0 + 200);
  });

  it('fuera de la ventana o con otra clave → entrada nueva', () => {
    const t0 = Date.now();
    let stack = pushPlanHistory([], {
      intent: 'Mover',
      layout: layout('a'),
      itemSnapshots: [],
      coalesceKey: 'nudge',
      ts: t0,
    });
    stack = pushPlanHistory(stack, {
      intent: 'Mover',
      layout: layout('b'),
      itemSnapshots: [],
      coalesceKey: 'nudge',
      ts: t0 + PLAN_HISTORY_COALESCE_MS + 1,
    });
    expect(stack).toHaveLength(2);
    stack = pushPlanHistory(stack, {
      intent: 'Cambiar medidas',
      layout: layout('c'),
      itemSnapshots: [item('i1')],
      ts: t0 + PLAN_HISTORY_COALESCE_MS + 2,
    });
    expect(stack).toHaveLength(3);
    expect(undoLabelOf(stack)).toBe('Cambiar medidas');
  });

  it('entrada sin coalesceKey nunca se pliega', () => {
    const t0 = Date.now();
    let stack = pushPlanHistory([], {
      intent: 'A',
      layout: layout('a'),
      itemSnapshots: [],
      ts: t0,
    });
    stack = pushPlanHistory(stack, {
      intent: 'B',
      layout: layout('b'),
      itemSnapshots: [],
      ts: t0 + 1,
    });
    expect(stack).toHaveLength(2);
  });

  it('redoLabel lee el tope del stack de redo', () => {
    expect(redoLabelOf([])).toBeNull();
    expect(
      redoLabelOf([
        { intent: 'Centrar', layout: layout('x'), itemSnapshots: [], ts: 1 },
      ]),
    ).toBe('Centrar');
  });
});
