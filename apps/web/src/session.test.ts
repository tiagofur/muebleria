import { describe, expect, it, vi } from 'vitest';
import {
  SESSION_STORAGE_KEY,
  LEGACY_BEARER_STORAGE_KEYS,
  clearSession,
  isAdminRole,
  loginRequest,
  meRequest,
  parseAuthResponse,
  readSessionMode,
  type SessionSnapshot,
  validateOrganizationSessionTransition,
  writeSessionMode,
} from './session';
import { organizationKeys } from './shared/query/queryKeys';
import {
  createSessionGeneration,
  sessionScopeFromSession,
} from './shared/query/sessionScope';

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
    expect(readSessionMode(memoryStorage())).toBeNull();
  });

  it('readSessionMode returns guest without requiring token', () => {
    const session = memoryStorage({ [SESSION_STORAGE_KEY]: 'guest' });
    expect(readSessionMode(session)).toBe('guest');
  });

  it('readSessionMode returns the auth hint without touching any token (#460 SEC-4B: hint, not authority)', () => {
    const session = memoryStorage({ [SESSION_STORAGE_KEY]: 'auth' });
    expect(readSessionMode(session)).toBe('auth');
  });

  it('writeSessionMode and clearSession round-trip; clearSession destroys legacy bearers', () => {
    const session = memoryStorage();
    const local = memoryStorage();
    for (const key of LEGACY_BEARER_STORAGE_KEYS) {
      local.setItem(key, key.endsWith('_user') ? '{"id":"1"}' : 'legacy-jwt-value');
    }
    writeSessionMode('auth', session);
    expect(session.getItem(SESSION_STORAGE_KEY)).toBe('auth');
    clearSession(session, local);
    expect(session.getItem(SESSION_STORAGE_KEY)).toBeNull();
    for (const key of LEGACY_BEARER_STORAGE_KEYS) {
      expect(local.getItem(key)).toBeNull();
    }
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
        memberships: [],
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

  type TransitionMismatch = {
    readonly selectedOrganizationId?: string;
    readonly snapshotOrganizationId?: string;
    readonly snapshotUserId?: string;
    readonly scopeUserId?: string;
    readonly scopeOrganizationId?: string;
    readonly scopeMembershipId?: string | null;
    readonly scopeMembershipCredentialVersion?: number | null;
    readonly scopeOrganizationCredentialVersion?: number | null;
    readonly scopeMode?: 'auth' | 'support';
    readonly scopeSupportSessionId?: string | null;
  };

  it.each<readonly [string, TransitionMismatch]>([
    ['selected organization', { selectedOrganizationId: 'org-2' }],
    ['snapshot organization', { snapshotOrganizationId: 'org-2' }],
    ['snapshot user', { snapshotUserId: '2' }],
    ['scope user', { scopeUserId: '2' }],
    ['scope organization', { scopeOrganizationId: 'org-2' }],
    ['missing membership', { scopeMembershipId: null }],
    ['missing membership credential version', { scopeMembershipCredentialVersion: null }],
    ['missing organization credential version', { scopeOrganizationCredentialVersion: null }],
    ['support scope', { scopeMode: 'support', scopeSupportSessionId: 'support-1' }],
  ])('rejects a mismatched %s', (_label, mismatch) => {
    const selectionResponse = parseAuthResponse({
      token: 'jwt-new',
      user: { id: '1', email: 'a@b.com', normalized_email: 'a@b.com', name: 'Ana', account_status: 'active', email_verified_at: null, last_login_at: null, platform_admin: false, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z' },
      license: { plan: 'none', status: 'none' },
      organization: { id: mismatch.selectedOrganizationId ?? 'org-1', name: 'Taller 1', slug: 'taller-1', type: 'factory', status: 'active', license: { plan: 'none', status: 'none' } },
      roles: ['admin'], memberships: [], selection_required: false, transport: 'web',
    });
    const validatedScope = sessionScopeFromSession({
      user: {
        id: '1', email: 'a@b.com', normalized_email: 'a@b.com', name: 'Ana',
        account_status: 'active', email_verified_at: null, last_login_at: null,
        platform_admin: false, created_at: '2026-08-29T00:00:00Z',
        updated_at: '2026-08-29T00:00:00Z',
      },
      roles: ['admin'],
      memberships: [],
      organization: {
        id: 'org-1', name: 'Taller 1', slug: 'taller-1', type: 'factory',
        status: 'active', license: { plan: 'none', status: 'none' },
      },
      transport: 'web',
      session_scope: SESSION_SCOPE,
    }, createSessionGeneration());
    const sessionSnapshot: SessionSnapshot = {
      user: { id: mismatch.snapshotUserId ?? '1', email: 'a@b.com', name: 'Ana', account_status: 'active', roles: ['admin'] },
      roles: ['admin'],
      organizationChoices: [],
      organization: { id: mismatch.snapshotOrganizationId ?? 'org-1', name: 'Taller 1', slug: 'taller-1', type: 'factory', status: 'active', license: { plan: 'none', status: 'none' } },
      sessionScope: {
        ...validatedScope,
        userId: mismatch.scopeUserId ?? validatedScope.userId,
        membershipId: mismatch.scopeMembershipId === undefined
            ? validatedScope.membershipId
          : mismatch.scopeMembershipId,
        organizationId: mismatch.scopeOrganizationId ?? validatedScope.organizationId,
        mode: mismatch.scopeMode ?? validatedScope.mode,
        supportSessionId: mismatch.scopeSupportSessionId ?? validatedScope.supportSessionId,
        membershipCredentialVersion:
          mismatch.scopeMembershipCredentialVersion === undefined
            ? validatedScope.membershipCredentialVersion
            : mismatch.scopeMembershipCredentialVersion,
        organizationCredentialVersion:
          mismatch.scopeOrganizationCredentialVersion === undefined
            ? validatedScope.organizationCredentialVersion
            : mismatch.scopeOrganizationCredentialVersion,
      },
    };

    expect(() => validateOrganizationSessionTransition({
      requestedOrganizationId: 'org-1', selectionResponse, sessionSnapshot,
    })).toThrow('La sesión seleccionada no coincide con el taller solicitado');
  });
});

describe('meRequest', () => {
  it('GETs /auth/me with Bearer token without double /api', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: { id: '1', email: 'a@b.com', normalized_email: 'a@b.com', name: 'Ana', account_status: 'active', email_verified_at: null, last_login_at: null, platform_admin: false, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z' },
          roles: ['admin'],
          memberships: [],
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
    expect(result.sessionScope.sessionGeneration).not.toBe('token-123');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8080/api/auth/me');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-123');
  });

  it('accepts a support target organization without an actor membership', async () => {
    const organization = {
      id: 'org-2', name: 'Support target', slug: 'support-target', type: 'factory',
      status: 'active', license: { plan: 'none', status: 'none' },
    } as const;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      user: { id: '1', email: 'a@b.com', normalized_email: 'a@b.com', name: 'Ana', account_status: 'active', email_verified_at: null, last_login_at: null, platform_admin: true, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z' },
      roles: ['admin'],
      memberships: [],
      organization,
      support: { organization_id: 'org-2', session_id: 'support-1', reason: 'investigation' },
      transport: 'support',
      session_scope: {
        ...SESSION_SCOPE,
        membership_id: null,
        organization_id: 'org-2',
        mode: 'support',
        support_session_id: 'support-1',
        membership_credential_version: null,
        organization_credential_version: 9,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await meRequest('support-token', { fetchImpl });

    expect(result.organization).toEqual(organization);
    expect(result.organizationChoices).toEqual([]);
    expect(result.sessionScope).toMatchObject({ mode: 'support', organizationId: 'org-2' });
  });

  it('creates a different non-secret query root for repeated logins with the same server scope', async () => {
    const responseBody = {
      user: { id: '1', email: 'a@b.com', normalized_email: 'a@b.com', name: 'Ana', account_status: 'active', email_verified_at: null, last_login_at: null, platform_admin: false, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z' },
      roles: ['admin'],
      memberships: [],
      organization: { id: 'org-1', name: 'Taller 1', slug: 'taller-1', type: 'factory', status: 'active', license: { plan: 'none', status: 'none' } },
      transport: 'web', session_scope: SESSION_SCOPE,
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(responseBody), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responseBody), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const first = await meRequest('same-token-shape', { fetchImpl });
    const second = await meRequest('same-token-shape', { fetchImpl });

    expect(first.sessionScope.sessionGeneration).not.toBe(second.sessionScope.sessionGeneration);
    expect(organizationKeys.all(first.sessionScope)).not.toEqual(organizationKeys.all(second.sessionScope));
    expect(organizationKeys.all(first.sessionScope)).not.toContain('same-token-shape');
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
