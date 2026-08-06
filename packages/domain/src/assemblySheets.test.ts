import { describe, expect, it } from 'vitest';
import type { Catalog, Project } from './types';
import { buildAssemblySheets } from './assemblySheets';

const catalog = {
  materials: [],
  edges: [],
  hardware: [
    {
      id: 'hw1',
      code: 'BIS-35',
      name: 'Bisagra 35',
      unit: 'unit',
      costPerUnit: 1,
      active: true,
    },
  ],
  optionGroups: [],
  modules: [
    {
      id: 'm1',
      code: 'GAB-01',
      name: 'Gabinete',
      active: true,
      externalDims: { width: 600, height: 720, depth: 560 },
      boardParts: [
        {
          id: 'bp1',
          description: 'Lat',
          quantity: 2,
          lengthMm: 720,
          widthMm: 560,
          grain: 0,
          edges: [],
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [{ id: 'hl1', hardwareId: 'hw1', quantity: 2 }],
    },
  ],
} as unknown as Catalog;

function project(): Project {
  return {
    id: 'p1',
    name: 'Obra',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      {
        id: 'i1',
        moduleId: 'm1',
        quantity: 2,
        optionChoices: {},
        floorStatus: 'cut',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

describe('buildAssemblySheets (PROD-4.1)', () => {
  it('builds sheet with measures, floor status and hardware', () => {
    const sheets = buildAssemblySheets(project(), catalog);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.factoryCode).toBe('GAB-01');
    expect(sheets[0]!.quantity).toBe(2);
    expect(sheets[0]!.floorStatus).toBe('cut');
    expect(sheets[0]!.hardware[0]!.code).toBe('BIS-35');
    expect(sheets[0]!.hardware[0]!.quantity).toBe(4); // 2 * 2
    expect(typeof sheets[0]!.boardPartLines).toBe('number');
  });
});
