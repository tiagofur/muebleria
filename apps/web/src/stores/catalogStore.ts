/**
 * catalogStore — combinator + singleton for the catalog zustand store.
 *
 * F117 split: the implementation lives in stores/catalog/ — one file per
 * domain (materials, edges, hardware, ambient, optionGroups, entities,
 * customers, media) around the shared persistence helpers (patch /
 * saveAndToast / patchSaved / hardDeleteOnAuth, F116 C7). The public API of
 * this module is unchanged, so consumers (App.tsx, projectStore, tests)
 * keep importing from './catalogStore'.
 *
 * Invariante: catalogStore POSEE su catálogo (state `{ catalog }`). workspaceStore
 * dropea `catalog` de su workspace; este store se hidrata en `loadWorkspace()`.
 */

import { create } from 'zustand';

import { getUiStoreState } from './uiStore';
import {
  type CatalogState,
  type CatalogStoreCtx,
  type CatalogStoreDeps,
  type ToastFn,
  makeCatalogStoreCtx,
} from './catalog/shared';
import { createMaterialsActions } from './catalog/materials';
import { createEdgesActions } from './catalog/edges';
import { createHardwareActions } from './catalog/hardware';
import { createAmbientActions } from './catalog/ambient';
import { createOptionGroupsActions } from './catalog/optionGroups';
import { createEntitiesActions } from './catalog/entities';
import { createCustomersActions } from './catalog/customers';
import { createMediaActions } from './catalog/media';

export type { CatalogState, CatalogStoreDeps, ToastFn };

export function createCatalogStore(options: {
  readonly deps: CatalogStoreDeps;
}) {
  // F064: toast comes from uiStore (single source of truth). Reading fresh
  // each call avoids stale closures across re-renders.
  const toast: ToastFn = (input) => getUiStoreState().toast(input);

  return create<CatalogState>()((set, get) => {
    const ctx: CatalogStoreCtx = makeCatalogStoreCtx(set, get, options.deps, toast);
    return {
      catalog: null,

      // --- Lifecycle ---
      setCatalog: (catalog) => set({ catalog }),

      ...createMaterialsActions(ctx),
      ...createEdgesActions(ctx),
      ...createHardwareActions(ctx),
      ...createAmbientActions(ctx),
      ...createOptionGroupsActions(ctx),
      ...createEntitiesActions(ctx),
      ...createCustomersActions(ctx),
      ...createMediaActions(ctx),
    };
  });
}

/**
 * Default singleton — production wiring. App.tsx calls `ensureCatalogStore(deps)`
 * in the component body (NOT in a useEffect — effects run after first render
 * and hooks would crash on the very first paint). Idempotent: subsequent calls
 * with the same deps are no-ops; with different deps they re-create the store.
 *
 * Tests should use `createCatalogStore({ deps: {...} })` directly.
 */
let _singleton: ReturnType<typeof createCatalogStore> | null = null;
let _lastDepsKey: string | null = null;

function depsKey(deps: CatalogStoreDeps): string {
  // Identity-based key: re-init only when the actual dep functions change.
  // We compare function identities + baseUrl string. Cheap and correct enough
  // (App.tsx memoizes these so they stay stable across renders).
  return [
    deps.baseUrl,
    String(deps.saveCatalog),
    String(deps.getAuthToken),
    String(deps.getSession),
    String(deps.getDraftProjectsCount),
  ].join('|');
}

export function ensureCatalogStore(deps: CatalogStoreDeps): void {
  const key = depsKey(deps);
  if (_singleton && key === _lastDepsKey) return;
  _singleton = createCatalogStore({ deps });
  _lastDepsKey = key;
}

/**
 * React hook for the singleton catalog store. Same API as Zustand's `useStore`:
 * `useCatalogStore()` returns full state; `useCatalogStore(s => s.catalog)` is
 * a selector. Throws if `ensureCatalogStore()` hasn't been called yet.
 */
export function useCatalogStore<T = CatalogState>(
  selector: (s: CatalogState) => T = identitySelector as (s: CatalogState) => T,
): T {
  if (!_singleton) {
    throw new Error(
      'catalogStore not initialized — call ensureCatalogStore(deps) first',
    );
  }
  return _singleton(selector);
}

function identitySelector<T>(s: T): T {
  return s;
}

/** Direct access to the store (for non-React code paths). */
export function getCatalogStoreState(): CatalogState {
  if (!_singleton) {
    throw new Error(
      'catalogStore not initialized — call ensureCatalogStore(deps) first',
    );
  }
  return _singleton.getState();
}

/**
 * F118 S2: clear catalog data when the session ends — the module singleton
 * would otherwise keep the previous user's catalog behind the login screen.
 * No-op when not initialized yet.
 */
export function resetCatalogStore(): void {
  if (!_singleton) return;
  _singleton.getState().setCatalog(null);
}
