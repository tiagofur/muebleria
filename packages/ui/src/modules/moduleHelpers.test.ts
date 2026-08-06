import { describe, expect, it } from 'vitest';
import type { Module, OptionGroup } from '@muebles/domain';
import {
  boardFinishPickerGroupsForModule,
  defaultOptionChoicesForModule,
  draftToModule,
  edgesFromFlags,
  emptyModuleDraft,
  filterModulesByQuery,
  flattenCategoriesForSelect,
  flagsFromEdges,
  findModuleCodeConflict,
  formatModuleMoney,
  instanceOverridesSummary,
  mergeBoardOverridesIntoDraft,
  moduleCompositionKey,
  nextGridEnterTarget,
  modulePartGridInputId,
  moduleToDraft,
  patchInstanceOverrides,
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
    expect(draft.hardwareLines).toHaveLength(2);
    expect(draft.hardwareLines[0]!.mode).toBe('role');
    expect(draft.hardwareLines[1]!.mode).toBe('fixed');
    expect(draft.hardwareLines[1]!.hardwareId).toBe('hw-fixed');
    // Modules compose structures + components instead of board parts.
    expect(draft.components).toEqual([]);
    expect(draft.structureId).toBe('');
  });

  it('emptyModuleDraft starts empty', () => {
    const d = emptyModuleDraft();
    expect(d.hardwareLines).toEqual([]);
    expect(d.components).toEqual([]);
    expect(d.code).toBe('');
    expect(d.categoryId).toBe('');
    expect(d.baseMode).toBe('');
    expect(d.baseClearanceMm).toBe('');
  });

  it('draftToModule maps baseMode and baseClearanceMm (zoclo)', () => {
    const draft = {
      ...emptyModuleDraft(),
      code: 'MOD-Z',
      name: 'Bajo zoclo',
      baseMode: 'plinth_board' as const,
      baseClearanceMm: '120',
    };
    const mod = draftToModule('mod-z', draft);
    expect(mod.baseMode).toBe('plinth_board');
    expect(mod.baseClearanceMm).toBe(120);

    const none = draftToModule('mod-n', {
      ...emptyModuleDraft(),
      code: 'N',
      name: 'N',
      baseMode: '',
    });
    expect(none.baseMode).toBeUndefined();

    const roundTrip = moduleToDraft(mod);
    expect(roundTrip.baseMode).toBe('plinth_board');
    expect(roundTrip.baseClearanceMm).toBe('120');
  });

  it('draftToModule maps structure + component instances (live board path)', () => {
    const draft = {
      ...emptyModuleDraft(),
      code: 'MOD-X',
      name: 'Test',
      structureId: 'struct-1',
      externalWidth: '600',
      externalHeight: '720',
      externalDepth: '560',
      components: [
        {
          componentId: 'comp-door',
          quantity: 2,
          placementOverride: 'puerta',
        },
      ],
    };
    const mod = draftToModule('mod-1', draft);
    expect(mod.structureId).toBe('struct-1');
    expect(mod.components).toEqual([
      {
        componentId: 'comp-door',
        quantity: 2,
        placementOverride: 'puerta',
        overrides: undefined,
      },
    ]);
    expect(mod.externalDims).toEqual({ width: 600, height: 720, depth: 560 });

    const withOv = mergeBoardOverridesIntoDraft(draft, {
      'comp-door': { xFormula: '10', rotateY: 90 },
    });
    expect(withOv.components[0]?.overrides).toEqual({
      xFormula: '10',
      rotateY: 90,
    });
    const modOv = draftToModule('mod-1', withOv);
    expect(modOv.components?.[0]?.overrides).toEqual({
      xFormula: '10',
      rotateY: 90,
    });

    // Formula overrides change composition key (list editor re-resolve).
    expect(moduleCompositionKey(mod)).not.toBe(moduleCompositionKey(modOv));
    expect(moduleCompositionKey(mod)).toContain('struct-1');
    expect(moduleCompositionKey(mod)).toContain('comp-door:2:puerta');

    const moreComps = draftToModule('mod-1', {
      ...draft,
      components: [
        ...draft.components,
        { componentId: 'comp-shelf', quantity: 1 },
      ],
    });
    expect(moduleCompositionKey(moreComps)).not.toBe(moduleCompositionKey(mod));
  });

  it('patchInstanceOverrides clears empty fields and summarizes', () => {
    const withX = patchInstanceOverrides(undefined, { xFormula: 'PW - T' });
    expect(withX).toEqual({ xFormula: 'PW - T' });
    expect(instanceOverridesSummary(withX)).toContain('X=PW - T');

    const cleared = patchInstanceOverrides(withX, { xFormula: '' });
    expect(cleared).toBeUndefined();
    expect(instanceOverridesSummary(undefined)).toBe('automático');

    const withRot = patchInstanceOverrides(undefined, { rotateY: 90 });
    expect(withRot).toEqual({ rotateY: 90 });
    expect(patchInstanceOverrides(withRot, { rotateY: null })).toBeUndefined();
  });

  it('moduleToDraft preserves instance overrides', () => {
    const draft = moduleToDraft({
      id: 'm1',
      code: 'M',
      name: 'N',
      components: [
        {
          componentId: 'c1',
          quantity: 1,
          overrides: { yFormula: '50' },
        },
      ],
      hardwareLines: [],
    });
    expect(draft.components[0]?.overrides).toEqual({ yFormula: '50' });
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
    // Option roles now come from component instances (resolved via the
    // components catalog) plus variable hardware lines.
    const catalogComponents = [
      {
        id: 'comp-side',
        code: 'C-LAT',
        name: 'Lateral',
        placement: 'lateral_izquierdo' as const,
        geometry: {
          kind: 'rectangular_board' as const,
          lengthMm: 720,
          widthMm: 590,
          thicknessMm: 18,
        },
        defaultEdges: edgesFromFlags(true, true, true, true),
        optionRoles: ['INTERIOR', 'FRENTE'],
        active: true,
      },
    ];
    const choices = defaultOptionChoicesForModule(
      {
        components: [{ componentId: 'comp-side' }],
        hardwareLines: modules[0]!.hardwareLines,
      },
      groups,
      catalogComponents,
    );
    expect(choices).toEqual({
      INTERIOR: 'mat-a',
      FRENTE: 'mat-c',
      BISAGRA: 'hw-1',
    });
    // FIXED hardware lines with hardwareId must not force a choice
    expect(choices.FIXED).toBeUndefined();
  });

  it('lists board finish picker groups with materials (not hardware)', () => {
    const catalogComponents = [
      {
        id: 'comp-side',
        code: 'C-LAT',
        name: 'Lateral',
        placement: 'lateral_izquierdo' as const,
        geometry: {
          kind: 'rectangular_board' as const,
          lengthMm: 720,
          widthMm: 590,
          thicknessMm: 18,
        },
        defaultEdges: edgesFromFlags(true, true, true, true),
        optionRoles: ['INTERIOR', 'FRENTE'],
        active: true,
      },
    ];
    const materials = [
      {
        id: 'mat-a',
        code: 'MAT-A',
        name: 'Blanco',
        previewColor: '#F5F5F0',
        grainDefault: false,
      },
      {
        id: 'mat-b',
        code: 'MAT-B',
        name: 'Gris',
        previewColor: '#CCCCCC',
        grainDefault: false,
      },
      {
        id: 'mat-c',
        code: 'MAT-C',
        name: 'Madera',
        previewColor: '#C4A574',
        grainDefault: true,
      },
    ];
    const finishGroups = boardFinishPickerGroupsForModule(
      {
        components: [{ componentId: 'comp-side' }],
        hardwareLines: modules[0]!.hardwareLines,
      },
      groups,
      materials,
      catalogComponents,
    );
    expect(finishGroups.map((g) => g.code)).toEqual(['INTERIOR', 'FRENTE']);
    expect(finishGroups[0]!.options.map((o) => o.id)).toEqual([
      'mat-a',
      'mat-b',
    ]);
    expect(finishGroups[1]!.options[0]!.grainDefault).toBe(true);
    // Hardware groups are excluded from finish pickers
    expect(finishGroups.some((g) => g.code === 'BISAGRA')).toBe(false);
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
        hardwareLines: [],
      },
    ];
    expect(filterModulesByQuery(list, '')).toHaveLength(2);
    expect(filterModulesByQuery(list, 'gab')).toEqual([list[0]]);
    expect(filterModulesByQuery(list, 'cajón')).toEqual([list[1]]);
    expect(filterModulesByQuery(list, 'zzz')).toEqual([]);
  });

  it('formats money with 2 decimals', () => {
    expect(formatModuleMoney(202.5)).toBe('$202.50 MXN');
    expect(formatModuleMoney(0)).toBe('$0.00 MXN');
  });
});

describe('module grid keyboard helpers (F033 / #39)', () => {
  it('moves Enter focus to same field on next row', () => {
    expect(
      nextGridEnterTarget({
        rowIds: ['a', 'b', 'c'],
        currentRowId: 'a',
        field: 'qty',
      }),
    ).toEqual({ kind: 'focus', rowId: 'b', field: 'qty' });
    expect(
      nextGridEnterTarget({
        rowIds: ['a', 'b'],
        currentRowId: 'b',
        field: 'length',
      }),
    ).toEqual({ kind: 'addRow', field: 'length' });
  });

  it('builds stable part input ids', () => {
    expect(modulePartGridInputId('p1', 'qty')).toBe('part-qty-p1');
    expect(modulePartGridInputId('p1', 'length')).toBe('part-l-p1');
    expect(modulePartGridInputId('p1', 'width')).toBe('part-w-p1');
  });
});
