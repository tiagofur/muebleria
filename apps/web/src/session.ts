import {
  GraneteApiClient, GraneteApiError, parseGenerated,
  type LoginResponse, type MeResponse, type User, type OrganizationSummary,
  type Membership, type SupportInfo as GeneratedSupportInfo,
} from '@granete/storage';

/**
 * Session gate helpers for the web shell login and invitation-first onboarding.
 * Auth token key matches APIWorkspaceRepository (`granete_token`).
 * Claves legacy `muebles_*`: las migra `migrateLegacyStorageKeys` (#366) al
 * arrancar la app (ver main.tsx).
 */

export const SESSION_STORAGE_KEY = 'granete_session';
export const TOKEN_STORAGE_KEY = 'granete_token';
export const USER_STORAGE_KEY = 'granete_user';

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

export type LoginSuccess = {
  readonly token: string;
  readonly user: AuthUser;
  readonly roles?: readonly string[];
  readonly organization?: OrgSummary;
  readonly memberships?: readonly MembershipChoice[];
  readonly selectionRequired?: boolean;
  readonly support?: boolean;
};

/**
 * Reads persisted session mode.
 * - guest → enter app without token
 * - auth → requires `granete_token`; missing token → logged out (null)
 * - missing / invalid → null (show login)
 */
export function readSessionMode(
  sessionStore: Storage | null | undefined = safeSessionStorage(),
  localStore: Storage | null | undefined = safeLocalStorage(),
): SessionMode | null {
  if (!sessionStore) return null;
  let raw: string | null;
  try {
    raw = sessionStore.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === 'guest') return 'guest';
  if (raw === 'auth') {
    if (!localStore) return null;
    try {
      const token = localStore.getItem(TOKEN_STORAGE_KEY);
      return token ? 'auth' : null;
    } catch {
      return null;
    }
  }
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

export function clearSession(
  sessionStore: Storage | null | undefined = safeSessionStorage(),
  localStore: Storage | null | undefined = safeLocalStorage(),
): void {
  try {
    sessionStore?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    localStore?.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    localStore?.removeItem(USER_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function storeAuthToken(
  token: string,
  localStore: Storage | null | undefined = safeLocalStorage(),
): void {
  if (!localStore) return;
  try {
    localStore.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

export function storeAuthUser(
  user: AuthUser,
  localStore: Storage | null | undefined = safeLocalStorage(),
): void {
  if (!localStore) return;
  try {
    localStore.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

export function readAuthUser(
  localStore: Storage | null | undefined = safeLocalStorage(),
): AuthUser | null {
  if (!localStore) return null;
  try {
    const raw = localStore.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.email !== 'string' ||
      (parsed.account_status !== 'active' && parsed.account_status !== 'disabled')
    ) {
      return null;
    }
    return {
      id: parsed.id,
      email: parsed.email,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      ...(typeof parsed.role === 'string' && parsed.role !== ''
        ? { role: parsed.role }
        : {}),
      account_status: parsed.account_status,
      ...(parsed.platform_admin === true ? { platform_admin: true } : {}),
      ...(Array.isArray(parsed.roles) ? { roles: parsed.roles } : {}),
    };
  } catch {
    return null;
  }
}

export function readAuthToken(
  localStore: Storage | null | undefined = safeLocalStorage(),
): string | null {
  if (!localStore) return null;
  try {
    return localStore.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin';
}

/**
 * POST {base}/auth/login with LoginRequest body.
 * On success returns JWT token + user (role included).
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
    return parseAuthResponse(await new GraneteApiClient(baseUrl, fetchImpl).login({ email, password, transport: 'web' }));
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
 */
export async function selectOrgRequest(
  token: string,
  organizationId: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<LoginSuccess> {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  return parseAuthResponse(await new GraneteApiClient(baseUrl, doFetch).selectOrganization(token, { organization_id: organizationId }));
}

/**
 * GET {base}/auth/me — session snapshot for the shell (org, roles, support
 * banner context).
 */
export async function meRequest(
  token: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<{
  user: AuthUser;
  roles?: readonly string[];
  organization?: OrgSummary;
  support?: SupportInfo;
}> {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response: MeResponse = await new GraneteApiClient(baseUrl, doFetch).getSession(token);
  return {
    user: toAuthUser(response.user, response.roles),
    roles: response.roles,
    ...(response.organization ? { organization: response.organization } : {}),
    ...(response.support ? { support: response.support } : {}),
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
  const memberships = d.memberships;
  return {
    token: d.token,
    user: toAuthUser(d.user, roles),
    ...(org ? { organization: org } : {}),
    ...(memberships && memberships.length > 0 ? { memberships } : {}),
    ...(d.selection_required ? { selectionRequired: true } : {}),
    ...(d.support === true ? { support: true } : {}),
  };
}

/**
 * DELETE {base}/platform/support-sessions/{id} — explicit support-session
 * logout (banner "Salir del soporte").
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
