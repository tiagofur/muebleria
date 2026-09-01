/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WebSessionLockUnavailableError,
  __setWebSessionLockBackendForTests,
  createInMemoryWebSessionLockBackendForTests,
  createWebSessionMutationLock,
  webSessionMutationLock,
  withWebSessionMutation,
  type WebSessionLockBackend,
} from './webSessionLock';

beforeEach(() => {
  // jsdom no tiene navigator.locks ni indexedDB: sin backend inyectado, toda
  // mutación del singleton FAIL CLOSED (lo prueban los casos dedicados).
  __setWebSessionLockBackendForTests(null);
});

afterEach(() => {
  __setWebSessionLockBackendForTests(null);
  vi.restoreAllMocks();
});

describe('webSessionLock — exclusión mutua real (SEC-4B review Blocker 1)', () => {
  it('serializa dos mutaciones concurrentes del MISMO runtime (cola in-tab)', async () => {
    const backend = createInMemoryWebSessionLockBackendForTests();
    const active: string[] = [];
    let peak = 0;
    const mutation = (id: string) => async () => {
      active.push(id);
      peak = Math.max(peak, active.length);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active.splice(active.indexOf(id), 1);
      return id;
    };
    const lock = createWebSessionMutationLock({ backend });

    const [a, b] = await Promise.all([
      lock.withWebSessionMutation(mutation('A')),
      lock.withWebSessionMutation(mutation('B')),
    ]);

    expect(a).toBe('A');
    expect(b).toBe('B');
    expect(peak).toBe(1);
    expect(backend.peakConcurrentHolders()).toBe(1);
  });

  it(
    'FALLBACK PROOF: DOS runtimes/tab identities independientes (sólo el backend compartido) ' +
      'serializan las network mutations con peak = 1',
    async () => {
      // Backend compartido = única interacción entre "pestañas". Cada runtime
      // tiene su PROPIO tabId y su PROPIA inTabQueue (sin singleton).
      const backend = createInMemoryWebSessionLockBackendForTests();
      const tabA = createWebSessionMutationLock({ backend, tabId: 'tab-A' });
      const tabB = createWebSessionMutationLock({ backend, tabId: 'tab-B' });
      const tabC = createWebSessionMutationLock({ backend, tabId: 'tab-C' });

      let inFlight = 0;
      let peak = 0;
      const networkRefresh = async (tab: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 10));
        inFlight -= 1;
        return `${tab}-refreshed`;
      };

      const results = await Promise.all([
        tabA.withWebSessionMutation(() => networkRefresh('tab-A')),
        tabB.withWebSessionMutation(() => networkRefresh('tab-B')),
        tabC.withWebSessionMutation(() => networkRefresh('tab-C')),
      ]);

      expect(results.sort()).toEqual([
        'tab-A-refreshed',
        'tab-B-refreshed',
        'tab-C-refreshed',
      ]);
      // La garantía: at most UNA mutación cross-tab a la vez — sin replay de
      // cookie concurrente (SEC-2A strict single-use intacto).
      expect(peak).toBe(1);
      expect(backend.peakConcurrentHolders()).toBe(1);
    },
  );

  it('navigator.locks disponible: acquire/release promisificado sobre el lock real', async () => {
    const held: string[] = [];
    const released: string[] = [];
    const original = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        locks: {
          request: async (_name: string, _options: unknown, callback: () => Promise<void>) => {
            held.push('lock');
            await callback();
            released.push('lock');
          },
        },
      },
    });
    try {
      const lock = createWebSessionMutationLock({ tabId: 'tab-locks' });
      const result = await lock.withWebSessionMutation(async () => 'rotated');
      expect(result).toBe('rotated');
      expect(held).toEqual(['lock']);
      expect(released).toEqual(['lock']); // release efectivo antes de resolver
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: original,
      });
    }
  });

  it('FAIL CLOSED: sin navigator.locks ni IndexedDB la mutación NO se ejecuta', async () => {
    // jsdom: sin locks ni indexedDB reales; sin backend inyectado.
    expect((globalThis as { indexedDB?: unknown }).indexedDB).toBeUndefined();
    let executed = false;
    await expect(
      withWebSessionMutation(async () => {
        executed = true;
        return 'never';
      }),
    ).rejects.toBeInstanceOf(WebSessionLockUnavailableError);
    expect(executed).toBe(false);

    // El singleton de producción comparte el destino fail-closed.
    let singletonExecuted = false;
    await expect(
      webSessionMutationLock.withWebSessionMutation(async () => {
        singletonExecuted = true;
      }),
    ).rejects.toBeInstanceOf(WebSessionLockUnavailableError);
    expect(singletonExecuted).toBe(false);
  });

  it('IndexedDB denegado en runtime (open rechazado): mutación NO se ejecuta', async () => {
    // indexedDB presente pero bloqueado (p.ej. contexto denegado): el acquire
    // debe fallar cerrado, no degradar a "correr igual".
    const factory = { open: () => { throw new Error('The user denied permission'); } };
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
    try {
      const lock = createWebSessionMutationLock({ tabId: 'tab-denied' });
      let executed = false;
      await expect(
        lock.withWebSessionMutation(async () => {
          executed = true;
        }),
      ).rejects.toBeInstanceOf(WebSessionLockUnavailableError);
      expect(executed).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });

  it('un lease vencido de otra pestaña se toma over (crash-safety), sin deadlock', async () => {
    // TTL corto para no esperar el real (15 s) en el test.
    const backend = createInMemoryWebSessionLockBackendForTests({ ttlMs: 25 });
    // Simula un crash: la mutación de la pestaña fantasma nunca libera.
    const ghost = createWebSessionMutationLock({ backend, tabId: 'ghost-tab' });
    const ghostRun = ghost.withWebSessionMutation(() => new Promise<string>(() => undefined));
    void ghostRun.catch(() => undefined);
    // Deja pasar el TTL del registro.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const survivor = createWebSessionMutationLock({ backend, tabId: 'survivor-tab' });
    const result = await survivor.withWebSessionMutation(async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('propaga el error de la mutación y libera para la siguiente', async () => {
    const backend = createInMemoryWebSessionLockBackendForTests();
    const lock = createWebSessionMutationLock({ backend });
    await expect(
      lock.withWebSessionMutation(async () => {
        throw new Error('network down');
      }),
    ).rejects.toThrow('network down');
    const next = await lock.withWebSessionMutation(async () => 'ok-after-failure');
    expect(next).toBe('ok-after-failure');
  });

  it('la metadata de coordinación jamás contiene secrets', async () => {
    const backend = createInMemoryWebSessionLockBackendForTests();
    const seen: string[] = [];
    const wrapping: WebSessionLockBackend = {
      acquire: (holder) => {
        seen.push(holder);
        return backend.acquire(holder);
      },
    };
    const lock = createWebSessionMutationLock({ backend: wrapping, tabId: 'tab-audit' });
    await lock.withWebSessionMutation(async () => undefined);
    for (const holder of seen) {
      expect(holder).not.toMatch(/eyJ|Bearer|token|secret/i);
    }
  });
});
