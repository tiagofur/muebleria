/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAuth401InterceptorForTests,
  installAuth401Interceptor,
} from './auth401';
import { __resetWebAuthRuntimeForTests, applyWebCredential, getAccessToken } from './webAuthRuntime';
import { __resetWebAuthClientForTests } from './webAuthClient';

const jsonResponse = (status: number) =>
  new Response(JSON.stringify({ error: 'x' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('installAuth401Interceptor (P0-1 safety net, SEC-4B rewrite)', () => {
  afterEach(() => {
    __resetAuth401InterceptorForTests();
    __resetWebAuthRuntimeForTests();
    __resetWebAuthClientForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(token: string | null, refreshStatus = 'terminal') {
    const onEnded = vi.fn();
    const realFetch = vi.fn(async () => jsonResponse(200));
    const refresh = vi.fn(async () => ({ status: refreshStatus }));
    vi.stubGlobal('window', { fetch: realFetch });
    installAuth401Interceptor(onEnded, { readToken: () => token, refresh });
    return { onEnded, fetch: realFetch, refresh };
  }

  it('triggers ONE coordinated refresh for repeated 401s with the same token', async () => {
    const { onEnded, fetch, refresh } = setup('tok-1');
    fetch.mockImplementation(async () => jsonResponse(401));
    await window.fetch('http://localhost:8080/api/catalog/materials/x');
    await window.fetch('http://localhost:8080/api/catalog/materials/y');
    await window.fetch('http://localhost:8080/api/projects');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('does not end the session when the refresh succeeds (renewed access)', async () => {
    const { onEnded, fetch } = setup('tok-1', 'refreshed');
    fetch.mockImplementation(async () => jsonResponse(401));
    await window.fetch('http://localhost:8080/api/projects');
    await Promise.resolve();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('does not fire for auth endpoints (they own their 401 UX)', async () => {
    const { onEnded, fetch } = setup('tok-1');
    fetch.mockImplementation(async () => jsonResponse(401));
    await window.fetch('http://localhost:8080/api/auth/login');
    await window.fetch('http://localhost:8080/api/auth/me');
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('does not fire on 200s or when no token exists (guest)', async () => {
    const a = setup('tok-1');
    await window.fetch('http://localhost:8080/api/catalog/materials/x');
    expect(a.onEnded).not.toHaveBeenCalled();

    const b = setup(null);
    b.fetch.mockImplementation(async () => jsonResponse(401));
    await window.fetch('http://localhost:8080/api/catalog/materials/x');
    expect(b.onEnded).not.toHaveBeenCalled();
  });

  it('passes the response through untouched', async () => {
    const { fetch } = setup('tok-1');
    fetch.mockImplementation(async () => jsonResponse(401));
    const res = await window.fetch('http://localhost:8080/api/projects');
    expect(res.status).toBe(401);
  });

  it('reads the token from memory (webAuthRuntime), never localStorage', async () => {
    __resetWebAuthRuntimeForTests();
    applyWebCredential({
      accessToken: 'memory-token-1',
      accessExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      absoluteSessionExpiresAt: new Date(Date.now() + 18 * 3600_000).toISOString(),
      sessionId: 'sess-1',
      userId: 'user-1',
      organizationId: 'org-1',
    });
    const onEnded = vi.fn();
    const realFetch = vi.fn(async () => jsonResponse(401));
    const refresh = vi.fn(async () => ({ status: 'terminal' }));
    vi.stubGlobal('window', { fetch: realFetch });
    const memory = new Map<string, string>([['granete_token', 'stale-storage-token']]);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
        removeItem: (k: string) => void memory.delete(k),
      },
    });
    installAuth401Interceptor(onEnded, {
      readToken: () => getAccessToken(),
      refresh,
    });
    await window.fetch('http://localhost:8080/api/projects');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
