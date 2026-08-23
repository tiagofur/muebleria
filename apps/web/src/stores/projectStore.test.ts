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
import { useUiStore } from './uiStore';

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
    getAuthToken: () => null,
    baseUrl: 'http://test/api',
    fetchImpl: vi.fn() as unknown as typeof fetch,
    ...overrides,
  };
  // F064: projectStore reads toast from uiStore. Replace the action with a
  // capture mock for the duration of this test run.
  useUiStore.setState({
    toast: (input) => {
      toasts.push(input);
    },
  });
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
    getAuthToken: () => null,
    getSession: () => 'guest',
    getDraftProjectsCount: () => 0,
    baseUrl: 'http://test/api',
  });
  getCatalogStoreState().setCatalog(seedCatalog());
});

afterEach(() => {
  useUiStore.getState().disposeUi();
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

  it('removeProjectItem prunes kitchen placements for that item', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    const keep: ProjectItem = {
      id: 'keep',
      moduleId: 'mod-1',
      quantity: 1,
      optionChoices: {},
    };
    const gone: ProjectItem = {
      id: 'gone',
      moduleId: 'mod-1',
      quantity: 1,
      optionChoices: {},
    };
    store.getState().setProjects([
      makeProject({
        items: [keep, gone],
        kitchenLayout: {
          walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
          placements: [
            {
              itemId: 'keep',
              instanceIndex: 0,
              wallId: 'w1',
              offsetMm: 0,
              elevation: 'floor',
            },
            {
              itemId: 'gone',
              instanceIndex: 0,
              wallId: 'w1',
              offsetMm: 620,
              elevation: 'floor',
            },
          ],
        },
      }),
    ]);

    store.getState().removeProjectItem('proj-1', 'gone');

    const layout = store.getState().projects[0]!.kitchenLayout;
    expect(layout?.placements).toHaveLength(1);
    expect(layout?.placements[0]!.itemId).toBe('keep');
    expect(layout?.walls).toHaveLength(1);
  });

  it('restoreProjectItems re-inserta con el id original (undo de Proyectar)', () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    const item: ProjectItem = {
      id: 'item-1',
      moduleId: 'mod-1',
      quantity: 3,
      optionChoices: { INTERIOR: 'mat-1' },
    };
    store.getState().setProjects([makeProject({ items: [item] })]);

    store.getState().removeProjectItem('proj-1', 'item-1');
    store.getState().restoreProjectItems('proj-1', [item]);

    const items = store.getState().projects[0]!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe('item-1');
    expect(items[0]!.quantity).toBe(3);
    expect(savedProjects.length).toBeGreaterThan(0);
  });

  it('restoreProjectItems es idempotente por id (no duplica)', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    const item: ProjectItem = {
      id: 'item-1',
      moduleId: 'mod-1',
      quantity: 1,
      optionChoices: {},
    };
    store.getState().setProjects([makeProject({ items: [item] })]);

    store.getState().restoreProjectItems('proj-1', [item]);

    expect(store.getState().projects[0]!.items).toHaveLength(1);
  });

  it('updateProjectItem prunes placements when qty shrinks', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    const item: ProjectItem = {
      id: 'item-1',
      moduleId: 'mod-1',
      quantity: 3,
      optionChoices: {},
    };
    store.getState().setProjects([
      makeProject({
        items: [item],
        kitchenLayout: {
          walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
          placements: [
            {
              itemId: 'item-1',
              instanceIndex: 0,
              wallId: 'w1',
              offsetMm: 0,
              elevation: 'floor',
            },
            {
              itemId: 'item-1',
              instanceIndex: 2,
              wallId: 'w1',
              offsetMm: 620,
              elevation: 'floor',
            },
          ],
        },
      }),
    ]);

    store.getState().updateProjectItem('proj-1', { ...item, quantity: 1 });

    const placements = store.getState().projects[0]!.kitchenLayout?.placements;
    expect(placements).toHaveLength(1);
    expect(placements![0]!.instanceIndex).toBe(0);
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

  it('updateKitchenLayout / addProjectItem no-op when accepted (#257 freeze)', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'accepted' })]);

    store.getState().updateKitchenLayout('proj-1', {
      walls: [{ id: 'w1', lengthMm: 1000, angleDeg: 0 }],
      placements: [],
    });
    store.getState().addProjectItem('proj-1', {
      moduleId: 'm1',
      quantity: 1,
      optionChoices: {},
    });

    expect(store.getState().projects[0]!.kitchenLayout).toBeUndefined();
    expect(store.getState().projects[0]!.items).toHaveLength(0);
  });

  it('reopenProject: vendedor cannot force accepted; admin can (#257)', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });

    store.getState().setProjects([makeProject({ status: 'accepted' })]);
    store.getState().reopenProject('proj-1', seedCatalog(), 'vendedor');
    expect(store.getState().projects[0]!.status).toBe('accepted');

    store.getState().reopenProject('proj-1', seedCatalog(), 'admin');
    expect(store.getState().projects[0]!.status).toBe('draft');

    store.getState().setProjects([makeProject({ status: 'quoted' })]);
    store.getState().reopenProject('proj-1', seedCatalog(), 'vendedor');
    expect(store.getState().projects[0]!.status).toBe('draft');
  });

  it('updateKitchenLayout keeps other spaces when active top-level is empty', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);

    store.getState().updateKitchenLayout('proj-1', {
      walls: [],
      placements: [],
      activeSpaceId: 'space-bano',
      spaces: [
        {
          id: 'space-cocina',
          name: 'Cocina',
          walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
          placements: [
            {
              itemId: 'item-1',
              instanceIndex: 0,
              wallId: 'w1',
              offsetMm: 0,
              elevation: 'floor',
            },
          ],
        },
        {
          id: 'space-bano',
          name: 'Baño',
          walls: [],
          placements: [],
        },
      ],
    });

    const layout = store.getState().projects[0]!.kitchenLayout;
    expect(layout).toBeDefined();
    expect(layout!.spaces).toHaveLength(2);
    expect(layout!.spaces![0]!.walls).toHaveLength(1);
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

