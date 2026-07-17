import { describe, expect, it } from 'vitest';
import {
  expandModuleComponents,
  resolveBom,
  validateFurnitureComponent,
} from './engine';
import {
  FURNITURE_COMPONENT_KINDS,
  furnitureComponentKindLabelEs,
  isFurnitureComponentKind,
} from './furnitureComponents';
import type {
  Catalog,
  FurnitureComponent,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
} from './types';

const mat: MaterialBoard = {
  id: 'mat-1',
  code: 'MDF18',
  name: 'MDF 18',
  widthMm: 1830,
  lengthMm: 2750,
  thicknessMm: 18,
  grainDefault: false,
  boardPrice: 1000,
  wastePercent: 0,
  costPerM2: 100,
  active: true,
};

const group: OptionGroup = {
  id: 'g-int',
  code: 'INTERIOR',
  name: 'Interior',
  kind: 'board',
  required: true,
  optionIds: [mat.id],
};

const puerta: FurnitureComponent = {
  id: 'comp-puerta',
  code: 'COMP-PUERTA-01',
  name: 'Puerta simple',
  kind: 'puerta',
  boardParts: [
    {
      id: 'p-door',
      code: 'PTA',
      description: 'Puerta',
      quantity: 1,
      lengthMm: 700,
      widthMm: 400,
      lengthFormula: 'H-4',
      widthFormula: 'W/2-2',
      edges: [
        { side: 'L1', enabled: false },
        { side: 'L2', enabled: false },
        { side: 'W1', enabled: false },
        { side: 'W2', enabled: false },
      ],
      optionRole: 'FRENTE',
    },
  ],
  hardwareLines: [
    {
      id: 'hw-hinge',
      quantity: 2,
      optionRole: 'BISAGRA',
    },
  ],
  active: true,
};

const entrepano: FurnitureComponent = {
  id: 'comp-ent',
  code: 'COMP-ENT-01',
  name: 'Entrepaño fijo',
  kind: 'entrepaño',
  boardParts: [
    {
      id: 'p-shelf',
      description: 'Entrepaño',
      quantity: 1,
      lengthMm: 500,
      widthMm: 300,
      lengthFormula: 'W-36',
      widthFormula: 'D-20',
      edges: [
        { side: 'L1', enabled: false },
        { side: 'L2', enabled: false },
        { side: 'W1', enabled: false },
        { side: 'W2', enabled: false },
      ],
      optionRole: 'INTERIOR',
    },
  ],
  hardwareLines: [],
  active: true,
};

const frenteGroup: OptionGroup = {
  id: 'g-fr',
  code: 'FRENTE',
  name: 'Frente',
  kind: 'board',
  required: true,
  optionIds: [mat.id],
};

const hinge: Hardware = {
  id: 'hw-1',
  code: 'BIS-35',
  name: 'Bisagra 35',
  unit: 'piece',
  costPerUnit: 12,
  active: true,
};

const hingeGroup: OptionGroup = {
  id: 'g-bis',
  code: 'BISAGRA',
  name: 'Bisagra',
  kind: 'hardware',
  required: true,
  optionIds: [hinge.id],
};

function baseCatalog(extra: Partial<Catalog> = {}): Catalog {
  return {
    materials: [mat],
    edges: [],
    hardware: [hinge],
    optionGroups: [group, frenteGroup, hingeGroup],
    modules: [],
    components: [puerta, entrepano],
    ...extra,
  };
}

describe('furniture component kinds', () => {
  it('exposes workshop kinds and labels', () => {
    expect(FURNITURE_COMPONENT_KINDS).toContain('puerta');
    expect(isFurnitureComponentKind('entrepaño')).toBe(true);
    expect(isFurnitureComponentKind('nope')).toBe(false);
    expect(furnitureComponentKindLabelEs('puerta')).toBe('Puerta');
  });
});

describe('validateFurnitureComponent (H06 / #101)', () => {
  it('accepts puerta and entrepaño samples', () => {
    expect(() => validateFurnitureComponent(puerta)).not.toThrow();
    expect(() => validateFurnitureComponent(entrepano)).not.toThrow();
  });

  it('rejects empty shell', () => {
    expect(() =>
      validateFurnitureComponent({
        id: 'x',
        code: 'X',
        name: 'Vacío',
        kind: 'otro',
        boardParts: [],
        hardwareLines: [],
      }),
    ).toThrow(/al menos una pieza/);
  });
});

describe('expandModuleComponents + resolveBom (H07 / #102)', () => {
  it('expands two doors with quantity 2', () => {
    const { boardParts, hardwareLines } = expandModuleComponents(
      [{ componentId: puerta.id, quantity: 2 }],
      baseCatalog(),
      { width: 800, height: 720, depth: 500 },
      'MOD-TEST',
    );
    expect(boardParts).toHaveLength(2);
    const first = boardParts[0]!;
    // H-4 = 716, W/2-2 = 398
    expect(first.lengthMm).toBe(716);
    expect(first.widthMm).toBe(398);
    expect(hardwareLines).toHaveLength(2);
    expect(hardwareLines[0]!.quantity).toBe(2);
  });

  it('resolveBom merges structure-less fixed parts with components; fixed modules still work', () => {
    const fixed: Module = {
      id: 'm-fixed',
      code: 'MOD-FIX',
      name: 'Fijo',
      boardParts: [
        {
          id: 'bp1',
          description: 'Lateral',
          quantity: 2,
          lengthMm: 700,
          widthMm: 500,
          edges: [
            { side: 'L1', enabled: false },
            { side: 'L2', enabled: false },
            { side: 'W1', enabled: false },
            { side: 'W2', enabled: false },
          ],
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [],
    };

    const composed: Module = {
      id: 'm-comp',
      code: 'MOD-COMP',
      name: 'Compuesto',
      externalDims: { width: 800, height: 720, depth: 500 },
      boardParts: [],
      hardwareLines: [],
      components: [
        { componentId: puerta.id, quantity: 1 },
        { componentId: entrepano.id, quantity: 1 },
      ],
      presets: [
        { id: 'pr1', name: '800', width: 800, height: 720, depth: 500 },
      ],
    };

    const catalog = baseCatalog({ modules: [fixed, composed] });

    const fixedBom = resolveBom(fixed, { INTERIOR: mat.id }, catalog);
    expect(fixedBom.boardParts).toHaveLength(1);
    expect(fixedBom.boardParts[0]!.lengthMm).toBe(700);

    const composedBom = resolveBom(
      composed,
      { INTERIOR: mat.id, FRENTE: mat.id, BISAGRA: hinge.id },
      catalog,
      'pr1',
    );
    expect(composedBom.boardParts.length).toBeGreaterThanOrEqual(2);
    expect(composedBom.hardwareLines.length).toBeGreaterThanOrEqual(1);
  });

  it('does not break modules without components', () => {
    const mod: Module = {
      id: 'm1',
      code: 'M1',
      name: 'Solo piezas',
      boardParts: [
        {
          id: 'a',
          description: 'Pieza',
          quantity: 1,
          lengthMm: 100,
          widthMm: 100,
          edges: [
            { side: 'L1', enabled: false },
            { side: 'L2', enabled: false },
            { side: 'W1', enabled: false },
            { side: 'W2', enabled: false },
          ],
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [],
    };
    const bom = resolveBom(
      mod,
      { INTERIOR: mat.id },
      baseCatalog({ modules: [mod] }),
    );
    expect(bom.boardParts).toHaveLength(1);
  });
});
