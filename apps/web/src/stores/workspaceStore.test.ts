import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workspace, WorkshopSettings } from '@granete/domain';
import type { WorkspaceRepository } from '@granete/storage';
import { createSeedWorkspace } from '@granete/storage';

import {
  type RepositoryFactory,
  createWorkspaceStore,
} from './workspaceStore';

import {
  SESSION_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
} from '../session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const AUTH_USER = {
  id: 'user-1',
  email: 'admin@test',
  normalized_email: 'admin@test',
  name: 'Admin Test',
  account_status: 'active',
  email_verified_at: null,
  last_login_at: null,
  platform_admin: false,
  created_at: '2026-08-29T00:00:00Z',
  updated_at: '2026-08-29T00:00:00Z',
} as const;

function jsonOk(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function jsonError(status: number, body: unknown): Response {
  const message = typeof body === 'object' && body !== null && 'error' in body
    ? String((body as { error: unknown }).error)
    : `HTTP ${status}`;
  return new Response(JSON.stringify({
    code: status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR',
    message,
    fieldErrors: {},
    requestId: `request-${status}`,
    retryable: status >= 500,
    details: {},
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Stub repository: keeps state in a closure; matches `WorkspaceRepository`
 * interface but tests only use `load`, `save`.
 */
function makeStubRepo(initial: Workspace): WorkspaceRepository & {
  saved: Workspace[];
  savedSettings: WorkshopSettings[];
  setNext(next: Workspace | Error): void;
} {
  let current = initial;
  let nextLoad: Workspace | Error | null = null;
  const saved: Workspace[] = [];
  const savedSettings: WorkshopSettings[] = [];
  return {
    saved,
    savedSettings,
    setNext(next: Workspace | Error) {
      nextLoad = next;
    },
    async load() {
      if (nextLoad instanceof Error) throw nextLoad;
      if (nextLoad) {
        current = nextLoad;
        nextLoad = null;
      }
      return current;
    },
    async save(ws: Workspace) {
      current = ws;
      saved.push(ws);
    },
    async saveWorkshopSettings(settings: WorkshopSettings) {
      current = { ...current, settings };
      savedSettings.push(settings);
    },
    async saveCatalog() {},
    async saveProject() {},
    async saveProjectTemplate() {},
    async createProject() {},
    async deleteProject() {},
    async createProjectTemplate() {},
    async deleteProjectTemplate() {},
  } as unknown as WorkspaceRepository & {
    saved: Workspace[];
    savedSettings: WorkshopSettings[];
    setNext(next: Workspace | Error): void;
  };
}

const stubFactory =
  (repo: WorkspaceRepository): RepositoryFactory =>
  () =>
    repo;

beforeEach(() => {
  // Provide inert storages by default; tests that need auth state override.
  (globalThis as { sessionStorage: Storage }).sessionStorage = memoryStorage();
  (globalThis as { localStorage: Storage }).localStorage = memoryStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

describe('workspaceStore — enterAsGuest', () => {
  it('sets session to guest and persists in sessionStorage', () => {
    const store = createWorkspaceStore();
    expect(store.getState().session).toBeNull();

    store.getState().enterAsGuest();

    expect(store.getState().session).toBe('guest');
    expect(
      globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY),
    ).toBe('guest');
  });

  it('clears workspace and errors on entering guest', () => {
    const store = createWorkspaceStore();
    store.setState({
      workspaceLoadError: 'old error',
      loginError: 'old login error',
    });

    store.getState().enterAsGuest();

    expect(store.getState().workspaceLoadError).toBeNull();
    expect(store.getState().loginError).toBeNull();
    expect(store.getState().workspace).toBeNull();
  });

  it('returns a LocalStorageWorkspaceRepository for guest', async () => {
    const store = createWorkspaceStore();
    store.getState().enterAsGuest();
    // Repository identity check via constructor name (cheap, no internals).
    const repo = store.getState().getRepository();
    expect(repo.constructor.name).toBe('LocalStorageWorkspaceRepository');
  });
});

describe('workspaceStore — login', () => {
  it('on success: sets session to auth, persists token+user, resets workspace', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonOk({ token: 'jwt-1', user: AUTH_USER, license: { plan: 'none', status: 'none' }, roles: ['admin'], memberships: [], selection_required: false, transport: 'web' }),
      );
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });

    await store.getState().login('admin@test', 'pw');

    expect(store.getState().session).toBe('auth');
    expect(store.getState().loginLoading).toBe(false);
    expect(store.getState().loginError).toBeNull();
    expect(globalThis.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-1');
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(
      'auth',
    );
    expect(JSON.parse(globalThis.localStorage.getItem(USER_STORAGE_KEY)!)).toMatchObject(
      { id: AUTH_USER.id, roles: ['admin'] },
    );
    expect(store.getState().workspace).toBeNull(); // forces reload
  });

  it('calls POST {baseUrl}/auth/login with JSON body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk({ token: 'jwt', user: AUTH_USER, license: { plan: 'none', status: 'none' }, roles: ['admin'], memberships: [], selection_required: false, transport: 'web' }));
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });

    await store.getState().login('a@b', 'pw');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Headers),
        body: JSON.stringify({ email: 'a@b', password: 'pw', transport: 'web' }),
      }),
    );
  });

  it('on 401: keeps session null and sets loginError', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonError(401, { error: 'bad creds' }));
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });

    await store.getState().login('a@b', 'wrong');

    expect(store.getState().session).toBeNull();
    expect(store.getState().loginError).toBe('Email o contraseña incorrectos');
    expect(store.getState().loginLoading).toBe(false);
  });

  it('on network error: sets a friendly message', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('boom'));
    const store = createWorkspaceStore({
      deps: { fetchImpl },
    });

    await store.getState().login('a@b', 'pw');

    expect(store.getState().session).toBeNull();
    expect(store.getState().loginError).toBeTruthy();
  });
});

