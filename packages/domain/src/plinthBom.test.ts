import { describe, expect, it } from 'vitest';
import { resolveBom } from './engine/bom';
import {
  PATAS_ROLE,
  ZOCLO_BOARD_ROLE,
  ZOCLO_STRIP_ROLE,
  SYNTHETIC_ZOCLO_PART_CODE,
  SYNTHETIC_ZOCLO_SIDE_CODE,
  plinthSidesForPlacement,
  applyBaseTreatment,
  baseContextForItem,
  defaultBaseModeForFurnitureType,
} from './plinth';
import { suggestLegCount } from './workshopRules';
import type {
  Catalog,
  Component,
  Module,
  Project,
  Structure,
} from './types';

const matFront = {
  id: 'mat-front',
  code: 'FR-W',
  name: 'Frente blanco',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 18,
  grainDefault: true,
  boardPrice: 100,
  wastePercent: 10,
  costPerM2: 25,
  defaultEdgeBandId: 'edge1',
  active: true,
};

const matBody = {
  id: 'mat-body',
  code: 'BD-W',
  name: 'Cuerpo blanco',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 18,
  grainDefault: true,
  boardPrice: 80,
  wastePercent: 10,
  costPerM2: 20,
  active: true,
};

const hwStrip = {
  id: 'hw-strip',
  code: 'ZOC-ALU',
  name: 'Zoclo plástico aluminio',
  unit: 'meter' as const,
  costPerUnit: 12,
  active: true,
  notes: 'Barra 4 m',
};

const hwLeg = {
  id: 'hw-leg',
  code: 'PATA-100',
  name: 'Pata niveladora 100',
  unit: 'piece' as const,
  costPerUnit: 3,
  active: true,
};

const fourEdges = [
  { side: 'L1' as const, enabled: false },
  { side: 'L2' as const, enabled: false },
  { side: 'W1' as const, enabled: false },
  { side: 'W2' as const, enabled: false },
];

const zocloComp: Component = {
  id: 'comp-zoclo',
  code: 'ZOC-F',
  name: 'Zoclo frontal',
  placement: 'custom',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 18,
    widthMm: 100,
    thicknessMm: 18,
    lengthFormula: 'T',
    widthFormula: 'B',
  },
  defaultEdges: [
    { side: 'L1', enabled: true },
    { side: 'L2', enabled: false },
    { side: 'W1', enabled: false },
    { side: 'W2', enabled: false },
  ],
  optionRoles: [ZOCLO_BOARD_ROLE],
  xFormula: '0',
  yFormula: '0',
  zFormula: '0',
  active: true,
};

const sideComp: Component = {
  id: 'comp-side',
  code: 'LAT',
  name: 'Lateral',
  placement: 'custom',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 560,
    widthMm: 720,
    thicknessMm: 18,
    lengthFormula: 'D',
    widthFormula: 'H',
  },
  defaultEdges: fourEdges,
  optionRoles: ['INTERIOR'],
  active: true,
};

const structure: Structure = {
  id: 'st1',
  code: 'ST-BAJO',
  name: 'Bajo',
  externalDims: { width: 600, height: 720, depth: 560 },
  components: [{ componentId: 'comp-side', quantity: 1 }],
};

function catalog(): Catalog {
  return {
    materials: [matFront, matBody],
    edges: [
      {
        id: 'edge1',
        code: 'E1',
        name: 'Canto',
        thicknessMm: 1,
        costPerMl: 1,
        active: true,
      },
    ],
    hardware: [hwStrip, hwLeg],
    optionGroups: [
      {
        id: 'og-int',
        code: 'INTERIOR',
        name: 'Interior',
        kind: 'board',
        required: true,
        optionIds: ['mat-body'],
      },
      {
        id: 'og-front',
        code: 'FRENTE',
        name: 'Frente',
        kind: 'board',
        required: true,
        optionIds: ['mat-front'],
      },
      {
        id: 'og-zoclo',
        code: ZOCLO_BOARD_ROLE,
        name: 'Zoclo',
        kind: 'board',
        required: false,
        optionIds: ['mat-front', 'mat-body'],
      },
      {
        id: 'og-perfil',
        code: ZOCLO_STRIP_ROLE,
        name: 'Zoclo perfil',
        kind: 'hardware',
        required: false,
        optionIds: ['hw-strip'],
      },
      {
        id: 'og-patas',
        code: PATAS_ROLE,
        name: 'Patas',
        kind: 'hardware',
        required: false,
        optionIds: ['hw-leg'],
      },
    ],
    modules: [],
    structures: [structure],
    components: [zocloComp, sideComp],
  };
}

