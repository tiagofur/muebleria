import { describe, expect, it } from 'vitest';
import type {
  Customer,
  Module,
  OptionGroup,
  Project,
  ProjectItem,
} from '@muebles/domain';
import {
  canShowProjectPricePreview,
  countItemsWithModule,
  customersForProjectPicker,
  defaultChoicesForNewItem,
  emptyAddItemDraft,
  emptyProjectDraft,
  filterProjectsByQuery,
  formatProjectMoney,
  groupsForModuleItem,
  optionsForGroup,
  projectStatusBadgeClass,
  projectStatusLabel,
  projectToDraft,
  resolveCustomerName,
  validateItemQuantity,
  validateProjectDraft,
} from './projectHelpers';

const groups: OptionGroup[] = [
  {
    id: 'g1',
    code: 'INTERIOR',
    name: 'Interior',
    kind: 'board',
    required: true,
    optionIds: ['mat-a', 'mat-b'],
  },
  {
    id: 'g2',
    code: 'FRENTE',
    name: 'Frente',
    kind: 'board',
    required: true,
    optionIds: ['mat-c'],
  },
  {
    id: 'g3',
    code: 'BISAGRA',
    name: 'Bisagra',
    kind: 'hardware',
    required: true,
    optionIds: ['hw-1'],
  },
  {
    id: 'g4',
    code: 'EDGE-DEF',
    name: 'Canto',
    kind: 'edge',
    required: false,
    optionIds: ['e1'],
  },
];

const moduleGab: Module = {
  id: 'm1',
  code: 'MOD-GAB-01',
  name: 'Gabinete',
  boardParts: [
    {
      id: 'p1',
      description: 'Costado',
      quantity: 1,
      lengthMm: 720,
      widthMm: 590,
      edges: [],
      optionRole: 'INTERIOR',
    },
    {
      id: 'p2',
      description: 'Puerta',
      quantity: 1,
      lengthMm: 700,
      widthMm: 300,
      edges: [],
      optionRole: 'FRENTE',
    },
  ],
  hardwareLines: [{ id: 'h1', quantity: 2, optionRole: 'BISAGRA' }],
};

const catalogs = {
  materials: [
    {
      id: 'mat-a',
      code: 'TAB-A',
      name: 'Blanco',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 18,
      grainDefault: false,
      boardPrice: 44.65,
      costPerM2: 10,
      wastePercent: 0,
      active: true,
    },
    {
      id: 'mat-b',
      code: 'TAB-B',
      name: 'Roble',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 53.58,
      costPerM2: 12,
      wastePercent: 0,
      active: true,
    },
    {
      id: 'mat-c',
      code: 'TAB-C',
      name: 'Nougat',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 62.51,
      costPerM2: 14,
      wastePercent: 0,
      active: true,
    },
    {
      id: 'mat-other',
      code: 'TAB-X',
      name: 'Fuera de grupo',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 18,
      grainDefault: false,
      boardPrice: 40.18,
      costPerM2: 9,
      wastePercent: 0,
      active: true,
    },
  ],
  edges: [
    {
      id: 'e1',
      code: 'CAN-1',
      name: 'Canto 1',
      thicknessMm: 1,
      costPerMl: 1,
      active: true,
    },
  ],
  hardware: [
    {
      id: 'hw-1',
      code: 'HER-1',
      name: 'Bisagra clip',
      unit: 'piece' as const,
      costPerUnit: 2,
      active: true,
    },
    {
      id: 'hw-other',
      code: 'HER-X',
      name: 'Otro herraje',
      unit: 'piece' as const,
      costPerUnit: 3,
      active: true,
    },
  ],
};