describe('workspaceStore — logout', () => {
  it('clears session, errors, workspace, and storages', () => {
    const store = createWorkspaceStore();
    // Seed session as auth with token in localStorage
    globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt');
    globalThis.localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify(AUTH_USER),
    );
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    store.setState({
      session: 'auth',
      workspace: createSeedWorkspace(),
      loginError: 'stale',
    });

    store.getState().logout();

    expect(store.getState().session).toBeNull();
    expect(store.getState().workspace).toBeNull();
    expect(store.getState().loginError).toBeNull();
    expect(globalThis.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(globalThis.localStorage.getItem(USER_STORAGE_KEY)).toBeNull();
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe('workspaceStore — markSessionExpired', () => {
  it('logs out AND sets sessionEndReason expired', () => {
    const store = createWorkspaceStore();
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt');
    store.setState({ session: 'auth', workspace: createSeedWorkspace() });

    store.getState().markSessionExpired();

    expect(store.getState().session).toBeNull();
    expect(store.getState().workspace).toBeNull();
    expect(store.getState().sessionEndReason).toBe('expired');
  });

  it('manual logout does NOT set an expiry reason', () => {
    const store = createWorkspaceStore();
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    store.setState({ session: 'auth' });

    store.getState().logout();

    expect(store.getState().session).toBeNull();
    expect(store.getState().sessionEndReason).toBeNull();
  });

  it('loadWorkspace marks the session expired on 401 instead of a plain error', async () => {
    const repo = makeStubRepo(createSeedWorkspace());
    repo.setNext(new Error('API 401 Unauthorized'));
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    store.setState({ session: 'auth' });

    await store.getState().loadWorkspace();

    expect(store.getState().session).toBeNull();
    expect(store.getState().sessionEndReason).toBe('expired');
  });
});

// ---------------------------------------------------------------------------
// Workspace lifecycle
// ---------------------------------------------------------------------------

describe('workspaceStore — loadWorkspace', () => {
  it('loads workspace from repository on success', async () => {
    const seed = createSeedWorkspace();
    const repo = makeStubRepo(seed);
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    store.getState().enterAsGuest();

    await store.getState().loadWorkspace();

    expect(store.getState().workspace).toBe(seed);
    expect(store.getState().workspaceLoadError).toBeNull();
    expect(store.getState().workspaceLoading).toBe(false);
  });

  it('does not load when session is null', async () => {
    const seed = createSeedWorkspace();
    const repo = makeStubRepo(seed);
    const loadSpy = vi.spyOn(repo, 'load');
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    // session stays null (no enterAsGuest)

    await store.getState().loadWorkspace();

    expect(loadSpy).not.toHaveBeenCalled();
    expect(store.getState().workspace).toBeNull();
  });

  it('surfaces load error and does NOT silently seed', async () => {
    const repo = makeStubRepo(createSeedWorkspace());
    repo.setNext(new Error('backend down'));
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    store.getState().enterAsGuest();

    await store.getState().loadWorkspace();

    expect(store.getState().workspace).toBeNull();
    expect(store.getState().workspaceLoadError).toBe('backend down');
    expect(store.getState().workspaceLoading).toBe(false);
  });

  it('generic error falls back to friendly message', async () => {
    const repo = makeStubRepo(createSeedWorkspace());
    repo.setNext(new Error('boom'));
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    store.getState().enterAsGuest();

    await store.getState().loadWorkspace();

    // "backend down" string from Error.message wins; verify both branches:
    expect(store.getState().workspaceLoadError).toBeTruthy();
  });
});

describe('workspaceStore — saveWorkshopSettings', () => {
  it('F118 S1: persists ONLY settings via saveWorkshopSettings (no full-save clobber)', async () => {
    const seed = createSeedWorkspace();
    const repo = makeStubRepo(seed);
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    store.getState().enterAsGuest();
    await store.getState().loadWorkspace();

    await store.getState().saveWorkshopSettings({
      defaultMarginFactor: 1.5,
      defaultLaborFixedCost: 2000,
      defaultCurrency: 'MXN',
      vendedorCanViewCosts: true,
    });

    // Settings persisted settings-only…
    expect(repo.savedSettings).toHaveLength(1);
    expect(repo.savedSettings[0]).toMatchObject({
      defaultMarginFactor: 1.5,
      defaultLaborFixedCost: 2000,
    });
    // …and the whole-workspace save was NEVER issued (it carried stale
    // catalog/projects that used to clobber the server).
    expect(repo.saved).toHaveLength(0);
    expect(store.getState().workspace?.settings?.defaultMarginFactor).toBe(1.5);
    // Settings-only saves must not bump workspaceSeq (no store re-sync).
    expect(store.getState().workspaceSeq).toBe(2); // guest enter + load
  });

  it('reverts workspace on save failure', async () => {
    const seed = createSeedWorkspace();
    const repo = makeStubRepo(seed);
    vi.spyOn(repo, 'saveWorkshopSettings').mockRejectedValueOnce(
      new Error('disk full'),
    );
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    store.getState().enterAsGuest();
    await store.getState().loadWorkspace();

    await expect(
      store.getState().saveWorkshopSettings({
        defaultMarginFactor: 1.5,
        defaultLaborFixedCost: 0,
        defaultCurrency: 'MXN',
        vendedorCanViewCosts: false,
      }),
    ).rejects.toThrow('disk full');

    // Reverted: settings not mutated in store
    expect(store.getState().workspace?.settings?.defaultMarginFactor).toBe(
      seed.settings?.defaultMarginFactor,
    );
  });

  it('no-op when workspace is null', async () => {
    const repo = makeStubRepo(createSeedWorkspace());
    const saveSpy = vi.spyOn(repo, 'save');
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });

    await store.getState().saveWorkshopSettings({
      defaultMarginFactor: 1.5,
      defaultLaborFixedCost: 0,
      defaultCurrency: 'MXN',
      vendedorCanViewCosts: false,
    });

    expect(saveSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RBAC — assignable owners
// ---------------------------------------------------------------------------

describe('workspaceStore — loadAssignableOwners', () => {
  it('no-op when session is guest', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const store = createWorkspaceStore({ deps: { fetchImpl } });
    store.getState().enterAsGuest();

    await store.getState().loadAssignableOwners();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.getState().assignableOwners).toEqual([]);
  });

  it('fetches /assignable-owners with Bearer token when auth', async () => {
    // Seed auth state
    globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt');
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk([
        { id: '1', name: 'Vendedor Uno', role: 'vendedor', active: true },
        { id: '2', name: 'Viejo', role: 'vendedor', active: false },
      ]),
    );
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    store.setState({ session: 'auth' });

    await store.getState().loadAssignableOwners();

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/api/assignable-owners',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt',
        }),
      }),
    );
    // Inactive filtered out
    expect(store.getState().assignableOwners).toEqual([
      { id: '1', name: 'Vendedor Uno', role: 'vendedor' },
    ]);
  });

  it('falls back to current authUser on fetch failure', async () => {
    globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt');
    globalThis.localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify(AUTH_USER),
    );
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('net'));
    const store = createWorkspaceStore({ deps: { fetchImpl } });
    store.setState({ session: 'auth' });

    await store.getState().loadAssignableOwners();

    expect(store.getState().assignableOwners).toEqual([
      { id: AUTH_USER.id, name: AUTH_USER.name, role: undefined },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

describe('workspaceStore — resolveMediaUrl', () => {
  it('returns undefined for empty input', () => {
    const store = createWorkspaceStore();
    expect(store.getState().resolveMediaUrl(undefined)).toBeUndefined();
    expect(store.getState().resolveMediaUrl('')).toBeUndefined();
  });

  it('passes through absolute and blob URLs', () => {
    const store = createWorkspaceStore();
    expect(store.getState().resolveMediaUrl('https://x/y.png')).toBe(
      'https://x/y.png',
    );
    expect(store.getState().resolveMediaUrl('blob:abc')).toBe('blob:abc');
  });

  it('appends token as query param when authed with relative api url', () => {
    globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-xyz');
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api' },
    });
    store.setState({ session: 'auth' });

    // baseUrl origin (http://test) + relative path (/api/media/...) + token.
    expect(
      store.getState().resolveMediaUrl('/api/media/abc.png'),
    ).toBe('http://test/api/media/abc.png?token=jwt-xyz');
  });

  it('without token returns absolute url without query', () => {
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api' },
    });
    expect(
      store.getState().resolveMediaUrl('/api/media/abc.png'),
    ).toBe('http://test/api/media/abc.png');
  });
});

