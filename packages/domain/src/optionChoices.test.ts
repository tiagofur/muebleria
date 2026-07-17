import { describe, expect, it } from 'vitest';
import { effectiveOptionChoices } from './optionChoices';
import { calcProjectBreakdown, resolveBom } from './engine';
import type { Catalog, Component, Module, Project, Structure } from './types';
import { ResolutionError } from './errors';

describe('effectiveOptionChoices (F029 / #35)', () => {
  it('uses project level when item has no override', () => {
    expect(
      effectiveOptionChoices({}, { INTERIOR: 'mat-a', BISAGRA: 'hw-a' }),
    ).toEqual({ INTERIOR: 'mat-a', BISAGRA: 'hw-a' });
  });

  it('item override wins over project default', () => {
    expect(
      effectiveOptionChoices(
        { INTERIOR: 'mat-b' },
        { INTERIOR: 'mat-a', BISAGRA: 'hw-a' },
      ),
    ).toEqual({ INTERIOR: 'mat-b', BISAGRA: 'hw-a' });
  });

  it('empty item values inherit project', () => {
    expect(
      effectiveOptionChoices(
        { INTERIOR: '', BISAGRA: '  ' },
        { INTERIOR: 'mat-a', BISAGRA: 'hw-a' },
      ),
    ).toEqual({ INTERIOR: 'mat-a', BISAGRA: 'hw-a' });
  });

  it('works with only item choices', () => {
    expect(effectiveOptionChoices({ INTERIOR: 'mat-a' }, undefined)).toEqual({
      INTERIOR: 'mat-a',
    });
  });
});

function miniCatalog(): { catalog: Catalog; module: Module } {
  // Composed module: a single INTERIOR component expanded via a structure.
  // The test exercises option-choice resolution; board parts are produced by
  // expanding the component instance (modules no longer carry boardParts).
  const component: Component = {
    id: 'comp-1',
    code: 'COM-1',
    name: 'Lateral',
    placement: 'lateral_izquierdo',
    geometry: { kind: 'rectangular_board', lengthMm: 700, widthMm: 500, thicknessMm: 15 },
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
    id: 'struct-1',
    code: 'EST-1',
    name: 'Cuerpo',
    externalDims: { width: 500, height: 700, depth: 500 },
    components: [{ componentId: 'comp-1', quantity: 1 }],
    presets: [{ id: 'preset-1', width: 500, height: 700, depth: 500 }],
    active: true,
  };
  const module: Module = {
    id: 'mod-1',
    code: 'MOD-1',
    name: 'Mueble',
    structureId: 'struct-1',
    externalDims: { width: 500, height: 700, depth: 500 },
    hardwareLines: [{ id: 'h1', quantity: 2, optionRole: 'BISAGRA' }],
  };
  const catalog: Catalog = {
    materials: [
      {
        id: 'mat-a',
        code: 'MAT-A',
        name: 'A',
        widthMm: 1000,
        lengthMm: 2000,
        thicknessMm: 15,
        grainDefault: false,
        boardPrice: 100,
        wastePercent: 0,
        costPerM2: 50,
        active: true,
      },
      {
        id: 'mat-b',
        code: 'MAT-B',
        name: 'B',
        widthMm: 1000,
        lengthMm: 2000,
        thicknessMm: 15,
        grainDefault: false,
        boardPrice: 200,
        wastePercent: 0,
        costPerM2: 100,
        active: true,
      },
    ],
    edges: [],
    hardware: [
      {
        id: 'hw-a',
        code: 'HW-A',
        name: 'Bisagra',
        unit: 'piece',
        costPerUnit: 10,
        active: true,
      },
    ],
    optionGroups: [
      {
        id: 'g1',
        code: 'INTERIOR',
        name: 'Interior',
        kind: 'board',
        required: true,
        optionIds: ['mat-a', 'mat-b'],
      },
      {
        id: 'g2',
        code: 'BISAGRA',
        name: 'Bisagra',
        kind: 'hardware',
        required: true,
        optionIds: ['hw-a'],
      },
    ],
    modules: [module],
    structures: [structure],
    components: [component],
  };
  return { catalog, module };
}

describe('project-level choices in calcProjectBreakdown', () => {
  it('resolves from project defaults when item has empty choices', () => {
    const { catalog, module } = miniCatalog();
    const project: Project = {
      id: 'prj',
      name: 'P',
      customerId: 'c',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      projectLevelChoices: { INTERIOR: 'mat-a', BISAGRA: 'hw-a' },
      items: [
        {
          id: 'i1',
          moduleId: module.id,
          quantity: 1,
          optionChoices: {},
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const bd = calcProjectBreakdown(project, catalog);
    expect(bd.salePrice).toBeGreaterThan(0);
    const bom = resolveBom(
      module,
      effectiveOptionChoices({}, project.projectLevelChoices),
      catalog,
    );
    expect(bom.boardParts[0]?.materialId).toBe('mat-a');
  });

  it('line override changes material without needing full item choices', () => {
    const { catalog, module } = miniCatalog();
    const project: Project = {
      id: 'prj',
      name: 'P',
      customerId: 'c',
      currency: 'MXN',
      marginFactor: 1,
      laborFixedCost: 0,
      status: 'draft',
      projectLevelChoices: { INTERIOR: 'mat-a', BISAGRA: 'hw-a' },
      items: [
        {
          id: 'i1',
          moduleId: module.id,
          quantity: 1,
          optionChoices: { INTERIOR: 'mat-b' },
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const bom = resolveBom(
      module,
      effectiveOptionChoices(
        project.items[0]!.optionChoices,
        project.projectLevelChoices,
      ),
      catalog,
    );
    expect(bom.boardParts[0]?.materialId).toBe('mat-b');
    const withDefault = calcProjectBreakdown(
      {
        ...project,
        items: [{ ...project.items[0]!, optionChoices: {} }],
      },
      catalog,
    );
    const withOverride = calcProjectBreakdown(project, catalog);
    expect(withOverride.materialsCost).toBeGreaterThan(withDefault.materialsCost);
  });

  it('throws when required choice missing at both levels', () => {
    const { catalog, module } = miniCatalog();
    const project: Project = {
      id: 'prj',
      name: 'P',
      customerId: 'c',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i1',
          moduleId: module.id,
          quantity: 1,
          optionChoices: {},
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(() => calcProjectBreakdown(project, catalog)).toThrow(
      ResolutionError,
    );
  });
});
