import {
  GraneteApiClient, GraneteApiError, parseGenerated,
  type LoginResponse, type MeResponse, type User, type OrganizationSummary,
  type Membership, type SupportInfo as GeneratedSupportInfo,
} from '@granete/storage';
import {
  createSessionGeneration,
  sessionScopeFromSession,
  type SessionGeneration,
  type SessionScope,
} from './shared/query/sessionScope';

/**
 * Session helpers for the web shell login and invitation-first onboarding.
 *
 * #460 SEC-4B: el access token Web vive SÓLO en la memoria del proceso/tab
 * (webAuthRuntime) — este módulo ya no lee ni escribe `granete_token` en
 * localStorage. La sesión persistente viaja exclusivamente en la cookie
 * HttpOnly `granete_web_refresh`; el boot decide autenticado/anónimo con un
 * cookie bootstrap, nunca con un bearer persistido.
 *
 * `granete_session` (sessionStorage) queda como HINT no-secreto del modo
 * guest explícito de la pestaña; no es requisito para descubrir una cookie.
 */

export const SESSION_STORAGE_KEY = 'granete_session';

/** Claves legacy de bearer/metadata que el boot DESTRUYE (nunca migra). */
export const LEGACY_BEARER_STORAGE_KEYS: readonly string[] = [
  'granete_token',
  'muebles_token',
  'granete_user',
  'muebles_user',
];

/**
 * API base URL. Overridable per environment via Vite's `VITE_API_BASE` in
 * `.env.local` (e.g. `VITE_API_BASE=https://staging-api.test/api`). Falls back
 * to the local dev backend when unset.
 */
export const DEFAULT_API_BASE: string =
  import.meta.env.VITE_API_BASE ?? 'http://localhost:8080/api';

export type SessionMode = 'guest' | 'auth';

export type AuthUser = Pick<User, 'id' | 'email' | 'name' | 'account_status'> & {
  /**
   * Legacy single role — OPTIONAL since users.role was dropped (000090):
   * auth responses carry the membership roles as the `roles` sibling and
   * rolesOfUser falls back to this only for stale persisted sessions.
   */
  readonly role?: string;
  /** Active membership roles (multi-role union, ADR-0005). */
  readonly roles?: readonly string[];
  readonly platform_admin?: User['platform_admin'];
};

export type OrgSummary = OrganizationSummary;
export type MembershipChoice = Membership;
export type SupportInfo = GeneratedSupportInfo;

export type SessionSnapshot = {
  readonly user: AuthUser;
  readonly roles?: readonly string[];
  readonly organization?: OrgSummary;
  readonly organizationChoices: readonly MembershipChoice[];
  readonly support?: SupportInfo;
  readonly sessionScope: SessionScope;
};

export type LoginSuccess = {
  readonly token: string;
  readonly user: AuthUser;
  readonly roles?: readonly string[];
  readonly organization?: OrgSummary;
  readonly memberships?: readonly MembershipChoice[];
  readonly selectionRequired?: boolean;
  readonly support?: boolean;
  readonly sessionScope?: SessionScope;
  /** Server-clock expiry metadata (#460 SEC-4A/4B); ver webAuthClient. */
  readonly accessExpiresAt?: string;
  readonly absoluteSessionExpiresAt?: string;
  readonly sessionId?: string;
};

/**
 * Fetch adapter para los endpoints de auth que viajan con la cookie Web
 * (login, refresh, logout, invitaciones): `credentials: 'include'` es lo que
 * permite al browser guardar/transportar el Set-Cookie HttpOnly cross-origin
 * bajo el CORS credentialed exacto de SEC-4A.
 */
export function credentialedWebFetch(
  fetchImpl: typeof fetch = globalThis.fetch,
): typeof fetch {
  return (input, init) =>
    fetchImpl(input, { ...(init ?? {}), credentials: 'include' });
}

/**
 * Hint no-secreto del modo de la pestaña: 'guest' explícito sobrevive al
 * reload de ESTA pestaña (sessionStorage). Un hint 'auth' o ausente no
 * autoriza nada: el cookie bootstrap es quien decide.
 */
export function readSessionMode(
  sessionStore: Storage | null | undefined = safeSessionStorage(),
): SessionMode | null {
  if (!sessionStore) return null;
  let raw: string | null;
  try {
    raw = sessionStore.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === 'guest') return 'guest';
  if (raw === 'auth') return 'auth';
  return null;
}

export function writeSessionMode(
  mode: SessionMode,
  sessionStore: Storage | null | undefined = safeSessionStorage(),
): void {
  if (!sessionStore) return;
  try {
    sessionStore.setItem(SESSION_STORAGE_KEY, mode);
  } catch {
    // ignore quota / disabled storage
  }
}

/**
 * Limpia el hint de sesión y destruye cualquier bearer/metadata legacy que
 * hubiera quedado de la era pre-SEC-4B. Los datos guest legítimos NO se tocan.
 */
