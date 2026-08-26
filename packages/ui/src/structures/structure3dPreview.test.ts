/**
 * Tests for structure3dPreview helper (Fase 3 UI / 3D Agregados Hierarchy).
 */

import { describe, expect, it } from 'vitest';
import type { Agregado, Component } from '@granete/domain';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import { resolveStructure3DPreview } from './structure3dPreview';
import { emptyStructureDraft, type StructureDraft } from './structureDraft';

const mockComponent: Component = {
  id: 'c-frente',
  code: 'FRT-CAJ',
  name: 'Frente de cajón',
  placement: 'frente_cajon',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 0,
    widthMm: 0,
    thicknessMm: 18,
    lengthFormula: 'H - 4',
    widthFormula: 'W - 4',
  },
  defaultEdges: [],
  optionRoles: ['PLACA'],
  active: true,
};

const mockAgregado: Agregado = {
  id: 'agr-cajones-3',
  code: 'AGR-CAJ-3',
  name: 'Cuerpo 3 Cajones',
  components: [
    {
      componentId: 'c-frente',
      quantity: 1,
      placementOverride: 'frente_cajon',
      overrides: {
        lengthFormula: 'H - 4',
        widthFormula: 'W - 4',
      },
    },
  ],
};

const mockCatalogInput: Module3DCatalogInput = {
  modules: [],
  structures: [],
  components: [mockComponent],
  agregados: [mockAgregado],
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
      id: 'og-1',
      code: 'PLACA',
      name: 'Placa',
      kind: 'board',
      required: true,
      optionIds: ['mat-1'],
    },
  ],
};

describe('resolveStructure3DPreview with Agregados', () => {
  it('resolves stacked agregados into 3D board parts with distinct Z coordinates', () => {
    const draft: StructureDraft = {
      ...emptyStructureDraft(),
      code: 'EST-CAJONERA',
      name: 'Cajonera 3D',
      widthMm: 800,
      heightMm: 720,
      depthMm: 500,
      agregados: [
        {
          id: 'inst-1',
          agregadoId: 'agr-cajones-3',
          name: 'Columna de 3 Cajones',
          quantity: 3,
          layoutDirection: 'vertical',
          gapMm: 3,
          position: { zFormula: '100' },
          dimensions: { widthFormula: 'W - 36', heightFormula: '600' },
        },
      ],
    };

    const res = resolveStructure3DPreview(draft, mockCatalogInput);

    expect(res.error).toBeNull();
    expect(res.empty).toBe(false);
    expect(res.parts).toHaveLength(3);

    // Verify distinct Z offsets for each stacked drawer front
    const zCoords = res.parts.map((p) => p.z);
    expect(zCoords[0]).toBeLessThan(zCoords[1]!);
    expect(zCoords[1]).toBeLessThan(zCoords[2]!);
  });
});
