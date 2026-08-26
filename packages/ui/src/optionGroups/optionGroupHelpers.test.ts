import { describe, expect, it } from 'vitest';
import type {
  EdgeBand,
  Hardware,
  MaterialBoard,
  OptionGroup,
} from '@granete/domain';
import {
  canShowPricePreview,
  filterOptionIdsByMembers,
  findOptionGroupCodeConflict,
  membersForKind,
  requiredGroupCodesForModule,
  selectableGroupCodesForModule,
  SEED_OPTION_GROUP_CODES,
  validateOptionGroupCode,
} from './optionGroupHelpers';

const materials: MaterialBoard[] = [
  {
    id: 'm1',
    code: 'TAB-A',
    name: 'Arauco',
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 15,
    grainDefault: false,
    boardPrice: 446.52,
    costPerM2: 100,
    wastePercent: 0,
    active: true,
  },
  {
    id: 'm2',
    code: 'TAB-OFF',
    name: 'Inactivo',
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 15,
    grainDefault: false,
    boardPrice: 446.52,
    costPerM2: 100,
    wastePercent: 0,
    active: false,
  },
];

const edges: EdgeBand[] = [
  {
    id: 'e1',
    code: 'CAN-A',
    name: 'Canto A',
    thicknessMm: 0.5,
    costPerMl: 10,
    active: true,
  },
];

const hardware: Hardware[] = [
  {
    id: 'h1',
    code: 'HER-B',
    name: 'Bisagra',
    unit: 'piece',
    costPerUnit: 20,
    active: true,
  },
  {
    id: 'h2',
    code: 'HER-OFF',
    name: 'Off',
    unit: 'piece',
    costPerUnit: 1,
    active: false,
  },
];

const groups: OptionGroup[] = [
  {
    id: 'og1',
    code: 'INTERIOR',
    name: 'Interiores',
    kind: 'board',
    required: true,
    optionIds: ['m1'],
  },
  {
    id: 'og2',
    code: 'BISAGRA',
    name: 'Bisagras',
    kind: 'hardware',
    required: true,
    optionIds: ['h1'],
  },
  {
    id: 'og3',
    code: 'EDGE-OPT',
    name: 'Cantos opcionales',
    kind: 'edge',
    required: false,
    optionIds: ['e1'],
  },
];

