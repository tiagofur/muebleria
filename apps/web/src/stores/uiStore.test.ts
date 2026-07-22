/**
 * F064 — uiStore behavioral tests (toasts + export UI + createKeys).
 *
 * Migrated from `packages/ui/src/common/Toast.test.tsx` (deleted in F064).
 * Original tests used jsdom + RTL to render ToastProvider; these tests are
 * node-friendly and exercise the store logic directly (queue, max 3,
 * auto-dismiss, dismiss, exportBusy/errors, createKeys). Rendering coverage
 * is preserved by the Playwright visual smoke (6 screenshots).
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TOAST_DURATION_MS,
  TOAST_EXIT_MS,
  TOAST_MAX,
  useUiStore,
} from './uiStore';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  useUiStore.getState().disposeUi();
});

afterEach(() => {
  useUiStore.getState().disposeUi();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('uiStore — constants', () => {
  it('exports F019 constants', () => {
    expect(TOAST_DURATION_MS).toBe(4000);
    expect(TOAST_EXIT_MS).toBe(250);
    expect(TOAST_MAX).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Toast queue + max
// ---------------------------------------------------------------------------

describe('uiStore — toast queue', () => {
  it('toast() adds item with phase enter', () => {
    useUiStore.getState().toast({ type: 'success', message: 'Hi' });
    const items = useUiStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toBe('Hi');
    expect(items[0]!.type).toBe('success');
    expect(items[0]!.phase).toBe('enter');
  });

  it('ignores empty / whitespace-only messages', () => {
    useUiStore.getState().toast({ type: 'success', message: '   ' });
    useUiStore.getState().toast({ type: 'info', message: '' });
    expect(useUiStore.getState().items).toHaveLength(0);
  });

  it('supports success, info, warning, and error types', () => {
    useUiStore.getState().toast({ type: 'success', message: 'one' });
    useUiStore.getState().toast({ type: 'info', message: 'two' });
    useUiStore.getState().toast({ type: 'warning', message: 'three' });
    useUiStore.getState().toast({ type: 'error', message: 'four' });
    const items = useUiStore.getState().items;
    expect(items.map((i) => i.type)).toEqual([
      'success',
      'info',
      'warning',
      'error',
    ]);
  });

  it('caps at TOAST_MAX non-exiting toasts; oldest exits', () => {
    useUiStore.getState().toast({ type: 'success', message: 'One' });
    useUiStore.getState().toast({ type: 'info', message: 'Two' });
    useUiStore.getState().toast({ type: 'warning', message: 'Three' });
    // 4th triggers overflow: oldest (One) scheduled to beginExit on next macrotask.
    useUiStore.getState().toast({ type: 'error', message: 'Four' });
    // Run the setTimeout(0) that calls beginExit on the oldest.
    vi.advanceTimersByTime(1);
    const items = useUiStore.getState().items;
    const one = items.find((i) => i.message === 'One');
    expect(one?.phase).toBe('exit');
    const four = items.find((i) => i.message === 'Four');
    expect(four?.phase).not.toBe('exit');
  });
});

// ---------------------------------------------------------------------------
// Toast auto-dismiss + dismiss
// ---------------------------------------------------------------------------

describe('uiStore — auto-dismiss + manual dismiss', () => {
  it('auto-dismisses after TOAST_DURATION_MS + TOAST_EXIT_MS', () => {
    useUiStore.getState().toast({ type: 'success', message: 'Bye' });
    expect(useUiStore.getState().items).toHaveLength(1);
    // Auto-dismiss timer fires → beginExit → phase 'exit'.
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    const exiting = useUiStore.getState().items[0]!;
    expect(exiting.phase).toBe('exit');
    // Exit timer fires → removed.
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(useUiStore.getState().items).toHaveLength(0);
  });

  it('dismiss() sets phase exit then removes after exit timer', () => {
    useUiStore.getState().toast({ type: 'info', message: 'X' });
    const id = useUiStore.getState().items[0]!.id;
    useUiStore.getState().dismiss(id);
    expect(useUiStore.getState().items[0]!.phase).toBe('exit');
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(useUiStore.getState().items).toHaveLength(0);
  });

  it('enter → visible after 16ms', () => {
    useUiStore.getState().toast({ type: 'success', message: 'Y' });
    expect(useUiStore.getState().items[0]!.phase).toBe('enter');
    vi.advanceTimersByTime(16);
    expect(useUiStore.getState().items[0]!.phase).toBe('visible');
  });
});

// ---------------------------------------------------------------------------
// Export UI state
// ---------------------------------------------------------------------------

describe('uiStore — export UI state', () => {
  it('setExportBusy toggles', () => {
    expect(useUiStore.getState().exportBusy).toBe(false);
    useUiStore.getState().setExportBusy(true);
    expect(useUiStore.getState().exportBusy).toBe(true);
    useUiStore.getState().setExportBusy(false);
    expect(useUiStore.getState().exportBusy).toBe(false);
  });

  it('setExportErrors replaces array', () => {
    expect(useUiStore.getState().exportErrors).toEqual([]);
    const errors = [
      {
        severity: 'error' as const,
        code: 'VAL-01',
        message: 'Bad dimension',
        moduleId: 'mod-1',
        field: 'lengthMm',
      },
    ];
    useUiStore.getState().setExportErrors(errors);
    expect(useUiStore.getState().exportErrors).toBe(errors);
  });
});

// ---------------------------------------------------------------------------
// Create keys
// ---------------------------------------------------------------------------

describe('uiStore — create keys', () => {
  it('bumpProjectsCreateKey increments', () => {
    const initial = useUiStore.getState().projectsCreateKey;
    useUiStore.getState().bumpProjectsCreateKey();
    useUiStore.getState().bumpProjectsCreateKey();
    expect(useUiStore.getState().projectsCreateKey).toBe(initial + 2);
  });

  it('bumpModulesCreateKey increments', () => {
    const initial = useUiStore.getState().modulesCreateKey;
    useUiStore.getState().bumpModulesCreateKey();
    expect(useUiStore.getState().modulesCreateKey).toBe(initial + 1);
  });

  it('bumpMaterialsCreateKey increments', () => {
    const initial = useUiStore.getState().materialsCreateKey;
    useUiStore.getState().bumpMaterialsCreateKey();
    expect(useUiStore.getState().materialsCreateKey).toBe(initial + 1);
  });
});

// ---------------------------------------------------------------------------
// disposeUi
// ---------------------------------------------------------------------------

describe('uiStore — disposeUi', () => {
  it('clears all state', () => {
    useUiStore.getState().toast({ type: 'success', message: 'A' });
    useUiStore.getState().setExportBusy(true);
    useUiStore.getState().bumpProjectsCreateKey();
    expect(useUiStore.getState().items.length).toBeGreaterThan(0);

    useUiStore.getState().disposeUi();
    expect(useUiStore.getState().items).toHaveLength(0);
    expect(useUiStore.getState().exportBusy).toBe(false);
    expect(useUiStore.getState().projectsCreateKey).toBe(0);
  });
});
