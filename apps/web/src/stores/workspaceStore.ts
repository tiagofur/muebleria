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
import { broadcastWebSessionEvent } from '../webSessionChannel';
import {
  applyLoginResponse,
  authenticatedApiFetch,
  configureWebAuthClient,
  coordinatedWebRefresh,
  scheduleWebAccessRefresh,
  webLogout,
  WebSessionEndedError,
  type WebSessionTransitionPlan,
} from '../webAuthClient';
import { withWebSessionMutation } from '../webSessionLock';
import {
  applySupportCredential,
  clearCredential,
  getCredential,
  getAccessToken,
} from '../webAuthRuntime';
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
  readSessionMode,
  writeSessionMode,
  selectOrgRequest,
  meRequest,
  endSupportRequest,
  parseAuthResponse,
  type LoginSuccess,
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
  deps: {
    readonly baseUrl: string;
    readonly getAccessToken: () => string | null;
    readonly fetchImpl: typeof fetch;
  },
) => WorkspaceRepository;

const defaultRepositoryFactory: RepositoryFactory = (mode, { baseUrl, getAccessToken, fetchImpl }) =>
  mode === 'auth'
    ? new APIWorkspaceRepository(baseUrl, {
        // SEC-4B: el access token vive en memoria (webAuthRuntime) y todo
        // request pasa por el boundary con refresh-once/retry-once.
        getAccessToken,
        fetchImpl: (input, init) => authenticatedApiFetch(String(input), init ?? {}),
      })
    : new LocalStorageWorkspaceRepository();

export interface WorkspaceState {
  // --- Session ---
  readonly session: SessionMode | null;
  /**
   * #460 SEC-4B: true mientras el boot decide entre cookie-session y login.
   * Evita el flash login→shell: SessionGate muestra el estado de arranque.
   */
  readonly authBootstrapping: boolean;
  /** Boot falló por red/5xx o CSRF: el login screen lo explica. */
  readonly sessionBootError: 'unavailable' | 'config' | null;
  readonly loginLoading: boolean;
  readonly loginError: string | null;
  /**
   * Set when the session ended because the token expired/revoked (401) — the
   * login screen shows a notice instead of kicking the user out silently.
   */
  readonly sessionEndReason: 'expired' | 'revoked' | 'security' | 'connection' | null;
  /**
   * El logout server-side falló (5xx preserva cookie): no se claim "logout
   * completado", se ofrece reintentar y se bloquea el auto-bootstrap para no
   * ignorar la intención de cierre del usuario.
   */
  readonly logoutServerPending: boolean;
  /** Usuario autenticado en memoria (nunca persistido, SEC-4B §6). */
  readonly authUser: AuthUser | null;

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
  /** Boot: guest hint o cookie bootstrap — decide el estado inicial (SEC-4B). */
  readonly beginAuthBootstrap: () => Promise<void>;
  readonly login: (email: string, password: string) => Promise<void>;
  readonly loginWithAuthPayload: (payload: unknown) => void;
  readonly selectOrg: (organizationId: string) => Promise<void>;
  readonly refreshOrganizationChoices: () => Promise<void>;
  readonly hydrateSessionInfo: () => Promise<void>;
  readonly enterSupportSession: (token: string, orgId: string) => Promise<void>;
  readonly exitSupport: () => Promise<void>;
  readonly logout: () => void;
  /** Logout with an end reason so LoginScreen can explain it. */
  readonly markSessionEnded: (reason: NonNullable<WorkspaceState['sessionEndReason']>) => void;

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
  readonly repositoryFactory: RepositoryFactory;
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
  const baseUrl = options?.deps?.baseUrl ?? DEFAULT_API_BASE;
  // SEC-4B: el boundary de fetch autenticado comparte exactamente el fetch y
  // la base del store (tests incluidos).
  configureWebAuthClient({ baseUrl, fetchImpl: safeFetch });
  const deps: ResolvedDeps = {
    baseUrl,
    fetchImpl: safeFetch,
    repositoryFactory: options?.deps?.repositoryFactory ?? defaultRepositoryFactory,
    tenantTransition: options?.deps?.tenantTransition ?? tenantTransition,
  };

