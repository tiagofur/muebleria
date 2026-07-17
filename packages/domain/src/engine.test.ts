/**
 * Domain engine tests: BOM resolution, line costs, project breakdown, VALs, golden.
 */

import { describe, expect, it } from 'vitest';
import {
  GAB_ONLY_GOLDEN,
  GOLDEN_FIXTURE,
  IDS,
  modGab01,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaExpected,
  plantillaProject,
  seedComposedModule,
} from './__fixtures__/plantillaDemo';
import {
  calcBoardLineCost,
  calcHardwareLineCost,
  calcLineCost,
  calcProjectBreakdown,
  captureQuoteSnapshot,
  formatEdgeBandingInstruction,
  formatOptimizerPartDescription,
  generateCutRows,
  generateHardwareList,
  generatePieceLabels,
  generateProjectMaterialSummary,
  isProjectClosed,
  resolveBom,
  transitionProjectStatus,
  validateCatalogEntityCodes,
  validateComponent,
  validateModule,
  validateStructure,
  validateBoardPart,
  evaluatePartFormula,
  resolveComposedModule,
  resolveStructure,
} from './engine';
import { ResolutionError, ValidationError } from './errors';
import type {
  Catalog,
  Component,
  ComponentPlacement,
  EdgeAssignment,
  Module,
  ModuleComponentInstance,
  Project,
  Structure,
} from './types';

const ALL_EDGES: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: true },
  { side: 'L2', enabled: true },
  { side: 'W1', enabled: false },
  { side: 'W2', enabled: false },
] as const;

const NO_EDGES: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: false },
  { side: 'L2', enabled: false },
  { side: 'W1', enabled: false },
  { side: 'W2', enabled: false },
] as const;

function miniCatalog(overrides: Partial<Catalog> = {}): Catalog {
  const base: Catalog = {
    materials: [
      {
        id: 'mat-a',
        code: 'TAB-A',
        name: 'Mat A',
        widthMm: 1000,
        lengthMm: 1000,
        thicknessMm: 15,
        grainDefault: false,
        boardPrice: 100,
        wastePercent: 0,
        costPerM2: 100,
        defaultEdgeBandId: 'edge-a',
        active: true,
      },
      {
        id: 'mat-inactive',
        code: 'TAB-OFF',
        name: 'Mat Off',
        widthMm: 1000,
        lengthMm: 1000,
        thicknessMm: 15,
        grainDefault: false,
        boardPrice: 50,
        wastePercent: 0,
        costPerM2: 50,
        active: false,
      },
    ],
    edges: [
      {
        id: 'edge-a',
        code: 'CAN-A',
        name: 'Edge A',
        thicknessMm: 0.5,
        costPerMl: 10,
        active: true,
      },
    ],
    hardware: [
      {
        id: 'hw-a',
        code: 'HER-A',
        name: 'Hw A',
        unit: 'piece',
        costPerUnit: 20,
        active: true,
      },
      {
        id: 'hw-fixed',
        code: 'HER-FIX',
        name: 'Fixed screw',
        unit: 'piece',
        costPerUnit: 0.5,
        active: true,
      },
    ],
    optionGroups: [
      {
        id: 'og-int',
        code: 'INTERIOR',
        name: 'Interior',
        kind: 'board',
        required: true,
        optionIds: ['mat-a'],
      },
      {
        id: 'og-bis',
        code: 'BISAGRA',
        name: 'Bisagra',
        kind: 'hardware',
        required: true,
        optionIds: ['hw-a'],
      },
    ],
    structures: [
      {
        id: 'struct-test',
        code: 'EST-TEST',
        name: 'Test structure',
        externalDims: { width: 1000, height: 1000, depth: 500 },
        components: [{ componentId: 'comp-side', quantity: 1 }],
        active: true,
      },
    ],
    components: [
      {
        id: 'comp-side',
        code: 'COM-SIDE',
        name: 'Side',
        placement: 'lateral_izquierdo',
        geometry: { kind: 'rectangular_board', lengthMm: 1000, widthMm: 500, thicknessMm: 18 },
        defaultEdges: ALL_EDGES,
        optionRoles: ['INTERIOR'],
        active: true,
      },
    ],
    modules: [],
  };
  return { ...base, ...overrides };
}

function miniModule(overrides: Partial<Module> = {}): Module {
  return {
    id: 'mod-1',
    code: 'MOD-TEST',
    name: 'Test module',
    externalDims: { width: 1000, height: 1000, depth: 500 },
    structureId: 'struct-test',
    // No module-level components — the single test piece comes from the
    // referenced structure's component (comp-side × 1).
    components: [],
    hardwareLines: [
      {
        id: 'h1',
        quantity: 2,
        optionRole: 'BISAGRA',
      },
    ],
    ...overrides,
  };
}

/**
 * Build a composed module + catalog around a single configurable test piece.
 * Replaces the legacy "module with one boardPart" pattern: now the piece is a
 * Component (lengthMm × widthMm, given edges/optionRole) referenced once from
 * a structure-less composed module. Returns { module, catalog } so tests can
 * resolve BOM or add extra catalog entities.
 */
function miniModuleWithPart(opts: {
  lengthMm?: number;
  widthMm?: number;
  edges?: readonly EdgeAssignment[];
  optionRole?: string;
  hardwareLines?: Module['hardwareLines'];
  catalogOverrides?: Partial<Catalog>;
}): { module: Module; catalog: Catalog } {
  const compId = 'comp-custom';
  const role = opts.optionRole ?? 'INTERIOR';
  const component: Component = {
    id: compId,
    code: 'COM-CUSTOM',
    name: 'Custom part',
    placement: 'interno',
    geometry: {
      kind: 'rectangular_board',
      lengthMm: opts.lengthMm ?? 1000,
      widthMm: opts.widthMm ?? 500,
      thicknessMm: 18,
    },
    defaultEdges: opts.edges ?? ALL_EDGES,
    optionRoles: [role],
    active: true,
  };
  const catalog = miniCatalog({
    components: [component],
    structures: [
      {
        id: 'struct-custom',
        code: 'EST-CUSTOM',
        name: 'Custom structure',
        externalDims: { width: 1000, height: 1000, depth: 500 },
        components: [{ componentId: compId, quantity: 1 }],
        active: true,
      },
    ],
    ...opts.catalogOverrides,
  });
  const module: Module = {
    id: 'mod-custom',
    code: 'MOD-CUSTOM',
    name: 'Custom module',
    externalDims: { width: 1000, height: 1000, depth: 500 },
    structureId: 'struct-custom',
    components: [],
    hardwareLines: opts.hardwareLines ?? [],
  };
  return { module, catalog };
}

describe('resolveBom', () => {
  it('assigns material by optionRole', () => {
    const catalog = miniCatalog();
    const module = miniModule();
    const bom = resolveBom(
      module,
      { INTERIOR: 'mat-a', BISAGRA: 'hw-a' },
      catalog,
    );

    expect(bom.boardParts).toHaveLength(1);
    expect(bom.boardParts[0]?.materialId).toBe('mat-a');
    expect(bom.boardParts[0]?.edgeBandId).toBe('edge-a');
    expect(bom.hardwareLines[0]?.hardwareId).toBe('hw-a');
  });

  it('uses fixed hardwareId when option choice is absent', () => {
    const catalog = miniCatalog();
    const module = miniModule({
      hardwareLines: [
        {
          id: 'h-fixed',
          quantity: 4,
          optionRole: 'FIXED',
          hardwareId: 'hw-fixed',
        },
      ],
    });

    const bom = resolveBom(module, { INTERIOR: 'mat-a' }, catalog);
    expect(bom.hardwareLines[0]?.hardwareId).toBe('hw-fixed');
  });

  it('throws ResolutionError when required option choice is missing', () => {
    const catalog = miniCatalog();
    const module = miniModule();

    expect(() => resolveBom(module, {}, catalog)).toThrow(ResolutionError);
    try {
      resolveBom(module, {}, catalog);
    } catch (e) {
      const err = e as ResolutionError;
      expect(err.context?.optionGroupCode).toBe('INTERIOR');
      expect(err.message).toMatch(/Missing required option choice/i);
    }
  });

  it('throws ValidationError for inactive material (VAL-06)', () => {
    const catalog = miniCatalog();
    const module = miniModule();

    expect(() =>
      resolveBom(
        module,
        { INTERIOR: 'mat-inactive', BISAGRA: 'hw-a' },
        catalog,
      ),
    ).toThrow(ValidationError);
  });

  it('omits edgeBandId when no edge flags are enabled', () => {
    const { module, catalog } = miniModuleWithPart({ edges: NO_EDGES });

    const bom = resolveBom(module, { INTERIOR: 'mat-a' }, catalog);
    expect(bom.boardParts[0]?.edgeBandId).toBeUndefined();
  });

  it('prefers explicit EDGE option choice over material defaultEdgeBandId', () => {
    const catalog = miniCatalog({
      edges: [
        {
          id: 'edge-a',
          code: 'CAN-A',
          name: 'Edge A',
          thicknessMm: 0.5,
          costPerMl: 10,
          active: true,
        },
        {
          id: 'edge-other',
          code: 'CAN-OTHER',
          name: 'Other edge',
          thicknessMm: 1,
          costPerMl: 99,
          active: true,
        },
      ],
    });
    const module = miniModule({ hardwareLines: [] });
    const bom = resolveBom(
      module,
      { INTERIOR: 'mat-a', EDGE: 'edge-other' },
      catalog,
    );
    expect(bom.boardParts[0]?.edgeBandId).toBe('edge-other');
  });

  it('uses material.defaultEdgeBandId (not display name)', () => {
    const catalog = miniCatalog({
      materials: [
        {
          id: 'mat-a',
          code: 'TAB-A',
          name: 'Same Name As Unrelated Edge',
          widthMm: 1000,
          lengthMm: 1000,
          thicknessMm: 15,
          grainDefault: false,
          boardPrice: 100,
          wastePercent: 0,
          costPerM2: 100,
          defaultEdgeBandId: 'edge-a',
          active: true,
        },
      ],
      edges: [
        {
          id: 'edge-a',
          code: 'CAN-A',
          name: 'Linked by id only',
          thicknessMm: 0.5,
          costPerMl: 10,
          active: true,
        },
        {
          id: 'edge-same-name',
          code: 'CAN-NAME',
          name: 'Same Name As Unrelated Edge',
          thicknessMm: 2,
          costPerMl: 99,
          active: true,
        },
      ],
    });
    const module = miniModule({ hardwareLines: [] });
    const bom = resolveBom(module, { INTERIOR: 'mat-a' }, catalog);
    expect(bom.boardParts[0]?.edgeBandId).toBe('edge-a');
  });

  it('errors when edges enabled and material has no defaultEdgeBandId', () => {
    const catalog = miniCatalog({
      materials: [
        {
          id: 'mat-a',
          code: 'TAB-A',
          name: 'Mat A',
          widthMm: 1000,
          lengthMm: 1000,
          thicknessMm: 15,
          grainDefault: false,
          boardPrice: 100,
          wastePercent: 0,
          costPerM2: 100,
          active: true,
        },
      ],
    });
    const module = miniModule({ hardwareLines: [] });
    expect(() =>
      resolveBom(module, { INTERIOR: 'mat-a' }, catalog),
    ).toThrow(ResolutionError);
  });
});

