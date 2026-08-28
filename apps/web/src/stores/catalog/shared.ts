/**
 * catalog/shared — types + infrastructure shared by every catalog domain
 * slice (F117 split of the former monolithic catalogStore.ts).
 *
 * Domain slices (materials.ts, edges.ts, …) receive a CatalogStoreCtx and
 * return their portion of the zustand state. The public API of the store is
 * unchanged — see catalogStore.ts (combinator + singleton).
 */

import { useWorkspaceStore } from '../workspaceStore';
import { notifyCatalogMutated } from '../../crossTabSync';

import type {
  Agregado,
  AmbientCategory,
  AmbientMaterial,
  Catalog,
  Component,
  Customer,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  ModuleCategory,
  OptionGroup,
  Structure,
} from '@granete/domain';
import {
  type ComponentDraft,
  type CustomerDraft,
  type EdgeDraft,
  type HardwareDraft,
  type MaterialDraft,
  type ModuleDraft,
  type OptionGroupDraft,
  type StructureDraft,
  type CategoryDraft,
  type AmbientMaterialDraft,
} from '@granete/ui';

/**
 * Toast callback signature. catalogStore no longer accepts toast as a dep
 * (F064) — it reads it from uiStore via getUiStoreState().
 */
export type ToastFn = (input: {
  readonly type: 'success' | 'info' | 'warning' | 'error';
  readonly message: string;
}) => void;

export interface CatalogStoreDeps {
  /** Generates UUIDs for new entities. Default: crypto.randomUUID. */
  readonly newId?: () => string;
  /** Persists catalog changes (fire-and-forget OK). */
  readonly saveCatalog: (catalog: Catalog) => Promise<void>;
  /** Reads auth token for media helpers. */
  readonly getAuthToken: () => string | null;
  /** Reads session for hard-delete backend call gate. */
  readonly getSession: () => 'guest' | 'auth' | null;
  /** Reads draft projects count for #138 alert. */
  readonly getDraftProjectsCount: () => number;
  /** Fetch impl for catalog hard-delete (structures, option groups, modules, categories). */
  readonly fetchImpl?: typeof fetch;
  /** Base URL of the backend API. */
  readonly baseUrl: string;
}

export interface CatalogState {
  readonly catalog: Catalog | null;

  // --- Lifecycle ---
  readonly setCatalog: (catalog: Catalog | null) => void;

  // --- Materials ---
  readonly createMaterial: (draft: MaterialDraft) => void;
  readonly updateMaterial: (id: string, draft: MaterialDraft) => void;
  readonly setMaterialActive: (id: string, active: boolean) => void;
  readonly createMaterialCategory: (draft: CategoryDraft) => void;
  readonly updateMaterialCategory: (id: string, draft: CategoryDraft) => void;
  /** Auth: also DELETE /catalog/material-categories/{id}. */
  readonly deleteMaterialCategory: (id: string) => Promise<void>;

  // --- Edges ---
  readonly createEdge: (draft: EdgeDraft) => string;
  readonly updateEdge: (id: string, draft: EdgeDraft) => void;
  readonly setEdgeActive: (id: string, active: boolean) => void;

  // --- Hardware ---
  readonly createHardware: (draft: HardwareDraft) => void;
  readonly updateHardware: (id: string, draft: HardwareDraft) => void;
  readonly setHardwareActive: (id: string, active: boolean) => void;

  // --- Ambient materials (presentation-only: finishes & scene textures) ---
  readonly createAmbientMaterial: (draft: AmbientMaterialDraft) => void;
  readonly updateAmbientMaterial: (id: string, draft: AmbientMaterialDraft) => void;
  readonly setAmbientMaterialActive: (id: string, active: boolean) => void;
  readonly createAmbientCategory: (draft: CategoryDraft) => void;
  readonly updateAmbientCategory: (id: string, draft: CategoryDraft) => void;
  /** Auth: also DELETE /catalog/ambient-categories/{id}. */
  readonly deleteAmbientCategory: (id: string) => Promise<void>;

  // --- Option groups ---
  readonly createOptionGroup: (draft: OptionGroupDraft) => void;
  readonly updateOptionGroup: (id: string, draft: OptionGroupDraft) => void;
  /** Auth: also DELETE /catalog/option-groups/{id} so the row does not reappear on refresh. */
  readonly deleteOptionGroup: (id: string) => Promise<void>;

