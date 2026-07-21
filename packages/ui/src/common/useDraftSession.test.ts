/**
 * useDraftSession tests — sessionStorage-backed draft state.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftSession } from './useDraftSession';

afterEach(() => {
  sessionStorage.clear();
});

describe('useDraftSession', () => {
  it('returns the initial draft when no persisted value exists', () => {
    const { result } = renderHook(() =>
      useDraftSession('test-key', { name: 'init' }),
    );
    expect(result.current[0]).toEqual({ name: 'init' });
    // And seeds sessionStorage for next time.
    expect(sessionStorage.getItem('test-key')).toContain('"name":"init"');
  });

  it('restores from sessionStorage on next mount', () => {
    sessionStorage.setItem('persisted', JSON.stringify({ name: 'saved' }));
    const { result } = renderHook(() =>
      useDraftSession('persisted', { name: 'init' }),
    );
    expect(result.current[0]).toEqual({ name: 'saved' });
  });

  it('setDraft updates state and sessionStorage', () => {
    const { result } = renderHook(() =>
      useDraftSession<{ name: string }>('write', { name: 'init' }),
    );
    act(() => result.current[1]({ name: 'changed' }));
    expect(result.current[0]).toEqual({ name: 'changed' });
    expect(sessionStorage.getItem('write')).toContain('"name":"changed"');
  });

  it('clearDraft removes the key from sessionStorage (state untouched)', () => {
    const { result } = renderHook(() =>
      useDraftSession<{ name: string }>('clear', { name: 'init' }),
    );
    act(() => result.current[1]({ name: 'dirty' }));
    act(() => result.current[2]());
    expect(sessionStorage.getItem('clear')).toBeNull();
    // State value is left as-is; the caller decides whether to reset.
    expect(result.current[0]).toEqual({ name: 'dirty' });
  });

  it('handles unparseable sessionStorage gracefully (returns initial)', () => {
    sessionStorage.setItem('broken', '{not json');
    const { result } = renderHook(() =>
      useDraftSession('broken', { name: 'fallback' }),
    );
    expect(result.current[0]).toEqual({ name: 'fallback' });
  });

  it('survives sessionStorage being unavailable (private mode)', () => {
    // Temporarily make sessionStorage throw.
    const original = window.sessionStorage;
    const failing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    Object.defineProperty(window, 'sessionStorage', {
      value: failing,
      configurable: true,
    });

    const { result } = renderHook(() =>
      useDraftSession('private', { name: 'init' }),
    );
    expect(result.current[0]).toEqual({ name: 'init' });
    act(() => result.current[1]({ name: 'changed' }));
    // State still updates in memory.
    expect(result.current[0]).toEqual({ name: 'changed' });

    Object.defineProperty(window, 'sessionStorage', {
      value: original,
      configurable: true,
    });
  });
});
