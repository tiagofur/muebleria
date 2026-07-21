/**
 * workspaceStore — sesión + load workspace + RBAC + workshopSettings.
 *
 * Sub-slice 1 de 4 de la Fase 0 (Perfect App Roadmap §5.0.1). Migra de App.tsx
 * y SessionGate el estado de sesión/auth y la carga inicial del workspace.
 *
 * Invariante: catálogo, proyectos, handlers de mutación de catálogo/proyecto
 * NO viven acá (F062 catalogStore / F063 projectStore). ToastProvider NO se
 * toca en F057 (F064 uiStore).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import type { Workspace, WorkshopSettings } from '@muebles/domain';
import {
  APIWorkspaceRepository,
  LocalStorageWorkspaceRepository,
  type WorkspaceRepository,
} from '@muebles/storage';
import { resolveWorkshopSettings } from '@muebles/domain';

import {
  type AuthUser,
  type SessionMode,
  DEFAULT_API_BASE,
  clearSession,
  loginRequest,
  readAuthToken,
  readAuthUser,
  readSessionMode,
  registerRequest,
  storeAuthToken,
  storeAuthUser,
  writeSessionMode,
} from '../session';

/**
 * Assignable owner (RBAC) — solo se carga si `roleCanAssignOwner(actorRole)`.
 * Traído de `/assignable-owners` en auth mode.
 */
export interface AssignableOwner {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
}

export type AuthGate = 'login' | 'register';

/**
 * Dependencies injectable for testing. Defaults bind to browser globals so
 * production wiring stays one-liner.
 */
export interface WorkspaceStoreDeps {
  /** Base URL of the backend API. Default: `DEFAULT_API_BASE`. */
  readonly baseUrl?: string;
  /** Fetch implementation. Default: `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Factory that returns the repository for a given session mode. */
  readonly repositoryFactory?: RepositoryFactory;
}

export type RepositoryFactory = (
  mode: SessionMode,
  deps: { readonly baseUrl: string },
) => WorkspaceRepository;

const defaultRepositoryFactory: RepositoryFactory = (mode, { baseUrl }) =>
  mode === 'auth'
    ? new APIWorkspaceRepository(baseUrl)
    : new LocalStorageWorkspaceRepository();

export interface WorkspaceState {
  // --- Session ---
  readonly session: SessionMode | null;
  readonly authGate: AuthGate;
  readonly loginLoading: boolean;
  readonly loginError: string | null;
  readonly registerLoading: boolean;
  readonly registerError: string | null;

  // --- Workspace lifecycle ---
  /**
   * Full workspace once loaded. Catalog/projects mutations still live in
   * App.tsx until F062/F063; this store only owns load + settings + error.
   */
  readonly workspace: Workspace | null;
  readonly workspaceLoading: boolean;
  readonly workspaceLoadError: string | null;

  // --- RBAC ---
  readonly assignableOwners: readonly AssignableOwner[];

  // --- Actions: session ---
  readonly setAuthGate: (gate: AuthGate) => void;
  readonly clearAuthErrors: () => void;
  readonly enterAsGuest: () => void;
  readonly login: (email: string, password: string) => Promise<void>;
  readonly register: (
    name: string,
    email: string,
    password: string,
  ) => Promise<void>;
  readonly logout: () => void;

  // --- Actions: workspace lifecycle ---
  readonly loadWorkspace: () => Promise<void>;
  readonly setWorkspace: (ws: Workspace | null) => void;
  readonly setWorkspaceLoadError: (error: string | null) => void;
  readonly saveWorkshopSettings: (
    settings: WorkshopSettings,
  ) => Promise<void>;

  // --- Actions: RBAC ---
  readonly loadAssignableOwners: () => Promise<void>;

  // --- Media (need authToken) ---
  readonly resolveMediaUrl: (url: string | undefined) => string | undefined;
  readonly uploadCatalogImage: (file: File) => Promise<string>;

  // --- Selectors ---
  readonly getAuthToken: () => string | null;
  readonly getAuthUser: () => AuthUser | null;
  readonly getRepository: () => WorkspaceRepository;
}

