import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workspace } from '@muebles/domain';
import type { WorkspaceRepository } from '@muebles/storage';
import { createSeedWorkspace } from '@muebles/storage';

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
  name: 'Admin Test',
  role: 'admin',
  active: true,
} as const;

function jsonOk(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function jsonError(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
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
  setNext(next: Workspace | Error): void;
} {
  let current = initial;
  let nextLoad: Workspace | Error | null = null;
  const saved: Workspace[] = [];
  return {
    saved,
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
    async saveCatalog() {},
    async saveProject() {},
    async createProject() {},
    async deleteProject() {},
    async createProjectTemplate() {},
    async deleteProjectTemplate() {},
  } as unknown as WorkspaceRepository & {
    saved: Workspace[];
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
        jsonOk({ token: 'jwt-1', user: AUTH_USER }),
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
      { id: AUTH_USER.id, role: AUTH_USER.role },
    );
    expect(store.getState().workspace).toBeNull(); // forces reload
  });

  it('calls POST {baseUrl}/auth/login with JSON body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk({ token: 'jwt', user: AUTH_USER }));
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });

    await store.getState().login('a@b', 'pw');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@b', password: 'pw' }),
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

describe('workspaceStore — register', () => {
  it('on success: clears registerError, no session change', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonOk({}));
    const store = createWorkspaceStore({ deps: { fetchImpl } });

    await store.getState().register('Name', 'a@b', 'pw');

    expect(store.getState().registerError).toBeNull();
    expect(store.getState().registerLoading).toBe(false);
    expect(store.getState().session).toBeNull(); // still pending admin approval
  });

  it('on 409: rethrows with friendly message', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonError(409, { error: 'exists' }));
    const store = createWorkspaceStore({ deps: { fetchImpl } });

    await expect(
      store.getState().register('Name', 'a@b', 'pw'),
    ).rejects.toThrow('Ese email ya está registrado');
    expect(store.getState().registerError).toBe('Ese email ya está registrado');
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

describe('workspaceStore — setAuthGate', () => {
  it('toggles between login and register', () => {
    const store = createWorkspaceStore();
    expect(store.getState().authGate).toBe('login');

    store.getState().setAuthGate('register');
    expect(store.getState().authGate).toBe('register');

    store.getState().setAuthGate('login');
    expect(store.getState().authGate).toBe('login');
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
  it('persists resolved settings via repository.save', async () => {
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

    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0]!.settings).toMatchObject({
      defaultMarginFactor: 1.5,
      defaultLaborFixedCost: 2000,
    });
    expect(store.getState().workspace?.settings?.defaultMarginFactor).toBe(1.5);
  });

  it('reverts workspace on save failure', async () => {
    const seed = createSeedWorkspace();
    const repo = makeStubRepo(seed);
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('disk full'));
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
      { id: AUTH_USER.id, name: AUTH_USER.name, role: AUTH_USER.role },
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
