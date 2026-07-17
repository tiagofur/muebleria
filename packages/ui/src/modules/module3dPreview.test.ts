import { describe, expect, it } from 'vitest';
import type {
  Component,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
  Structure,
} from '@muebles/domain';
import { resolveModule3DPreview } from './module3dPreview';

const edge: EdgeBand = {
  id: 'edge-a',
  code: 'EDGE-A',
  name: 'Canto blanco',
  thicknessMm: 1,
  costPerMl: 0.5,
  active: true,
};

const material: MaterialBoard = {
  id: 'mat-a',
  code: 'MAT-A',
  name: 'Blanco',
  widthMm: 1830,
  lengthMm: 2750,
  thicknessMm: 18,
  boardPrice: 100,
  wastePercent: 10,
  costPerM2: 50,
  grainDefault: false,
  active: true,
  defaultEdgeBandId: 'edge-a',
};

const optionGroups: OptionGroup[] = [
  {
    id: 'og-int',
    code: 'INTERIOR',
    name: 'Interior',
    kind: 'board',
    required: true,
    optionIds: ['mat-a'],
  },
];

const comp: Component = {
  id: 'c1',
  code: 'COM-1',
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
    { side: 'L1', enabled: true },
    { side: 'L2', enabled: true },
    { side: 'W1', enabled: true },
    { side: 'W2', enabled: true },
  ],
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'i * (PW - T)',
  yFormula: '0',
  zFormula: '0',
  rotateY: 90,
};

const structure: Structure = {
  id: 'st1',
  code: 'EST-1',
  name: 'Cuerpo',
  externalDims: { width: 600, height: 720, depth: 560 },
  components: [{ componentId: 'c1', quantity: 2 }],
  active: true,
};

const baseModule: Module = {
  id: 'm1',
  code: 'MOD-1',
  name: 'Gabinete',
  structureId: 'st1',
  components: [],
  hardwareLines: [],
  externalDims: { width: 600, height: 720, depth: 560 },
  presets: [
    { id: 'p600', name: '600', width: 600, height: 720, depth: 560 },
    { id: 'p800', name: '800', width: 800, height: 720, depth: 560 },
  ],
};

const catalog = {
  modules: [baseModule],
  structures: [structure],
  components: [comp],
  materials: [material],
  edges: [edge],
  hardware: [] as readonly Hardware[],
  optionGroups,
};

describe('resolveModule3DPreview', () => {
  it('defaults to first measure preset and returns parts', () => {
    const preview = resolveModule3DPreview(baseModule, catalog);
    expect(preview.error).toBeNull();
    expect(preview.empty).toBe(false);
    expect(preview.measurePresetId).toBe('p600');
    expect(preview.parts.length).toBe(2);
    expect(preview.width).toBe(600);
  });

  it('respects selected measure preset for outer dims', () => {
    const preview = resolveModule3DPreview(baseModule, catalog, 'p800');
    expect(preview.error).toBeNull();
    expect(preview.width).toBe(800);
    expect(preview.measurePresetId).toBe('p800');
  });

  it('returns empty (not throw) when module has no structure', () => {
    const bare: Module = {
      ...baseModule,
      structureId: undefined,
      components: [],
      presets: [],
    };
    const preview = resolveModule3DPreview(bare, {
      ...catalog,
      modules: [bare],
    });
    expect(preview.error).toBeNull();
    expect(preview.empty).toBe(true);
    expect(preview.parts).toEqual([]);
  });
});