describe('resolveBom plinth modes', () => {
  it('plinth_board adds zoclo part with B formula and FRENTE material fallback', () => {
    const module: Module = {
      id: 'm1',
      code: 'BAJO-600',
      name: 'Bajo 600',
      structureId: 'st1',
      furnitureType: 'inferior',
      baseMode: 'plinth_board',
      baseClearanceMm: 100,
      components: [{ componentId: 'comp-zoclo', quantity: 1 }],
      externalDims: { width: 600, height: 720, depth: 560 },
      hardwareLines: [],
    };
    const bom = resolveBom(
      module,
      { INTERIOR: 'mat-body', FRENTE: 'mat-front' },
      catalog(),
    );
    const zoclo = bom.boardParts.find((p) => p.optionRole === ZOCLO_BOARD_ROLE);
    expect(zoclo).toBeTruthy();
    expect(zoclo!.widthMm).toBe(100); // B
    expect(zoclo!.materialId).toBe('mat-front'); // FRENTE fallback
    expect(bom.boardParts.some((p) => p.optionRole === 'INTERIOR')).toBe(true);
  });

  it('none excludes zoclo board components', () => {
    const module: Module = {
      id: 'm1',
      code: 'BAJO-600',
      name: 'Bajo 600',
      structureId: 'st1',
      baseMode: 'none',
      components: [{ componentId: 'comp-zoclo', quantity: 1 }],
      externalDims: { width: 600, height: 720, depth: 560 },
      hardwareLines: [],
    };
    const bom = resolveBom(
      module,
      { INTERIOR: 'mat-body', FRENTE: 'mat-front' },
      catalog(),
    );
    expect(
      bom.boardParts.find((p) => p.optionRole === ZOCLO_BOARD_ROLE),
    ).toBeUndefined();
  });

  it('plinth_strip bills profile hardware in linear meters from W', () => {
    const module: Module = {
      id: 'm1',
      code: 'BAJO-600',
      name: 'Bajo 600',
      structureId: 'st1',
      baseMode: 'plinth_strip',
      baseClearanceMm: 100,
      components: [{ componentId: 'comp-zoclo', quantity: 1 }],
      externalDims: { width: 800, height: 720, depth: 560 },
      hardwareLines: [
        {
          id: 'hl-z',
          quantity: 1,
          optionRole: ZOCLO_STRIP_ROLE,
          hardwareId: 'hw-strip',
        },
      ],
    };
    const bom = resolveBom(
      module,
      { INTERIOR: 'mat-body', FRENTE: 'mat-front' },
      catalog(),
    );
    expect(
      bom.boardParts.find((p) => p.optionRole === ZOCLO_BOARD_ROLE),
    ).toBeUndefined();
    const strip = bom.hardwareLines.find(
      (h) => h.optionRole === ZOCLO_STRIP_ROLE,
    );
    expect(strip).toBeTruthy();
    expect(strip!.quantity).toBe(0.8);
    expect(strip!.hardwareId).toBe('hw-strip');
  });
});

function bajoModule(overrides: Partial<Module> = {}): Module {
  return {
    id: 'm1',
    code: 'BAJO-600',
    name: 'Bajo 600',
    structureId: 'st1',
    furnitureType: 'inferior',
    externalDims: { width: 600, height: 720, depth: 560 },
    hardwareLines: [],
    ...overrides,
  };
}

