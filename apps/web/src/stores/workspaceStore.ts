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

import type { Workspace, WorkshopSettings } from '@granete/domain';
import {
  APIWorkspaceRepository,
  GraneteApiError,
  GraneteNetworkError,
  LocalStorageWorkspaceRepository,
  GUEST_WORKSPACE_STORAGE_KEY,
  createSeedWorkspace,
  type WorkspaceRepository,
} from '@granete/storage';
import { resolveWorkshopSettings } from '@granete/domain';
import {
  sessionScopeKey,
  type SessionScope,
} from '../shared/query/sessionScope';
import { tenantTransition } from '../shared/query/tenantTransition';
import { notifySessionChanged } from '../sessionSync';
import {
  invalidateAuthorizedMedia,
  resolveAuthorizedMediaUrl,
  subscribeToAuthorizedMedia,
} from './mediaAuthorization';

import {
  type AuthUser,
  type SessionMode,
  DEFAULT_API_BASE,
  clearSession,
  loginRequest,
  readAuthToken,
  readAuthUser,
  readSessionMode,
  storeAuthToken,
  storeAuthUser,
  writeSessionMode,
  selectOrgRequest,
  meRequest,
  endSupportRequest,
  parseAuthResponse,
  type MembershipChoice,
  type OrgSummary,
  type SupportInfo,
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
  readonly tenantTransition?: typeof tenantTransition;
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
  readonly loginLoading: boolean;
  readonly loginError: string | null;
  /**
   * Set when the session ended because the token expired (401) — the login
   * screen shows a notice instead of kicking the user out silently.
   */
  readonly sessionEndReason: 'expired' | null;

  // --- Workspace lifecycle ---
  /**
   * Full workspace once loaded. Catalog/projects mutations still live in
   * App.tsx until F062/F063; this store only owns load + settings + error.
   */
  readonly workspace: Workspace | null;
  readonly workspaceLoading: boolean;
  readonly workspaceLoadError: string | null;
  /**
   * Monotonic counter bumped on every WHOLESALE workspace replacement
   * (load / setWorkspace / session reset) — NOT on settings-only saves.
   * App sync effects key on this so saving settings can never re-inject a
   * stale catalog/projects snapshot into the feature stores (F118 S1).
   */
  readonly workspaceSeq: number;

  // --- Guest → auth import (F118 S3) ---
  /** True right after login when meaningful guest work exists locally. */
  readonly pendingGuestImport: boolean;
  readonly pendingOrgSelection: readonly MembershipChoice[] | null;
  readonly organizationChoices: readonly MembershipChoice[];
  readonly orgSelectionLoading: boolean;
  readonly orgSelectionError: string | null;
  readonly orgSelectionRecoveryAvailable: boolean;
  readonly activeOrg: OrgSummary | null;
  readonly sessionScope: SessionScope | null;
  readonly supportInfo: SupportInfo | null;
  readonly supportExiting: boolean;
  readonly authUserSeq: number;
  /**
   * Bumped when signed media grants resolve (#460 SEC-3) so trees consuming
   * resolveMediaUrl re-render with the freshly authorized URLs.
   */
  readonly mediaSeq: number;
  readonly guestImportLoading: boolean;
  readonly guestImportError: string | null;

  // --- RBAC ---
  readonly assignableOwners: readonly AssignableOwner[];

  // --- Actions: session ---
  readonly clearAuthErrors: () => void;
  readonly enterAsGuest: () => void;
  readonly login: (email: string, password: string) => Promise<void>;
  readonly loginWithAuthPayload: (payload: unknown) => void;
  readonly selectOrg: (organizationId: string) => Promise<void>;
  readonly refreshOrganizationChoices: () => Promise<void>;
  readonly hydrateSessionInfo: () => Promise<void>;
  readonly enterSupportSession: (token: string, orgId: string) => Promise<void>;
  readonly exitSupport: () => Promise<void>;
  readonly logout: () => void;
  /** Logout with an "expired" reason so LoginScreen can explain it. */
  readonly markSessionExpired: () => void;

  // --- Actions: workspace lifecycle ---
  readonly loadWorkspace: () => Promise<void>;
  readonly setWorkspace: (ws: Workspace | null) => void;
  readonly setWorkspaceLoadError: (error: string | null) => void;
  readonly saveWorkshopSettings: (
    settings: WorkshopSettings,
  ) => Promise<void>;
  /**
   * F118 S6: explicit demo recovery — clears the error state consistently and
   * persists the seed in guest mode (auth keeps it session-local so a demo
   * view can never overwrite real server data).
   */
  readonly loadDemoWorkspace: () => Promise<void>;

  // --- Guest → auth import (F118 S3) ---
  readonly dismissGuestImport: () => void;
  /** Pushes the local guest workspace (catalog + projects + templates) to the
   * authenticated account, then reloads. Errors surface via guestImportError. */
  readonly importGuestWorkspace: () => Promise<void>;

  // --- Actions: RBAC ---
  readonly loadAssignableOwners: () => Promise<void>;

  // --- Media (need authToken) ---
  readonly resolveMediaUrl: (url: string | undefined) => string | undefined;
  readonly uploadCatalogImage: (file: File) => Promise<string>;

  // --- Selectors ---
  readonly getAuthToken: () => string | null;
  readonly getAuthUser: () => AuthUser | null;
  readonly getAuthUserSeq: () => number;
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
  readonly tenantTransition: typeof tenantTransition;
}

