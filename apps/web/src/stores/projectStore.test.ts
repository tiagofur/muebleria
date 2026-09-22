import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Catalog,
  Customer,
  Project,
  ProjectItem,
  ProjectTemplate,
} from '@granete/domain';
import {
  createSeedWorkspace,
  ProjectInlineUpdateHttpError,
} from '@granete/storage';
import type { ProjectDraft } from '@granete/ui';

import {
  BackendCalculationHttpError,
  createProjectStore,
  ensureProjectStore,
  notifyBackendCalculationFailure,
  readBackendCalculationErrorMessage,
  useBackendBreakdownEffect,
  type ProjectStoreDeps,
} from './projectStore';
import {
  ensureCatalogStore,
  getCatalogStoreState,
} from './catalogStore';
import { useWorkspaceStore } from './workspaceStore';
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
    // Store fixtures are local-tool works: positively pre-DT (#738 review).
    hasDigitalThreadContext: false,
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

  it('#738 review — guest-born projects carry the POSITIVE pre-DT signal; server sessions wait for the server projection', () => {
    const cat = seedCatalog();

    useWorkspaceStore.setState({ session: 'guest', activeOrg: null, workspaceSeq: 0 });
    const guestStore = createProjectStore({ deps: makeDeps().deps });
    guestStore.getState().createProject(projectDraft, cat, { id: 'user-1', role: 'admin' });
    expect(guestStore.getState().projects[0]!.hasDigitalThreadContext).toBe(false);

    // On a server-backed session the optimistic object carries NO guessed
    // provenance — the server response owns the projection.
    useWorkspaceStore.setState({ session: 'auth', activeOrg: null, workspaceSeq: 0 });
    const authStore = createProjectStore({ deps: makeDeps().deps });
    authStore.getState().createProject(projectDraft, cat, { id: 'user-1', role: 'admin' });
    expect('hasDigitalThreadContext' in (authStore.getState().projects[0] ?? {})).toBe(false);

    useWorkspaceStore.setState({ session: null, activeOrg: null, workspaceSeq: 0 });
  });
});

