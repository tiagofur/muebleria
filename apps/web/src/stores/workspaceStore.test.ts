import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workspace, WorkshopSettings } from '@granete/domain';
import type { WorkspaceRepository } from '@granete/storage';
import { createSeedWorkspace } from '@granete/storage';
import { clearRegisteredDraftSessions, draftSessionKey, registerDraftSessionBaseline } from '@granete/ui';

import {
  type RepositoryFactory,
  createWorkspaceStore,
} from './workspaceStore';
import { invalidateAuthorizedMedia } from './mediaAuthorization';

import { SESSION_STORAGE_KEY } from '../session';
import * as webSessionChannel from '../webSessionChannel';
import {
  __resetWebAuthRuntimeForTests,
  applyWebCredential,
  getCredential,
} from '../webAuthRuntime';
import { __resetWebAuthClientForTests } from '../webAuthClient';
import {
  createSessionGeneration,
  sessionScopeFromSession,
} from '../shared/query/sessionScope';

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

const SESSION_SCOPE = {
  user_id: 'user-1', membership_id: 'membership-1', organization_id: 'org-1', mode: 'auth',
  support_session_id: null, recovery_session_id: null, membership_credential_version: 2,
  organization_credential_version: 3, absolute_expires_at: '2026-08-31T00:00:00Z',
} as const;

const ACTIVE_MEMBERSHIP = {
  id: 'membership-1', organization_id: 'org-1', user_id: 'user-1', status: 'active',
  roles: ['admin'], joined_at: '2026-08-29T00:00:00Z', version: 1,
  organization: {
    id: 'org-1', name: 'Taller 1', slug: 'taller-1', type: 'factory', status: 'active',
    license: { plan: 'none', status: 'none' },
  },
} as const;