describe('calcLineCost', () => {
  it('computes areaM2, edgeMl, boardCost, edgeCost for board parts', () => {
    const catalog = miniCatalog();
    const module = miniModule({ hardwareLines: [] });
    const bom = resolveBom(module, { INTERIOR: 'mat-a' }, catalog);
    const part = bom.boardParts[0]!;

    // qty=1, 1000x500, L1+L2 enabled → area=0.5, edgeMl=(2*1000)/1000=2
    const cost = calcBoardLineCost(part, catalog);
    expect(cost.areaM2).toBeCloseTo(0.5, 6);
    expect(cost.edgeMl).toBeCloseTo(2, 6);
    expect(cost.boardCost).toBeCloseTo(50, 6); // 0.5 * 100
    expect(cost.edgeCost).toBeCloseTo(20, 6); // 2 * 10
    expect(cost.hardwareCost).toBe(0);

    const viaUnion = calcLineCost(part, catalog);
    expect(viaUnion.boardCost).toBeCloseTo(cost.boardCost, 6);
  });

  it('applies wastePercent 10% to boardCost (PRD §13.2 / F014)', () => {
    // Known part: 1000×1000 mm → areaM2 = 1; costPerM2 = 100; waste = 10
    // costPerM2 is pre-calculated with waste: (100 / 1) * 1.10 = 110
    const { module, catalog } = miniModuleWithPart({
      lengthMm: 1000,
      widthMm: 1000,
      edges: NO_EDGES,
      catalogOverrides: {
        materials: [
          {
            id: 'mat-a',
            code: 'TAB-A',
            name: 'Mat A',
            widthMm: 1000,
            lengthMm: 1000,
            thicknessMm: 15,
            grainDefault: false,
            boardPrice: 100,
            wastePercent: 10,
            costPerM2: 110,
            active: true,
          },
        ],
      },
    });
    const bom = resolveBom(module, { INTERIOR: 'mat-a' }, catalog);
    const cost = calcBoardLineCost(bom.boardParts[0]!, catalog);
    expect(cost.areaM2).toBeCloseTo(1, 6);
    expect(cost.boardCost).toBeCloseTo(110, 6);
  });

  it('calculates boardCost without waste when wastePercent is 0', () => {
    const { module, catalog } = miniModuleWithPart({
      lengthMm: 1000,
      widthMm: 500,
      edges: NO_EDGES,
      catalogOverrides: {
        materials: [
          {
            id: 'mat-a',
            code: 'TAB-A',
            name: 'Mat A',
            widthMm: 1000,
            lengthMm: 1000,
            thicknessMm: 15,
            grainDefault: false,
            boardPrice: 100,
            wastePercent: 0,
            costPerM2: 100,
            active: true,
          },
        ],
      },
    });
    const bom = resolveBom(module, { INTERIOR: 'mat-a' }, catalog);
    const cost = calcBoardLineCost(bom.boardParts[0]!, catalog);
    // area=0.5, cost=100 = 50
    expect(cost.boardCost).toBeCloseTo(50, 6);
  });

  it('computes hardwareCost = qty * costPerUnit', () => {
    const { module, catalog } = miniModuleWithPart({
      lengthMm: 100,
      widthMm: 100,
      edges: NO_EDGES,
      hardwareLines: [{ id: 'h1', quantity: 2, optionRole: 'BISAGRA' }],
    });
    const bom = resolveBom(
      module,
      { INTERIOR: 'mat-a', BISAGRA: 'hw-a' },
      catalog,
    );
    const cost = calcHardwareLineCost(bom.hardwareLines[0]!, catalog);
    expect(cost.hardwareCost).toBe(40); // 2 * 20
  });
});

describe('calcProjectBreakdown', () => {
  it('aggregates directCost and salePrice per PRD §13.3', () => {
    const { module, catalog } = miniModuleWithPart({
      lengthMm: 1000,
      widthMm: 1000,
      edges: NO_EDGES,
      hardwareLines: [{ id: 'h1', quantity: 2, optionRole: 'BISAGRA' }],
    });
    // baseLaborCost is not configurable via the helper; apply it directly.
    const mod = { ...module, baseLaborCost: 150 };
    const cat = { ...catalog, modules: [mod] };
    const project: Project = {
      id: 'proj-1',
      name: 'P',
      customerId: 'C',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 500,
      status: 'draft',
      items: [
        {
          id: 'i1',
          moduleId: mod.id,
          quantity: 2,
          optionChoices: { INTERIOR: 'mat-a', BISAGRA: 'hw-a' },
        },
      ],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };

    // per module unit: board=100 (1m²×100), hw=40, direct=140; ×2 items
    // laborModular = 2 * 150 = 300
    // sale = 280 * 1.35 + 300 + 500 = 1178
    const breakdown = calcProjectBreakdown(project, cat);
    expect(breakdown.materialsCost).toBeCloseTo(200, 6);
    expect(breakdown.hardwareTotal).toBeCloseTo(80, 6);
    expect(breakdown.edgeTotal).toBeCloseTo(0, 6);
    expect(breakdown.directCost).toBeCloseTo(280, 6);
    expect(breakdown.laborModular).toBe(300);
    expect(breakdown.laborFixedCost).toBe(500);
    expect(breakdown.salePrice).toBeCloseTo(1178, 6);
  });

  /**
   * Issue #7 — parity with Go engine: no intermediate rounding.
   * Same fixture as backend-go TestCalcProjectBreakdown_NoIntermediateRounding.
   * Display/export may round to 2 decimals; domain returns raw floats.
   */
  it('does not round breakdown fields to 2 decimals (TS/Go parity)', () => {
    const { module: baseModule, catalog } = miniModuleWithPart({
      lengthMm: 800,
      widthMm: 600,
      edges: [
        { side: 'L1', enabled: true },
        { side: 'L2', enabled: false },
        { side: 'W1', enabled: true },
        { side: 'W2', enabled: false },
      ],
      hardwareLines: [{ id: 'h1', quantity: 3, optionRole: 'BISAGRA' }],
      catalogOverrides: {
        materials: [
          {
            id: 'mat-a',
            code: 'TAB-A',
            name: 'Mat A',
            widthMm: 1000,
            lengthMm: 1000,
            thicknessMm: 15,
            grainDefault: false,
            boardPrice: 100,
            wastePercent: 0,
            costPerM2: 160.333,
            active: true,
          },
        ],
        edges: [
          {
            id: 'edge-a',
            code: 'CAN-A',
            name: 'Edge A',
            thicknessMm: 0.5,
            costPerMl: 3.333,
            active: true,
          },
        ],
        hardware: [
          {
            id: 'hw-a',
            code: 'HER-A',
            name: 'Hw A',
            unit: 'piece',
            costPerUnit: 7.777,
            active: true,
          },
        ],
      },
    });
    const module = { ...baseModule, baseLaborCost: 100.111 };
    const project: Project = {
      id: 'proj-1',
      name: 'No-round',
      customerId: 'C',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 50.555,
      status: 'draft',
      items: [
        {
          id: 'i1',
          moduleId: module.id,
          quantity: 1,
          optionChoices: {
            INTERIOR: 'mat-a',
            BISAGRA: 'hw-a',
            EDGE: 'edge-a',
          },
        },
      ],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };

    const breakdown = calcProjectBreakdown(
      project,
      { ...catalog, modules: [module] },
    );

    // Mirrors Go raw expectations (issue #7 golden cross-fixture).
    expect(breakdown.materialsCost).toBeCloseTo(76.95984, 9);
    expect(breakdown.edgeTotal).toBeCloseTo(4.6662, 9);
    expect(breakdown.hardwareTotal).toBeCloseTo(23.331, 9);
    expect(breakdown.directCost).toBeCloseTo(104.95704, 9);
    expect(breakdown.laborModular).toBeCloseTo(100.111, 9);
    expect(breakdown.salePrice).toBeCloseTo(292.358004, 9);
    expect(
      breakdown.materialsCost + breakdown.edgeTotal + breakdown.hardwareTotal,
    ).toBeCloseTo(breakdown.directCost, 12);
    // Must keep precision beyond 2 decimals.
    expect(breakdown.materialsCost).not.toBe(
      Math.round(76.95984 * 100) / 100,
    );
    expect(breakdown.salePrice).not.toBe(Math.round(292.358004 * 100) / 100);
  });

  it('treats missing baseLaborCost as 0', () => {
    const { module, catalog } = miniModuleWithPart({
      lengthMm: 1000,
      widthMm: 1000,
      edges: NO_EDGES,
      hardwareLines: [],
    });
    const project: Project = {
      id: 'proj-2',
      name: 'P',
      customerId: 'C',
      currency: 'MXN',
      marginFactor: 1,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i1',
          moduleId: module.id,
          quantity: 1,
          optionChoices: { INTERIOR: 'mat-a' },
        },
      ],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };

    const breakdown = calcProjectBreakdown(project, { ...catalog, modules: [module] });
    expect(breakdown.laborModular).toBe(0);
    expect(breakdown.salePrice).toBeCloseTo(breakdown.directCost, 6);
  });
});

/**
 * Escenario B (PRD §6.2 / §7.4): draft recalculates with catalog;
 * closed (quoted/accepted) keeps prices frozen at close time.
 * Reproducible without Excel using plantilla fixtures.
 */
