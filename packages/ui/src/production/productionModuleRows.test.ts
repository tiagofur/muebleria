import { describe, expect, it } from 'vitest';
import type { Module, Project, ProductionCutRow } from '@muebles/domain';
import { buildProductionModuleRows } from './productionModuleRows';

const modules: Module[] = [
  {
    id: 'm1',
    code: 'GAB-01',
    name: 'Gabinete base',
    active: true,
    externalDims: { width: 600, height: 720, depth: 560 },
    boardParts: [],
    hardwareLines: [],
  } as Module,
  {
    id: 'm2',
    code: 'ALT-01',
    name: 'Alacena',
    active: true,
    externalDims: { width: 800, height: 720, depth: 350 },
    boardParts: [],
    hardwareLines: [],
  } as Module,
];

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Obra',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      { id: 'i1', moduleId: 'm1', quantity: 2, optionChoices: {} },
      { id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {} },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

describe('buildProductionModuleRows (PROD-0.4)', () => {
  it('builds factory codes and measures', () => {
    const rows = buildProductionModuleRows(project(), modules);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.factoryCode).toBe('GAB-01');
    expect(rows[0]!.quantity).toBe(2);
    expect(rows[0]!.measuresLabel).toContain('600');
    expect(rows[1]!.factoryCode).toBe('ALT-01');
  });

  it('suffixes factory code when same module appears twice', () => {
    const rows = buildProductionModuleRows(
      project({
        items: [
          { id: 'a', moduleId: 'm1', quantity: 1, optionChoices: {} },
          { id: 'b', moduleId: 'm1', quantity: 1, optionChoices: {} },
        ],
      }),
      modules,
    );
    expect(rows[0]!.factoryCode).toBe('GAB-01');
    expect(rows[1]!.factoryCode).toBe('GAB-01-L2');
  });

  it('marks unplaced when kitchen layout has walls but item not placed', () => {
    const rows = buildProductionModuleRows(
      project({
        kitchenLayout: {
          walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0, name: 'Muro A' }],
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
      }),
      modules,
    );
    expect(rows[0]!.unplaced).toBe(false);
    expect(rows[0]!.placementLabel).toContain('Muro A');
    expect(rows[1]!.unplaced).toBe(true);
    expect(rows[1]!.placementLabel).toBe('Sin colocar');
  });

  it('counts pieces by moduleCode from cut rows', () => {
    const cut: ProductionCutRow[] = [
      {
        quantity: 2,
        lengthMm: 700,
        widthMm: 500,
        description: 'Lat',
        materialName: 'Blanco',
        grain: 0,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
        moduleCode: 'GAB-01',
      },
      {
        quantity: 1,
        lengthMm: 600,
        widthMm: 500,
        description: 'Fondo',
        materialName: 'Blanco',
        grain: 0,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
        moduleCode: 'GAB-01',
      },
    ];
    const rows = buildProductionModuleRows(project(), modules, cut);
    expect(rows[0]!.pieceCount).toBe(3);
    expect(rows[1]!.pieceCount).toBe(0);
  });
});
