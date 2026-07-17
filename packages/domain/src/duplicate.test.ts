import { describe, expect, it } from 'vitest';
import {
  duplicateModule,
  duplicateProject,
  suggestDuplicateCode,
} from './duplicate';
import type { Module, Project, QuotePriceSnapshot } from './types';

function sampleModule(overrides: Partial<Module> = {}): Module {
  return {
    id: 'mod-orig',
    code: 'MOD-GAB-01',
    name: 'Gavetero',
    notes: 'nota original',
    baseLaborCost: 100,
    externalDims: { width: 600, height: 720, depth: 500 },
    structureId: 'struct-1',
    components: [
      {
        componentId: 'comp-puerta',
        quantity: 2,
        placementOverride: 'frontal',
        overrides: {
          notes: 'Instalar con bisagra oculta',
          edges: [
            { side: 'L1', enabled: true },
            { side: 'L2', enabled: false },
          ],
          lengthFormula: 'W - 2',
        },
      },
    ],
    hardwareLines: [
      {
        id: 'hw-1',
        quantity: 4,
        optionRole: 'BISAGRA',
        descriptionOverride: 'bisagra cazoleta',
      },
      {
        id: 'hw-fixed',
        quantity: 1,
        optionRole: 'FIXED',
        hardwareId: 'hw-cat-1',
      },
    ],
    ...overrides,
  };
}

function sampleProject(overrides: Partial<Project> = {}): Project {
  const snapshot: QuotePriceSnapshot = {
    capturedAt: '2026-01-01T00:00:00.000Z',
    breakdown: {
      materialsCost: 10,
      edgeTotal: 1,
      hardwareTotal: 2,
      directCost: 13,
      laborModular: 0,
      laborFixedCost: 0,
      marginFactor: 1.35,
      salePrice: 17.55,
    },
  };
  return {
    id: 'prj-orig',
    name: 'Cocina Ana',
    customerId: 'cust-ana',
    currency: 'UYU',
    marginFactor: 1.35,
    laborFixedCost: 50,
    status: 'quoted',
    notes: 'urgente',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    priceSnapshot: snapshot,
    items: [
      {
        id: 'item-1',
        moduleId: 'mod-gab',
        quantity: 2,
        optionChoices: { INTERIOR: 'mat-a', FRENTE: 'mat-b' },
      },
      {
        id: 'item-2',
        moduleId: 'mod-gab',
        quantity: 1,
        optionChoices: { INTERIOR: 'mat-c', FRENTE: 'mat-b' },
      },
    ],
    ...overrides,
  };
}

describe('suggestDuplicateCode', () => {
  it('appends -COPY when free', () => {
    expect(suggestDuplicateCode('MOD-GAB-01', ['MOD-GAB-01'])).toBe(
      'MOD-GAB-01-COPY',
    );
  });

  it('uses COPY2 when COPY collides (case-insensitive)', () => {
    expect(
      suggestDuplicateCode('MOD-GAB-01', [
        'MOD-GAB-01',
        'mod-gab-01-copy',
      ]),
    ).toBe('MOD-GAB-01-COPY2');
  });

  it('skips occupied suffixes until unique', () => {
    expect(
      suggestDuplicateCode('MOD-X', [
        'MOD-X',
        'MOD-X-COPY',
        'MOD-X-COPY2',
        'MOD-X-COPY3',
      ]),
    ).toBe('MOD-X-COPY4');
  });
});

