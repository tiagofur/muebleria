/**
 * catalogStore — catálogos + módulos + estructuras + componentes + customers.
 *
 * Sub-slice 2 de 4 de la Fase 0 (Perfect App Roadmap §5.0.1). Migra de App.tsx
 * el slice de catálogo con sus 28 handlers de mutación.
 *
 * Invariante: catalogStore POSEE su catálogo (state `{ catalog }`). workspaceStore
 * dropea `catalog` de su workspace; este store se hidrata en `loadWorkspace()`.
 *
 * Cross-store:
 * - Lee `useWorkspaceStore.getState()` para authToken (media helpers) y para
 *   contar proyectos draft en #138 (updateMaterial).
 * - Expone `upsertCustomers()` para que createProject/updateProject/createFromTemplate
 *   (aún en App.tsx hasta F063) puedan persistir customers desde el flujo de proyecto.
 */

import { create } from 'zustand';

import type {
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
} from '@muebles/domain';
import {
  bumpStructureRevision,
  calcMaterialCostPerM2,
  duplicateModule as deepCopyModule,
  resolveOwnerOnCreate,
  resolveOwnerOnUpdate,
  suggestDuplicateCode,
} from '@muebles/domain';
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
} from '@muebles/ui';

import { draftToComponent, draftToModule, draftToStructure } from './catalogMappers';

/** Toast callback injected from App.tsx (until F064 migrates ToastProvider). */
export type ToastFn = (input: {
  readonly type: 'success' | 'info' | 'warning' | 'error';
  readonly message: string;
}) => void;

export interface CatalogStoreDeps {
  /** Generates UUIDs for new entities. Default: crypto.randomUUID. */
  readonly newId?: () => string;
  /** Persists catalog changes (fire-and-forget OK). */
  readonly saveCatalog: (catalog: Catalog) => Promise<void>;
  /** Toast sink (until F064 uiStore migration). */
  readonly toast: ToastFn;
  /** Reads auth token for media helpers. */
  readonly getAuthToken: () => string | null;
  /** Reads session for deleteStructure backend call gate. */
  readonly getSession: () => 'guest' | 'auth' | null;
  /** Reads draft projects count for #138 alert. */
  readonly getDraftProjectsCount: () => number;
  /** Fetch impl for deleteStructure backend DELETE. */
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

  // --- Edges ---
  readonly createEdge: (draft: EdgeDraft) => string;
  readonly updateEdge: (id: string, draft: EdgeDraft) => void;
  readonly setEdgeActive: (id: string, active: boolean) => void;

  // --- Hardware ---
  readonly createHardware: (draft: HardwareDraft) => void;
  readonly updateHardware: (id: string, draft: HardwareDraft) => void;
  readonly setHardwareActive: (id: string, active: boolean) => void;

  // --- Option groups ---
  readonly createOptionGroup: (draft: OptionGroupDraft) => void;
  readonly updateOptionGroup: (id: string, draft: OptionGroupDraft) => void;
  readonly deleteOptionGroup: (id: string) => void;

  // --- Categories ---
  readonly createCategory: (draft: CategoryDraft) => void;
  readonly updateCategory: (id: string, draft: CategoryDraft) => void;
  readonly deleteCategory: (id: string) => void;

  // --- Modules ---
  readonly createModule: (draft: ModuleDraft) => void;
  readonly updateModule: (id: string, draft: ModuleDraft) => void;
  readonly deleteModule: (id: string, onModuleDeleted?: (id: string) => void) => void;
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

  // --- Customers ---
  readonly createCustomer: (
    draft: CustomerDraft,
    actor: { readonly id?: string; readonly role?: string },
  ) => void;
  readonly updateCustomer: (
    id: string,
    draft: CustomerDraft,
    actor: { readonly role?: string },
  ) => void;
  readonly setCustomerActive: (id: string, active: boolean) => void;
  /** Cross-store: persists resolved customers from project flows. */
  readonly upsertCustomers: (customers: readonly Customer[]) => void;

  // --- Media ---
  readonly resolveMediaUrl: (url: string | undefined) => string | undefined;
  readonly uploadCatalogImage: (file: File) => Promise<string>;
}

interface InternalOptions {
  readonly deps: CatalogStoreDeps;
}

function defaultNewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function optionalNotes(notes: string): string | undefined {
  const trimmed = notes.trim();
  return trimmed ? trimmed : undefined;
}

export function createCatalogStore(options: InternalOptions) {
  const newId = options.deps.newId ?? defaultNewId;
  const saveCatalog = options.deps.saveCatalog;
  const toast = options.deps.toast;
  const getAuthToken = options.deps.getAuthToken;
  const getSession = options.deps.getSession;
  const getDraftProjectsCount = options.deps.getDraftProjectsCount;
  const fetchImpl = options.deps.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.deps.baseUrl;

  /**
   * Common patch: compute next catalog from updater, set state, persist
   * fire-and-forget with toast on failure. Replaces App.tsx `patchCatalog`.
   */
  function patch(
    set: (partial: Partial<CatalogState>) => void,
    get: () => CatalogState,
    updater: (catalog: Catalog) => Catalog,
  ): void {
    const prev = get().catalog;
    if (!prev) return;
    const nextCatalog = updater(prev);
    set({ catalog: nextCatalog });
    saveCatalog(nextCatalog).catch((err) => {
      console.error('Error al guardar catálogo:', err);
      toast({
        type: 'error',
        message: 'Error de conexión al sincronizar cambios',
      });
    });
  }

  return create<CatalogState>()((set, get) => ({
    catalog: null,

    // --- Lifecycle ---
    setCatalog: (catalog) => set({ catalog }),

    // --- Materials ---
    createMaterial: (draft) => {
      const code = draft.code.trim();
      // Domain formula in the shell layer only (issue #14 — UI must not import calc).
      const costPerM2 = calcMaterialCostPerM2(
        draft.widthMm,
        draft.lengthMm,
        draft.boardPrice,
        draft.wastePercent,
      );
      const item: MaterialBoard = {
        id: newId(),
        code,
        name: draft.name.trim(),
        widthMm: draft.widthMm,
        lengthMm: draft.lengthMm,
        thicknessMm: draft.thicknessMm,
        grainDefault: draft.grainDefault,
        boardPrice: draft.boardPrice,
        costPerM2,
        wastePercent: draft.wastePercent,
        defaultEdgeBandId: draft.defaultEdgeBandId || undefined,
        imageUrl: draft.imageUrl?.trim() || undefined,
        previewColor: draft.previewColor?.trim() || undefined,
        previewTextureUrl: draft.previewTextureUrl?.trim() || undefined,
        notes: optionalNotes(draft.notes),
        active: true,
      };
      if (!get().catalog) return;
      patch(set, get, (c) => ({ ...c, materials: [...c.materials, item] }));
      toast({ type: 'success', message: `✓ "${code}" creado` });
    },

    updateMaterial: (id, draft) => {
      const prev = get().catalog?.materials.find((m) => m.id === id);
      const costPerM2 = calcMaterialCostPerM2(
        draft.widthMm,
        draft.lengthMm,
        draft.boardPrice,
        draft.wastePercent,
      );
      const priceChanged =
        prev != null &&
        (prev.boardPrice !== draft.boardPrice ||
          prev.wastePercent !== draft.wastePercent ||
          Math.abs(prev.costPerM2 - costPerM2) > 1e-9);

      patch(set, get, (c) => ({
        ...c,
        materials: c.materials.map((m) =>
          m.id === id
            ? {
                ...m,
                code: draft.code.trim(),
                name: draft.name.trim(),
                widthMm: draft.widthMm,
                lengthMm: draft.lengthMm,
                thicknessMm: draft.thicknessMm,
                grainDefault: draft.grainDefault,
                boardPrice: draft.boardPrice,
                costPerM2,
                wastePercent: draft.wastePercent,
                defaultEdgeBandId: draft.defaultEdgeBandId || undefined,
                imageUrl: draft.imageUrl?.trim() || undefined,
                previewColor: draft.previewColor?.trim() || undefined,
                previewTextureUrl: draft.previewTextureUrl?.trim() || undefined,
                notes: optionalNotes(draft.notes),
              }
            : m,
        ),
      }));
      toast({ type: 'success', message: '✓ Cambios guardados' });

      // #138: warn about draft quotes that may still use previous catalog prices.
      // Pluralization note: "cotización" → "cotizaciones" (no tilde on plural).
      // The legacy App.tsx had a typo "cotizaciónes" — fixed during migration.
      if (priceChanged) {
        const draftCount = getDraftProjectsCount();
        if (draftCount > 0) {
          toast({
            type: 'info',
            message: `Precio de material actualizado. ${draftCount} ${draftCount === 1 ? 'cotización' : 'cotizaciones'} en borrador usarán el nuevo catálogo al recalcular.`,
          });
        }
      }
    },

    setMaterialActive: (id, active) => {
      const target = get().catalog?.materials.find((m) => m.id === id);
      patch(set, get, (c) => ({
        ...c,
        materials: c.materials.map((m) => (m.id === id ? { ...m, active } : m)),
      }));
      if (target) {
        toast({
          type: 'info',
          message: active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`,
        });
      }
    },

    // --- Edges ---
    createEdge: (draft) => {
      const code = draft.code.trim();
      const id = newId();
      const item: EdgeBand = {
        id,
        code,
        name: draft.name.trim(),
        thicknessMm: draft.thicknessMm,
        costPerMl: draft.costPerMl,
        notes: optionalNotes(draft.notes),
        active: true,
      };
      patch(set, get, (c) => ({ ...c, edges: [...c.edges, item] }));
      toast({ type: 'success', message: `✓ "${code}" creado` });
      return id;
    },

    updateEdge: (id, draft) => {
      patch(set, get, (c) => ({
        ...c,
        edges: c.edges.map((e) =>
          e.id === id
            ? {
                ...e,
                code: draft.code.trim(),
                name: draft.name.trim(),
                thicknessMm: draft.thicknessMm,
                costPerMl: draft.costPerMl,
                notes: optionalNotes(draft.notes),
              }
            : e,
        ),
      }));
      toast({ type: 'success', message: '✓ Cambios guardados' });
    },

    setEdgeActive: (id, active) => {
      const target = get().catalog?.edges.find((e) => e.id === id);
      patch(set, get, (c) => ({
        ...c,
        edges: c.edges.map((e) => (e.id === id ? { ...e, active } : e)),
      }));
      if (target) {
        toast({
          type: 'info',
          message: active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`,
        });
      }
    },

    // --- Hardware ---
    createHardware: (draft) => {
      const code = draft.code.trim();
      const item: Hardware = {
        id: newId(),
        code,
        name: draft.name.trim(),
        unit: draft.unit,
        costPerUnit: draft.costPerUnit,
        imageUrl: draft.imageUrl?.trim() || undefined,
        notes: optionalNotes(draft.notes),
        active: true,
      };
      patch(set, get, (c) => ({ ...c, hardware: [...c.hardware, item] }));
      toast({ type: 'success', message: `✓ "${code}" creado` });
    },

    updateHardware: (id, draft) => {
      patch(set, get, (c) => ({
        ...c,
        hardware: c.hardware.map((h) =>
          h.id === id
            ? {
                ...h,
                code: draft.code.trim(),
                name: draft.name.trim(),
                unit: draft.unit,
                costPerUnit: draft.costPerUnit,
                imageUrl: draft.imageUrl?.trim() || undefined,
                notes: optionalNotes(draft.notes),
              }
            : h,
        ),
      }));
      toast({ type: 'success', message: '✓ Cambios guardados' });
    },

    setHardwareActive: (id, active) => {
      const target = get().catalog?.hardware.find((h) => h.id === id);
      patch(set, get, (c) => ({
        ...c,
        hardware: c.hardware.map((h) => (h.id === id ? { ...h, active } : h)),
      }));
      if (target) {
        toast({
          type: 'info',
          message: active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`,
        });
      }
    },

    // --- Option groups ---
    createOptionGroup: (draft) => {
      const code = draft.code.trim();
      const item: OptionGroup = {
        id: newId(),
        code,
        name: draft.name.trim(),
        kind: draft.kind,
        required: draft.required,
        optionIds: [...draft.optionIds],
      };
      patch(set, get, (c) => ({ ...c, optionGroups: [...c.optionGroups, item] }));
      toast({ type: 'success', message: `✓ "${code}" creado` });
    },

    updateOptionGroup: (id, draft) => {
      patch(set, get, (c) => ({
        ...c,
        optionGroups: c.optionGroups.map((g) =>
          g.id === id
            ? {
                ...g,
                code: draft.code.trim(),
                name: draft.name.trim(),
                kind: draft.kind,
                required: draft.required,
                optionIds: [...draft.optionIds],
              }
            : g,
        ),
      }));
      toast({ type: 'success', message: '✓ Cambios guardados' });
    },

    deleteOptionGroup: (id) => {
      patch(set, get, (c) => ({
        ...c,
        optionGroups: c.optionGroups.filter((g) => g.id !== id),
      }));
      toast({ type: 'info', message: 'Grupo de opciones eliminado' });
    },

    // --- Categories ---
    createCategory: (draft) => {
      const item: ModuleCategory = {
        id: newId(),
        name: draft.name.trim(),
        parentId: draft.parentId.trim() || undefined,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      patch(set, get, (c) => ({
        ...c,
        categories: [...(c.categories ?? []), item],
      }));
      toast({ type: 'success', message: `✓ Categoría "${item.name}" creada` });
    },

    updateCategory: (id, draft) => {
      patch(set, get, (cat) => ({
        ...cat,
        categories: (cat.categories ?? []).map((c) =>
          c.id === id
            ? {
                ...c,
                name: draft.name.trim(),
                parentId: draft.parentId.trim() || undefined,
                sortOrder: Number(draft.sortOrder) || 0,
              }
            : c,
        ),
      }));
      toast({ type: 'success', message: '✓ Categoría actualizada' });
    },

    deleteCategory: (id) => {
      const cats = get().catalog?.categories ?? [];
      const hasChildren = cats.some((c) => c.parentId === id);
      if (hasChildren) {
        toast({
          type: 'warning',
          message: 'No se puede eliminar: tiene subcategorías',
        });
        return;
      }
      patch(set, get, (c) => ({
        ...c,
        categories: (c.categories ?? []).filter((cat) => cat.id !== id),
        modules: c.modules.map((m) =>
          m.categoryId === id ? { ...m, categoryId: undefined } : m,
        ),
      }));
      toast({ type: 'info', message: 'Categoría eliminada' });
    },

    // --- Modules ---
    createModule: (draft) => {
      const item = draftToModule(newId(), draft);
      patch(set, get, (c) => ({ ...c, modules: [...c.modules, item] }));
      toast({ type: 'success', message: `✓ "${item.code}" creado` });
    },

    updateModule: (id, draft) => {
      patch(set, get, (c) => ({
        ...c,
        modules: c.modules.map((m) => (m.id === id ? draftToModule(id, draft) : m)),
      }));
      toast({ type: 'success', message: '✓ Cambios guardados' });
    },

    deleteModule: (id, onModuleDeleted) => {
      patch(set, get, (c) => ({
        ...c,
        modules: c.modules.filter((m) => m.id !== id),
      }));
      onModuleDeleted?.(id);
      toast({ type: 'info', message: 'Módulo eliminado' });
    },

    duplicateModuleById: (id) => {
      const source = get().catalog?.modules.find((m) => m.id === id);
      if (!source) return;
      const newCode = suggestDuplicateCode(
        source.code,
        get().catalog?.modules.map((m) => m.code) ?? [],
      );
      const copy = deepCopyModule(source, {
        newId: newId(),
        newCode,
        nextNestedId: newId,
      });
      patch(set, get, (c) => ({ ...c, modules: [...c.modules, copy] }));
      toast({ type: 'success', message: `✓ Duplicado como ${newCode}` });
    },

    // --- Structures ---
    createStructure: (draft) => {
      const item = draftToStructure(newId(), draft);
      patch(set, get, (c) => ({
        ...c,
        structures: [...(c.structures ?? []), item],
      }));
      toast({ type: 'success', message: `✓ "${item.code}" creado` });
    },

    updateStructure: (id, draft) => {
      patch(set, get, (c) => ({
        ...c,
        structures: (c.structures ?? []).map((s) => {
          if (s.id !== id) return s;
          // #108: editing a structure bumps its revision and pushes an immutable
          // snapshot of the previous revision into history. Quotes that already
          // pinned a prior revision keep resolving to the frozen snapshot.
          const { structure } = bumpStructureRevision(
            s,
            draftToStructure(id, draft),
          );
          return structure;
        }),
      }));
      toast({ type: 'success', message: '✓ Cambios guardados' });
    },

    deleteStructure: async (id) => {
      patch(set, get, (c) => ({
        ...c,
        structures: (c.structures ?? []).filter((s) => s.id !== id),
      }));
      if (getSession() === 'auth') {
        const token = getAuthToken();
        if (token) {
          try {
            await fetchImpl(`${baseUrl}/catalog/structures/${id}`, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
            });
          } catch (err) {
            console.error('Error deleting structure from backend:', err);
          }
        }
      }
      toast({ type: 'info', message: 'Estructura eliminada' });
    },

    setStructureActive: (id, active) => {
      patch(set, get, (c) => ({
        ...c,
        structures: (c.structures ?? []).map((s) =>
          s.id === id ? { ...s, active } : s,
        ),
      }));
      toast({
        type: 'info',
        message: active ? 'Estructura activada' : 'Estructura desactivada',
      });
    },

    // --- Components ---
    createComponent: (draft) => {
      const item = draftToComponent(newId(), draft);
      patch(set, get, (c) => ({
        ...c,
        components: [...(c.components ?? []), item],
      }));
      toast({ type: 'success', message: `✓ "${item.code}" creado` });
    },

    updateComponent: (id, draft) => {
      patch(set, get, (c) => ({
        ...c,
        components: (c.components ?? []).map((comp) =>
          comp.id === id ? draftToComponent(id, draft) : comp,
        ),
      }));
      toast({ type: 'success', message: '✓ Cambios guardados' });
    },

    toggleComponentActive: (id) => {
      patch(set, get, (c) => ({
        ...c,
        components: (c.components ?? []).map((comp) =>
          comp.id === id ? { ...comp, active: !comp.active } : comp,
        ),
      }));
    },

    // --- Customers ---
    createCustomer: (draft, actor) => {
      const ownerUserId = resolveOwnerOnCreate(
        actor.id,
        actor.role,
        draft.ownerUserId,
      );
      const item: Customer = {
        id: newId(),
        name: draft.name.trim(),
        email: draft.email.trim() || undefined,
        phone: draft.phone.trim() || undefined,
        address: draft.address.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        active: true,
        ownerUserId,
      };
      patch(set, get, (c) => ({
        ...c,
        customers: [...(c.customers ?? []), item],
      }));
      toast({ type: 'success', message: `✓ Cliente "${item.name}" creado` });
    },

    updateCustomer: (id, draft, actor) => {
      const existing = get().catalog?.customers?.find((c) => c.id === id);
      const ownerUserId = resolveOwnerOnUpdate(
        actor.role,
        existing?.ownerUserId,
        draft.ownerUserId,
      );
      patch(set, get, (cat) => ({
        ...cat,
        customers: (cat.customers ?? []).map((c) =>
          c.id === id
            ? {
                ...c,
                name: draft.name.trim(),
                email: draft.email.trim() || undefined,
                phone: draft.phone.trim() || undefined,
                address: draft.address.trim() || undefined,
                notes: draft.notes.trim() || undefined,
                ownerUserId,
              }
            : c,
        ),
      }));
      toast({ type: 'success', message: '✓ Cambios guardados' });
    },

    setCustomerActive: (id, active) => {
      const target = get().catalog?.customers?.find((c) => c.id === id);
      patch(set, get, (cat) => ({
        ...cat,
        customers: (cat.customers ?? []).map((c) =>
          c.id === id ? { ...c, active } : c,
        ),
      }));
      if (target) {
        toast({
          type: 'info',
          message: active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`,
        });
      }
    },

    upsertCustomers: (customers) => {
      patch(set, get, (c) => ({ ...c, customers: [...customers] }));
    },

    // --- Media ---
    resolveMediaUrl: (url) => {
      if (!url) return undefined;
      if (url.startsWith('http') || url.startsWith('blob:')) return url;
      const token = getAuthToken() ?? '';
      const abs = url.startsWith('/api/')
        ? `${baseUrl.replace(/\/api\/?$/, '')}${url}`
        : url;
      return token
        ? `${abs}${abs.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
        : abs;
    },

    uploadCatalogImage: async (file) => {
      const token = getAuthToken();
      if (!token) throw new Error('no auth');
      const form = new FormData();
      form.append('file', file);
      const res = await fetchImpl(`${baseUrl}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        throw new Error(`upload ${res.status}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error('no url');
      return data.url;
    },
  }));
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
    String(deps.toast),
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