  // --- Categories ---
  readonly createCategory: (draft: CategoryDraft) => void;
  readonly updateCategory: (id: string, draft: CategoryDraft) => void;
  /** Auth: also DELETE /catalog/categories/{id}. */
  readonly deleteCategory: (id: string) => Promise<void>;

  // --- Modules ---
  readonly createModule: (draft: ModuleDraft) => void;
  readonly updateModule: (id: string, draft: ModuleDraft) => void;
  /** Auth: also DELETE /catalog/modules/{id}. */
  readonly deleteModule: (
    id: string,
    onModuleDeleted?: (id: string) => void,
  ) => Promise<void>;
  readonly duplicateModuleById: (id: string) => void;

  // --- Structures ---
  readonly createStructure: (draft: StructureDraft) => void;
  readonly updateStructure: (id: string, draft: StructureDraft) => void;
  readonly deleteStructure: (id: string) => Promise<void>;
  readonly setStructureActive: (id: string, active: boolean) => void;

  // --- Components ---
  readonly createComponent: (draft: ComponentDraft) => void;
  readonly updateComponent: (id: string, draft: ComponentDraft) => void;
  readonly toggleComponentActive: (id: string) => void;

  // --- Agregados ---
  readonly createAgregado: (item: Agregado) => void;
  readonly updateAgregado: (item: Agregado) => void;
  /** Auth: also DELETE /catalog/agregados/{id}. */
  readonly deleteAgregado: (id: string) => Promise<void>;

  // --- Customers ---
  readonly createCustomer: (
    draft: CustomerDraft,
    actor: { readonly id?: string; readonly role?: string; readonly roles?: readonly (string | null | undefined)[] },
  ) => void;
  readonly updateCustomer: (
    id: string,
    draft: CustomerDraft,
    actor: { readonly role?: string; readonly roles?: readonly (string | null | undefined)[] },
  ) => void;
  readonly setCustomerActive: (id: string, active: boolean) => void;
  /** Cross-store: persists resolved customers from project flows. */
  readonly upsertCustomers: (customers: readonly Customer[]) => void;

  // --- Media ---
  readonly resolveMediaUrl: (url: string | undefined) => string | undefined;
  readonly uploadCatalogImage: (file: File) => Promise<string>;
}

/** Entity payload types re-exported for convenience of the slices. */
export type {
  Agregado,
  AmbientCategory,
  AmbientMaterial,
  Component,
  Customer,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  ModuleCategory,
  OptionGroup,
  Structure,
};

export function defaultNewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function optionalNotes(notes: string): string | undefined {
  const trimmed = notes.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Coerces an ambient PBR form field (`number | ''`) to a domain-safe
 * `number | undefined`, clamped to [0, 1].
 */
export function parsePbr(v: number | '' | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(1, Math.max(0, v))
    : undefined;
}

/**
 * Parses a numeric form field (string or number) → `number | undefined`.
 * For PBR fields (roughness/metalness/clearcoat), clamps to [0, 1].
 */
export function parseDraftNum(
  v: string | number | undefined,
  clamp01 = false,
): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return clamp01 ? Math.min(1, Math.max(0, n)) : n;
}

/**
 * Context handed to every domain slice: zustand setters plus the shared
 * persistence helpers and deps.
 */
export interface CatalogStoreCtx {
  readonly set: (partial: Partial<CatalogState>) => void;
  readonly get: () => CatalogState;
  readonly deps: CatalogStoreDeps;
  readonly toast: ToastFn;
  readonly newId: () => string;

  /**
   * Common patch: compute next catalog from updater, set state, persist.
   * Returns the save promise so callers can toast success only after the
   * server accepts the write (F116 C7).
   */
  patch(updater: (catalog: Catalog) => Catalog): Promise<void>;

  /**
   * patch + success toast only after the save resolves. On failure the error
   * toast is already emitted by patch, so nothing is claimed here.
   */
  saveAndToast(
    updater: (catalog: Catalog) => Catalog,
    message: string | null,
    type?: 'success' | 'info',
  ): void;

  /**
   * Awaits a patch and reports whether the save landed. Use in async actions
   * that follow up with a REST hard-delete: skip the delete when the local
   * save already failed.
   */
  patchSaved(updater: (catalog: Catalog) => Catalog): Promise<boolean>;