describe('quote snapshot — Escenario B (PRD §6.2 / §7.4)', () => {
  const frozenAt = '2026-07-15T12:00:00.000Z';

  it('isProjectClosed is true for quoted, accepted, and produced', () => {
    expect(isProjectClosed('draft')).toBe(false);
    expect(isProjectClosed('quoted')).toBe(true);
    expect(isProjectClosed('accepted')).toBe(true);
    expect(isProjectClosed('produced')).toBe(true);
  });

  it('draft plantilla project has live salePrice; close freezes it', () => {
    const draft: Project = { ...plantillaProject, status: 'draft' };
    const live = calcProjectBreakdown(draft, plantillaCatalogWithModules);
    expect(live.salePrice).toBeCloseTo(plantillaExpected.salePrice, 5);

    const closed = transitionProjectStatus(
      draft,
      'quoted',
      plantillaCatalogWithModules,
      frozenAt,
    );
    expect(closed.status).toBe('quoted');
    expect(closed.priceSnapshot).toBeDefined();
    expect(closed.priceSnapshot?.capturedAt).toBe(frozenAt);
    expect(closed.priceSnapshot?.breakdown.salePrice).toBeCloseTo(
      live.salePrice,
      6,
    );
    expect(closed.priceSnapshot?.materialCostPerM2?.[IDS.matArauco]).toBe(160);

    const frozen = calcProjectBreakdown(closed, plantillaCatalogWithModules);
    expect(frozen.salePrice).toBeCloseTo(live.salePrice, 6);
  });

  it('Escenario B: closed keeps salePrice after Arauco costPerM2 rises; draft recalculates higher', () => {
    // 1) Draft with plantilla material costs → note salePrice
    const draft: Project = { ...plantillaProject, status: 'draft' };
    const saleAtClose = calcProjectBreakdown(
      draft,
      plantillaCatalogWithModules,
    ).salePrice;

    // 2) Close to quoted → snapshot present; salePrice equals live at close
    const closed = transitionProjectStatus(
      draft,
      'quoted',
      plantillaCatalogWithModules,
      frozenAt,
    );
    expect(closed.priceSnapshot?.breakdown.salePrice).toBeCloseTo(
      saleAtClose,
      6,
    );

    // 3) Raise Arauco costPerM2 dramatically in catalog
    const expensiveCatalog: Catalog = {
      ...plantillaCatalogWithModules,
      materials: plantillaCatalogWithModules.materials.map((m) =>
        m.id === IDS.matArauco ? { ...m, costPerM2: 1600 } : m,
      ),
    };

    // 4) Closed project still returns frozen salePrice
    const closedAfterRaise = calcProjectBreakdown(closed, expensiveCatalog);
    expect(closedAfterRaise.salePrice).toBeCloseTo(saleAtClose, 6);
    expect(closedAfterRaise.materialsCost).toBeCloseTo(
      plantillaExpected.materialsCost,
      5,
    );

    // 5) Same project as draft (reopen) recalculates higher price
    const reopened = transitionProjectStatus(
      closed,
      'draft',
      expensiveCatalog,
    );
    expect(reopened.status).toBe('draft');
    expect(reopened.priceSnapshot).toBeUndefined();

    const liveAfterRaise = calcProjectBreakdown(reopened, expensiveCatalog);
    expect(liveAfterRaise.salePrice).toBeGreaterThan(saleAtClose);
    expect(liveAfterRaise.materialsCost).toBeGreaterThan(
      plantillaExpected.materialsCost,
    );
  });

  it('quoted ↔ accepted keeps the same snapshot (does not re-freeze)', () => {
    const draft: Project = { ...plantillaProject, status: 'draft' };
    const quoted = transitionProjectStatus(
      draft,
      'quoted',
      plantillaCatalogWithModules,
      frozenAt,
    );
    const snapshot = quoted.priceSnapshot;
    expect(snapshot).toBeDefined();

    const accepted = transitionProjectStatus(
      quoted,
      'accepted',
      plantillaCatalogWithModules,
      '2026-07-16T00:00:00.000Z',
    );
    expect(accepted.status).toBe('accepted');
    expect(accepted.priceSnapshot).toBe(snapshot);
    expect(accepted.priceSnapshot?.capturedAt).toBe(frozenAt);
  });

  it('accepted → produced keeps snapshot; produced → draft clears (F036)', () => {
    const draft: Project = { ...plantillaProject, status: 'draft' };
    const accepted = transitionProjectStatus(
      draft,
      'accepted',
      plantillaCatalogWithModules,
      frozenAt,
    );
    const snapshot = accepted.priceSnapshot;
    const produced = transitionProjectStatus(
      accepted,
      'produced',
      plantillaCatalogWithModules,
      '2026-07-16T00:00:00.000Z',
    );
    expect(produced.status).toBe('produced');
    expect(produced.priceSnapshot).toBe(snapshot);

    const reopened = transitionProjectStatus(
      produced,
      'draft',
      plantillaCatalogWithModules,
    );
    expect(reopened.status).toBe('draft');
    expect(reopened.priceSnapshot).toBeUndefined();
  });

  it('captureQuoteSnapshot records unit prices for used materials/edges/hardware', () => {
    const snap = captureQuoteSnapshot(
      plantillaProject,
      plantillaCatalogWithModules,
      frozenAt,
    );
    expect(snap.materialCostPerM2?.[IDS.matArauco]).toBe(160);
    expect(snap.materialCostPerM2?.[IDS.matMaderado]).toBe(290);
    expect(snap.edgeCostPerMl?.[IDS.edgeArauco]).toBe(12);
    expect(snap.hardwareCostPerUnit?.[IDS.hwBisagra]).toBe(35);
    expect(snap.breakdown.salePrice).toBeCloseTo(plantillaExpected.salePrice, 5);
  });

  it('draft ignores a stale priceSnapshot if present', () => {
    const draftWithStale: Project = {
      ...plantillaProject,
      status: 'draft',
      priceSnapshot: {
        capturedAt: frozenAt,
        breakdown: {
          materialsCost: 1,
          edgeTotal: 1,
          hardwareTotal: 1,
          directCost: 3,
          laborModular: 0,
          laborFixedCost: 0,
          marginFactor: 1,
          salePrice: 3,
        },
      },
    };
    const live = calcProjectBreakdown(
      draftWithStale,
      plantillaCatalogWithModules,
    );
    expect(live.salePrice).toBeCloseTo(plantillaExpected.salePrice, 5);
    expect(live.salePrice).not.toBe(3);
  });
});

