import { describe, expect, it } from 'vitest';
import {
  DomainError,
  ResolutionError,
  ValidationError,
  type BoardPart,
  type Catalog,
  type EdgeAssignment,
  type EdgeBand,
  type Hardware,
  type HardwareLine,
  type MaterialBoard,
  type Module,
  type ModuleCategory,
  type OptionGroup,
  type HardwarePurchaseRow,
  type ProductionCutRow,
  type Project,
  type ProjectItem,
  type QuoteBreakdown,
  type ResolvedBom,
  type ResolvedBoardPart,
  type ResolvedHardwareLine,
  type Workspace,
} from './index';

const ALL_EDGES: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: true },
  { side: 'L2', enabled: true },
  { side: 'W1', enabled: false },
  { side: 'W2', enabled: false },
] as const;

describe('domain entity types', () => {
  it('constructs catalog entities (MaterialBoard, EdgeBand, Hardware, OptionGroup)', () => {
    const material: MaterialBoard = {
      id: '11111111-1111-4111-8111-111111111111',
      code: 'TAB-ARA-BLA-15',
      name: 'Arauco Blanco 15mm',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 15,
      grainDefault: false,
      boardPrice: 1200,
      wastePercent: 10,
      costPerM2: 320.5,
      defaultEdgeBandId: '22222222-2222-4222-8222-222222222222',
      active: true,
    };

    const edge: EdgeBand = {
      id: '22222222-2222-4222-8222-222222222222',
      code: 'CAN-BLA-05',
      name: 'Canto Blanco 0.5mm',
      thicknessMm: 0.5,
      costPerMl: 4.25,
      active: true,
    };

    const hardware: Hardware = {
      id: '33333333-3333-4333-8333-333333333333',
      code: 'HER-BLU-BIS',
      name: 'Bisagra Blum Cierre Lento',
      unit: 'piece',
      costPerUnit: 28,
      active: true,
    };

    const optionGroup: OptionGroup = {
      id: '44444444-4444-4444-8444-444444444444',
      code: 'INTERIOR',
      name: 'Melamina de Interiores',
      kind: 'board',
      required: true,
      optionIds: [material.id],
    };

    expect(material.code).toBe('TAB-ARA-BLA-15');
    expect(edge.costPerMl).toBe(4.25);
    expect(hardware.unit).toBe('piece');
    expect(optionGroup.optionIds).toHaveLength(1);
    expect(optionGroup.kind).toBe('board');
  });

  it('constructs Module with BoardPart and HardwareLine', () => {
    const boardPart: BoardPart = {
      id: '55555555-5555-4555-8555-555555555555',
      code: 'MOD-GAB-01-P01',
      description: 'Costado Derecho',
      quantity: 1,
      lengthMm: 720,
      widthMm: 590,
      grain: 0,
      edges: ALL_EDGES,
      optionRole: 'INTERIOR',
    };

    const hardwareLine: HardwareLine = {
      id: '66666666-6666-4666-8666-666666666666',
      quantity: 2,
      optionRole: 'BISAGRA',
    };

    const module: Module = {
      id: '77777777-7777-4777-8777-777777777777',
      code: 'MOD-GAB-01',
      name: 'Gabinete base 60',
      externalDims: { width: 600, height: 720, depth: 590 },
      baseLaborCost: 150,
      boardParts: [boardPart],
      hardwareLines: [hardwareLine],
    };

    expect(module.boardParts[0]?.optionRole).toBe('INTERIOR');
    expect(module.hardwareLines[0]?.quantity).toBe(2);
    expect(module.boardParts[0]?.edges).toHaveLength(4);
    expect(module.externalDims?.depth).toBe(590);
    expect(module.categoryId).toBeUndefined();
  });

  it('constructs ModuleCategory hierarchy and optional module.categoryId', () => {
    const root: ModuleCategory = {
      id: 'cat-root',
      name: 'Cocina',
      sortOrder: 0,
    };
    const child: ModuleCategory = {
      id: 'cat-child',
      name: 'Alacenas',
      parentId: root.id,
      sortOrder: 0,
    };
    const module: Module = {
      id: 'mod-1',
      code: 'M1',
      name: 'Gabinete',
      categoryId: child.id,
      boardParts: [],
      hardwareLines: [],
    };
    expect(child.parentId).toBe(root.id);
    expect(module.categoryId).toBe(child.id);
  });

  it('constructs Project with ProjectItem optionChoices', () => {
    const item: ProjectItem = {
      id: '88888888-8888-4888-8888-888888888888',
      moduleId: '77777777-7777-4777-8777-777777777777',
      quantity: 1,
      optionChoices: {
        INTERIOR: '11111111-1111-4111-8111-111111111111',
        BISAGRA: '33333333-3333-4333-8333-333333333333',
      },
    };

    const project: Project = {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Cocina demo',
      customerId: 'cust-1',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 500,
      status: 'draft',
      items: [item],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };

    expect(project.status).toBe('draft');
    expect(project.priceSnapshot).toBeUndefined();
    expect(project.items[0]?.optionChoices.INTERIOR).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('constructs Project with optional QuotePriceSnapshot when closed', () => {
    const breakdown: QuoteBreakdown = {
      materialsCost: 100,
      edgeTotal: 20,
      hardwareTotal: 30,
      directCost: 150,
      laborModular: 0,
      laborFixedCost: 500,
      marginFactor: 1.35,
      salePrice: 702.5,
    };
    const project: Project = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Cerrada',
      customerId: 'cust-2',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 500,
      status: 'quoted',
      items: [],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      priceSnapshot: {
        capturedAt: '2026-07-15T12:00:00.000Z',
        breakdown,
        materialCostPerM2: { 'mat-a': 160 },
      },
    };
    expect(project.priceSnapshot?.breakdown.salePrice).toBe(702.5);
    expect(project.priceSnapshot?.materialCostPerM2?.['mat-a']).toBe(160);
  });

  it('constructs Workspace + Catalog containers', () => {
    const catalog: Catalog = {
      materials: [],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
    };

    const workspace: Workspace = {
      schemaVersion: 1,
      catalog,
      projects: [],
    };

    expect(workspace.schemaVersion).toBe(1);
    expect(workspace.catalog.modules).toEqual([]);
  });

  it('constructs resolution DTOs (ResolvedBom, QuoteBreakdown, ProductionCutRow)', () => {
    const resolvedPart: ResolvedBoardPart = {
      id: '55555555-5555-4555-8555-555555555555',
      code: 'MOD-GAB-01-P01',
      description: 'Costado Derecho',
      quantity: 1,
      lengthMm: 720,
      widthMm: 590,
      grain: 0,
      edges: ALL_EDGES,
      optionRole: 'INTERIOR',
      materialId: '11111111-1111-4111-8111-111111111111',
      edgeBandId: '22222222-2222-4222-8222-222222222222',
    };

    const resolvedHw: ResolvedHardwareLine = {
      id: '66666666-6666-4666-8666-666666666666',
      quantity: 2,
      optionRole: 'BISAGRA',
      hardwareId: '33333333-3333-4333-8333-333333333333',
    };

    const bom: ResolvedBom = {
      boardParts: [resolvedPart],
      hardwareLines: [resolvedHw],
    };

    const breakdown: QuoteBreakdown = {
      materialsCost: 100,
      edgeTotal: 10,
      hardwareTotal: 56,
      directCost: 166,
      laborModular: 150,
      laborFixedCost: 500,
      marginFactor: 1.35,
      salePrice: 874.1,
    };

    const cutRow: ProductionCutRow = {
      quantity: 1,
      lengthMm: 720,
      widthMm: 590,
      description: 'Costado Derecho',
      materialName: 'Arauco Blanco 15mm',
      grain: 0,
      L1: 1,
      L2: 1,
      W1: 0,
      W2: 0,
    };

    const purchaseRow: HardwarePurchaseRow = {
      hardwareId: 'hw-1',
      code: 'HER-BIS-CL',
      description: 'Bisagra Cierre Lento',
      unit: 'piece',
      quantity: 2,
      costPerUnit: 35,
      lineCost: 70,
    };

    expect(bom.boardParts[0]?.materialId).toBeDefined();
    expect(bom.hardwareLines[0]?.hardwareId).toBeDefined();
    expect(breakdown.directCost).toBe(166);
    expect(cutRow.L1).toBe(1);
    expect(purchaseRow.lineCost).toBe(70);
  });

  it('exposes DomainError hierarchy with optional context', () => {
    const domain = new DomainError('base', { field: 'code' });
    const validation = new ValidationError('invalid code', { code: 'X' });
    const resolution = new ResolutionError('missing choice', {
      optionGroupCode: 'INTERIOR',
    });

    expect(domain).toBeInstanceOf(Error);
    expect(validation).toBeInstanceOf(DomainError);
    expect(resolution).toBeInstanceOf(DomainError);
    expect(validation.name).toBe('ValidationError');
    expect(resolution.context?.optionGroupCode).toBe('INTERIOR');
  });
});
