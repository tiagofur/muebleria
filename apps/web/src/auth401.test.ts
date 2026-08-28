import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAuth401Interceptor } from './auth401';

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
      return [...map.keys()][index - 0] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

const jsonResponse = (status: number) =>
  new Response(JSON.stringify({ error: 'x' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('installAuth401Interceptor (P0-1 safety net)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(token: string | null) {
    const onExpired = vi.fn();
    const realFetch = vi.fn(async () => jsonResponse(200));
    const storage = memoryStorage(token ? { granete_token: token } : {});
    vi.stubGlobal('window', {
      fetch: realFetch,
      localStorage: storage,
    });
    installAuth401Interceptor(onExpired, { readToken: () => token });
    return { onExpired, fetch: realFetch, setToken: (t: string | null) => { token = t; } };
  }

  it('fires onExpired once for repeated 401s with the same token (fan-out dedup)', async () => {
    const { onExpired, fetch } = setup('tok-1');
    fetch.mockImplementation(async () => jsonResponse(401));
    await window.fetch('http://localhost:8080/api/catalog/materials/x');
    await window.fetch('http://localhost:8080/api/catalog/materials/y');
    await window.fetch('http://localhost:8080/api/projects');
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('does not fire for auth endpoints (they own their 401 UX)', async () => {
    const { onExpired, fetch } = setup('tok-1');
    fetch.mockImplementation(async () => jsonResponse(401));
    await window.fetch('http://localhost:8080/api/auth/login');
    await window.fetch('http://localhost:8080/api/auth/me');
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('does not fire on 200s or when no token exists (guest)', async () => {
    const a = setup('tok-1');
    await window.fetch('http://localhost:8080/api/catalog/materials/x');
    expect(a.onExpired).not.toHaveBeenCalled();

    const b = setup(null);
    b.fetch.mockImplementation(async () => jsonResponse(401));
    await window.fetch('http://localhost:8080/api/catalog/materials/x');
    expect(b.onExpired).not.toHaveBeenCalled();
  });

  it('passes the response through untouched', async () => {
    const { fetch } = setup('tok-1');
    fetch.mockImplementation(async () => jsonResponse(401));
    const res = await window.fetch('http://localhost:8080/api/projects');
    expect(res.status).toBe(401);
  });
});
