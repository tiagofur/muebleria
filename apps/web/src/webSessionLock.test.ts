/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __forceLocalStorageLeaseForTests,
  withWebSessionMutation,
} from './webSessionLock';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage(),
  });
});

afterEach(() => {
  __forceLocalStorageLeaseForTests(false);
  Reflect.deleteProperty(globalThis, 'localStorage');
  vi.restoreAllMocks();
});

describe('webSessionLock — serialización cross-tab de mutaciones (SEC-4B §31–34)', () => {
  it('serializa dos mutaciones concurrentes del mismo runtime (una por vez)', async () => {
    const active: string[] = [];
    let peak = 0;
    const mutation = (id: string) => async () => {
      active.push(id);
      peak = Math.max(peak, active.length);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active.splice(active.indexOf(id), 1);
      return id;
    };

    const [a, b] = await Promise.all([
      withWebSessionMutation(mutation('A')),
      withWebSessionMutation(mutation('B')),
    ]);
    expect(a).toBe('A');
    expect(b).toBe('B');
    expect(peak).toBe(1); // jamás dos rotaciones de cookie en vuelo
  });

  it('navigator.locks disponible: delega en el lock real del browser', async () => {
    const requestedNames: string[] = [];
    const originalLocks = (globalThis as { navigator?: { locks?: unknown } }).navigator?.locks;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        locks: {
          request: async (name: string, callback: () => Promise<void>) => {
            requestedNames.push(name);
            await callback();
          },
        },
      },
    });
    try {
      const result = await withWebSessionMutation(async () => 'rotated');
      expect(result).toBe('rotated');
      expect(requestedNames).toEqual(['granete:web-session-mutation']);
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { locks: originalLocks },
      });
    }
  });

  it('FALLBACK PROOF: sin navigator.locks, dos actores concurrentes serializan las network refreshes', async () => {
    __forceLocalStorageLeaseForTests(true);
    // Fuerza el path de lease aunque exista Web Locks (simula browsers viejos).

    let inFlight = 0;
    let peak = 0;
    const networkRefresh = async (id: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 10));
      inFlight -= 1;
      return id;
    };

    const results = await Promise.all([
      withWebSessionMutation(() => networkRefresh('tab-A-refresh')),
      withWebSessionMutation(() => networkRefresh('tab-B-refresh')),
      withWebSessionMutation(() => networkRefresh('tab-C-refresh')),
    ]);

    expect(results.sort()).toEqual([
      'tab-A-refresh',
      'tab-B-refresh',
      'tab-C-refresh',
    ]);
    expect(peak).toBe(1); // no same-cookie concurrent replay: sesión sigue viva
    expect(globalThis.localStorage.getItem('granete:web-session-lock')).toBeNull();
  });

  it('el lease del fallback nunca contiene secrets ni datos de negocio', async () => {
    __forceLocalStorageLeaseForTests(true);
    let captured = '';
    const store = globalThis.localStorage;
    const originalSet = store.setItem.bind(store);
    store.setItem = (k: string, v: string) => {
      if (k === 'granete:web-session-lock') captured = v;
      originalSet(k, v);
    };
    await withWebSessionMutation(async () => undefined);
    const lease = JSON.parse(captured) as { holder: string; expiresAt: number };
    expect(Object.keys(lease).sort()).toEqual(['expiresAt', 'holder']);
    expect(JSON.stringify(lease)).not.toMatch(/eyJ|Bearer|token|user/i);
  });

  it('un lease vencido de otra pestaña se toma over (takeover), sin deadlock', async () => {
    __forceLocalStorageLeaseForTests(true);
    // Lease muerto hace una hora a nombre de una pestaña inexistente.
    globalThis.localStorage.setItem(
      'granete:web-session-lock',
      JSON.stringify({ holder: 'ghost-tab', expiresAt: Date.now() - 3_600_000 }),
    );
    const result = await withWebSessionMutation(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(globalThis.localStorage.getItem('granete:web-session-lock')).toBeNull();
  });

  it('propaga el error de la mutación y libera el lease para la siguiente', async () => {
    __forceLocalStorageLeaseForTests(true);
    await expect(
      withWebSessionMutation(async () => {
        throw new Error('network down');
      }),
    ).rejects.toThrow('network down');
    expect(globalThis.localStorage.getItem('granete:web-session-lock')).toBeNull();
    const next = await withWebSessionMutation(async () => 'ok-after-failure');
    expect(next).toBe('ok-after-failure');
  });
});
