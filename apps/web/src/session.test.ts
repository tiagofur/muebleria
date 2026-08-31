import { describe, expect, it, vi } from 'vitest';
import {
  SESSION_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
  clearSession,
  isAdminRole,
  loginRequest,
  readAuthUser,
  readSessionMode,
  storeAuthToken,
  storeAuthUser,
  writeSessionMode,
} from './session';

const SESSION_SCOPE = {
  user_id: '1', membership_id: 'membership-1', organization_id: 'org-1', mode: 'auth',
  support_session_id: null, recovery_session_id: null, membership_credential_version: 2,
  organization_credential_version: 3, absolute_expires_at: '2026-08-31T00:00:00Z',
} as const;

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

describe('session helpers', () => {
  it('readSessionMode returns null when empty', () => {
    expect(readSessionMode(memoryStorage(), memoryStorage())).toBeNull();
  });

  it('readSessionMode returns guest without requiring token', () => {
    const session = memoryStorage({ [SESSION_STORAGE_KEY]: 'guest' });
    expect(readSessionMode(session, memoryStorage())).toBe('guest');
  });

  it('readSessionMode returns auth only when token present', () => {
    const session = memoryStorage({ [SESSION_STORAGE_KEY]: 'auth' });
    const local = memoryStorage();
    expect(readSessionMode(session, local)).toBeNull();
    local.setItem(TOKEN_STORAGE_KEY, 'jwt-demo');
    expect(readSessionMode(session, local)).toBe('auth');
  });

  it('writeSessionMode and clearSession round-trip (token + user)', () => {
    const session = memoryStorage();
    const local = memoryStorage({
      [TOKEN_STORAGE_KEY]: 'jwt',
      [USER_STORAGE_KEY]: JSON.stringify({
        id: '1',
        email: 'a@b.com',
        name: 'A',
        role: 'admin',
        account_status: 'active',
      }),
    });
    writeSessionMode('auth', session);
    expect(session.getItem(SESSION_STORAGE_KEY)).toBe('auth');
    clearSession(session, local);
    expect(session.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(local.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(local.getItem(USER_STORAGE_KEY)).toBeNull();
  });

  it('storeAuthToken writes granete_token', () => {
    const local = memoryStorage();
    storeAuthToken('abc.def', local);
    expect(local.getItem(TOKEN_STORAGE_KEY)).toBe('abc.def');
  });

  it('storeAuthUser / readAuthUser round-trip', () => {
    const local = memoryStorage();
    storeAuthUser(
      {
        id: 'u1',
        email: 'tiagofur@gmail.com',
        name: 'Tiago',
        role: 'admin',
        account_status: 'active',
      },
      local,
    );
    expect(readAuthUser(local)).toEqual({
      id: 'u1',
      email: 'tiagofur@gmail.com',
      name: 'Tiago',
      role: 'admin',
      account_status: 'active',
    });
  });

  it('isAdminRole only true for admin', () => {
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('user')).toBe(false);
    expect(isAdminRole('vendedor')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });
});

describe('loginRequest', () => {
  it('POSTs credentials and returns token + user on success', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          token: 'jwt-ok',
          user: {
            id: '1',
            email: 'a@b.com',
            name: 'Ana',
            normalized_email: 'a@b.com',
            account_status: 'active',
            email_verified_at: null,
            last_login_at: null,
            platform_admin: false,
            created_at: '2026-08-29T00:00:00Z',
            updated_at: '2026-08-29T00:00:00Z',
          },
          license: { plan: 'none', status: 'none' },
          roles: ['admin'],
          memberships: [],
          selection_required: false,
          transport: 'web',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const result = await loginRequest('a@b.com', 'secret', {
      baseUrl: 'http://localhost:8080/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.token).toBe('jwt-ok');
    expect(result.user.roles).toEqual(['admin']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8080/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'secret', transport: 'web' }),
      }),
    );
  });

  it('maps 401 to Spanish error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'invalid', fieldErrors: {}, requestId: 'request-401', retryable: false, details: {} }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    await expect(
      loginRequest('a@b.com', 'bad', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Email o contraseña incorrectos');
  });

  it('maps a disabled account to the safe server message', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 'ACCOUNT_DISABLED', message: 'Credenciales inválidas',
            fieldErrors: {}, requestId: 'request-403', retryable: false, details: {},
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(
      loginRequest('disabled@b.com', 'x', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Email o contraseña incorrectos');
  });

  it('maps network failure to connection error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      loginRequest('a@b.com', 'x', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('No se pudo conectar con el servidor');
  });
});

describe('selectOrgRequest', () => {
  it('POSTs organization_id to /auth/select-org with Bearer token', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          token: 'jwt-org-scoped',
          user: { id: '1', email: 'a@b.com', normalized_email: 'a@b.com', name: 'Ana', account_status: 'active', email_verified_at: null, last_login_at: null, platform_admin: false, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z' },
          license: { plan: 'none', status: 'none' },
          organization: { id: 'org-1', name: 'Taller 1', slug: 'taller-1', type: 'factory', status: 'active', license: { plan: 'none', status: 'none' } },
          roles: ['admin'],
          memberships: [],
          selection_required: false,
          transport: 'web',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: '1', email: 'a@b.com', normalized_email: 'a@b.com', name: 'Ana', account_status: 'active', email_verified_at: null, last_login_at: null, platform_admin: false, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z' },
        roles: ['admin'],
        organization: { id: 'org-1', name: 'Taller 1', slug: 'taller-1', type: 'factory', status: 'active', license: { plan: 'none', status: 'none' } },
        transport: 'web',
        session_scope: SESSION_SCOPE,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await (await import('./session')).selectOrgRequest('token-123', 'org-1', {
      baseUrl: 'http://localhost:8080/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.token).toBe('jwt-org-scoped');
    expect(result.organization?.id).toBe('org-1');
    expect(result.sessionScope?.membershipCredentialVersion).toBe(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('http://localhost:8080/api/auth/me');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8080/api/auth/select-org');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-123');
    expect(init?.body).toBe(JSON.stringify({ organization_id: 'org-1' }));
  });
});

describe('meRequest', () => {
  it('GETs /auth/me with Bearer token without double /api', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: { id: '1', email: 'a@b.com', normalized_email: 'a@b.com', name: 'Ana', account_status: 'active', email_verified_at: null, last_login_at: null, platform_admin: false, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z' },
          roles: ['admin'],
          organization: { id: 'org-1', name: 'Taller 1', slug: 'taller-1', type: 'factory', status: 'active', license: { plan: 'none', status: 'none' } },
          transport: 'web',
          session_scope: SESSION_SCOPE,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await (await import('./session')).meRequest('token-123', {
      baseUrl: 'http://localhost:8080/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.user.id).toBe('1');
    expect(result.organization?.id).toBe('org-1');
    expect(result.sessionScope).toMatchObject({
      userId: '1', organizationId: 'org-1', mode: 'auth', absoluteExpiresAt: '2026-08-31T00:00:00Z',
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8080/api/auth/me');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-123');
  });
});

describe('endSupportRequest', () => {
  it('DELETEs /platform/support-sessions/{id} with Bearer token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ended: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await (await import('./session')).endSupportRequest('token-123', 'session-999', {
      baseUrl: 'http://localhost:8080/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8080/api/platform/support-sessions/session-999');
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-123');
  });
});
