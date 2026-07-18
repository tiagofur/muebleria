/**
 * Tests for structure revision versioning (#108 / Slice 1).
 * One describe per logical unit, following conventions.md.
 */

import { describe, expect, it } from 'vitest';
import type {
  Catalog,
  Module,
  ProjectItem,
  Structure,
} from '../types';
import { ResolutionError } from '../errors';
import {
  bumpStructureRevision,
  captureProjectItemStructurePins,
  DEFAULT_STRUCTURE_REVISION,
  resolveStructureForPin,
  resolveStructureRevision,
  snapshotStructureRevision,
  structureRevision,
} from './versioning';

const baseStructure: Structure = {
  id: 'struct-1',
  code: 'EST-1',
  name: 'Cuerpo 1',
  revision: 1,
  externalDims: { width: 600, height: 720, depth: 560 },
  presets: [
    { id: 'p-600', name: '600', width: 600, height: 720, depth: 560 },
  ],
  components: [
    { componentId: 'comp-side', quantity: 2 },
    { componentId: 'comp-base', quantity: 1 },
  ],
  active: true,
};

describe('bumpStructureRevision', () => {
  it('increments revision 1 → 2 and reports the old revision', () => {
    const { structure, oldRevision } = bumpStructureRevision(baseStructure, {
      code: 'EST-1',
      name: 'Cuerpo 1 v2',
      externalDims: { width: 600, height: 720, depth: 560 },
      components: [{ componentId: 'comp-side', quantity: 3 }],
      active: true,
    });
    expect(structure.revision).toBe(2);
    expect(oldRevision).toBe(1);
  });

  it('snapshots the previous revision into history[0] with components intact', () => {
    const { structure } = bumpStructureRevision(baseStructure, {
      code: 'EST-1',
      name: 'Cuerpo 1 v2',
      components: [{ componentId: 'comp-side', quantity: 3 }],
      active: true,
    });
    expect(structure.history).toHaveLength(1);
    const snap = structure.history?.[0];
    expect(snap?.revision).toBe(1);
    expect(snap?.code).toBe('EST-1');
    expect(snap?.name).toBe('Cuerpo 1');
    // Original component list preserved verbatim.
    expect(snap?.components).toEqual([
      { componentId: 'comp-side', quantity: 2 },
      { componentId: 'comp-base', quantity: 1 },
    ]);
    expect(snap?.presets).toEqual(baseStructure.presets);
    expect(snap?.externalDims).toEqual(baseStructure.externalDims);
  });

  it('second edit produces revision 3 and accumulates history (length 2, newest-first)', () => {
    const first = bumpStructureRevision(baseStructure, {
      code: 'EST-1',
      name: 'v2',
      components: [{ componentId: 'comp-side', quantity: 3 }],
      active: true,
    }).structure;
    const second = bumpStructureRevision(first, {
      code: 'EST-1',
      name: 'v3',
      components: [{ componentId: 'comp-side', quantity: 4 }],
      active: true,
    }).structure;
    expect(second.revision).toBe(3);
    expect(second.history).toHaveLength(2);
    // Newest-first: history[0] is the just-superseded revision 2.
    expect(second.history![0]!.revision).toBe(2);
    expect(second.history![1]!.revision).toBe(1);
  });

  it('preserves id and ignores any revision/history coming from the draft', () => {
    const { structure } = bumpStructureRevision(baseStructure, {
      // draft attempts to smuggle revision/history — must be ignored.
      id: 'should-be-ignored',
      code: 'EST-1',
      name: 'v2',
      revision: 99,
      history: [{ revision: 50, code: 'x', name: 'x' }],
      components: [],
      active: true,
    } as unknown as Omit<Structure, 'id' | 'revision' | 'history'>);
    expect(structure.id).toBe('struct-1');
    expect(structure.revision).toBe(2);
    expect(structure.history).toHaveLength(1);
    expect(structure.history![0]!.revision).toBe(1);
  });

  it('treats missing revision as 1 (legacy data) when computing oldRevision', () => {
    const legacy: Structure = { ...baseStructure, revision: undefined };
    const { structure, oldRevision } = bumpStructureRevision(legacy, {
      code: 'EST-1',
      name: 'v2',
      components: [],
      active: true,
    });
    expect(oldRevision).toBe(1);
    expect(structure.revision).toBe(2);
    expect(structure.history![0]!.revision).toBe(1);
  });
});

