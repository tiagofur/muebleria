import { describe, expect, it } from 'vitest';
import type { Catalog, Project } from './types';
import { generateModuleLabels } from './moduleLabels';
import { ResolutionError, ValidationError } from './errors';

const catalog: Catalog = {
  materials: [
    {
      id: 'mat1',
      code: 'TAB-1',
      name: 'Melamina Blanca 18mm',
      thickness: 18,
      costPerM2: 250,
      width: 2440,
      height: 1830,
      active: true,
    },
  ],
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
      name: 'Bajo Fregadero',
      active: true,
      externalDims: { width: 800, height: 850, depth: 600 },
      boardParts: [
        {
          id: 'bp1',
          description: 'Lateral',
          materialId: 'mat1',
          quantity: 2,
          lengthMm: 850,
          widthMm: 600,
          grain: 0,
          edges: [],
          optionRole: 'INTERIOR',
        },
        {
          id: 'bp2',
          description: 'Piso',
          materialId: 'mat1',
          quantity: 1,
          lengthMm: 764,
          widthMm: 600,
          grain: 0,
          edges: [],
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [{ id: 'hl1', hardwareId: 'hw1', quantity: 4 }],
    },
    {
      id: 'm2',
      code: 'ALAC-01',
      name: 'Alacena Superior',
      active: true,
      presets: [
        {
          id: 'pre-1',
          name: 'Estándar',
          width: 600,
          height: 720,
          depth: 350,
        },
      ],
      boardParts: [
        {
          id: 'bp3',
          description: 'Puerta',
          materialId: 'mat1',
          quantity: 2,
          lengthMm: 716,
          widthMm: 296,
          grain: 1,
          edges: [],
          optionRole: 'FRENTE',
        },
      ],
      hardwareLines: [],
    },
  ],
} as unknown as Catalog;

function createProject(): Project {
  return {
    id: 'proj-123',
    name: 'Cocina Residencial',
    customerId: 'cust-456',
    currency: 'USD',
    marginFactor: 1.4,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      {
        id: 'item-1',
        moduleId: 'm1',
        quantity: 2,
        optionChoices: {},
        floorStatus: 'cut',
      },
      {
        id: 'item-2',
        moduleId: 'm2',
        quantity: 1,
        measurePresetId: 'pre-1',
        optionChoices: {},
        floorStatus: 'pending',
      },
    ],
    kitchenLayout: {
      walls: [
        { id: 'w1', name: 'Muro Norte', lengthMm: 3000, angleDeg: 0 },
      ],
      spaces: [
        {
          id: 'space-1',
          name: 'Cocina Principal',
          walls: [
            { id: 'w1', name: 'Muro Norte', lengthMm: 3000, angleDeg: 0 },
          ],
          placements: [],
        },
      ],
      placements: [
        {
          itemId: 'item-1',
          instanceIndex: 0,
          wallId: 'w1',
          offsetMm: 0,
          elevation: 'floor',
        },
        {
          itemId: 'item-1',
          instanceIndex: 1,
          wallId: 'w1',
          offsetMm: 800,
          elevation: 'floor',
        },
        {
          itemId: 'item-2',
          instanceIndex: 0,
          wallId: '',
          offsetMm: 0,
          elevation: 'wall',
          mode: 'free',
        },
      ],
    },
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

describe('moduleLabels domain generator', () => {
  it('generates physical module labels with bulto package numbering', () => {
    const proj = createProject();
    const labels = generateModuleLabels(proj, catalog, {
      customerName: 'Cliente Juan Pérez',
      revision: '3',
    });

    // item-1 has qty 2, item-2 has qty 1 -> Total 3 physical packages
    expect(labels).toHaveLength(3);

    // Label 1: First copy of Bajo Fregadero
    expect(labels[0]).toMatchObject({
      itemId: 'item-1',
      factoryCode: 'GAB-01',
      moduleCode: 'GAB-01',
      moduleName: 'Bajo Fregadero',
      projectId: 'proj-123',
      projectName: 'Cocina Residencial',
      customerName: 'Cliente Juan Pérez',
      packageIndex: 1,
      totalPackages: 3,
      unitIndex: 1,
      unitQuantity: 2,
      widthMm: 800,
      heightMm: 850,
      depthMm: 600,
      measuresLabel: '800×850×600 mm',
      spaceName: 'Cocina Principal',
      wallName: 'Muro Norte',
      floorStatus: 'cut',
      boardPartCount: 0,
      hardwareCount: 4,
      revision: '3',
    });

    // Label 2: Second copy of Bajo Fregadero
    expect(labels[1]).toMatchObject({
      itemId: 'item-1',
      factoryCode: 'GAB-01',
      packageIndex: 2,
      totalPackages: 3,
      unitIndex: 2,
      unitQuantity: 2,
      wallName: 'Muro Norte',
    });

    // Label 3: Alacena Superior (preset dimensions + free island placement)
    expect(labels[2]).toMatchObject({
      itemId: 'item-2',
      factoryCode: 'ALAC-01',
      packageIndex: 3,
      totalPackages: 3,
      unitIndex: 1,
      unitQuantity: 1,
      widthMm: 600,
      heightMm: 720,
      depthMm: 350,
      measuresLabel: '600×720×350 mm',
      spaceName: 'Isla / Libre',
      boardPartCount: 0,
      hardwareCount: 0,
    });
  });

  it('handles scoping with itemIds filter', () => {
    const proj = createProject();
    const labels = generateModuleLabels(proj, catalog, {
      itemIds: new Set(['item-2']),
    });

    expect(labels).toHaveLength(1);
    expect(labels[0]!.itemId).toBe('item-2');
    expect(labels[0]!.packageIndex).toBe(1);
    expect(labels[0]!.totalPackages).toBe(1);
  });

  it('suffixes duplicate module codes with -L2', () => {
    const proj: Project = {
      ...createProject(),
      items: [
        { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
        { id: 'i2', moduleId: 'm1', quantity: 1, optionChoices: {} },
      ],
      kitchenLayout: undefined,
    };
    const labels = generateModuleLabels(proj, catalog);
    expect(labels).toHaveLength(2);
    expect(labels[0]!.factoryCode).toBe('GAB-01');
    expect(labels[1]!.factoryCode).toBe('GAB-01-L2');
  });

  it('throws ValidationError if item quantity is <= 0', () => {
    const proj: Project = {
      ...createProject(),
      items: [{ id: 'i1', moduleId: 'm1', quantity: 0, optionChoices: {} }],
    };
    expect(() => generateModuleLabels(proj, catalog)).toThrow(ValidationError);
  });

  it('throws ResolutionError if module is not in catalog', () => {
    const proj: Project = {
      ...createProject(),
      items: [{ id: 'i1', moduleId: 'missing_mod', quantity: 1, optionChoices: {} }],
    };
    expect(() => generateModuleLabels(proj, catalog)).toThrow(ResolutionError);
  });
});