function authScope(organizationId: string) {
  const organization = {
    ...ACTIVE_MEMBERSHIP.organization,
    id: organizationId,
    slug: organizationId,
  };
  return sessionScopeFromSession({
    user: AUTH_USER,
    roles: ['admin'],
    memberships: [],
    organization,
    transport: 'web',
    session_scope: {
      ...SESSION_SCOPE,
      membership_id: `membership-${organizationId}`,
      organization_id: organizationId,
    },
  }, createSessionGeneration());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonOk(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function jsonError(status: number, body: unknown, code?: string): Response {
  const message = typeof body === 'object' && body !== null && 'error' in body
    ? String((body as { error: unknown }).error)
    : `HTTP ${status}`;
  return new Response(JSON.stringify({
    code: code ?? (status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR'),
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

// SEC-4B: la sesión se siembra en el runtime de memoria (nunca storage).
const IN_15M = new Date(Date.now() + 15 * 60_000).toISOString();
const IN_18H = new Date(Date.now() + 18 * 3_600_000).toISOString();
const AUTH_RESPONSE_META = {
  access_expires_at: IN_15M,
  absolute_session_expires_at: IN_18H,
  session_id: 'sess-1',
} as const;

function seedRuntimeCredential(
  token = 'runtime-jwt',
  organizationId: string | null = 'org-1',
): void {
  applyWebCredential({
    accessToken: token,
    accessExpiresAt: IN_15M,
    absoluteSessionExpiresAt: IN_18H,
    sessionId: 'sess-1',
    userId: AUTH_USER.id,
    organizationId,
  });
}

function seedAuthSession(store: ReturnType<typeof createWorkspaceStore>): void {
  seedRuntimeCredential();
  store.setState({ session: 'auth', authBootstrapping: false, authUser: { id: AUTH_USER.id, email: AUTH_USER.email, name: AUTH_USER.name, account_status: 'active', roles: ['admin'] } });
}

beforeEach(() => {
  // Provide inert storages by default; tests that need auth state override.
  (globalThis as { sessionStorage: Storage }).sessionStorage = memoryStorage();
  (globalThis as { localStorage: Storage }).localStorage = memoryStorage();
  // Media grants are module-level and token-scoped; keep tests isolated.
  invalidateAuthorizedMedia();
  __resetWebAuthRuntimeForTests();
  __resetWebAuthClientForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetWebAuthRuntimeForTests();
  __resetWebAuthClientForTests();
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
    const notifySessionChanged = vi
      .spyOn(webSessionChannel, 'broadcastWebSessionEvent')
      .mockImplementation(() => undefined);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonOk({ token: 'jwt-1', user: AUTH_USER, license: { plan: 'none', status: 'none' }, roles: ['admin'], memberships: [ACTIVE_MEMBERSHIP], selection_required: false, transport: 'web', ...AUTH_RESPONSE_META }),
      );
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });

    await store.getState().login('admin@test', 'pw');

    expect(store.getState().session).toBe('auth');
    expect(store.getState().loginLoading).toBe(false);
    expect(store.getState().loginError).toBeNull();
    // SEC-4B: el access vive en MEMORIA; nada de esto toca localStorage.
    expect(getCredential()?.accessToken).toBe('jwt-1');
    expect(getCredential()?.sessionId).toBe('sess-1');
    expect(globalThis.localStorage.getItem('granete_token')).toBeNull();
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(
      'auth',
    );
    expect(store.getState().authUser).toMatchObject({ id: AUTH_USER.id, roles: ['admin'] });
    expect(store.getState().workspace).toBeNull(); // forces reload
    expect(store.getState().organizationChoices).toEqual([ACTIVE_MEMBERSHIP]);
    expect(notifySessionChanged).toHaveBeenCalledWith({ type: 'session-replaced' });
  });

  it('notifies other tabs after consuming an external authentication payload', () => {
    const notifySessionChanged = vi
      .spyOn(webSessionChannel, 'broadcastWebSessionEvent')
      .mockImplementation(() => undefined);
    const store = createWorkspaceStore();

    store.getState().loginWithAuthPayload({
      token: 'jwt-external',
      user: AUTH_USER,
      license: { plan: 'none', status: 'none' },
      roles: ['admin'],
      memberships: [],
      selection_required: false,
      transport: 'web',
      ...AUTH_RESPONSE_META,
    });

    expect(notifySessionChanged).toHaveBeenCalledWith({ type: 'session-replaced' });
    expect(getCredential()?.accessToken).toBe('jwt-external');
    expect(globalThis.localStorage.getItem('granete_token')).toBeNull();
  });

  it('calls POST {baseUrl}/auth/login with JSON body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk({ token: 'jwt', user: AUTH_USER, license: { plan: 'none', status: 'none' }, roles: ['admin'], memberships: [], selection_required: false, transport: 'web', ...AUTH_RESPONSE_META, ...AUTH_RESPONSE_META }));
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
  it('clears session, errors, workspace, credential and storages', async () => {
    const store = createWorkspaceStore();
    seedAuthSession(store);
    globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, 'auth');
    store.setState({
      workspace: createSeedWorkspace(),
      loginError: 'stale',
    });

    store.getState().logout();

    await vi.waitFor(() => {
      expect(store.getState().session).toBeNull();
    });
    expect(store.getState().workspace).toBeNull();
    expect(store.getState().loginError).toBeNull();
    expect(getCredential()).toBeNull();
    // SEC-4B: ningún bearer vuelve a storage, y el hint muere con la sesión.
    expect(globalThis.localStorage.getItem('granete_token')).toBeNull();
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe('workspaceStore — markSessionEnded', () => {
  it('logs out AND sets sessionEndReason expired', () => {
    const store = createWorkspaceStore();
    seedAuthSession(store);
    store.setState({ workspace: createSeedWorkspace() });

    store.getState().markSessionEnded('expired');

    expect(store.getState().session).toBeNull();
    expect(store.getState().workspace).toBeNull();
    expect(store.getState().sessionEndReason).toBe('expired');
    expect(getCredential()).toBeNull();
  });

  it('manual logout does NOT set an expiry reason', async () => {
    const store = createWorkspaceStore();
    seedAuthSession(store);

    store.getState().logout();

    await vi.waitFor(() => {
      expect(store.getState().session).toBeNull();
    });
    expect(store.getState().sessionEndReason).toBeNull();
  });

  it('loadWorkspace marks the session expired on 401 instead of a plain error', async () => {
    const repo = makeStubRepo(createSeedWorkspace());
    repo.setNext(new Error('API 401 Unauthorized'));
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    seedAuthSession(store);

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

  it('ignores a delayed organization A success after organization B commits', async () => {
    const workspaceA = createSeedWorkspace();
    const workspaceB = createSeedWorkspace();
    const delayedA = deferred<Workspace>();
    const repo = makeStubRepo(workspaceB);
    vi.spyOn(repo, 'load')
      .mockImplementationOnce(() => delayedA.promise)
      .mockResolvedValueOnce(workspaceB);
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    store.setState({ session: 'auth', sessionScope: authScope('org-a') });

    const loadA = store.getState().loadWorkspace();
    store.setState({ sessionScope: authScope('org-b'), workspace: null });
    await store.getState().loadWorkspace();
    delayedA.resolve(workspaceA);
    await loadA;

    expect(store.getState().workspace).toBe(workspaceB);
    expect(store.getState().workspaceLoadError).toBeNull();
  });

  it('ignores a delayed organization A error after organization B commits', async () => {
    const workspaceB = createSeedWorkspace();
    const delayedA = deferred<Workspace>();
    const repo = makeStubRepo(workspaceB);
    vi.spyOn(repo, 'load')
      .mockImplementationOnce(() => delayedA.promise)
      .mockResolvedValueOnce(workspaceB);
    const store = createWorkspaceStore({
      deps: { repositoryFactory: stubFactory(repo) },
    });
    store.setState({ session: 'auth', sessionScope: authScope('org-a') });

    const loadA = store.getState().loadWorkspace();
    store.setState({ sessionScope: authScope('org-b'), workspace: null });
    await store.getState().loadWorkspace();
    delayedA.reject(new Error('API 401 Unauthorized'));
    await loadA;

    expect(store.getState().session).toBe('auth');
    expect(store.getState().workspace).toBe(workspaceB);
    expect(store.getState().workspaceLoadError).toBeNull();
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
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk([
        { id: '1', name: 'Vendedor Uno', role: 'vendedor', active: true },
        { id: '2', name: 'Viejo', role: 'vendedor', active: false },
      ]),
    );
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    seedAuthSession(store);

    await store.getState().loadAssignableOwners();

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/api/assignable-owners',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer runtime-jwt',
        }),
      }),
    );
    // Inactive filtered out
    expect(store.getState().assignableOwners).toEqual([
      { id: '1', name: 'Vendedor Uno', role: 'vendedor' },
    ]);
  });

  it('falls back to current authUser on fetch failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('net'));
    const store = createWorkspaceStore({ deps: { fetchImpl } });
    seedAuthSession(store);

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

  it('non-canonical api paths pass through unchanged (no token query)', () => {
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api' },
    });
    expect(store.getState().resolveMediaUrl('/api/media/abc.png')).toBe(
      '/api/media/abc.png',
    );
  });

  // #460 SEC-3: session JWTs never ride the query string. Canonical media
  // paths resolve through short-lived signed grant URLs.
  it('resolves canonical media paths via signed grant URLs, never via ?token=', async () => {
    const file = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk({
        grants: [
          {
            filename: file,
            url: `/api/media/${file}?grant=media-grant-token`,
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
          },
        ],
      }),
    );
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    seedRuntimeCredential('jwt-xyz');
    store.setState({ session: 'auth' });
    invalidateAuthorizedMedia();

    // First (synchronous) render: the grant is on its way, no usable URL yet.
    expect(
      store.getState().resolveMediaUrl(`/api/media/${file}`),
    ).toBeUndefined();

    await vi.waitFor(() => {
      if (store.getState().resolveMediaUrl(`/api/media/${file}`) === undefined) {
        throw new Error('grant not resolved yet');
      }
    });
    const resolved = store.getState().resolveMediaUrl(`/api/media/${file}`);
    expect(resolved).toBe(`http://test/api/media/${file}?grant=media-grant-token`);
    expect(resolved).not.toContain('token=jwt-xyz');

    // The authorize call carried the session JWT in the HEADER only.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0]!;
    expect(calledUrl).toBe('http://test/api/media:authorize');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer jwt-xyz',
    });
  });

  it('logout drops cached media grants', async () => {
    const file = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk({
        grants: [
          {
            filename: file,
            url: `/api/media/${file}?grant=media-grant-token`,
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
          },
        ],
      }),
    );
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    seedRuntimeCredential('jwt-xyz');
    store.setState({ session: 'auth' });
    invalidateAuthorizedMedia();

    store.getState().resolveMediaUrl(`/api/media/${file}`);
    await vi.waitFor(() => {
      if (store.getState().resolveMediaUrl(`/api/media/${file}`) === undefined) {
        throw new Error('grant not resolved yet');
      }
    });

    store.getState().logout();
    await vi.waitFor(() => {
      expect(
        store.getState().resolveMediaUrl(`/api/media/${file}`),
      ).toBeUndefined();
    });
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
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk({ url: '/api/media/uploaded.png' }),
    );
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    seedRuntimeCredential('jwt');
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
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonError(500, {}));
    const store = createWorkspaceStore({ deps: { fetchImpl } });
    seedRuntimeCredential('jwt');
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

  it('getAuthToken / getAuthUser read from the in-memory runtime when auth', () => {
    const store = createWorkspaceStore();
    seedAuthSession(store);

    expect(store.getState().getAuthToken()).toBe('runtime-jwt');
    expect(store.getState().getAuthUser()?.id).toBe(AUTH_USER.id);
    // SEC-4B: nunca storage.
    expect(globalThis.localStorage.getItem('granete_token')).toBeNull();
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
      .mockResolvedValueOnce(jsonOk({ token: 'jwt-2', user: AUTH_USER, license: { plan: 'none', status: 'none' }, roles: ['admin'], memberships: [], selection_required: false, transport: 'web', ...AUTH_RESPONSE_META, ...AUTH_RESPONSE_META }));
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
      .mockResolvedValueOnce(jsonOk({ token: 'jwt-3', user: AUTH_USER, license: { plan: 'none', status: 'none' }, roles: ['admin'], memberships: [], selection_required: false, transport: 'web', ...AUTH_RESPONSE_META, ...AUTH_RESPONSE_META }));
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
  it('merges the membership roles from /auth/me into the in-memory user', async () => {
    // Reload scenario: the runtime user still carries the legacy single
    // role; /auth/me reports the multi-role membership as a sibling key.
    seedRuntimeCredential('jwt-h');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk({
        user: AUTH_USER,
        roles: ['vendedor', 'ingeniero'],
        memberships: [
          ACTIVE_MEMBERSHIP,
          { ...ACTIVE_MEMBERSHIP, id: 'membership-2', status: 'suspended' },
        ],
        organization: {
          id: 'org-1',
          name: 'Taller 1',
          slug: 'taller-1',
          type: 'factory',
          status: 'active',
          license: { plan: 'none', status: 'none' },
        },
        transport: 'web',
        session_scope: SESSION_SCOPE,
      }),
    );
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    store.setState({ session: 'auth', authBootstrapping: false, authUser: { ...AUTH_USER, role: 'user' } as never });

    await store.getState().hydrateSessionInfo();

    expect(store.getState().authUser?.roles).toEqual(['vendedor', 'ingeniero']);
    expect(store.getState().sessionScope).toMatchObject({ organizationId: 'org-1', mode: 'auth' });
    expect(store.getState().organizationChoices).toEqual([ACTIVE_MEMBERSHIP]);
  });

  it('keeps the current user unchanged when /auth/me reports no roles', async () => {
    seedRuntimeCredential('jwt-h2');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk({ user: AUTH_USER }));
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    store.setState({ session: 'auth', authBootstrapping: false, authUser: { ...AUTH_USER, roles: ['admin'] } as never });

    await store.getState().hydrateSessionInfo();

    expect(store.getState().authUser?.roles).toEqual(['admin']);
  });

  it('keeps one generation while revalidating the same active session', async () => {
    seedRuntimeCredential('jwt-h3');
    const response = {
      user: AUTH_USER,
      roles: ['admin'],
      memberships: [ACTIVE_MEMBERSHIP],
      organization: {
        id: 'org-1',
        name: 'Taller 1',
        slug: 'taller-1',
        type: 'factory',
        status: 'active',
        license: { plan: 'none', status: 'none' },
      },
      transport: 'web',
      session_scope: SESSION_SCOPE,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk(response))
      .mockResolvedValueOnce(jsonOk(response));
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    store.setState({ session: 'auth', authBootstrapping: false });

    await store.getState().hydrateSessionInfo();
    const firstGeneration = store.getState().sessionScope?.sessionGeneration;
    await store.getState().hydrateSessionInfo();

    expect(firstGeneration).toBeTruthy();
    expect(store.getState().sessionScope?.sessionGeneration).toBe(firstGeneration);
  });

  it('ignores a delayed organization A hydration after organization B commits', async () => {
    const delayedA = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => delayedA.promise);
    seedRuntimeCredential('jwt-a', 'org-a');
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    store.setState({ session: 'auth', authBootstrapping: false, sessionScope: authScope('org-a') });

    const hydrateA = store.getState().hydrateSessionInfo();
    // Organization B commits: nuevo credential en memoria + scope B.
    seedRuntimeCredential('jwt-b', 'org-b');
    const scopeB = authScope('org-b');
    store.setState({ sessionScope: scopeB, activeOrg: { ...ACTIVE_MEMBERSHIP.organization, id: 'org-b' } });
    delayedA.resolve(jsonOk({
      user: AUTH_USER,
      roles: ['admin'],
      memberships: [ACTIVE_MEMBERSHIP],
      organization: ACTIVE_MEMBERSHIP.organization,
      transport: 'web',
      session_scope: SESSION_SCOPE,
    }));
    await hydrateA;

    // La response tardía de A NO puede repoblar el estado de B.
    expect(getCredential()?.accessToken).toBe('jwt-b');
    expect(store.getState().sessionScope).toBe(scopeB);
    expect(store.getState().activeOrg?.id).toBe('org-b');
    expect(store.getState().organizationChoices).toEqual([]);
  });

  it('keeps organization B intact when a delayed organization A hydration errors', async () => {
    const delayedA = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => delayedA.promise);
    seedRuntimeCredential('jwt-a', 'org-a');
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl },
    });
    store.setState({ session: 'auth', authBootstrapping: false, sessionScope: authScope('org-a') });

    const hydrateA = store.getState().hydrateSessionInfo();
    seedRuntimeCredential('jwt-b', 'org-b');
    const scopeB = authScope('org-b');
    store.setState({ sessionScope: scopeB });
    delayedA.reject(new Error('organization A unavailable'));
    await hydrateA;

    expect(getCredential()?.accessToken).toBe('jwt-b');
    expect(store.getState().sessionScope).toBe(scopeB);
  });
});