  const store = create<WorkspaceState>()(
    (set, get) => ({
        // --- Session ---
        session: null,
        authBootstrapping: true,
        sessionBootError: null,
        loginLoading: false,
        loginError: null,
        sessionEndReason: null,
        logoutServerPending: false,
        authUser: null,
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
            authBootstrapping: false,
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
            authUser: null,
            guestImportLoading: false,
            guestImportError: null,
          });
        },

        /**
         * Boot SEC-4B: el navegador no puede leer la cookie HttpOnly, así que
         * el estado inicial autenticado se descubre con un cookie bootstrap
         * (POST /auth/refresh bodyless bajo el lock cross-tab). El hint
         * `granete_session` sólo sirve para respetar un guest explícito de
         * esta pestaña — jamás es requisito para descubrir la cookie.
         */
        beginAuthBootstrap: async () => {
          // Ya decidido (boot completado / sesión activa): no re-rotar. El
          // re-bootstrap (p.ej. exitSupport) re-arma authBootstrapping antes
          // de llamar.
          if (!get().authBootstrapping || get().session !== null) return;
          if (readSessionMode() === 'guest') {
            set({ session: 'guest', authBootstrapping: false });
            return;
          }
          if (get().logoutServerPending) {
            // El usuario pidió cerrar sesión y el server aún no la revocó: no
            // resurrect via bootstrap ignorando su intención.
            set({ authBootstrapping: false, session: null });
            return;
          }
          const outcome = await coordinatedWebRefresh();
          if (get().logoutServerPending) return; // logout llegó durante el boot
          const bootOutcome =
            outcome.status === 'refreshed' || outcome.status === 'transitioned'
              ? { credential: outcome.credential, response: outcome.response }
              : null;
          if (bootOutcome !== null && bootOutcome.credential !== null) {
            scheduleWebAccessRefresh();
            if (
              bootOutcome.response.selection_required &&
              (bootOutcome.response.memberships?.length ?? 0) > 0
            ) {
              // Cookie-session viva pero org-less: sólo elegir taller.
              set({
                authBootstrapping: false,
                sessionBootError: null,
                pendingOrgSelection: bootOutcome.response.memberships,
                organizationChoices: bootOutcome.response.memberships,
              });
              return;
            }
            try {
              const snapshot = await meRequest(bootOutcome.credential.accessToken, {
                baseUrl: deps.baseUrl,
                fetchImpl: deps.fetchImpl,
              });
              applySessionSnapshot(snapshot, set, get);
              set({ session: 'auth', authBootstrapping: false, sessionBootError: null });
            } catch {
              // /me falló pero el access es válido: la sesión se revalida en
              // cada request; arrancar autenticado sin el snapshot inicial.
              set({ session: 'auth', authBootstrapping: false, sessionBootError: null });
            }
            return;
          }
          if (outcome.status === 'terminal') {
            // Cookie muerta/inexistente: login explícito. Destruir el hint
            // 'auth' vencido para no repetir el intento en cada boot.
            if (readSessionMode() === 'auth') {
              try {
                globalThis.sessionStorage?.removeItem('granete_session');
              } catch {
                // ignore
              }
            }
            clearCredential();
            if (outcome.code === 'CSRF_DENIED') {
              // 403 del boundary CSRF: fail closed con error claro, sin loop.
              set({ session: null, authBootstrapping: false, sessionBootError: 'config' });
              return;
            }
            set({
              session: null,
              authBootstrapping: false,
              sessionBootError: null,
              sessionEndReason: outcome.code === 'REFRESH_REVOKED' ? 'revoked'
                : outcome.code === 'REFRESH_REUSED' ? 'security'
                : 'expired',
            });
            return;
          }
          // network (5xx/fallo de red): la cookie sigue viva server-side; no
          // es un logout. Login screen con aviso de conexión, sin loop.
          set({
            session: null,
            authBootstrapping: false,
            sessionBootError: 'unavailable',
          });
        },

