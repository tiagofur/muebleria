/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_SECTION_OPEN,
  INSPECTOR_SECTION_IDS,
  useInspectorSectionState,
} from './useInspectorSectionState';

const STORAGE_KEY = 'muebles.part-inspector.sections.v1';

/**
 * jsdom en este repo no habilita localStorage por defecto (requiere flag
 * --localstorage-file). Instalamos un mock tipo Map en globalThis para que
 * el hook SSR-safe lo consuma igual que en producción. Así los tests de
 * persistencia son determinísticos.
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

describe('useInspectorSectionState', () => {
  it('starts with default state (all open except advanced)', () => {
    const { result } = renderHook(() => useInspectorSectionState());
    for (const id of INSPECTOR_SECTION_IDS) {
      expect(result.current.isOpen(id)).toBe(DEFAULT_SECTION_OPEN[id]);
    }
    expect(result.current.isOpen('advanced')).toBe(false);
    expect(result.current.isOpen('dimensions')).toBe(true);
  });

  it('toggle flips a section open→closed and back', () => {
    const { result } = renderHook(() => useInspectorSectionState());
    expect(result.current.isOpen('dimensions')).toBe(true);

    act(() => result.current.toggle('dimensions'));
    expect(result.current.isOpen('dimensions')).toBe(false);

    act(() => result.current.toggle('dimensions'));
    expect(result.current.isOpen('dimensions')).toBe(true);
  });

  it('setOpen sets an explicit value', () => {
    const { result } = renderHook(() => useInspectorSectionState());
    act(() => result.current.setOpen('material', false));
    expect(result.current.isOpen('material')).toBe(false);
    act(() => result.current.setOpen('material', true));
    expect(result.current.isOpen('material')).toBe(true);
  });

  it('persists toggle to localStorage', () => {
    const { result } = renderHook(() => useInspectorSectionState());
    act(() => result.current.toggle('hardware'));

    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.hardware).toBe(false);
    expect(parsed.dimensions).toBe(true); // untouched
  });

  it('rehydrates from localStorage on next mount', () => {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_SECTION_OPEN, finish: false, advanced: true }),
    );

    const { result } = renderHook(() => useInspectorSectionState());
    expect(result.current.isOpen('finish')).toBe(false);
    expect(result.current.isOpen('advanced')).toBe(true);
  });

  it('merges stored state with defaults (tolerates new sections)', () => {
    // Stored state missing 'finish' key — should fall back to default (open).
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ dimensions: false }),
    );

    const { result } = renderHook(() => useInspectorSectionState());
    expect(result.current.isOpen('dimensions')).toBe(false);
    expect(result.current.isOpen('finish')).toBe(true); // default
  });

  it('falls back to defaults when stored value is corrupt', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, '{not valid json');

    const { result } = renderHook(() => useInspectorSectionState());
    expect(result.current.isOpen('dimensions')).toBe(true);
    expect(result.current.isOpen('advanced')).toBe(false);
  });

  it('toggle does not write when value unchanged (setOpen no-op)', () => {
    const { result } = renderHook(() => useInspectorSectionState());
    expect(result.current.isOpen('dimensions')).toBe(true);
    const before = globalThis.localStorage.getItem(STORAGE_KEY);
    act(() => result.current.setOpen('dimensions', true)); // already open
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});