describe('projectStore — Warranty Desk & Refabrication (CRM Phase 3)', () => {
  it('loads, creates, updates and deletes warranty tickets', async () => {
    const mockTicket: import('@muebles/domain').WarrantyTicket = {
      id: 'ticket-1',
      ticketNumber: 'GAR-001',
      projectId: 'proj-1',
      title: 'Puerta descuadrada',
      description: 'Roza con el lateral',
      category: 'damaged_part',
      priority: 'normal',
      status: 'open',
      refabricationPieces: [],
      photos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { deps } = makeDeps({
      getWarrantyTickets: async (filter) => [mockTicket],
      createWarrantyTicket: async (ticket) => ({
        ...mockTicket,
        id: 'ticket-2',
        ticketNumber: 'GAR-002',
        title: ticket.title,
        category: ticket.category ?? 'damaged_part',
        priority: ticket.priority ?? 'normal',
      }),
      updateWarrantyTicket: async (id, updates) => ({
        ...mockTicket,
        ...updates,
      }),
      deleteWarrantyTicket: async () => {},
    });


    const store = createProjectStore({ deps });

    // Load
    await store.getState().loadProjectWarranties('proj-1');
    expect(store.getState().warranties['proj-1']).toHaveLength(1);

    // Create
    await store.getState().createWarrantyTicket({
      projectId: 'proj-1',
      title: 'Placa rota',
      description: 'Llegó partida',
      category: 'damaged_part',
      priority: 'urgent',
    });
    expect(store.getState().warranties['proj-1']).toHaveLength(2);
    expect(store.getState().warranties['proj-1']![0]!.title).toBe('Placa rota');

    // Update
    await store.getState().updateWarrantyTicket('ticket-1', { status: 'resolved' });
    expect(store.getState().warranties['proj-1']!.find((t) => t.id === 'ticket-1')!.status).toBe('resolved');

    // Delete
    await store.getState().deleteWarrantyTicket('ticket-1', 'proj-1');
    expect(store.getState().warranties['proj-1']).toHaveLength(1);
    expect(store.getState().warranties['proj-1']![0]!.id).toBe('ticket-2');
  });
});


describe('projectStore — engineering lifecycle (roadmap-screens 2a)', () => {
  it('startEngineering creates the log and persists the project', () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'accepted' })]);

    store.getState().startEngineering('proj-1', 'u9');

    const updated = store.getState().projects[0]!;
    expect(updated.engineeringLog).toMatchObject({
      startedBy: 'u9',
      revision: 1,
    });
    // The whole point (2a.4): the mutation must reach saveProject.
    expect(savedProjects.some((p) => p.engineeringLog?.startedBy === 'u9')).toBe(true);
  });

  it('startEngineering is idempotent — an existing log is not overwritten', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    const existing = {
      startedBy: 'u1',
      startedAt: '2026-08-17T10:00:00.000Z',
      revision: 1,
    };
    store
      .getState()
      .setProjects([
        makeProject({ status: 'accepted', engineeringLog: existing }),
      ]);

    store.getState().startEngineering('proj-1', 'u9');

    expect(store.getState().projects[0]!.engineeringLog).toEqual(existing);
  });

  it('recordEngineeringGeneration stamps generatedBy/At (Documentado)', () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([
      makeProject({
        status: 'accepted',
        engineeringLog: {
          startedBy: 'u1',
          startedAt: '2026-08-17T10:00:00.000Z',
          revision: 1,
        },
      }),
    ]);

    store.getState().recordEngineeringGeneration('proj-1', 'u2');

    const log = store.getState().projects[0]!.engineeringLog!;
    expect(log.generatedBy).toBe('u2');
    expect(log.generatedAt).toBeTruthy();
    expect(savedProjects.some((p) => p.engineeringLog?.generatedBy === 'u2')).toBe(true);
  });

  it('recordEngineeringGeneration is a no-op without a log', () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'accepted' })]);

    store.getState().recordEngineeringGeneration('proj-1', 'u2');

    expect(store.getState().projects[0]!.engineeringLog).toBeUndefined();
    expect(savedProjects).toHaveLength(0);
  });

  it('sendProjectToProduction records the handshake, bumps revision and transitions', () => {
    const { deps, savedProjects, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([
      makeProject({
        status: 'accepted',
        engineeringLog: {
          startedBy: 'u1',
          startedAt: '2026-08-17T10:00:00.000Z',
          generatedBy: 'u2',
          generatedAt: '2026-08-17T11:00:00.000Z',
          revision: 1,
        },
      }),
    ]);

    store.getState().sendProjectToProduction('proj-1', 'u2', seedCatalog());

    const updated = store.getState().projects[0]!;
    expect(updated.status).toBe('produced');
    expect(updated.engineeringLog).toMatchObject({
      sentToProductionBy: 'u2',
      revision: 2,
    });
    expect(updated.engineeringLog?.sentToProductionAt).toBeTruthy();
    expect(savedProjects.some((p) => p.engineeringLog?.revision === 2)).toBe(true);
    expect(toasts[0]!.message).toContain('rev. 2');
  });

  it('sendProjectToProduction is a no-op without documented engineering (stage gate)', () => {
    const { deps, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'accepted' })]);

    store.getState().sendProjectToProduction('proj-1', 'u2', seedCatalog());

    expect(store.getState().projects[0]!.status).toBe('accepted');
    expect(toasts).toHaveLength(0);
  });

  it('releaseProjectMaterials stamps the release after engineering sent', () => {
    const { deps, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([
      makeProject({
        status: 'produced',
        engineeringLog: {
          startedBy: 'u1',
          startedAt: '2026-08-01T10:00:00Z',
          generatedBy: 'u1',
          generatedAt: '2026-08-02T10:00:00Z',
          sentToProductionBy: 'u1',
          sentToProductionAt: '2026-08-03T10:00:00Z',
          revision: 2,
        },
      }),
    ]);

    store.getState().releaseProjectMaterials('proj-1', 'alm-1');

    const project = store.getState().projects[0]!;
    expect(project.materialsRelease).toMatchObject({ releasedBy: 'alm-1' });
    expect(toasts[0]!.message).toContain('producción');
  });

  it('releaseProjectMaterials ignores works whose engineering was not sent', () => {
    const { deps, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'accepted' })]);

    store.getState().releaseProjectMaterials('proj-1', 'alm-1');

    expect(store.getState().projects[0]!.materialsRelease).toBeUndefined();
    expect(toasts).toHaveLength(0);
  });

  it('sendProjectToProduction rejects non-accepted projects', () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ status: 'draft' })]);

    store.getState().sendProjectToProduction('proj-1', 'u2', seedCatalog());

    expect(store.getState().projects[0]!.status).toBe('draft');
    expect(savedProjects).toHaveLength(0);
  });
});