describe('resolveStructureRevision', () => {
  // Build a structure at revision 3 with rev 1 and rev 2 in history.
  const atRev3: Structure = bumpStructureRevision(
    bumpStructureRevision(baseStructure, {
      code: 'EST-1',
      name: 'v2',
      components: [{ componentId: 'comp-side', quantity: 3 }],
      active: true,
    }).structure,
    {
      code: 'EST-1',
      name: 'v3',
      components: [{ componentId: 'comp-side', quantity: 4 }],
      active: true,
    },
  ).structure;

  it('pin undefined → returns the current (live) revision', () => {
    const r = resolveStructureRevision(atRev3, undefined);
    expect(r.revision).toBe(3);
    expect(r.code).toBe('EST-1');
    expect(r.name).toBe('v3');
    expect(r.components).toEqual([{ componentId: 'comp-side', quantity: 4 }]);
  });

  it('pin === current revision → returns the current revision', () => {
    const r = resolveStructureRevision(atRev3, 3);
    expect(r.revision).toBe(3);
    expect(r.components).toEqual([{ componentId: 'comp-side', quantity: 4 }]);
  });

  it('pin found in history → returns that frozen revision verbatim', () => {
    const r1 = resolveStructureRevision(atRev3, 1);
    expect(r1.revision).toBe(1);
    expect(r1.name).toBe('Cuerpo 1');
    expect(r1.components).toEqual([
      { componentId: 'comp-side', quantity: 2 },
      { componentId: 'comp-base', quantity: 1 },
    ]);
    const r2 = resolveStructureRevision(atRev3, 2);
    expect(r2.revision).toBe(2);
    expect(r2.name).toBe('v2');
    expect(r2.components).toEqual([{ componentId: 'comp-side', quantity: 3 }]);
  });

  it('unknown pin throws ResolutionError with structureId, pin, currentRevision, availableRevisions', () => {
    try {
      resolveStructureRevision(atRev3, 99);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ResolutionError);
      const ctx = (err as ResolutionError).context as Record<string, unknown>;
      expect(ctx.structureId).toBe('struct-1');
      expect(ctx.pin).toBe(99);
      expect(ctx.currentRevision).toBe(3);
      expect(ctx.availableRevisions).toEqual([1, 2, 3]);
      expect(ctx.field).toBe('structureRevisionPin');
    }
  });

  it('resolveStructureForPin reifies into a full Structure usable by resolveBom', () => {
    const reified = resolveStructureForPin(atRev3, 1);
    expect(reified.id).toBe('struct-1');
    expect(reified.revision).toBe(1);
    expect(reified.components).toEqual([
      { componentId: 'comp-side', quantity: 2 },
      { componentId: 'comp-base', quantity: 1 },
    ]);
    // Live (no pin) reification also works.
    const live = resolveStructureForPin(atRev3);
    expect(live.revision).toBe(3);
  });
});

describe('snapshotStructureRevision / structureRevision / DEFAULT_STRUCTURE_REVISION', () => {
  it('snapshot only captures BOM-relevant fields (drops notes/active/history)', () => {
    const s: Structure = {
      ...baseStructure,
      notes: 'a note',
      history: [{ revision: 0, code: 'x', name: 'x' }],
    };
    const snap = snapshotStructureRevision(s);
    expect(snap).toEqual({
      revision: 1,
      code: 'EST-1',
      name: 'Cuerpo 1',
      externalDims: baseStructure.externalDims,
      presets: baseStructure.presets,
      components: baseStructure.components,
    });
    // No leakage of non-BOM fields:
    expect((snap as unknown as Record<string, unknown>).notes).toBeUndefined();
    expect((snap as unknown as Record<string, unknown>).active).toBeUndefined();
  });

  it('structureRevision normalizes missing revision to DEFAULT_STRUCTURE_REVISION', () => {
    expect(DEFAULT_STRUCTURE_REVISION).toBe(1);
    expect(structureRevision(baseStructure)).toBe(1);
    expect(structureRevision({ ...baseStructure, revision: undefined })).toBe(1);
    expect(structureRevision({ ...baseStructure, revision: 7 })).toBe(7);
  });
});

describe('captureProjectItemStructurePins', () => {
  const moduleWithStructure: Module = {
    id: 'mod-1',
    code: 'MOD-1',
    name: 'M1',
    structureId: 'struct-1',
    hardwareLines: [],
  };
  const moduleWithoutStructure: Module = {
    id: 'mod-2',
    code: 'MOD-2',
    name: 'M2',
    hardwareLines: [],
  };
  const moduleMissingStructure: Module = {
    id: 'mod-3',
    code: 'MOD-3',
    name: 'M3',
    structureId: 'struct-missing',
    hardwareLines: [],
  };

  const catalog: Catalog = {
    materials: [],
    edges: [],
    hardware: [],
    optionGroups: [],
    modules: [moduleWithStructure, moduleWithoutStructure, moduleMissingStructure],
    structures: [
      { ...baseStructure, revision: 5 },
    ],
  };

  const items: ProjectItem[] = [
    { id: 'i1', moduleId: 'mod-1', quantity: 1, optionChoices: {} },
    { id: 'i2', moduleId: 'mod-2', quantity: 1, optionChoices: {} },
    { id: 'i3', moduleId: 'mod-3', quantity: 1, optionChoices: {} },
  ];

  it('pins items to their module structure revision; leaves others untouched', () => {
    const pinned = captureProjectItemStructurePins(items, catalog);
    expect(pinned[0]?.structureRevisionPin).toBe(5); // has structure → pinned
    expect(pinned[1]?.structureRevisionPin).toBeUndefined(); // no structureId → unchanged
    expect(pinned[2]?.structureRevisionPin).toBeUndefined(); // structure missing → unchanged
    // Original items not mutated.
    expect(items[0]?.structureRevisionPin).toBeUndefined();
  });

  it('overwrites a stale pin on re-capture (idempotent at a given catalog)', () => {
    const stale: ProjectItem[] = [
      { id: 'i1', moduleId: 'mod-1', quantity: 1, optionChoices: {}, structureRevisionPin: 999 },
    ];
    const pinned = captureProjectItemStructurePins(stale, catalog);
    expect(pinned[0]?.structureRevisionPin).toBe(5);
  });
});