describe('projectStore — createProject with inline customer (#712 atomic path)', () => {
  const serverCustomer: Customer = {
    id: 'server-cust-1',
    name: 'New Customer',
    active: true,
  };

  // The server echo DELIBERATELY differs from what the UI sent: timestamps
  // are minted by PostgreSQL, ownership is resolved server-side. The local
  // store must adopt this entity verbatim — a test where the server echoes
  // the payload unchanged could not detect a local reconstruction.
  const SERVER_CREATED_AT = '2026-09-13T10:00:00.000Z';
  const SERVER_UPDATED_AT = '2026-09-13T10:00:01.000Z';
  const SERVER_OWNER = 'server-resolved-owner';

  let lastServerProject: Project | null = null;

  function makeAtomicDeps(fail = false, newId?: () => string) {
    const atomicCalls: Array<{ projectId: string; name: string }> = [];
    const base = makeDeps();
    const deps: ProjectStoreDeps = {
      ...base.deps,
      newId: newId ?? base.deps.newId,
      canCreateProjectWithInlineCustomer: () => true,
      createProjectWithInlineCustomer: async (p, name) => {
        atomicCalls.push({ projectId: p.id, name });
        if (fail) {
          throw new Error('boom: atomic transition failed');
        }
        lastServerProject = {
          ...p,
          customerId: serverCustomer.id,
          ownerUserId: SERVER_OWNER,
          createdAt: SERVER_CREATED_AT,
          updatedAt: SERVER_UPDATED_AT,
        };
        return { project: lastServerProject, customer: serverCustomer };
      },
    };
    return { ...base, deps, atomicCalls };
  }

  it('server mode: one atomic transition, no optimistic state, server entities win', async () => {
    const { deps, createdProjects, toasts, atomicCalls } = makeAtomicDeps();
    const store = createProjectStore({ deps });
    const cat = seedCatalog();
    const initialCustomers = (cat.customers ?? []).length;

    store.getState().createProject(projectDraft, cat, { id: 'user-1' });

    // No optimistic project: the pair exists only after the server commits.
    expect(store.getState().projects).toHaveLength(0);
    expect(toasts).toHaveLength(0);

    await vi.waitFor(() => {
      expect(store.getState().projects).toHaveLength(1);
    });

    // Exactly ONE persistence call — the legacy POST and the unordered
    // catalog-save channel are out of this path entirely.
    expect(atomicCalls).toHaveLength(1);
    expect(atomicCalls[0]!.name).toBe('New Customer');
    expect(createdProjects).toHaveLength(0);

    // The local Project IS the server-returned entity — full structural
    // equality, including the fields only the server could know.
    expect(store.getState().projects[0]).toEqual(lastServerProject);
    expect(store.getState().projects[0]!.customerId).toBe(serverCustomer.id);
    expect(store.getState().projects[0]!.createdAt).toBe(SERVER_CREATED_AT);
    expect(store.getState().projects[0]!.ownerUserId).toBe(SERVER_OWNER);

    // The customer lands in local catalog state for immediate rendering.
    const customers = getCatalogStoreState().catalog?.customers ?? [];
    expect(customers.length).toBe(initialCustomers + 1);
    expect(customers.some((c) => c.id === serverCustomer.id)).toBe(true);

    // Success is toasted only after the server accepted the write.
    expect(toasts[0]).toMatchObject({ type: 'success' });
  });

  it('server mode failure: nothing local survives, honest error, no orphan', async () => {
    const { deps, toasts, atomicCalls } = makeAtomicDeps(true);
    const store = createProjectStore({ deps });
    const cat = seedCatalog();
    const initialCustomers = (cat.customers ?? []).length;

    store.getState().createProject(projectDraft, cat, { id: 'user-1' });

    await vi.waitFor(() => {
      expect(toasts[0]).toMatchObject({
        type: 'error',
        message: 'No se pudo guardar la cotización en el servidor',
      });
    });

    expect(atomicCalls).toHaveLength(1);
    expect(store.getState().projects).toHaveLength(0);
    const customers = getCatalogStoreState().catalog?.customers ?? [];
    expect(customers.length).toBe(initialCustomers);
  });

  it('server mode + existing customerId: keeps the legacy optimistic path', () => {
    const { deps, createdProjects, atomicCalls } = makeAtomicDeps();
    const store = createProjectStore({ deps });
    const cat = seedCatalog();

    store.getState().createProject(
      { ...projectDraft, customerId: 'existing-cust', customerName: '' },
      cat,
      { id: 'user-1' },
    );

    expect(atomicCalls).toHaveLength(0);
    expect(createdProjects).toHaveLength(1);
    expect(store.getState().projects).toHaveLength(1);
    expect(store.getState().projects[0]!.customerId).toBe('existing-cust');
  });

  it('guest mode (no atomic capability): keeps the local-optimistic path', () => {
    const { deps, createdProjects } = makeDeps();
    const store = createProjectStore({ deps });
    const cat = seedCatalog();

    store.getState().createProject(projectDraft, cat, { id: 'user-1' });

    expect(createdProjects).toHaveLength(1);
    expect(store.getState().projects).toHaveLength(1);
    // Local customer resolution (single local store, no FK boundary).
    expect(store.getState().projects[0]!.customerId).not.toBe('');
    const customers = getCatalogStoreState().catalog?.customers ?? [];
    expect(customers.some((c) => c.name === 'New Customer')).toBe(true);
  });

  it('reconciles the customer by id — no duplicate entries, server data wins', async () => {
    const { deps } = makeAtomicDeps();
    const store = createProjectStore({ deps });
    const cat = seedCatalog();
    // A concurrent load already brought this identity in with stale data.
    const stale = { ...serverCustomer, name: 'Stale Name' };
    getCatalogStoreState().setCatalog({
      ...cat,
      customers: [...(cat.customers ?? []), stale],
    });
    const before = (getCatalogStoreState().catalog?.customers ?? []).length;

    store.getState().createProject(projectDraft, cat, { id: 'user-1' });
    await vi.waitFor(() => {
      expect(store.getState().projects).toHaveLength(1);
    });

    const customers = getCatalogStoreState().catalog?.customers ?? [];
    expect(customers.length).toBe(before); // upsert, not append
    const matches = customers.filter((c) => c.id === serverCustomer.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.name).toBe(serverCustomer.name); // authoritative
  });

  it('#714: update uses one atomic call, no optimistic state, and server entities win', async () => {
    const atomicCalls: Array<{
      projectId: string;
      name: string;
      replaces: string;
      expectedUpdatedAt: string;
      key: string;
    }> = [];
    const saved: Project[] = [];
    const base = makeDeps();
    const deps: ProjectStoreDeps = {
      ...base.deps,
      saveProject: async (p) => {
        saved.push(p);
      },
      canUpdateProjectWithInlineCustomer: () => true,
      updateProjectWithInlineCustomer: async (p, name, ctx) => {
        atomicCalls.push({
          projectId: p.id,
          name,
          replaces: ctx.replacesCustomerId,
          expectedUpdatedAt: ctx.expectedProjectUpdatedAt,
          key: ctx.idempotencyKey,
        });
        return {
          project: {
            ...p,
            customerId: 'server-cust-1',
            ownerUserId: 'server-owner',
            updatedAt: '2026-09-13T23:45:00.000Z',
          },
          customer: { id: 'server-cust-1', name: 'Server Name', active: true },
        };
      },
    };
    const store = createProjectStore({ deps });
    store.getState().setProjects([
      makeProject({ id: 'proj-1', customerId: 'cust-base', status: 'draft' }),
    ]);
    const cat = seedCatalog();

    store.getState().updateProject('proj-1', projectDraft, cat, {
      id: 'user-1',
    });

    // No legacy PUT, local customer or optimistic project mutation may escape
    // before the atomic server commit.
    expect(saved).toHaveLength(0);
    expect(store.getState().projects[0]!.customerId).toBe('cust-base');
    expect(
      getCatalogStoreState().catalog?.customers?.some(
        (customer) => customer.name === 'New Customer',
      ),
    ).toBe(false);
    // The intention runs through the single atomic server transition.
    expect(atomicCalls).toHaveLength(1);
    expect(atomicCalls[0]!.projectId).toBe('proj-1');
    expect(atomicCalls[0]!.name).toBe('New Customer');
    expect(atomicCalls[0]!.replaces).toBe('cust-base');
    expect(atomicCalls[0]!.expectedUpdatedAt).toBe(
      '2024-01-01T00:00:00.000Z',
    );
    expect(atomicCalls[0]!.key).toMatch(/^web:/);

    await vi.waitFor(() => {
      expect(store.getState().projects[0]).toMatchObject({
        customerId: 'server-cust-1',
        ownerUserId: 'server-owner',
        updatedAt: '2026-09-13T23:45:00.000Z',
      });
    });
    const customers = getCatalogStoreState().catalog?.customers ?? [];
    expect(customers.filter((customer) => customer.id === 'server-cust-1')).toEqual([
      { id: 'server-cust-1', name: 'Server Name', active: true },
    ]);
  });

  it('#714: failure preserves the prior project/customer state and keeps the key for retry', async () => {
    const calls: Array<{ key: string; expectedUpdatedAt: string }> = [];
    let fail = true;
    const base = makeDeps();
    const deps: ProjectStoreDeps = {
      ...base.deps,
      canUpdateProjectWithInlineCustomer: () => true,
      updateProjectWithInlineCustomer: async (p, name, ctx) => {
        calls.push({
          key: ctx.idempotencyKey,
          expectedUpdatedAt: ctx.expectedProjectUpdatedAt,
        });
        if (fail) throw new Error('lost response');
        return {
          project: { ...p, customerId: 'server-cust-retry' },
          customer: { id: 'server-cust-retry', name, active: true },
        };
      },
    };
    const store = createProjectStore({ deps });
    const original = makeProject({ customerId: 'cust-base' });
    store.getState().setProjects([original]);
    const cat = seedCatalog();

    store.getState().updateProject('proj-1', projectDraft, cat, { id: 'user-1' });
    await vi.waitFor(() => expect(base.toasts.at(-1)?.type).toBe('error'));
    expect(store.getState().projects[0]).toEqual(original);
    expect(
      getCatalogStoreState().catalog?.customers?.some(
        (customer) => customer.name === 'New Customer',
      ),
    ).toBe(false);

    fail = false;
    store.getState().updateProject('proj-1', projectDraft, cat, { id: 'user-1' });
    await vi.waitFor(() => {
      expect(store.getState().projects[0]!.customerId).toBe('server-cust-retry');
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
  });

  it('#714: 409 requires refresh, preserves state and does not retry automatically', async () => {
    let calls = 0;
    const base = makeDeps();
    const deps: ProjectStoreDeps = {
      ...base.deps,
      canUpdateProjectWithInlineCustomer: () => true,
      updateProjectWithInlineCustomer: async () => {
        calls += 1;
        throw new ProjectInlineUpdateHttpError(409, 'project changed concurrently');
      },
    };
    const store = createProjectStore({ deps });
    const original = makeProject({ customerId: 'cust-base' });
    store.getState().setProjects([original]);

    store.getState().updateProject('proj-1', projectDraft, seedCatalog(), {
      id: 'user-1',
    });

    await vi.waitFor(() => expect(base.toasts).toHaveLength(1));
    expect(base.toasts[0]).toEqual({
      type: 'error',
      message: 'La cotización cambió en el servidor. Recargá antes de volver a guardar.',
    });
    expect(calls).toBe(1);
    expect(store.getState().projects[0]).toEqual(original);
  });

  it('#714: refresh creates a new intention with a new key and updated token', async () => {
    const calls: Array<{ key: string; expectedUpdatedAt: string }> = [];
    const base = makeDeps();
    const deps: ProjectStoreDeps = {
      ...base.deps,
      canUpdateProjectWithInlineCustomer: () => true,
      updateProjectWithInlineCustomer: async (_project, _name, context) => {
        calls.push({
          key: context.idempotencyKey,
          expectedUpdatedAt: context.expectedProjectUpdatedAt,
        });
        throw new ProjectInlineUpdateHttpError(409, 'project changed concurrently');
      },
    };
    const store = createProjectStore({ deps });
    store.getState().setProjects([
      makeProject({ customerId: 'cust-base', updatedAt: '2024-01-01T00:00:00.000Z' }),
    ]);
    const cat = seedCatalog();

    store.getState().updateProject('proj-1', projectDraft, cat, { id: 'user-1' });
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    store.getState().setProjects([
      makeProject({ customerId: 'cust-base', updatedAt: '2026-09-13T23:59:00.000Z' }),
    ]);
    store.getState().updateProject('proj-1', projectDraft, cat, { id: 'user-1' });
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    expect(calls[0]!.expectedUpdatedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(calls[1]!.expectedUpdatedAt).toBe('2026-09-13T23:59:00.000Z');
    expect(calls[1]!.key).not.toBe(calls[0]!.key);
  });

  it('#714: reconciliation is id-based when a refresh already inserted the pair', async () => {
    let release!: (value: { project: Project; customer: Customer }) => void;
    const response = new Promise<{ project: Project; customer: Customer }>(
      (resolve) => { release = resolve; },
    );
    const base = makeDeps();
    const deps: ProjectStoreDeps = {
      ...base.deps,
      canUpdateProjectWithInlineCustomer: () => true,
      updateProjectWithInlineCustomer: async () => response,
    };
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject({ customerId: 'cust-base' })]);
    const cat = seedCatalog();

    store.getState().updateProject('proj-1', projectDraft, cat, { id: 'user-1' });
    store.getState().setProjects([
      makeProject({ id: 'proj-1', name: 'Refresh stale project' }),
    ]);
    getCatalogStoreState().setCatalog({
      ...cat,
      customers: [
        ...(cat.customers ?? []),
        { id: 'server-cust-1', name: 'Refresh stale customer', active: true },
      ],
    });
    release({
      project: makeProject({
        id: 'proj-1',
        name: 'Server project',
        customerId: 'server-cust-1',
      }),
      customer: { id: 'server-cust-1', name: 'Server customer', active: true },
    });

    await vi.waitFor(() => {
      expect(store.getState().projects[0]!.name).toBe('Server project');
    });
    expect(store.getState().projects).toHaveLength(1);
    const matches = (getCatalogStoreState().catalog?.customers ?? []).filter(
      (customer) => customer.id === 'server-cust-1',
    );
    expect(matches).toEqual([
      { id: 'server-cust-1', name: 'Server customer', active: true },
    ]);
  });

  it('reconciles the project by id — a concurrent insert cannot duplicate it', async () => {
    const { deps } = makeAtomicDeps(false, () => 'p-fixed');
    const store = createProjectStore({ deps });
    const cat = seedCatalog();
    // Simulate a concurrent reconciliation that already inserted the id.
    store.getState().setProjects([
      makeProject({ id: 'p-fixed', name: 'Concurrent stale copy' }),
    ]);

    store.getState().createProject(projectDraft, cat, { id: 'user-1' });
    await vi.waitFor(() => {
      expect(store.getState().projects[0]).toEqual(lastServerProject);
    });

    expect(store.getState().projects).toHaveLength(1);
    expect(store.getState().projects[0]!.id).toBe('p-fixed');
    expect(store.getState().projects[0]!.name).not.toBe('Concurrent stale copy');
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

  it('draft to draft does not resolve prices even with an incomplete catalog', () => {
    const { deps, savedProjects } = makeDeps();
    const store = createProjectStore({ deps });
    store.getState().setProjects([makeProject()]);
    const incomplete: Catalog = {
      materials: [],
      edges: [],
      hardware: [],
      categories: [],
      optionGroups: [],
      modules: [],
    };

    expect(() =>
      store.getState().updateProject(
        'proj-1',
        { ...projectDraft, name: 'Still draft', customerId: 'c1' },
        incomplete,
        { role: 'admin' },
      ),
    ).not.toThrow();
    expect(savedProjects).toHaveLength(1);
  });
});

describe('projectStore — changeProjectStatus resolution errors', () => {
  it('toasts ResolutionError and keeps project state intact', () => {
    const { deps, savedProjects, toasts } = makeDeps();
    const store = createProjectStore({ deps });
    const catalog = seedCatalog();
    const module = catalog.modules[0]!;
    const original = makeProject({
      items: [
        {
          id: 'item-invalid',
          moduleId: module.id,
          quantity: 1,
          optionChoices: {},
        },
      ],
    });
    store.getState().setProjects([original]);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    store.getState().changeProjectStatus('proj-1', 'accepted', catalog);

    expect(store.getState().projects[0]).toBe(original);
    expect(savedProjects).toHaveLength(0);
    expect(toasts).toContainEqual(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('faltan materiales/herrajes'),
      }),
    );
    errorSpy.mockRestore();
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

  it('restoreProjectItems con order restaura la posición original', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    const a: ProjectItem = { id: 'a', moduleId: 'mod-1', quantity: 1, optionChoices: {} };
    const b: ProjectItem = { id: 'b', moduleId: 'mod-1', quantity: 1, optionChoices: {} };
    const c: ProjectItem = { id: 'c', moduleId: 'mod-1', quantity: 1, optionChoices: {} };
    store.getState().setProjects([makeProject({ items: [a, b, c] })]);

    // se borró el del medio; el undo lo devuelve a su lugar, no al final
    store.getState().removeProjectItem('proj-1', 'b');
    store.getState().restoreProjectItems('proj-1', [b], ['a', 'b', 'c']);

    expect(store.getState().projects[0]!.items.map((i) => i.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('restoreProjectItems restaura varios contiguos en orden', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    const mk = (id: string): ProjectItem => ({
      id,
      moduleId: 'mod-1',
      quantity: 1,
      optionChoices: {},
    });
    const order = ['a', 'b', 'c', 'd'];
    store.getState().setProjects([
      makeProject({ items: order.map((id) => mk(id)) }),
    ]);

    store.getState().removeProjectItem('proj-1', 'b');
    store.getState().removeProjectItem('proj-1', 'c');
    store.getState().restoreProjectItems('proj-1', [mk('c'), mk('b')], order);

    expect(store.getState().projects[0]!.items.map((i) => i.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('restoreProjectItems no pisa reordenamientos posteriores a la eliminación', () => {
    const { deps } = makeDeps();
    const store = createProjectStore({ deps });
    const mk = (id: string): ProjectItem => ({
      id,
      moduleId: 'mod-1',
      quantity: 1,
      optionChoices: {},
    });

    // estado tras eliminar b y que el usuario reordere a/c a [c, a]
    store.getState().setProjects([makeProject({ items: [mk('c'), mk('a')] })]);

    // b vuelve antes de su primer sobreviviente posterior (c), sin deshacer
    // el reordenamiento de los demás
    store.getState().restoreProjectItems('proj-1', [mk('b')], [
      'a',
      'b',
      'c',
    ]);

    expect(store.getState().projects[0]!.items.map((i) => i.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
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
    store.getState().reopenProject('proj-1', seedCatalog(), ['vendedor']);
    expect(store.getState().projects[0]!.status).toBe('accepted');

    store.getState().reopenProject('proj-1', seedCatalog(), ['admin']);
    expect(store.getState().projects[0]!.status).toBe('draft');

    store.getState().setProjects([makeProject({ status: 'quoted' })]);
    store.getState().reopenProject('proj-1', seedCatalog(), ['vendedor']);
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
  it('includes the backend calculation error in the user-facing notification', () => {
    const toast = vi.fn();

    notifyBackendCalculationFailure(
      new BackendCalculationHttpError(
        "missing option choice for role 'ZOCLO' on part ZOCLO-AUTO",
      ),
      toast,
    );

    expect(toast).toHaveBeenCalledWith({
      type: 'error',
      message:
        "No se pudo recalcular en el servidor; mostrando valores locales: missing option choice for role 'ZOCLO' on part ZOCLO-AUTO",
    });
  });

  it('keeps the generic notification for a status-only calculation error', () => {
    const toast = vi.fn();

    notifyBackendCalculationFailure(
      new BackendCalculationHttpError('No se pudo recalcular (400)'),
      toast,
    );

    expect(toast).toHaveBeenCalledWith({
      type: 'error',
      message:
        'No se pudo recalcular en el servidor; mostrando valores locales',
    });
  });

  it('keeps the generic notification for network failures (no backend cause)', () => {
    const toast = vi.fn();

    // The fetch rejects before any HTTP response when the backend is down —
    // "Failed to fetch" is transport noise, not an actionable cause.
    notifyBackendCalculationFailure(new TypeError('Failed to fetch'), toast);

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      type: 'error',
      message:
        'No se pudo recalcular en el servidor; mostrando valores locales',
    });
  });

  it('uses the API message from a flat calculation error envelope', async () => {
    const response = new Response(
      JSON.stringify({
        code: 'BAD_REQUEST',
        message: 'Falta material en el mueble',
      }),
      { status: 400 },
    );

    await expect(readBackendCalculationErrorMessage(response)).resolves.toBe(
      'Falta material en el mueble',
    );
  });

  it('exports a function (hook wiring contract)', () => {
    expect(typeof useBackendBreakdownEffect).toBe('function');
  });
});

describe('projectStore — Warranty Desk & Refabrication (CRM Phase 3)', () => {
  it('loads, creates, updates and deletes warranty tickets', async () => {
    const mockTicket: import('@granete/domain').WarrantyTicket = {
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
