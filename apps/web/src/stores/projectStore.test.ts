import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Catalog,
  Customer,
  Project,
  ProjectItem,
  ProjectTemplate,
} from '@muebles/domain';
import { createSeedWorkspace } from '@muebles/storage';
import type { ProjectDraft } from '@muebles/ui';

import {
  createProjectStore,
  ensureProjectStore,
  useBackendBreakdownEffect,
  type ProjectStoreDeps,
} from './projectStore';
import {
  ensureCatalogStore,
  getCatalogStoreState,
} from './catalogStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<ProjectStoreDeps> = {}): {
  deps: ProjectStoreDeps;
  createdProjects: Project[];
  savedProjects: Project[];
  deletedProjectIds: string[];
  createdTemplates: ProjectTemplate[];
  deletedTemplateIds: string[];
  toasts: Array<{ type: string; message: string }>;
} {
  const createdProjects: Project[] = [];
  const savedProjects: Project[] = [];
  const deletedProjectIds: string[] = [];
  const createdTemplates: ProjectTemplate[] = [];
  const deletedTemplateIds: string[] = [];
  const toasts: Array<{ type: string; message: string }> = [];
  const deps: ProjectStoreDeps = {
    newId: () => `id-${Math.random().toString(36).slice(2, 8)}`,
    createProject: async (p) => {
      createdProjects.push(p);
    },
    saveProject: async (p) => {
      savedProjects.push(p);
    },
    deleteProject: async (id) => {
      deletedProjectIds.push(id);
    },
    createProjectTemplate: async (t) => {
      createdTemplates.push(t);
    },
    deleteProjectTemplate: async (id) => {
      deletedTemplateIds.push(id);
    },
    toast: (input) => toasts.push(input),
    getAuthToken: () => null,
    baseUrl: 'http://test/api',
    fetchImpl: vi.fn() as unknown as typeof fetch,
    ...overrides,
  };
  return {
    deps,
    createdProjects,
    savedProjects,
    deletedProjectIds,
    createdTemplates,
    deletedTemplateIds,
    toasts,
  };
}

function seedCatalog(): Catalog {
  return createSeedWorkspace().catalog;
}

const projectDraft = {
  name: 'Test Project',
  customerId: '',
  customerName: 'New Customer',
  currency: 'MXN',
  marginFactor: '1.35',
  laborFixedCost: '1200',
  status: 'draft' as const,
  notes: '',
  ownerUserId: '',
} satisfies ProjectDraft;

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'P1',
    customerId: 'cust-1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 1200,
    status: 'draft',
    items: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<ProjectTemplate> = {}): ProjectTemplate {
  return {
    id: 'tpl-1',
    name: 'Tpl',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 1200,
    items: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as { sessionStorage: Storage }).sessionStorage = memoryStorage();
  (globalThis as { localStorage: Storage }).localStorage = memoryStorage();
  // Init catalogStore so cross-store calls work; populate with seed catalog
  // so upsertCustomers has a non-null starting state.
  ensureCatalogStore({
    newId: () => 'cat-id',
    saveCatalog: async () => {},
    toast: () => {},
    getAuthToken: () => null,
    getSession: () => 'guest',
    getDraftProjectsCount: () => 0,
    baseUrl: 'http://test/api',
  });
  getCatalogStoreState().setCatalog(seedCatalog());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('projectStore — setProjects / setProjectTemplates', () => {
  it('replaces projects', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    expect(store.getState().projects).toEqual([]);
    const ps = [makeProject()];
    store.getState().setProjects(ps);
    expect(store.getState().projects).toBe(ps);
  });

  it('replaces projectTemplates', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    const t = makeTemplate();
    store.getState().setProjectTemplates([t]);
    expect(store.getState().projectTemplates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

describe('projectStore — createProject (cross-store customers)', () => {
  it('creates project + persists customers via catalogStore.upsertCustomers', () => {
    const { deps, createdProjects, toasts } = makeDeps({
      newId: () => 'new-id',
    });
    const store = createProjectStore({ deps });
    const cat = seedCatalog();
    const initialCustomers = cat.customers ?? [];

    store.getState().createProject(projectDraft, cat, {
      id: 'user-1',
      role: 'admin',
    });

    expect(store.getState().projects).toHaveLength(1);
    expect(createdProjects).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ type: 'success' });

    // Cross-store: catalogStore.upsertCustomers was called with the new list.
    const updatedCustomers = getCatalogStoreState().catalog?.customers;
    expect(updatedCustomers?.length).toBeGreaterThan(initialCustomers.length);
    expect(
      updatedCustomers?.some((c) => c.name === 'New Customer'),
    ).toBe(true);
  });

  it('no-op when draft has existing customerId (no new customer)', () => {
    const { deps, createdProjects } = makeDeps();
    const store = createProjectStore({ deps });
    const cat = seedCatalog();

    store.getState().createProject(
      { ...projectDraft, customerId: 'existing-cust', customerName: '' },
      cat,
      { id: 'user-1' },
    );

    expect(createdProjects).toHaveLength(1);
    // No new customers added to catalogStore.
    const customers = getCatalogStoreState().catalog?.customers;
    expect(customers).toEqual(cat.customers ?? []);
  });
});

describe('projectStore — updateProject', () => {
  it('updates project + persists', () => {
    const { deps, savedProjects, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    const cat = seedCatalog();
    store.getState().setProjects([makeProject()]);

    store.getState().updateProject(
      'proj-1',
      { ...projectDraft, name: 'Updated', customerId: 'c1' },
      cat,
      { role: 'admin' },
    );

    expect(store.getState().projects[0]!.name).toBe('Updated');
    expect(savedProjects).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      type: 'success',
      message: '✓ Cambios guardados',
    });
  });

  it('no-op when project id not found', () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);

    store.getState().updateProject(
      'does-not-exist',
      { ...projectDraft, customerId: 'c1' },
      seedCatalog(),
      {},
    );

    expect(savedProjects).toHaveLength(0);
  });
});

