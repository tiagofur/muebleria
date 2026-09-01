/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WebSessionEndedError,
  WebSessionTransitionError,
  __resetWebAuthClientForTests,
  applyLoginResponse,
  authenticatedApiFetch,
  configureWebAuthClient,
  coordinatedWebRefresh,
  isGraneteApiUrl,
  scheduleWebAccessRefresh,
  webLogout,
  type WebSessionTransitionPlan,
} from './webAuthClient';
import {
  WebSessionLockUnavailableError,
  __setWebSessionLockBackendForTests,
  createInMemoryWebSessionLockBackendForTests,
} from './webSessionLock';
import {
  __resetWebAuthRuntimeForTests,
  applySupportCredential,
  applyWebCredential,
  clearCredential,
  getCredential,
} from './webAuthRuntime';

const BASE = 'http://api.test/api';

const IN_15M = () => new Date(Date.now() + 15 * 60_000).toISOString();
const IN_18H = () => new Date(Date.now() + 18 * 3_600_000).toISOString();

function refreshBody(overrides: Record<string, unknown> = {}) {
  return {
    token: 'access-NEW',
    user: {
      id: 'user-1',
      email: 'a@b.test',
      normalized_email: 'a@b.test',
      name: 'A',
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
    organization: {
      id: 'org-1',
      name: 'Taller 1',
      slug: 'taller-1',
      type: 'factory',
      status: 'active',
      license: { plan: 'pro', status: 'active' },
    },
    selection_required: false,
    transport: 'web',
    session_id: 'sess-1',
    access_expires_at: IN_15M(),
    absolute_session_expires_at: IN_18H(),
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** MeResponse de /auth/me para el snapshot autoritativo post-transición. */
function meBody(userId: string, organizationId: string) {
  return {
    user: {
      id: userId,
      email: 'a@b.test',
      normalized_email: 'a@b.test',
      name: 'A',
      account_status: 'active',
      email_verified_at: null,
      last_login_at: null,
      platform_admin: false,
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:00Z',
    },
    roles: ['admin'],
    memberships: [],
    organization: {
      id: organizationId,
      name: `Taller ${organizationId}`,
      slug: organizationId,
      type: 'factory',
      status: 'active',
      license: { plan: 'pro', status: 'active' },
    },
    transport: 'web',
    session_scope: {
      user_id: userId,
      membership_id: 'membership-1',
      organization_id: organizationId,
      mode: 'auth',
      support_session_id: null,
      recovery_session_id: null,
      membership_credential_version: 2,
      organization_credential_version: 3,
      absolute_expires_at: new Date(Date.now() + 18 * 3_600_000).toISOString(),
    },
  };
}

function seedSession(token = 'access-1', organizationId: string | null = 'org-1') {
  return applyWebCredential({
    accessToken: token,
    accessExpiresAt: IN_15M(),
    absoluteSessionExpiresAt: IN_18H(),
    sessionId: 'sess-1',
    userId: 'user-1',
    organizationId,
  });
}

beforeEach(() => {
  __resetWebAuthRuntimeForTests();
  __resetWebAuthClientForTests();
  // jsdom no tiene navigator.locks ni indexedDB: sin backend, toda mutación
  // fallaría cerrado. Se inyecta el backend in-memory (misma garantía de
  // exclusión que los reales).
  __setWebSessionLockBackendForTests(createInMemoryWebSessionLockBackendForTests());
  configureWebAuthClient({ baseUrl: BASE, fetchImpl: vi.fn(async () => json({})) });
});

afterEach(() => {
  __resetWebAuthRuntimeForTests();
  __resetWebAuthClientForTests();
  __setWebSessionLockBackendForTests(null);
  vi.restoreAllMocks();
});

/**
 * Ejecutor de transición de PRUEBA que graba el ordering exacto de los pasos
 * (review Blocker 2): purge S1 → apply S2 → snapshot /me. Simula un
 * BroadcastChannel ausente/perdido: el ordering NO depende de él.
 */
function recordingTransitionRunner() {
  const steps: string[] = [];
  const runner = async (plan: WebSessionTransitionPlan) => {
    steps.push(`transition:${plan.kind}`);
    steps.push('purge-S1');            // invalidar credential + tenant state
    clearCredential();
    steps.push(`apply-S2:${plan.draft.accessToken}`);
    plan.applyCredential();            // SÓLO ahora S2 queda activo
    steps.push('me-S2');               // snapshot autoritativo posterior
  };
  return { steps, runner };
}

describe('isGraneteApiUrl — bearer sólo para el origin+base exacto (SEC-4B §21)', () => {
  it('acepta paths relativos y absolutos del API Granete', () => {
    expect(isGraneteApiUrl(`${BASE}/projects`)).toBe(true);
    expect(isGraneteApiUrl('/api/projects')).toBe(true);
  });

  it('rechaza origins externos y look-alikes (exact origin, no substring)', () => {
    expect(isGraneteApiUrl('https://evil.test/api/projects')).toBe(false);
    expect(isGraneteApiUrl('http://api.test.evil/api/projects')).toBe(false);
    expect(isGraneteApiUrl('http://notapi.test/api/projects')).toBe(false);
  });
});

describe('authenticatedApiFetch — boundary de requests autenticadas', () => {
  it('adjunta Authorization desde la memoria y reintenta UNA vez tras 401 + refresh mismo scope', async () => {
    seedSession('access-OLD');
    const calls: Array<{ url: string; authorization: string; body?: string; method: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({
        url,
        authorization: new Headers(init?.headers).get('Authorization') ?? '',
        body: typeof init?.body === 'string' ? init.body : undefined,
        method: init?.method ?? 'GET',
      });
      if (url.endsWith('/auth/refresh')) return json(refreshBody());
      if (calls.filter((c) => !c.url.endsWith('/auth/refresh')).length === 1) {
        return json({ error: 'expired' }, 401); // primer intento business
      }
      return json({ ok: true }); // retry con access nuevo
    });
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await authenticatedApiFetch(`${BASE}/projects`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"v3"', 'Idempotency-Key': 'idem-1' },
      body: JSON.stringify({ name: 'Cocina' }),
    });

    expect(res.status).toBe(200);
    const business = calls.filter((c) => !c.url.endsWith('/auth/refresh'));
    expect(business).toHaveLength(2); // original + exactamente UN retry
    // El retry conserva method/body y los headers sensibles (§22).
    expect(business[0]).toMatchObject({ method: 'PUT', body: JSON.stringify({ name: 'Cocina' }) });
    expect(business[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ name: 'Cocina' }) });
    expect(business[0]!.authorization).toBe('Bearer access-OLD');
    expect(business[1]!.authorization).toBe('Bearer access-NEW');
    const retryInit = (
      fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>
    ).find(([, init]) => new Headers(init.headers).get('Authorization') === 'Bearer access-NEW');
    const retryHeaders = new Headers(retryInit?.[1]?.headers);
    expect(retryHeaders.get('If-Match')).toBe('"v3"');
    expect(retryHeaders.get('Idempotency-Key')).toBe('idem-1');
  });

  it('NEGATIVE PROOF (§17): no reintenta si el refresh cambió el scope (cross-tenant)', async () => {
    seedSession('access-A', 'org-A');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        // La cookie compartida ahora pertenece a org-B (otra pestaña hizo
        // select-org): el access devuelto es de OTRO scope — identity distinta.
        return json(refreshBody({
          token: 'access-B',
          organization: { id: 'org-B', name: 'Taller B', slug: 'taller-b', type: 'factory', status: 'active', license: { plan: 'pro', status: 'active' } },
        }));
      }
      // Business request con el token de A: 401.
      if (new Headers(init?.headers).get('Authorization') === 'Bearer access-A') {
        return json({ error: 'unauthorized' }, 401);
      }
      return json({ never: 'retried-under-B' });
    });
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      authenticatedApiFetch(`${BASE}/projects`, { method: 'POST', body: '{}' }),
    ).rejects.toBeInstanceOf(WebSessionTransitionError);

    // La operación original (token A) jamás se re-ejecutó bajo B.
    const authorizations = fetchImpl.mock.calls.map(
      ([, init]) => new Headers((init as RequestInit).headers).get('Authorization') ?? '',
    );
    expect(authorizations).not.toContain('Bearer access-B');
    expect(
      fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/projects')),
    ).toHaveLength(1);
  });

  it('NEGATIVE PROOF (§38, Blocker 2): replacement purga S1 ANTES de usar S2; sin retry; BroadcastChannel perdido', async () => {
    seedSession('access-S1', 'org-A');
    const { steps, runner } = recordingTransitionRunner();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        // La cookie fue reemplazada por un NUEVO login en otra pestaña:
        // sesión S2, OTRO user (identity completa distinta).
        return json(refreshBody({
          token: 'access-S2',
          session_id: 'sess-2',
          user: { id: 'user-2', email: 'b@b.test', normalized_email: 'b@b.test', name: 'B', account_status: 'active' },
        }));
      }
      if (url.endsWith('/auth/me')) return json(meBody('user-2', 'org-B'));
      // Business request con el token de S1: 401 (la sesión A murió).
      if (new Headers(init?.headers).get('Authorization') === 'Bearer access-S1') {
        return json({ error: 'unauthorized' }, 401);
      }
      return json({ never: 'executed-under-S2' });
    });
    configureWebAuthClient({
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runSessionTransition: runner,
    });

    await expect(authenticatedApiFetch(`${BASE}/projects`)).rejects.toBeInstanceOf(
      WebSessionTransitionError,
    );

    // La operación original se ejecutó UNA sola vez y jamás bajo S2.
    const projectsCalls = fetchImpl.mock.calls.filter(
      ([url]) => String(url).endsWith('/projects'),
    );
    expect(projectsCalls).toHaveLength(1);
    const authorizations = fetchImpl.mock.calls.map(
      ([, init]) => new Headers((init as RequestInit).headers).get('Authorization') ?? '',
    );
    expect(authorizations).not.toContain('Bearer access-S2');
    // Ordering del invariante: purge S1 → apply S2 → /me de S2 (el executor
    // corre en-proceso; ningún evento del canal participa).
    expect(steps).toEqual(['transition:session-replaced', 'purge-S1', 'apply-S2:access-S2', 'me-S2']);
    expect(getCredential()).toMatchObject({ sessionId: 'sess-2', accessToken: 'access-S2' });
  });

  it('NEGATIVE PROOF (scope-change mismo sid, Blocker 2): Org A→B vía cookie purga A antes de usar B; sin retry', async () => {
    seedSession('access-A', 'org-A'); // misma sesión sess-1, scope A
    const { steps, runner } = recordingTransitionRunner();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        // MISMO session_id/user, OTRA organización: select-org en otra pestaña.
        return json(refreshBody({ token: 'access-B', organization: { id: 'org-B', name: 'Taller B', slug: 'taller-b', type: 'factory', status: 'active', license: { plan: 'pro', status: 'active' } } }));
      }
      if (url.endsWith('/auth/me')) return json(meBody('user-1', 'org-B'));
      if (new Headers(init?.headers).get('Authorization') === 'Bearer access-A') {
        return json({ error: 'unauthorized' }, 401);
      }
      return json({ never: 'executed-under-B' });
    });
    configureWebAuthClient({
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runSessionTransition: runner,
    });

    await expect(
      authenticatedApiFetch(`${BASE}/projects`, { method: 'POST', body: '{}' }),
    ).rejects.toBeInstanceOf(WebSessionTransitionError);

    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/projects'))).toHaveLength(1);
    expect(fetchImpl.mock.calls.map(([, init]) => new Headers((init as RequestInit).headers).get('Authorization') ?? '')).not.toContain('Bearer access-B');
    expect(steps).toEqual(['transition:scope-changed', 'purge-S1', 'apply-S2:access-B', 'me-S2']);
    expect(getCredential()).toMatchObject({ accessToken: 'access-B', organizationId: 'org-B' });
  });

  it('coordinatedWebRefresh expone la transición sin aplicar S2 ella misma (Option A)', async () => {
    seedSession('access-S1', 'org-A');
    const { steps, runner } = recordingTransitionRunner();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input).endsWith('/auth/refresh')) {
        return json(refreshBody({ token: 'access-S2', session_id: 'sess-2' }));
      }
      return json({});
    });
    configureWebAuthClient({
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runSessionTransition: runner,
    });

    const outcome = await coordinatedWebRefresh();

    expect(outcome).toMatchObject({ status: 'transitioned', kind: 'session-replaced' });
    if (outcome.status === 'transitioned') {
      expect(outcome.credential?.accessToken).toBe('access-S2'); // aplicado por el RUNNER tras el purge
    }
    expect(steps[0]).toBe('transition:session-replaced');
  });

  it('una URL externa jamás recibe el bearer', async () => {
    seedSession('access-1');
    const seen: Array<Headers | undefined> = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.headers ? new Headers(init.headers) : undefined);
      return json({ ok: true });
    });
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await authenticatedApiFetch('https://external.example/hook', {
      headers: { 'Content-Type': 'application/json' },
    });

    expect(seen[0]?.get('Authorization')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('401 en /auth/* pasa intacto (esos endpoints gestionan su propio UX)', async () => {
    seedSession('access-1');
    const fetchImpl = vi.fn(async () => json({ error: 'bad creds' }, 401));
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await authenticatedApiFetch(`${BASE}/auth/login`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refresh 5xx NO cierra la sesión ni reintenta la business request (§45)', async () => {
    seedSession('access-1');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) return json({ error: 'boom' }, 500);
      return json({ error: 'unauthorized' }, 401);
    });
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await authenticatedApiFetch(`${BASE}/projects`);
    expect(res.status).toBe(401); // el 401 original
    expect(getCredential()?.accessToken).toBe('access-1'); // sesión local viva
  });

  it('refresh terminal (REFRESH_REVOKED) termina la sesión local con error tipificado', async () => {
    seedSession('access-1');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        return json({ code: 'REFRESH_REVOKED', message: 'revoked' }, 401);
      }
      return json({ error: 'unauthorized' }, 401);
    });
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(authenticatedApiFetch(`${BASE}/projects`)).rejects.toBeInstanceOf(
      WebSessionEndedError,
    );
    expect(getCredential()).toBeNull();
  });

  it('jamás loopea: el retry de un 401 no dispara otro refresh', async () => {
    seedSession('access-1');
    let businessCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) return json(refreshBody());
      void init;
      businessCalls += 1;
      return json({ error: 'still denied' }, 401); // el nuevo token también falla
    });
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await authenticatedApiFetch(`${BASE}/projects`);
    expect(res.status).toBe(401);
    expect(businessCalls).toBe(2); // original + exactamente UN retry
  });
});

