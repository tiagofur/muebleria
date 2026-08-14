/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { computeModuleCostPreview } from './App';
import type {
  Catalog,
  Component,
  Module,
  OptionGroup,
  Structure,
} from '@muebles/domain';

const matInterior = {
  id: 'mat-int',
  code: 'TAB-INT',
  name: 'Interior blanco',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 18,
  grainDefault: false,
  boardPrice: 80,
  wastePercent: 10,
  costPerM2: 20,
  defaultEdgeBandId: 'edge-1',
  active: true,
};

const hwPerfil = {
  id: 'hw-perfil',
  code: 'HER-ZOC-ALU',
  name: 'Zoclo perfil aluminio',
  unit: 'meter' as const,
  costPerUnit: 18,
  active: true,
};

const compSide: Component = {
  id: 'comp-side',
  code: 'C-LAT',
  name: 'Costado',
  placement: 'lateral_izquierdo',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 720,
    widthMm: 560,
    thicknessMm: 18,
    lengthFormula: 'PH',
    widthFormula: 'PD',
  },
  defaultEdges: [
    { side: 'L1', enabled: false },
    { side: 'L2', enabled: false },
    { side: 'W1', enabled: false },
    { side: 'W2', enabled: false },
  ],
  optionRoles: ['INTERIOR'],
  active: true,
};

const structure: Structure = {
  id: 'st-1',
  code: 'ST-GAB',
  name: 'Gabinete',
  externalDims: { width: 600, height: 720, depth: 560 },
  components: [{ componentId: 'comp-side', quantity: 2 }],
  active: true,
};

const groups: OptionGroup[] = [
  {
    id: 'og-int',
    code: 'INTERIOR',
    name: 'Melamina de Interiores',
    kind: 'board',
    required: true,
    optionIds: ['mat-int'],
  },
  {
    id: 'og-perfil',
    code: 'ZOCLO_PERFIL',
    name: 'Zoclos Perfil',
    kind: 'hardware',
    required: false,
    optionIds: ['hw-perfil'],
  },
];

function catalog(withModule?: Module): Catalog {
  return {
    modules: withModule ? [withModule] : [],
    materials: [matInterior],
    edges: [
      {
        id: 'edge-1',
        code: 'Canto',
        name: 'Canto',
        thicknessMm: 1,
        costPerMl: 1,
        active: true,
      },
    ],
    hardware: [hwPerfil],
    optionGroups: groups,
    structures: [structure],
    components: [compSide],
  };
}

function moduleWith(presets: Module['presets'], baseMode?: Module['baseMode']): Module {
  return {
    id: 'mod-1',
    code: 'MOD-GAB-01',
    name: 'Gabinete 1 Puerta',
    structureId: 'st-1',
    externalDims: { width: 600, height: 720, depth: 560 },
    presets,
    ...(baseMode ? { baseMode } : {}),
    hardwareLines: [],
  };
}

describe('computeModuleCostPreview (F087 follow-up)', () => {
  it('previews modules with commercial presets using the default preset', () => {
    const mod = moduleWith([
      { id: 'p600', name: '600', width: 600, height: 720, depth: 560 },
      { id: 'p800', name: '800', width: 800, height: 720, depth: 560 },
    ]);
    const res = computeModuleCostPreview(mod, catalog(mod));
    expect(res.previewBlocked).toBe(false);
    expect(res.costPreview).not.toBeNull();
    expect(res.previewError).toBeNull();
  });

  it('previews plinth_strip filling the profile group default', () => {
    const mod = moduleWith(
      [{ id: 'p600', name: '600', width: 600, height: 720, depth: 560 }],
      'plinth_strip',
    );
    const res = computeModuleCostPreview(mod, catalog(mod));
    expect(res.previewBlocked).toBe(false);
    expect(res.costPreview).not.toBeNull();
    // Profile billed in ml: 600 mm → 0.6 m × 18 = 10.8 in hardware cost.
    expect(res.costPreview!.hardwareTotal).toBeCloseTo(10.8, 5);
  });

  it('reports honest missing groups when a used group has no members', () => {
    const mod = moduleWith(undefined, 'plinth_strip');
    const emptyCatalog = {
      ...catalog(mod),
      optionGroups: groups.map((g) =>
        g.code === 'ZOCLO_PERFIL' ? { ...g, optionIds: [] } : g,
      ),
    } as Catalog;
    const res = computeModuleCostPreview(mod, emptyCatalog);
    expect(res.previewBlocked).toBe(true);
    expect(res.missingGroups).toContain('ZOCLO_PERFIL');
    expect(res.missingGroups).not.toContain('INTERIOR');
  });
});
