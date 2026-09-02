import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatedApiClient, setApiBaseUrl, apiClient } from './apiClient';
import * as authRuntime from './mobileAuthRuntime';

describe('mobile generated API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setApiBaseUrl('http://localhost:8080');
    authRuntime.__resetMobileAuthRuntimeForTests();
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

  it('Caso A: Negative proof real: request preparada para A → refresh devuelve B (org change) → no retry bajo B', async () => {
    authRuntime.applyCredential({
      accessToken: 'token-A',
      accessExpiresAt: '2050-01-01T00:00:00Z',
      absoluteSessionExpiresAt: '2050-01-01T00:00:00Z',
      sessionId: 'sess-1',
      userId: 'usr-1',
      organizationId: 'org-A',
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(authRuntime, 'refreshSession').mockImplementation(async () => {
      authRuntime.applyCredential({
        accessToken: 'token-B',
        accessExpiresAt: '2050-01-01T00:00:00Z',
        absoluteSessionExpiresAt: '2050-01-01T00:00:00Z',
        sessionId: 'sess-1',
        userId: 'usr-1',
        organizationId: 'org-B', // Scope changed!
      });
    });

    const req = apiClient.get('/some-endpoint');
    await expect(req).rejects.toThrow('La sesión o la organización ha cambiado.');

    expect(fetchMock).toHaveBeenCalledTimes(1); // No retry
  });

  it('Caso B: Negative proof real: request preparada para User A → refresh devuelve User B (user change) → no retry', async () => {
    authRuntime.applyCredential({
      accessToken: 'token-A',
      accessExpiresAt: '2050-01-01T00:00:00Z',
      absoluteSessionExpiresAt: '2050-01-01T00:00:00Z',
      sessionId: 'sess-1',
      userId: 'usr-A',
      organizationId: 'org-1',
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(authRuntime, 'refreshSession').mockImplementation(async () => {
      authRuntime.applyCredential({
        accessToken: 'token-B',
        accessExpiresAt: '2050-01-01T00:00:00Z',
        absoluteSessionExpiresAt: '2050-01-01T00:00:00Z',
        sessionId: 'sess-1',
        userId: 'usr-B', // User changed!
        organizationId: 'org-1',
      });
    });

    const req = apiClient.get('/some-endpoint');
    await expect(req).rejects.toThrow('La sesión o la organización ha cambiado.');

    expect(fetchMock).toHaveBeenCalledTimes(1); // No retry
  });

  it('Caso C: Negative proof real: request preparada para Session 1 → refresh devuelve Session 2 (session replaced) → no retry', async () => {
    authRuntime.applyCredential({
      accessToken: 'token-A',
      accessExpiresAt: '2050-01-01T00:00:00Z',
      absoluteSessionExpiresAt: '2050-01-01T00:00:00Z',
      sessionId: 'sess-1',
      userId: 'usr-1',
      organizationId: 'org-1',
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(authRuntime, 'refreshSession').mockImplementation(async () => {
      authRuntime.applyCredential({
        accessToken: 'token-B',
        accessExpiresAt: '2050-01-01T00:00:00Z',
        absoluteSessionExpiresAt: '2050-01-01T00:00:00Z',
        sessionId: 'sess-2', // Session replaced!
        userId: 'usr-1',
        organizationId: 'org-1',
      });
    });

    const req = apiClient.get('/some-endpoint');
    await expect(req).rejects.toThrow('La sesión o la organización ha cambiado.');

    expect(fetchMock).toHaveBeenCalledTimes(1); // No retry
  });

  it('Positive proof: request preparada para A → refresh devuelve A (mismo session/user/org) → exactamente UN retry permitido', async () => {
    authRuntime.applyCredential({
      accessToken: 'token-A',
      accessExpiresAt: '2050-01-01T00:00:00Z',
      absoluteSessionExpiresAt: '2050-01-01T00:00:00Z',
      sessionId: 'sess-1',
      userId: 'usr-1',
      organizationId: 'org-1',
    });

    // Mock fetch: first time returns 401, second time returns 200 OK
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"success": true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(authRuntime, 'refreshSession').mockImplementation(async () => {
      authRuntime.applyCredential({
        accessToken: 'token-new',
        accessExpiresAt: '2050-01-01T00:00:00Z',
        absoluteSessionExpiresAt: '2050-01-01T00:00:00Z',
        sessionId: 'sess-1', // Same session
        userId: 'usr-1',     // Same user
        organizationId: 'org-1', // Same org
      });
    });

    const req = apiClient.get('/some-endpoint');
    const res = await req;
    
    expect(res).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2); // One initial + EXACTLY ONE retry
  });
});