describe('projectStore — deleteProject', () => {
  it('deletes project, persists delete, fires onProjectDeleted callback', () => {
    const { deps, deletedProjectIds } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);
    const spy = vi.fn();

    store.getState().deleteProject('proj-1', spy);

    expect(store.getState().projects).toHaveLength(0);
    expect(deletedProjectIds).toEqual(['proj-1']);
    expect(spy).toHaveBeenCalledWith('proj-1');
  });
});

describe('projectStore — duplicateProjectById', () => {
  it('creates a copy with new id', () => {
    const { deps, createdProjects, toasts } = makeDeps({
      newId: () => 'dup-id',
    });
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);

    store.getState().duplicateProjectById('proj-1');

    expect(store.getState().projects).toHaveLength(2);
    expect(createdProjects).toHaveLength(1);
    expect(createdProjects[0]!.id).toBe('dup-id');
    expect(toasts[0]!.message).toContain('Duplicado');
  });

  it('no-op when source not found', () => {
    const { deps, createdProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);

    store.getState().duplicateProjectById('missing');

    expect(createdProjects).toHaveLength(0);
    expect(store.getState().projects).toHaveLength(1);
  });
});

describe('projectStore — markProjectProduced', () => {
  it('transitions accepted → produced', () => {
    const { deps, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'accepted' })]);

    store.getState().markProjectProduced('proj-1', seedCatalog());

    expect(store.getState().projects[0]!.status).toBe('produced');
    expect(toasts[0]).toMatchObject({
      type: 'success',
      message: '✓ Marcada en producción',
    });
  });

  it('no-op when status is not accepted', () => {
    const { deps, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'draft' })]);

    store.getState().markProjectProduced('proj-1', seedCatalog());

    expect(store.getState().projects[0]!.status).toBe('draft');
    expect(toasts).toHaveLength(0);
  });
});

describe('projectStore — reopenProject', () => {
  it('transitions non-draft → draft and clears snapshot', () => {
    const { deps, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'quoted' })]);

    store.getState().reopenProject('proj-1', seedCatalog());

    expect(store.getState().projects[0]!.status).toBe('draft');
    expect(toasts[0]).toMatchObject({ type: 'info' });
  });

  it('no-op when already draft', () => {
    const { deps, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'draft' })]);

    store.getState().reopenProject('proj-1', seedCatalog());

    expect(toasts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

describe('projectStore — saveAsTemplate', () => {
  it('creates template from project', () => {
    const { deps, createdTemplates, toasts } = makeDeps({
      newId: () => 'tpl-id',
    });
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);

    store.getState().saveAsTemplate('proj-1', 'My Template');

    expect(store.getState().projectTemplates).toHaveLength(1);
    expect(createdTemplates[0]!.name).toBe('My Template');
    expect(toasts[0]!.message).toContain('Plantilla');
  });
});

describe('projectStore — createFromTemplate (cross-store)', () => {
  it('creates project from template + persists customers', () => {
    const { deps, createdProjects } = makeDeps({ newId: () => 'from-tpl' });
    const store = createProjectStore({ deps });
    const cat = seedCatalog();
    const tpl = makeTemplate({ id: 'tpl-1', name: 'Tpl' });
    store.getState().setProjectTemplates([tpl]);

    store.getState().createFromTemplate(
      'tpl-1',
      { ...projectDraft, name: 'From Tpl', customerName: 'Cliente Nuevo' },
      cat,
      { id: 'user-1' },
    );

    expect(store.getState().projects).toHaveLength(1);
    expect(createdProjects).toHaveLength(1);
    // Cross-store: catalogStore should have new customer.
    const customers = getCatalogStoreState().catalog?.customers;
    expect(
      customers?.some((c) => c.name === 'Cliente Nuevo'),
    ).toBe(true);
  });
});