describe('validations VAL-01..07 (engine-time)', () => {
  it('VAL-01: rejects non-positive board dimensions', () => {
    // Board-part dimension validation runs on the expanded pieces inside
    // resolveBom (validateBoardPart). Build a part directly to exercise it.
    const badPart = {
      id: 'p-bad',
      description: 'Bad',
      quantity: 1,
      lengthMm: 0,
      widthMm: 100,
      edges: NO_EDGES,
      optionRole: 'INTERIOR',
    };
    expect(() => validateBoardPart(badPart)).toThrow(ValidationError);
  });

  it('VAL-03: rejects hardware qty <= 0', () => {
    const module = miniModule({
      hardwareLines: [{ id: 'h0', quantity: 0, optionRole: 'BISAGRA' }],
    });
    expect(() => validateModule(module)).toThrow(ValidationError);
  });

  it('VAL-07: rejects empty module code/name', () => {
    expect(() =>
      validateModule(miniModule({ code: '  ', name: 'Ok' })),
    ).toThrow(ValidationError);
    expect(() =>
      validateModule(miniModule({ code: 'OK', name: '' })),
    ).toThrow(ValidationError);
  });

  it('F049: validateStructure accepts cuerpo with component instances', () => {
    expect(() =>
      validateStructure({
        id: 'str-1',
        code: 'EST-GAB-CUERPO',
        name: 'Cuerpo gabinete',
        components: [
          { componentId: 'comp-costado', quantity: 2 },
        ],
      }),
    ).not.toThrow();
  });

  it('F049: validateStructure rejects empty components and bad quantity', () => {
    expect(() =>
      validateStructure({
        id: 'str-1',
        code: 'EST-X',
        name: 'X',
        components: [],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      validateStructure({
        id: 'str-1',
        code: 'EST-X',
        name: 'X',
        components: [
          { componentId: 'comp-x', quantity: 0 },
        ],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      validateStructure({
        id: 'str-1',
        code: 'EST-X',
        name: 'X',
        components: [{ componentId: '', quantity: 1 }],
      }),
    ).toThrow(ValidationError);
  });

  it('VAL-07: rejects empty catalog material codes', () => {
    const catalog = miniCatalog({
      materials: [
        {
          id: 'm',
          code: '',
          name: 'X',
          widthMm: 1830,
          lengthMm: 2440,
          thicknessMm: 1,
          grainDefault: false,
          boardPrice: 1,
          wastePercent: 0,
          costPerM2: 1,
          active: true,
        },
      ],
    });
    expect(() => validateCatalogEntityCodes(catalog)).toThrow(
      ValidationError,
    );
  });
});

const ALL_EDGES_TRUE: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: true },
  { side: 'L2', enabled: true },
  { side: 'W1', enabled: true },
  { side: 'W2', enabled: true },
] as const;

function validComponent(overrides: Partial<Component> = {}): Component {
  return {
    id: 'comp-test',
    code: 'COM-TEST-01',
    name: 'Componente de prueba',
    placement: 'puerta' as ComponentPlacement,
    geometry: {
      kind: 'rectangular_board',
      lengthMm: 717,
      widthMm: 296,
      thicknessMm: 18,
    },
    defaultEdges: ALL_EDGES_TRUE,
    optionRoles: ['FRENTE'],
    active: true,
    ...overrides,
  };
}

describe('validateComponent', () => {
  it('passes for a valid component', () => {
    expect(() => validateComponent(validComponent())).not.toThrow();
  });

  it('throws ValidationError when code is empty', () => {
    expect(() => validateComponent(validComponent({ code: '' }))).toThrow(
      ValidationError,
    );
    expect(() => validateComponent(validComponent({ code: '  ' }))).toThrow(
      ValidationError,
    );
    try {
      validateComponent(validComponent({ code: '' }));
    } catch (e) {
      const err = e as ValidationError;
      expect(err.context?.field).toBe('code');
    }
  });

  it('throws ValidationError when name is empty', () => {
    expect(() => validateComponent(validComponent({ name: '' }))).toThrow(
      ValidationError,
    );
    expect(() => validateComponent(validComponent({ name: '  ' }))).toThrow(
      ValidationError,
    );
    try {
      validateComponent(validComponent({ name: '' }));
    } catch (e) {
      const err = e as ValidationError;
      expect(err.context?.field).toBe('name');
    }
  });

  it('throws ValidationError when lengthMm is zero', () => {
    expect(() =>
      validateComponent(
        validComponent({
          geometry: {
            kind: 'rectangular_board',
            lengthMm: 0,
            widthMm: 296,
            thicknessMm: 18,
          },
        }),
      ),
    ).toThrow(ValidationError);
    try {
      validateComponent(
        validComponent({
          geometry: {
            kind: 'rectangular_board',
            lengthMm: 0,
            widthMm: 296,
            thicknessMm: 18,
          },
        }),
      );
    } catch (e) {
      const err = e as ValidationError;
      expect(err.context?.field).toMatch(/lengthMm/i);
    }
  });

  it('throws ValidationError when widthMm is zero', () => {
    expect(() =>
      validateComponent(
        validComponent({
          geometry: {
            kind: 'rectangular_board',
            lengthMm: 717,
            widthMm: 0,
            thicknessMm: 18,
          },
        }),
      ),
    ).toThrow(ValidationError);
    try {
      validateComponent(
        validComponent({
          geometry: {
            kind: 'rectangular_board',
            lengthMm: 717,
            widthMm: 0,
            thicknessMm: 18,
          },
        }),
      );
    } catch (e) {
      const err = e as ValidationError;
      expect(err.context?.field).toMatch(/widthMm/i);
    }
  });

  it('throws ValidationError when thicknessMm is zero', () => {
    expect(() =>
      validateComponent(
        validComponent({
          geometry: {
            kind: 'rectangular_board',
            lengthMm: 717,
            widthMm: 296,
            thicknessMm: 0,
          },
        }),
      ),
    ).toThrow(ValidationError);
    try {
      validateComponent(
        validComponent({
          geometry: {
            kind: 'rectangular_board',
            lengthMm: 717,
            widthMm: 296,
            thicknessMm: 0,
          },
        }),
      );
    } catch (e) {
      const err = e as ValidationError;
      expect(err.context?.field).toMatch(/thicknessMm/i);
    }
  });

  it('throws ValidationError when optionRoles is empty', () => {
    expect(() =>
      validateComponent(validComponent({ optionRoles: [] })),
    ).toThrow(ValidationError);
    try {
      validateComponent(validComponent({ optionRoles: [] }));
    } catch (e) {
      const err = e as ValidationError;
      expect(err.context?.field).toBe('optionRoles');
    }
  });

  it('throws ValidationError when defaultEdges has fewer than 4', () => {
    expect(() =>
      validateComponent(
        validComponent({
          defaultEdges: [
            { side: 'L1', enabled: true },
            { side: 'L2', enabled: true },
          ],
        }),
      ),
    ).toThrow(ValidationError);
    try {
      validateComponent(
        validComponent({
          defaultEdges: [
            { side: 'L1', enabled: true },
            { side: 'L2', enabled: true },
          ],
        }),
      );
    } catch (e) {
      const err = e as ValidationError;
      expect(err.context?.field).toBe('edges');
    }
  });
});

describe('golden: Plantilla_Muebles.xlsx', () => {
  /**
   * Intentional divergences (documented):
   * - wastePercent = 0 (Excel has no merma)
   * - laborModular = 0 (Excel only laborFixedCost B17=1200)
   * - no IVA
   * - edge band resolved by material display name (Excel VLOOKUP)
   * - totals recomputed: Excel data_only cache was empty
   */
  it('MOD-GAB-01 + MOD-CAJ-01 project matches plantilla totals', () => {
    const { project, catalog, expected } = GOLDEN_FIXTURE;
    const breakdown = calcProjectBreakdown(project, catalog);

    expect(breakdown.materialsCost).toBeCloseTo(expected.materialsCost, 2);
    expect(breakdown.edgeTotal).toBeCloseTo(expected.edgeTotal, 2);
    expect(breakdown.hardwareTotal).toBeCloseTo(expected.hardwareTotal, 2);
    expect(breakdown.directCost).toBeCloseTo(expected.directCost, 2);
    expect(breakdown.laborModular).toBe(expected.laborModular);
    expect(breakdown.laborFixedCost).toBe(expected.laborFixedCost);
    expect(breakdown.marginFactor).toBe(expected.marginFactor);
    expect(breakdown.salePrice).toBeCloseTo(expected.salePrice, 2);
  });

  /**
   * F011: MOD-GAB-01 × 1 alone with plantillaChoices.
   * Intentional divergences same as dual golden (waste 0, laborModular 0, no IVA).
   * laborFixedCost remains project-level 1200 (Excel B17), not pro-rated by module.
   */
  it('MOD-GAB-01 × 1 with plantilla choices matches GAB-only plantilla price', () => {
    const { project, catalog, expected } = GAB_ONLY_GOLDEN;
    const breakdown = calcProjectBreakdown(project, catalog);

    expect(breakdown.materialsCost).toBeCloseTo(expected.materialsCost, 2);
    expect(breakdown.edgeTotal).toBeCloseTo(expected.edgeTotal, 2);
    expect(breakdown.hardwareTotal).toBeCloseTo(expected.hardwareTotal, 2);
    expect(breakdown.directCost).toBeCloseTo(expected.directCost, 2);
    expect(breakdown.laborModular).toBe(expected.laborModular);
    expect(breakdown.laborFixedCost).toBe(expected.laborFixedCost);
    expect(breakdown.marginFactor).toBe(expected.marginFactor);
    expect(breakdown.salePrice).toBeCloseTo(expected.salePrice, 2);

    // Sanity: GAB-only direct cost is strictly below dual-module plantilla
    expect(breakdown.directCost).toBeLessThan(GOLDEN_FIXTURE.expected.directCost);
  });

  it('resolveBom maps plantilla option roles for MOD-GAB-01', () => {
    const bom = resolveBom(
      modGab01,
      plantillaChoices,
      plantillaCatalogWithModules,
    );

    // Pieces come from expanded components; find by description (component name).
    const puerta = bom.boardParts.find((p) => p.description === 'Puerta Gabinete');
    const costado = bom.boardParts.find((p) => p.description === 'Costado Gabinete');
    const bisagra = bom.hardwareLines.find((h) => h.id === 'gab-h01');

    expect(costado?.materialId).toBe(IDS.matArauco);
    expect(costado?.edgeBandId).toBe(IDS.edgeArauco);
    expect(puerta?.materialId).toBe(IDS.matMaderado);
    expect(puerta?.edgeBandId).toBe(IDS.edgeMaderado);
    expect(bisagra?.hardwareId).toBe(IDS.hwBisagra);
  });
});

describe('formatEdgeBandingInstruction (F046)', () => {
  it('returns Sin encintar when no sides enabled', () => {
    expect(
      formatEdgeBandingInstruction({
        L1: false,
        L2: false,
        W1: false,
        W2: false,
      }),
    ).toBe('Sin encintar');
  });

  it('lists sides and edge band when known', () => {
    expect(
      formatEdgeBandingInstruction(
        { L1: true, L2: true, W1: false, W2: false },
        { code: 'CAN-A', name: 'Edge A', thicknessMm: 0.5 },
      ),
    ).toBe('Encintar L1 y L2 con Edge A 0.5 mm (CAN-A)');
  });

  it('asks to define edge when sides on but no band', () => {
    expect(
      formatEdgeBandingInstruction({
        L1: true,
        L2: false,
        W1: true,
        W2: true,
      }),
    ).toBe('Encintar L1, W1 y W2 (definir canto)');
  });
});

describe('generatePieceLabels (F046 / #96)', () => {
  const gabOnlyProject: Project = {
    id: 'proj-gab-only-labels',
    name: 'Gab only labels',
    customerId: 'Test',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      {
        id: 'item-gab',
        moduleId: IDS.modGab,
        quantity: 1,
        optionChoices: plantillaChoices,
      },
    ],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };

  it('emits one label per board part without hardware', () => {
    const labels = generatePieceLabels(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    const expectedCount = resolveBom(
      modGab01,
      plantillaChoices,
      plantillaCatalogWithModules,
    ).boardParts.length;
    expect(labels).toHaveLength(expectedCount);
    for (const label of labels) {
      expect(label.description.toLowerCase()).not.toContain('bisagra');
      expect(label.materialName.length).toBeGreaterThan(0);
      expect(label.edgeBandingInstruction.length).toBeGreaterThan(0);
    }
  });

  it('multiplies quantity by project item quantity', () => {
    const labels = generatePieceLabels(
      {
        ...gabOnlyProject,
        items: [
          {
            id: 'item-gab',
            moduleId: IDS.modGab,
            quantity: 2,
            optionChoices: plantillaChoices,
          },
        ],
      },
      plantillaCatalogWithModules,
    );
    const costado = labels.find((l) => l.description === 'Costado Gabinete');
    // component quantity 1 × item quantity 2 = 2
    expect(costado?.quantity).toBe(2);
  });

  it('includes edge banding instruction with resolved edge', () => {
    const labels = generatePieceLabels(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    const withEdge = labels.find((l) => l.L1 || l.L2 || l.W1 || l.W2);
    expect(withEdge).toBeDefined();
    expect(withEdge!.edgeBandingInstruction).toMatch(/^Encintar /);
    expect(withEdge!.edgeBandCode).toBeTruthy();
  });

  it('throws when no board parts', () => {
    const empty: Project = {
      ...gabOnlyProject,
      items: [],
    };
    expect(() =>
      generatePieceLabels(empty, plantillaCatalogWithModules),
    ).toThrow(ValidationError);
  });
});

describe('generateCutRows', () => {
  const gabOnlyProject: Project = {
    id: 'proj-gab-only',
    name: 'Gab only',
    customerId: 'Test',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [
      {
        id: 'item-gab',
        moduleId: IDS.modGab,
        quantity: 1,
        optionChoices: plantillaChoices,
      },
    ],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };

  it('F048: description includes part and module codes', () => {
    expect(
      formatOptimizerPartDescription('MOD-GAB-01', 'Costado Derecho', 'MOD-GAB-01-P01'),
    ).toBe('MOD-GAB-01-P01 · Costado Derecho · MOD-GAB-01');
    expect(formatOptimizerPartDescription('MOD-X', 'Pieza')).toBe(
      'Pieza · MOD-X',
    );
  });

  it('EXP-02: multiplies part quantity by project item quantity', () => {
    const project: Project = {
      ...gabOnlyProject,
      items: [
        {
          id: 'item-gab',
          moduleId: IDS.modGab,
          quantity: 3,
          optionChoices: plantillaChoices,
        },
      ],
    };

    const rows = generateCutRows(project, plantillaCatalogWithModules);
    const costado = rows.find((r) => r.partName === 'Costado Gabinete');
    // part.quantity = 1 × item.quantity = 3
    expect(costado?.quantity).toBe(3);
    expect(costado?.description).toContain('Costado Gabinete');
    expect(costado?.description).toContain('MOD-GAB-01');
    expect(costado?.labelRef).toBeTruthy();
  });

  it('EXP-05: never includes hardware lines', () => {
    const rows = generateCutRows(gabOnlyProject, plantillaCatalogWithModules);
    const expectedCount = resolveBom(
      modGab01,
      plantillaChoices,
      plantillaCatalogWithModules,
    ).boardParts.length;
    expect(rows).toHaveLength(expectedCount);
    for (const row of rows) {
      expect(row.description.toLowerCase()).not.toContain('bisagra');
      expect(row.description.toLowerCase()).not.toContain('jaladera');
      expect(row.description.toLowerCase()).not.toContain('tornillo');
      expect(row.materialName).not.toMatch(/herraje/i);
    }
  });

  it('EXP-04: sorts by module code then part code', () => {
    const full = generateCutRows(
      GOLDEN_FIXTURE.project,
      plantillaCatalogWithModules,
    );
    // MOD-CAJ-01 < MOD-GAB-01 → all CAJ board parts before GAB
    const cajPuertaIdx = full.findIndex(
      (r) => r.partName === 'Frente de Cajón' || r.description.includes('Frente de Cajón'),
    );
    const gabPuertaIdx = full.findIndex(
      (r) => r.partName === 'Puerta Gabinete' || r.description.includes('Puerta Gabinete'),
    );
    expect(cajPuertaIdx).toBeGreaterThanOrEqual(0);
    expect(gabPuertaIdx).toBeGreaterThan(cajPuertaIdx);

    // Within one module: all expanded component instances are present. Component
    // instances have no part code, so internal order is by description/partId —
    // we assert the multiset of part names rather than a fixed order.
    const gabOnly = generateCutRows(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    expect([...gabOnly.map((r) => r.partName)].sort()).toEqual(
      [
        'Costado Gabinete',
        'Costado Gabinete',
        'Respaldo Gabinete',
        'Piso Gabinete',
        'Manguete',
        'Manguete',
        'Puerta Gabinete',
        'Entrepaño Gabinete',
      ].sort(),
    );
  });

  it('maps material name, grain and edge flags from resolved BOM', () => {
    const rows = generateCutRows(gabOnlyProject, plantillaCatalogWithModules);
    const costado = rows.find((r) => r.partName === 'Costado Gabinete');
    const puerta = rows.find((r) => r.partName === 'Puerta Gabinete');
    const respaldo = rows.find((r) => r.partName === 'Respaldo Gabinete');

    expect(costado).toMatchObject({
      quantity: 1,
      lengthMm: 720,
      widthMm: 590,
      materialName: 'ARAUCO BLANCO',
      grain: 0,
      L1: 1,
      L2: 1,
      W1: 1,
      W2: 1,
    });
    expect(puerta).toMatchObject({
      materialName: 'MADERADO FRENTE',
      grain: 1,
      L1: 1,
      L2: 1,
      W1: 1,
      W2: 1,
    });
    expect(respaldo).toMatchObject({
      L1: 0,
      L2: 0,
      W1: 0,
      W2: 0,
    });
  });

  it('VAL-05: throws when there are no board parts to export', () => {
    const emptyModule: Module = {
      id: 'mod-hw-only',
      code: 'MOD-HW',
      name: 'Hardware only',
      // No structureId → no board parts produced; hardware-only module.
      hardwareLines: [
        {
          id: 'h1',
          quantity: 1,
          optionRole: 'FIXED',
          hardwareId: 'hw-a',
        },
      ],
    };
    const catalog = miniCatalog({
      modules: [emptyModule],
      hardware: [
        {
          id: 'hw-a',
          code: 'HER-A',
          name: 'Hw A',
          unit: 'piece',
          costPerUnit: 1,
          active: true,
        },
      ],
    });
    const project: Project = {
      id: 'p-empty',
      name: 'Empty boards',
      customerId: 'T',
      currency: 'MXN',
      marginFactor: 1,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i1',
          moduleId: 'mod-hw-only',
          quantity: 1,
          optionChoices: {},
        },
      ],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };

    expect(() => generateCutRows(project, catalog)).toThrow(ValidationError);
    expect(() => generateCutRows(project, catalog)).toThrow(
      /no hay piezas de tablero para exportar/i,
    );
  });
});

describe('generateProjectMaterialSummary (F047 / #97)', () => {
  const gabOnlyProject: Project = {
    id: 'proj-summary-gab',
    name: 'Summary gab',
    customerId: 'Test',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [
      {
        id: 'item-gab',
        moduleId: IDS.modGab,
        quantity: 1,
        optionChoices: plantillaChoices,
      },
    ],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };

  it('aggregates area m² by material matching board line costs', () => {
    const summary = generateProjectMaterialSummary(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    expect(summary.materials.length).toBeGreaterThan(0);
    expect(summary.totalAreaM2).toBeGreaterThan(0);
    const sumAreas = summary.materials.reduce((s, m) => s + m.areaM2, 0);
    expect(sumAreas).toBeCloseTo(summary.totalAreaM2, 8);
    // total board cost matches sum of rows
    const sumBoard = summary.materials.reduce((s, m) => s + m.boardCost, 0);
    expect(sumBoard).toBeCloseTo(summary.totalBoardCost, 8);
  });

  it('scales area with project item quantity', () => {
    const one = generateProjectMaterialSummary(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    const two = generateProjectMaterialSummary(
      {
        ...gabOnlyProject,
        items: [
          {
            id: 'item-gab',
            moduleId: IDS.modGab,
            quantity: 2,
            optionChoices: plantillaChoices,
          },
        ],
      },
      plantillaCatalogWithModules,
    );
    expect(two.totalAreaM2).toBeCloseTo(one.totalAreaM2 * 2, 8);
  });

  it('includes hardware totals and edge ML when present', () => {
    const summary = generateProjectMaterialSummary(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    expect(summary.hardware.length).toBeGreaterThan(0);
    expect(summary.totalHardwareCost).toBeGreaterThan(0);
    expect(summary.totalEdgeMl).toBeGreaterThanOrEqual(0);
  });
});

describe('generateHardwareList', () => {
  const gabOnlyProject: Project = {
    id: 'proj-gab-only',
    name: 'Gab only',
    customerId: 'Test',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [
      {
        id: 'item-gab',
        moduleId: IDS.modGab,
        quantity: 1,
        optionChoices: plantillaChoices,
      },
    ],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };

  it('EXP-08: MOD-GAB-01 × 1 aggregates known hardware quantities', () => {
    const rows = generateHardwareList(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );

    // GAB hardware lines: bisagra×2, jaladera×1, pata×4, tornillo×40, soporte×4
    expect(rows).toEqual([
      {
        hardwareId: IDS.hwBisagra,
        code: 'HER-BIS-CL',
        description: 'Bisagra Cierre Lento',
        unit: 'piece',
        quantity: 2,
        costPerUnit: 35,
        lineCost: 70,
      },
      {
        hardwareId: IDS.hwJaladera,
        code: 'HER-JAL-INOX',
        description: 'Jaladera Acero Inox',
        unit: 'piece',
        quantity: 1,
        costPerUnit: 45,
        lineCost: 45,
      },
      {
        hardwareId: IDS.hwPata,
        code: 'HER-PATA-REG',
        description: 'Pata Regulable Plastica',
        unit: 'piece',
        quantity: 4,
        costPerUnit: 15,
        lineCost: 60,
      },
      {
        hardwareId: IDS.hwSoporte,
        code: 'HER-SOP-ENT',
        description: 'Soporte de Entrepaño',
        unit: 'piece',
        quantity: 4,
        costPerUnit: 2,
        lineCost: 8,
      },
      {
        hardwareId: IDS.hwTornillo,
        code: 'HER-TOR-4X50',
        description: 'Tornillo 4x50 mm',
        unit: 'piece',
        quantity: 40,
        costPerUnit: 0.5,
        lineCost: 20,
      },
    ]);
  });

  it('aggregates by hardwareId across items (same module ×2 doubles qty)', () => {
    const project: Project = {
      ...gabOnlyProject,
      items: [
        {
          id: 'item-gab-a',
          moduleId: IDS.modGab,
          quantity: 1,
          optionChoices: plantillaChoices,
        },
        {
          id: 'item-gab-b',
          moduleId: IDS.modGab,
          quantity: 1,
          optionChoices: plantillaChoices,
        },
      ],
    };

    const single = generateHardwareList(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    const doubled = generateHardwareList(project, plantillaCatalogWithModules);

    expect(doubled).toHaveLength(single.length);
    for (let i = 0; i < single.length; i++) {
      expect(doubled[i]!.hardwareId).toBe(single[i]!.hardwareId);
      expect(doubled[i]!.quantity).toBe(single[i]!.quantity * 2);
      expect(doubled[i]!.lineCost).toBe(single[i]!.lineCost * 2);
    }
  });

  it('multiplies line qty by project item quantity', () => {
    const project: Project = {
      ...gabOnlyProject,
      items: [
        {
          id: 'item-gab',
          moduleId: IDS.modGab,
          quantity: 3,
          optionChoices: plantillaChoices,
        },
      ],
    };

    const rows = generateHardwareList(project, plantillaCatalogWithModules);
    const bisagra = rows.find((r) => r.hardwareId === IDS.hwBisagra);
    expect(bisagra?.quantity).toBe(6); // 2 × 3
    expect(bisagra?.lineCost).toBe(210);
  });

  it('does not include board materials', () => {
    const rows = generateHardwareList(
      plantillaProject,
      plantillaCatalogWithModules,
    );
    const boardCodes = plantillaCatalogWithModules.materials.map((m) => m.code);
    for (const row of rows) {
      expect(boardCodes).not.toContain(row.code);
      expect(row.code.startsWith('HER-')).toBe(true);
    }
    // plantilla includes corredera from CAJ
    expect(rows.some((r) => r.hardwareId === IDS.hwCorredera)).toBe(true);
  });

  it('sorts deterministically by code then description', () => {
    const rows = generateHardwareList(
      plantillaProject,
      plantillaCatalogWithModules,
    );
    const codes = rows.map((r) => r.code);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
  });

  it('throws when project has no hardware lines', () => {
    const catalog: Catalog = {
      ...plantillaCatalogWithModules,
      modules: [
        {
          ...modGab01,
          hardwareLines: [],
        },
      ],
    };
    const project: Project = {
      ...gabOnlyProject,
      items: [
        {
          id: 'item-gab',
          moduleId: IDS.modGab,
          quantity: 1,
          optionChoices: plantillaChoices,
        },
      ],
    };

    expect(() => generateHardwareList(project, catalog)).toThrow(
      ValidationError,
    );
    expect(() => generateHardwareList(project, catalog)).toThrow(
      /no hay herrajes para exportar/i,
    );
  });
});

describe('evaluatePartFormula & resolveStructure (F050 / H05)', () => {
  const testEdges: EdgeAssignment[] = [
    { side: 'L1', enabled: false },
    { side: 'L2', enabled: false },
    { side: 'W1', enabled: false },
    { side: 'W2', enabled: false },
  ];

  const mockStructure: Structure = {
    id: 'struct-under-test',
    code: 'EST-TEST',
    name: 'Estructura Test Presets',
    externalDims: { width: 500, height: 720, depth: 560 },
    presets: [
      { id: 'pr-300', name: 'Preset 300', width: 300, height: 720, depth: 560 },
      { id: 'pr-600', name: 'Preset 600', width: 600, height: 720, depth: 560 },
    ],
    // Structures compose Component instances (F053); parts come from the
    // referenced components, expanded by resolveComposedModule.
    components: [
      { componentId: 'comp-costado', quantity: 2 },
      { componentId: 'comp-base', quantity: 1 },
    ],
  };

  describe('evaluatePartFormula', () => {
    const dims = { W: 500, H: 720, D: 560 };

    it('evaluates basic variables and simple arithmetic', () => {
      expect(evaluatePartFormula('W', dims)).toBe(500);
      expect(evaluatePartFormula('H', dims)).toBe(720);
      expect(evaluatePartFormula('D', dims)).toBe(560);
      expect(evaluatePartFormula('W - 36', dims)).toBe(464);
      expect(evaluatePartFormula('W - 2 * 18', dims)).toBe(464);
      expect(evaluatePartFormula('W - 36 - 2', dims)).toBe(462);
      expect(evaluatePartFormula('D - 10', dims)).toBe(550);
      expect(evaluatePartFormula('(W - 36) / 2', dims)).toBe(232);
    });

    it('rounds results to nearest millimeter', () => {
      expect(evaluatePartFormula('W / 3', dims)).toBe(167); // 500 / 3 = 166.67 -> 167
    });

    it('throws ValidationError for invalid characters or injection attempts', () => {
      expect(() => evaluatePartFormula('W + alert(1)', dims)).toThrow(ValidationError);
      expect(() => evaluatePartFormula('W; 100', dims)).toThrow(ValidationError);
      expect(() => evaluatePartFormula('W + X', dims)).toThrow(ValidationError);
    });

    it('throws ValidationError for empty formulas', () => {
      expect(() => evaluatePartFormula('', dims)).toThrow(ValidationError);
      expect(() => evaluatePartFormula('  ', dims)).toThrow(ValidationError);
    });
  });

  describe('resolveStructure', () => {
    it('accepts a valid preset dimension and returns no own board parts', () => {
      // Structures contribute no board parts of their own since F053;
      // pieces come from their component instances (resolveComposedModule).
      const parts = resolveStructure(mockStructure, { width: 300, height: 720, depth: 560 });
      expect(parts).toHaveLength(0);
    });

    it('accepts a valid preset (600)', () => {
      const parts = resolveStructure(mockStructure, { width: 600, height: 720, depth: 560 });
      expect(parts).toHaveLength(0);
    });

    it('accepts any positive dims (commercial allowlist is on Module)', () => {
      const parts = resolveStructure(mockStructure, {
        width: 400,
        height: 720,
        depth: 560,
      });
      expect(parts).toHaveLength(0);
    });

    it('rejects non-positive dimensions', () => {
      expect(() =>
        resolveStructure(mockStructure, { width: 0, height: 720, depth: 560 }),
      ).toThrow(/mayores a 0/i);
    });

    it('does not require structure.presets for stretch validation', () => {
      const structNoPresets: Structure = {
        ...mockStructure,
        presets: [],
      };
      expect(
        resolveStructure(structNoPresets, {
          width: 600,
          height: 720,
          depth: 560,
        }),
      ).toHaveLength(0);
    });
  });

  describe('validateStructure preset checks', () => {
    it('passes validation for valid structure with components and presets', () => {
      expect(() => validateStructure(mockStructure)).not.toThrow();
    });

    it('rejects preset with invalid dimension <= 0', () => {
      const badStruct: Structure = {
        ...mockStructure,
        presets: [{ id: 'bad', width: 0, height: 720, depth: 560 }],
      };
      expect(() => validateStructure(badStruct)).toThrow(ValidationError);
      expect(() => validateStructure(badStruct)).toThrow(/dimensiones del preset/i);
    });
  });
});

// --- Reusable component fixtures (F049 / H07) ---

const MOCK_TEST_EDGES: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: false },
  { side: 'L2', enabled: false },
  { side: 'W1', enabled: false },
  { side: 'W2', enabled: false },
] as const;

const MOCK_STRUCTURE: Structure = {
  id: 'struct-under-test',
  code: 'EST-TEST',
  name: 'Estructura Test Presets',
  externalDims: { width: 500, height: 720, depth: 560 },
  presets: [
    { id: 'pr-300', name: 'Preset 300', width: 300, height: 720, depth: 560 },
    { id: 'pr-600', name: 'Preset 600', width: 600, height: 720, depth: 560 },
  ],
  // Structures compose Component instances (F053); the referenced components
  // are expanded into board parts by resolveComposedModule.
  components: [
    { componentId: 'comp-costado', quantity: 2 },
    { componentId: 'comp-base', quantity: 1 },
  ],
};

const mockComponentCostado: Component = {
  id: 'comp-costado',
  code: 'COM-COS-01',
  name: 'Costado Lateral',
  placement: 'lateral_izquierdo' as ComponentPlacement,
  geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 560, thicknessMm: 18 },
  defaultEdges: MOCK_TEST_EDGES,
  optionRoles: ['board_base'],
  active: true,
};

const mockComponentBase: Component = {
  id: 'comp-base',
  code: 'COM-BAS-01',
  name: 'Base Estructura',
  placement: 'base' as ComponentPlacement,
  geometry: { kind: 'rectangular_board', lengthMm: 464, widthMm: 560, thicknessMm: 18 },
  defaultEdges: MOCK_TEST_EDGES,
  optionRoles: ['board_base'],
  active: true,
};

const ALL_EDGES_PUERTA: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: true },
  { side: 'L2', enabled: true },
  { side: 'W1', enabled: true },
  { side: 'W2', enabled: true },
] as const;

const EDGES_ENTREPANO: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: false },
  { side: 'L2', enabled: false },
  { side: 'W1', enabled: false },
  { side: 'W2', enabled: true },
] as const;

