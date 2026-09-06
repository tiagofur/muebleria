/**
 * Release BOM context (#577 / OPS-DT-1): the immutable DesignRevision
 * snapshot adapts onto the engine's line-item shape and — the central parity
 * proof — produces the SAME requirement lines the legacy quote-state path
 * would, so the canonical derivation is an input swap, not a second engine.
 * A mutable project.items edit after P1 never leaks into a release
 * derivation.
 */

import { describe, expect, it } from 'vitest';

import {
  buildReleaseBomContext,
  releaseBomItemsToProjectItems,
  requirementLinesFromContext,
  type Catalog,
  type Module,
  type Project,
} from './index';

const ALL_EDGES = [
  { side: 'L1' as const, enabled: true },
  { side: 'L2' as const, enabled: true },
  { side: 'W1' as const, enabled: false },
  { side: 'W2' as const, enabled: false },
];

function catalog(): Catalog {
  return {
    materials: [
      {
        id: 'mat-a',
        code: 'TAB-A',
        name: 'Mat A',
        widthMm: 1000,
        lengthMm: 1000,
        thicknessMm: 15,
        grainDefault: false,
        boardPrice: 100,
        wastePercent: 0,
        costPerM2: 100,
        defaultEdgeBandId: 'edge-a',
        active: true,
      },
    ],
    edges: [
      { id: 'edge-a', code: 'CAN-A', name: 'Edge A', thicknessMm: 0.5, costPerMl: 10, active: true },
    ],
    hardware: [{ id: 'hw-a', code: 'HER-A', name: 'Hw A', unit: 'piece', costPerUnit: 20, active: true }],
    optionGroups: [
      { id: 'og-int', code: 'INTERIOR', name: 'Interior', kind: 'board', required: true, optionIds: ['mat-a'] },
      { id: 'og-bis', code: 'BISAGRA', name: 'Bisagra', kind: 'hardware', required: true, optionIds: ['hw-a'] },
    ],
    structures: [
      {
        id: 'struct-gab',
        code: 'EST-GAB',
        name: 'Estructura Gabinete',
        externalDims: { width: 600, height: 720, depth: 560 },
        components: [{ componentId: 'comp-side', quantity: 2 }],
        active: true,
      },
    ],
    components: [
      {
        id: 'comp-side',
        code: 'COM-SIDE',
        name: 'Side',
        placement: 'interno',
        geometry: { kind: 'rectangular_board', lengthMm: 1000, widthMm: 500, thicknessMm: 18 },
        defaultEdges: ALL_EDGES,
        optionRoles: ['INTERIOR'],
        active: true,
      },
    ],
    modules: [
      {
        id: 'mod-gab',
        code: 'MOD-GAB',
        name: 'Gabinete',
        externalDims: { width: 600, height: 720, depth: 560 },
        structureId: 'struct-gab',
        components: [],
        hardwareLines: [{ id: 'h1', quantity: 4, optionRole: 'BISAGRA' }],
      } as Module,
    ],
    categories: [],
  } as unknown as Catalog;
}

function quoteStateProject(): Project {
  return {
    id: 'p1',
    name: 'Obra',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      {
        id: 'line-1',
        moduleId: 'mod-gab',
        quantity: 2,
        optionChoices: { INTERIOR: 'mat-a', BISAGRA: 'hw-a' },
        customDims: { widthMm: 650, heightMm: 720, depthMm: 560 },
      },
    ],
    projectLevelChoices: {},
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  } as Project;
}

/** The same two physical units as immutable revision items (qty 2 line → 2 instances). */
function revisionItems() {
  return [1, 2].map((n) => ({
    furnitureInstanceId: `fi-${n}`,
    furnitureDefinitionId: 'mod-gab',
    parameters: { widthMm: 650, heightMm: 720, depthMm: 560 },
    materialChoices: { INTERIOR: 'mat-a', BISAGRA: 'hw-a' } as Record<string, string>,
  }));
}

