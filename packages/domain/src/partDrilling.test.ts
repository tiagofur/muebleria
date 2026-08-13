import { describe, expect, it } from 'vitest';
import type { ProductionCutRow, Project } from './types';
import { generatePartDrillingData } from './partDrilling';

const mockProject: Project = {
  id: 'proj-1',
  name: 'Cocina Moderna',
  customerId: 'cust-1',
  currency: 'MXN',
  marginFactor: 1.3,
  laborFixedCost: 0,
  status: 'accepted',
  items: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const mockCutRows: readonly ProductionCutRow[] = [
  {
    quantity: 1,
    lengthMm: 720,
    widthMm: 400,
    description: 'Puerta Gabinete',
    partName: 'Puerta',
    partCode: 'P001',
    moduleCode: 'MOD-01',
    materialName: 'MDF 18mm',
    grain: 1,
    L1: 1,
    L2: 1,
    W1: 1,
    W2: 1,
  },
  {
    quantity: 1,
    lengthMm: 600,
    widthMm: 350,
    description: 'Estante Móvil',
    partName: 'Estante',
    partCode: 'P002',
    moduleCode: 'MOD-01',
    materialName: 'Melamina 18mm',
    grain: 0,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
  },
  {
    quantity: 1,
    lengthMm: 720,
    widthMm: 560,
    description: 'Lateral Izquierdo',
    partName: 'Lateral',
    partCode: 'P003',
    moduleCode: 'MOD-01',
    materialName: 'Melamina 18mm',
    grain: 1,
    L1: 1,
    L2: 0,
    W1: 0,
    W2: 0,
  },
];

describe('generatePartDrillingData', () => {
  it('generates structured drilling dataset for project cut rows', () => {
    const data = generatePartDrillingData({
      project: mockProject,
      cutRows: mockCutRows,
    });

    expect(data.schema).toBe('muebles.drilling-data.v1');
    expect(data.projectId).toBe('proj-1');
    expect(data.projectName).toBe('Cocina Moderna');
    expect(data.totalPiecesCount).toBe(3);
    expect(data.totalHolesCount).toBeGreaterThan(0);
  });

  it('infers hinge cup holes for door parts', () => {
    const data = generatePartDrillingData({
      project: mockProject,
      cutRows: [mockCutRows[0]!],
    });

    const doorPattern = data.patterns[0];
    expect(doorPattern?.partName).toBe('Puerta');
    expect(doorPattern?.holes.length).toBe(2);

    const hinge1 = doorPattern?.holes[0];
    expect(hinge1?.type).toBe('hinge');
    expect(hinge1?.diameterMm).toBe(35);
    expect(hinge1?.depthMm).toBe(12.5);
  });

  it('infers shelf pin holes for shelf parts', () => {
    const data = generatePartDrillingData({
      project: mockProject,
      cutRows: [mockCutRows[1]!],
    });

    const shelfPattern = data.patterns[0];
    expect(shelfPattern?.holes.length).toBe(2);

    const shelfPin = shelfPattern?.holes[0];
    expect(shelfPin?.type).toBe('shelf');
    expect(shelfPin?.diameterMm).toBe(5);
  });

  it('infers minifix and dowel holes for side panels', () => {
    const data = generatePartDrillingData({
      project: mockProject,
      cutRows: [mockCutRows[2]!],
    });

    const sidePattern = data.patterns[0];
    expect(sidePattern?.holes.length).toBe(4);

    const minifix = sidePattern?.holes.find((h) => h.type === 'minifix');
    const dowel = sidePattern?.holes.find((h) => h.type === 'dowel');

    expect(minifix).toBeDefined();
    expect(minifix?.diameterMm).toBe(15);
    expect(dowel).toBeDefined();
    expect(dowel?.diameterMm).toBe(8);
  });
});