const mockComponentPuerta: Component = {
  id: 'comp-puerta',
  code: 'COM-PUE-01',
  name: 'Puerta',
  placement: 'puerta' as ComponentPlacement,
  geometry: { kind: 'rectangular_board', lengthMm: 717, widthMm: 296, thicknessMm: 18 },
  defaultEdges: ALL_EDGES_PUERTA,
  optionRoles: ['FRENTE'],
  active: true,
};

const mockComponentEntrepano: Component = {
  id: 'comp-entrepano',
  code: 'COM-ENT-01',
  name: 'Entrepaño Regulable',
  placement: 'interno' as ComponentPlacement,
  geometry: { kind: 'rectangular_board', lengthMm: 462, widthMm: 550, thicknessMm: 15 },
  defaultEdges: EDGES_ENTREPANO,
  optionRoles: ['INTERIOR'],
  active: true,
};

function catalogWithComponents(): Catalog {
  return {
    ...miniCatalog(),
    optionGroups: [
      ...miniCatalog().optionGroups,
      {
        id: 'og-frente',
        code: 'FRENTE',
        name: 'Frente',
        kind: 'board',
        required: true,
        optionIds: ['mat-a'],
      },
    ],
  };
}

function miniComposedModule(overrides: Partial<Module> = {}): Module {
  return {
    id: 'mod-comp-test',
    code: 'MOD-COMP-TEST',
    name: 'Composed Module Test',
    structureId: 'struct-under-test',
    externalDims: { width: 600, height: 720, depth: 560 },
    components: [
      { componentId: 'comp-puerta', quantity: 1 },
      { componentId: 'comp-entrepano', quantity: 2 },
    ],
    hardwareLines: [],
    ...overrides,
  };
}

