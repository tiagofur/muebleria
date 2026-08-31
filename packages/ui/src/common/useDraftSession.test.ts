/**
 * useDraftSession tests — sessionStorage-backed draft state.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { clearRegisteredDraftSessions, draftSessionKey, hasDirtyDraftSessions, readDraftSession,
  registerDraftSessionScope, seedEditorDraftFromBaseline, useDraftSession } from './useDraftSession';

afterEach(() => {
  sessionStorage.clear();
  registerDraftSessionScope(() => 'unscoped');
});

describe('useDraftSession', () => {
  it('returns the initial draft when no persisted value exists', () => {
    const { result } = renderHook(() =>
      useDraftSession('test-key', { name: 'init' }),
    );
    expect(result.current[0]).toEqual({ name: 'init' });
    // sessionStorage remains null until setDraft is called
    expect(sessionStorage.getItem('test-key')).toBeNull();
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

  it('setDraft accepts an updater function (Dispatch<SetStateAction>)', () => {
    const { result } = renderHook(() =>
      useDraftSession<{ count: number }>('updater', { count: 0 }),
    );
    act(() => result.current[1]((prev) => ({ count: prev.count + 1 })));
    act(() => result.current[1]((prev) => ({ count: prev.count + 5 })));
    expect(result.current[0]).toEqual({ count: 6 });
    expect(sessionStorage.getItem('updater')).toContain('"count":6');
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

  it('setDraftLocal resets React state without re-persisting after clearDraft (R4-C1)', () => {
    const { result } = renderHook(() =>
      useDraftSession<{ name: string }>('component-draft:c1', {
        name: 'init',
      }),
    );
    // Mid-edit: dirty draft is in session under the entity key.
    act(() => result.current[1]({ name: 'in-progress' }));
    expect(sessionStorage.getItem('component-draft:c1')).toContain(
      'in-progress',
    );

    // forceClose pattern: clear session, then reset React without write.
    act(() => {
      result.current[2](); // clearDraft
      result.current[3]({ name: '' }); // setDraftLocal(empty)
    });

    expect(sessionStorage.getItem('component-draft:c1')).toBeNull();
    expect(result.current[0]).toEqual({ name: '' });

    // Re-open seed path: session absent → seedEditorDraftFromBaseline writes entity.
    const drafts: unknown[] = [];
    const baseline = { name: 'entity-name' };
    seedEditorDraftFromBaseline(
      'component-draft:c1',
      baseline,
      (d) => drafts.push(d),
      () => {},
    );
    expect(drafts).toEqual([baseline]);
  });

  it('setDraft after clear would re-stick empty (documents why setDraftLocal exists)', () => {
    // Regression guard: the OLD forceClose order (setDraft then clearDraft)
    // left a sticky empty under the entity key when setDraft's updater flushed
    // after clear. setDraft alone after clear still writes — callers must use
    // setDraftLocal on close.
    const { result } = renderHook(() =>
      useDraftSession<{ name: string }>('sticky-empty', { name: 'init' }),
    );
    act(() => result.current[1]({ name: 'dirty' }));
    act(() => {
      result.current[2](); // clear
      result.current[1]({ name: '' }); // setDraft (persists) — wrong for close
    });
    expect(sessionStorage.getItem('sticky-empty')).toContain('"name":""');
  });

  it('handles unparseable sessionStorage gracefully (returns initial)', () => {
    sessionStorage.setItem('broken', '{not json');
    const { result } = renderHook(() =>
      useDraftSession('broken', { name: 'fallback' }),
    );
    expect(result.current[0]).toEqual({ name: 'fallback' });
  });

  it.each(['{"name":42}', '[]', 'null'])('rejects incompatible persisted JSON', (stored) => {
    sessionStorage.setItem('invalid-shape', stored);
    expect(renderHook(() => useDraftSession('invalid-shape', { name: 'safe' })).result.current[0]).toEqual({ name: 'safe' });
  });

  it('registers only actual changes as dirty and clears every registered draft', () => {
    const key = draftSessionKey('module', 'module-a');
    const baseline = { name: 'Baseline', dimensions: { width: 600 } };
    const { result, unmount } = renderHook(() => useDraftSession(key, baseline));
    act(() => result.current[1](baseline)); act(() => result.current[1]({ ...baseline, name: 'Tenant A edit' }));
    expect(hasDirtyDraftSessions()).toBe(true);
    clearRegisteredDraftSessions(); expect(sessionStorage.getItem(key)).toBeNull();
    unmount();
    expect(renderHook(() => useDraftSession(key, baseline)).result.current[0]).toEqual(baseline);
  });

  it('isolates the same editor and entity identity by tenant session scope', () => {
    let scope = 'session-a:org-a'; registerDraftSessionScope(() => scope);
    const tenantAKey = draftSessionKey('module', 'same-entity');
    sessionStorage.setItem(tenantAKey, '{"name":"Tenant A"}');
    scope = 'session-b:org-b';
    const tenantBKey = draftSessionKey('module', 'same-entity');
    expect([tenantAKey === tenantBKey, readDraftSession(tenantBKey, { name: '' })]).toEqual([false, null]);
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

  it('reloads from sessionStorage when key changes (no remount)', () => {
    sessionStorage.setItem('module-draft:mod-1', JSON.stringify({ name: 'edited-1' }));
    sessionStorage.setItem('module-draft:mod-2', JSON.stringify({ name: 'edited-2' }));

    const { result, rerender } = renderHook(
      ({ key }) => useDraftSession(key, { name: 'fresh' }),
      { initialProps: { key: 'module-draft:mod-1' } },
    );
    expect(result.current[0]).toEqual({ name: 'edited-1' });

    // Switch to a different entity: hook should reload, not keep the old draft.
    rerender({ key: 'module-draft:mod-2' });
    expect(result.current[0]).toEqual({ name: 'edited-2' });

    // Switch to a key with no persisted value: should use the fresh initial.
    rerender({ key: 'module-draft:mod-3' });
    expect(result.current[0]).toEqual({ name: 'fresh' });
  });
});

describe('seedEditorDraftFromBaseline (R3-C1)', () => {
  it('sets draft + initialDraft when session is empty', () => {
    const drafts: unknown[] = [];
    const initials: unknown[] = [];
    const baseline = { name: 'entity' };
    seedEditorDraftFromBaseline(
      'component-draft:c1',
      baseline,
      (d) => drafts.push(d),
      (d) => initials.push(d),
    );
    expect(drafts).toEqual([baseline]);
    expect(initials).toEqual([baseline]);
  });

  it('does not overwrite draft when session already has a value', () => {
    sessionStorage.setItem(
      'component-draft:c1',
      JSON.stringify({ name: 'session-restored' }),
    );
    const drafts: unknown[] = [];
    const initials: unknown[] = [];
    const baseline = { name: 'entity' };
    seedEditorDraftFromBaseline(
      'component-draft:c1',
      baseline,
      (d) => drafts.push(d),
      (d) => initials.push(d),
    );
    expect(drafts).toEqual([]);
    expect(initials).toEqual([baseline]);
    expect(readDraftSession('component-draft:c1', baseline)).toEqual({
      name: 'session-restored',
    });
  });
});
