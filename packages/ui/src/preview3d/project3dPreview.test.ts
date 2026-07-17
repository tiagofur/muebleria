import { describe, expect, it } from 'vitest';
import type {
  Component,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
  Project,
  Structure,
} from '@muebles/domain';
import { resolveProject3DPreview } from './project3dPreview';
import { PROJECT_RUN_GAP_MM } from './project3dLayout';

const edge: EdgeBand = {
  id: 'edge-a',
  code: 'EDGE-A',
  name: 'Canto',
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

const modA: Module = {
  id: 'm-a',
  code: 'MOD-A',
  name: 'Bajo 600',
  structureId: 'st1',
  components: [],
  hardwareLines: [],
  externalDims: { width: 600, height: 720, depth: 560 },
  presets: [
    { id: 'p600', name: '600', width: 600, height: 720, depth: 560 },
  ],
};

const modB: Module = {
  id: 'm-b',
  code: 'MOD-B',
  name: 'Bajo 400',
  structureId: 'st1',
  components: [],
  hardwareLines: [],
  externalDims: { width: 400, height: 720, depth: 560 },
  presets: [
    { id: 'p400', name: '400', width: 400, height: 720, depth: 560 },
  ],
};

const catalog = {
  modules: [modA, modB],
  structures: [structure],
  components: [comp],
  materials: [material],
  edges: [edge],
  hardware: [] as readonly Hardware[],
  optionGroups,
};

const project: Project = {
  id: 'prj-1',
  name: 'Cocina demo',
  customerId: 'c1',
  currency: 'UYU',
  marginFactor: 1.5,
  laborFixedCost: 0,
  status: 'draft',
  items: [
    {
      id: 'it-a',
      moduleId: 'm-a',
      quantity: 1,
      optionChoices: {},
      measurePresetId: 'p600',
    },
    {
      id: 'it-b',
      moduleId: 'm-b',
      quantity: 2,
      optionChoices: {},
      measurePresetId: 'p400',
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('resolveProject3DPreview', () => {
  it('lays out all items in a linear run (qty expanded)', () => {
    const preview = resolveProject3DPreview(project, catalog);
    expect(preview.empty).toBe(false);
    // 1 + 2 copies
    expect(preview.modules).toHaveLength(3);
    expect(preview.modules[0]!.originX).toBe(0);
    expect(preview.modules[1]!.originX).toBe(600 + PROJECT_RUN_GAP_MM);
    expect(preview.modules[2]!.originX).toBe(
      600 + PROJECT_RUN_GAP_MM + 400 + PROJECT_RUN_GAP_MM,
    );
    expect(preview.modules.every((m) => m.parts.length > 0)).toBe(true);
  });

  it('can focus a single line item', () => {
    const preview = resolveProject3DPreview(project, catalog, {
      itemId: 'it-b',
    });
    expect(preview.modules).toHaveLength(2);
    expect(preview.modules.every((m) => m.itemId === 'it-b')).toBe(true);
  });
});