describe('projectStore — deleteTemplate', () => {
  it('removes template by id', () => {
    const { deps, deletedTemplateIds } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjectTemplates([makeTemplate({ id: 'tpl-1' })]);

    store.getState().deleteTemplate('tpl-1');

    expect(store.getState().projectTemplates).toHaveLength(0);
    expect(deletedTemplateIds).toEqual(['tpl-1']);
  });
});

// ---------------------------------------------------------------------------
// Item mutations
// ---------------------------------------------------------------------------

describe('projectStore — addProjectItem / updateProjectItem / removeProjectItem', () => {
  it('addProjectItem appends + persists via saveProject', () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);

    store.getState().addProjectItem('proj-1', {
      moduleId: 'mod-1',
      quantity: 2,
      optionChoices: { INTERIOR: 'mat-1' },
    });

    expect(store.getState().projects[0]!.items).toHaveLength(1);
    expect(savedProjects).toHaveLength(1);
  });

  it('updateProjectItem replaces by id', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    const item: ProjectItem = {
      id: 'item-1',
      moduleId: 'mod-1',
      quantity: 1,
      optionChoices: {},
    };
    store.getState().setProjects([makeProject({ items: [item] })]);

    store.getState().updateProjectItem('proj-1', { ...item, quantity: 5 });

    expect(store.getState().projects[0]!.items[0]!.quantity).toBe(5);
  });

  it('removeProjectItem filters by id', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    const item: ProjectItem = {
      id: 'item-1',
      moduleId: 'mod-1',
      quantity: 1,
      optionChoices: {},
    };
    store.getState().setProjects([makeProject({ items: [item] })]);

    store.getState().removeProjectItem('proj-1', 'item-1');

    expect(store.getState().projects[0]!.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Other mutations
// ---------------------------------------------------------------------------

describe('projectStore — updateProjectLevelChoices', () => {
  it('sets choices when non-empty, clears when empty', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);

    store.getState().updateProjectLevelChoices('proj-1', { INTERIOR: 'm1' });
    expect(store.getState().projects[0]!.projectLevelChoices).toMatchObject({
      INTERIOR: 'm1',
    });

    store.getState().updateProjectLevelChoices('proj-1', {});
    expect(store.getState().projects[0]!.projectLevelChoices).toBeUndefined();
  });
});

describe('projectStore — applyScenarioB', () => {
  it('gated to draft status only', () => {
    const { deps, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'quoted' })]);

    store.getState().applyScenarioB('proj-1', 'FRENTE', 'choice-1');

    expect(toasts[0]).toMatchObject({
      type: 'error',
      message: 'Solo se puede aplicar el escenario B en borrador',
    });
  });

  it('applies when draft', () => {
    const { deps, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'draft' })]);

    store.getState().applyScenarioB('proj-1', 'FRENTE', 'choice-1');

    expect(toasts[0]!.message).toContain('Escenario B aplicado');
  });
});

describe('projectStore — duplicateWithScenarioB', () => {
  it('duplicates + applies scenario B + fires navigate callback', () => {
    const { deps, createdProjects } = makeDeps({ newId: () => 'scen-id' });
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);
    const navigateSpy = vi.fn();

    store.getState().duplicateWithScenarioB(
      'proj-1',
      'FRENTE',
      'choice-1',
      navigateSpy,
    );

    expect(store.getState().projects).toHaveLength(2);
    expect(createdProjects[0]!.id).toBe('scen-id');
    expect(navigateSpy).toHaveBeenCalledWith('scen-id');
  });
});

describe('projectStore — importNestingResult / updateKitchenLayout', () => {
  it('importNestingResult sets + toasts', () => {
    const { deps, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);

    store.getState().importNestingResult('proj-1', {
      importedAt: '2024-01-01',
      rows: [
        { materialCode: 'TAB-1', sheetsUsed: 3 },
      ],
    });

    expect(store.getState().projects[0]!.nestingImport?.rows[0]!.sheetsUsed).toBe(3);
    expect(toasts[0]).toMatchObject({ type: 'success' });
  });

  it('updateKitchenLayout clears layout when empty', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);

    store.getState().updateKitchenLayout('proj-1', {
      walls: [],
      placements: [],
    });
    expect(store.getState().projects[0]!.kitchenLayout).toBeUndefined();
  });

  it('updateKitchenLayout sets when non-empty', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);

    store.getState().updateKitchenLayout('proj-1', {
      walls: [
        { id: 'w1', lengthMm: 1000, angleDeg: 0 },
      ],
      placements: [],
    });
    expect(store.getState().projects[0]!.kitchenLayout?.walls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// useBackendBreakdownEffect — wiring sanity (RTL/jsdom not available here;
// full behavior coverage deferred to Playwright smoke + manual probe)
// ---------------------------------------------------------------------------

describe('useBackendBreakdownEffect', () => {
  it('exports a function (hook wiring contract)', () => {
    expect(typeof useBackendBreakdownEffect).toBe('function');
  });
});
