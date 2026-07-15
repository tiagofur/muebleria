import { describe, expect, it } from 'vitest';
import type {
  EdgeBand,
  Hardware,
  MaterialBoard,
  OptionGroup,
} from '@muebles/domain';
import {
  canShowPricePreview,
  filterOptionIdsByMembers,
  findOptionGroupCodeConflict,
  membersForKind,
  requiredGroupCodesForModule,
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
  it('collects required roles used by parts and variable hardware lines', () => {
    const codes = requiredGroupCodesForModule(
      {
        boardParts: [
          { optionRole: 'INTERIOR' },
          { optionRole: 'FRENTE' },
        ],
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
    );
    expect(codes.sort()).toEqual(['BISAGRA', 'FRENTE', 'INTERIOR']);
  });

  it('ignores optional groups even if used', () => {
    const codes = requiredGroupCodesForModule(
      {
        boardParts: [{ optionRole: 'EDGE-OPT' }],
        hardwareLines: [],
      },
      groups,
    );
    expect(codes).toEqual([]);
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