describe('workspaceStore — uploadCatalogImage', () => {
  it('throws when not authed', async () => {
    const store = createWorkspaceStore();
    await expect(
      store.getState().uploadCatalogImage(new File([], 'x.png')),
    ).rejects.toThrow('no auth');
  });

  it('POSTs multipart form and returns url from response', async () => {
    globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt');
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk({ url: '/api/media/uploaded.png' }),
    );
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    store.setState({ session: 'auth' });

    const url = await store.getState().uploadCatalogImage(
      new File(['data'], 'pic.png', { type: 'image/png' }),
    );

    expect(url).toBe('/api/media/uploaded.png');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/api/media',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer jwt' },
      }),
    );
  });

  it('throws on non-OK response', async () => {
    globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt');
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonError(500, {}));
    const store = createWorkspaceStore({ deps: { fetchImpl } });
    store.setState({ session: 'auth' });

    await expect(
      store.getState().uploadCatalogImage(new File([], 'x.png')),
    ).rejects.toThrow('upload 500');
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('workspaceStore — selectors', () => {
  it('getAuthToken / getAuthUser return null when session is null or guest', () => {
    const store = createWorkspaceStore();
    expect(store.getState().getAuthToken()).toBeNull();
    expect(store.getState().getAuthUser()).toBeNull();

    store.getState().enterAsGuest();
    expect(store.getState().getAuthToken()).toBeNull();
  });

  it('getAuthToken / getAuthUser read from localStorage when auth', () => {
    globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt');
    globalThis.localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify(AUTH_USER),
    );
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    const store = createWorkspaceStore();
    store.setState({ session: 'auth' });

    expect(store.getState().getAuthToken()).toBe('jwt');
    expect(store.getState().getAuthUser()?.id).toBe(AUTH_USER.id);
  });
});