export function clearSession(
  sessionStore: Storage | null | undefined = safeSessionStorage(),
  localStore: Storage | null | undefined = safeLocalStorage(),
): void {
  try {
    sessionStore?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
  for (const key of LEGACY_BEARER_STORAGE_KEYS) {
    try {
      localStore?.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin';
}

/**
 * POST {base}/auth/login with LoginRequest body. Transport=web: la respuesta
 * trae el access en JSON (memoria) y el refresh sólo como Set-Cookie HttpOnly
 * (el browser lo guarda gracias al credentialed fetch).
 */
export async function loginRequest(
  email: string,
  password: string,
  options: {
    readonly baseUrl?: string;
    readonly fetchImpl?: typeof fetch;
  } = {},
): Promise<LoginSuccess> {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch no disponible');
  }

  try {
    const client = new GraneteApiClient(baseUrl, credentialedWebFetch(fetchImpl));
    return parseAuthResponse(await client.login({ email, password, transport: 'web' }));
  } catch (error) {
    if (error instanceof GraneteApiError && error.status === 401) throw new Error('Email o contraseña incorrectos');
    if (error instanceof GraneteApiError && error.status === 403) throw new Error(error.message);
    throw new Error('No se pudo conectar con el servidor');
  }
}

function safeSessionStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'sessionStorage' in globalThis) {
      return globalThis.sessionStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * POST {base}/auth/select-org — exchanges the org-less selection token for
 * one scoped to the chosen organization (multi-membership users, ADR-0005).
 * Misma sesión/familia: el backend actualiza el scope in-place y NO rota la
 * cookie (SEC-4A); por eso no necesita credentialed fetch.
 */
export async function selectOrgRequest(
  token: string,
  organizationId: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<LoginSuccess> {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const result = parseAuthResponse(await new GraneteApiClient(baseUrl, doFetch).selectOrganization(token, { organization_id: organizationId }));
  const session = await meRequest(result.token, { baseUrl, fetchImpl: doFetch });
  return validateOrganizationSessionTransition({
    requestedOrganizationId: organizationId,
    selectionResponse: result,
    sessionSnapshot: session,
  });
}

export function validateOrganizationSessionTransition({
  requestedOrganizationId,
  selectionResponse,
  sessionSnapshot,
}: {
  readonly requestedOrganizationId: string;
  readonly selectionResponse: LoginSuccess;
  readonly sessionSnapshot: SessionSnapshot;
}): LoginSuccess {
  const selectedOrganizationId = selectionResponse.organization?.id;
  const snapshotOrganizationId = sessionSnapshot.organization?.id;
  const scope = sessionSnapshot.sessionScope;
  if (
    requestedOrganizationId === '' ||
    selectedOrganizationId !== requestedOrganizationId ||
    !sessionSnapshot.organization ||
    snapshotOrganizationId !== requestedOrganizationId ||
    scope.organizationId !== requestedOrganizationId ||
    scope.membershipId === null ||
    scope.membershipCredentialVersion === null ||
    scope.organizationCredentialVersion === null ||
    scope.supportSessionId !== null ||
    scope.recoverySessionId !== null ||
    selectionResponse.user.id !== sessionSnapshot.user.id ||
    scope.userId !== sessionSnapshot.user.id ||
    scope.mode !== 'auth'
  ) {
    throw new Error('La sesión seleccionada no coincide con el taller solicitado');
  }

  return {
    ...selectionResponse,
    user: sessionSnapshot.user,
    roles: sessionSnapshot.roles,
    organization: sessionSnapshot.organization,
    memberships: sessionSnapshot.organizationChoices,
    sessionScope: scope,
  };
}

/**
 * GET {base}/auth/me — session snapshot for the shell (org, roles, support
 * banner context).
 */
export async function meRequest(
  token: string,
  options: {
    readonly baseUrl?: string;
    readonly fetchImpl?: typeof fetch;
    readonly sessionGeneration?: SessionGeneration;
  } = {},
): Promise<SessionSnapshot> {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response: MeResponse = await new GraneteApiClient(baseUrl, doFetch).getSession(token);
  return {
    user: toAuthUser(response.user, response.roles),
    roles: response.roles,
    organizationChoices: activeOrganizationChoices(response.memberships),
    ...(response.organization ? { organization: response.organization } : {}),
    ...(response.support ? { support: response.support } : {}),
    sessionScope: sessionScopeFromSession(
      response,
      options.sessionGeneration ?? createSessionGeneration(),
    ),
  };
}

function toAuthUser(user: User, roles?: readonly string[]): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    account_status: user.account_status,
    ...(user.platform_admin ? { platform_admin: true } : {}),
    ...(roles ? { roles } : {}),
  };
}

export function parseAuthResponse(data: unknown): LoginSuccess {
  let d: LoginResponse;
  try { d = parseGenerated<LoginResponse>('LoginResponse', data); }
  catch { throw new Error('Respuesta de autenticación inválida'); }
  if (!d.token) throw new Error('Respuesta de autenticación inválida');
  const roles = d.roles;
  const org = d.organization;
  const memberships = activeOrganizationChoices(d.memberships);
  return {
    token: d.token,
    user: toAuthUser(d.user, roles),
    ...(org ? { organization: org } : {}),
    ...(memberships.length > 0 ? { memberships } : {}),
    ...(d.selection_required ? { selectionRequired: true } : {}),
    ...(d.support === true ? { support: true } : {}),
    ...(d.access_expires_at ? { accessExpiresAt: d.access_expires_at } : {}),
    ...(d.absolute_session_expires_at
      ? { absoluteSessionExpiresAt: d.absolute_session_expires_at }
      : {}),
    ...(d.session_id ? { sessionId: d.session_id } : {}),
  };
}

function activeOrganizationChoices(
  memberships: readonly MembershipChoice[],
): readonly MembershipChoice[] {
  return memberships.filter(
    (membership) =>
      membership.status === 'active' && membership.organization.status === 'active',
  );
}

/**
 * DELETE {base}/platform/support-sessions/{id} — explicit support-session
 * logout (banner "Salir del soporte"). Viaja con el SUPPORT token de memoria,
 * jamás con la cookie Web (SEC-4B §41).
 */
export async function endSupportRequest(
  token: string,
  sessionId: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  try {
    await new GraneteApiClient(baseUrl, doFetch).endSupportSession(token, sessionId);
  } catch {
    throw new Error('No se pudo cerrar la sesión de soporte');
  }
}
