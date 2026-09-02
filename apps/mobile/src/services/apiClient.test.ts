import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatedApiClient, setApiBaseUrl } from './apiClient';

describe('mobile generated API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setApiBaseUrl('http://localhost:8080');
  });

  it('keeps the generated contract under the legacy /api base path', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    setApiBaseUrl('https://mobile.example.test/root/');

    await generatedApiClient().login({
      email: 'user@example.test', password: 'secret123', transport: 'mobile',
    }).catch(() => undefined);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://mobile.example.test/root/api/auth/login');
  });

  it('Negative proof real: request preparada para A → refresh devuelve B → no retry bajo B', async () => {
    // 1. Setup initial state with org A
    const { applyCredential, __resetMobileAuthRuntimeForTests } = await import('./mobileAuthRuntime');
    __resetMobileAuthRuntimeForTests();
    applyCredential({
      accessToken: 'token-A',
      accessExpiresAt: '2050-01-01T00:00:00Z',
      absoluteSessionExpiresAt: '2050-01-01T00:00:00Z',
      sessionId: 'sess-1',
      userId: 'usr-1',
      organizationId: 'org-A',
    });

    // 2. Mock fetch to return 401
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    // 3. Mock refreshSession to change the scope to org B
    vi.mock('./mobileAuthRuntime', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./mobileAuthRuntime')>();
      return {
        ...actual,
        refreshSession: vi.fn(async () => {
          actual.applyCredential({
            accessToken: 'token-B',
            accessExpiresAt: '2050-01-01T00:00:00Z',
            absoluteSessionExpiresAt: '2050-01-01T00:00:00Z',
            sessionId: 'sess-1',
            userId: 'usr-1',
            organizationId: 'org-B', // Scope changed!
          });
        })
      };
    });

    const { apiClient } = await import('./apiClient');
    setApiBaseUrl('http://localhost:8080');

    // 4. Execute request
    const req = apiClient.get('/some-endpoint');
    await expect(req).rejects.toThrow('La sesión o la organización ha cambiado.');

    // 5. Assert fetch was only called ONCE (the initial 401), and NO retry under B
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