        login: async (email, password) => {
          set({ loginLoading: true, loginError: null });
          try {
            const result = await loginRequest(email, password, {
              baseUrl: deps.baseUrl,
              fetchImpl: deps.fetchImpl,
            });
            finishLogin(result, set, get, deps);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'No se pudo iniciar sesión';
            set({ loginLoading: false, loginError: message });
          }
        },

        loginWithAuthPayload: (payload: unknown) => {
          const result = parseAuthResponse(payload);
          finishLogin(result, set, get, deps);
        },

        selectOrg: async (organizationId: string) => {
          const credential = getCredential();
          const token = credential?.accessToken ?? null;
          if (!token) {
            set({ pendingOrgSelection: null, orgSelectionLoading: false });
            return;
          }
          set({ orgSelectionLoading: true, orgSelectionError: null, orgSelectionRecoveryAvailable: false });
          try {
            // §32: select-org muta la cookie-session compartida (scope
            // in-place) — el exchange server corre bajo el MISMO lock
            // cross-tab que refresh/logout.
            const result = await withWebSessionMutation(() =>
              selectOrgRequest(token, organizationId, {
                baseUrl: deps.baseUrl,
                fetchImpl: deps.fetchImpl,
              }),
            );
            // select-org NO crea sesión/familia nueva: mismo sid con scope
            // actualizado. Un sid distinto es un contrato roto — no aplicar.
            const currentSid = getCredential()?.sessionId;
            if (result.sessionId && currentSid && result.sessionId !== currentSid) {
              throw new Error('La sesión seleccionada no coincide con la sesión activa');
            }
            await deps.tenantTransition.prepare();
            applyLoginResponse({
              token: result.token,
              user: { ...result.user, id: result.user.id },
              access_expires_at: result.accessExpiresAt ?? '',
              absolute_session_expires_at: result.absoluteSessionExpiresAt ?? '',
              session_id: result.sessionId ?? currentSid ?? '',
              organization: result.organization,
              selection_required: false,
            } as Parameters<typeof applyLoginResponse>[0]);
            scheduleWebAccessRefresh();
            deps.tenantTransition.commit();
            broadcastWebSessionEvent({ type: 'scope-changed' });
            set({
              session: 'auth',
              // authUserSeq re-keys the authUser/authToken memos in the
              // shell — without it an in-app org switch (F178 N6) kept
              // serving the PREVIOUS org's token to child screens.
              authUserSeq: get().authUserSeq + 1,
              authUser: result.user,
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
          const credential = getCredential();
          if (!credential) return;
          const token = credential.accessToken;
          const requestedSession = { session: get().session, sessionScope: get().sessionScope };
          const requestedGeneration = credential.generation;
          set({ orgSelectionLoading: true });
          try {
            const me = await meRequest(token, {
              baseUrl: deps.baseUrl,
              fetchImpl: deps.fetchImpl,
              ...(requestedSession.sessionScope
                ? { sessionGeneration: requestedSession.sessionScope.sessionGeneration }
                : {}),
            });
            if (getCredential()?.generation !== requestedGeneration || !isSameWorkspaceSession(requestedSession, get())) return;
            if (
              requestedSession.sessionScope &&
              (me.sessionScope.userId !== requestedSession.sessionScope.userId ||
                me.sessionScope.organizationId !== requestedSession.sessionScope.organizationId ||
                me.sessionScope.mode !== requestedSession.sessionScope.mode)
            ) {
              throw new Error('Authoritative session identity changed');
            }
            set({
              authUser: me.user,
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
            if (getCredential()?.generation !== requestedGeneration || !isSameWorkspaceSession(requestedSession, get())) return;
            set({
              orgSelectionLoading: false,
              orgSelectionRecoveryAvailable: true,
              orgSelectionError: 'No pudimos actualizar tus talleres. Revisá tu conexión y volvé a intentar.',
            });
          }
        },

        /**
         * Support (#460 SEC-4B §39–40): el token de soporte vive SOLO en
         * memoria de esta pestaña, es tab-local (sin broadcast) y NO toca la
         * cookie — la underlying cookie sigue representando la sesión
         * platform original.
         */
        enterSupportSession: async (token: string) => {
          await deps.tenantTransition.prepare();
          const sessionInfo = await meRequest(token, {
            baseUrl: deps.baseUrl,
            fetchImpl: deps.fetchImpl,
          });
          if (!sessionInfo.support || !sessionInfo.organization) {
            throw new Error('La sesión de soporte no está activa');
          }
          applySupportCredential({
            accessToken: token,
            accessExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
            sessionId: sessionInfo.support.session_id,
            organizationId: sessionInfo.organization.id,
          });
          deps.tenantTransition.commit();
          writeSessionMode('auth');
          set({
            session: 'auth',
            authBootstrapping: false,
            authUserSeq: get().authUserSeq + 1,
            authUser: sessionInfo.user,
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

        /**
         * Salir de soporte NO es un Web logout (§41): termina la sesión de
         * soporte con el token de soporte, purga, y recupera la sesión
         * platform original mediante cookie bootstrap. Sin cookie viva →
         * login screen.
         */
        exitSupport: async () => {
          const credential = getCredential();
          const support = get().supportInfo;
          const supportToken =
            credential !== null && credential.kind === 'support' ? credential.accessToken : null;
          if (!supportToken || !support) {
            get().logout();
            return;
          }
          set({ supportExiting: true });
          try {
            await endSupportRequest(supportToken, support.session_id, {
              baseUrl: deps.baseUrl,
              fetchImpl: deps.fetchImpl,
            });
          } catch {
            // El backend igual corta por expiración; continuar.
          }
          // Purge support credential + tenant data; recover platform session.
          clearCredential();
          invalidateAuthorizedMedia();
          deps.tenantTransition.commit();
          set({
            supportExiting: false,
            supportInfo: null,
            session: null,
            authUser: null,
            activeOrg: null,
            sessionScope: null,
            organizationChoices: [],
            workspace: null,
            workspaceSeq: get().workspaceSeq + 1,
            workspaceLoadError: null,
            assignableOwners: [],
            authBootstrapping: true,
          });
          await get().beginAuthBootstrap();
        },

        hydrateSessionInfo: async () => {
          const credential = getCredential();
          if (!credential) return;
          const token = credential.accessToken;
          const requestedGeneration = credential.generation;
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
              getCredential()?.generation !== requestedGeneration ||
              !isSameWorkspaceSession(requestedSession, get())
            ) {
              return;
            }
            if (me.user) {
              // /auth/me devuelve los roles de la membresía como clave
              // hermana `roles` (el DTO de usuario no los trae). Si la
              // respuesta no trae roles, se conservan los ya presentes (#325).
              const roles = Array.isArray(me.roles)
                ? me.roles.filter((r): r is string => typeof r === 'string' && r !== '')
                : [];
              const current = get().authUser;
              const nextRoles =
                roles.length > 0 ? roles : (current?.roles ?? []);
              set({
                authUser: nextRoles.length > 0 ? { ...me.user, roles: nextRoles } : me.user,
                authUserSeq: get().authUserSeq + 1,
              });
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

        /**
         * Logout SEC-4B: POST /auth/logout con cookie+CSRF bajo el lock
         * cross-tab. Sólo tras la revocación server-side se purga y se
         * difunde `session-ended`; un 5xx (cookie preservada) deja
         * `logoutServerPending` — nunca se claim "logout completado", se
         * ofrece reintentar y se bloquea el auto-bootstrap.
         */
        logout: () => {
          // Guest/anónimo no tiene cookie-session que revocar: purge local
          // directo, sin red (y sin logoutServerPending espurio).
          if (get().session !== 'auth') {
            clearSession();
            invalidateAuthorizedMedia();
            deps.tenantTransition.commit();
            set({
              session: null,
              loginError: null,
              sessionEndReason: null,
              logoutServerPending: false,
              pendingOrgSelection: null,
              organizationChoices: [],
              orgSelectionError: null,
              orgSelectionRecoveryAvailable: false,
              activeOrg: null,
              sessionScope: null,
              supportInfo: null,
              authUser: null,
              loginLoading: false,
              workspace: null,
              workspaceSeq: get().workspaceSeq + 1,
              workspaceLoadError: null,
              assignableOwners: [],
              pendingGuestImport: false,
              guestImportLoading: false,
              guestImportError: null,
              authBootstrapping: false,
            });
            return;
          }
          void (async () => {
            const outcome = await webLogout();
            // El estado local se purga SIEMPRE: la intención del usuario es
            // salir y el business data no debe quedar tras el login screen
            // aunque el server siga vivo. El bearer de memoria muere aquí
            // también (pending-retry NO conserva credential local).
            clearCredential();
            clearSession();
            invalidateAuthorizedMedia();
            deps.tenantTransition.commit();
            if (outcome.status === 'revoked') {
              broadcastWebSessionEvent({ type: 'session-ended' });
            }
            set({
              session: null,
              loginError: null,
              sessionEndReason: null,
              logoutServerPending: outcome.status === 'pending-retry',
              pendingOrgSelection: null,
              organizationChoices: [],
              orgSelectionError: null,
              orgSelectionRecoveryAvailable: false,
              activeOrg: null,
              sessionScope: null,
              supportInfo: null,
              authUser: null,
              loginLoading: false,
              workspace: null,
              workspaceSeq: get().workspaceSeq + 1,
              workspaceLoadError: null,
              assignableOwners: [],
              pendingGuestImport: false,
              guestImportLoading: false,
              guestImportError: null,
              authBootstrapping: false,
            });
          })();
        },

        markSessionEnded: (reason) => {
          // Sesión muerta server-side (401 terminal): purge local sin llamar
          // al server — la cookie ya no sirve y el access murió.
          clearCredential();
          clearSession();
          invalidateAuthorizedMedia();
          deps.tenantTransition.commit();
          set({
            session: null,
            sessionEndReason: reason,
            pendingOrgSelection: null,
            organizationChoices: [],
            orgSelectionError: null,
            orgSelectionRecoveryAvailable: false,
            activeOrg: null,
            sessionScope: null,
            supportInfo: null,
            authUser: null,
            loginLoading: false,
            workspace: null,
            workspaceSeq: get().workspaceSeq + 1,
            workspaceLoadError: null,
            assignableOwners: [],
            pendingGuestImport: false,
            guestImportLoading: false,
            guestImportError: null,
            authBootstrapping: false,
          });
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
            if (
              get().session === 'auth' &&
              (err instanceof WebSessionEndedError || /401|unauthorized/i.test(message))
            ) {
              get().markSessionEnded(
                err instanceof WebSessionEndedError && err.terminalCode === 'REFRESH_REVOKED'
                  ? 'revoked'
                  : err instanceof WebSessionEndedError && err.terminalCode === 'REFRESH_REUSED'
                    ? 'security'
                    : 'expired',
              );
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
                get().markSessionEnded('expired');
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
              get().markSessionEnded('expired');
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
        // SEC-4B: el bearer sale de la MEMORIA del runtime — nunca storage.
        getAuthToken: () => (get().session === 'auth' ? getAccessToken() : null),
        getAuthUser: () => (get().session === 'auth' ? get().authUser : null),
        getAuthUserSeq: () => get().authUserSeq,
        getRepository: () =>
          deps.repositoryFactory(get().session ?? 'guest', {
            baseUrl: deps.baseUrl,
            getAccessToken: () => get().getAuthToken(),
            fetchImpl: deps.fetchImpl,
          }),
      }),
  );

  // #460 SEC-4B (review Blocker 2): transition owner del app. Un refresh que
  // descubre OTRA sesión/scope purga S1 (credential + grants + business
  // state) y SÓLO ENTONCES instala S2 y pide el snapshot autoritativo. El
  // ordering NO depende del BroadcastChannel (best-effort para OTRAS tabs).
  configureWebAuthClient({
    baseUrl,
    fetchImpl: safeFetch,
    runSessionTransition: runWebSessionTransition,
  });

  async function runWebSessionTransition(plan: WebSessionTransitionPlan): Promise<void> {
    await deps.tenantTransition.prepare();
    // 1) S1 muere primero: credential, media grants y TODO el tenant state.
    clearCredential();
    invalidateAuthorizedMedia();
    store.setState({
      workspace: null,
      workspaceSeq: store.getState().workspaceSeq + 1,
      workspaceLoadError: null,
      sessionScope: null,
      activeOrg: null,
      organizationChoices: [],
      supportInfo: null,
      assignableOwners: [],
      authUser: null,
      authUserSeq: store.getState().authUserSeq + 1,
      pendingOrgSelection: null,
      pendingGuestImport: false,
    });
    deps.tenantTransition.commit();
    // 2) Sólo ahora S2 queda activo y usable para business requests.
    plan.applyCredential();
    scheduleWebAccessRefresh();
    // 3) Snapshot autoritativo de S2 (/auth/me) antes de considerarlo usable
    //    por la UI. Si falla, la sesión se revalida en cada request.
    const token = getAccessToken();
    if (token === null) return; // el runner decidió terminar en login
    try {
      const snapshot = await meRequest(token, {
        baseUrl: deps.baseUrl,
        fetchImpl: deps.fetchImpl,
      });
      applySessionSnapshot(snapshot, (partial) => store.setState(partial), store.getState);
    } catch {
      // best-effort
    }
  }

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

type SessionSet = (partial: Partial<WorkspaceState>) => void;
type SessionGet = () => WorkspaceState;

/** Aplica el snapshot autoritativo de /auth/me al estado del shell. */
function applySessionSnapshot(
  snapshot: import('../session').SessionSnapshot,
  set: SessionSet,
  get: SessionGet,
): void {
  set({
    authUser: snapshot.user,
    authUserSeq: get().authUserSeq + 1,
    organizationChoices: snapshot.organizationChoices,
    activeOrg: snapshot.organization ?? null,
    sessionScope: snapshot.sessionScope,
    supportInfo: snapshot.support ?? null,
  });
}

/**
 * Login/invitación post-éxito (SEC-4B): access → memoria del runtime (con la
 * metadata de expiridad server-clock), refresh scheduling, snapshot
 * autoritativo y broadcast NO-secreto `session-replaced` para que las demás
 * pestañas purguen y re-bootstrapeen la cookie — jamás copiar el token.
 */
function finishLogin(
  result: LoginSuccess,
  set: SessionSet,
  get: SessionGet,
  deps: { readonly baseUrl: string; readonly fetchImpl: typeof fetch },
): void {
  if (!result.accessExpiresAt || !result.absoluteSessionExpiresAt || !result.sessionId) {
    set({
      loginLoading: false,
      loginError: 'Respuesta de autenticación sin metadata de sesión completa',
    });
    return;
  }
  applyLoginResponse({
    token: result.token,
    user: { ...result.user },
    access_expires_at: result.accessExpiresAt,
    absolute_session_expires_at: result.absoluteSessionExpiresAt,
    session_id: result.sessionId,
    organization: result.organization,
    selection_required: false,
  } as Parameters<typeof applyLoginResponse>[0]);
  scheduleWebAccessRefresh();
  writeSessionMode('auth');
  if (result.selectionRequired && result.memberships && result.memberships.length > 0) {
    // Multi-taller: el token sin org sólo sirve para elegir taller.
    set({
      loginLoading: false,
      loginError: null,
      authBootstrapping: false,
      authUser: result.user,
      authUserSeq: get().authUserSeq + 1,
      pendingOrgSelection: result.memberships,
      organizationChoices: result.memberships,
    });
    broadcastWebSessionEvent({ type: 'session-replaced' });
    return;
  }
  set({
    session: 'auth',
    loginLoading: false,
    loginError: null,
    sessionEndReason: null,
    logoutServerPending: false,
    sessionBootError: null,
    authBootstrapping: false,
    authUser: result.user,
    authUserSeq: get().authUserSeq + 1,
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
  // F118 S3: if the guest session produced real work, offer to bring it into
  // the account instead of discarding it silently.
  if (guestWorkspaceHasProjects()) {
    set({ pendingGuestImport: true });
  }
  broadcastWebSessionEvent({ type: 'session-replaced' });
}

/** El usuario autenticado vive en memoria del store; nada se persiste (§6). */