describe('coordinatedWebRefresh — singleflight in-tab (§30)', () => {
  it('20 callers concurrentes comparten UNA rotación de cookie', async () => {
    seedSession('access-1');
    let rotations = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      if (String(input).endsWith('/auth/refresh')) {
        rotations += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(refreshBody());
      }
      return json({});
    });
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => coordinatedWebRefresh()),
    );
    expect(rotations).toBe(1);
    expect(outcomes.every((o) => o.status === 'refreshed')).toBe(true);
    expect(getCredential()?.accessToken).toBe('access-NEW');
  });

  it('la rotación viaja bodyless, credentialed y con el header CSRF exacto (§7/§9)', async () => {
    seedSession('access-1');
    const fetchImpl = vi.fn(async () => json(refreshBody()));
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await coordinatedWebRefresh();

    const [url, init] = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    expect(url).toBe(`${BASE}/auth/refresh`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('X-Granete-CSRF')).toBe('1');
    // Jamás un Authorization al cookie bootstrap.
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
    expect(init.body).toBeUndefined();
  });

  it('403 del boundary CSRF es terminal fail-closed, sin loop (§46)', async () => {
    seedSession('access-1');
    const fetchImpl = vi.fn(async () => json({ error: 'csrf' }, 403));
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const outcome = await coordinatedWebRefresh();
    expect(outcome).toMatchObject({ status: 'terminal', code: 'CSRF_DENIED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('5xx durante refresh es network, NO terminal: la cookie sigue viva (§45)', async () => {
    seedSession('access-1');
    const fetchImpl = vi.fn(async () => json({ error: 'db down' }, 500));
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const outcome = await coordinatedWebRefresh();
    expect(outcome.status).toBe('network');
    expect(getCredential()?.accessToken).toBe('access-1');
  });
});

