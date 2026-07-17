import { describe, expect, it } from 'vitest';
import {
  materialToApi,
  materialFromApi,
  moduleToApi,
  moduleFromApi,
  categoryToApi,
  sortCategoriesForSave,
  projectToApi,
  projectFromApi,
  breakdownFromApi,
  componentToApi,
  componentFromApi,
} from './apiMappers';
import type { Component, MaterialBoard, Module, ModuleCategory, Project } from '@muebles/domain';

describe('apiMappers', () => {
  it('maps material camelCase ↔ snake_case', () => {
    const m: MaterialBoard = {
      id: 'm1',
      code: 'TAB-1',
      name: 'Board',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 15,
      grainDefault: true,
      boardPrice: 100,
      wastePercent: 10,
      costPerM2: 25,
      defaultEdgeBandId: 'edge-1',
      active: true,
    };
    const api = materialToApi(m);
    expect(api.width_mm).toBe(1830);
    expect(api.board_price).toBe(100);
    expect(api.default_edge_band_id).toBe('edge-1');
    expect(materialFromApi(api as Record<string, unknown>)).toMatchObject({
      widthMm: 1830,
      boardPrice: 100,
      grainDefault: true,
      defaultEdgeBandId: 'edge-1',
    });
  });

  it('maps module components + structureId to API and back', () => {
    const mod: Module = {
      id: 'mod1',
      code: 'GAB-01',
      name: 'Gab',
      categoryId: 'cat1',
      structureId: 'struct-1',
      components: [
        { componentId: 'comp-1', quantity: 2, placementOverride: 'puerta' },
      ],
      baseLaborCost: 50,
      hardwareLines: [
        {
          id: 'h1',
          quantity: 2,
          optionRole: 'BISAGRA',
          hardwareId: 'hw1',
        },
      ],
    };
    const api = moduleToApi(mod);
    expect(api.base_labor_cost).toBe(50);
    expect(api.categoryId).toBe('cat1');
    expect(api.structure_id).toBe('struct-1');
    const comps = api.components as Record<string, unknown>[];
    expect(comps[0]?.componentId).toBe('comp-1');
    expect(comps[0]?.quantity).toBe(2);
    const lines = api.hardware_lines as Record<string, unknown>[];
    expect(lines[0]?.hardware_id).toBe('hw1');

    const round = moduleFromApi(api as Record<string, unknown>);
    expect(round.structureId).toBe('struct-1');
    expect(round.components?.[0]?.componentId).toBe('comp-1');
    expect(round.components?.[0]?.quantity).toBe(2);
    expect(round.baseLaborCost).toBe(50);
    expect(round.hardwareLines[0]?.hardwareId).toBe('hw1');
  });

  it('sorts categories parents before children', () => {
    const cats: ModuleCategory[] = [
      { id: 'child', name: 'Child', parentId: 'root', sortOrder: 0 },
      { id: 'root', name: 'Root', sortOrder: 0 },
      { id: 'grand', name: 'Grand', parentId: 'child', sortOrder: 0 },
    ];
    expect(sortCategoriesForSave(cats).map((c) => c.id)).toEqual([
      'root',
      'child',
      'grand',
    ]);
  });

  it('maps project customerId and items', () => {
    const p: Project = {
      id: 'pr1',
      name: 'Cotiz',
      customerId: 'c1',
      currency: 'UYU',
      marginFactor: 1.4,
      laborFixedCost: 100,
      status: 'draft',
      projectLevelChoices: { INTERIOR: 'mat1', FRENTE: 'mat2' },
      items: [
        {
          id: 'i1',
          moduleId: 'm1',
          quantity: 2,
          optionChoices: { INTERIOR: 'mat1' },
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const api = projectToApi(p);
    expect(api.customer_id).toBe('c1');
    expect(api.project_level_choices).toEqual({
      INTERIOR: 'mat1',
      FRENTE: 'mat2',
    });
    expect(projectFromApi(api as Record<string, unknown>).projectLevelChoices).toEqual({
      INTERIOR: 'mat1',
      FRENTE: 'mat2',
    });
    const items = api.items as Record<string, unknown>[];
    expect(items[0]?.module_id).toBe('m1');
    expect(projectFromApi(api as Record<string, unknown>).customerId).toBe('c1');
  });

  it('categoryToApi keeps parentId camelCase for Go', () => {
    expect(
      categoryToApi({
        id: 'c1',
        name: 'Root',
        sortOrder: 2,
      }),
    ).toEqual({ id: 'c1', name: 'Root', parentId: '', sortOrder: 2 });
  });

  it('maps breakdown snake_case (Go calculate) to camelCase', () => {
    const api = {
      materials_cost: 100.5,
      edge_total: 12.25,
      hardware_total: 8,
      direct_cost: 120.75,
      labor_modular: 40,
      labor_fixed_cost: 15.5,
      margin_factor: 1.35,
      sale_price: 200.1,
    };
    const bd = breakdownFromApi(api as Record<string, unknown>);
    expect(bd).toEqual({
      materialsCost: 100.5,
      edgeTotal: 12.25,
      hardwareTotal: 8,
      directCost: 120.75,
      laborModular: 40,
      laborFixedCost: 15.5,
      marginFactor: 1.35,
      salePrice: 200.1,
    });
  });

  it('breakdownFromApi tolerates missing fields', () => {
    const bd = breakdownFromApi({});
    expect(bd.materialsCost).toBe(0);
    expect(bd.salePrice).toBe(0);
    // marginFactor defaults to 1 (no margin) rather than 0 (which would zero the price).
    expect(bd.marginFactor).toBe(1);
  });
});

describe('component formula mappers', () => {
  it('round-trips component length/width formulas', () => {
    const c: Component = {
      id: 'c1',
      code: 'COM-1',
      name: 'Puerta',
      placement: 'puerta',
      geometry: {
        kind: 'rectangular_board',
        lengthMm: 700,
        widthMm: 300,
        thicknessMm: 18,
        lengthFormula: 'H-3',
        widthFormula: 'W/2-2',
      },
      defaultEdges: [
        { side: 'L1', enabled: true },
        { side: 'L2', enabled: true },
        { side: 'W1', enabled: false },
        { side: 'W2', enabled: false },
      ],
      optionRoles: ['FRENTE'],
      active: true,
    };
    const api = componentToApi(c);
    expect(api.length_formula).toBe('H-3');
    expect(api.width_formula).toBe('W/2-2');
    const round = componentFromApi(api as Record<string, unknown>);
    expect(round.geometry.lengthFormula).toBe('H-3');
    expect(round.geometry.widthFormula).toBe('W/2-2');
  });

  it('round-trips component spatial formulas and rotates', () => {
    const c: Component = {
      id: 'c-spatial',
      code: 'LAT',
      name: 'Lateral',
      placement: 'lateral_izquierdo',
      geometry: {
        kind: 'rectangular_board',
        lengthMm: 720,
        widthMm: 560,
        thicknessMm: 18,
        lengthFormula: 'PH',
        widthFormula: 'PD',
      },
      defaultEdges: [],
      optionRoles: ['INTERIOR'],
      active: true,
      xFormula: '0',
      yFormula: 'T',
      zFormula: 'PH/2',
      rotateX: 90,
      rotateY: 90,
      rotateZ: 0,
    };
    const api = componentToApi(c);
    expect(api.x_formula).toBe('0');
    expect(api.y_formula).toBe('T');
    expect(api.z_formula).toBe('PH/2');
    expect(api.rotate_x).toBe(90);
    expect(api.rotate_y).toBe(90);
    const round = componentFromApi(api as Record<string, unknown>);
    expect(round.xFormula).toBe('0');
    expect(round.yFormula).toBe('T');
    expect(round.zFormula).toBe('PH/2');
    expect(round.rotateX).toBe(90);
    expect(round.rotateY).toBe(90);
    expect(round.rotateZ).toBe(0);
  });

  it('round-trips module component instance formula overrides', () => {
    const mod: Module = {
      id: 'mod1',
      code: 'GAB-01',
      name: 'Gab',
      structureId: 'struct-1',
      components: [
        {
          componentId: 'comp-1',
          quantity: 1,
          placementOverride: 'puerta',
          overrides: {
            lengthFormula: 'H-5',
            widthFormula: 'W-10',
            xFormula: 'T',
            zFormula: '100',
            rotateY: 0,
          },
        },
      ],
      hardwareLines: [],
    };
    const api = moduleToApi(mod);
    const comps = api.components as Record<string, unknown>[];
    expect(comps[0]?.length_formula).toBe('H-5');
    expect(comps[0]?.x_formula).toBe('T');
    const round = moduleFromApi(api as Record<string, unknown>);
    expect(round.components?.[0]?.overrides?.lengthFormula).toBe('H-5');
    expect(round.components?.[0]?.overrides?.widthFormula).toBe('W-10');
    expect(round.components?.[0]?.overrides?.xFormula).toBe('T');
    expect(round.components?.[0]?.overrides?.zFormula).toBe('100');
    expect(round.components?.[0]?.overrides?.rotateY).toBe(0);
  });
});