describe('membersForKind (OPT-02)', () => {
  it('returns only materials for board kind (active by default)', () => {
    const members = membersForKind('board', { materials, edges, hardware });
    expect(members.map((m) => m.id)).toEqual(['m1']);
  });

  it('returns only hardware for hardware kind', () => {
    const members = membersForKind('hardware', { materials, edges, hardware });
    expect(members.map((m) => m.id)).toEqual(['h1']);
  });

  it('returns only edges for edge kind', () => {
    const members = membersForKind('edge', { materials, edges, hardware });
    expect(members.map((m) => m.id)).toEqual(['e1']);
  });

  it('can include inactive when requested', () => {
    const members = membersForKind(
      'board',
      { materials, edges, hardware },
      { includeInactive: true },
    );
    expect(members.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });
});

describe('option group code uniqueness (OPT-01)', () => {
  it('detects code conflicts case-insensitively', () => {
    expect(findOptionGroupCodeConflict('interior', groups)?.id).toBe('og1');
    expect(validateOptionGroupCode('INTERIOR', groups)).not.toBeNull();
    expect(validateOptionGroupCode('NUEVO', groups)).toBeNull();
    expect(validateOptionGroupCode('INTERIOR', groups, 'og1')).toBeNull();
  });
});

describe('filterOptionIdsByMembers', () => {
  it('drops ids that are not in the member list', () => {
    expect(
      filterOptionIdsByMembers(['m1', 'ghost'], [
        { id: 'm1', code: 'TAB-A', name: 'A', active: true },
      ]),
    ).toEqual(['m1']);
  });
});

describe('canShowPricePreview (OPT-05)', () => {
  it('blocks when a required group has no choice', () => {
    const result = canShowPricePreview(['INTERIOR', 'BISAGRA'], {
      INTERIOR: 'm1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingGroups).toEqual(['BISAGRA']);
    }
  });

  it('blocks empty string choices', () => {
    const result = canShowPricePreview(['INTERIOR'], { INTERIOR: '  ' });
    expect(result.ok).toBe(false);
  });

  it('allows preview when all required choices are present', () => {
    const result = canShowPricePreview(['INTERIOR', 'BISAGRA'], {
      INTERIOR: 'm1',
      BISAGRA: 'h1',
    });
    expect(result).toEqual({ ok: true, missingGroups: [] });
  });
});

describe('requiredGroupCodesForModule', () => {
  it('collects required roles used by components and variable hardware lines', () => {
    const catalogComponents = [
      {
        id: 'comp-side',
        code: 'C-LAT',
        name: 'Lateral',
        placement: 'lateral_izquierdo' as const,
        geometry: {
          kind: 'rectangular_board' as const,
          lengthMm: 720,
          widthMm: 560,
          thicknessMm: 18,
        },
        defaultEdges: [],
        optionRoles: ['INTERIOR', 'FRENTE'],
        active: true,
      },
    ];
    const codes = requiredGroupCodesForModule(
      {
        components: [{ componentId: 'comp-side' }],
        hardwareLines: [
          { optionRole: 'BISAGRA' },
          { optionRole: 'FIXED', hardwareId: 'h-fixed' },
        ],
      },
      [
        ...groups,
        {
          id: 'og-f',
          code: 'FRENTE',
          name: 'Frentes',
          kind: 'board',
          required: true,
          optionIds: ['m1'],
        },
      ],
      catalogComponents,
    );
    expect(codes.sort()).toEqual(['BISAGRA', 'FRENTE', 'INTERIOR']);
  });

  it('ignores optional groups even if used', () => {
    const codes = requiredGroupCodesForModule(
      {
        hardwareLines: [{ optionRole: 'EDGE-OPT' }],
      },
      groups,
    );
    expect(codes).toEqual([]);
  });

  it('collects board roles from structure components when catalogs are provided', () => {
    const catalogComponents = [
      {
        id: 'comp-base',
        code: 'C-BASE',
        name: 'Base',
        placement: 'base' as const,
        geometry: {
          kind: 'rectangular_board' as const,
          lengthMm: 600,
          widthMm: 560,
          thicknessMm: 18,
        },
        defaultEdges: [] as const,
        optionRoles: ['INTERIOR'] as const,
        active: true,
      },
      {
        id: 'comp-door',
        code: 'C-DOOR',
        name: 'Puerta',
        placement: 'puerta' as const,
        geometry: {
          kind: 'rectangular_board' as const,
          lengthMm: 700,
          widthMm: 400,
          thicknessMm: 18,
        },
        defaultEdges: [] as const,
        optionRoles: ['FRENTE'] as const,
        active: true,
      },
    ];
    const catalogStructures = [
      {
        id: 'str-1',
        code: 'STR-GAB',
        name: 'Cuerpo gabinete',
        components: [
          { id: 'i1', componentId: 'comp-base', quantity: 1 },
          { id: 'i2', componentId: 'comp-door', quantity: 1 },
        ],
        active: true,
      },
    ];
    const codes = requiredGroupCodesForModule(
      {
        structureId: 'str-1',
        components: [],
        hardwareLines: [{ optionRole: 'BISAGRA' }],
      },
      [
        ...groups,
        {
          id: 'og-f',
          code: 'FRENTE',
          name: 'Frentes',
          kind: 'board',
          required: true,
          optionIds: ['m1'],
        },
      ],
      catalogComponents,
      catalogStructures,
    );
    expect(codes.sort()).toEqual(['BISAGRA', 'FRENTE', 'INTERIOR']);
  });

  it('without component catalogs only hardware roles are discovered (regression)', () => {
    const codes = requiredGroupCodesForModule(
      {
        structureId: 'str-1',
        components: [{ componentId: 'comp-base' }],
        hardwareLines: [{ optionRole: 'BISAGRA' }],
      },
      groups,
      // catalogComponents / catalogStructures omitted on purpose
    );
    // Board roles on components/structures are invisible without catalogs —
    // callers MUST pass them (quote UI used to forget and only showed herrajes).
    expect(codes).toEqual(['BISAGRA']);
  });

  it('discovers optionRoles and hardware roles from agregados attached to module', () => {
    const catalogComponents = [
      {
        id: 'comp-door',
        code: 'DOOR-PANEL',
        name: 'Panel Puerta',
        placement: 'puerta' as const,
        geometry: { kind: 'rectangular_board' as const, lengthMm: 700, widthMm: 400, thicknessMm: 18 },
        defaultEdges: [],
        optionRoles: ['FRENTE'],
        active: true,
      },
    ];
    const catalogAgregados = [
      {
        id: 'agr-door-set',
        code: 'AGR-PUERTA',
        name: 'Juego de Puerta',
        components: [{ componentId: 'comp-door', quantity: 1 }],
        hardwareLines: [{ id: 'hw-1', quantity: 1, optionRole: 'JALADERA' }],
      },
    ];
    const optionGroups = [
      ...groups,
      { id: 'og-f', code: 'FRENTE', name: 'Frentes', kind: 'board' as const, required: true, optionIds: ['m1'] },
      { id: 'og-j', code: 'JALADERA', name: 'Jaladeras', kind: 'hardware' as const, required: true, optionIds: ['h1'] },
    ];

    const codes = requiredGroupCodesForModule(
      {
        hardwareLines: [],
        agregados: [{ agregadoId: 'agr-door-set' }],
      },
      optionGroups,
      catalogComponents,
      undefined,
      catalogAgregados,
    );

    expect(codes.sort()).toEqual(['FRENTE', 'JALADERA']);
  });
});

describe('SEED_OPTION_GROUP_CODES (OPT-03)', () => {
  it('lists the four seed group codes required by product', () => {
    expect(SEED_OPTION_GROUP_CODES).toEqual([
      'INTERIOR',
      'FRENTE',
      'BISAGRA',
      'CORREDERA',
    ]);
  });
});

describe('selectableGroupCodesForModule (F087)', () => {
  const baseGroups: OptionGroup[] = [
    ...groups,
    {
      id: 'og-zoclo',
      code: 'ZOCLO',
      name: 'Zoclo',
      kind: 'board',
      required: false,
      optionIds: ['m1'],
    },
    {
      id: 'og-perfil',
      code: 'ZOCLO_PERFIL',
      name: 'Zoclo perfil',
      kind: 'hardware',
      required: false,
      optionIds: ['h1'],
    },
  ];
  const bareModule = {
    hardwareLines: [] as { optionRole: string; hardwareId?: string }[],
    components: [],
  };

  it('includes optional base-role groups when the base mode consumes them', () => {
    expect(
      selectableGroupCodesForModule(
        { ...bareModule, baseMode: 'plinth_strip' },
        baseGroups,
      ),
    ).toEqual(expect.arrayContaining(['ZOCLO_PERFIL']));
    expect(
      selectableGroupCodesForModule(
        { ...bareModule, baseMode: 'plinth_board' },
        baseGroups,
      ),
    ).toEqual(expect.arrayContaining(['ZOCLO']));
  });

  it('excludes base groups for modes that do not consume them', () => {
    const codes = selectableGroupCodesForModule(
      { ...bareModule, baseMode: 'legs' },
      baseGroups,
    );
    expect(codes).not.toContain('ZOCLO');
    expect(codes).not.toContain('ZOCLO_PERFIL');
  });

  it('keeps required groups out of scope when unused and optional groups of unused roles hidden', () => {
    const codes = selectableGroupCodesForModule(bareModule, baseGroups);
    expect(codes).not.toContain('BISAGRA');
    expect(codes).not.toContain('EDGE-OPT');
  });
});