describe('webLogout (§49/§50)', () => {
  it('revoca con cookie+CSRF bajo lock y difunde session-ended', async () => {
    seedSession('access-1');
    const fetchImpl = vi.fn(async () => json({ logged_out: true }));
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const outcome = await webLogout();

    expect(outcome.status).toBe('revoked');
    expect(getCredential()).toBeNull();
    const [url, init] = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    expect(url).toBe(`${BASE}/auth/logout`);
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('X-Granete-CSRF')).toBe('1');
  });

  it('5xx preserva la cookie: pending-retry, jamás "logout completado"', async () => {
    seedSession('access-1');
    const fetchImpl = vi.fn(async () => json({ error: 'db down' }, 500));
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const outcome = await webLogout();

    expect(outcome.status).toBe('pending-retry');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('applyLoginResponse — metadata obligatoria del server (§27)', () => {
  it('aplica el credential con la metadata de expiridad sin decodificar el JWT', () => {
    const credential = applyLoginResponse(refreshBody() as never);
    expect(credential).toMatchObject({
      kind: 'web',
      accessToken: 'access-NEW',
      sessionId: 'sess-1',
    });
    expect(credential.accessExpiresAt).toBe(IN_15M());
  });

  it('rechaza un auth response sin metadata completa (fail closed)', () => {
    const incomplete = { ...refreshBody(), access_expires_at: undefined };
    expect(() => applyLoginResponse(incomplete as never)).toThrow(
      'Respuesta de autenticación sin metadata de sesión completa',
    );
  });
});

describe('modo support (SEC-4B §39–43)', () => {
  it('NEGATIVE PROOF (§43): 401 en modo support NO usa la cookie para retry', async () => {
    applySupportCredential({
      accessToken: 'support-access',
      accessExpiresAt: IN_15M(),
      sessionId: 'support-session-1',
      organizationId: 'org-target',
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) return json(refreshBody()); // trampa: no debe llamarse
      return json({ error: 'unauthorized' }, 401);
    });
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await authenticatedApiFetch(`${BASE}/projects`);

    expect(res.status).toBe(401); // el 401 original, sin credential-class switch
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/auth/refresh'))).toBe(false);
    // El credential de soporte sigue intacto en memoria.
    expect(getCredential()).toMatchObject({ kind: 'support', accessToken: 'support-access' });
  });
});

describe('scheduleWebAccessRefresh — scheduler por expiry real (§28/§29)', () => {
  it('programa el refresh ~2 min antes del vencimiento usando access_expires_at', async () => {
    vi.useFakeTimers();
    try {
      seedSession();
      let refreshes = 0;
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        if (String(input).endsWith('/auth/refresh')) {
          refreshes += 1;
          return json(refreshBody());
        }
        return json({});
      });
      configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
      __resetWebAuthClientForTests();

      scheduleWebAccessRefresh();
      // Ni antes de la ventana de renovación...
      await vi.advanceTimersByTimeAsync(12 * 60_000);
      expect(refreshes).toBe(0);
      // ...ni un setInterval fijo: justo antes del expiry (~13 min) dispara.
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(refreshes).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('visibility wake con access vencido dispara el refresh (tab en background/sleep)', async () => {
    vi.useFakeTimers();
    try {
      // Access YA vencido (expiró mientras la tab dormía).
      applyWebCredential({
        accessToken: 'expired-access',
        accessExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        absoluteSessionExpiresAt: IN_18H(),
        sessionId: 'sess-1',
        userId: 'user-1',
        organizationId: 'org-1',
      });
      let refreshes = 0;
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        if (String(input).endsWith('/auth/refresh')) {
          refreshes += 1;
          return json(refreshBody());
        }
        return json({});
      });
      configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
      __resetWebAuthClientForTests();

      scheduleWebAccessRefresh();
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(1_000);

      expect(refreshes).toBe(1); // recuperación al volver, sin storm (singleflight)
      expect(getCredential()?.accessToken).toBe('access-NEW');
    } finally {
      vi.useRealTimers();
    }
  });

  it('deadline absoluto alcanzado: fin de sesión, el refresh no puede deslizar T0+18h (§47)', async () => {
    vi.useFakeTimers();
    try {
      applyWebCredential({
        accessToken: 'access-at-deadline',
        accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        absoluteSessionExpiresAt: new Date(Date.now() - 1_000).toISOString(), // T0+18h pasó
        sessionId: 'sess-1',
        userId: 'user-1',
        organizationId: 'org-1',
      });
      const fetchImpl = vi.fn(async () => json(refreshBody()));
      configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
      __resetWebAuthClientForTests();

      scheduleWebAccessRefresh();
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(1_000);

      expect(fetchImpl).not.toHaveBeenCalled(); // ni siquiera intenta refrescar
      expect(getCredential()).toBeNull(); // purge + re-login
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fail closed del lock de sesión (review Blocker 1)', () => {
  it('refresh: sin primitiva de coordinación NO se llama al server y el outcome es network', async () => {
    seedSession('access-1');
    __setWebSessionLockBackendForTests(null); // jsdom: sin locks ni indexedDB
    const fetchImpl = vi.fn(async () => json(refreshBody()));
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const outcome = await coordinatedWebRefresh();

    // La rotación fue RECHAZADA (fail closed): jamás un fetch concurrente
    // potencial; el access local sigue y la sesión server-side está intacta.
    expect(outcome.status).toBe('network');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getCredential()?.accessToken).toBe('access-1');
  });

  it('logout: sin primitiva NO se llama al server y queda pending-retry (nunca "completado")', async () => {
    seedSession('access-1');
    __setWebSessionLockBackendForTests(null);
    const fetchImpl = vi.fn(async () => json({ logged_out: true }));
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const outcome = await webLogout();

    expect(outcome.status).toBe('pending-retry');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('WebSessionLockUnavailableError es el error tipificado del fail closed', () => {
    expect(new WebSessionLockUnavailableError('sin primitiva')).toBeInstanceOf(Error);
  });
});
