import { describe, expect, it } from 'vitest';
import type {
  Agregado,
  Component,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
  Structure,
} from '@granete/domain';
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
  previewColor: '#F5F5F0',
};

const materialWood: MaterialBoard = {
  id: 'mat-wood',
  code: 'MAT-WOOD',
  name: 'Maderado',
  widthMm: 1830,
  lengthMm: 2750,
  thicknessMm: 18,
  boardPrice: 120,
  wastePercent: 10,
  costPerM2: 60,
  grainDefault: true,
  active: true,
  defaultEdgeBandId: 'edge-a',
  previewColor: '#C4A574',
};

const optionGroups: OptionGroup[] = [
  {
    id: 'og-int',
    code: 'INTERIOR',
    name: 'Interior',
    kind: 'board',
    required: true,
    optionIds: ['mat-a', 'mat-wood'],
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
  materials: [material, materialWood],
  edges: [edge],
  hardware: [] as readonly Hardware[],
  optionGroups,
};

const runnerHardware: Hardware = {
  id: 'hw-runner',
  code: 'RUN-450',
  name: 'Corredera 450',
  unit: 'piece',
  costPerUnit: 25,
  active: true,
  visualAsset: {
    assetId: 'ast-runner',
    assetRevisionId: 'rev-skp-runner',
    representation: 'skp',
    sha256: 's'.repeat(64),
    validationState: 'validated',
    glb: {
      revisionId: 'rev-glb-runner',
      sha256: 'g'.repeat(64),
      sourceUnits: 'm',
      upAxis: 'y',
    },
    mountFrame: {
      originMm: [0, 0, 0],
      basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
    },
  },
};

const cajonAgregado: Agregado = {
  id: 'agr-cajon',
  code: 'CAJ',
  name: 'Cajón',
  commercialKitHardwareId: 'hw-kit',
  rigidMembers: [
    {
      memberId: 'corredera-izq',
      role: 'runner_left',
      source: { kind: 'fixed', fixed: { hardwareId: 'hw-runner' } },
      placement: {
        x: { ref: 'min', offsetMm: 0 },
        y: { ref: 'min', offsetMm: 0 },
        z: { ref: 'min', offsetMm: 0 },
      },
      bomRole: 'included_in_kit',
    },
  ],
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

  it('defaults INTERIOR to first material and allows finish override', () => {
    const defaults = resolveModule3DPreview(baseModule, catalog);
    expect(defaults.parts.every((p) => p.materialId === 'mat-a')).toBe(true);
    expect(defaults.optionChoices.INTERIOR).toBe('mat-a');

    const wood = resolveModule3DPreview(baseModule, catalog, null, {
      INTERIOR: 'mat-wood',
    });
    expect(wood.error).toBeNull();
    expect(wood.parts.every((p) => p.materialId === 'mat-wood')).toBe(true);
    expect(wood.parts.every((p) => p.grain === 1)).toBe(true);
    expect(wood.optionChoices.INTERIOR).toBe('mat-wood');
  });

  it('returns empty assemblies when the module has no agregado recipes (#669)', () => {
    const preview = resolveModule3DPreview(baseModule, catalog);
    expect(preview.error).toBeNull();
    expect(preview.assemblies).toEqual([]);
  });

  it('projects the module agregado recipe with identity placement (#669)', () => {
    const withRecipe: Module = {
      ...baseModule,
      agregados: [
        {
          id: 'inst-cajon',
          agregadoId: 'agr-cajon',
          quantity: 1,
        },
      ],
    };
    const preview = resolveModule3DPreview(withRecipe, {
      ...catalog,
      modules: [withRecipe],
      agregados: [cajonAgregado],
      hardware: [runnerHardware],
    });

    expect(preview.error).toBeNull();
    expect(preview.assemblies).toHaveLength(1);
    expect(preview.assemblies[0]!.agregadoId).toBe('agr-cajon');
    expect(preview.assemblies[0]!.rigidMembers).toHaveLength(1);
    expect(preview.assemblies[0]!.rigidMembers[0]!.hardwareId).toBe('hw-runner');
    expect(preview.assemblies[0]!.rigidMembers[0]!.assetId).toBe('ast-runner');
    expect(preview.assemblies[0]!.rigidMembers[0]!.glb?.revisionId).toBe('rev-glb-runner');
  });
});
