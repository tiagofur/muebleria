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
} from './apiMappers';
import type { MaterialBoard, Module, ModuleCategory, Project } from '@muebles/domain';

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

  it('maps module boardParts to board_parts with length_mm', () => {
    const mod: Module = {
      id: 'mod1',
      code: 'GAB-01',
      name: 'Gab',
      categoryId: 'cat1',
      baseLaborCost: 50,
      boardParts: [
        {
          id: 'p1',
          description: 'Lateral',
          quantity: 2,
          lengthMm: 720,
          widthMm: 500,
          edges: [{ side: 'L1', enabled: true }],
          optionRole: 'INTERIOR',
        },
      ],
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
    const parts = api.board_parts as Record<string, unknown>[];
    expect(parts[0]?.length_mm).toBe(720);
    expect(parts[0]?.option_role).toBe('INTERIOR');
    const lines = api.hardware_lines as Record<string, unknown>[];
    expect(lines[0]?.hardware_id).toBe('hw1');

    const round = moduleFromApi(api as Record<string, unknown>);
    expect(round.boardParts[0]?.lengthMm).toBe(720);
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
});