describe('F087 — zócalo como terminación automática', () => {
  const baseChoices = { INTERIOR: 'mat-body', FRENTE: 'mat-front' };

  it('defaultBaseModeForFurnitureType: piso → melamina, superior → none', () => {
    expect(defaultBaseModeForFurnitureType('inferior')).toBe('plinth_board');
    expect(defaultBaseModeForFurnitureType('alto')).toBe('plinth_board');
    expect(defaultBaseModeForFurnitureType('superior')).toBe('none');
    expect(defaultBaseModeForFurnitureType(undefined)).toBe('plinth_board');
  });

  it('plinth_board sin componente ZOCLO sintetiza la pieza con material del frente', () => {
    const bom = resolveBom(
      bajoModule({ baseMode: 'plinth_board', baseClearanceMm: 100 }),
      baseChoices,
      catalog(),
    );
    const zoclo = bom.boardParts.filter(
      (p) => p.optionRole === ZOCLO_BOARD_ROLE,
    );
    expect(zoclo).toHaveLength(1);
    expect(zoclo[0]!.code).toBe(SYNTHETIC_ZOCLO_PART_CODE);
    expect(zoclo[0]!.lengthMm).toBe(600);
    expect(zoclo[0]!.widthMm).toBe(100);
    expect(zoclo[0]!.materialId).toBe('mat-front');
  });

  it('plinth_board con componente ZOCLO propio no duplica la pieza', () => {
    const bom = resolveBom(
      bajoModule({
        baseMode: 'plinth_board',
        baseClearanceMm: 100,
        components: [{ componentId: 'comp-zoclo', quantity: 1 }],
      }),
      baseChoices,
      catalog(),
    );
    const zoclo = bom.boardParts.filter(
      (p) => p.optionRole === ZOCLO_BOARD_ROLE,
    );
    expect(zoclo).toHaveLength(1);
    expect(zoclo[0]!.code).not.toBe(SYNTHETIC_ZOCLO_PART_CODE);
  });

  it('el contexto del íte activa el modo aunque el módulo no lo declare', () => {
    const bom = resolveBom(
      bajoModule(),
      { ...baseChoices, ZOCLO_PERFIL: 'hw-strip' },
      catalog(),
      undefined,
      undefined,
      { baseMode: 'plinth_strip', baseClearanceMm: 100 },
    );
    expect(
      bom.boardParts.find((p) => p.optionRole === ZOCLO_BOARD_ROLE),
    ).toBeUndefined();
    const strip = bom.hardwareLines.find(
      (h) => h.optionRole === ZOCLO_STRIP_ROLE,
    );
    expect(strip).toBeTruthy();
    expect(strip!.hardwareId).toBe('hw-strip');
    expect(strip!.quantity).toBe(0.6);
  });

  it('la altura B del contexto (plano) manda sobre la del módulo', () => {
    const bom = resolveBom(
      bajoModule({ baseMode: 'plinth_board' }),
      baseChoices,
      catalog(),
      undefined,
      undefined,
      { baseClearanceMm: 120 },
    );
    const zoclo = bom.boardParts.find(
      (p) => p.code === SYNTHETIC_ZOCLO_PART_CODE,
    );
    expect(zoclo).toBeTruthy();
    expect(zoclo!.widthMm).toBe(120);
  });

  it('legs vía contexto sintetiza patas con cantidad sugerida', () => {
    const bom = resolveBom(
      bajoModule(),
      { ...baseChoices, PATAS: 'hw-leg' },
      catalog(),
      undefined,
      undefined,
      { baseMode: 'legs', baseClearanceMm: 100 },
    );
    const patas = bom.hardwareLines.find(
      (h) => h.optionRole === PATAS_ROLE,
    );
    expect(patas).toBeTruthy();
    expect(patas!.hardwareId).toBe('hw-leg');
    expect(patas!.quantity).toBe(suggestLegCount(600));
  });

  it('none no sintetiza nada', () => {
    const bom = resolveBom(
      bajoModule({ baseMode: 'none' }),
      baseChoices,
      catalog(),
    );
    expect(
      bom.boardParts.find((p) => p.optionRole === ZOCLO_BOARD_ROLE),
    ).toBeUndefined();
    expect(
      bom.hardwareLines.find(
        (h) => h.optionRole === ZOCLO_STRIP_ROLE || h.optionRole === PATAS_ROLE,
      ),
    ).toBeUndefined();
  });

  it('applyBaseTreatment no toca módulos que ya tienen herraje de base', () => {
    const res = applyBaseTreatment(
      'BAJO-600',
      [],
      [
        {
          id: 'hl-fixed',
          quantity: 1,
          optionRole: ZOCLO_STRIP_ROLE,
          hardwareId: 'hw-strip',
        },
      ],
      'plinth_strip',
      100,
      600,
      560,
    );
    expect(res.hardwareLines).toHaveLength(1);
    expect(res.hardwareLines[0]!.id).toBe('hl-fixed');
    expect(res.hardwareLines[0]!.quantity).toBe(0.6);
  });

  it('baseContextForItem resuelve modo del ítem y B del plano', () => {
    const project = {
      items: [],
      kitchenLayout: {
        walls: [],
        placements: [
          {
            itemId: 'it-1',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 0,
            elevation: 'floor',
            mode: 'wall',
            baseClearanceMm: 150,
          },
        ],
        baseClearanceMm: 100,
      },
    } as unknown as Project;
    const ctx = baseContextForItem(project, { id: 'it-1', baseMode: 'legs' });
    expect(ctx.baseMode).toBe('legs');
    expect(ctx.baseClearanceMm).toBe(150);

    const noLayout = baseContextForItem(
      { items: [] } as unknown as Project,
      { id: 'it-1' },
    );
    expect(noLayout.baseMode).toBeUndefined();
    expect(noLayout.baseClearanceMm).toBeUndefined();
  });
});