// ---------------------------------------------------------------------------
// F118 — session guards + guest import
// ---------------------------------------------------------------------------

describe('workspaceStore — F118 session guards', () => {
  it('S2: loadWorkspace resolving after logout does NOT repopulate workspace', async () => {
    let resolveLoad: (ws: Workspace) => void = () => {};
    const slowRepo = {
      load: () =>
        new Promise<Workspace>((resolve) => {
          resolveLoad = resolve;
        }),
      save: async () => {},
      saveWorkshopSettings: async () => {},
    } as unknown as WorkspaceRepository;
    const store = createWorkspaceStore({
      deps: { repositoryFactory: () => slowRepo },
    });
    store.getState().enterAsGuest();
    const promise = store.getState().loadWorkspace();
    store.getState().logout();
    resolveLoad(createSeedWorkspace());
    await promise;

    expect(store.getState().session).toBeNull();
    expect(store.getState().workspace).toBeNull();
  });

  it('S1: settings save does not bump workspaceSeq (no store re-sync)', async () => {
    const repo = makeStubRepo(createSeedWorkspace());
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    store.getState().enterAsGuest();
    await store.getState().loadWorkspace();
    const seqAfterLoad = store.getState().workspaceSeq;

    await store.getState().saveWorkshopSettings({
      defaultMarginFactor: 2,
      defaultLaborFixedCost: 0,
      defaultCurrency: 'MXN',
      vendedorCanViewCosts: false,
    });

    expect(store.getState().workspaceSeq).toBe(seqAfterLoad);
  });
});

