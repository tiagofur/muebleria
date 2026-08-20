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
  Agregado,
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
  AmbientMaterial,
  AmbientCategory,
} from '@muebles/domain';
import {
  bumpStructureRevision,
  calcMaterialCostPerM2,
  duplicateModule as deepCopyModule,
  normalizePreviewColor,
  normalizeHardwarePartFinishes,
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
  type AmbientMaterialDraft,
} from '@muebles/ui';

import { draftToComponent, draftToModule, draftToStructure } from './catalogMappers';
import { getUiStoreState } from './uiStore';

/**
 * Toast callback signature. catalogStore no longer accepts toast as a dep
 * (F064) — it reads it from uiStore via getUiStoreState(). Kept exported for
 * projectStore + App.tsx wiring compatibility.
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

/**
 * Coerces an ambient PBR form field (`number | ''`) to a domain-safe
 * `number | undefined`, clamped to [0, 1]. Mirrors MaterialsCatalog.parsePbr
 * so the store never persists empty-string or out-of-range values.
 */
function parsePbr(v: number | '' | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(1, Math.max(0, v))
    : undefined;
}

/**
 * Normalized 3D finish fields (color + PBR) shared by material create/update.
 * The color is only persisted when `normalizePreviewColor` accepts it, so an
 * invalid hex never survives into the catalog raw (F116 C5), and PBR values
 * are clamped the same way ambient materials do it (F116 C1).
 */
function materialPreviewFinishFields(
  draft: MaterialDraft,
): Pick<
  MaterialBoard,
  'previewColor' | 'previewRoughness' | 'previewMetalness' | 'previewClearcoat'
> {
  const previewColor = normalizePreviewColor(draft.previewColor);
  const roughness = parsePbr(draft.previewRoughness);
  const metalness = parsePbr(draft.previewMetalness);
  const clearcoat = parsePbr(draft.previewClearcoat);
  return {
    ...(previewColor ? { previewColor } : {}),
    ...(roughness !== undefined ? { previewRoughness: roughness } : {}),
    ...(metalness !== undefined ? { previewMetalness: metalness } : {}),
    ...(clearcoat !== undefined ? { previewClearcoat: clearcoat } : {}),
  };
}

/**
 * Parses a numeric form field (string or number) → `number | undefined`.
 * For PBR fields (roughness/metalness/clearcoat), clamps to [0, 1].
 */
function parseDraftNum(
  v: string | number | undefined,
  clamp01 = false,
): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return clamp01 ? Math.min(1, Math.max(0, n)) : n;
}

const HARDWARE_SHAPES = ['knob', 'bar-pull', 'cup-pull', 'hinge', 'slide', 'rail', 'leg'];

/**
 * Extracts 3D preview fields from a HardwareDraft into a partial Hardware
 * object that can be spread into create/update. F069.
 */
function hardwarePreviewFields(
  draft: HardwareDraft,
): Pick<Hardware,
  | 'previewShape'
  | 'previewColor'
  | 'previewSizeMm'
  | 'previewDiameterMm'
  | 'previewProjectionMm'
  | 'previewRoughness'
  | 'previewMetalness'
  | 'previewClearcoat'
  | 'partFinishes'
> {
  const shape = HARDWARE_SHAPES.includes(draft.previewShape)
    ? (draft.previewShape as Hardware['previewShape'])
    : undefined;
  const color = draft.previewColor?.trim() || undefined;
  const partFinishes = normalizeHardwarePartFinishes({
    body: draft.partFinishes?.body || undefined,
    base: draft.partFinishes?.base || undefined,
    grip: draft.partFinishes?.grip || undefined,
  });
  return {
    ...(shape ? { previewShape: shape } : {}),
    ...(color ? { previewColor: color } : {}),
    ...(draft.previewSizeMm ? { previewSizeMm: parseDraftNum(draft.previewSizeMm) } : {}),
    ...(draft.previewDiameterMm ? { previewDiameterMm: parseDraftNum(draft.previewDiameterMm) } : {}),
    ...(draft.previewProjectionMm ? { previewProjectionMm: parseDraftNum(draft.previewProjectionMm) } : {}),
    ...(draft.previewRoughness ? { previewRoughness: parseDraftNum(draft.previewRoughness, true) } : {}),
    ...(draft.previewMetalness ? { previewMetalness: parseDraftNum(draft.previewMetalness, true) } : {}),
    ...(draft.previewClearcoat ? { previewClearcoat: parseDraftNum(draft.previewClearcoat, true) } : {}),
    ...(partFinishes ? { partFinishes } : {}),
  };
}