describe('resolveComposedModule', () => {
  it('returns correct board parts for structure components + Puerta×1 + Entrepaño×2', () => {
    const catalog = {
      ...catalogWithComponents(),
      components: [
        mockComponentPuerta,
        mockComponentEntrepano,
        mockComponentCostado,
        mockComponentBase,
      ],
    };
    const dims = { width: 600, height: 720, depth: 560 };

    const result = resolveComposedModule({
      structure: MOCK_STRUCTURE,
      componentInstances: [
        { componentId: 'comp-puerta', quantity: 1 },
        { componentId: 'comp-entrepano', quantity: 2 },
      ],
      catalog,
      dims,
    });

    // Structure component instances: costado×2 + base×1 = 3 expanded parts
    // Module component instances: puerta×1 + entrepaño×2 = 3 expanded parts
    // Total: 6 board parts
    expect(result.boardParts).toHaveLength(6);
    expect(result.hardwareLines).toHaveLength(0);

    // Structure component parts expanded correctly (costado quantity 2)
    const costados = result.boardParts.filter((p) =>
      p.id.startsWith('comp-costado-copy'),
    );
    expect(costados).toHaveLength(2);
    expect(costados[0]!.lengthMm).toBe(720);
    expect(costados[0]!.widthMm).toBe(560);
    expect(costados[0]!.quantity).toBe(1);

    const bases = result.boardParts.filter((p) =>
      p.id.startsWith('comp-base-copy'),
    );
    expect(bases).toHaveLength(1);
    expect(bases[0]!.lengthMm).toBe(464);
    expect(bases[0]!.widthMm).toBe(560);

    // Puerta ×1
    const puerta = result.boardParts.find(
      (p) => p.id === 'comp-puerta-copy-0',
    )!;
    expect(puerta.description).toBe('Puerta');
    expect(puerta.lengthMm).toBe(717);
    expect(puerta.widthMm).toBe(296);
    expect(puerta.quantity).toBe(1);
    expect(puerta.optionRole).toBe('FRENTE');
    expect(puerta.edges).toEqual(ALL_EDGES_PUERTA);

    // Entrepaño ×2
    const ent1 = result.boardParts.find(
      (p) => p.id === 'comp-entrepano-copy-0',
    )!;
    const ent2 = result.boardParts.find(
      (p) => p.id === 'comp-entrepano-copy-1',
    )!;
    expect(ent1).toBeDefined();
    expect(ent2).toBeDefined();
    expect(ent1.lengthMm).toBe(462);
    expect(ent1.widthMm).toBe(550);
    expect(ent1.optionRole).toBe('INTERIOR');
    expect(ent1.edges).toEqual(EDGES_ENTREPANO);
    expect(ent2.lengthMm).toBe(462);
    expect(ent2.optionRole).toBe('INTERIOR');
    expect(ent2.id).not.toBe(ent1.id);
  });

  it('uses instance edge overrides when provided', () => {
    const catalog = {
      ...catalogWithComponents(),
      components: [
        mockComponentPuerta,
        mockComponentCostado,
        mockComponentBase,
      ],
    };
    const overridesEdges: readonly EdgeAssignment[] = [
      { side: 'L1', enabled: true },
      { side: 'L2', enabled: false },
      { side: 'W1', enabled: false },
      { side: 'W2', enabled: false },
    ];

    const result = resolveComposedModule({
      structure: MOCK_STRUCTURE,
      componentInstances: [
        {
          componentId: 'comp-puerta',
          quantity: 1,
          overrides: { edges: overridesEdges },
        },
      ],
      catalog,
      dims: { width: 600, height: 720, depth: 560 },
    });

    const puerta = result.boardParts.find(
      (p) => p.id === 'comp-puerta-copy-0',
    )!;
    expect(puerta.edges).toEqual(overridesEdges);
  });

  it('throws ResolutionError for unknown componentId', () => {
    const catalog = {
      ...catalogWithComponents(),
      components: [mockComponentPuerta],
    };

    expect(() =>
      resolveComposedModule({
        structure: MOCK_STRUCTURE,
        componentInstances: [{ componentId: 'comp-unknown', quantity: 1 }],
        catalog,
        dims: { width: 600, height: 720, depth: 560 },
      }),
    ).toThrow(ResolutionError);
  });
});

