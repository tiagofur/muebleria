/**
 * editorStore behavior tests (F067, Fase 1 prerequisito).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ResolvedBoardPart } from '@muebles/domain';
import { useEditorStore } from './editorStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePart(overrides: Partial<ResolvedBoardPart> = {}): ResolvedBoardPart {
  return {
    id: 'part-1',
    description: 'Costado',
    quantity: 1,
    lengthMm: 720,
    widthMm: 590,
    thicknessMm: 18,
    grain: 0,
    edges: [],
    optionRole: 'INTERIOR',
    materialId: 'mat-1',
    edgeBandId: undefined,
    x: 0,
    y: 0,
    z: 0,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useEditorStore.getState().clearEditor();
});

afterEach(() => {
  useEditorStore.getState().clearEditor();
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('editorStore — loadModule / clearEditor', () => {
  it('loadModule populates resolvedParts and resets selection', () => {
    const parts = [makePart(), makePart({ id: 'part-2' })];
    useEditorStore.getState().loadModule('mod-1', parts);
    const s = useEditorStore.getState();
    expect(s.moduleId).toBe('mod-1');
    expect(s.resolvedParts).toHaveLength(2);
    expect(s.selectedPartId).toBeNull();
    expect(s.tool).toBe('select');
  });

  it('clearEditor resets all state', () => {
    useEditorStore.getState().loadModule('mod-1', [makePart()]);
    useEditorStore.getState().selectPart('part-1');
    useEditorStore.getState().setTool('move');
    useEditorStore.getState().clearEditor();
    const s = useEditorStore.getState();
    expect(s.moduleId).toBeNull();
    expect(s.resolvedParts).toEqual([]);
    expect(s.selectedPartId).toBeNull();
    expect(s.tool).toBe('select');
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('editorStore — selectPart', () => {
  it('selects a part by id', () => {
    useEditorStore.getState().selectPart('part-1');
    expect(useEditorStore.getState().selectedPartId).toBe('part-1');
  });

  it('deselects with null', () => {
    useEditorStore.getState().selectPart('part-1');
    useEditorStore.getState().selectPart(null);
    expect(useEditorStore.getState().selectedPartId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tool / view mode / snap config
// ---------------------------------------------------------------------------

describe('editorStore — tool / viewMode / snap', () => {
  it('setTool changes the active tool', () => {
    useEditorStore.getState().setTool('rotate');
    expect(useEditorStore.getState().tool).toBe('rotate');
  });

  it('setViewMode changes between 2d-iso and 3d', () => {
    expect(useEditorStore.getState().viewMode).toBe('3d');
    useEditorStore.getState().setViewMode('2d-iso');
    expect(useEditorStore.getState().viewMode).toBe('2d-iso');
  });

  it('setSnapEnabled toggles snapping', () => {
    expect(useEditorStore.getState().snapEnabled).toBe(true);
    useEditorStore.getState().setSnapEnabled(false);
    expect(useEditorStore.getState().snapEnabled).toBe(false);
  });

  it('setSnapGridMm changes grid size', () => {
    expect(useEditorStore.getState().snapGridMm).toBe(50);
    useEditorStore.getState().setSnapGridMm(100);
    expect(useEditorStore.getState().snapGridMm).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Part mutations
// ---------------------------------------------------------------------------

describe('editorStore — updatePartPose', () => {
  it('updates only the target part pose', () => {
    const parts = [makePart(), makePart({ id: 'part-2' })];
    useEditorStore.getState().loadModule('mod-1', parts);
    useEditorStore.getState().updatePartPose('part-1', { x: 100, rotateZ: 90 });
    const updated = useEditorStore.getState().resolvedParts;
    expect(updated[0]!.x).toBe(100);
    expect(updated[0]!.rotateZ).toBe(90);
    // Other part unchanged.
    expect(updated[1]!.x).toBe(0);
    expect(updated[1]!.rotateZ).toBe(0);
  });

  it('partial pose update preserves other fields', () => {
    useEditorStore.getState().loadModule('mod-1', [makePart({ y: 50 })]);
    useEditorStore.getState().updatePartPose('part-1', { x: 100 });
    const part = useEditorStore.getState().resolvedParts[0]!;
    expect(part.x).toBe(100);
    expect(part.y).toBe(50); // preserved
  });
});

describe('editorStore — updatePartDimensions', () => {
  it('updates length and width', () => {
    useEditorStore.getState().loadModule('mod-1', [makePart()]);
    useEditorStore.getState().updatePartDimensions('part-1', {
      lengthMm: 800,
      widthMm: 400,
    });
    const part = useEditorStore.getState().resolvedParts[0]!;
    expect(part.lengthMm).toBe(800);
    expect(part.widthMm).toBe(400);
  });
});

describe('editorStore — duplicatePart', () => {
  it('creates a copy with offset position and new id', () => {
    useEditorStore.getState().loadModule('mod-1', [
      makePart({ x: 100, description: 'Costado' }),
    ]);
    useEditorStore.getState().duplicatePart('part-1');
    const parts = useEditorStore.getState().resolvedParts;
    expect(parts).toHaveLength(2);
    expect(parts[1]!.id).not.toBe('part-1');
    expect(parts[1]!.x).toBe(120); // 100 + 20 offset
    expect(parts[1]!.description).toContain('copia');
    // Auto-selects the new part.
    expect(useEditorStore.getState().selectedPartId).toBe(parts[1]!.id);
  });

  it('no-op when part not found', () => {
    useEditorStore.getState().loadModule('mod-1', [makePart()]);
    useEditorStore.getState().duplicatePart('does-not-exist');
    expect(useEditorStore.getState().resolvedParts).toHaveLength(1);
  });
});

describe('editorStore — removePart', () => {
  it('removes the part by id', () => {
    useEditorStore.getState().loadModule('mod-1', [
      makePart(),
      makePart({ id: 'part-2' }),
    ]);
    useEditorStore.getState().removePart('part-1');
    expect(useEditorStore.getState().resolvedParts).toHaveLength(1);
    expect(useEditorStore.getState().resolvedParts[0]!.id).toBe('part-2');
  });

  it('clears selection if the removed part was selected', () => {
    useEditorStore.getState().loadModule('mod-1', [makePart()]);
    useEditorStore.getState().selectPart('part-1');
    useEditorStore.getState().removePart('part-1');
    expect(useEditorStore.getState().selectedPartId).toBeNull();
  });

  it('preserves selection if a different part was removed', () => {
    useEditorStore.getState().loadModule('mod-1', [
      makePart(),
      makePart({ id: 'part-2' }),
    ]);
    useEditorStore.getState().selectPart('part-2');
    useEditorStore.getState().removePart('part-1');
    expect(useEditorStore.getState().selectedPartId).toBe('part-2');
  });
});
