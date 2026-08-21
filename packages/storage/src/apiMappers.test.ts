import { describe, expect, it } from 'vitest';
import {
  ambientCategoryFromApi,
  ambientCategoryToApi,
  ambientMaterialFromApi,
  ambientMaterialToApi,
  edgeFromApi,
  edgeToApi,
  catalogFromApi,
  hardwareToApi,
  hardwareFromApi,
  materialToApi,
  materialFromApi,
  moduleToApi,
  moduleFromApi,
  categoryToApi,
  sortCategoriesForSave,
  projectToApi,
  projectFromApi,
  projectEventToApi,
  projectEventFromApi,
  designRevisionToApi,
  designRevisionFromApi,
  approvalToApi,
  approvalFromApi,
  productionReleaseToApi,
  productionReleaseFromApi,
  changeOrderToApi,
  changeOrderFromApi,
  projectTemplateToApi,
  projectTemplateFromApi,
  breakdownFromApi,
  componentToApi,
  componentFromApi,
  structureToApi,
  structureFromApi,
  workshopSettingsToApi,
  workshopSettingsFromApi,
} from './apiMappers';
import type {
  AmbientCategory,
  AmbientMaterial,
  CommercialStatus,
  EdgeBand,
  Component,
  Hardware,
  MaterialBoard,
  Module,
  ModuleCategory,
  Project,
  ProjectEvent,
  DesignRevision,
  Approval,
  ProductionRelease,
  ChangeOrder,
  PartInstance,
  ModuleUnitExecution,
  ProjectTemplate,
  Structure,
} from '@muebles/domain';