describe('projectStore — lifecycle & operational core (OC-010..OC-024)', () => {
  const readyProject = (): Project =>
    makeProject({
      status: 'accepted',
      commercialStatus: 'won',
      items: [
        {
          id: 'item-1',
          moduleId: 'mod-1',
          quantity: 1,
          optionChoices: {},
        },
      ],
    });

  it('recordDeposit appends a real deposit_received event and persists it (OC-013)', async () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([readyProject()]);

    await store.getState().recordDeposit(
      'proj-1',
      { amount: 5000, currency: 'MXN', reference: 'TRANSF-0042', note: 'Anticipo 50%' },
      { id: 'u1', role: 'vendedor' },
    );

    const updated = store.getState().projects[0]!;
    const deposit = updated.events?.find((e) => e.type === 'deposit_received');
    expect(deposit).toBeDefined();
    expect(deposit?.byUserId).toBe('u1');
    expect((deposit?.payload as { amount: number }).amount).toBe(5000);
    expect(savedProjects.some((p) => p.events?.some((e) => e.type === 'deposit_received'))).toBe(true);
  });

  it('recordDeposit rejects non-positive amounts without touching the project', async () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([readyProject()]);

    await store.getState().recordDeposit('proj-1', { amount: 0, currency: 'MXN' });

    expect(store.getState().projects[0]!.events?.some((e) => e.type === 'deposit_received')).toBeFalsy();
    expect(savedProjects).toHaveLength(0);
  });

  it('releaseToProduction runs the 6 gates end-to-end after deposit + approvals (OC-022)', async () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([readyProject()]);

    await store.getState().recordDeposit('proj-1', { amount: 5000, currency: 'MXN' }, { id: 'u1', role: 'vendedor' });
    await store.getState().requestApproval('proj-1', 'customer', 'Aprobado por correo', { id: 'u1', role: 'vendedor' });
    // El cliente aprueba: la aprobación pendiente pasa a approved.
    const pendingApproval = store.getState().projects[0]!.approvals?.[0];
    expect(pendingApproval?.status).toBe('pending');
    await store.getState().decideApproval(
      'proj-1',
      pendingApproval!.id,
      'approved',
      undefined,
      { id: 'u1', role: 'vendedor' },
    );
    await store.getState().requestApproval('proj-1', 'technical', 'Validar ingeniería', { id: 'u2', role: 'ingeniero' });
    const pendingTech = store.getState().projects[0]!.approvals?.find((a) => a.type === 'technical');
    await store.getState().decideApproval('proj-1', pendingTech!.id, 'approved', undefined, { id: 'u2', role: 'ingeniero' });

    await store.getState().releaseToProduction('proj-1', 'Liberación OK', { requireSurvey: false }, { id: 'u3', role: 'gerente_produccion' });

    const updated = store.getState().projects[0]!;
    expect(updated.productionRelease).toBeDefined();
    expect(updated.events?.some((e) => e.type === 'production_released')).toBe(true);
    expect(savedProjects.some((p) => p.productionRelease != null)).toBe(true);
  });

  it('releaseToProduction stays blocked while the deposit gate is missing', async () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([readyProject()]);

    await expect(
      store.getState().releaseToProduction('proj-1', undefined, { requireSurvey: false }, { id: 'u3', role: 'gerente_produccion' }),
    ).rejects.toThrow(/No se puede liberar a producción/);
    expect(savedProjects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Physical part/unit execution (#301 / OC-030..OC-034)
// ---------------------------------------------------------------------------

function makePartExecProject(): Project {
  return makeProject({
    id: 'proj-phys',
    status: 'produced',
    items: [{ id: 'i1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    productionRelease: {
      id: 'rel-1',
      projectId: 'proj-phys',
      projectVersion: 1,
      designRevisionId: 'dr-1',
      bomFingerprint: 'fp-1',
      releasedBy: 'sup-1',
      releasedAt: '2026-08-21T10:00:00.000Z',
      checks: [],
    },
    partInstances: [
      {
        id: 'proj-phys_i1_u1_LAT_1',
        projectId: 'proj-phys',
        productionRevision: 'rel-1',
        projectItemId: 'i1',
        unitIndex: 1,
        partCode: 'LAT',
        description: 'Lateral',
        materialId: 'm1',
        lengthMm: 700,
        widthMm: 500,
        thicknessMm: 18,
        grain: 0,
        edges: [],
        requiredOperations: [
          { id: 'op-cut', type: 'cut', sequence: 1, status: 'queued' },
        ],
        currentOperationIndex: 0,
        status: 'pending',
      },
    ],
    moduleUnits: [
      {
        id: 'proj-phys_i1_u1',
        projectId: 'proj-phys',
        projectItemId: 'i1',
        unitIndex: 1,
        productionRevision: 'rel-1',
        status: 'awaiting_parts',
      },
    ],
  });
}

describe('projectStore — ejecución física (#301)', () => {
  it('advancePartInstanceLocal completa la operación actual y deriva el estado legacy', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makePartExecProject()]);

    store.getState().advancePartInstanceLocal('proj-phys', 'proj-phys_i1_u1_LAT_1');

    const project = store.getState().projects[0]!;
    const part = project.partInstances?.[0]!;
    expect(part.requiredOperations[0]?.status).toBe('completed');
    expect(part.status).toBe('ready_for_assembly');
    // OC-034: item derivado de la verdad física (pending → edged)
    expect(project.items[0]?.floorStatus).toBe('edged');
  });

  it('advanceModuleUnitLocal respeta el gate de armado', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makePartExecProject()]);

    // pieza sin terminar → el gate bloquea con blockers
    const blocked = store.getState().advanceModuleUnitLocal('proj-phys', 'proj-phys_i1_u1');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.blockers.length).toBeGreaterThan(0);
    expect(store.getState().projects[0]!.moduleUnits?.[0]?.status).toBe('awaiting_parts');

    // pieza lista → el armado avanza
    const base = makePartExecProject();
    const ready: Project = {
      ...base,
      partInstances: base.partInstances!.map((p) => ({
        ...p,
        requiredOperations: p.requiredOperations.map((op) => ({ ...op, status: 'completed' as const })),
        status: 'ready_for_assembly' as const,
      })),
    };
    store.getState().setProjects([ready]);
    const advanced = store.getState().advanceModuleUnitLocal('proj-phys', 'proj-phys_i1_u1');
    expect(advanced.ok).toBe(true);
    const project = store.getState().projects[0]!;
    expect(project.moduleUnits?.[0]?.status).toBe('assembly');
    expect(project.items[0]?.floorStatus).toBe('assembled');
  });

  it('setPartExecutions reemplaza y re-deriva los estados de los ítems', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makePartExecProject()]);

    const project = makePartExecProject();
    const doneParts = project.partInstances!.map((p) => ({
      ...p,
      requiredOperations: p.requiredOperations.map((op) => ({ ...op, status: 'completed' as const })),
      status: 'ready_for_assembly' as const,
    }));
    store.getState().setPartExecutions('proj-phys', doneParts, project.moduleUnits!);
    expect(store.getState().projects[0]!.items[0]?.floorStatus).toBe('edged');
  });
});