describe('F088 — vueltas laterales del zócalo', () => {
  const baseChoices = { INTERIOR: 'mat-body', FRENTE: 'mat-front' };
  const wall = { id: 'w1', lengthMm: 3000, angleDeg: 0 };
  const placement = (
    itemId: string,
    offsetMm: number,
  ) => ({
    itemId,
    instanceIndex: 0,
    wallId: 'w1',
    offsetMm,
    elevation: 'floor' as const,
    mode: 'wall' as const,
  });
  const widthOf = () => 600;

  it('expone solo los extremos del mueble en una corrida', () => {
    const layout = {
      walls: [wall],
      placements: [placement('a', 0), placement('b', 600), placement('c', 1200)],
    };
    const sidesOf = (id: string, offset: number) =>
      plinthSidesForPlacement(layout, placement(id, offset), widthOf);
    // Mueble del medio: cubierto por vecinos a ambos lados.
    expect(sidesOf('b', 600)).toEqual({ left: false, right: false, back: false });
    // Primer mueble: izquierda contra el inicio del muro, derecha pegada a b.
    expect(sidesOf('a', 0)).toEqual({ left: false, right: false, back: false });
    // Último mueble: la corrida termina en 1800 sobre un muro de 3000 →
    // derecha expuesta (sigue habiendo muro detrás, no al costado).
    expect(sidesOf('c', 1200)).toEqual({ left: false, right: true, back: false });
  });

  it('islas (free) exponen ambos lados y la trasera', () => {
    const layout = {
      walls: [],
      placements: [
        {
          itemId: 'a',
          instanceIndex: 0,
          wallId: '',
          offsetMm: 0,
          elevation: 'floor' as const,
          mode: 'free' as const,
          freeXMm: 1000,
          freeYMm: 1000,
          freeYawDeg: 0,
        },
      ],
    };
    expect(
      plinthSidesForPlacement(layout, layout.placements[0]!, widthOf),
    ).toEqual({ left: true, right: true, back: true });
  });

  it('melamina sintetiza una vuelta por lado expuesto', () => {
    const bom = resolveBom(
      bajoModule({ baseMode: 'plinth_board', baseClearanceMm: 100 }),
      baseChoices,
      catalog(),
      undefined,
      undefined,
      { baseClearanceMm: 100, plinthSides: { left: true, right: true, back: false } },
    );
    const zoclos = bom.boardParts.filter(
      (p) => p.optionRole === ZOCLO_BOARD_ROLE,
    );
    expect(zoclos).toHaveLength(3); // frontal + 2 vueltas
    const vueltas = zoclos.filter((p) => p.code === SYNTHETIC_ZOCLO_SIDE_CODE);
    expect(vueltas).toHaveLength(2);
    // D=560, recepa 50 → vuelta de 510 de largo, 100 (B) de alto.
    expect(vueltas[0]!.lengthMm).toBe(510);
    expect(vueltas[0]!.widthMm).toBe(100);
    expect(vueltas[0]!.materialId).toBe('mat-front');
  });

  it('perfil suma el ml de las vueltas', () => {
    const bom = resolveBom(
      bajoModule(),
      { ...baseChoices, ZOCLO_PERFIL: 'hw-strip' },
      catalog(),
      undefined,
      undefined,
      {
        baseMode: 'plinth_strip',
        baseClearanceMm: 100,
        plinthSides: { left: true, right: true, back: false },
      },
    );
    const strip = bom.hardwareLines.find(
      (h) => h.optionRole === ZOCLO_STRIP_ROLE,
    );
    // W=600 + 2 vueltas de 510 → 1.62 ml.
    expect(strip!.quantity).toBe(1.62);
  });

  it('sin contexto de lados no hay vueltas (compatibilidad)', () => {
    const bom = resolveBom(
      bajoModule({ baseMode: 'plinth_board', baseClearanceMm: 100 }),
      baseChoices,
      catalog(),
    );
    expect(
      bom.boardParts.filter((p) => p.code === SYNTHETIC_ZOCLO_SIDE_CODE),
    ).toHaveLength(0);
  });

  it('módulo con zócalo propio no recibe vueltas sintetizadas', () => {
    const bom = resolveBom(
      bajoModule({
        baseMode: 'plinth_board',
        baseClearanceMm: 100,
        components: [{ componentId: 'comp-zoclo', quantity: 1 }],
      }),
      baseChoices,
      catalog(),
      undefined,
      undefined,
      { plinthSides: { left: true, right: true, back: false } },
    );
    const zoclos = bom.boardParts.filter(
      (p) => p.optionRole === ZOCLO_BOARD_ROLE,
    );
    expect(zoclos).toHaveLength(1); // solo la pieza propia
    expect(
      zoclos.filter((p) => p.code === SYNTHETIC_ZOCLO_SIDE_CODE),
    ).toHaveLength(0);
  });
});
