/**
 * uiStore — toasts + exportBusy/errors + createKeys.
 *
 * Sub-slice 4 de 4 de la Fase 0 (Perfect App Roadmap §5.0.1). Migra el state
 * interno de ToastProvider (packages/ui/src/common/Toast.tsx) + el state UI
 * suelto de App.tsx.
 *
 * Invariante: uiStore NO importa de otros stores. Es el más bajo en la
 * jerarquía; catalogStore y projectStore lo leen vía `getUiStoreState()`.
 */

import { create } from 'zustand';

import type { ExportIssue } from '@muebles/domain';

// ---------------------------------------------------------------------------
// Toast types + constants (re-exported for tests + ToastViewport)
// ---------------------------------------------------------------------------

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export type ToastInput = {
  readonly type: ToastType;
  readonly message: string;
};

export type ToastItem = ToastInput & {
  readonly id: string;
};

/** Auto-dismiss duration (design.md §4.4). */
export const TOAST_DURATION_MS = 4000;

/** Exit animation length — matches `--duration-normal` (250ms). */
export const TOAST_EXIT_MS = 250;

/** Maximum simultaneous visible toasts (oldest exits). */
export const TOAST_MAX = 3;

export type ToastPhase = 'enter' | 'visible' | 'exit';

export type InternalToast = ToastItem & {
  readonly phase: ToastPhase;
};

/**
 * `toast(input)` callback signature. Same shape as the legacy useToast()
 * return value — catalogStore and projectStore accept this as a dep until
 * F064 makes them read directly from uiStore.
 */
export type ToastFn = (input: ToastInput) => void;

// ---------------------------------------------------------------------------
// Module-scoped timer maps (equivalent to useRef in ToastProvider)
// ---------------------------------------------------------------------------

const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();
// exitTimers is keyed by handle (so we can clearTimeout by handle on cleanup)
// and stores the toast id as value.
const exitTimers = new Map<ReturnType<typeof setTimeout>, string>();
const enterTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(
  map: Map<string, ReturnType<typeof setTimeout>>,
  id: string,
): void {
  const handle = map.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    map.delete(id);
  }
}

function nextToastId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface UiState {
  // --- Toasts ---
  readonly items: readonly InternalToast[];

  // --- Export UI ---
  readonly exportErrors: readonly ExportIssue[];
  readonly exportBusy: boolean;

  // --- Create keys (force remount of "New" forms) ---
  readonly projectsCreateKey: number;
  readonly modulesCreateKey: number;
  readonly materialsCreateKey: number;

  // --- Toast actions ---
  readonly toast: (input: ToastInput) => void;
  readonly dismiss: (id: string) => void;
  /** Test-only: clears all timers + items. Called in beforeEach. */
  readonly disposeUi: () => void;

  // --- Export UI actions ---
  readonly setExportErrors: (errors: readonly ExportIssue[]) => void;
  readonly setExportBusy: (busy: boolean) => void;

  // --- Create key actions ---
  readonly bumpProjectsCreateKey: () => void;
  readonly bumpModulesCreateKey: () => void;
  readonly bumpMaterialsCreateKey: () => void;
}

function removeFromState(
  state: UiState,
  id: string,
): readonly InternalToast[] {
  return state.items.filter((t) => t.id !== id);
}

export const useUiStore = create<UiState>()((set, get) => {
  /**
   * Remove a toast from state + clear all its timers. Mirrors ToastProvider's
   * `removeToast`.
   */
  function removeToast(id: string): void {
    set((state) => ({ items: removeFromState(state, id) }));
    clearTimer(dismissTimers, id);
    clearTimer(enterTimers, id);
    // exitTimers is keyed by handle, not id; find the matching handle.
    for (const [handle, storedId] of exitTimers.entries()) {
      if (storedId === id) {
        clearTimeout(handle);
        exitTimers.delete(handle);
      }
    }
  }

  /**
   * Begin exit phase: change to phase 'exit', schedule removal after
   * TOAST_EXIT_MS. Mirrors ToastProvider's `beginExit`.
   */
  function beginExit(id: string): void {
    clearTimer(dismissTimers, id);
    clearTimer(enterTimers, id);

    set((state) => {
      const target = state.items.find((t) => t.id === id);
      if (!target || target.phase === 'exit') return state;
      return {
        items: state.items.map((t) =>
          t.id === id ? { ...t, phase: 'exit' as const } : t,
        ),
      };
    });

    // exitTimers is keyed by handle to support lookup at cleanup time.
    // Avoid duplicate exit timers for the same id.
    for (const [, storedId] of exitTimers.entries()) {
      if (storedId === id) return;
    }
    const handle = setTimeout(() => {
      exitTimers.delete(handle);
      removeToast(id);
    }, TOAST_EXIT_MS);
    exitTimers.set(handle, id);
  }

  function scheduleAutoDismiss(id: string): void {
    clearTimer(dismissTimers, id);
    const handle = setTimeout(() => {
      dismissTimers.delete(id);
      beginExit(id);
    }, TOAST_DURATION_MS);
    dismissTimers.set(id, handle);
  }

  return {
    items: [],

    exportErrors: [],
    exportBusy: false,

    projectsCreateKey: 0,
    modulesCreateKey: 0,
    materialsCreateKey: 0,

    toast: (input) => {
      const id = nextToastId();
      const message = input.message.trim();
      if (!message) return;

      set((state) => {
        const overflow = state.items.filter((t) => t.phase !== 'exit');
        // Cap at TOAST_MAX: mark oldest for exit on next macrotask so
        // the CSS exit animation runs.
        if (overflow.length >= TOAST_MAX) {
          const oldest = overflow[0]!;
          setTimeout(() => beginExit(oldest.id), 0);
        }
        return {
          items: [
            ...state.items,
            {
              id,
              type: input.type,
              message,
              phase: 'enter' as const,
            },
          ],
        };
      });

      // Enter → visible on next frame so CSS transition runs.
      const enterHandle = setTimeout(() => {
        enterTimers.delete(id);
        set((state) => ({
          items: state.items.map((t) =>
            t.id === id && t.phase === 'enter'
              ? { ...t, phase: 'visible' as const }
              : t,
          ),
        }));
      }, 16);
      enterTimers.set(id, enterHandle);

      scheduleAutoDismiss(id);
    },

    dismiss: (id) => {
      beginExit(id);
    },

    disposeUi: () => {
      for (const handle of dismissTimers.values()) clearTimeout(handle);
      for (const handle of exitTimers.keys()) clearTimeout(handle);
      for (const handle of enterTimers.values()) clearTimeout(handle);
      dismissTimers.clear();
      exitTimers.clear();
      enterTimers.clear();
      set({
        items: [],
        exportErrors: [],
        exportBusy: false,
        projectsCreateKey: 0,
        modulesCreateKey: 0,
        materialsCreateKey: 0,
      });
    },

    setExportErrors: (errors) => set({ exportErrors: errors }),
    setExportBusy: (busy) => set({ exportBusy: busy }),

    bumpProjectsCreateKey: () =>
      set((state) => ({ projectsCreateKey: state.projectsCreateKey + 1 })),
    bumpModulesCreateKey: () =>
      set((state) => ({ modulesCreateKey: state.modulesCreateKey + 1 })),
    bumpMaterialsCreateKey: () =>
      set((state) => ({ materialsCreateKey: state.materialsCreateKey + 1 })),
  };
});

// ---------------------------------------------------------------------------
// Non-React accessors (for catalogStore / projectStore)
// ---------------------------------------------------------------------------

export function getUiStoreState(): UiState {
  return useUiStore.getState();
}