export function createCatalogStore(options: InternalOptions) {
  const newId = options.deps.newId ?? defaultNewId;
  const saveCatalog = options.deps.saveCatalog;
  // F064: toast comes from uiStore (single source of truth). Reading fresh
  // each call avoids stale closures across re-renders.
  const toast: ToastFn = (input) => getUiStoreState().toast(input);
  const getAuthToken = options.deps.getAuthToken;
  const getSession = options.deps.getSession;
  const getDraftProjectsCount = options.deps.getDraftProjectsCount;
  const fetchImpl = options.deps.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.deps.baseUrl;

  /**
   * Common patch: compute next catalog from updater, set state, persist.
   * Returns the save promise so callers can toast success only after the
   * server accepts the write (avoids "guardado" when tiles never hit DB).
   */
  function patch(
    set: (partial: Partial<CatalogState>) => void,
    get: () => CatalogState,
    updater: (catalog: Catalog) => Catalog,
  ): Promise<void> {
    const prev = get().catalog;
    if (!prev) return Promise.resolve();
    const nextCatalog = updater(prev);
    set({ catalog: nextCatalog });
    return saveCatalog(nextCatalog).then(
      () => undefined,
      (err: unknown) => {
        console.error('Error al guardar catálogo:', err);
        toast({
          type: 'error',
          message: 'Error de conexión al sincronizar cambios',
        });
        // Reject so callers do not toast "guardado" on failed sync.
        return Promise.reject(err);
      },
    );
  }

  /**
   * patch + success toast only after the save resolves (F116 C7). On failure
   * the error toast is already emitted by patch, so nothing is claimed here.
   */
  function saveAndToast(
    set: (partial: Partial<CatalogState>) => void,
    get: () => CatalogState,
    updater: (catalog: Catalog) => Catalog,
    message: string | null,
    type: 'success' | 'info' = 'success',
  ): void {
    void patch(set, get, updater).then(
      () => {
        if (message) toast({ type, message });
      },
      () => {
        /* error toast already shown by patch */
      },
    );
  }

  /**
   * Awaits a patch and reports whether the save landed (F116 C7). Use in async
   * actions that follow up with a REST hard-delete: skip the delete when the
   * local save already failed.
   */
  async function patchSaved(
    set: (partial: Partial<CatalogState>) => void,
    get: () => CatalogState,
    updater: (catalog: Catalog) => Catalog,
  ): Promise<boolean> {
    try {
      await patch(set, get, updater);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hard-delete on the API when authenticated. Guest mode only needs the local
   * catalog rewrite (saveCatalog); saveCatalog is upsert-only and never DELETEs
   * missing rows, so auth deletes must hit the REST endpoint or the entity
   * reappears after refresh.
   *
   * @returns false when the server delete failed (caller should not claim success).
   */
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
        previewTextureUrl: draft.previewTextureUrl?.trim() || undefined,
        previewTextureTileWidthMm:
          draft.previewTextureTileWidthMm && draft.previewTextureTileWidthMm > 0
            ? draft.previewTextureTileWidthMm
            : undefined,
        previewTextureTileLengthMm:
          draft.previewTextureTileLengthMm &&
          draft.previewTextureTileLengthMm > 0
            ? draft.previewTextureTileLengthMm
            : undefined,
        notes: optionalNotes(draft.notes),
        ...materialPreviewFinishFields(draft),
        active: true,
      };
      if (!get().catalog) return;
      void patch(set, get, (c) => ({
        ...c,
        materials: [...c.materials, item],
      })).then(
        () => {
          toast({ type: 'success', message: `✓ "${code}" creado` });
        },
        () => {
          /* error toast already shown by patch */
        },
      );
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

      const tileW =
        draft.previewTextureTileWidthMm && draft.previewTextureTileWidthMm > 0
          ? draft.previewTextureTileWidthMm
          : undefined;
      const tileL =
        draft.previewTextureTileLengthMm &&
        draft.previewTextureTileLengthMm > 0
          ? draft.previewTextureTileLengthMm
          : undefined;

      void patch(set, get, (c) => ({
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
                previewTextureUrl: draft.previewTextureUrl?.trim() || undefined,
                previewTextureTileWidthMm: tileW,
                previewTextureTileLengthMm: tileL,
                notes: optionalNotes(draft.notes),
                ...materialPreviewFinishFields(draft),
              }
            : m,
        ),
      })).then(
        () => {
          toast({ type: 'success', message: '✓ Cambios guardados' });

          // #138: warn about draft quotes that may still use previous catalog prices.
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
        () => {
          /* error toast already shown by patch */
        },
      );
    },

    setMaterialActive: (id, active) => {
      const target = get().catalog?.materials.find((m) => m.id === id);
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          materials: c.materials.map((m) => (m.id === id ? { ...m, active } : m)),
        }),
        target
          ? active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`
          : null,
        'info',
      );
    },

    // --- Edges ---
    createEdge: (draft) => {
      const code = draft.code.trim();
      const previewColor = normalizePreviewColor(draft.previewColor);
      const id = newId();
      const item: EdgeBand = {
        id,
        code,
        name: draft.name.trim(),
        thicknessMm: draft.thicknessMm,
        costPerMl: draft.costPerMl,
        notes: optionalNotes(draft.notes),
        ...(previewColor ? { previewColor } : {}),
        active: true,
      };
      saveAndToast(
        set,
        get,
        (c) => ({ ...c, edges: [...c.edges, item] }),
        `✓ "${code}" creado`,
      );
      return id;
    },

    updateEdge: (id, draft) => {
      const previewColor = normalizePreviewColor(draft.previewColor);
      saveAndToast(
        set,
        get,
        (c) => ({
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
                  previewColor,
                }
              : e,
          ),
        }),
        '✓ Cambios guardados',
      );
    },

    setEdgeActive: (id, active) => {
      const target = get().catalog?.edges.find((e) => e.id === id);
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          edges: c.edges.map((e) => (e.id === id ? { ...e, active } : e)),
        }),
        target
          ? active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`
          : null,
        'info',
      );
    },

    // --- Hardware ---
    createHardware: (draft) => {
      const code = draft.code.trim();
      const pkg = Number(draft.packageSize);
      const packageSize =
        Number.isFinite(pkg) && pkg > 0 ? pkg : undefined;
      const item: Hardware = {
        id: newId(),
        code,
        name: draft.name.trim(),
        unit: draft.unit,
        costPerUnit: draft.costPerUnit,
        ...(packageSize === undefined ? {} : { packageSize }),
        imageUrl: draft.imageUrl?.trim() || undefined,
        notes: optionalNotes(draft.notes),
        active: true,
        ...hardwarePreviewFields(draft),
      };
      saveAndToast(
        set,
        get,
        (c) => ({ ...c, hardware: [...c.hardware, item] }),
        `✓ "${code}" creado`,
      );
    },

    updateHardware: (id, draft) => {
      const pkg = Number(draft.packageSize);
      const packageSize =
        Number.isFinite(pkg) && pkg > 0 ? pkg : undefined;
      saveAndToast(
        set,
        get,
        (c) => ({
        ...c,
        hardware: c.hardware.map((h) => {
          if (h.id !== id) return h;
          const {
            packageSize: _drop,
            previewShape: _ds,
            previewColor: _dc,
            previewSizeMm: _dsm,
            previewDiameterMm: _ddm,
            previewProjectionMm: _dpm,
            previewRoughness: _dr,
            previewMetalness: _dm,
            previewClearcoat: _dcl,
            partFinishes: _dpf,
            ...rest
          } = h;
          return {
            ...rest,
            code: draft.code.trim(),
            name: draft.name.trim(),
            unit: draft.unit,
            costPerUnit: draft.costPerUnit,
            ...(packageSize === undefined ? {} : { packageSize }),
            imageUrl: draft.imageUrl?.trim() || undefined,
            notes: optionalNotes(draft.notes),
            ...hardwarePreviewFields(draft),
          };
        }),
      }),
        '✓ Cambios guardados',
      );
    },

    setHardwareActive: (id, active) => {
      const target = get().catalog?.hardware.find((h) => h.id === id);
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          hardware: c.hardware.map((h) => (h.id === id ? { ...h, active } : h)),
        }),
        target
          ? active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`
          : null,
        'info',
      );
    },

    // --- Ambient materials (presentation-only: finishes & scene textures) ---
    createAmbientMaterial: (draft) => {
      const code = draft.code.trim();
      // Coerce form `number | ''` → `number | undefined`, clamped to [0,1].
      // Mirrors MaterialsCatalog.parsePbr; domain type stays `number | undefined`.
      const roughness = parsePbr(draft.previewRoughness);
      const metalness = parsePbr(draft.previewMetalness);
      const clearcoat = parsePbr(draft.previewClearcoat);
      const item: AmbientMaterial = {
        id: newId(),
        code,
        name: draft.name.trim(),
        active: true,
        surfaceType: draft.surfaceType,
        ...(draft.categoryId?.trim()
          ? { categoryId: draft.categoryId.trim() }
          : {}),
        ...(draft.previewColor?.trim()
          ? { previewColor: draft.previewColor.trim() }
          : {}),
        ...(draft.previewTextureUrl?.trim()
          ? { previewTextureUrl: draft.previewTextureUrl.trim() }
          : {}),
        ...(draft.previewTextureTileWidthMm && draft.previewTextureTileWidthMm > 0
          ? { previewTextureTileWidthMm: draft.previewTextureTileWidthMm }
          : {}),
        ...(draft.previewTextureTileLengthMm &&
        draft.previewTextureTileLengthMm > 0
          ? { previewTextureTileLengthMm: draft.previewTextureTileLengthMm }
          : {}),
        ...(roughness !== undefined ? { previewRoughness: roughness } : {}),
        ...(metalness !== undefined ? { previewMetalness: metalness } : {}),
        ...(clearcoat !== undefined ? { previewClearcoat: clearcoat } : {}),
      };
      if (!get().catalog) return;
      void patch(set, get, (c) => ({
        ...c,
        ambientMaterials: [...(c.ambientMaterials ?? []), item],
      })).then(
        () => {
          toast({ type: 'success', message: `✓ "${code}" creado` });
        },
        () => {
          /* error toast already shown by patch */
        },
      );
    },

    updateAmbientMaterial: (id, draft) => {
      // Coerce form `number | ''` → `number | undefined`, clamped to [0,1].
      const roughness = parsePbr(draft.previewRoughness);
      const metalness = parsePbr(draft.previewMetalness);
      const clearcoat = parsePbr(draft.previewClearcoat);
      void patch(set, get, (c) => ({
        ...c,
        ambientMaterials: (c.ambientMaterials ?? []).map((m) =>
          m.id === id
            ? {
                ...m,
                code: draft.code.trim(),
                name: draft.name.trim(),
                surfaceType: draft.surfaceType,
                categoryId: draft.categoryId?.trim() || undefined,
                ...(draft.previewColor?.trim()
                  ? { previewColor: draft.previewColor.trim() }
                  : {}),
                ...(draft.previewTextureUrl?.trim()
                  ? { previewTextureUrl: draft.previewTextureUrl.trim() }
                  : {}),
                ...(draft.previewTextureTileWidthMm &&
                draft.previewTextureTileWidthMm > 0
                  ? { previewTextureTileWidthMm: draft.previewTextureTileWidthMm }
                  : {}),
                ...(draft.previewTextureTileLengthMm &&
                draft.previewTextureTileLengthMm > 0
                  ? { previewTextureTileLengthMm: draft.previewTextureTileLengthMm }
                  : {}),
                ...(roughness !== undefined
                  ? { previewRoughness: roughness }
                  : {}),
                ...(metalness !== undefined
                  ? { previewMetalness: metalness }
                  : {}),
                ...(clearcoat !== undefined
                  ? { previewClearcoat: clearcoat }
                  : {}),
              }
            : m,
        ),
      })).then(
        () => {
          toast({ type: 'success', message: '✓ Cambios guardados' });
        },
        () => {
          /* error toast already shown by patch */
        },
      );
    },

    setAmbientMaterialActive: (id, active) => {
      const target = get().catalog?.ambientMaterials?.find((m) => m.id === id);
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          ambientMaterials: (c.ambientMaterials ?? []).map((m) =>
            m.id === id ? { ...m, active } : m,
          ),
        }),
        target
          ? active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`
          : null,
        'info',
      );
    },

    createAmbientCategory: (draft) => {
      const item: AmbientCategory = {
        id: newId(),
        name: draft.name.trim(),
        parentId: draft.parentId.trim() || undefined,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          ambientCategories: [...(c.ambientCategories ?? []), item],
        }),
        `✓ Categoría "${item.name}" creada`,
      );
    },

    updateAmbientCategory: (id, draft) => {
      saveAndToast(
        set,
        get,
        (cat) => ({
          ...cat,
          ambientCategories: (cat.ambientCategories ?? []).map((c) =>
            c.id === id
              ? {
                  ...c,
                  name: draft.name.trim(),
                  parentId: draft.parentId.trim() || undefined,
                  sortOrder: Number(draft.sortOrder) || 0,
                }
              : c,
          ),
        }),
        'Categoría actualizada',
      );
    },

    deleteAmbientCategory: async (id) => {
      const cats = get().catalog?.ambientCategories ?? [];
      const hasChildren = cats.some((c) => c.parentId === id);
      if (hasChildren) {
        toast({
          type: 'warning',
          message: 'No se puede eliminar: tiene subcategorías',
        });
        return;
      }
      const saved = await patchSaved(set, get, (c) => ({
        ...c,
        ambientCategories: (c.ambientCategories ?? []).filter((cat) => cat.id !== id),
        ambientMaterials: (c.ambientMaterials ?? []).map((m) =>
          m.categoryId === id ? { ...m, categoryId: undefined } : m,
        ),
      }));
      if (!saved) return;
      const ok = await hardDeleteOnAuth(`/catalog/ambient-categories/${id}`);
      if (ok) {
        toast({ type: 'info', message: 'Categoría eliminada' });
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
      saveAndToast(
        set,
        get,
        (c) => ({ ...c, optionGroups: [...c.optionGroups, item] }),
        `✓ "${code}" creado`,
      );
    },

    updateOptionGroup: (id, draft) => {
      saveAndToast(
        set,
        get,
        (c) => ({
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
        }),
        '✓ Cambios guardados',
      );
    },

    deleteOptionGroup: async (id) => {
      const saved = await patchSaved(set, get, (c) => ({
        ...c,
        optionGroups: c.optionGroups.filter((g) => g.id !== id),
      }));
      if (!saved) return;
      const ok = await hardDeleteOnAuth(`/catalog/option-groups/${id}`);
      if (ok) {
        toast({ type: 'info', message: 'Grupo de opciones eliminado' });
      }
    },

    // --- Categories ---
    createCategory: (draft) => {
      const item: ModuleCategory = {
        id: newId(),
        name: draft.name.trim(),
        parentId: draft.parentId.trim() || undefined,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          categories: [...(c.categories ?? []), item],
        }),
        `✓ Categoría "${item.name}" creada`,
      );
    },

    updateCategory: (id, draft) => {
      saveAndToast(
        set,
        get,
        (cat) => ({
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
        }),
        'Categoría actualizada',
      );
    },

    deleteCategory: async (id) => {
      const cats = get().catalog?.categories ?? [];
      const hasChildren = cats.some((c) => c.parentId === id);
      if (hasChildren) {
        toast({
          type: 'warning',
          message: 'No se puede eliminar: tiene subcategorías',
        });
        return;
      }
      const saved = await patchSaved(set, get, (c) => ({
        ...c,
        categories: (c.categories ?? []).filter((cat) => cat.id !== id),
        modules: c.modules.map((m) =>
          m.categoryId === id ? { ...m, categoryId: undefined } : m,
        ),
      }));
      if (!saved) return;
      const ok = await hardDeleteOnAuth(`/catalog/categories/${id}`);
      if (ok) {
        toast({ type: 'info', message: 'Categoría eliminada' });
      }
    },

    // --- Modules ---
    createModule: (draft) => {
      const item = draftToModule(newId(), draft);
      saveAndToast(
        set,
        get,
        (c) => ({ ...c, modules: [...c.modules, item] }),
        `✓ "${item.code}" creado`,
      );
    },

    updateModule: (id, draft) => {
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          modules: c.modules.map((m) => (m.id === id ? draftToModule(id, draft) : m)),
        }),
        '✓ Cambios guardados',
      );
    },

    deleteModule: async (id, onModuleDeleted) => {
      const saved = await patchSaved(set, get, (c) => ({
        ...c,
        modules: c.modules.filter((m) => m.id !== id),
      }));
      if (!saved) return;
      const ok = await hardDeleteOnAuth(`/catalog/modules/${id}`);
      if (ok) {
        onModuleDeleted?.(id);
        toast({ type: 'info', message: 'Módulo eliminado' });
      }
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
      saveAndToast(
        set,
        get,
        (c) => ({ ...c, modules: [...c.modules, copy] }),
        `✓ Duplicado como ${newCode}`,
      );
    },

    // --- Structures ---
    createStructure: (draft) => {
      const item = draftToStructure(newId(), draft);
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          structures: [...(c.structures ?? []), item],
        }),
        `✓ "${item.code}" creado`,
      );
    },

    updateStructure: (id, draft) => {
      saveAndToast(
        set,
        get,
        (c) => ({
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
        }),
        '✓ Cambios guardados',
      );
    },

    deleteStructure: async (id) => {
      const saved = await patchSaved(set, get, (c) => ({
        ...c,
        structures: (c.structures ?? []).filter((s) => s.id !== id),
      }));
      if (!saved) return;
      const ok = await hardDeleteOnAuth(`/catalog/structures/${id}`);
      if (ok) {
        toast({ type: 'info', message: 'Estructura eliminada' });
      }
    },

    setStructureActive: (id, active) => {
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          structures: (c.structures ?? []).map((s) =>
            s.id === id ? { ...s, active } : s,
          ),
        }),
        active ? 'Estructura activada' : 'Estructura desactivada',
        'info',
      );
    },

    // --- Components ---
    createComponent: (draft) => {
      const item = draftToComponent(newId(), draft);
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          components: [...(c.components ?? []), item],
        }),
        `✓ "${item.code}" creado`,
      );
    },

    updateComponent: (id, draft) => {
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          components: (c.components ?? []).map((comp) =>
            comp.id === id ? draftToComponent(id, draft) : comp,
          ),
        }),
        '✓ Cambios guardados',
      );
    },

    toggleComponentActive: (id) => {
      void patch(set, get, (c) => ({
        ...c,
        components: (c.components ?? []).map((comp) =>
          comp.id === id ? { ...comp, active: !comp.active } : comp,
        ),
      }));
    },

    // --- Agregados ---
    createAgregado: (item) => {
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          agregados: [...(c.agregados ?? []), item],
        }),
        `✓ "${item.code}" creado`,
      );
    },

    updateAgregado: (item) => {
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          agregados: (c.agregados ?? []).map((a) => (a.id === item.id ? item : a)),
        }),
        '✓ Cambios guardados',
      );
    },

    deleteAgregado: async (id) => {
      const saved = await patchSaved(set, get, (c) => ({
        ...c,
        agregados: (c.agregados ?? []).filter((a) => a.id !== id),
      }));
      if (!saved) return;
      const ok = await hardDeleteOnAuth(`/catalog/agregados/${id}`);
      if (ok) {
        toast({ type: 'info', message: 'Agregado eliminado' });
      }
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
      saveAndToast(
        set,
        get,
        (c) => ({
          ...c,
          customers: [...(c.customers ?? []), item],
        }),
        `✓ Cliente "${item.name}" creado`,
      );
    },

    updateCustomer: (id, draft, actor) => {
      const existing = get().catalog?.customers?.find((c) => c.id === id);
      const ownerUserId = resolveOwnerOnUpdate(
        actor.role,
        existing?.ownerUserId,
        draft.ownerUserId,
      );
      saveAndToast(
        set,
        get,
        (cat) => ({
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
        }),
        '✓ Cambios guardados',
      );
    },

    setCustomerActive: (id, active) => {
      const target = get().catalog?.customers?.find((c) => c.id === id);
      saveAndToast(
        set,
        get,
        (cat) => ({
          ...cat,
          customers: (cat.customers ?? []).map((c) =>
            c.id === id ? { ...c, active } : c,
          ),
        }),
        target
          ? active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`
          : null,
        'info',
      );
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
