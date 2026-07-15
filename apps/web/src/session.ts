/**
 * Session gate helpers for the web shell login / register screens.
 * Auth token key matches APIWorkspaceRepository (`muebles_token`).
 */

export const SESSION_STORAGE_KEY = 'muebles_session';
export const TOKEN_STORAGE_KEY = 'muebles_token';
export const USER_STORAGE_KEY = 'muebles_user';
export const DEFAULT_API_BASE = 'http://localhost:8080/api';

export type SessionMode = 'guest' | 'auth';

export type AuthUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly active: boolean;
};

export type LoginSuccess = {
  readonly token: string;
  readonly user: AuthUser;
};

/**
 * Reads persisted session mode.
 * - guest → enter app without token
 * - auth → requires `muebles_token`; missing token → logged out (null)
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
      typeof parsed.role !== 'string'
    ) {
      return null;
    }
    return {
      id: parsed.id,
      email: parsed.email,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      role: parsed.role,
      active: parsed.active !== false,
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

  const data = (await res.json()) as {
    token?: unknown;
    user?: Partial<AuthUser>;
  };
  if (typeof data.token !== 'string' || !data.token) {
    throw new Error('Respuesta de login inválida');
  }

  const u = data.user;
  if (
    !u ||
    typeof u.id !== 'string' ||
    typeof u.email !== 'string' ||
    typeof u.role !== 'string'
  ) {
    throw new Error('Respuesta de login inválida (usuario)');
  }

  return {
    token: data.token,
    user: {
      id: u.id,
      email: u.email,
      name: typeof u.name === 'string' ? u.name : '',
      role: u.role,
      active: u.active !== false,
    },
  };
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