describe('resolveBom composed module dispatch', () => {
  it('legacy module (no structureId) resolves exactly as before', () => {
    const bom = resolveBom(modGab01, plantillaChoices, plantillaCatalogWithModules);

    // Assert exact same output as pre-change golden behavior
    // Pieces come from expanded components; find by description (component name).
    const puerta = bom.boardParts.find((p) => p.description === 'Puerta Gabinete');
    const costado = bom.boardParts.find((p) => p.description === 'Costado Gabinete');
    const bisagra = bom.hardwareLines.find((h) => h.id === 'gab-h01');

    expect(costado?.materialId).toBe(IDS.matArauco);
    expect(costado?.edgeBandId).toBe(IDS.edgeArauco);
    expect(puerta?.materialId).toBe(IDS.matMaderado);
    expect(puerta?.edgeBandId).toBe(IDS.edgeMaderado);
    expect(bisagra?.hardwareId).toBe(IDS.hwBisagra);
  });

  it('throws ResolutionError for unknown structureId', () => {
    const module = miniComposedModule({
      structureId: 'struct-unknown',
    });
    const catalog: Catalog = {
      ...catalogWithComponents(),
      structures: [],
      components: [mockComponentPuerta, mockComponentEntrepano],
      modules: [module],
    };

    expect(() =>
      resolveBom(module, { FRENTE: 'mat-a', INTERIOR: 'mat-a' }, catalog),
    ).toThrow(ResolutionError);
  });

  it('throws ResolutionError when composed module has no externalDims', () => {
    const module = miniComposedModule({
      externalDims: undefined,
    });
    const catalog: Catalog = {
      ...catalogWithComponents(),
      structures: [MOCK_STRUCTURE],
      components: [mockComponentPuerta, mockComponentEntrepano],
      modules: [module],
    };

    expect(() =>
      resolveBom(module, { FRENTE: 'mat-a', INTERIOR: 'mat-a' }, catalog),
    ).toThrow(ResolutionError);
  });

  it('resolves composed module through resolveBom with correct part count and materials', () => {
    const catalog: Catalog = {
      ...catalogWithComponents(),
      structures: [MOCK_STRUCTURE],
      components: [
        mockComponentPuerta,
        mockComponentEntrepano,
        mockComponentCostado,
        mockComponentBase,
      ],
    };
    const module = miniComposedModule();
    const fullCatalog: Catalog = { ...catalog, modules: [module] };

    const bom = resolveBom(
      module,
      { board_base: 'mat-a', FRENTE: 'mat-a', INTERIOR: 'mat-a' },
      fullCatalog,
    );

    // Structure components: costado×2 + base×1 = 3 expanded parts
    // Module components: puerta×1 + entrepaño×2 = 3 expanded parts
    // Total: 6 board parts
    expect(bom.boardParts).toHaveLength(6);
    expect(bom.hardwareLines).toHaveLength(0);

    // Verify structure component parts have materials
    const costados = bom.boardParts.filter((p) =>
      p.id.startsWith('comp-costado-copy'),
    );
    expect(costados).toHaveLength(2);
    for (const c of costados) {
      expect(c.materialId).toBe('mat-a');
      expect(c.optionRole).toBe('board_base');
    }

    // Verify module component parts have materials
    const puerta = bom.boardParts.find(
      (p) => p.id === 'comp-puerta-copy-0',
    )!;
    expect(puerta.materialId).toBe('mat-a');
    expect(puerta.optionRole).toBe('FRENTE');
    expect(puerta.grain).toBe(0);

    const entrepanos = bom.boardParts.filter((p) =>
      p.id.startsWith('comp-entrepano-copy'),
    );
    expect(entrepanos).toHaveLength(2);
    for (const e of entrepanos) {
      expect(e.materialId).toBe('mat-a');
      expect(e.optionRole).toBe('INTERIOR');
    }
  });
});

describe('golden: composed module cost (F049 / H07)', () => {
  it('mixed BOM project with legacy + composed modules resolves all correctly', () => {
    // Build a catalog with hardware modGab01 needs (must match fixture IDs)
    const catalog: Catalog = {
      ...catalogWithComponents(),
      hardware: [
        {
          id: 'hw-bisagra-cierre-lento',
          code: 'HW-BIS-CL',
          name: 'Bisagra Cierre Lento',
          unit: 'piece',
          costPerUnit: 35,
          active: true,
        },
        {
          id: 'hw-jaladera-acero',
          code: 'HW-JAL-INOX',
          name: 'Jaladera Acero Inox',
          unit: 'piece',
          costPerUnit: 45,
          active: true,
        },
        {
          id: 'hw-pata-regulable',
          code: 'HW-PATA-REG',
          name: 'Pata Regulable Plastica',
          unit: 'piece',
          costPerUnit: 15,
          active: true,
        },
        {
          id: 'hw-tornillo-4x50',
          code: 'HW-TOR-4X50',
          name: 'Tornillo 4x50 mm',
          unit: 'piece',
          costPerUnit: 0.5,
          active: true,
        },
        {
          id: 'hw-soporte-entrepano',
          code: 'HW-SOP-ENT',
          name: 'Soporte de Entrepaño',
          unit: 'piece',
          costPerUnit: 2,
          active: true,
        },
      ],
      optionGroups: [
        ...catalogWithComponents().optionGroups,
        {
          id: 'og-bisagra-test',
          code: 'BISAGRA',
          name: 'Bisagra',
          kind: 'hardware',
          required: true,
          optionIds: ['hw-bisagra-cierre-lento'],
        },
      ],
      structures: [MOCK_STRUCTURE],
      components: [
        mockComponentPuerta,
        mockComponentEntrepano,
        mockComponentCostado,
        mockComponentBase,
      ],
    };
    const composedMod = miniComposedModule();
    const fullCatalog: Catalog = {
      ...catalog,
      modules: [modGab01, composedMod],
    };

    const opts = {
      FRENTE: 'mat-a',
      INTERIOR: 'mat-a',
      board_base: 'mat-a',
      BISAGRA: 'hw-bisagra-cierre-lento',
    };

    // modGab01 is now itself a composed module (struct-gab-01 + components).
    // It resolves against the plantilla catalog that carries its structure.
    const gabBom = resolveBom(modGab01, plantillaChoices, plantillaCatalogWithModules);
    expect(gabBom.boardParts.length).toBeGreaterThan(0);

    const puertaGab = gabBom.boardParts.find(
      (p) => p.description === 'Puerta Gabinete',
    );
    expect(puertaGab?.materialId).toBe(IDS.matMaderado);
    expect(puertaGab?.optionRole).toBe('FRENTE');

    const costadoGab = gabBom.boardParts.find(
      (p) => p.description === 'Costado Gabinete',
    );
    expect(costadoGab?.materialId).toBe(IDS.matArauco);
    expect(costadoGab?.optionRole).toBe('INTERIOR');

    // Mock composed module resolves with correct structure + component parts
    const composedBom = resolveBom(composedMod, opts, fullCatalog);
    // Structure components: costado×2 + base×1 = 3 expanded parts
    // Module components: puerta×1 + entrepaño×2 = 3 expanded parts
    // Total: 6 board parts
    expect(composedBom.boardParts).toHaveLength(6);

    // Composed module has no hardware lines (deferred from MVP)
    expect(composedBom.hardwareLines).toHaveLength(0);

    // Both composed modules resolve without error
    expect(gabBom.boardParts.length).toBe(8);
    expect(composedBom.boardParts.length).toBe(6);
  });

  it('seed composed module resolves through resolveBom with correct part count', () => {
    const bom = resolveBom(
      seedComposedModule,
      plantillaChoices,
      plantillaCatalogWithModules,
      'mod-preset-600',
    );

    // Structure components: costado×2 + base×1 = 3 expanded parts
    // Module components: puerta×1 + entrepaño×2 = 3 expanded parts
    // Total: 6 board parts
    expect(bom.boardParts).toHaveLength(6);

    // Verify module component parts resolved
    const puerta = bom.boardParts.find(
      (p) => p.id === 'seed-comp-puerta-copy-0',
    );
    expect(puerta).toBeDefined();
    expect(puerta!.optionRole).toBe('FRENTE');

    const entrepanos = bom.boardParts.filter((p) =>
      p.id.startsWith('seed-comp-entrepano-copy'),
    );
    expect(entrepanos).toHaveLength(2);

    // Verify structure component parts resolved
    const costados = bom.boardParts.filter((p) =>
      p.id.startsWith('seed-comp-costado-copy'),
    );
    expect(costados).toHaveLength(2);
    expect(costados[0]!.optionRole).toBe('INTERIOR');
  });

  it('composed module through calcProjectBreakdown produces expected cost', () => {
    const catalog: Catalog = {
      ...catalogWithComponents(),
      structures: [MOCK_STRUCTURE],
      components: [
        mockComponentPuerta,
        mockComponentEntrepano,
        mockComponentCostado,
        mockComponentBase,
      ],
    };
    const module = miniComposedModule();
    const fullCatalog: Catalog = { ...catalog, modules: [module] };

    const project: Project = {
      id: 'proj-comp-golden',
      name: 'Composed Module Golden',
      customerId: 'C',
      currency: 'MXN',
      marginFactor: 1.0,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'item-comp',
          moduleId: module.id,
          quantity: 1,
          optionChoices: {
            board_base: 'mat-a',
            FRENTE: 'mat-a',
            INTERIOR: 'mat-a',
          },
        },
      ],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };

    const breakdown = calcProjectBreakdown(project, fullCatalog);

    // All parts use mat-a which has costPerM2=100. Component geometry is FIXED
    // in this phase (parametric formulas land in Fase 3).
    // Structure components: costado×2 (720×560), base×1 (464×560)
    //   costado area = 2 * (720*560)/1e6 = 0.8064 m2
    //   base area    = 1 * (464*560)/1e6 = 0.25984 m2
    // Module components: puerta×1 (717×296), entrepaño×2 (462×550)
    //   puerta area  = 1 * (717*296)/1e6 = 0.212232 m2
    //   entrepanos   = 2 * (462*550)/1e6 = 0.5082 m2
    //   Total = 1.786672 m2 * 100 = 178.6672
    expect(breakdown.materialsCost).toBeCloseTo(178.6672, 2);
    expect(breakdown.directCost).toBeGreaterThan(0);

    // No hardware on any parts
    expect(breakdown.hardwareTotal).toBe(0);

    // Edge cost: costado/base have no edges; Puerta (all 4 edges, costPerMl=10)
    // plus 2× Entrepaño (W2 only, 462×550).
    // Puerta: (2×717 + 2×296)/1000 × 10 = 20.26
    // Entrepaño×2: 2 × (550/1000) × 10 = 11.0
    expect(breakdown.edgeTotal).toBeCloseTo(31.26, 2);

    // No labor
    expect(breakdown.laborModular).toBe(0);
    expect(breakdown.laborFixedCost).toBe(0);

    // With marginFactor=1.0, salePrice = directCost
    expect(breakdown.salePrice).toBeCloseTo(breakdown.directCost, 6);
  });
});


