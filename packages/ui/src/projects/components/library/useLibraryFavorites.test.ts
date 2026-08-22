/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLibraryCollections } from './useLibraryFavorites';

const STORAGE_KEY = 'muebles.proyectar.library.v1';

/**
 * jsdom en este repo no habilita localStorage por defecto. Instalamos un mock
 * tipo Map (mismo patrón que useInspectorSectionState.test.ts) para que los
 * tests de persistencia sean determinísticos.
 */
function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length(): number {
      return store.size;
    },
    clear: (): void => store.clear(),
    getItem: (key: string): string | null => store.get(key) ?? null,
    key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string): void => {
      store.delete(key);
    },
    setItem: (key: string, value: string): void => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  installLocalStorageMock();
});

afterEach(() => {
  globalThis.localStorage?.clear();
});

describe('useLibraryCollections', () => {
  it('starts empty by default', () => {
    const { result } = renderHook(() => useLibraryCollections());
    expect(result.current.favorites).toEqual([]);
    expect(result.current.workshop).toEqual([]);
    expect(result.current.recent).toEqual([]);
  });

  it('toggleFavorite adds then removes, persisting each step', () => {
    const { result } = renderHook(() => useLibraryCollections());
    act(() => result.current.toggleFavorite('m1'));
    expect(result.current.isFavorite('m1')).toBe(true);

    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).favorites).toEqual(['m1']);

    act(() => result.current.toggleFavorite('m1'));
    expect(result.current.isFavorite('m1')).toBe(false);
    expect(JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY)!).favorites).toEqual([]);
  });

  it('toggleWorkshopPin manages the taller pins collection independently', () => {
    const { result } = renderHook(() => useLibraryCollections());
    act(() => result.current.toggleWorkshopPin('m2'));
    expect(result.current.isWorkshopPinned('m2')).toBe(true);
    expect(result.current.isFavorite('m2')).toBe(false);
    expect(result.current.favorites).toEqual([]);
  });

  it('trackInsert pushes to recent (newest first, deduped, capped at 8)', () => {
    const { result } = renderHook(() => useLibraryCollections());
    for (let i = 1; i <= 10; i++) {
      act(() => result.current.trackInsert(`m${i}`));
    }
    expect(result.current.recent).toEqual([
      'm10',
      'm9',
      'm8',
      'm7',
      'm6',
      'm5',
      'm4',
      'm3',
    ]);

    act(() => result.current.trackInsert('m5'));
    expect(result.current.recent[0]).toBe('m5');
    expect(result.current.recent.filter((x) => x === 'm5')).toHaveLength(1);
  });

  it('rehydrates from localStorage on next mount', () => {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ favorites: ['m1'], workshop: ['m2'], recent: ['m3'] }),
    );
    const { result } = renderHook(() => useLibraryCollections());
    expect(result.current.favorites).toEqual(['m1']);
    expect(result.current.workshop).toEqual(['m2']);
    expect(result.current.recent).toEqual(['m3']);
  });

  it('falls back to defaults when stored value is corrupt', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, '{not valid json');
    const { result } = renderHook(() => useLibraryCollections());
    expect(result.current.favorites).toEqual([]);
  });

  it('sanitizes malformed stored shapes', () => {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ favorites: 'no-array', workshop: [1, null, 'm2'], recent: 42 }),
    );
    const { result } = renderHook(() => useLibraryCollections());
    expect(result.current.favorites).toEqual([]);
    expect(result.current.workshop).toEqual(['m2']);
    expect(result.current.recent).toEqual([]);
  });
});