describe('apiMappers', () => {
  it('round-trips edge preview color', () => {
    const edge: EdgeBand = {
      id: 'e1', code: 'CAN-BLA', name: 'Blanco', thicknessMm: 1,
      costPerMl: 2, previewColor: '#F5F5F0', active: true,
    };
    const api = edgeToApi(edge);
    expect(api.preview_color).toBe('#F5F5F0');
    expect(edgeFromApi(api)).toMatchObject({ previewColor: '#F5F5F0' });
  });

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

  it('round-trips PBR finish properties (roughness, metalness, clearcoat)', () => {
    const m: MaterialBoard = {
      id: 'm-pbr',
      code: 'TAB-GLOSS',
      name: 'Blanco Alto Brillo',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 18,
      grainDefault: false,
      boardPrice: 150,
      wastePercent: 10,
      costPerM2: 35,
      previewColor: '#ffffff',
      previewRoughness: 0.08,
      previewMetalness: 0.1,
      previewClearcoat: 0.85,
      active: true,
    };
    const api = materialToApi(m);
    expect(api.preview_roughness).toBe(0.08);
    expect(api.preview_metalness).toBe(0.1);
    expect(api.preview_clearcoat).toBe(0.85);

    const round = materialFromApi(api as Record<string, unknown>);
    expect(round.previewRoughness).toBe(0.08);
    expect(round.previewMetalness).toBe(0.1);
    expect(round.previewClearcoat).toBe(0.85);

    // Test zero values are preserved (e.g. 0 roughness for perfect mirror)
    const mZero: MaterialBoard = {
      ...m,
      previewRoughness: 0,
      previewMetalness: 0,
      previewClearcoat: 0,
    };
    const roundZero = materialFromApi(materialToApi(mZero) as Record<string, unknown>);
    expect(roundZero.previewRoughness).toBe(0);
    expect(roundZero.previewMetalness).toBe(0);
    expect(roundZero.previewClearcoat).toBe(0);
  });

  it('round-trips texture tile size X/Y mm', () => {
    const m: MaterialBoard = {
      id: 'm2',
      code: 'MAD-1',
      name: 'Maderado',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 120,
      wastePercent: 8,
      costPerM2: 30,
      previewTextureUrl: '/api/media/wood.webp',
      previewTextureTileWidthMm: 400,
      previewTextureTileLengthMm: 600,
      active: true,
    };
    const api = materialToApi(m);
    expect(api.preview_texture_tile_width_mm).toBe(400);
    expect(api.preview_texture_tile_length_mm).toBe(600);
    expect(materialFromApi(api as Record<string, unknown>)).toMatchObject({
      previewTextureUrl: '/api/media/wood.webp',
      previewTextureTileWidthMm: 400,
      previewTextureTileLengthMm: 600,
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

  it('round-trips structure component spatial overrides (slice 3)', () => {
    const st: Structure = {
      id: 's1',
      code: 'EST-01',
      name: 'Cuerpo',
      components: [
        {
          componentId: 'lat-1',
          quantity: 1,
          placementOverride: 'lateral_izquierdo',
          overrides: {
            xFormula: '0',
            yFormula: '0',
            zFormula: '0',
            lengthFormula: 'PH',
            widthFormula: 'PD',
            rotateX: 90,
            rotateY: 180,
            rotateZ: 90,
          },
        },
      ],
    };
    const api = structureToApi(st);
    const comps = api.components as Record<string, unknown>[];
    expect(comps[0]?.overrides).toMatchObject({
      xFormula: '0',
      lengthFormula: 'PH',
      rotateX: 90,
      rotateY: 180,
      rotateZ: 90,
    });
    const round = structureFromApi(api as Record<string, unknown>);
    expect(round.components?.[0]?.overrides).toEqual({
      edges: undefined,
      notes: undefined,
      lengthFormula: 'PH',
      widthFormula: 'PD',
      xFormula: '0',
      yFormula: '0',
      zFormula: '0',
      rotateX: 90,
      rotateY: 180,
      rotateZ: 90,
    });
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

  it('round-trips module baseMode + baseClearanceMm (zoclo)', () => {
    const mod: Module = {
      id: 'mod-z',
      code: 'BAJO-Z',
      name: 'Bajo con zoclo',
      furnitureType: 'inferior',
      baseMode: 'plinth_board',
      baseClearanceMm: 120,
      hardwareLines: [],
    };
    const api = moduleToApi(mod);
    expect(api.base_mode).toBe('plinth_board');
    expect(api.base_clearance_mm).toBe(120);
    const round = moduleFromApi(api as Record<string, unknown>);
    expect(round.baseMode).toBe('plinth_board');
    expect(round.baseClearanceMm).toBe(120);
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

  it('round-trips kitchen plan underlay', () => {
    const p: Project = {
      id: 'pr-underlay',
      name: 'Con plano',
      customerId: 'c1',
      currency: 'UYU',
      marginFactor: 1.5,
      laborFixedCost: 0,
      status: 'draft',
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
        underlay: {
          imageUrl: '/api/media/plan.png',
          widthMm: 5000,
          heightMm: 4000,
          originXMm: 0,
          originYMm: 0,
          opacity: 0.4,
          fileName: 'plan.png',
        },
      },
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const api = projectToApi(p);
    const kl = api.kitchen_layout as Record<string, unknown>;
    const u = kl.underlay as Record<string, unknown>;
    expect(u.image_url).toBe('/api/media/plan.png');
    expect(u.width_mm).toBe(5000);
    const round = projectFromApi(api as Record<string, unknown>);
    expect(round.kitchenLayout?.underlay?.imageUrl).toBe('/api/media/plan.png');
    expect(round.kitchenLayout?.underlay?.heightMm).toBe(4000);
  });

  it('round-trips multi-space kitchen layouts', () => {
    const p: Project = {
      id: 'pr-multi',
      name: 'Cocina + Baño',
      customerId: 'c1',
      currency: 'UYU',
      marginFactor: 1.5,
      laborFixedCost: 0,
      status: 'draft',
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [
          {
            itemId: 'i1',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 0,
            elevation: 'floor',
          },
        ],
        activeSpaceId: 'sp-cocina',
        spaces: [
          {
            id: 'sp-cocina',
            name: 'Cocina',
            walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
            placements: [
              {
                itemId: 'i1',
                instanceIndex: 0,
                wallId: 'w1',
                offsetMm: 0,
                elevation: 'floor',
              },
            ],
          },
          {
            id: 'sp-bath',
            name: 'Baño',
            walls: [{ id: 'wb', lengthMm: 2000, angleDeg: 0 }],
            placements: [
              {
                itemId: 'i2',
                instanceIndex: 0,
                wallId: 'wb',
                offsetMm: 100,
                elevation: 'floor',
              },
            ],
          },
        ],
      },
      items: [
        { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
        { id: 'i2', moduleId: 'm1', quantity: 1, optionChoices: {} },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const api = projectToApi(p);
    const kl = api.kitchen_layout as Record<string, unknown>;
    expect(kl.active_space_id).toBe('sp-cocina');
    const spaces = kl.spaces as Record<string, unknown>[];
    expect(spaces).toHaveLength(2);
    expect(spaces[1]!.name).toBe('Baño');

    const round = projectFromApi(api as Record<string, unknown>);
    expect(round.kitchenLayout?.spaces).toHaveLength(2);
    expect(round.kitchenLayout?.spaces?.[1]?.placements[0]?.itemId).toBe('i2');
    expect(round.kitchenLayout?.activeSpaceId).toBe('sp-cocina');
  });

  it('round-trips free-place (island) kitchen placements', () => {
    const p: Project = {
      id: 'pr-free',
      name: 'Con isla',
      customerId: 'c1',
      currency: 'UYU',
      marginFactor: 1.5,
      laborFixedCost: 0,
      status: 'draft',
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [
          {
            itemId: 'i1',
            instanceIndex: 0,
            wallId: '',
            offsetMm: 0,
            elevation: 'floor',
            mode: 'free',
            freeXMm: 1400,
            freeYMm: 1100,
            freeYawDeg: 90,
          },
        ],
      },
      items: [
        {
          id: 'i1',
          moduleId: 'm1',
          quantity: 1,
          optionChoices: {},
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const api = projectToApi(p);
    const kl = api.kitchen_layout as Record<string, unknown>;
    const placements = kl.placements as Record<string, unknown>[];
    expect(placements[0]!.mode).toBe('free');
    expect(placements[0]!.free_x_mm).toBe(1400);
    expect(placements[0]!.free_y_mm).toBe(1100);
    expect(placements[0]!.free_yaw_deg).toBe(90);

    const round = projectFromApi(api as Record<string, unknown>);
    const free = round.kitchenLayout?.placements[0];
    expect(free?.mode).toBe('free');
    expect(free?.freeXMm).toBe(1400);
    expect(free?.freeYMm).toBe(1100);
    expect(free?.freeYawDeg).toBe(90);
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

  it('round-trips project item baseMode (F087)', () => {
    const p: Project = {
      id: 'pr-base',
      name: 'Cotiz',
      customerId: 'c1',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i-strip',
          moduleId: 'm1',
          quantity: 1,
          optionChoices: {},
          baseMode: 'plinth_strip',
        },
        {
          id: 'i-default',
          moduleId: 'm2',
          quantity: 1,
          optionChoices: {},
          // no baseMode — module default
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const api = projectToApi(p);
    const items = api.items as Record<string, unknown>[];
    expect(items[0]?.base_mode).toBe('plinth_strip');
    // No override → '' on the wire (module default).
    expect(items[1]?.base_mode).toBe('');

    const round = projectFromApi(api as Record<string, unknown>);
    expect(round.items[0]?.baseMode).toBe('plinth_strip');
    expect(round.items[1]?.baseMode).toBeUndefined();
  });

  it('projectFromApi rejects unknown base_mode values (F087)', () => {
    const round = projectFromApi({
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
          base_mode: 'floating',
        },
      ],
    });
    expect(round.items[0]?.baseMode).toBeUndefined();
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

describe('ambient material + kitchen space refs mappers (#4150)', () => {
  it('round-trips an AmbientMaterial with all preview fields', () => {
    const m: AmbientMaterial = {
      id: 'amb-1',
      code: 'CERAM-1',
      name: 'Cerámica blanca',
      active: true,
      surfaceType: 'floor',
      previewColor: '#eeeeee',
      previewTextureUrl: '/api/media/ceram.webp',
      previewTextureTileWidthMm: 400,
      previewTextureTileLengthMm: 400,
      previewRoughness: 0.6,
      previewMetalness: 0.1,
      previewClearcoat: 0.2,
    };
    const api = ambientMaterialToApi(m);
    // snake_case emission (spec #4150)
    expect(api.surface_type).toBe('floor');
    expect(api.preview_color).toBe('#eeeeee');
    expect(api.preview_texture_url).toBe('/api/media/ceram.webp');
    expect(api.preview_texture_tile_width_mm).toBe(400);
    expect(api.preview_roughness).toBe(0.6);
    expect(api.preview_clearcoat).toBe(0.2);

    const round = ambientMaterialFromApi(api as Record<string, unknown>);
    expect(round).toEqual(m);
  });

  it('emits null for omitted preview fields and round-trips to undefined', () => {
    const m: AmbientMaterial = {
      id: 'amb-2',
      code: 'PINT-N',
      name: 'Pared neutra',
      active: false,
      surfaceType: 'wall',
    };
    const api = ambientMaterialToApi(m);
    expect(api.preview_color).toBeNull();
    expect(api.preview_texture_tile_width_mm).toBeNull();
    expect(api.preview_roughness).toBeNull();

    expect(ambientMaterialFromApi(api as Record<string, unknown>)).toEqual(m);
  });

  it('preserves previewRoughness === 0 (valid value, not undefined)', () => {
    const m: AmbientMaterial = {
      id: 'amb-0',
      code: 'GLOSS',
      name: 'Gloss',
      active: true,
      surfaceType: 'wall',
      previewRoughness: 0,
    };
    const round = ambientMaterialFromApi(
      ambientMaterialToApi(m) as Record<string, unknown>,
    );
    expect(round.previewRoughness).toBe(0);
  });

  it('accepts camelCase keys on read (dual-key in)', () => {
    const round = ambientMaterialFromApi({
      id: 'amb-3',
      code: 'WOOD-1',
      name: 'Madera',
      active: true,
      surfaceType: 'floor',
      previewColor: '#3a2a1a',
      previewTextureTileWidthMm: 200,
    });
    expect(round.surfaceType).toBe('floor');
    expect(round.previewColor).toBe('#3a2a1a');
    expect(round.previewTextureTileWidthMm).toBe(200);
  });

  it('catalogFromApi composes ambientMaterials from the part payload', () => {
    const cat = catalogFromApi({
      materials: [],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
      ambientMaterials: [
        {
          id: 'amb-x',
          code: 'C',
          name: 'Cotto',
          active: true,
          surface_type: 'floor',
          preview_color: '#aa8866',
        },
      ],
    });
    expect(cat.ambientMaterials).toHaveLength(1);
    expect(cat.ambientMaterials?.[0]?.surfaceType).toBe('floor');
    expect(cat.ambientMaterials?.[0]?.previewColor).toBe('#aa8866');
  });

  it('catalogFromApi also reads the snake ambient_materials part key', () => {
    const cat = catalogFromApi({
      materials: [],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
      ambient_materials: [
        { id: 'a', code: 'X', name: 'Y', active: true, surface_type: 'wall' },
      ],
    });
    expect(cat.ambientMaterials).toHaveLength(1);
    expect(cat.ambientMaterials?.[0]?.surfaceType).toBe('wall');
  });

  it('catalogFromApi resolves ambientMaterials to [] on legacy payloads', () => {
    const cat = catalogFromApi({
      materials: [],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
    });
    expect(cat.ambientMaterials).toEqual([]);
    expect(cat.ambientCategories).toEqual([]);
  });

  it('ambientCategoryToApi and ambientCategoryFromApi round-trip correctly', () => {
    const c: AmbientCategory = {
      id: 'cat-1',
      name: 'Maderas',
      parentId: 'root-cat',
      sortOrder: 2,
    };
    const api = ambientCategoryToApi(c);
    expect(api.id).toBe('cat-1');
    expect(api.name).toBe('Maderas');
    expect(api.parent_id).toBe('root-cat');
    expect(api.sort_order).toBe(2);

    const round = ambientCategoryFromApi(api as Record<string, unknown>);
    expect(round).toEqual(c);
  });

  it('ambientMaterialToApi and fromApi preserve categoryId', () => {
    const m: AmbientMaterial = {
      id: 'mat-c',
      code: 'WOOD-OAK',
      name: 'Roble Claro',
      active: true,
      surfaceType: 'floor',
      categoryId: 'cat-wood',
    };
    const api = ambientMaterialToApi(m);
    expect(api.category_id).toBe('cat-wood');

    const round = ambientMaterialFromApi(api as Record<string, unknown>);
    expect(round.categoryId).toBe('cat-wood');
    expect(round).toEqual(m);
  });

  it('catalogFromApi composes ambientCategories from payload', () => {
    const cat = catalogFromApi({
      materials: [],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
      ambient_categories: [
        { id: 'ac-1', name: 'Metales', sort_order: 1 },
      ],
    });
    expect(cat.ambientCategories).toHaveLength(1);
    expect(cat.ambientCategories?.[0]?.name).toBe('Metales');
  });

  it('round-trips kitchen space ambient refs (floor/wall/showCeiling)', () => {
    const p: Project = {
      id: 'pr-amb',
      name: 'Cocina con piso',
      customerId: 'c1',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
        activeSpaceId: 'sp-1',
        spaces: [
          {
            id: 'sp-1',
            name: 'Cocina',
            walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0, wallMaterialId: 'amb-wall-accent' }],
            placements: [],
            floorMaterialId: 'amb-floor',
            wallMaterialId: 'amb-wall',
            ceilingMaterialId: 'amb-ceiling',
            countertopMaterialId: 'amb-countertop',
            showCeiling: true,
          },
        ],
      },
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const api = projectToApi(p);
    const kl = api.kitchen_layout as Record<string, unknown>;
    const space = (kl.spaces as Record<string, unknown>[])[0]!;
    const wall1 = (space.walls as Record<string, unknown>[])[0]!;
    expect(space.floor_material_id).toBe('amb-floor');
    expect(space.wall_material_id).toBe('amb-wall');
    expect(space.ceiling_material_id).toBe('amb-ceiling');
    expect(space.countertop_material_id).toBe('amb-countertop');
    expect(space.show_ceiling).toBe(true);
    expect(wall1.wall_material_id).toBe('amb-wall-accent');

    const round = projectFromApi(api as Record<string, unknown>);
    expect(round.kitchenLayout?.spaces?.[0]?.floorMaterialId).toBe('amb-floor');
    expect(round.kitchenLayout?.spaces?.[0]?.wallMaterialId).toBe('amb-wall');
    expect(round.kitchenLayout?.spaces?.[0]?.ceilingMaterialId).toBe('amb-ceiling');
    expect(round.kitchenLayout?.spaces?.[0]?.countertopMaterialId).toBe('amb-countertop');
    expect(round.kitchenLayout?.spaces?.[0]?.showCeiling).toBe(true);
    expect(round.kitchenLayout?.spaces?.[0]?.walls[0]?.wallMaterialId).toBe('amb-wall-accent');
  });

  it('legacy kitchen layout without ambient refs loads as undefined (no crash)', () => {
    const p: Project = {
      id: 'pr-legacy',
      name: 'Legacy',
      customerId: 'c1',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
        spaces: [
          {
            id: 'sp-1',
            name: 'Cocina',
            walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
            placements: [],
          },
        ],
      },
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const round = projectFromApi(projectToApi(p) as Record<string, unknown>);
    expect(round.kitchenLayout?.spaces?.[0]?.floorMaterialId).toBeUndefined();
    expect(round.kitchenLayout?.spaces?.[0]?.wallMaterialId).toBeUndefined();
    expect(round.kitchenLayout?.spaces?.[0]?.countertopMaterialId).toBeUndefined();
    expect(round.kitchenLayout?.spaces?.[0]?.showCeiling).toBeUndefined();
  });

  it('structureToApi and structureFromApi preserve agregados roundtrip', () => {
    const st: Structure = {
      id: 'st-caj',
      code: 'EST-CAJ',
      name: 'Estructura con Cajones',
      components: [],
      agregados: [
        {
          id: 'inst-1',
          agregadoId: 'agr-caj-3',
          name: 'Columna de 3 Cajones',
          quantity: 3,
          layoutDirection: 'vertical',
          gapMm: 3,
          position: { zFormula: '100' },
          dimensions: { widthFormula: 'W - 36', heightFormula: '600' },
          mirrored: true,
          optionOverrides: { PLACA: 'mat-mdf' },
        },
      ],
    };

    const api = structureToApi(st);
    expect(api.agregados).toHaveLength(1);

    const round = structureFromApi(api);
    expect(round.agregados).toHaveLength(1);
    expect(round.agregados![0]!.agregadoId).toBe('agr-caj-3');
    expect(round.agregados![0]!.quantity).toBe(3);
    expect(round.agregados![0]!.layoutDirection).toBe('vertical');
    expect(round.agregados![0]!.gapMm).toBe(3);
    expect(round.agregados![0]!.mirrored).toBe(true);
    expect(round.agregados![0]!.position?.zFormula).toBe('100');
    expect(round.agregados![0]!.dimensions?.widthFormula).toBe('W - 36');
    expect(round.agregados![0]!.optionOverrides).toEqual({ PLACA: 'mat-mdf' });
  });
});

describe('hardwareToApi / hardwareFromApi — PBR round-trip (F069)', () => {
  it('round-trips preview fields (shape + PBR)', () => {
    const hw: Hardware = {
      id: 'hw-1',
      code: 'HW-KNOB',
      name: 'Jaladera cromada',
      unit: 'piece',
      costPerUnit: 5,
      active: true,
      previewShape: 'knob',
      previewColor: '#c0c0c0',
      previewSizeMm: 28,
      previewDiameterMm: 28,
      previewProjectionMm: 25,
      previewRoughness: 0.15,
      previewMetalness: 0.9,
      previewClearcoat: 0.8,
    };
    const api = hardwareToApi(hw);
    expect(api.preview_shape).toBe('knob');
    expect(api.preview_color).toBe('#c0c0c0');
    expect(api.preview_metalness).toBe(0.9);
    expect(api.preview_clearcoat).toBe(0.8);

    const round = hardwareFromApi(api as Record<string, unknown>);
    expect(round.previewShape).toBe('knob');
    expect(round.previewColor).toBe('#c0c0c0');
    expect(round.previewMetalness).toBe(0.9);
    expect(round.previewClearcoat).toBe(0.8);
    expect(round.previewRoughness).toBe(0.15);
  });

  it('preserves PBR value 0 (not undefined)', () => {
    const hw: Hardware = {
      id: 'hw-2',
      code: 'HW-BLACK',
      name: 'Negro mate',
      unit: 'piece',
      costPerUnit: 3,
      active: true,
      previewShape: 'bar-pull',
      previewColor: '#1a1a1a',
      previewMetalness: 0.1,
      previewRoughness: 0.7,
      previewClearcoat: 0,
    };
    const round = hardwareFromApi(hardwareToApi(hw) as Record<string, unknown>);
    expect(round.previewClearcoat).toBe(0);
    expect(round.previewMetalness).toBe(0.1);
  });

  it('omits preview fields when absent (backward-compat)', () => {
    const hw: Hardware = {
      id: 'hw-3',
      code: 'HW-PLAIN',
      name: 'Tornillo',
      unit: 'piece',
      costPerUnit: 0.5,
      active: true,
    };
    const round = hardwareFromApi(hardwareToApi(hw) as Record<string, unknown>);
    expect(round.previewShape).toBeUndefined();
    expect(round.previewColor).toBeUndefined();
    expect(round.previewMetalness).toBeUndefined();
  });

  it('rejects invalid shape strings', () => {
    const api = hardwareToApi({
      id: 'hw-4',
      code: 'HW-X',
      name: 'Bad',
      unit: 'piece',
      costPerUnit: 1,
      active: true,
      previewShape: 'ring' as Hardware['previewShape'],
    });
    const round = hardwareFromApi(api as Record<string, unknown>);
    expect(round.previewShape).toBeUndefined();
  });
});

describe('hardwareToApi / hardwareFromApi — part finishes (F080)', () => {
  it('round-trips part finishes (role → preset id)', () => {
    const hw: Hardware = {
      id: 'hw-pf',
      code: 'HW-BAR-MIX',
      name: 'Tirador barra bicolor',
      unit: 'piece',
      costPerUnit: 8,
      active: true,
      previewShape: 'bar-pull',
      previewColor: '#c0c0c0',
      partFinishes: { grip: 'gold', base: 'black-matte' },
    };
    const api = hardwareToApi(hw);
    expect(api.part_finishes).toEqual({ grip: 'gold', base: 'black-matte' });

    const round = hardwareFromApi(api as Record<string, unknown>);
    expect(round.partFinishes).toEqual({ grip: 'gold', base: 'black-matte' });
  });

  it('null part_finishes stays undefined (legacy rows)', () => {
    const round = hardwareFromApi({
      id: 'hw-legacy',
      code: 'HW-L',
      name: 'Legacy',
      unit: 'piece',
      cost_per_unit: 1,
      active: true,
      part_finishes: null,
    });
    expect(round.partFinishes).toBeUndefined();
  });

  it('drops unknown roles and preset ids from the API payload', () => {
    const round = hardwareFromApi({
      id: 'hw-dirty',
      code: 'HW-D',
      name: 'Dirty',
      unit: 'piece',
      cost_per_unit: 1,
      active: true,
      part_finishes: { body: 'chrome', rotor: 'gold', base: 'no-existe' },
    });
    expect(round.partFinishes).toEqual({ body: 'chrome' });
  });
});

describe('hardwareToApi / hardwareFromApi — machining profile (F127)', () => {
  const machinedHw: Hardware = {
    id: 'hw-min',
    code: 'HER-MIN-15',
    name: 'Minifix 15 mm (juego)',
    unit: 'set',
    costPerUnit: 4.5,
    active: true,
    machining: {
      parts: [
        {
          id: 'cam',
          role: 'cam',
          operations: [
            {
              id: 'cam-15',
              kind: 'blind_hole',
              diameterMm: 15,
              depthMm: 13,
              xMm: 0,
              yMm: 0,
              face: 'anchor',
              label: 'Cazuela minifix',
            },
          ],
        },
        {
          id: 'bolt',
          role: 'bolt',
          operations: [
            {
              id: 'bolt-pilot',
              kind: 'screw_pilot',
              diameterMm: 5,
              depthMm: 12,
              xMm: 0,
              yMm: 0,
              face: 'opposite',
            },
          ],
        },
      ],
    },
  };

  it('round-trips the machining footprint through the API shape', () => {
    const api = hardwareToApi(machinedHw);
    expect(api.machining).toEqual(machinedHw.machining);

    const round = hardwareFromApi(api as Record<string, unknown>);
    expect(round.machining).toEqual(machinedHw.machining);
  });

  it('null/absent machining stays undefined (legacy rows)', () => {
    const round = hardwareFromApi({
      id: 'hw-legacy',
      code: 'HW-L2',
      name: 'Legacy',
      unit: 'piece',
      cost_per_unit: 1,
      active: true,
      machining: null,
    });
    expect(round.machining).toBeUndefined();

    const costOnly = hardwareToApi({
      id: 'hw-plain',
      code: 'HW-P',
      name: 'Plain',
      unit: 'piece',
      costPerUnit: 1,
      active: true,
    });
    expect(costOnly.machining).toBeNull();
  });

  it('drops garbage operations from the API payload instead of failing', () => {
    const round = hardwareFromApi({
      id: 'hw-dirty-mach',
      code: 'HW-DM',
      name: 'Dirty machining',
      unit: 'piece',
      cost_per_unit: 1,
      active: true,
      machining: {
        parts: [
          {
            id: 'cup',
            role: 'cup',
            operations: [
              { id: 'ok', kind: 'blind_hole', diameterMm: 35, depthMm: 12.5, xMm: 0, yMm: 0, face: 'anchor' },
              { id: 'bad', kind: 'no-existe', diameterMm: 35, depthMm: 12.5, xMm: 0, yMm: 0, face: 'anchor' },
            ],
          },
          { id: 'empty', role: 'vacio', operations: [] },
        ],
      },
    });
    expect(round.machining).toEqual({
      parts: [
        {
          id: 'cup',
          role: 'cup',
          operations: [
            { id: 'ok', kind: 'blind_hole', diameterMm: 35, depthMm: 12.5, xMm: 0, yMm: 0, face: 'anchor' },
          ],
        },
      ],
    });
  });
});

describe('apiMappers — engineering log round-trip (roadmap-screens 2a.4)', () => {
  const base = {
    id: 'p1',
    name: 'Cocina López',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 100,
    status: 'accepted',
    items: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('serializes the log to snake_case and back', () => {
    const p = {
      ...base,
      engineeringLog: {
        startedBy: 'u1',
        startedAt: '2026-08-17T10:00:00.000Z',
        generatedBy: 'u2',
        generatedAt: '2026-08-17T11:00:00.000Z',
        sentToProductionBy: 'u2',
        sentToProductionAt: '2026-08-17T12:00:00.000Z',
        revision: 2,
      },
    } as unknown as Project;
    const api = projectToApi(p);
    const log = api.engineering_log as Record<string, unknown>;
    expect(log.started_by).toBe('u1');
    expect(log.generated_at).toBe('2026-08-17T11:00:00.000Z');
    expect(log.sent_to_production_by).toBe('u2');
    expect(log.revision).toBe(2);

    const back = projectFromApi(api as Record<string, unknown>);
    expect(back.engineeringLog).toEqual(p.engineeringLog);
  });

  it('serializes the materials release stamp to snake_case and back', () => {
    const p = {
      ...base,
      materialsRelease: {
        releasedBy: 'alm-1',
        releasedAt: '2026-08-18T09:30:00.000Z',
      },
    } as unknown as Project;
    const api = projectToApi(p);
    const release = api.materials_release as Record<string, unknown>;
    expect(release.released_by).toBe('alm-1');
    expect(release.released_at).toBe('2026-08-18T09:30:00.000Z');

    const back = projectFromApi(api as Record<string, unknown>);
    expect(back.materialsRelease).toEqual(p.materialsRelease);
  });

  it('keeps an absent materials release undefined (null on the wire)', () => {
    const p = { ...base } as unknown as Project;
    const api = projectToApi(p);
    expect(api.materials_release).toBeNull();
    expect(projectFromApi(api as Record<string, unknown>).materialsRelease).toBeUndefined();
  });

  it('keeps undefined log absent (null on the wire, undefined back)', () => {
    const p = { ...base } as unknown as Project;
    const api = projectToApi(p);
    expect(api.engineering_log).toBeNull();
    expect(projectFromApi(api as Record<string, unknown>).engineeringLog).toBeUndefined();
  });

  it('drops malformed logs instead of crashing', () => {
    const back = projectFromApi({
      ...base,
      engineering_log: { revision: 0 },
    } as unknown as Record<string, unknown>);
    expect(back.engineeringLog).toBeUndefined();
  });
});

describe('workshopSettingsToApi / workshopSettingsFromApi — cut strategy (F133)', () => {
  it('round-trips cnc-nesting through snake_case', () => {
    const base = workshopSettingsFromApi({});
    const api = workshopSettingsToApi({
      ...base,
      defaultCutStrategy: 'cnc-nesting',
    });
    expect(api.default_cut_strategy).toBe('cnc-nesting');
    expect(workshopSettingsFromApi(api).defaultCutStrategy).toBe('cnc-nesting');
  });

  it('estrategia basura del payload resuelve a sierra al ingerir', () => {
    const round = workshopSettingsFromApi({
      default_cut_strategy: 'laser-cut',
    });
    expect(round.defaultCutStrategy).toBe('saw-guillotine');
  });

  it('sin campo en el payload el default sigue siendo sierra', () => {
    expect(workshopSettingsFromApi({}).defaultCutStrategy).toBe(
      'saw-guillotine',
    );
  });
});

describe('structureToApi / structureFromApi — joint drilling rules (F129)', () => {
  it('round-trips el override de reglas de unión (snake_case JSONB)', () => {
    const st = structureFromApi({
      id: 'st-1',
      code: 'EST-1',
      name: 'Cuerpo',
      revision: 1,
    });
    const withRules = {
      ...st,
      jointDrillingRules: {
        gridMm: 32,
        sideToFloor: { endMarginMm: 80, withDowels: false },
        doorHinge: { systemLineMm: 37, endMarginMm: 120 },
      },
    };
    const api = structureToApi(withRules);
    expect(api.joint_drilling_rules).toEqual(withRules.jointDrillingRules);

    const round = structureFromApi(api as Record<string, unknown>);
    expect(round.jointDrillingRules).toEqual(withRules.jointDrillingRules);
  });

  it('null/ausente = sin override (defaults del taller)', () => {
    const round = structureFromApi({
      id: 'st-2',
      code: 'EST-2',
      name: 'Cuerpo',
      joint_drilling_rules: null,
    });
    expect(round.jointDrillingRules).toBeUndefined();
  });
});

describe('projectEventToApi / projectEventFromApi (OC-010)', () => {
  it('round-trips full project event', () => {
    const ev: ProjectEvent = {
      id: 'evt-1',
      projectId: 'p-1',
      type: 'deposit_received',
      at: '2026-08-20T10:00:00.000Z',
      byUserId: 'u-1',
      source: 'web',
      note: 'Anticipo 50%',
      payload: { amount: 1500, currency: 'USD', reference: 'REC-001' },
    };

    const api = projectEventToApi(ev);
    expect(api.id).toBe('evt-1');
    expect(api.project_id).toBe('p-1');
    expect(api.type).toBe('deposit_received');
    expect(api.by_user_id).toBe('u-1');
    expect(api.payload).toEqual({ amount: 1500, currency: 'USD', reference: 'REC-001' });

    const round = projectEventFromApi(api);
    expect(round).toEqual(ev);
  });

  it('handles optional fields gracefully', () => {
    const raw = {
      id: 'evt-2',
      project_id: 'p-1',
      type: 'quote_created',
      at: '2026-08-20T11:00:00.000Z',
    };
    const ev = projectEventFromApi(raw);
    expect(ev.id).toBe('evt-2');
    expect(ev.projectId).toBe('p-1');
    expect(ev.type).toBe('quote_created');
    expect(ev.source).toBe('web');
    expect(ev.byUserId).toBeUndefined();
    expect(ev.note).toBeUndefined();
    expect(ev.payload).toBeUndefined();
  });
});

describe('projectToApi / projectFromApi — commercialStatus and events (OC-010..OC-011)', () => {
  it('round-trips project with commercialStatus and events stream', () => {
    const p: Project = {
      id: 'p-test',
      name: 'Cocina Integral',
      customerId: 'cust-1',
      currency: 'USD',
      marginFactor: 1.4,
      laborFixedCost: 500,
      status: 'accepted',
      commercialStatus: 'won',
      events: [
        {
          id: 'evt-1',
          projectId: 'p-test',
          type: 'quote_created',
          at: '2026-08-19T09:00:00.000Z',
          source: 'web',
        },
        {
          id: 'evt-2',
          projectId: 'p-test',
          type: 'deposit_received',
          at: '2026-08-20T14:30:00.000Z',
          source: 'web',
          payload: { amount: 2000, currency: 'USD' },
        },
      ],
      items: [],
      createdAt: '2026-08-19T09:00:00.000Z',
      updatedAt: '2026-08-20T14:30:00.000Z',
    };

    const api = projectToApi(p);
    expect(api.commercial_status).toBe('won');
    expect(api.events).toHaveLength(2);

    const round = projectFromApi(api as Record<string, unknown>);
    expect(round.commercialStatus).toBe('won');
    expect(round.events).toHaveLength(2);
    expect(round.events?.[0]?.type).toBe('quote_created');
    expect(round.events?.[1]?.type).toBe('deposit_received');
    expect(round.events?.[1]?.payload).toEqual({ amount: 2000, currency: 'USD' });
  });

  it('handles null / undefined commercialStatus and empty events', () => {
    const raw = {
      id: 'p-simple',
      name: 'Mueble Simple',
      customer_id: 'cust-2',
      status: 'draft',
      commercial_status: null,
      events: [],
    };
    const p = projectFromApi(raw);
    expect(p.commercialStatus).toBeUndefined();
    expect(p.events).toBeUndefined();
  });

  it('round-trips design revisions, approvals, and production release (OC-020..022)', () => {
    const p: Project = {
      id: 'p-full-phase3',
      name: 'Cocina Integral Release',
      customerId: 'cust-99',
      status: 'accepted',
      commercialStatus: 'won',
      currency: 'MXN',
      marginFactor: 1.4,
      laborFixedCost: 800,
      designRevisions: [
        {
          id: 'drev-1',
          projectId: 'p-full-phase3',
          revision: 1,
          name: 'Diseño Inicial',
          bomFingerprint: 'fp_abc123',
          createdBy: 'user-1',
          createdAt: '2026-08-20T10:00:00.000Z',
        },
      ],
      approvals: [
        {
          id: 'appr-1',
          projectId: 'p-full-phase3',
          designRevisionId: 'drev-1',
          type: 'customer',
          status: 'approved',
          notes: 'Firma recibida',
          decidedBy: 'user-1',
          decidedAt: '2026-08-20T11:00:00.000Z',
          createdAt: '2026-08-20T11:00:00.000Z',
        },
      ],
      productionRelease: {
        id: 'rel-1',
        projectId: 'p-full-phase3',
        projectVersion: 2,
        designRevisionId: 'drev-1',
        bomFingerprint: 'fp_abc123',
        releasedBy: 'user-supervisor',
        releasedAt: '2026-08-20T12:00:00.000Z',
        checks: [
          { code: 'commercial_won', label: 'Cotización ganada', passed: true, required: true },
          { code: 'deposit_received', label: 'Anticipo', passed: true, required: true },
        ],
        note: 'Liberado a taller',
      },
      items: [],
      createdAt: '2026-08-19T09:00:00.000Z',
      updatedAt: '2026-08-20T12:00:00.000Z',
    };

    const api = projectToApi(p);
    expect(api.design_revisions).toHaveLength(1);
    expect(api.approvals).toHaveLength(1);
    expect(api.production_release).toBeDefined();

    const round = projectFromApi(api as Record<string, unknown>);
    expect(round.designRevisions).toHaveLength(1);
    expect(round.designRevisions?.[0]?.name).toBe('Diseño Inicial');
    expect(round.designRevisions?.[0]?.bomFingerprint).toBe('fp_abc123');

    expect(round.approvals).toHaveLength(1);
    expect(round.approvals?.[0]?.status).toBe('approved');
    expect(round.approvals?.[0]?.type).toBe('customer');

    expect(round.productionRelease?.id).toBe('rel-1');
    expect(round.productionRelease?.releasedBy).toBe('user-supervisor');
    expect(round.productionRelease?.checks).toHaveLength(2);
    expect(round.productionRelease?.checks[0]?.passed).toBe(true);
  });

  it('round-trips change orders (OC-024)', () => {
    const co: ChangeOrder = {
      id: 'co-101',
      projectId: 'p-full-phase4',
      number: 1,
      status: 'submitted',
      reason: 'Agregar cajón oculto',
      description: 'Cliente solicitó cajón interior en mueble bajo',
      impact: {
        costDelta: 450,
        priceDelta: 750,
        leadTimeDaysDelta: 2,
        scopeDescription: '1 cajón Blum Legrabox extra',
      },
      previousBomFingerprint: 'fp_prev_123',
      newBomFingerprint: 'fp_new_456',
      requestedBy: 'user-designer',
      requestedAt: '2026-08-20T15:00:00.000Z',
      createdAt: '2026-08-20T15:00:00.000Z',
    };

    const p: Project = {
      id: 'p-full-phase4',
      name: 'Cocina OC',
      customerId: 'cust-10',
      status: 'accepted',
      currency: 'USD',
      marginFactor: 1.35,
      laborFixedCost: 600,
      changeOrders: [co],
      items: [],
      createdAt: '2026-08-19T09:00:00.000Z',
      updatedAt: '2026-08-20T15:00:00.000Z',
    };

    const api = projectToApi(p);
    expect(api.change_orders).toHaveLength(1);

    const round = projectFromApi(api as Record<string, unknown>);
    expect(round.changeOrders).toHaveLength(1);
    const roundCo = round.changeOrders?.[0];
    expect(roundCo?.id).toBe('co-101');
    expect(roundCo?.number).toBe(1);
    expect(roundCo?.status).toBe('submitted');
    expect(roundCo?.impact?.costDelta).toBe(450);
    expect(roundCo?.impact?.priceDelta).toBe(750);
    expect(roundCo?.impact?.scopeDescription).toBe('1 cajón Blum Legrabox extra');
  });

  it('round-trips part instances and module units (OC-030..OC-034)', () => {
    const part: PartInstance = {
      id: 'p1_i1_u1_LAT_1',
      projectId: 'p-prod-phase2',
      productionRevision: 'rev-1',
      projectItemId: 'item-1',
      unitIndex: 1,
      partCode: 'LAT-IZQ',
      description: 'Lateral Izquierdo',
      materialId: 'mat-mdf-18',
      lengthMm: 720,
      widthMm: 560,
      thicknessMm: 18,
      grain: 1,
      edges: [
        { side: 'L1', enabled: true },
        { side: 'L2', enabled: false },
      ],
      requiredOperations: [
        {
          id: 'op-1',
          type: 'cut',
          sequence: 1,
          status: 'completed',
          operatorName: 'Carlos',
          completedAt: '2026-08-21T11:00:00Z',
        },
        {
          id: 'op-2',
          type: 'edge_banding',
          sequence: 2,
          status: 'queued',
        },
      ],
      currentOperationIndex: 1,
      status: 'in_progress',
    };

    const unit: ModuleUnitExecution = {
      id: 'p-prod-phase2_item-1_u1',
      projectId: 'p-prod-phase2',
      projectItemId: 'item-1',
      unitIndex: 1,
      productionRevision: 'rev-1',
      status: 'awaiting_parts',
      packageCount: 2,
      notes: 'Frente en alto brillo',
      supervisorOverride: {
        overriddenBy: 'user-sup',
        overriddenAt: '2026-08-21T12:00:00.000Z',
        reason: 'Frente llega mañana, armar estructura hoy',
        missingPartsCount: 1,
      },
    };

    const p: Project = {
      id: 'p-prod-phase2',
      name: 'Cocina Integral O2',
      customerId: 'cust-20',
      status: 'produced',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 500,
      partInstances: [part],
      moduleUnits: [unit],
      items: [],
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T11:00:00.000Z',
    };

    const api = projectToApi(p);
    expect(api.part_instances).toHaveLength(1);
    expect(api.module_units).toHaveLength(1);

    const round = projectFromApi(api as Record<string, unknown>);
    expect(round.partInstances).toHaveLength(1);
    const roundPart = round.partInstances?.[0];
    expect(roundPart?.id).toBe('p1_i1_u1_LAT_1');
    expect(roundPart?.partCode).toBe('LAT-IZQ');
    expect(roundPart?.lengthMm).toBe(720);
    expect(roundPart?.widthMm).toBe(560);
    expect(roundPart?.grain).toBe(1);
    expect(roundPart?.edges).toHaveLength(2);
    expect(roundPart?.edges[0]?.side).toBe('L1');
    expect(roundPart?.edges[0]?.enabled).toBe(true);
    expect(roundPart?.requiredOperations).toHaveLength(2);
    expect(roundPart?.requiredOperations[0]?.status).toBe('completed');
    expect(roundPart?.requiredOperations[0]?.operatorName).toBe('Carlos');

    expect(round.moduleUnits).toHaveLength(1);
    const roundUnit = round.moduleUnits?.[0];
    expect(roundUnit?.id).toBe('p-prod-phase2_item-1_u1');
    expect(roundUnit?.status).toBe('awaiting_parts');
    expect(roundUnit?.packageCount).toBe(2);
    expect(roundUnit?.notes).toBe('Frente en alto brillo');
    // OC-032: el override supervisor es audit — no puede perderse en el roundtrip.
    expect(roundUnit?.supervisorOverride?.overriddenBy).toBe('user-sup');
    expect(roundUnit?.supervisorOverride?.reason).toBe('Frente llega mañana, armar estructura hoy');
    expect(roundUnit?.supervisorOverride?.missingPartsCount).toBe(1);
  });
});