export function createWorkspaceStore(options?: InternalOptions) {
  const injectedFetch = options?.deps?.fetchImpl;
  // Production resolves fetch at call time. The singleton store is created
  // while modules load, before main.tsx installs the global 401 interceptor;
  // capturing fetch here would bypass that safety net forever. Tests keep a
  // stable injected function so their dependency isolation remains explicit.
  const safeFetch: typeof fetch = (...args) =>
    (injectedFetch ?? globalThis.fetch)(...args);
  const deps: ResolvedDeps = {
    baseUrl: options?.deps?.baseUrl ?? DEFAULT_API_BASE,
    fetchImpl: safeFetch,
    repositoryFactory: options?.deps?.repositoryFactory ?? defaultRepositoryFactory,
    tenantTransition: options?.deps?.tenantTransition ?? tenantTransition,
  };

  const store = create<WorkspaceState>()(
    persist(
      (set, get) => ({
        // --- Session ---
        session: readSessionModeInitial(),
        loginLoading: false,
        loginError: null,
        sessionEndReason: null,
        pendingOrgSelection: null,
        organizationChoices: [],
        orgSelectionLoading: false,
        orgSelectionError: null,
        orgSelectionRecoveryAvailable: false,
        activeOrg: null,
        sessionScope: null,
        supportInfo: null,
        supportExiting: false,
        authUserSeq: 0,
        mediaSeq: 0,

        // --- Workspace lifecycle ---
        workspace: null,
        workspaceLoading: false,
        workspaceLoadError: null,
        workspaceSeq: 0,

        // --- Guest → auth import (F118 S3) ---
        pendingGuestImport: false,
        guestImportLoading: false,
        guestImportError: null,

        // --- RBAC ---
        assignableOwners: [],

        // --- Actions: session ---
        clearAuthErrors: () => set({ loginError: null }),

        enterAsGuest: () => {
          writeSessionMode('guest');
          set({
            session: 'guest',
            loginError: null,
            sessionEndReason: null,
            workspace: null,
            workspaceSeq: get().workspaceSeq + 1,
            workspaceLoadError: null,
            assignableOwners: [],
            pendingGuestImport: false,
          pendingOrgSelection: null,
          organizationChoices: [],
          orgSelectionLoading: false,
          orgSelectionError: null,
          orgSelectionRecoveryAvailable: false,
          activeOrg: null,
          sessionScope: null,
          supportInfo: null,
            guestImportLoading: false,
            guestImportError: null,
          });
        },

        login: async (email, password) => {
          set({ loginLoading: true, loginError: null });
          try {
            const result = await loginRequest(email, password, {
              baseUrl: deps.baseUrl,
              fetchImpl: deps.fetchImpl,
            });
            storeAuthToken(result.token);
            storeAuthUser(result.user);
            writeSessionMode('auth');
            if (result.selectionRequired && result.memberships && result.memberships.length > 0) {
              // Multi-taller: el token sin org sólo sirve para elegir taller.
              set({
                loginLoading: false,
                loginError: null,
                pendingOrgSelection: result.memberships,
                organizationChoices: result.memberships,
              });
              notifySessionChanged();
              return;
            }
            set({
              session: 'auth',
              loginLoading: false,
              loginError: null,
              sessionEndReason: null,
              pendingOrgSelection: null,
              organizationChoices: result.memberships ?? [],
              activeOrg: result.organization ?? null,
              sessionScope: null,
              // Reset workspace so AppContent reloads for the new session.
              workspace: null,
              workspaceSeq: get().workspaceSeq + 1,
              workspaceLoadError: null,
              assignableOwners: [],
            });
            // F118 S3: if the guest session produced real work, offer to
            // bring it into the account instead of discarding it silently.
            if (guestWorkspaceHasProjects()) {
              set({ pendingGuestImport: true });
            }
            notifySessionChanged();
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'No se pudo iniciar sesión';
            set({ loginLoading: false, loginError: message });
          }
        },

        loginWithAuthPayload: (payload: unknown) => {
          const result = parseAuthResponse(payload);
          storeAuthToken(result.token);
          storeAuthUser(result.user);
          writeSessionMode('auth');
          if (result.selectionRequired && result.memberships && result.memberships.length > 0) {
            set({
              pendingOrgSelection: result.memberships,
              organizationChoices: result.memberships,
            });
            notifySessionChanged();
            return;
          }
          set({
            session: 'auth',
            activeOrg: result.organization ?? null,
            sessionScope: null,
            pendingOrgSelection: null,
            organizationChoices: result.memberships ?? [],
            workspace: null,
            workspaceSeq: get().workspaceSeq + 1,
            workspaceLoadError: null,
            assignableOwners: [],
          });
          notifySessionChanged();
        },

        selectOrg: async (organizationId: string) => {
          const token = readAuthToken();
          if (!token) {
            set({ pendingOrgSelection: null, orgSelectionLoading: false });
            return;
          }
          set({ orgSelectionLoading: true, orgSelectionError: null, orgSelectionRecoveryAvailable: false });
          try {
            const result = await selectOrgRequest(token, organizationId, {
              baseUrl: deps.baseUrl,
              fetchImpl: deps.fetchImpl,
            });
            await deps.tenantTransition.prepare();
            storeAuthToken(result.token);
            storeAuthUser(result.user);
            deps.tenantTransition.commit();
            notifySessionChanged();
            set({
              session: 'auth',
              // authUserSeq re-keys the authUser/authToken memos in the
              // shell — without it an in-app org switch (F178 N6) kept
              // serving the PREVIOUS org's token to child screens.
              authUserSeq: get().authUserSeq + 1,
              orgSelectionLoading: false,
              orgSelectionError: null,
              orgSelectionRecoveryAvailable: false,
              pendingOrgSelection: null,
              organizationChoices: result.memberships ?? [],
              activeOrg: result.organization ?? null,
              sessionScope: result.sessionScope ?? null,
              supportInfo: null,
              sessionEndReason: null,
              workspace: null,
              workspaceSeq: get().workspaceSeq + 1,
              workspaceLoadError: null,
              assignableOwners: [],
            });
          } catch (err) {
            const membershipUnavailable =
              err instanceof GraneteApiError &&
              err.status === 403 &&
              err.code === 'MEMBERSHIP_NOT_SELECTABLE';
            set({
              orgSelectionLoading: false,
              orgSelectionRecoveryAvailable: membershipUnavailable,
              orgSelectionError: membershipUnavailable
                ? 'Tu acceso a este taller fue revocado o ya no está disponible. Actualizá tus talleres para continuar.'
                : err instanceof GraneteNetworkError
                  ? 'No se pudo conectar para cambiar de taller. Revisá tu conexión e intentá de nuevo.'
                  : 'No se pudo cambiar de taller. Verificá tus permisos e intentá de nuevo.',
            });
          }
        },

        refreshOrganizationChoices: async () => {
          const token = readAuthToken();
          if (!token) return;
          const requestedSession = { session: get().session, sessionScope: get().sessionScope };
          set({ orgSelectionLoading: true });
          try {
            const me = await meRequest(token, {
              baseUrl: deps.baseUrl,
              fetchImpl: deps.fetchImpl,
              ...(requestedSession.sessionScope
                ? { sessionGeneration: requestedSession.sessionScope.sessionGeneration }
                : {}),
            });
            if (readAuthToken() !== token || !isSameWorkspaceSession(requestedSession, get())) return;
            if (
              requestedSession.sessionScope &&
              (me.sessionScope.userId !== requestedSession.sessionScope.userId ||
                me.sessionScope.organizationId !== requestedSession.sessionScope.organizationId ||
                me.sessionScope.mode !== requestedSession.sessionScope.mode)
            ) {
              throw new Error('Authoritative session identity changed');
            }
            storeAuthUser(me.user);
            set({
              authUserSeq: get().authUserSeq + 1,
              activeOrg: me.organization ?? null,
              organizationChoices: me.organizationChoices,
              sessionScope: me.sessionScope,
              supportInfo: me.support ?? null,
              orgSelectionLoading: false,
              orgSelectionError: null,
              orgSelectionRecoveryAvailable: false,
            });
          } catch {
            if (readAuthToken() !== token || !isSameWorkspaceSession(requestedSession, get())) return;
            set({
              orgSelectionLoading: false,
              orgSelectionRecoveryAvailable: true,
              orgSelectionError: 'No pudimos actualizar tus talleres. Revisá tu conexión y volvé a intentar.',
            });
          }
        },

        enterSupportSession: async (token: string) => {
          await deps.tenantTransition.prepare();
          const sessionInfo = await meRequest(token, {
            baseUrl: deps.baseUrl,
            fetchImpl: deps.fetchImpl,
          });
          storeAuthToken(token);
          storeAuthUser(sessionInfo.user);
          deps.tenantTransition.commit();
          notifySessionChanged();
          writeSessionMode('auth');
          set({
            session: 'auth',
            authUserSeq: get().authUserSeq + 1,
            activeOrg: sessionInfo.organization ?? null,
            supportInfo: sessionInfo.support ?? null,
            organizationChoices: sessionInfo.organizationChoices,
            sessionScope: sessionInfo.sessionScope,
            workspace: null,
            workspaceSeq: get().workspaceSeq + 1,
            workspaceLoadError: null,
            assignableOwners: [],
          });
        },

        exitSupport: async () => {
          const token = readAuthToken();
          const support = get().supportInfo;
          if (!token || !support) {
            get().logout();
            return;
          }
          set({ supportExiting: true });
          try {
            await endSupportRequest(token, support.session_id, {
              baseUrl: deps.baseUrl,
              fetchImpl: deps.fetchImpl,
            });
          } catch {
            // El backend igual corta por expiración; continuar al logout.
          }
          set({ supportExiting: false });
          get().logout();
        },

        hydrateSessionInfo: async () => {
          const token = readAuthToken();
          if (!token) return;
          const requestedSession = {
            session: get().session,
            sessionScope: get().sessionScope,
          };
          try {
            const currentSessionGeneration = get().sessionScope?.sessionGeneration;
            const me = await meRequest(token, {
              baseUrl: deps.baseUrl,
              fetchImpl: deps.fetchImpl,
              ...(currentSessionGeneration
                ? { sessionGeneration: currentSessionGeneration }
                : {}),
            });
            if (
              readAuthToken() !== token ||
              !isSameWorkspaceSession(requestedSession, get())
            ) {
              return;
            }
            if (me.user) {
              // /auth/me devuelve los roles de la membresía como clave
              // hermana `roles` (el DTO de usuario no los trae). Merge en el
              // usuario persistido: guardar el DTO tal cual perdería la
              // unión multi-rol en cada reload (#325). Si la respuesta no
              // trae roles, se conservan los ya persistidos.
              const roles = Array.isArray(me.roles)
                ? me.roles.filter((r): r is string => typeof r === 'string' && r !== '')
                : [];
              const persisted = readAuthUser();
              const nextRoles =
                roles.length > 0 ? roles : (persisted?.roles ?? []);
              storeAuthUser(
                nextRoles.length > 0
                  ? { ...me.user, roles: nextRoles }
                  : me.user,
              );
              set({ authUserSeq: get().authUserSeq + 1 });
            }
            set({
              activeOrg: me.organization ?? null,
              supportInfo: me.support ?? null,
              sessionScope: me.sessionScope,
              organizationChoices: me.organizationChoices,
            });
          } catch {
            // best-effort: la sesión se valida igual en cada request
          }
        },

        logout: () => {
          clearSession();
          // #460 SEC-3: cached media grants die with the session.
          invalidateAuthorizedMedia();
          deps.tenantTransition.commit();
          notifySessionChanged();
          set({
            session: null,
            loginError: null,
            sessionEndReason: null,
            pendingOrgSelection: null,
            organizationChoices: [],
            orgSelectionError: null,
            orgSelectionRecoveryAvailable: false,
            activeOrg: null,
            sessionScope: null,
            supportInfo: null,
            loginLoading: false,
            workspace: null,
            workspaceSeq: get().workspaceSeq + 1,
            workspaceLoadError: null,
            assignableOwners: [],
            pendingGuestImport: false,
            guestImportLoading: false,
            guestImportError: null,
          });
        },

        markSessionExpired: () => {
          get().logout();
          set({ sessionEndReason: 'expired' });
        },

        // --- Actions: workspace lifecycle ---
        loadWorkspace: async () => {
          const { session, sessionScope, getRepository } = get();
          if (session === null) return;
          const requestedSession = { session, sessionScope };
          const repository = getRepository();
          set({ workspaceLoading: true, workspaceLoadError: null });
          try {
            const ws = await repository.load();
            // F118 S2: the session may have ended while loading — a late
            // resolve must not repopulate the workspace after logout.
            if (!isSameWorkspaceSession(requestedSession, get())) return;
            set({
              workspace: ws,
              workspaceLoading: false,
              workspaceSeq: get().workspaceSeq + 1,
            });
          } catch (err) {
            if (!isSameWorkspaceSession(requestedSession, get())) return;
            // Do not silently seed — surface failure (#13).
            console.error('Failed to load workspace:', err);
            const message =
              err instanceof Error
                ? err.message
                : 'No se pudo cargar el espacio de trabajo';
            if (/401|unauthorized/i.test(message) && get().session === 'auth') {
              get().markSessionExpired();
              return;
            }
            set({ workspaceLoading: false, workspaceLoadError: message });
          }
        },

        setWorkspace: (ws) =>
          set({ workspace: ws, workspaceSeq: get().workspaceSeq + 1 }),

        setWorkspaceLoadError: (error) => set({ workspaceLoadError: error }),

        saveWorkshopSettings: async (settings) => {
          const prev = get().workspace;
          if (!prev) return;
          const resolved = resolveWorkshopSettings(settings);
          // F118 S1: settings-only persistence. The previous version called
          // repository.save(next) with a workspace built from the load-time
          // snapshot — since F062/F063 the feature stores own mutations, so
          // that re-PUTed stale catalog/projects to the server and the sync
          // effects reverted every edit since load. workspaceSeq is NOT
          // bumped here, so stores keep their live data.
          set({ workspace: { ...prev, settings: resolved } });
          const repository = get().getRepository();
          try {
            await repository.saveWorkshopSettings(resolved);
          } catch (err) {
            console.error('Error al guardar ajustes:', err);
            // Revert on failure so UI doesn't lie about saved state.
            set({ workspace: prev });
            throw err;
          }
        },

        loadDemoWorkspace: async () => {
          const seed = createSeedWorkspace();
          // Guest: persist so the demo survives reloads. Auth: keep it
          // session-local — a demo must never overwrite real account data.
          if (get().session === 'guest') {
            try {
              await get().getRepository().save(seed);
            } catch (err) {
              console.error('Error al persistir datos demo:', err);
            }
          }
          set({
            workspace: seed,
            workspaceLoading: false,
            workspaceLoadError: null,
            workspaceSeq: get().workspaceSeq + 1,
          });
        },

        // --- Guest → auth import (F118 S3) ---
        dismissGuestImport: () =>
          set({ pendingGuestImport: false, guestImportError: null }),

        importGuestWorkspace: async () => {
          if (get().session !== 'auth') return;
          set({ guestImportLoading: true, guestImportError: null });
          try {
            const guestRepo = new LocalStorageWorkspaceRepository();
            const guestWs = await guestRepo.load();
            const repository = get().getRepository();
            await repository.saveCatalog(guestWs.catalog);
            for (const project of guestWs.projects) {
              await repository.saveProject(project);
            }
            for (const template of guestWs.projectTemplates ?? []) {
              await repository.saveProjectTemplate(template);
            }
            await get().loadWorkspace();
            set({
              pendingGuestImport: false,
              guestImportLoading: false,
            });
          } catch (err) {
            console.error('Error al importar workspace invitado:', err);
            const message =
              err instanceof Error
                ? err.message
                : 'No se pudo importar el trabajo invitado';
            set({ guestImportLoading: false, guestImportError: message });
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
            const fetchFn = deps.fetchImpl;
            const res = await fetchFn(
              `${deps.baseUrl}/assignable-owners`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              },
            );
            if (!res.ok) {
              if (res.status === 401 && get().session === 'auth') {
                get().markSessionExpired();
                return;
              }
              throw new Error(`owners ${res.status}`);
            }
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
            const msg = err instanceof Error ? err.message : String(err);
            if (/401|unauthorized/i.test(msg)) {
              get().markSessionExpired();
              return;
            }
            // Fall back to current authUser on fetch failure (#12).
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
        // #460 SEC-3: session JWTs never ride the query string. Canonical
        // /api/media paths resolve through short-lived signed grant URLs
        // (batched + token-scoped, see mediaAuthorization.ts); everything
        // else passes through untouched.
        resolveMediaUrl: (url) =>
          resolveAuthorizedMediaUrl(url, {
            baseUrl: deps.baseUrl,
            getAuthToken: () => get().getAuthToken(),
            fetchImpl: deps.fetchImpl,
          }),

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
        getAuthUserSeq: () => get().authUserSeq,
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

  // #460 SEC-3: signed media grants land asynchronously; the bump re-renders
  // every tree that consumes resolveMediaUrl so cached grant URLs appear.
  subscribeToAuthorizedMedia(() => {
    const { mediaSeq } = store.getState();
    store.setState({ mediaSeq: mediaSeq + 1 });
  });
  return store;
}

/** Default singleton — production wiring. */
export const useWorkspaceStore = createWorkspaceStore();

function isSameWorkspaceSession(
  requested: {
    readonly session: SessionMode | null;
    readonly sessionScope: SessionScope | null;
  },
  current: Pick<WorkspaceState, 'session' | 'sessionScope'>,
): boolean {
  if (requested.session !== current.session) return false;
  if (requested.sessionScope === null || current.sessionScope === null) {
    return requested.sessionScope === current.sessionScope;
  }
  const requestedKey = sessionScopeKey(requested.sessionScope);
  const currentKey = sessionScopeKey(current.sessionScope);
  return requestedKey.every((value, index) => value === currentKey[index]);
}

/**
 * F118 S3: cheap probe for meaningful guest work. Reads the raw guest
 * localStorage key (absent key = the guest never persisted anything — no
 * import offer) and checks for at least one project.
 */
function guestWorkspaceHasProjects(): boolean {
  try {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return false;
    }
    const raw = globalThis.localStorage.getItem(GUEST_WORKSPACE_STORAGE_KEY);
    if (!raw) return false;
    const ws = JSON.parse(raw) as { projects?: readonly unknown[] };
    return (ws.projects?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

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
