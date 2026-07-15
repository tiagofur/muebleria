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
} from './__fixtures__/plantillaDemo';
import {
  calcBoardLineCost,
  calcHardwareLineCost,
  calcLineCost,
  calcProjectBreakdown,
  captureQuoteSnapshot,
  generateCutRows,
  generateHardwareList,
  isProjectClosed,
  resolveBom,
  transitionProjectStatus,
  validateCatalogEntityCodes,
  validateModule,
} from './engine';
import { ResolutionError, ValidationError } from './errors';
import type {
  Catalog,
  EdgeAssignment,
  Module,
  Project,
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
    modules: [],
  };
  return { ...base, ...overrides };
}

function miniModule(overrides: Partial<Module> = {}): Module {
  return {
    id: 'mod-1',
    code: 'MOD-TEST',
    name: 'Test module',
    boardParts: [
      {
        id: 'p1',
        code: 'MOD-TEST-P01',
        description: 'Side',
        quantity: 1,
        lengthMm: 1000,
        widthMm: 500,
        grain: 0,
        edges: ALL_EDGES,
        optionRole: 'INTERIOR',
      },
    ],
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
    const catalog = miniCatalog();
    const module = miniModule({
      boardParts: [
        {
          id: 'p-no-edge',
          description: 'Back',
          quantity: 1,
          lengthMm: 100,
          widthMm: 100,
          grain: 0,
          edges: NO_EDGES,
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [],
    });

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
          wastePercent: 10,
          costPerM2: 110,
          active: true,
        },
      ],
    });
    const module = miniModule({
      boardParts: [
        {
          id: 'p1',
          description: 'Panel',
          quantity: 1,
          lengthMm: 1000,
          widthMm: 1000,
          grain: 0,
          edges: NO_EDGES,
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [],
    });
    const bom = resolveBom(module, { INTERIOR: 'mat-a' }, catalog);
    const cost = calcBoardLineCost(bom.boardParts[0]!, catalog);
    expect(cost.areaM2).toBeCloseTo(1, 6);
    expect(cost.boardCost).toBeCloseTo(110, 6);
  });

  it('calculates boardCost without waste when wastePercent is 0', () => {
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
    const module = miniModule({
      boardParts: [
        {
          id: 'p1',
          description: 'Panel',
          quantity: 1,
          lengthMm: 1000,
          widthMm: 500,
          grain: 0,
          edges: NO_EDGES,
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [],
    });
    const bom = resolveBom(module, { INTERIOR: 'mat-a' }, catalog);
    const cost = calcBoardLineCost(bom.boardParts[0]!, catalog);
    // area=0.5, cost=100 = 50
    expect(cost.boardCost).toBeCloseTo(50, 6);
  });

  it('computes hardwareCost = qty * costPerUnit', () => {
    const catalog = miniCatalog();
    const module = miniModule({
      boardParts: [
        {
          id: 'p1',
          description: 'Panel',
          quantity: 1,
          lengthMm: 100,
          widthMm: 100,
          grain: 0,
          edges: NO_EDGES,
          optionRole: 'INTERIOR',
        },
      ],
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
    const module = miniModule({
      baseLaborCost: 150,
      boardParts: [
        {
          id: 'p1',
          description: 'Panel',
          quantity: 1,
          lengthMm: 1000,
          widthMm: 1000,
          grain: 0,
          edges: NO_EDGES,
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [
        { id: 'h1', quantity: 2, optionRole: 'BISAGRA' },
      ],
    });
    const catalog = miniCatalog({ modules: [module] });
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
          moduleId: module.id,
          quantity: 2,
          optionChoices: { INTERIOR: 'mat-a', BISAGRA: 'hw-a' },
        },
      ],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };

    // per module unit: board=100, hw=40, direct=140; ×2 items
    // laborModular = 2 * 150 = 300
    // sale = 280 * 1.35 + 300 + 500 = 1178
    const breakdown = calcProjectBreakdown(project, catalog);
    expect(breakdown.materialsCost).toBeCloseTo(200, 6);
    expect(breakdown.hardwareTotal).toBeCloseTo(80, 6);
    expect(breakdown.edgeTotal).toBeCloseTo(0, 6);
    expect(breakdown.directCost).toBeCloseTo(280, 6);
    expect(breakdown.laborModular).toBe(300);
    expect(breakdown.laborFixedCost).toBe(500);
    expect(breakdown.salePrice).toBeCloseTo(1178, 6);
  });

  it('treats missing baseLaborCost as 0', () => {
    const module = miniModule({
      baseLaborCost: undefined,
      boardParts: [
        {
          id: 'p1',
          description: 'Panel',
          quantity: 1,
          lengthMm: 1000,
          widthMm: 1000,
          grain: 0,
          edges: NO_EDGES,
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [],
    });
    const catalog = miniCatalog({ modules: [module] });
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

    const breakdown = calcProjectBreakdown(project, catalog);
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

  it('isProjectClosed is true for quoted and accepted only', () => {
    expect(isProjectClosed('draft')).toBe(false);
    expect(isProjectClosed('quoted')).toBe(true);
    expect(isProjectClosed('accepted')).toBe(true);
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
    const module = miniModule({
      boardParts: [
        {
          id: 'p-bad',
          description: 'Bad',
          quantity: 1,
          lengthMm: 0,
          widthMm: 100,
          grain: 0,
          edges: NO_EDGES,
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [],
    });
    expect(() =>
      resolveBom(module, { INTERIOR: 'mat-a' }, miniCatalog()),
    ).toThrow(ValidationError);
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

    const puerta = bom.boardParts.find((p) => p.code === 'MOD-GAB-01-P08');
    const costado = bom.boardParts.find((p) => p.code === 'MOD-GAB-01-P01');
    const bisagra = bom.hardwareLines.find((h) => h.id === 'gab-h01');

    expect(costado?.materialId).toBe(IDS.matArauco);
    expect(costado?.edgeBandId).toBe(IDS.edgeArauco);
    expect(puerta?.materialId).toBe(IDS.matMaderado);
    expect(puerta?.edgeBandId).toBe(IDS.edgeMaderado);
    expect(bisagra?.hardwareId).toBe(IDS.hwBisagra);
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
    const costado = rows.find((r) => r.description === 'Costado Derecho');
    // part.quantity = 1 × item.quantity = 3
    expect(costado?.quantity).toBe(3);
  });

  it('EXP-05: never includes hardware lines', () => {
    const rows = generateCutRows(gabOnlyProject, plantillaCatalogWithModules);
    expect(rows).toHaveLength(modGab01.boardParts.length);
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
      (r) => r.description === 'Frente de Cajón',
    );
    const gabPuertaIdx = full.findIndex(
      (r) => r.description === 'Puerta Gabinete',
    );
    expect(cajPuertaIdx).toBeGreaterThanOrEqual(0);
    expect(gabPuertaIdx).toBeGreaterThan(cajPuertaIdx);

    // Within one module: part codes P01..P08
    const gabOnly = generateCutRows(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    expect(gabOnly.map((r) => r.description)).toEqual([
      'Costado Derecho',
      'Costado Izquierdo',
      'Respaldo Gabinete',
      'Piso Gabinete',
      'Entrepano Gabinete',
      'Manguete Frontal',
      'Manguete Posterior',
      'Puerta Gabinete',
    ]);
  });

  it('maps material name, grain and edge flags from resolved BOM', () => {
    const rows = generateCutRows(gabOnlyProject, plantillaCatalogWithModules);
    const costado = rows.find((r) => r.description === 'Costado Derecho');
    const puerta = rows.find((r) => r.description === 'Puerta Gabinete');
    const respaldo = rows.find((r) => r.description === 'Respaldo Gabinete');

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
      boardParts: [],
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
