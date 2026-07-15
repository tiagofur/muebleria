import { describe, expect, it } from 'vitest';
import type { Module, OptionGroup } from '@muebles/domain';
import {
  defaultOptionChoicesForModule,
  edgesFromFlags,
  emptyModuleDraft,
  filterModulesByQuery,
  flattenCategoriesForSelect,
  flagsFromEdges,
  findModuleCodeConflict,
  formatModuleMoney,
  moduleToDraft,
  optionGroupsForBoardParts,
  optionGroupsForHardware,
  SEED_MODULE_CODES,
  suggestPartCode,
  validateModuleCode,
} from './moduleHelpers';

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

const modules: Module[] = [
  {
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
        grain: 0,
        edges: edgesFromFlags(true, true, true, true),
        optionRole: 'INTERIOR',
      },
      {
        id: 'p2',
        description: 'Puerta',
        quantity: 1,
        lengthMm: 700,
        widthMm: 300,
        grain: 1,
        edges: edgesFromFlags(true, true, true, true),
        optionRole: 'FRENTE',
      },
    ],
    hardwareLines: [
      { id: 'h1', quantity: 2, optionRole: 'BISAGRA' },
      {
        id: 'h2',
        quantity: 1,
        optionRole: 'FIXED',
        hardwareId: 'hw-fixed',
      },
    ],
  },
];

describe('optionGroupsForBoardParts / optionGroupsForHardware', () => {
  it('board picker shows only board and edge groups', () => {
    const roles = optionGroupsForBoardParts(groups).map((g) => g.code);
    expect(roles).toEqual(['INTERIOR', 'FRENTE', 'EDGE-DEF']);
    expect(roles).not.toContain('BISAGRA');
  });

  it('hardware picker shows only hardware groups', () => {
    const roles = optionGroupsForHardware(groups).map((g) => g.code);
    expect(roles).toEqual(['BISAGRA']);
    expect(roles).not.toContain('INTERIOR');
  });
});

describe('validateModuleCode', () => {
  it('requires non-empty code', () => {
    expect(validateModuleCode('  ', modules)).toBe('El código es obligatorio.');
  });

  it('detects duplicate codes case-insensitively', () => {
    expect(validateModuleCode('mod-gab-01', modules)).toMatch(/Ya existe/);
    expect(findModuleCodeConflict('MOD-GAB-01', modules)?.id).toBe('m1');
  });

  it('allows same code when excluding self', () => {
    expect(validateModuleCode('MOD-GAB-01', modules, 'm1')).toBeNull();
  });

  it('allows new unique codes', () => {
    expect(validateModuleCode('MOD-NEW-01', modules)).toBeNull();
  });
});

describe('edges / draft mapping', () => {
  it('round-trips edge flags', () => {
    const edges = edgesFromFlags(true, false, true, false);
    expect(flagsFromEdges(edges)).toEqual({
      edgeL1: true,
      edgeL2: false,
      edgeW1: true,
      edgeW2: false,
    });
  });

  it('moduleToDraft maps seed-like module fields', () => {
    const draft = moduleToDraft(modules[0]!);
    expect(draft.code).toBe('MOD-GAB-01');
    expect(draft.boardParts).toHaveLength(2);
    expect(draft.boardParts[0]!.optionRole).toBe('INTERIOR');
    expect(draft.boardParts[0]!.edgeL1).toBe(true);
    expect(draft.hardwareLines[0]!.mode).toBe('role');
    expect(draft.hardwareLines[1]!.mode).toBe('fixed');
    expect(draft.hardwareLines[1]!.hardwareId).toBe('hw-fixed');
  });

  it('emptyModuleDraft starts empty', () => {
    const d = emptyModuleDraft();
    expect(d.boardParts).toEqual([]);
    expect(d.hardwareLines).toEqual([]);
    expect(d.code).toBe('');
    expect(d.categoryId).toBe('');
  });

  it('flattens category tree for selects', () => {
    const flat = flattenCategoriesForSelect([
      { id: 'r', name: 'Cocina', sortOrder: 0 },
      { id: 'c', name: 'Alacenas', parentId: 'r', sortOrder: 0 },
    ]);
    expect(flat.map((x) => x.id)).toEqual(['r', 'c']);
    expect(flat[1]?.depth).toBe(1);
  });
});

describe('suggestPartCode / defaultOptionChoicesForModule', () => {
  it('suggests {module}-Pnn codes', () => {
    expect(suggestPartCode('MOD-GAB-01', 1)).toBe('MOD-GAB-01-P01');
    expect(suggestPartCode('MOD-GAB-01', 8)).toBe('MOD-GAB-01-P08');
  });

  it('defaults choices to first optionId of each used required role', () => {
    const choices = defaultOptionChoicesForModule(modules[0]!, groups);
    expect(choices).toEqual({
      INTERIOR: 'mat-a',
      FRENTE: 'mat-c',
      BISAGRA: 'hw-1',
    });
    // FIXED hardware lines with hardwareId must not force a choice
    expect(choices.FIXED).toBeUndefined();
  });
});

describe('SEED_MODULE_CODES', () => {
  it('documents plantilla reference modules (MOD-07)', () => {
    expect(SEED_MODULE_CODES).toEqual(['MOD-GAB-01', 'MOD-CAJ-01']);
  });
});

describe('filterModulesByQuery / formatModuleMoney (F021)', () => {
  it('filters by code or name (case-insensitive)', () => {
    const list: Module[] = [
      modules[0]!,
      {
        id: 'm2',
        code: 'MOD-CAJ-01',
        name: 'Cajón standard',
        boardParts: [],
        hardwareLines: [],
      },
    ];
    expect(filterModulesByQuery(list, '')).toHaveLength(2);
    expect(filterModulesByQuery(list, 'gab')).toEqual([list[0]]);
    expect(filterModulesByQuery(list, 'cajón')).toEqual([list[1]]);
    expect(filterModulesByQuery(list, 'zzz')).toEqual([]);
  });

  it('formats money with 2 decimals', () => {
    expect(formatModuleMoney(202.5)).toBe('202.50');
    expect(formatModuleMoney(0)).toBe('0.00');
  });
});
