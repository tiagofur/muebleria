import { describe, expect, it } from 'vitest';
import { resolveAssembly } from './assembly';
import { evaluatePartFormula, resolveBom } from './engine';
import {
  plantillaCatalogWithModules,
  plantillaChoices,
  IDS,
} from './__fixtures__/plantillaDemo';
import type {
  Catalog,
  FurnitureComponent,
  Module,
  Structure,
} from './types';

const mat = {
  id: 'mat-1',
  code: 'MEL-18',
  name: 'Melamina 18',
  widthMm: 1830,
  lengthMm: 2750,
  thicknessMm: 18,
  grainDefault: false,
  boardPrice: 1000,
  wastePercent: 10,
  costPerM2: 200,
  active: true,
};

const edges = {
  id: 'edge-1',
  code: 'C-05',
  name: 'Canto 0.5',
  thicknessMm: 1,
  costPerMl: 5,
  active: true,
};

const emptyEdges = [
  { side: 'L1' as const, enabled: false },
  { side: 'L2' as const, enabled: false },
  { side: 'W1' as const, enabled: false },
  { side: 'W2' as const, enabled: false },
];

const structure: Structure = {
  id: 'st-1',
  code: 'EST-GAB',
  name: 'Cuerpo gabinete',
  externalDims: { width: 600, height: 720, depth: 560 },
  boardParts: [
    {
      id: 'left',
      description: 'Lateral izq',
      quantity: 1,
      lengthMm: 720,
      widthMm: 560,
      lengthFormula: 'H',
      widthFormula: 'D',
      edges: emptyEdges,
      optionRole: 'INTERIOR',
      placement: 'left',
      designThicknessMm: 18,
    },
    {
      id: 'right',
      description: 'Lateral der',
      quantity: 1,
      lengthMm: 720,
      widthMm: 560,
      lengthFormula: 'H',
      widthFormula: 'D',
      edges: emptyEdges,
      optionRole: 'INTERIOR',
      placement: 'right',
      designThicknessMm: 18,
    },
    {
      id: 'base',
      description: 'Base',
      quantity: 1,
      lengthMm: 564,
      widthMm: 560,
      lengthFormula: 'W-2*T',
      widthFormula: 'D',
      edges: emptyEdges,
      optionRole: 'INTERIOR',
      placement: 'base',
      designThicknessMm: 18,
    },
  ],
};

const puerta: FurnitureComponent = {
  id: 'comp-door',
  code: 'COMP-PTA',
  name: 'Puerta',
  kind: 'puerta',
  boardParts: [
    {
      id: 'door-panel',
      description: 'Puerta',
      quantity: 1,
      lengthMm: 700,
      widthMm: 300,
      lengthFormula: 'H-4',
      widthFormula: 'W/n-2',
      edges: emptyEdges,
      optionRole: 'FRENTE',
      designThicknessMm: 18,
    },
  ],
  hardwareLines: [],
  active: true,
};

const composed: Module = {
  id: 'mod-1',
  code: 'MOD-COMP',
  name: 'Gabinete compuesto',
  structureId: 'st-1',
  presets: [
    { id: 'p600', name: '600', width: 600, height: 720, depth: 560 },
  ],
  components: [
    {
      componentId: 'comp-door',
      quantity: 2,
      placement: 'door',
    },
  ],
  boardParts: [],
  hardwareLines: [],
};

const fixed: Module = {
  id: 'mod-fixed',
  code: 'MOD-FIX',
  name: 'Módulo fijo',
  boardParts: [
    {
      id: 'p1',
      description: 'Pieza fija',
      quantity: 1,
      lengthMm: 500,
      widthMm: 300,
      edges: emptyEdges,
      optionRole: 'INTERIOR',
    },
  ],
  hardwareLines: [],
  externalDims: { width: 500, height: 700, depth: 400 },
};

