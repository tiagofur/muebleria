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
  registerRequest,
  storeAuthToken,
  storeAuthUser,
  writeSessionMode,
} from './session';

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
        active: true,
      }),
    });
    writeSessionMode('auth', session);
    expect(session.getItem(SESSION_STORAGE_KEY)).toBe('auth');
    clearSession(session, local);
    expect(session.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(local.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(local.getItem(USER_STORAGE_KEY)).toBeNull();
  });

  it('storeAuthToken writes muebles_token', () => {
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
        active: true,
      },
      local,
    );
    expect(readAuthUser(local)).toEqual({
      id: 'u1',
      email: 'tiagofur@gmail.com',
      name: 'Tiago',
      role: 'admin',
      active: true,
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
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          token: 'jwt-ok',
          user: {
            id: '1',
            email: 'a@b.com',
            name: 'Ana',
            role: 'admin',
            active: true,
          },
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
    expect(result.user.role).toBe('admin');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8080/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'secret' }),
      }),
    );
  });

  it('maps 401 to Spanish error', async () => {
    const fetchImpl = vi.fn(async () => new Response('no', { status: 401 }));
    await expect(
      loginRequest('a@b.com', 'bad', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Email o contraseña incorrectos');
  });

  it('maps 403 pending approval to message from body', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: 'Tu cuenta está pendiente de aprobación por el administrador',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(
      loginRequest('pending@b.com', 'x', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('pendiente de aprobación');
  });

  it('maps network failure to connection error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      loginRequest('a@b.com', 'x', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('No se pudo conectar con el servidor');
  });
});

describe('registerRequest', () => {
  it('POSTs name/email/password and resolves on 201', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'ok' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await registerRequest('Nueva', 'n@b.com', 'secret1', {
      baseUrl: 'http://localhost:8080/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8080/api/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Nueva',
          email: 'n@b.com',
          password: 'secret1',
        }),
      }),
    );
  });

  it('maps 409 to email already registered', async () => {
    const fetchImpl = vi.fn(async () => new Response('dup', { status: 409 }));
    await expect(
      registerRequest('X', 'x@b.com', 'secret1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Ese email ya está registrado');
  });
});