describe('duplicateModule', () => {
  it('returns deep copy with new ids; original unchanged (MOD-05)', () => {
    const original = sampleModule();
    const before = structuredClone(original);
    let n = 0;
    const copy = duplicateModule(original, {
      newId: 'mod-copy',
      newCode: 'MOD-GAB-01-COPY',
      nextNestedId: () => `nested-${++n}`,
    });

    expect(original).toEqual(before);
    expect(copy.id).toBe('mod-copy');
    expect(copy.code).toBe('MOD-GAB-01-COPY');
    expect(copy.code.endsWith('COPY')).toBe(true);
    expect(copy.name).toBe('Gavetero (copia)');
    expect(copy.baseLaborCost).toBe(100);
    expect(copy.notes).toBe('nota original');
    expect(copy.externalDims).toEqual({ width: 600, height: 720, depth: 500 });
    expect(copy.externalDims).not.toBe(original.externalDims);

    // structureId reference is preserved (deep copy does not clone the structure)
    expect(copy.structureId).toBe('struct-1');

    // components are deep-copied: equal content but fresh nested structure
    expect(copy.components).toHaveLength(1);
    expect(copy.components).not.toBe(original.components);
    expect(copy.components![0]).not.toBe(original.components![0]);
    expect(copy.components![0]).toEqual(original.components![0]);
    expect(copy.components![0]!.overrides).toEqual(
      original.components![0]!.overrides,
    );
    expect(copy.components![0]!.overrides).not.toBe(
      original.components![0]!.overrides,
    );
    expect(copy.components![0]!.overrides?.edges).toEqual(
      original.components![0]!.overrides?.edges,
    );
    expect(copy.components![0]!.overrides?.edges).not.toBe(
      original.components![0]!.overrides?.edges,
    );

    expect(copy.hardwareLines).toHaveLength(2);
    expect(copy.hardwareLines[0]!.id).toBe('nested-1');
    expect(copy.hardwareLines[1]!.id).toBe('nested-2');
    expect(copy.hardwareLines[0]!.id).not.toBe(original.hardwareLines[0]!.id);
    expect(copy.hardwareLines[1]!.hardwareId).toBe('hw-cat-1');
  });

  it('accepts custom newName', () => {
    const copy = duplicateModule(sampleModule(), {
      newId: 'x',
      newCode: 'MOD-GAB-01-COPY',
      newName: 'Clon custom',
      nextNestedId: () => 'n1',
    });
    expect(copy.name).toBe('Clon custom');
  });
});

describe('duplicateProject', () => {
  it('creates draft copy with items/options, no snapshot; original unchanged', () => {
    const original = sampleProject();
    const before = structuredClone(original);
    let n = 0;
    const now = '2026-07-15T12:00:00.000Z';
    const copy = duplicateProject(original, {
      newId: 'prj-copy',
      itemIdFactory: () => `item-new-${++n}`,
      nowIso: now,
    });

    expect(original).toEqual(before);
    expect(copy.id).toBe('prj-copy');
    expect(copy.name).toBe('Cocina Ana (copia)');
    expect(copy.status).toBe('draft');
    expect(copy.priceSnapshot).toBeUndefined();
    expect('priceSnapshot' in copy && copy.priceSnapshot !== undefined).toBe(
      false,
    );
    expect(copy.createdAt).toBe(now);
    expect(copy.updatedAt).toBe(now);
    expect(copy.customerId).toBe('cust-ana');
    expect(copy.marginFactor).toBe(1.35);
    expect(copy.laborFixedCost).toBe(50);
    expect(copy.notes).toBe('urgente');

    expect(copy.items).toHaveLength(2);
    expect(copy.items[0]!.id).toBe('item-new-1');
    expect(copy.items[1]!.id).toBe('item-new-2');
    expect(copy.items[0]!.id).not.toBe(original.items[0]!.id);

    // Same master module references (does not clone modules)
    expect(copy.items[0]!.moduleId).toBe('mod-gab');
    expect(copy.items[1]!.moduleId).toBe('mod-gab');
    expect(copy.items[0]!.quantity).toBe(2);
    expect(copy.items[0]!.optionChoices).toEqual({
      INTERIOR: 'mat-a',
      FRENTE: 'mat-b',
    });
    expect(copy.items[1]!.optionChoices).toEqual({
      INTERIOR: 'mat-c',
      FRENTE: 'mat-b',
    });
    expect(copy.items[0]!.optionChoices).not.toBe(
      original.items[0]!.optionChoices,
    );
  });

  it('F029: copies projectLevelChoices shallow-cloned', () => {
    const original = {
      ...sampleProject(),
      projectLevelChoices: { INTERIOR: 'mat-a', FRENTE: 'mat-b' },
    };
    const copy = duplicateProject(original, {
      newId: 'prj-copy',
      itemIdFactory: () => 'item-x',
      nowIso: '2026-07-15T12:00:00.000Z',
    });
    expect(copy.projectLevelChoices).toEqual({
      INTERIOR: 'mat-a',
      FRENTE: 'mat-b',
    });
    expect(copy.projectLevelChoices).not.toBe(original.projectLevelChoices);
  });

  it('does not alter referenced master modules when project is duplicated', () => {
    const master = sampleModule({ id: 'mod-gab', code: 'MOD-GAB-01' });
    const masterBefore = structuredClone(master);
    const project = sampleProject({
      items: [
        {
          id: 'i1',
          moduleId: master.id,
          quantity: 1,
          optionChoices: { INTERIOR: 'mat-a' },
        },
      ],
    });
    const copy = duplicateProject(project, {
      newId: 'p2',
      itemIdFactory: () => 'i2',
      nowIso: '2026-07-15T00:00:00.000Z',
    });
    expect(copy.items[0]!.moduleId).toBe(master.id);
    expect(master).toEqual(masterBefore);
  });
});