  /**
   * Hard-delete on the API when authenticated. Guest mode only needs the
   * local catalog rewrite (saveCatalog is upsert-only and never DELETEs).
   *
   * @returns false when the server delete failed (caller should not claim success).
   */
  hardDeleteOnAuth(path: string): Promise<boolean>;
}

export function makeCatalogStoreCtx(
  set: (partial: Partial<CatalogState>) => void,
  get: () => CatalogState,
  deps: CatalogStoreDeps,
  toast: ToastFn,
): CatalogStoreCtx {
  const saveCatalog = deps.saveCatalog;
  const getAuthToken = deps.getAuthToken;
  const getSession = deps.getSession;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const baseUrl = deps.baseUrl;

  // P1-4 (pre-demo audit): double-clicks fire several patches before the
  // first save finishes; concurrent saveCatalog fan-outs interleave and the
  // upsert POSTs duplicate rows (audit repro: one "Guardar" triple-click
  // created the same customer twice 3 ms apart). Serialize saves per store:
  // a queued save re-reads the latest catalog, so by the time it runs the
  // first save already created the entity and the upsert PUTs instead of
  // POSTing a duplicate.
  let saveInFlight: Promise<void> | null = null;

  function patch(updater: (catalog: Catalog) => Catalog): Promise<void> {
    const prev = get().catalog;
    if (!prev) return Promise.resolve();
    const nextCatalog = updater(prev);
    set({ catalog: nextCatalog });
    const task = (): Promise<void> =>
      saveCatalog(get().catalog ?? nextCatalog).then(
        () => {
          // P0-3 mitigation: tell other tabs their catalog copy is stale.
          notifyCatalogMutated();
        },
        (err: unknown) => {
          console.error('Error al guardar catálogo:', err);
          // F118 S2: no error toasts from saves that raced a logout — the
          // login screen must stay clean.
          if (useWorkspaceStore.getState().session === null) {
            throw err;
          }
          toast({
            type: 'error',
            message: 'Error de conexión al sincronizar cambios',
          });
          // Reject so callers do not toast "guardado" on failed sync.
          throw err;
        },
      );
    if (!saveInFlight) {
      // Idle: start immediately (same timing as the pre-serialization code).
      const run = task();
      // The chain tracker observes the failure (so it never surfaces as an
      // unhandled rejection) and frees the slot once the save settles.
      const tracked = run.catch(() => undefined);
      saveInFlight = tracked;
      void tracked.then(() => {
        if (saveInFlight === tracked) saveInFlight = null;
      });
      return run;
    }
    // Busy: queue after the in-flight save settles; then(task, task) runs the
    // next save on success OR failure — errors must not poison the chain. The
    // queued save re-reads the latest catalog, so the entity the first save
    // created is already there and the upsert PUTs (no duplicate).
    const run = saveInFlight.then(task, task);
    const tracked = run.catch(() => undefined);
    saveInFlight = tracked;
    void tracked.then(() => {
      // An older save must never clear a newer queued tail. Otherwise a
      // mutation arriving while that newer save runs starts concurrently.
      if (saveInFlight === tracked) saveInFlight = null;
    });
    return run;
  }

  function saveAndToast(
    updater: (catalog: Catalog) => Catalog,
    message: string | null,
    type: 'success' | 'info' = 'success',
  ): void {
    void patch(updater).then(
      () => {
        if (message) toast({ type, message });
      },
      () => {
        /* error toast already shown by patch */
      },
    );
  }

  async function patchSaved(
    updater: (catalog: Catalog) => Catalog,
  ): Promise<boolean> {
    try {
      await patch(updater);
      return true;
    } catch {
      return false;
    }
  }

  async function hardDeleteOnAuth(path: string): Promise<boolean> {
    if (getSession() !== 'auth') return true;
    const token = getAuthToken();
    if (!token) return true;
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`Error deleting ${path}: ${res.status} ${text}`);
        toast({
          type: 'error',
          message:
            'Error al eliminar en el servidor (puede reaparecer al recargar)',
        });
        return false;
      }
      return true;
    } catch (err) {
      console.error(`Error deleting ${path}:`, err);
      toast({
        type: 'error',
        message: 'Error de conexión al eliminar',
      });
      return false;
    }
  }

  return {
    set,
    get,
    deps,
    toast,
    newId: deps.newId ?? defaultNewId,
    patch,
    saveAndToast,
    patchSaved,
    hardDeleteOnAuth,
  };
}