interface InternalOptions {
  readonly deps: WorkspaceStoreDeps;
}

/**
 * Build the store creator. Tests pass `deps` to inject mocks; production
 * uses `createWorkspaceStore()` (defaults to browser globals).
 */
interface ResolvedDeps {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly repositoryFactory: (
    mode: SessionMode,
    deps: { readonly baseUrl: string },
  ) => WorkspaceRepository;
}

export function createWorkspaceStore(options?: InternalOptions) {
  const deps: ResolvedDeps = {
    baseUrl: options?.deps?.baseUrl ?? DEFAULT_API_BASE,
    fetchImpl: options?.deps?.fetchImpl ?? globalThis.fetch,
    repositoryFactory: options?.deps?.repositoryFactory ?? defaultRepositoryFactory,
  };

  return create<WorkspaceState>()(
    persist(
      (set, get) => ({
        // --- Session ---
        session: readSessionModeInitial(),
        authGate: 'login',
        loginLoading: false,
        loginError: null,
        registerLoading: false,
        registerError: null,

        // --- Workspace lifecycle ---
        workspace: null,
        workspaceLoading: false,
        workspaceLoadError: null,

        // --- RBAC ---
        assignableOwners: [],

        // --- Actions: session ---
        setAuthGate: (gate) => set({ authGate: gate }),

        clearAuthErrors: () =>
          set({ loginError: null, registerError: null }),

        enterAsGuest: () => {
          writeSessionMode('guest');
          set({
            session: 'guest',
            loginError: null,
            registerError: null,
            workspace: null,
            workspaceLoadError: null,
            assignableOwners: [],
          });
        },

        login: async (email, password) => {
          set({ loginLoading: true, loginError: null });
          try {
            const { token, user } = await loginRequest(email, password, {
              baseUrl: deps.baseUrl,
              fetchImpl: deps.fetchImpl,
            });
            storeAuthToken(token);
            storeAuthUser(user);
            writeSessionMode('auth');
            set({
              session: 'auth',
              loginLoading: false,
              loginError: null,
              // Reset workspace so AppContent reloads for the new session.
              workspace: null,
              workspaceLoadError: null,
              assignableOwners: [],
            });
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'No se pudo iniciar sesión';
            set({ loginLoading: false, loginError: message });
          }
        },

        register: async (name, email, password) => {
          set({ registerLoading: true, registerError: null });
          try {
            await registerRequest(name, email, password, {
              baseUrl: deps.baseUrl,
              fetchImpl: deps.fetchImpl,
            });
            set({ registerLoading: false, registerError: null });
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'No se pudo registrar';
            set({ registerLoading: false, registerError: message });
            throw err instanceof Error ? err : new Error(message);
          }
        },

        logout: () => {
          clearSession();
          set({
            session: null,
            authGate: 'login',
            loginError: null,
            registerError: null,
            loginLoading: false,
            registerLoading: false,
            workspace: null,
            workspaceLoadError: null,
            assignableOwners: [],
          });
        },

        // --- Actions: workspace lifecycle ---
        loadWorkspace: async () => {
          const { session, getRepository } = get();
          if (session === null) return;
          const repository = getRepository();
          set({ workspaceLoading: true, workspaceLoadError: null });
          try {
            const ws = await repository.load();
            set({ workspace: ws, workspaceLoading: false });
          } catch (err) {
            // Do not silently seed — surface failure (#13).
            console.error('Failed to load workspace:', err);
            const message =
              err instanceof Error
                ? err.message
                : 'No se pudo cargar el espacio de trabajo';
            set({ workspaceLoading: false, workspaceLoadError: message });
          }
        },

        setWorkspace: (ws) => set({ workspace: ws }),

        setWorkspaceLoadError: (error) => set({ workspaceLoadError: error }),

        saveWorkshopSettings: async (settings) => {
          const prev = get().workspace;
          if (!prev) return;
          const resolved = resolveWorkshopSettings(settings);
          const next: Workspace = { ...prev, settings: resolved };
          set({ workspace: next });
          const repository = get().getRepository();
          try {
            await repository.save(next);
          } catch (err) {
            console.error('Error al guardar ajustes:', err);
            // Revert on failure so UI doesn't lie about saved state.
            set({ workspace: prev });
            throw err;
          }
        },

        // --- Actions: RBAC ---
        loadAssignableOwners: async () => {
          const { session } = get();
          const token = get().getAuthToken();
          const authUser = get().getAuthUser();
          if (session !== 'auth' || !token) {
            set({ assignableOwners: [] });
            return;
          }
          try {
            const res = await deps.fetchImpl(
              `${deps.baseUrl}/assignable-owners`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              },
            );
            if (!res.ok) throw new Error(`owners ${res.status}`);
            const users = (await res.json()) as ReadonlyArray<{
              id: string;
              name: string;
              role?: string;
              active?: boolean;
            }>;
            const active = users.filter((u) => u.active !== false);
            set({
              assignableOwners: active.map((u) => ({
                id: u.id,
                name: u.name || u.id,
                role: u.role,
              })),
            });
          } catch (err) {
            console.error('Failed to load assignable owners:', err);
            // Fallback: at least show the current auth user if any.
            if (authUser) {
              set({
                assignableOwners: [
                  {
                    id: authUser.id,
                    name: authUser.name || authUser.email,
                    role: authUser.role,
                  },
                ],
              });
            }
          }
        },

        // --- Media ---
        resolveMediaUrl: (url) => {
          if (!url) return undefined;
          if (url.startsWith('http') || url.startsWith('blob:')) return url;
          const token = get().getAuthToken() ?? '';
          const abs = url.startsWith('/api/')
            ? `${deps.baseUrl.replace(/\/api\/?$/, '')}${url}`
            : url;
          return token
            ? `${abs}${abs.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
            : abs;
        },

        uploadCatalogImage: async (file) => {
          const token = get().getAuthToken();
          if (!token) throw new Error('no auth');
          const form = new FormData();
          form.append('file', file);
          const res = await deps.fetchImpl(`${deps.baseUrl}/media`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });
          if (!res.ok) {
            throw new Error(`upload ${res.status}`);
          }
          const data = (await res.json()) as { url?: string };
          if (!data.url) throw new Error('no url');
          return data.url;
        },

        // --- Selectors ---
        getAuthToken: () => (get().session === 'auth' ? readAuthToken() : null),
        getAuthUser: () => (get().session === 'auth' ? readAuthUser() : null),
        getRepository: () =>
          deps.repositoryFactory(get().session ?? 'guest', {
            baseUrl: deps.baseUrl,
          }),
      }),
      {
        // Only persist `session` — everything else is derived or loaded.
        name: 'muebles-workspace-store',
        storage: createJSONStorage(() => safeSessionStorage()),
        partialize: (state) => ({ session: state.session }),
        merge: (persisted, current) => {
          // Prefer reading session from `session.ts` helpers (they validate
          // token presence). Falls back to persisted if helpers return null
          // but we had a stored session (rare race).
          const fromHelpers = readSessionModeInitial();
          const persistedState = persisted as { session?: SessionMode } | undefined;
          return {
            ...current,
            session: fromHelpers ?? persistedState?.session ?? null,
          };
        },
      },
    ),
  );
}

/** Default singleton — production wiring. */
export const useWorkspaceStore = createWorkspaceStore();

/**
 * Read initial session mode from `session.ts` (validates token presence for
 * `auth`). Returns null when running without sessionStorage (SSR/tests).
 */
function readSessionModeInitial(): SessionMode | null {
  return readSessionMode();
}

function safeSessionStorage(): Storage {
  try {
    if (typeof globalThis !== 'undefined' && 'sessionStorage' in globalThis) {
      return globalThis.sessionStorage;
    }
  } catch {
    // ignore
  }
  // Zustand persist requires a Storage-like object; provide an inert fallback
  // so SSR/test environments without sessionStorage don't crash.
  return inertStorage;
}

const inertStorage: Storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
};
