import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  calcProjectBreakdown,
  collectExportIssues,
  type Project,
  type ProjectItem,
} from '@muebles/domain';
import { createSeedWorkspace } from '@muebles/storage/seed';
import { PACKAGE_NAME as domainName } from '@muebles/domain';
import {
  canShowPricePreview,
  canShowProjectPricePreview,
  countItemsWithModule,
  defaultChoicesForNewItem,
  defaultOptionChoicesForModule,
  filterActiveForPicker,
  groupsForModuleItem,
  membersForKind,
  optionGroupsForBoardParts,
  optionGroupsForHardware,
  optionsForGroup,
  PACKAGE_NAME as uiName,
  requiredGroupCodesForModule,
  SEED_MODULE_CODES,
  SEED_OPTION_GROUP_CODES,
  validateItemQuantity,
  validateModuleCode,
  validateProjectDraft,
  validateUniqueCode,
  emptyProjectDraft,
} from '@muebles/ui';
import {
  buildHardwareListExport,
  hardwareListFileName,
} from './exportHardwareList';
import { buildOptimizerExport, optimizerFileName } from './exportOptimizer';

const here = dirname(fileURLToPath(import.meta.url));

describe('@muebles/web #15 setState side effects / stale patches', () => {
  it('patchCatalog/patchProjects use reducer updaters (no array-literal-only API)', () => {
    const appSrc = readFileSync(join(here, 'App.tsx'), 'utf8');
    expect(appSrc).toContain(
      'updater: (catalog: Catalog) => Catalog',
    );
    expect(appSrc).toContain(
      'updater: (projects: readonly Project[]) => readonly Project[]',
    );
    // Must not save inside setWorkspace callback (StrictMode double-fire).
    expect(appSrc).not.toMatch(
      /setWorkspace\(\(prev\)[\s\S]{0,200}repository\.save/,
    );
    // Project item mutations must use functional patchProjects.
    expect(appSrc).toContain('patchProjects((ps) =>');
    expect(appSrc).toContain('patchCatalog((c) =>');
  });

  it('createProject builds id outside setWorkspace (StrictMode single write)', () => {
    const appSrc = readFileSync(join(here, 'App.tsx'), 'utf8');
    expect(appSrc).toContain('repository.createProject(project)');
    // newId for project must not appear only inside setWorkspace updater.
    const createBlock = appSrc.slice(
      appSrc.indexOf('const createProject'),
      appSrc.indexOf('const updateProject'),
    );
    expect(createBlock).toContain('id: newId()');
    expect(createBlock).toMatch(/setWorkspace\(\(prev\)[\s\S]*projects:/);
    expect(createBlock).not.toMatch(
      /setWorkspace\(\(prev\)[\s\S]*newId\(\)/,
    );
  });
});

describe('@muebles/web reliability (issues #11–#13)', () => {
  it('#11: App calculate path uses DEFAULT_API_BASE + readAuthToken (no hardcode)', () => {
    const appSrc = readFileSync(join(here, 'App.tsx'), 'utf8');
    expect(appSrc).not.toMatch(/localhost:8080\/api\/projects/);
    expect(appSrc).not.toMatch(/localStorage\.getItem\(['"]muebles_token['"]\)/);
    expect(appSrc).toContain('DEFAULT_API_BASE');
    expect(appSrc).toContain('readAuthToken()');
    expect(appSrc).toContain(
      '`${DEFAULT_API_BASE}/projects/${selectedProjectId}/calculate`',
    );
  });

  it('#11: apps/web src has no hardcoded calculate host', () => {
    // DEFAULT_API_BASE may still mention localhost as env fallback in session.ts.
    const appSrc = readFileSync(join(here, 'App.tsx'), 'utf8');
    expect(appSrc.includes('http://localhost:8080')).toBe(false);
  });

  it('#12: breakdown loading/error props wired to ProjectsScreen', () => {
    const appSrc = readFileSync(join(here, 'App.tsx'), 'utf8');
    expect(appSrc).toContain('breakdownLoading={breakdownLoading}');
    expect(appSrc).toContain('breakdownError={breakdownError}');
    expect(appSrc).toContain("type: 'error'");
    expect(appSrc).toMatch(/mostrando valores locales/);
  });

  it('#13: root ErrorBoundary wraps App in main.tsx', () => {
    const mainSrc = readFileSync(join(here, 'main.tsx'), 'utf8');
    expect(mainSrc).toContain('ErrorBoundary');
    expect(mainSrc).toMatch(/<ErrorBoundary>[\s\S]*<App\s*\/>/);
  });

  it('#13: workspace load failure offers explicit recover (no silent seed)', () => {
    const appSrc = readFileSync(join(here, 'App.tsx'), 'utf8');
    expect(appSrc).toContain('workspaceLoadError');
    expect(appSrc).toContain('Usar datos demo');
    // Load catch must set error, not auto-seed.
    const loadCatch = appSrc.match(
      /repository\s*\n?\s*\.load\(\)[\s\S]*?\.catch\(\(err\) => \{([\s\S]*?)\}\);/,
    );
    expect(loadCatch?.[1]).toBeTruthy();
    expect(loadCatch?.[1]).toContain('setWorkspaceLoadError');
    expect(loadCatch?.[1]).not.toContain('createSeedWorkspace');
  });
});

describe('@muebles/web F006 shell wiring', () => {
  it('resolves workspace packages', () => {
    expect(domainName).toBe('@muebles/domain');
    expect(uiName).toBe('@muebles/ui');
  });

  it('loads plantilla seed catalogs on first open (CAT-06)', () => {
    const ws = createSeedWorkspace();
    expect(ws.schemaVersion).toBe(2);
    expect(ws.catalog.materials.length).toBeGreaterThan(0);
    expect(ws.catalog.edges.length).toBeGreaterThan(0);
    expect(ws.catalog.hardware.length).toBeGreaterThan(0);
    expect(ws.catalog.materials.some((m) => m.code === 'TAB-ARA-BLA')).toBe(
      true,
    );
    expect(ws.catalog.hardware.some((h) => h.code === 'HER-BIS-CL')).toBe(true);
    // F011: demo quotation ready on first open
    expect(ws.projects.some((p) => p.name === 'Demo plantilla')).toBe(true);
  });

  it('exposes unique-code validation for client-side CAT-04', () => {
    const ws = createSeedWorkspace();
    expect(validateUniqueCode('TAB-ARA-BLA', ws.catalog.materials)).not.toBeNull();
    expect(validateUniqueCode('TAB-NEW-01', ws.catalog.materials)).toBeNull();
  });

  it('picker helper hides inactive seed items by default (CAT-05)', () => {
    const ws = createSeedWorkspace();
    const withInactive = [
      ...ws.catalog.materials,
      {
        ...ws.catalog.materials[0]!,
        id: 'inactive-demo',
        code: 'TAB-OFF',
        active: false,
      },
    ];
    const picker = filterActiveForPicker(withInactive);
    expect(picker.every((m) => m.active)).toBe(true);
    expect(picker.some((m) => m.id === 'inactive-demo')).toBe(false);
  });
});

describe('@muebles/web F007 option groups + price gate', () => {
  it('seed includes INTERIOR/FRENTE/BISAGRA/CORREDERA (OPT-03)', () => {
    const ws = createSeedWorkspace();
    const codes = new Set(ws.catalog.optionGroups.map((g) => g.code));
    for (const code of SEED_OPTION_GROUP_CODES) {
      expect(codes.has(code)).toBe(true);
    }
    const interior = ws.catalog.optionGroups.find((g) => g.code === 'INTERIOR');
    expect(interior?.kind).toBe('board');
    expect(interior?.optionIds.length).toBeGreaterThan(0);
    const bisagra = ws.catalog.optionGroups.find((g) => g.code === 'BISAGRA');
    expect(bisagra?.kind).toBe('hardware');
  });

  it('membersForKind only returns matching catalog kind (OPT-02)', () => {
    const ws = createSeedWorkspace();
    const board = membersForKind('board', ws.catalog);
    const hw = membersForKind('hardware', ws.catalog);
    const edge = membersForKind('edge', ws.catalog);
    expect(board.every((m) => ws.catalog.materials.some((x) => x.id === m.id))).toBe(
      true,
    );
    expect(hw.every((m) => ws.catalog.hardware.some((x) => x.id === m.id))).toBe(
      true,
    );
    expect(edge.every((m) => ws.catalog.edges.some((x) => x.id === m.id))).toBe(
      true,
    );
    expect(board.some((m) => m.id === hw[0]?.id)).toBe(false);
  });

  it('required groups without choices block preview; complete choices allow domain price (OPT-05)', () => {
    const ws = createSeedWorkspace();
    const mod = ws.catalog.modules.find((m) => m.code === 'MOD-GAB-01');
    expect(mod).toBeDefined();
    if (!mod) return;

    const required = requiredGroupCodesForModule(mod, ws.catalog.optionGroups);
    expect(required).toEqual(
      expect.arrayContaining(['INTERIOR', 'FRENTE', 'BISAGRA']),
    );

    const blocked = canShowPricePreview(required, {});
    expect(blocked.ok).toBe(false);

    const arauco = ws.catalog.materials.find((m) => m.code === 'TAB-ARA-BLA')!;
    const maderado = ws.catalog.materials.find((m) => m.code === 'TAB-MAD-FRE')!;
    const bisagra = ws.catalog.hardware.find((h) => h.code === 'HER-BIS-CL')!;
    const choices = {
      INTERIOR: arauco.id,
      FRENTE: maderado.id,
      BISAGRA: bisagra.id,
    };
    const open = canShowPricePreview(required, choices);
    expect(open.ok).toBe(true);

    const now = new Date().toISOString();
    const project: Project = {
      id: 't',
      name: 't',
      customerId: 't',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i',
          moduleId: mod.id,
          quantity: 1,
          optionChoices: choices,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    const breakdown = calcProjectBreakdown(project, ws.catalog);
    expect(breakdown.salePrice).toBeGreaterThan(0);
  });
});

describe('@muebles/web F008 module editor wiring', () => {
  it('seed includes MOD-GAB-01 and MOD-CAJ-01 with correct optionRoles (MOD-07)', () => {
    const ws = createSeedWorkspace();
    const codes = new Set(ws.catalog.modules.map((m) => m.code));
    for (const code of SEED_MODULE_CODES) {
      expect(codes.has(code)).toBe(true);
    }

    const gab = ws.catalog.modules.find((m) => m.code === 'MOD-GAB-01')!;
    const boardRoles = new Set(gab.boardParts.map((p) => p.optionRole));
    expect(boardRoles.has('INTERIOR')).toBe(true);
    expect(boardRoles.has('FRENTE')).toBe(true);
    expect(gab.hardwareLines.some((l) => l.optionRole === 'BISAGRA')).toBe(true);
    expect(gab.hardwareLines.some((l) => l.hardwareId)).toBe(true);

    const caj = ws.catalog.modules.find((m) => m.code === 'MOD-CAJ-01')!;
    expect(caj.boardParts.some((p) => p.optionRole === 'INTERIOR')).toBe(true);
    expect(caj.hardwareLines.some((l) => l.optionRole === 'CORREDERA')).toBe(
      true,
    );
  });

  it('optionRole pickers expose only available groups by kind', () => {
    const ws = createSeedWorkspace();
    const boardPicker = optionGroupsForBoardParts(ws.catalog.optionGroups);
    const hwPicker = optionGroupsForHardware(ws.catalog.optionGroups);
    expect(boardPicker.every((g) => g.kind === 'board' || g.kind === 'edge')).toBe(
      true,
    );
    expect(hwPicker.every((g) => g.kind === 'hardware')).toBe(true);
    expect(boardPicker.some((g) => g.code === 'INTERIOR')).toBe(true);
    expect(hwPicker.some((g) => g.code === 'BISAGRA')).toBe(true);
    expect(boardPicker.some((g) => g.kind === 'hardware')).toBe(false);
  });

  it('module code uniqueness helper works against seed', () => {
    const ws = createSeedWorkspace();
    expect(validateModuleCode('MOD-GAB-01', ws.catalog.modules)).not.toBeNull();
    expect(validateModuleCode('MOD-NEW-99', ws.catalog.modules)).toBeNull();
  });

  it('cost preview with default option choices uses domain engine (MOD-06)', () => {
    const ws = createSeedWorkspace();
    const mod = ws.catalog.modules.find((m) => m.code === 'MOD-GAB-01')!;
    const required = requiredGroupCodesForModule(mod, ws.catalog.optionGroups);
    const choices = defaultOptionChoicesForModule(mod, ws.catalog.optionGroups);
    const gate = canShowPricePreview(required, choices);
    expect(gate.ok).toBe(true);

    const now = new Date().toISOString();
    const project: Project = {
      id: 'preview',
      name: 'preview',
      customerId: 'preview',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i',
          moduleId: mod.id,
          quantity: 1,
          optionChoices: choices,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    const breakdown = calcProjectBreakdown(project, ws.catalog);
    expect(breakdown.salePrice).toBeGreaterThan(0);
    expect(breakdown.directCost).toBeGreaterThan(0);
  });
});

describe('@muebles/web F009 quotation / projects wiring', () => {
  it('seed includes demo plantilla project; UI can still create drafts (PRJ-01)', () => {
    const ws = createSeedWorkspace();
    expect(ws.projects).toHaveLength(1);
    expect(ws.projects[0]?.name).toBe('Demo plantilla');
    expect(ws.projects[0]?.items).toHaveLength(1);
    const draft = emptyProjectDraft();
    expect(validateProjectDraft({ ...draft, name: 'A', customerId: 'B' })).toBe(
      null,
    );
  });

  it('option pickers for quotation only expose group members (OPT-04, PRJ-03)', () => {
    const ws = createSeedWorkspace();
    const gab = ws.catalog.modules.find((m) => m.code === 'MOD-GAB-01')!;
    const groups = groupsForModuleItem(gab, ws.catalog.optionGroups);
    const codes = groups.map((g) => g.code);
    expect(codes).toEqual(
      expect.arrayContaining(['INTERIOR', 'FRENTE', 'BISAGRA']),
    );
    expect(codes.includes('CORREDERA')).toBe(false);

    const interior = groups.find((g) => g.code === 'INTERIOR')!;
    const opts = optionsForGroup(interior, ws.catalog);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => interior.optionIds.includes(o.id))).toBe(true);
    // Not the full materials catalog unless every material is a group member
    expect(opts.length).toBeLessThanOrEqual(interior.optionIds.length);
  });

  it('two items same module with different optionChoices recalculate independently (PRJ-09, PRJ-10)', () => {
    const ws = createSeedWorkspace();
    const gab = ws.catalog.modules.find((m) => m.code === 'MOD-GAB-01')!;
    // Seed INTERIOR may list one member; expand group for PRJ-10 dual-choice scenario.
    const altMaterial =
      ws.catalog.materials.find((m) => m.code === 'TAB-MAD-FRE') ??
      ws.catalog.materials.find((m) => m.code !== 'TAB-ARA-BLA')!;
    const optionGroups = ws.catalog.optionGroups.map((g) =>
      g.code === 'INTERIOR'
        ? {
            ...g,
            optionIds: [...new Set([...g.optionIds, altMaterial.id])],
          }
        : g,
    );
    const catalog = { ...ws.catalog, optionGroups };
    const baseChoices = defaultChoicesForNewItem(gab, optionGroups);
    const altInterior =
      optionGroups
        .find((g) => g.code === 'INTERIOR')!
        .optionIds.find((id) => id !== baseChoices.INTERIOR) ?? altMaterial.id;

    const itemA: ProjectItem = {
      id: 'ia',
      moduleId: gab.id,
      quantity: 1,
      optionChoices: { ...baseChoices },
    };
    const itemB: ProjectItem = {
      id: 'ib',
      moduleId: gab.id,
      quantity: 1,
      optionChoices: { ...baseChoices, INTERIOR: altInterior },
    };
    expect(countItemsWithModule([itemA, itemB], gab.id)).toBe(2);
    expect(itemA.optionChoices.INTERIOR).not.toBe(itemB.optionChoices.INTERIOR);

    // PRJ-09: module master unchanged by choice diffs
    const boardRolesBefore = gab.boardParts.map((p) => p.optionRole);
    expect(itemA.moduleId).toBe(gab.id);
    expect(itemB.moduleId).toBe(gab.id);
    expect(gab.boardParts.map((p) => p.optionRole)).toEqual(boardRolesBefore);

    const now = new Date().toISOString();
    const project: Project = {
      id: 'prj',
      name: 'Dos gabinetes',
      customerId: 'Cliente',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [itemA, itemB],
      createdAt: now,
      updatedAt: now,
    };

    const gate = canShowProjectPricePreview(
      project,
      catalog.modules,
      catalog.optionGroups,
    );
    expect(gate.ok).toBe(true);

    const breakdown = calcProjectBreakdown(project, catalog);
    expect(breakdown.salePrice).toBeGreaterThan(0);
    expect(breakdown.materialsCost).toBeGreaterThan(0);

    // Changing only item B choices yields a breakdown without mutating module
    const projectAligned: Project = {
      ...project,
      items: [
        itemA,
        {
          ...itemB,
          optionChoices: {
            ...itemB.optionChoices,
            INTERIOR: baseChoices.INTERIOR!,
          },
        },
      ],
    };
    const breakdownAligned = calcProjectBreakdown(projectAligned, catalog);
    expect(breakdownAligned.salePrice).toBeGreaterThan(0);
    // Different INTERIOR materials should generally change materials cost
    expect(breakdown.materialsCost).not.toBe(breakdownAligned.materialsCost);
    expect(gab.boardParts.map((p) => p.optionRole)).toEqual(boardRolesBefore);
  });

  it('live totals use domain engine when required options complete (PRJ-06, UX-03)', () => {
    const ws = createSeedWorkspace();
    const gab = ws.catalog.modules.find((m) => m.code === 'MOD-GAB-01')!;
    const choices = defaultChoicesForNewItem(gab, ws.catalog.optionGroups);
    const now = new Date().toISOString();
    const project: Project = {
      id: 'live',
      name: 'Live',
      customerId: 'C',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 100,
      status: 'draft',
      items: [
        {
          id: 'i1',
          moduleId: gab.id,
          quantity: 2,
          optionChoices: choices,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    expect(validateItemQuantity(2)).toBeNull();
    const gate = canShowProjectPricePreview(
      project,
      ws.catalog.modules,
      ws.catalog.optionGroups,
    );
    expect(gate.ok).toBe(true);

    const breakdown = calcProjectBreakdown(project, ws.catalog);
    expect(breakdown.laborFixedCost).toBe(100);
    expect(breakdown.marginFactor).toBe(1.35);
    expect(breakdown.directCost).toBeGreaterThan(0);
    expect(breakdown.salePrice).toBeGreaterThan(breakdown.directCost);

    const blocked: Project = {
      ...project,
      items: [{ ...project.items[0]!, optionChoices: {} }],
    };
    const blockedGate = canShowProjectPricePreview(
      blocked,
      ws.catalog.modules,
      ws.catalog.optionGroups,
    );
    expect(blockedGate.ok).toBe(false);
  });
});

describe('@muebles/web F010 export Optimizer', () => {
  it('buildOptimizerExport produces buffer for seed project with complete choices', async () => {
    const ws = createSeedWorkspace();
    const gab = ws.catalog.modules.find((m) => m.code === 'MOD-GAB-01')!;
    const choices = defaultChoicesForNewItem(gab, ws.catalog.optionGroups);
    // Seed may omit FONDO members; fill required roles from module when present.
    const required = requiredGroupCodesForModule(gab, ws.catalog.optionGroups);
    const fullChoices = { ...choices };
    for (const code of required) {
      if (!fullChoices[code]) {
        const group = ws.catalog.optionGroups.find((g) => g.code === code);
        const first = group?.optionIds[0];
        if (first) fullChoices[code] = first;
      }
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: 'export-demo',
      name: 'Proyecto Export',
      customerId: 'Cliente',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i1',
          moduleId: gab.id,
          quantity: 1,
          optionChoices: fullChoices,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    expect(collectExportIssues(project, ws.catalog)).toEqual([]);
    const result = await buildOptimizerExport(project, ws.catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.fileName).toBe(optimizerFileName('Proyecto Export'));
  });

  it('blocks export with actionable issues when options missing', async () => {
    const ws = createSeedWorkspace();
    const gab = ws.catalog.modules.find((m) => m.code === 'MOD-GAB-01')!;
    const now = new Date().toISOString();
    const project: Project = {
      id: 'export-bad',
      name: 'Sin opciones',
      customerId: 'C',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i1',
          moduleId: gab.id,
          quantity: 1,
          optionChoices: {},
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const result = await buildOptimizerExport(project, ws.catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.field === 'optionChoices')).toBe(true);
    expect(result.issues.some((i) => i.moduleCode)).toBe(true);
  });
});

describe('@muebles/web F013 export lista de herrajes', () => {
  it('buildHardwareListExport produces buffer for seed project with complete choices', async () => {
    const ws = createSeedWorkspace();
    const gab = ws.catalog.modules.find((m) => m.code === 'MOD-GAB-01')!;
    const choices = defaultChoicesForNewItem(gab, ws.catalog.optionGroups);
    const required = requiredGroupCodesForModule(gab, ws.catalog.optionGroups);
    const fullChoices = { ...choices };
    for (const code of required) {
      if (!fullChoices[code]) {
        const group = ws.catalog.optionGroups.find((g) => g.code === code);
        const first = group?.optionIds[0];
        if (first) fullChoices[code] = first;
      }
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: 'export-hw-demo',
      name: 'Proyecto Herrajes',
      customerId: 'Cliente',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i1',
          moduleId: gab.id,
          quantity: 1,
          optionChoices: fullChoices,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    expect(collectExportIssues(project, ws.catalog)).toEqual([]);
    const result = await buildHardwareListExport(project, ws.catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.fileName).toBe(hardwareListFileName('Proyecto Herrajes'));
  });

  it('blocks hardware export with actionable issues when options missing', async () => {
    const ws = createSeedWorkspace();
    const gab = ws.catalog.modules.find((m) => m.code === 'MOD-GAB-01')!;
    const now = new Date().toISOString();
    const project: Project = {
      id: 'export-hw-bad',
      name: 'Sin opciones',
      customerId: 'C',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i1',
          moduleId: gab.id,
          quantity: 1,
          optionChoices: {},
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const result = await buildHardwareListExport(project, ws.catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.field === 'optionChoices')).toBe(true);
  });
});