describe('workspaceStore — atomic organization transition', () => {
  const storeTenantADraft = () => {
    const key = draftSessionKey('module', 'tenant-a');
    registerDraftSessionBaseline(key, { name: 'baseline' });
    globalThis.sessionStorage.setItem(key, '{"name":"tenant A draft"}');
    return key;
  };
  const selected = {
    token: 'jwt-new', user: AUTH_USER, license: { plan: 'none', status: 'none' },
    roles: ['admin'], memberships: [], selection_required: false, transport: 'web', ...AUTH_RESPONSE_META,
    organization: { id: 'org-1', name: 'Taller 1', slug: 'taller-1', type: 'factory', status: 'active', license: { plan: 'none', status: 'none' } },
  };

  it('commits the new token only after its authoritative scope validates', async () => {
    seedRuntimeCredential('jwt-old');
    const draftKey = storeTenantADraft();
    const transition = { prepare: vi.fn(async () => undefined), commit: vi.fn(clearRegisteredDraftSessions) };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk(selected))
      .mockResolvedValueOnce(jsonOk({
        user: AUTH_USER, roles: ['admin'], organization: selected.organization,
        memberships: [ACTIVE_MEMBERSHIP],
        transport: 'web', session_scope: SESSION_SCOPE,
      }));
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl, tenantTransition: transition },
    });

    await store.getState().selectOrg('org-1');

    expect(transition.prepare.mock.invocationCallOrder[0]).toBeGreaterThan(
      fetchImpl.mock.invocationCallOrder[1]!,
    );
    expect(transition.commit).toHaveBeenCalledOnce();
    expect(getCredential()?.accessToken).toBe('jwt-new');
    expect(store.getState().sessionScope?.organizationId).toBe('org-1');
    expect(store.getState().organizationChoices).toEqual([ACTIVE_MEMBERSHIP]);
    expect(globalThis.sessionStorage.getItem(draftKey)).toBeNull();
  });

  it('leaves active-session workspace loading to the shell owner', async () => {
    seedRuntimeCredential('jwt-old');
    const workspaceB = createSeedWorkspace();
    const repo = makeStubRepo(workspaceB);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk(selected))
      .mockResolvedValueOnce(jsonOk({
        user: AUTH_USER, roles: ['admin'], organization: selected.organization,
        memberships: [ACTIVE_MEMBERSHIP],
        transport: 'web', session_scope: SESSION_SCOPE,
      }));
    const store = createWorkspaceStore({
      deps: {
        baseUrl: 'http://test/api', fetchImpl,
        repositoryFactory: stubFactory(repo),
      },
    });
    store.setState({ session: 'auth', authBootstrapping: false, workspace: createSeedWorkspace() });

    await store.getState().selectOrg('org-1');

    expect(store.getState().workspace).toBeNull();
    expect(store.getState().workspaceLoading).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('keeps the prior token and cache when scope validation fails', async () => {
    seedRuntimeCredential('jwt-old');
    const draftKey = storeTenantADraft();
    const transition = { prepare: vi.fn(async () => undefined), commit: vi.fn(clearRegisteredDraftSessions) };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonOk(selected))
      .mockResolvedValueOnce(jsonOk({
        user: AUTH_USER, roles: ['admin'], organization: selected.organization,
        memberships: [],
        transport: 'web', session_scope: { ...SESSION_SCOPE, organization_id: 'org-other' },
      }));
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl, tenantTransition: transition },
    });
    const priorWorkspace = createSeedWorkspace();
    store.setState({ authBootstrapping: false, workspace: priorWorkspace });

    await store.getState().selectOrg('org-1');

    expect(transition.prepare).not.toHaveBeenCalled();
    expect(transition.commit).not.toHaveBeenCalled();
    expect(getCredential()?.accessToken).toBe('jwt-old');
    expect(store.getState().workspace).toBe(priorWorkspace);
    expect(store.getState().session).toBeNull();
    expect(store.getState().orgSelectionError).toBeTruthy();
    expect(globalThis.sessionStorage.getItem(draftKey)).toContain('tenant A draft');
  });

  it('preserves organization A and authoritatively removes a revoked B choice', async () => {
    const orgB = { ...ACTIVE_MEMBERSHIP.organization, id: 'org-b', slug: 'org-b', name: 'Taller B' };
    const membershipB = { ...ACTIVE_MEMBERSHIP, id: 'membership-b', organization_id: 'org-b', organization: orgB };
    seedRuntimeCredential('jwt-a');
    const transition = { prepare: vi.fn(async () => undefined), commit: vi.fn() };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonError(403, { error: 'hidden backend copy' }, 'MEMBERSHIP_NOT_SELECTABLE'))
      .mockResolvedValueOnce(jsonOk({
        user: AUTH_USER, roles: ['admin'], organization: ACTIVE_MEMBERSHIP.organization,
        memberships: [ACTIVE_MEMBERSHIP], transport: 'web', session_scope: SESSION_SCOPE,
      }));
    const store = createWorkspaceStore({
      deps: { baseUrl: 'http://test/api', fetchImpl, tenantTransition: transition },
    });
    const priorWorkspace = createSeedWorkspace();
    const scopeA = authScope('org-1');
    store.setState({
      session: 'auth', authBootstrapping: false, activeOrg: ACTIVE_MEMBERSHIP.organization,
      organizationChoices: [ACTIVE_MEMBERSHIP, membershipB], sessionScope: scopeA,
      workspace: priorWorkspace,
    });

    await store.getState().selectOrg('org-b');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('http://test/api/auth/select-org');
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
      method: 'POST', body: JSON.stringify({ organization_id: 'org-b' }),
    });
    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer jwt-a');
    expect(getCredential()?.accessToken).toBe('jwt-a');
    expect(store.getState()).toMatchObject({ activeOrg: ACTIVE_MEMBERSHIP.organization, sessionScope: scopeA, workspace: priorWorkspace });
    expect(store.getState().orgSelectionError).toContain('revocado');
    expect(store.getState().orgSelectionRecoveryAvailable).toBe(true);
    expect(transition.prepare).not.toHaveBeenCalled();

    await store.getState().refreshOrganizationChoices();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]![0])).toBe('http://test/api/auth/me');
    expect(new Headers(fetchImpl.mock.calls[1]![1]?.headers).get('Authorization')).toBe('Bearer jwt-a');
    expect(store.getState().organizationChoices).toEqual([ACTIVE_MEMBERSHIP]);
    expect(store.getState().activeOrg?.id).toBe('org-1');
    expect(store.getState().sessionScope?.organizationId).toBe('org-1');
    expect(store.getState().workspace).toBe(priorWorkspace);
    expect(getCredential()?.accessToken).toBe('jwt-a');
  });

  it('does not mislabel an unknown forbidden response as revoked', async () => {
    seedRuntimeCredential('jwt-a');
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonError(403, { error: 'membresía revocada' }, 'FORBIDDEN'))
      .mockRejectedValueOnce(new TypeError('offline'));
    const store = createWorkspaceStore({ deps: { baseUrl: 'http://test/api', fetchImpl } });
    store.setState({ session: 'auth', authBootstrapping: false, activeOrg: ACTIVE_MEMBERSHIP.organization, sessionScope: authScope('org-1') });

    await store.getState().selectOrg('org-b');

    expect(store.getState().orgSelectionError).not.toContain('revocado');
    expect(store.getState().orgSelectionRecoveryAvailable).toBe(false);
    expect(getCredential()?.accessToken).toBe('jwt-a');

    await store.getState().selectOrg('org-b');
    expect(store.getState().orgSelectionError).toContain('conectar');
    expect(store.getState().orgSelectionError).not.toContain('revocado');
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      'http://test/api/auth/select-org',
      'http://test/api/auth/select-org',
    ]);
  });
});