describe('project drafts and validation', () => {
  it('empty draft has sensible defaults', () => {
    const d = emptyProjectDraft();
    expect(d.status).toBe('draft');
    expect(d.currency).toBe('UYU');
    expect(d.marginFactor).toBe('1.35');
  });

  it('projectToDraft maps customerId as primary picker value', () => {
    const customers: Customer[] = [
      {
        id: 'cust-ana',
        name: 'Ana',
        active: true,
      },
    ];
    const project: Project = {
      id: 'p1',
      name: 'Cocina',
      customerId: 'cust-ana',
      currency: 'UYU',
      marginFactor: 1.4,
      laborFixedCost: 500,
      status: 'quoted',
      items: [],
      notes: 'notas',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    const d = projectToDraft(project, customers);
    expect(d.name).toBe('Cocina');
    expect(d.customerId).toBe('cust-ana');
    expect(d.customerName).toBe('');
    expect(d.marginFactor).toBe('1.4');
    expect(d.laborFixedCost).toBe('500');
    expect(d.status).toBe('quoted');
    expect(d.notes).toBe('notas');
  });

  it('projectToDraft keeps orphan customerId without inventing a name', () => {
    const project: Project = {
      id: 'p1',
      name: 'Cocina',
      customerId: 'orphan-id',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    const d = projectToDraft(project, []);
    expect(d.customerId).toBe('orphan-id');
    expect(d.customerName).toBe('');
  });

  it('validateProjectDraft rejects empty name/client and bad margin', () => {
    expect(validateProjectDraft(emptyProjectDraft())).toMatch(/nombre/i);
    expect(
      validateProjectDraft({
        ...emptyProjectDraft(),
        name: 'X',
        customerId: '',
        customerName: '',
      }),
    ).toMatch(/cliente/i);
    expect(
      validateProjectDraft({
        ...emptyProjectDraft(),
        name: 'X',
        customerId: 'cust-1',
        marginFactor: '0',
      }),
    ).toMatch(/margen/i);
    expect(
      validateProjectDraft({
        ...emptyProjectDraft(),
        name: 'X',
        customerId: 'cust-1',
        marginFactor: '1.35',
        laborFixedCost: '-1',
      }),
    ).not.toBeNull();
    expect(
      validateProjectDraft({
        ...emptyProjectDraft(),
        name: 'X',
        customerId: 'cust-1',
      }),
    ).toBeNull();
    expect(
      validateProjectDraft({
        ...emptyProjectDraft(),
        name: 'X',
        customerId: '',
        customerName: 'Cliente nuevo',
      }),
    ).toBeNull();
  });

  it('customersForProjectPicker lists active and keeps inactive/orphan selected', () => {
    const list: Customer[] = [
      { id: 'a', name: 'Activo', active: true },
      { id: 'b', name: 'Inactivo', active: false },
      { id: 'c', name: 'Otro activo', active: true },
    ];
    expect(customersForProjectPicker(list).map((c) => c.id)).toEqual([
      'a',
      'c',
    ]);
    expect(
      customersForProjectPicker(list, 'b').map((c) => c.id),
    ).toEqual(['a', 'c', 'b']);
    expect(customersForProjectPicker(list, 'a').map((c) => c.id)).toEqual([
      'a',
      'c',
    ]);
    const withOrphan = customersForProjectPicker(list, 'orphan-x');
    expect(withOrphan.map((c) => c.id)).toEqual(['a', 'c', 'orphan-x']);
    expect(withOrphan.at(-1)?.active).toBe(false);
  });

  it('validateItemQuantity enforces qty ≥ 1 integer', () => {
    expect(validateItemQuantity(0)).not.toBeNull();
    expect(validateItemQuantity(1.5)).not.toBeNull();
    expect(validateItemQuantity(1)).toBeNull();
    expect(validateItemQuantity(3)).toBeNull();
  });

  it('projectStatusLabel is Spanish', () => {
    expect(projectStatusLabel('draft')).toBe('Borrador');
    expect(projectStatusLabel('quoted')).toBe('Cotizado');
    expect(projectStatusLabel('accepted')).toBe('Aceptado');
  });

  it('projectStatusBadgeClass maps design.md §5.2 classes', () => {
    expect(projectStatusBadgeClass('draft')).toBe('badge-draft');
    expect(projectStatusBadgeClass('quoted')).toBe('badge-quoted');
    expect(projectStatusBadgeClass('accepted')).toBe('badge-accepted');
  });

  it('emptyAddItemDraft seeds first option choices for module', () => {
    const draft = emptyAddItemDraft([moduleGab], groups);
    expect(draft.moduleId).toBe('m1');
    expect(draft.quantity).toBe(1);
    expect(draft.optionChoices).toEqual({
      INTERIOR: 'mat-a',
      FRENTE: 'mat-c',
      BISAGRA: 'hw-1',
    });
  });
});

describe('filterProjectsByQuery / formatProjectMoney (F022)', () => {
  const customers: Customer[] = [
    {
      id: 'cust-ana',
      name: 'Ana López',
      active: true,
    },
    {
      id: 'cust-bruno',
      name: 'Bruno',
      active: true,
    },
  ];

  const list: Project[] = [
    {
      id: 'p1',
      name: 'Cocina Ana',
      customerId: 'cust-ana',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    },
    {
      id: 'p2',
      name: 'Dormitorio',
      customerId: 'cust-bruno',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'quoted',
      items: [],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    },
  ];

  it('filters by project name or resolved customer name', () => {
    expect(filterProjectsByQuery(list, '', customers)).toHaveLength(2);
    expect(filterProjectsByQuery(list, 'cocina', customers)).toEqual([list[0]]);
    expect(filterProjectsByQuery(list, 'bruno', customers)).toEqual([list[1]]);
    expect(filterProjectsByQuery(list, 'ana lópez', customers)).toEqual([list[0]]);
    expect(filterProjectsByQuery(list, 'zzz', customers)).toEqual([]);
  });

  it('falls back to raw customerId when customers catalog is empty', () => {
    const orphan: Project[] = [
      {
        id: 'p3',
        name: 'Orphan Project',
        customerId: 'Legacy Name',
        currency: 'UYU',
        marginFactor: 1.35,
        laborFixedCost: 0,
        status: 'draft',
        items: [],
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
      },
    ];
    expect(filterProjectsByQuery(orphan, 'legacy')).toEqual([orphan[0]]);
  });

  it('formats money with 2 decimals', () => {
    expect(formatProjectMoney(202.5)).toBe('202.50');
    expect(formatProjectMoney(0)).toBe('0.00');
  });
});

describe('resolveCustomerName', () => {
  const customers: Customer[] = [
    {
      id: 'cust-ana',
      name: 'Ana López',
      active: true,
    },
  ];

  it('resolves catalog name and falls back to id', () => {
    expect(resolveCustomerName('cust-ana', customers)).toBe('Ana López');
    expect(resolveCustomerName('missing', customers)).toBe('missing');
    expect(resolveCustomerName('')).toBe('');
  });
});

describe('OPT-04 / PRJ-03 option pickers', () => {
  it('optionsForGroup only returns ids from the group (not full catalog)', () => {
    const interior = groups.find((g) => g.code === 'INTERIOR')!;
    const opts = optionsForGroup(interior, catalogs);
    expect(opts.map((o) => o.id).sort()).toEqual(['mat-a', 'mat-b']);
    expect(opts.some((o) => o.id === 'mat-other')).toBe(false);
    expect(opts.some((o) => o.id === 'mat-c')).toBe(false);

    const bisagra = groups.find((g) => g.code === 'BISAGRA')!;
    const hw = optionsForGroup(bisagra, catalogs);
    expect(hw.map((o) => o.id)).toEqual(['hw-1']);
    expect(hw.some((o) => o.id === 'hw-other')).toBe(false);
  });

  it('groupsForModuleItem only required groups used by the module', () => {
    const used = groupsForModuleItem(moduleGab, groups);
    const codes = used.map((g) => g.code).sort();
    expect(codes).toEqual(['BISAGRA', 'FRENTE', 'INTERIOR']);
    expect(used.some((g) => g.code === 'EDGE-DEF')).toBe(false);
  });

  it('optionsForGroup returns empty when group has no optionIds', () => {
    const emptyGroup: OptionGroup = {
      id: 'empty',
      code: 'EMPTY',
      name: 'Vacío',
      kind: 'board',
      required: true,
      optionIds: [],
    };
    expect(optionsForGroup(emptyGroup, catalogs)).toEqual([]);
  });
});

describe('PRJ-09 / PRJ-10 item choices', () => {
  it('defaultChoicesForNewItem picks first option per required group without touching module', () => {
    const before = structuredClone(moduleGab);
    const choices = defaultChoicesForNewItem(moduleGab, groups);
    expect(choices).toEqual({
      INTERIOR: 'mat-a',
      FRENTE: 'mat-c',
      BISAGRA: 'hw-1',
    });
    expect(moduleGab).toEqual(before);
  });

  it('allows two items with same moduleId and different optionChoices (PRJ-10)', () => {
    const items: ProjectItem[] = [
      {
        id: 'i1',
        moduleId: 'm1',
        quantity: 1,
        optionChoices: { INTERIOR: 'mat-a', FRENTE: 'mat-c', BISAGRA: 'hw-1' },
      },
      {
        id: 'i2',
        moduleId: 'm1',
        quantity: 1,
        optionChoices: { INTERIOR: 'mat-b', FRENTE: 'mat-c', BISAGRA: 'hw-1' },
      },
    ];
    expect(countItemsWithModule(items, 'm1')).toBe(2);
    expect(items[0]!.optionChoices.INTERIOR).not.toBe(
      items[1]!.optionChoices.INTERIOR,
    );
  });
});

describe('canShowProjectPricePreview', () => {
  const baseProject = (): Project => ({
    id: 'p1',
    name: 'P',
    customerId: 'C',
    currency: 'UYU',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  });

  it('opens when project has no items', () => {
    const gate = canShowProjectPricePreview(baseProject(), [moduleGab], groups);
    expect(gate.ok).toBe(true);
  });

  it('blocks when an item misses required choices', () => {
    const project: Project = {
      ...baseProject(),
      items: [
        {
          id: 'i1',
          moduleId: 'm1',
          quantity: 1,
          optionChoices: { INTERIOR: 'mat-a' },
        },
      ],
    };
    const gate = canShowProjectPricePreview(project, [moduleGab], groups);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.missingGroups).toEqual(
        expect.arrayContaining(['FRENTE', 'BISAGRA']),
      );
    }
  });

  it('opens when all items have complete required choices', () => {
    const project: Project = {
      ...baseProject(),
      items: [
        {
          id: 'i1',
          moduleId: 'm1',
          quantity: 1,
          optionChoices: {
            INTERIOR: 'mat-a',
            FRENTE: 'mat-c',
            BISAGRA: 'hw-1',
          },
        },
        {
          id: 'i2',
          moduleId: 'm1',
          quantity: 2,
          optionChoices: {
            INTERIOR: 'mat-b',
            FRENTE: 'mat-c',
            BISAGRA: 'hw-1',
          },
        },
      ],
    };
    const gate = canShowProjectPricePreview(project, [moduleGab], groups);
    expect(gate.ok).toBe(true);
  });
});
