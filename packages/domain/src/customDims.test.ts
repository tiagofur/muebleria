/**
 * F144/#310 — dimensiones libres por ítem: la misma medida debe llegar al
 * BOM, al precio y al fingerprint de producción (North Star §16: diseño →
 * negocio → producción conectados).
 */

import { describe, expect, it } from 'vitest';
import { resolveBom } from './engine/bom';
import { computeProductionDesignFingerprint } from './productionRevision';
import type { Catalog, Module, Project, ProjectItem } from './types';

const CUSTOM: Catalog['materials'] = [
  {
    id: 'mat',
    code: 'TAB',
    name: 'Melamina',
    widthMm: 1000,
    lengthMm: 1000,
    thicknessMm: 15,
    grainDefault: false,
    boardPrice: 100,
    wastePercent: 0,
    costPerM2: 100,
    active: true,
  },
];

function parametricCatalog(): Catalog {
  return {
    materials: CUSTOM,
    edges: [],
    hardware: [],
    optionGroups: [
      { id: 'og-int', code: 'INTERIOR', name: 'Interior', kind: 'board', required: true, optionIds: ['mat'] },
    ],
    structures: [
      {
        id: 's1',
        code: 'EST',
        name: 'Carcasa',
        externalDims: { width: 600, height: 720, depth: 560 },
        // Panel paramétrico: largo = H, ancho = W (fórmulas W/H/D).
        components: [
          {
            componentId: 'comp-frente',
            quantity: 1,
          },
        ],
        active: true,
      },
    ],
    components: [
      {
        id: 'comp-frente',
        code: 'FRENTE',
        name: 'Frente',
        placement: 'frontal',
        geometry: {
          kind: 'rectangular_board',
          lengthMm: 720,
          widthMm: 600,
          thicknessMm: 18,
          lengthFormula: 'H',
          widthFormula: 'W',
        },
        defaultEdges: [
          { side: 'L1', enabled: false },
          { side: 'L2', enabled: false },
          { side: 'W1', enabled: false },
          { side: 'W2', enabled: false },
        ],
        optionRoles: ['INTERIOR'],
        active: true,
      },
    ],
    modules: [],
  };
}

function parametricModule(presets?: Module['presets']): Module {
  return {
    id: 'm1',
    code: 'BA',
    name: 'Bajo',
    structureId: 's1',
    components: [],
    hardwareLines: [],
    ...(presets ? { presets } : {}),
    active: true,
  } as Module;
}

const PRESETS: NonNullable<Module['presets']> = [
  { id: 'p600', name: '600', width: 600, height: 720, depth: 560 },
  { id: 'p800', name: '800', width: 800, height: 720, depth: 560 },
];

function projectWith(item: Partial<ProjectItem>): Project {
  return {
    id: 'prj',
    code: 'OB-1',
    name: 'Obra',
    status: 'draft',
    customerId: 'c1',
    items: [
      {
        id: 'i1',
        moduleId: 'm1',
        quantity: 1,
        optionChoices: { INTERIOR: 'mat' },
        ...item,
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Project;
}

describe('resolveBom dimsOverride', () => {
  it('customDims cambia el tamaño de las piezas (engine paramétrico)', () => {
    const catalog = parametricCatalog();
    const mod = parametricModule(PRESETS);
    const choices = { INTERIOR: 'mat' };

    const presetBom = resolveBom(mod, choices, catalog, 'p600');
    const customBom = resolveBom(mod, choices, catalog, 'p600', undefined, undefined, {
      widthMm: 900,
      heightMm: 800,
      depthMm: 500,
    });

    const presetFront = presetBom.boardParts[0]!;
    const customFront = customBom.boardParts[0]!;
    expect(presetFront.lengthMm).toBe(720);
    expect(presetFront.widthMm).toBe(600);
    expect(customFront.lengthMm).toBe(800); // H
    expect(customFront.widthMm).toBe(900); // W
  });

  it('rechaza override en módulo no paramétrico', () => {
    const catalog = parametricCatalog();
    const fixed = { ...parametricModule(), structureId: undefined };
    expect(() =>
      resolveBom(fixed, { INTERIOR: 'mat' }, catalog, undefined, undefined, undefined, {
        widthMm: 900,
        heightMm: 720,
        depthMm: 500,
      }),
    ).toThrowError(/no es paramétrico/);
  });

  it('sin override el comportamiento es byte-idéntico (presets intactos)', () => {
    const catalog = parametricCatalog();
    const mod = parametricModule(PRESETS);
    const a = resolveBom(mod, { INTERIOR: 'mat' }, catalog, 'p800');
    const b = resolveBom(mod, { INTERIOR: 'mat' }, catalog, 'p800', undefined, undefined, undefined);
    expect(a.boardParts).toEqual(b.boardParts);
  });
});

describe('fingerprint de producción', () => {
  it('customDims cambia el fingerprint (diseño ⇒ stale)', () => {
    const base = computeProductionDesignFingerprint(projectWith({ measurePresetId: 'p600' }));
    const custom = computeProductionDesignFingerprint(
      projectWith({
        measurePresetId: 'p600',
        customDims: { widthMm: 900, heightMm: 720, depthMm: 560 },
      }),
    );
    expect(custom).not.toBeNull();
    expect(base).not.toBeNull();
    expect(custom).not.toBe(base);
  });

  it('sin customDims el token legacy se preserva (sin false-stale masivo)', () => {
    const a = computeProductionDesignFingerprint(projectWith({}));
    const b = computeProductionDesignFingerprint(projectWith({ customDims: undefined }));
    expect(a).toBe(b);
    // El token d= sólo aparece con customDims.
    expect(a).not.toContain('|d=');
  });
});
