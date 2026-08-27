/**
 * Session gate helpers for the web shell login / register screens.
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

export type AuthUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /**
   * Legacy single role — OPTIONAL since users.role was dropped (000090):
   * auth responses carry the membership roles as the `roles` sibling and
   * rolesOfUser falls back to this only for stale persisted sessions.
   */
  readonly role?: string;
  readonly active: boolean;
  /** Active membership roles (multi-role union, ADR-0005). */
  readonly roles?: readonly string[];
  readonly platform_admin?: boolean;
};

export type OrgSummary = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** Organization type (factory/store/dealer) — drives org-type role gates. */
  readonly type?: string;
  readonly license?: {
    readonly plan?: string;
    readonly expires_at?: string | null;
    readonly status?: string;
  };
};

export type MembershipChoice = {
  readonly organization_id: string;
  readonly roles: readonly string[];
  readonly organization: OrgSummary;
};

export type SupportInfo = {
  readonly organization_id: string;
  readonly session_id: string;
  readonly reason: string;
};

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
    if (typeof parsed.id !== 'string' || typeof parsed.email !== 'string') {
      return null;
    }
    return {
      id: parsed.id,
      email: parsed.email,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      ...(typeof parsed.role === 'string' && parsed.role !== ''
        ? { role: parsed.role }
        : {}),
      active: parsed.active !== false,
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

async function readErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
    if (typeof body.message === 'string' && body.message.trim()) {
      return body.message;
    }
  } catch {
    // ignore non-JSON
  }
  return fallback;
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

  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor');
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Email o contraseña incorrectos');
    }
    if (res.status === 403) {
      throw new Error(
        await readErrorMessage(
          res,
          'Tu cuenta está pendiente de aprobación por el administrador',
        ),
      );
    }
    throw new Error(
      await readErrorMessage(res, `Error de inicio de sesión (${res.status})`),
    );
  }

  return parseAuthResponse(await res.json());
}

/**
 * POST {base}/auth/register — creates pending user (active=false, role=user).
 */
export async function registerRequest(
  name: string,
  email: string,
  password: string,
  options: {
    readonly baseUrl?: string;
    readonly fetchImpl?: typeof fetch;
  } = {},
): Promise<void> {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch no disponible');
  }

  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor');
  }

  if (res.ok) return;

  if (res.status === 409) {
    throw new Error('Ese email ya está registrado');
  }
  throw new Error(
    await readErrorMessage(res, `Error al registrar (${res.status})`),
  );
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
  const res = await doFetch(`${baseUrl}/auth/select-org`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ organization_id: organizationId }),
  });
  if (!res.ok) {
    throw new Error('No se pudo entrar al taller seleccionado');
  }
  return parseAuthResponse(await res.json());
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
  const res = await doFetch(`${baseUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  } as RequestInit);
  if (!res.ok) {
    throw new Error('No se pudo verificar la sesión');
  }
  return (await res.json()) as {
    user: AuthUser;
    roles?: readonly string[];
    organization?: OrgSummary;
    support?: SupportInfo;
  };
}

export function parseAuthResponse(data: unknown): LoginSuccess {
  const d = data as {
    token?: unknown;
    user?: Partial<AuthUser> & { role?: unknown };
    roles?: unknown;
    organization?: unknown;
    memberships?: unknown;
    selection_required?: unknown;
    support?: unknown;
  };
  if (typeof d.token !== 'string' || !d.token || !d.user) {
    throw new Error('Respuesta de autenticación inválida');
  }
  const u = d.user;
  const roles = Array.isArray(d.roles)
    ? d.roles.filter((r): r is string => typeof r === 'string' && r !== '')
    : undefined;
  const org =
    d.organization && typeof (d.organization as OrgSummary).id === 'string'
      ? (d.organization as OrgSummary)
      : undefined;
  const memberships = Array.isArray(d.memberships)
    ? (d.memberships as MembershipChoice[]).filter(
        (m) => m && typeof m.organization_id === 'string' && m.organization,
      )
    : undefined;
  return {
    token: d.token,
    user: {
      id: String(u.id ?? ''),
      email: String(u.email ?? ''),
      name: typeof u.name === 'string' ? u.name : '',
      ...(typeof u.role === 'string' && u.role !== '' ? { role: u.role } : {}),
      active: u.active !== false,
      ...((u as { platform_admin?: unknown }).platform_admin === true ? { platform_admin: true } : {}),
      ...(roles && roles.length > 0 ? { roles } : {}),
    },
    ...(org ? { organization: org } : {}),
    ...(memberships && memberships.length > 0 ? { memberships } : {}),
    ...(d.selection_required === true ? { selectionRequired: true } : {}),
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
  const res = await doFetch(`${baseUrl}/platform/support-sessions/${sessionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('No se pudo cerrar la sesión de soporte');
  }
}