describe('resolveBom with Module measure presets (H09 / #104)', () => {
  const parametricBase: Component = {
    id: 'comp-base-param',
    code: 'COM-BAS-P',
    name: 'Base paramétrica',
    placement: 'base',
    geometry: {
      kind: 'rectangular_board',
      lengthMm: 464,
      widthMm: 560,
      thicknessMm: 18,
      lengthFormula: 'W-36',
      widthFormula: 'D',
    },
    defaultEdges: MOCK_TEST_EDGES,
    optionRoles: ['board_base'],
    active: true,
  };

  const structure: Structure = {
    id: 'st-param',
    code: 'EST-PARAM',
    name: 'Cuerpo paramétrico',
    externalDims: { width: 500, height: 720, depth: 560 },
    components: [{ componentId: 'comp-base-param', quantity: 1 }],
  };

  const commercialPresets = [
    { id: 'p300', name: '300', width: 300, height: 720, depth: 560 },
    { id: 'p600', name: '600', width: 600, height: 720, depth: 560 },
  ] as const;

  function catalogFor(module: Module): Catalog {
    return {
      ...catalogWithComponents(),
      structures: [structure],
      components: [parametricBase],
      modules: [module],
    };
  }

  it('same furniture template, two widths → two different despieces', () => {
    const module: Module = {
      id: 'mod-h09',
      code: 'MOD-H09',
      name: 'Gabinete H09',
      structureId: 'st-param',
      presets: [...commercialPresets],
      hardwareLines: [],
    };
    const catalog = catalogFor(module);
    const choices = { board_base: 'mat-a' };

    const bom300 = resolveBom(module, choices, catalog, 'p300');
    const bom600 = resolveBom(module, choices, catalog, 'p600');

    expect(bom300.boardParts[0]!.lengthMm).toBe(264);
    expect(bom600.boardParts[0]!.lengthMm).toBe(564);
  });

  it('rejects invalid measure preset on the module', () => {
    const module: Module = {
      id: 'mod-h09',
      code: 'MOD-H09',
      name: 'Gabinete H09',
      structureId: 'st-param',
      presets: [...commercialPresets],
      hardwareLines: [],
    };
    expect(() =>
      resolveBom(module, { board_base: 'mat-a' }, catalogFor(module), 'p999'),
    ).toThrow(/no es válido/i);
  });

  it('two quote lines with different presets yield different sale prices', () => {
    const module: Module = {
      id: 'mod-h09',
      code: 'MOD-H09',
      name: 'Gabinete H09',
      structureId: 'st-param',
      presets: [...commercialPresets],
      hardwareLines: [],
      baseLaborCost: 0,
    };
    const catalog = catalogFor(module);
    const baseProject = {
      id: 'prj',
      name: 'P',
      customerId: 'c1',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const p300 = {
      ...baseProject,
      items: [
        {
          id: 'i1',
          moduleId: 'mod-h09',
          quantity: 1,
          optionChoices: { board_base: 'mat-a' },
          measurePresetId: 'p300',
        },
      ],
    };
    const p600 = {
      ...baseProject,
      id: 'prj2',
      items: [
        {
          id: 'i1',
          moduleId: 'mod-h09',
          quantity: 1,
          optionChoices: { board_base: 'mat-a' },
          measurePresetId: 'p600',
        },
      ],
    };
    const price300 = calcProjectBreakdown(p300, catalog).salePrice;
    const price600 = calcProjectBreakdown(p600, catalog).salePrice;
    expect(price600).toBeGreaterThan(price300);
  });
});

describe('3D Component spatial positioning & CAD variables', () => {
  it('evaluates parent vs component dimensions and index variable correctly in evaluatePartFormula', () => {
    const dims = { W: 100, H: 20, D: 50, PW: 600, PH: 720, PD: 560, T: 18, i: 1 };
    expect(evaluatePartFormula('PW - W', dims)).toBe(500);
    expect(evaluatePartFormula('i * (PW - T)', dims)).toBe(582);
    expect(evaluatePartFormula('PD - D', dims)).toBe(510);
    expect(evaluatePartFormula('PH - H', dims)).toBe(700);
    expect(evaluatePartFormula('T * 2', dims)).toBe(36);
  });

  it('resolves composed module with X, Y, Z coordinates and rotations', () => {
    const compCostado: Component = {
      id: 'c-costado',
      code: 'C-COS',
      name: 'Costado',
      placement: 'lateral_izquierdo',
      geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 560, thicknessMm: 18, lengthFormula: 'PH', widthFormula: 'PD' },
      defaultEdges: MOCK_TEST_EDGES,
      optionRoles: ['board_base'],
      active: true,
      xFormula: 'i * (PW - T)',
      yFormula: '0',
      zFormula: '0',
      rotateY: 90,
    };

    const compPiso: Component = {
      id: 'c-piso',
      code: 'C-PIS',
      name: 'Piso',
      placement: 'base',
      geometry: { kind: 'rectangular_board', lengthMm: 560, widthMm: 464, thicknessMm: 18, lengthFormula: 'PD', widthFormula: 'PW - 2*T' },
      defaultEdges: MOCK_TEST_EDGES,
      optionRoles: ['board_base'],
      active: true,
      xFormula: 'T',
      yFormula: '0',
      zFormula: '0',
    };

    const catalog = {
      ...catalogWithComponents(),
      components: [compCostado, compPiso],
    };

    const structure: Structure = {
      id: 'st-3d',
      code: 'EST-3D',
      name: 'Estructura 3D',
      externalDims: { width: 600, height: 720, depth: 560 },
      components: [
        { componentId: 'c-costado', quantity: 2 },
        { componentId: 'c-piso', quantity: 1 },
      ],
    };

    const result = resolveComposedModule({
      structure,
      componentInstances: [],
      catalog,
      dims: { width: 600, height: 720, depth: 560 },
      optionChoices: { board_base: 'mat-a' }, // mat-a has thicknessMm: 18
    });

    expect(result.boardParts).toHaveLength(3);

    // Left costado (i = 0)
    const cost1 = result.boardParts[0]!;
    expect(cost1.x).toBe(0);
    expect(cost1.y).toBe(0);
    expect(cost1.z).toBe(0);
    expect(cost1.rotateY).toBe(90);

    // Right costado (i = 1)
    const cost2 = result.boardParts[1]!;
    expect(cost2.x).toBe(600 - 15); // PW - T
    expect(cost2.y).toBe(0);
    expect(cost2.z).toBe(0);
    expect(cost2.rotateY).toBe(90);

    // Piso
    const piso = result.boardParts[2]!;
    expect(piso.widthMm).toBe(600 - 2*15); // PW - 2*T = 570
    expect(piso.lengthMm).toBe(560);
    expect(piso.x).toBe(15); // T
    expect(piso.y).toBe(0);
    expect(piso.z).toBe(0);
  });
});

