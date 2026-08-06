import { describe, expect, it } from 'vitest';
import { resolveBom } from './engine/bom';
import {
  ZOCLO_BOARD_ROLE,
  ZOCLO_STRIP_ROLE,
} from './plinth';
import type {
  Catalog,
  Component,
  Module,
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
    hardware: [hwStrip],
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
