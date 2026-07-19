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
  projectTemplateToApi,
  projectTemplateFromApi,
  breakdownFromApi,
  componentToApi,
  componentFromApi,
  structureToApi,
  structureFromApi,
} from './apiMappers';
import type {
  Component,
  MaterialBoard,
  Module,
  ModuleCategory,
  Project,
  ProjectTemplate,
  Structure,
} from '@muebles/domain';

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

  it('round-trips module furnitureType (snake + camel read) (#109)', () => {
    const mod: Module = {
      id: 'mod1',
      code: 'ALA-01',
      name: 'Alacena',
      furnitureType: 'superior',
      hardwareLines: [],
    };
    const api = moduleToApi(mod);
    expect(api.furniture_type).toBe('superior');
    const round = moduleFromApi(api as Record<string, unknown>);
    expect(round.furnitureType).toBe('superior');

    // camelCase read path (legacy / JS shell) — snake key absent
    const { furniture_type: _omit, ...apiNoSnake } = api as Record<string, unknown>;
    const camel = moduleFromApi({ ...apiNoSnake, furnitureType: 'alto' });
    expect(camel.furnitureType).toBe('alto');

    // Invalid value → undefined (treated as legacy inferior)
    const invalid = moduleFromApi({
      id: 'x',
      code: 'X',
      name: 'X',
      furniture_type: 'bogus',
      hardware_lines: [],
    } as Record<string, unknown>);
    expect(invalid.furnitureType).toBeUndefined();
  });

  it('round-trips project measureDefaults keyed by furnitureType (#109)', () => {
    const p: Project = {
      id: 'pr1',
      name: 'Cotiz',
      customerId: 'c1',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      measureDefaults: {
        inferior: { depth: 560, height: 720 },
        superior: { depth: 320 },
      },
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const api = projectToApi(p);
    expect(api.measure_defaults).toEqual({
      inferior: { depth: 560, height: 720 },
      superior: { depth: 320 },
    });
    const round = projectFromApi(api as Record<string, unknown>);
    expect(round.measureDefaults).toEqual({
      inferior: { depth: 560, height: 720 },
      superior: { depth: 320 },
    });
  });

  it('omits measure_defaults when empty and reads camelCase (#109)', () => {
    const p: Project = {
      id: 'pr1',
      name: 'Cotiz',
      customerId: 'c1',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(projectToApi(p).measure_defaults).toBeNull();
    expect(projectFromApi({ ...p }).measureDefaults).toBeUndefined();

    // camelCase read + partial dims (only height)
    const fromCamel = projectFromApi({
      ...p,
      measureDefaults: { alto: { height: 2100 } },
    } as Record<string, unknown>);
    expect(fromCamel.measureDefaults).toEqual({ alto: { height: 2100 } });

    // zero/negative dims are dropped (treated as unset)
    const zeroDropped = projectFromApi({
      ...p,
      measure_defaults: { inferior: { depth: 0, height: 720 } },
    } as Record<string, unknown>);
    expect(zeroDropped.measureDefaults).toEqual({ inferior: { height: 720 } });
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

  it('round-trips structure revision + history (#108)', () => {
    const st: Structure = {
      id: 's1',
      code: 'EST-1',
      name: 'Body',
      externalDims: { width: 600, height: 720, depth: 560 },
      revision: 3,
      history: [
        {
          revision: 2,
          code: 'EST-1',
          name: 'Body v2',
          externalDims: { width: 600, height: 700, depth: 560 },
        },
        {
          revision: 1,
          code: 'EST-1',
          name: 'Body v1',
        },
      ],
      active: true,
    };
    const api = structureToApi(st);
    expect(api.revision).toBe(3);
    const history = api.history as Record<string, unknown>[];
    expect(history).toHaveLength(2);
    expect(history[0]?.revision).toBe(2);
    expect(history[0]?.width_mm).toBe(600);
    expect(history[0]?.height_mm).toBe(700);
    expect(history[1]?.revision).toBe(1);

    const round = structureFromApi(api as Record<string, unknown>);
    expect(round.revision).toBe(3);
    expect(round.history).toHaveLength(2);
    expect(round.history?.[0]?.revision).toBe(2);
    expect(round.history?.[0]?.externalDims?.height).toBe(700);
    expect(round.history?.[1]?.name).toBe('Body v1');
  });

  it('structureToApi defaults missing revision to 1 (#108 legacy payloads)', () => {
    // Legacy structures that never carried a revision must be emitted as
    // revision: 1 so the Go backend never sees a zero revision.
    const st: Structure = {
      id: 's-legacy',
      code: 'EST-OLD',
      name: 'Legacy',
      active: true,
    };
    const api = structureToApi(st);
    expect(api.revision).toBe(1);
    expect(api.history).toEqual([]);
  });

  it('structureFromApi defaults missing revision/history safely (#108)', () => {
    const round = structureFromApi({
      id: 's2',
      code: 'EST-2',
      name: 'Body',
      // no revision, no history — must default, never throw
    });
    expect(round.revision).toBe(1);
    expect(round.history).toBeUndefined();
  });

  it('round-trips project item structureRevisionPin (#108)', () => {
    const p: Project = {
      id: 'pr-pin',
      name: 'Cotiz',
      customerId: 'c1',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'quoted',
      items: [
        {
          id: 'i-pinned',
          moduleId: 'm1',
          quantity: 1,
          optionChoices: {},
          structureRevisionPin: 3,
        },
        {
          id: 'i-live',
          moduleId: 'm2',
          quantity: 1,
          optionChoices: {},
          // no pin — live revision
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const api = projectToApi(p);
    const items = api.items as Record<string, unknown>[];
    expect(items[0]?.structure_revision_pin).toBe(3);
    // Unpinned → null on the wire (nullable number, not undefined).
    expect(items[1]?.structure_revision_pin).toBeNull();

    const round = projectFromApi(api as Record<string, unknown>);
    expect(round.items[0]?.structureRevisionPin).toBe(3);
    expect(round.items[1]?.structureRevisionPin).toBeUndefined();
  });

  it('projectFromApi tolerates null/absent structure_revision_pin (#108)', () => {
    // Go backend emits `null` for the nullable column; older payloads omit it.
    const fromNull = projectFromApi({
      id: 'p',
      name: 'n',
      customer_id: 'c',
      currency: 'MXN',
      margin_factor: 1.35,
      labor_fixed_cost: 0,
      status: 'draft',
      items: [
        {
          id: 'i',
          module_id: 'm',
          quantity: 1,
          option_choices: {},
          structure_revision_pin: null,
        },
      ],
    });
    expect(fromNull.items[0]?.structureRevisionPin).toBeUndefined();
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

describe('apiMappers — project templates (#110)', () => {
  it('round-trips ProjectTemplate with items + kitchenLayout + measureDefaults', () => {
    const t: ProjectTemplate = {
      id: 'tmpl-1',
      name: 'Cocina estándar 3 m',
      currency: 'MXN',
      marginFactor: 1.4,
      laborFixedCost: 100,
      items: [
        {
          id: 'ti-1',
          moduleId: 'mod-gab',
          quantity: 2,
          optionChoices: { INTERIOR: 'mat-a' },
          measurePresetId: 'preset-560',
        },
      ],
      projectLevelChoices: { INTERIOR: 'mat-a' },
      measureDefaults: { inferior: { depth: 560, height: 720 } },
      kitchenLayout: {
        walls: [
          { id: 'w1', lengthMm: 3000, angleDeg: 0 },
        ],
        placements: [
          {
            itemId: 'ti-1',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 0,
            elevation: 'floor',
          },
        ],
      },
      installationChecklist: [
        { id: 'c1', label: 'Verificar', done: false },
      ],
      notes: 'Template de cocina',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    const api = projectTemplateToApi(t);
    expect(api.name).toBe('Cocina estándar 3 m');
    expect(api.margin_factor).toBe(1.4);
    expect(api.measure_defaults).toEqual({
      inferior: { depth: 560, height: 720 },
    });
    expect(api.kitchen_layout).not.toBeNull();
    // Items carry no structure_revision_pin (templates never pin).
    const items = api.items as Record<string, unknown>[];
    expect(items[0]!.module_id).toBe('mod-gab');
    expect('structure_revision_pin' in items[0]!).toBe(false);

    const round = projectTemplateFromApi(api as Record<string, unknown>);
    expect(round.id).toBe('tmpl-1');
    expect(round.name).toBe('Cocina estándar 3 m');
    expect(round.items).toHaveLength(1);
    expect(round.items[0]!.moduleId).toBe('mod-gab');
    expect(round.items[0]!.measurePresetId).toBe('preset-560');
    expect(round.measureDefaults).toEqual({
      inferior: { depth: 560, height: 720 },
    });
    expect(round.kitchenLayout?.placements[0]!.itemId).toBe('ti-1');
    expect(round.installationChecklist).toEqual([
      { id: 'c1', label: 'Verificar', done: false },
    ]);
  });

  it('omits optionals cleanly and reads camelCase', () => {
    const api = projectTemplateToApi({
      id: 'tmpl-2',
      name: 'Vacía',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      items: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(api.kitchen_layout).toBeNull();
    expect(api.measure_defaults).toBeNull();
    expect(api.installation_checklist).toBeNull();
    expect(api.project_level_choices).toEqual({});

    const round = projectTemplateFromApi(api as Record<string, unknown>);
    expect(round.kitchenLayout).toBeUndefined();
    expect(round.measureDefaults).toBeUndefined();
    expect(round.installationChecklist).toBeUndefined();
    expect(round.projectLevelChoices).toBeUndefined();
    expect(round.items).toEqual([]);
  });

  it('dual-reads snake/camel keys', () => {
    const fromCamel = projectTemplateFromApi({
      id: 't3',
      name: 'X',
      currency: 'MXN',
      marginFactor: 1.5,
      laborFixedCost: 200,
      items: [],
      measureDefaults: { alto: { height: 2100 } },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    } as Record<string, unknown>);
    expect(fromCamel.measureDefaults).toEqual({ alto: { height: 2100 } });
    expect(fromCamel.marginFactor).toBe(1.5);
  });
});
