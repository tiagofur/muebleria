/**
 * Tests for resolveAgregado3DPreview — live 3D preview of an agregado draft.
 * Fase 3 (agregados-subassemblies-plan.md).
 */

import { describe, expect, it } from 'vitest';
import type { Component } from '@granete/domain';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import { DEFAULT_MODULE_FOOTPRINT_MM } from '../preview3d/project3dLayout';
import { resolveAgregado3DPreview } from './agregado3dPreview';
import { createEmptyAgregadoDraft, type AgregadoDraft } from './agregadoDraft';

const mockComponent: Component = {
  id: 'c-puerta',
  code: 'PRT-STD',
  name: 'Hoja de Puerta',
  placement: 'puerta',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 0,
    widthMm: 0,
    thicknessMm: 18,
    lengthFormula: 'H',
    widthFormula: 'W',
  },
  defaultEdges: [],
  optionRoles: ['PUERTA'],
  active: true,
};

const mockCatalogInput: Module3DCatalogInput = {
  modules: [],
  structures: [],
  components: [mockComponent],
  materials: [
    {
      id: 'mat-1',
      code: 'MDF18',
      name: 'MDF 18mm',
      widthMm: 1830,
      lengthMm: 2600,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 100,
      wastePercent: 10,
      costPerM2: 20,
      active: true,
    },
  ],
  edges: [],
  hardware: [],
  optionGroups: [
    {
      id: 'og-puerta',
      code: 'PUERTA',
      name: 'Puerta',
      kind: 'board',
      required: true,
      optionIds: ['mat-1'],
    },
  ],
};

function doorDraft(overrides?: Partial<AgregadoDraft>): AgregadoDraft {
  return {
    ...createEmptyAgregadoDraft(),
    code: 'PRT-1',
    name: 'Puerta Estándar',
    widthMm: 600,
    heightMm: 720,
    depthMm: 18,
    components: [
      { componentId: 'c-puerta', quantity: 1, placementOverride: 'puerta' },
    ],
    ...overrides,
  };
}

describe('resolveAgregado3DPreview', () => {
  it('resolves the agregado pieces against its own local dims', () => {
    const res = resolveAgregado3DPreview(doorDraft(), mockCatalogInput);

    expect(res.error).toBeNull();
    expect(res.empty).toBe(false);
    expect(res.parts).toHaveLength(1);
    expect(res.width).toBe(600);
    expect(res.height).toBe(720);
    expect(res.depth).toBe(18);

    // Piece resolves its length/width from local H/W of the agregado.
    expect(res.parts[0]!.lengthMm).toBe(720);
    expect(res.parts[0]!.widthMm).toBe(600);
  });

  it('honors per-piece formula overrides (live edit)', () => {
    const draft = doorDraft({
      components: [
        {
          componentId: 'c-puerta',
          quantity: 1,
          placementOverride: 'puerta',
          overrides: { lengthFormula: 'H - 10' },
        },
      ],
    });

    const res = resolveAgregado3DPreview(draft, mockCatalogInput);

    expect(res.error).toBeNull();
    expect(res.parts[0]!.lengthMm).toBe(710);
  });

  it('reports empty when the agregado has no pieces', () => {
    const res = resolveAgregado3DPreview(
      doorDraft({ components: [] }),
      mockCatalogInput,
    );

    expect(res.empty).toBe(true);
    expect(res.parts).toHaveLength(0);
    expect(res.error).toBeNull();
  });

  it('falls back to the default footprint when draft dims are zero', () => {
    const res = resolveAgregado3DPreview(
      doorDraft({ widthMm: 0, heightMm: 0, depthMm: 0 }),
      mockCatalogInput,
    );

    expect(res.width).toBe(DEFAULT_MODULE_FOOTPRINT_MM.width);
    expect(res.height).toBe(DEFAULT_MODULE_FOOTPRINT_MM.height);
    expect(res.depth).toBe(DEFAULT_MODULE_FOOTPRINT_MM.depth);
  });
});