function catalog(extra: Partial<Catalog> = {}): Catalog {
  return {
    materials: [mat],
    edges: [edges],
    hardware: [],
    optionGroups: [
      {
        id: 'g-int',
        code: 'INTERIOR',
        name: 'Interior',
        kind: 'board',
        required: true,
        optionIds: [mat.id],
      },
      {
        id: 'g-fr',
        code: 'FRENTE',
        name: 'Frente',
        kind: 'board',
        required: true,
        optionIds: [mat.id],
      },
    ],
    modules: [composed, fixed],
    structures: [structure],
    components: [puerta],
    ...extra,
  };
}

describe('evaluatePartFormula tokens T/i/n', () => {
  it('evaluates T and instance index', () => {
    expect(
      evaluatePartFormula('W-2*T', { W: 600, H: 720, D: 560, T: 18 }),
    ).toBe(564);
    expect(
      evaluatePartFormula('i*(W/n)', {
        W: 600,
        H: 720,
        D: 560,
        i: 1,
        n: 2,
      }),
    ).toBe(300);
  });
});

describe('resolveAssembly', () => {
  const choices = { INTERIOR: mat.id, FRENTE: mat.id };
  const cat = catalog();

  it('places structure parts with slot defaults', () => {
    const asm = resolveAssembly(composed, choices, cat, 'p600');
    expect(asm.outerMm).toEqual({ width: 600, height: 720, depth: 560 });
    expect(asm.completeness).toBe('full');

    const left = asm.boards.find((b) => b.partId === 'left');
    const right = asm.boards.find((b) => b.partId === 'right');
    const base = asm.boards.find((b) => b.partId === 'base');
    expect(left?.face).toBe('yz');
    expect(left?.originMm).toEqual({ x: 0, y: 0, z: 0 });
    expect(right?.originMm.x).toBe(582); // W-T = 600-18
    expect(base?.face).toBe('xz');
    expect(base?.lengthMm).toBe(564);
  });

  it('places two doors with different origins via i/n', () => {
    const asm = resolveAssembly(composed, choices, cat, 'p600');
    const doors = asm.boards.filter((b) => b.source.kind === 'component');
    expect(doors).toHaveLength(2);
    expect(doors[0]!.originMm.x).toBe(0);
    expect(doors[1]!.originMm.x).toBe(300);
    expect(doors[0]!.widthMm).toBe(298); // 600/2 - 2
    expect(doors[1]!.widthMm).toBe(298);
    expect(doors[0]!.face).toBe('xy');
  });

  it('returns outer_only for fixed module without spatial metadata', () => {
    const asm = resolveAssembly(fixed, choices, cat);
    expect(asm.completeness).toBe('outer_only');
    expect(asm.boards).toHaveLength(0);
    expect(asm.outerMm).toEqual({ width: 500, height: 700, depth: 400 });
  });

  it('does not change resolveBom contract for composed module', () => {
    const bom = resolveBom(composed, choices, cat, 'p600');
    // 3 structure + 2 door panels
    expect(bom.boardParts).toHaveLength(5);
    expect(bom.boardParts.some((p) => p.description === 'Puerta')).toBe(true);
  });

  it('seed MOD-COMP-600 produces full assembly for 3D', () => {
    const mod = plantillaCatalogWithModules.modules.find(
      (m) => m.id === IDS.modComp600,
    )!;
    const asm = resolveAssembly(
      mod,
      plantillaChoices,
      plantillaCatalogWithModules,
      'preset-comp-600',
    );
    expect(asm.completeness).toBe('full');
    expect(asm.outerMm).toEqual({ width: 600, height: 720, depth: 560 });
    // 5 body + 1 door
    expect(asm.boards).toHaveLength(6);
    const left = asm.boards.find((b) => b.partId === 'est-gab-left');
    const right = asm.boards.find((b) => b.partId === 'est-gab-right');
    const door = asm.boards.find((b) => b.source.kind === 'component');
    expect(left?.originMm.x).toBe(0);
    // T from plantilla INTERIOR material (Arauco 15 mm)
    expect(right?.originMm.x).toBe(600 - (right?.thicknessMm ?? 0));
    expect(door?.face).toBe('xy');
    expect(door?.lengthMm).toBe(716);
  });
});