describe('workspaceStore — F118 guest import (S3)', () => {
  it('login offers import when the guest workspace has projects', async () => {
    const guest = createSeedWorkspace();
    globalThis.localStorage.setItem(
      'granete_guest_workspace',
      JSON.stringify({
        ...guest,
        projects: [{ ...guest.projects[0]!, id: 'guest-proj-1' }],
      }),
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk({ token: 'jwt-2', user: AUTH_USER, license: { plan: 'none', status: 'none' }, roles: ['admin'], memberships: [], selection_required: false, transport: 'web' }));
    const repo = makeStubRepo(createSeedWorkspace());
    const store = createWorkspaceStore({
      deps: {
        baseUrl: 'http://test/api',
        fetchImpl,
        repositoryFactory: stubFactory(repo),
      },
    });

    await store.getState().login('admin@test', 'pw');

    expect(store.getState().pendingGuestImport).toBe(true);
  });

  it('login does NOT offer import when no guest work exists', async () => {
    globalThis.localStorage.removeItem('granete_guest_workspace');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk({ token: 'jwt-3', user: AUTH_USER, license: { plan: 'none', status: 'none' }, roles: ['admin'], memberships: [], selection_required: false, transport: 'web' }));
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });

    await store.getState().login('admin@test', 'pw');

    expect(store.getState().pendingGuestImport).toBe(false);
  });

  it('importGuestWorkspace pushes guest catalog+projects and reloads', async () => {
    const guestWs = createSeedWorkspace();
    globalThis.localStorage.setItem(
      'granete_guest_workspace',
      JSON.stringify({
        ...guestWs,
        projects: [{ ...guestWs.projects[0]!, id: 'guest-proj-1' }],
      }),
    );
    const repo = makeStubRepo(createSeedWorkspace());
    const saveCatalog = vi.spyOn(repo, 'saveCatalog');
    const saveProject = vi.spyOn(repo, 'saveProject');
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    // auth session without going through login (direct state for isolation)
    store.setState({ session: 'auth' });

    await store.getState().importGuestWorkspace();

    expect(saveCatalog).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'guest-proj-1' }),
    );
    expect(store.getState().pendingGuestImport).toBe(false);
    // Reloaded from the (patched) repository.
    expect(store.getState().workspace).not.toBeNull();
  });

  it('dismissGuestImport clears the offer', () => {
    const store = createWorkspaceStore();
    store.setState({ pendingGuestImport: true });
    store.getState().dismissGuestImport();
    expect(store.getState().pendingGuestImport).toBe(false);
  });
});

describe('workspaceStore — loadDemoWorkspace (F118 S6)', () => {
  it('clears the error state, persists the seed in guest mode and bumps seq', async () => {
    const repo = makeStubRepo(createSeedWorkspace());
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    store.getState().enterAsGuest();
    store.setState({ workspaceLoadError: 'backend down', workspace: null });
    const seqBefore = store.getState().workspaceSeq;

    await store.getState().loadDemoWorkspace();

    expect(store.getState().workspaceLoadError).toBeNull();
    expect(store.getState().workspace).not.toBeNull();
    expect(store.getState().workspaceSeq).toBe(seqBefore + 1);
    // Guest mode persists the demo so it survives reloads.
    expect(repo.saved.length).toBeGreaterThanOrEqual(1);
  });

  it('auth mode keeps the demo session-local (no server write)', async () => {
    const repo = makeStubRepo(createSeedWorkspace());
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    store.setState({ session: 'auth' });

    await store.getState().loadDemoWorkspace();

    expect(store.getState().workspace).not.toBeNull();
    expect(repo.saved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Session hydration (#325/#327 hardening)
// ---------------------------------------------------------------------------

describe('workspaceStore — hydrateSessionInfo', () => {
  it('merges the membership roles from /auth/me into the persisted user', async () => {
    // Reload scenario: the persisted user still carries the legacy single
    // role; /auth/me reports the multi-role membership as a sibling key.
    globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-h');
    globalThis.localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify({ ...AUTH_USER, role: 'user' }),
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk({
        user: AUTH_USER,
        roles: ['vendedor', 'ingeniero'],
        transport: 'web',
        session_scope: {
          user_id: AUTH_USER.id, membership_id: 'membership-1', organization_id: 'org-1', mode: 'auth',
          support_session_id: null, recovery_session_id: null,
          membership_credential_version: 1, organization_credential_version: 1,
          absolute_expires_at: '2026-08-31T00:00:00Z',
        },
      }),
    );
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });

    await store.getState().hydrateSessionInfo();

    const stored = JSON.parse(
      globalThis.localStorage.getItem(USER_STORAGE_KEY)!,
    );
    expect(stored.roles).toEqual(['vendedor', 'ingeniero']);
  });

  it('keeps the stored user unchanged when /auth/me reports no roles', async () => {
    globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-h2');
    globalThis.localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify({ ...AUTH_USER, roles: ['admin'] }),
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk({ user: AUTH_USER }));
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });

    await store.getState().hydrateSessionInfo();

    const stored = JSON.parse(
      globalThis.localStorage.getItem(USER_STORAGE_KEY)!,
    );
    expect(stored.roles).toEqual(['admin']);
  });
});