describe('releaseBomItemsToProjectItems (#577)', () => {
  it('maps one physical instance per item with pinned choices and dims', () => {
    const items = releaseBomItemsToProjectItems(revisionItems());
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.moduleId).toBe('mod-gab');
      expect(item.quantity).toBe(1);
      expect(item.optionChoices).toEqual({ INTERIOR: 'mat-a', BISAGRA: 'hw-a' });
      expect(item.customDims).toEqual({ widthMm: 650, heightMm: 720, depthMm: 560 });
    }
    expect(new Set(items.map((i) => i.id))).toEqual(new Set(['fi-1', 'fi-2']));
  });

  it('tolerates numeric parameters serialized as strings and skips items without a definition', () => {
    const items = releaseBomItemsToProjectItems([
      {
        furnitureInstanceId: 'fi-x',
        furnitureDefinitionId: 'mod-gab',
        parameters: { widthMm: '600', heightMm: 720, depthMm: 560 },
        materialChoices: {},
      },
      { furnitureInstanceId: 'fi-nodef', furnitureDefinitionId: '', parameters: {}, materialChoices: {} },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.customDims).toEqual({ widthMm: 600, heightMm: 720, depthMm: 560 });
  });
});

describe('requirementLinesFromContext — canonical vs quote-state parity (#577)', () => {
  const cat = catalog();
  const edgeIdByCode: Record<string, string> = { 'CAN-A': 'edge-a' };

  it('produces the SAME lines from the release snapshot and the equivalent quote state', () => {
    const fromQuote = requirementLinesFromContext(quoteStateProject(), cat, cat.materials, edgeIdByCode);
    const fromRelease = requirementLinesFromContext(
      buildReleaseBomContext('p1', revisionItems()),
      cat,
      cat.materials,
      edgeIdByCode,
    );
    const normalize = (lines: readonly { kind: string; materialId: string; quantity: number }[]) =>
      [...lines].sort((a, b) => `${a.kind}:${a.materialId}`.localeCompare(`${b.kind}:${b.materialId}`));
    expect(normalize(fromRelease)).toEqual(normalize(fromQuote));
    expect(fromRelease.length).toBeGreaterThan(0);
    expect(fromRelease.some((l) => l.kind === 'tableros' && l.materialId === 'mat-a')).toBe(true);
    expect(fromRelease.some((l) => l.kind === 'herrajes' && l.materialId === 'hw-a')).toBe(true);
    expect(fromRelease.some((l) => l.kind === 'cintillas' && l.materialId === 'edge-a')).toBe(true);
  });

  it('tolerates board-only modules (zero hardware is not an error)', () => {
    const boardOnly = {
      ...catalog(),
      modules: [
        {
          ...catalog().modules[0]!,
          hardwareLines: [],
        },
      ],
    } as Catalog;
    const quoteState = {
      ...quoteStateProject(),
      items: [
        {
          id: 'line-1',
          moduleId: 'mod-gab',
          quantity: 1,
          optionChoices: { INTERIOR: 'mat-a' },
        },
      ],
    } as Project;
    const lines = requirementLinesFromContext(quoteState, boardOnly, boardOnly.materials, edgeIdByCode);
    expect(lines.some((l) => l.kind === 'tableros')).toBe(true);
    expect(lines.every((l) => l.kind !== 'herrajes')).toBe(true);
  });

  it('does NOT follow a later project.items mutation — the release snapshot is the input', () => {
    const mutatedQuoteState = {
      ...quoteStateProject(),
      items: [
        {
          id: 'line-1',
          moduleId: 'mod-gab',
          quantity: 9, // late quote edit
          optionChoices: { INTERIOR: 'mat-a', BISAGRA: 'hw-a' },
          customDims: { widthMm: 999, heightMm: 720, depthMm: 560 },
        },
      ],
    };
    const fromMutatedQuote = requirementLinesFromContext(mutatedQuoteState, cat, cat.materials, edgeIdByCode);
    const fromRelease = requirementLinesFromContext(
      buildReleaseBomContext('p1', revisionItems()),
      cat,
      cat.materials,
      edgeIdByCode,
    );
    expect(fromRelease).not.toEqual(fromMutatedQuote);
  });
});
