/**
 * projectStore — proyectos + templates + backend breakdown.
 *
 * Sub-slice 3 de 4 de la Fase 0 (Perfect App Roadmap §5.0.1). Migra de App.tsx
 * el slice de proyecto con sus 19 handlers + el hook de backend breakdown.
 *
 * Invariante: projectStore POSEE `{ projects, projectTemplates, backendBreakdown,
 * breakdownLoading, breakdownError }`. workspaceStore dropea `projects` y
 * `projectTemplates` de su workspace.
 *
 * Cross-store:
 * - createProject/updateProject/createFromTemplate llaman `catalogStore.getState().upsertCustomers()`
 *   para persistir customers creados inline (bug fix F062).
 * - Lee `useWorkspaceStore.getState()` para authToken y session (hook de breakdown).
 */

import { useEffect } from 'react';
import { create } from 'zustand';

import type {
  Catalog,
  Customer,
  InstallationChecklistItem,
  OptionChoices,
  Project,
  ProjectItem,
  ProjectKitchenLayout,
  ProjectTemplate,
  QuoteBreakdown,
} from '@muebles/domain';
import {
  applyRoleChoiceToProject,
  createProjectFromTemplate,
  duplicateProject as deepCopyProject,
  projectToTemplate,
  resolveOwnerOnCreate,
  resolveOwnerOnUpdate,
  transitionProjectStatus,
} from '@muebles/domain';
import { breakdownFromApi } from '@muebles/storage';
import type { ProjectDraft } from '@muebles/ui';

import type { ToastFn } from './catalogStore';
import { getCatalogStoreState } from './catalogStore';
import { getUiStoreState } from './uiStore';

// ---------------------------------------------------------------------------
// Helpers (migrated from App.tsx)
// ---------------------------------------------------------------------------

function optionalNotes(notes: string): string | undefined {
  const trimmed = notes.trim();
  return trimmed ? trimmed : undefined;
}

function draftToProjectMeta(
  draft: ProjectDraft,
  customerId: string,
): Pick<
  Project,
  | 'name'
  | 'customerId'
  | 'currency'
  | 'marginFactor'
  | 'laborFixedCost'
  | 'status'
  | 'notes'
> {
  return {
    name: draft.name.trim(),
    customerId,
    currency: draft.currency.trim(),
    marginFactor: Number(draft.marginFactor),
    laborFixedCost: Number(draft.laborFixedCost),
    status: draft.status,
    notes: optionalNotes(draft.notes),
  };
}

/**
 * Prefer an existing catalog customer id from the draft. Only create when the
 * "Nuevo cliente" path sends a name without a selected id.
 * Returns resolved customerId + the new customers list (caller persists).
 */
function resolveCustomerFromDraft(
  draft: ProjectDraft,
  customers: readonly Customer[],
  newId: () => string,
): { customerId: string; customers: Customer[] } {
  const selectedId = draft.customerId.trim();
  if (selectedId) {
    return { customerId: selectedId, customers: [...customers] };
  }

  const trimmed = (draft.customerName ?? '').trim();
  if (!trimmed) {
    return { customerId: '', customers: [...customers] };
  }

  const key = trimmed.toLocaleLowerCase('es-UY');
  const existing = customers.find(
    (c) => c.name.trim().toLocaleLowerCase('es-UY') === key,
  );
  if (existing) {
    return { customerId: existing.id, customers: [...customers] };
  }
  const created: Customer = {
    id: newId(),
    name: trimmed,
    active: true,
    ownerUserId: draft.ownerUserId?.trim() || undefined,
  };
  return { customerId: created.id, customers: [...customers, created] };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ProjectStoreDeps {
  /** Generates UUIDs for new entities. Default: crypto.randomUUID. */
  readonly newId?: () => string;
  /** Persists a single project (fire-and-forget OK). */
  readonly createProject: (project: Project) => Promise<void>;
  /** Persists a single project (PUT). */
  readonly saveProject: (project: Project) => Promise<void>;
  /** Deletes a project by id. */
  readonly deleteProject: (projectId: string) => Promise<void>;
  /** Persists a new project template. */
  readonly createProjectTemplate: (template: ProjectTemplate) => Promise<void>;
  /** Deletes a project template by id. */
  readonly deleteProjectTemplate: (templateId: string) => Promise<void>;
  /** Reads auth token for backend breakdown fetch. */
  readonly getAuthToken: () => string | null;
  /** Backend API base URL. */
  readonly baseUrl: string;
  /** Fetch impl (for tests). */
  readonly fetchImpl?: typeof fetch;
}

export type ProjectActor = {
  readonly id?: string;
  readonly role?: string;
};

export interface ProjectState {
  readonly projects: readonly Project[];
  readonly projectTemplates: readonly ProjectTemplate[];
  readonly backendBreakdown: QuoteBreakdown | null;
  readonly breakdownLoading: boolean;
  readonly breakdownError: string | null;

  // --- Lifecycle ---
  readonly setProjects: (projects: readonly Project[]) => void;
  readonly setProjectTemplates: (
    templates: readonly ProjectTemplate[],
  ) => void;
  readonly clearBreakdown: () => void;

  // --- Project CRUD ---
  readonly createProject: (
    draft: ProjectDraft,
    catalog: Catalog,
    actor: ProjectActor,
  ) => void;
  readonly updateProject: (
    id: string,
    draft: ProjectDraft,
    catalog: Catalog,
    actor: ProjectActor,
  ) => void;
  readonly deleteProject: (
    id: string,
    onProjectDeleted?: (id: string) => void,
  ) => void;
  readonly duplicateProjectById: (id: string) => void;
  readonly markProjectProduced: (id: string, catalog: Catalog) => void;
  readonly reopenProject: (id: string, catalog: Catalog) => void;

  // --- Templates ---
  readonly saveAsTemplate: (projectId: string, name: string) => void;
  readonly createFromTemplate: (
    templateId: string,
    draft: ProjectDraft,
    catalog: Catalog,
    actor: ProjectActor,
  ) => void;
  readonly deleteTemplate: (templateId: string) => void;

  // --- Item mutations ---
  readonly addProjectItem: (
    projectId: string,
    input: {
      readonly moduleId: string;
      readonly quantity: number;
      readonly optionChoices: OptionChoices;
      readonly measurePresetId?: string;
    },
  ) => void;
  readonly updateProjectItem: (projectId: string, item: ProjectItem) => void;
  readonly removeProjectItem: (projectId: string, itemId: string) => void;
  readonly updateProjectLevelChoices: (
    projectId: string,
    choices: OptionChoices,
  ) => void;
  readonly updateMeasureDefaults: (
    projectId: string,
    defaults: Project['measureDefaults'],
  ) => void;
  readonly updateInstallationChecklist: (
    projectId: string,
    installationChecklist: readonly InstallationChecklistItem[],
  ) => void;
  readonly updateKitchenLayout: (
    projectId: string,
    kitchenLayout: ProjectKitchenLayout,
  ) => void;
  readonly applyScenarioB: (
    projectId: string,
    role: string,
    choiceId: string,
  ) => void;
  readonly importNestingResult: (
    projectId: string,
    nestingImport: NonNullable<Project['nestingImport']>,
  ) => void;
  readonly duplicateWithScenarioB: (
    projectId: string,
    role: string,
    choiceId: string,
    onNavigateToNewProject?: (id: string) => void,
  ) => void;
}

interface InternalOptions {
  readonly deps: ProjectStoreDeps;
}

function defaultNewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createProjectStore(options: InternalOptions) {
  const newId = options.deps.newId ?? defaultNewId;
  const persistCreateProject = options.deps.createProject;
  const persistSaveProject = options.deps.saveProject;
  const persistDeleteProject = options.deps.deleteProject;
  const persistCreateTemplate = options.deps.createProjectTemplate;
  const persistDeleteTemplate = options.deps.deleteProjectTemplate;
  // F064: toast comes from uiStore (single source of truth). Reading fresh
  // each call avoids stale closures across re-renders.
  const toast: ToastFn = (input) => getUiStoreState().toast(input);

  /**
   * Projects updater (reducer style). Saves only projects whose reference
   * changed vs previous list (#15). Replaces App.tsx `patchProjects` wrapper.
   */
  function patch(
    set: (partial: Partial<ProjectState>) => void,
    get: () => ProjectState,
    updater: (
      projects: readonly Project[],
    ) => readonly Project[],
  ): void {
    const prev = get().projects;
    const nextProjects = updater(prev);
    set({ projects: nextProjects });
    const prevById = new Map(prev.map((p) => [p.id, p]));
    for (const p of nextProjects) {
      if (prevById.get(p.id) !== p) {
        persistSaveProject(p).catch((err) => {
          console.error('Error al guardar proyecto:', err);
        });
      }
    }
  }

  return create<ProjectState>()((set, get) => ({
    projects: [],
    projectTemplates: [],
    backendBreakdown: null,
    breakdownLoading: false,
    breakdownError: null,

    // --- Lifecycle ---
    setProjects: (projects) => set({ projects }),
    setProjectTemplates: (templates) =>
      set({ projectTemplates: templates }),
    clearBreakdown: () =>
      set({
        backendBreakdown: null,
        breakdownLoading: false,
        breakdownError: null,
      }),

    // --- Project CRUD ---
    createProject: (draft, catalog, actor) => {
      const now = new Date().toISOString();
      const resolved = resolveCustomerFromDraft(
        draft,
        catalog.customers ?? [],
        newId,
      );
      const updatedCatalog = { ...catalog, customers: resolved.customers };
      const meta = draftToProjectMeta(draft, resolved.customerId);
      const ownerUserId = resolveOwnerOnCreate(
        actor.id,
        actor.role,
        draft.ownerUserId,
      );
      const base: Project = {
        id: newId(),
        ...meta,
        ownerUserId,
        createdBy: actor.id,
        status: 'draft',
        items: [],
        createdAt: now,
        updatedAt: now,
      };
      // Capture snapshot if created already as quoted/accepted (PRD §7.4).
      const project = transitionProjectStatus(
        base,
        meta.status,
        updatedCatalog,
        now,
      );

      // F062 bug fix: persist customers via catalogStore (catalogStore owns catalog).
      getCatalogStoreState().upsertCustomers(resolved.customers);

      set({ projects: [...get().projects, project] });

      persistCreateProject(project).catch((err) => {
        console.error('Error al crear proyecto:', err);
        toast({
          type: 'error',
          message: 'No se pudo guardar la cotización en el servidor',
        });
      });
      toast({ type: 'success', message: `✓ "${meta.name}" creado` });
    },

    updateProject: (id, draft, catalog, actor) => {
      const now = new Date().toISOString();
      const resolved = resolveCustomerFromDraft(
        draft,
        catalog.customers ?? [],
        newId,
      );
      const updatedCatalog = { ...catalog, customers: resolved.customers };
      const meta = draftToProjectMeta(draft, resolved.customerId);

      const existing = get().projects.find((p) => p.id === id);
      if (!existing) return;

      const withMeta: Project = {
        ...existing,
        name: meta.name,
        customerId: meta.customerId,
        currency: meta.currency,
        marginFactor: meta.marginFactor,
        laborFixedCost: meta.laborFixedCost,
        notes: meta.notes,
        ownerUserId: resolveOwnerOnUpdate(
          actor.role,
          existing.ownerUserId,
          draft.ownerUserId,
        ),
        updatedAt: now,
      };
      // Status change captures or clears priceSnapshot (PRD §7.4).
      const updatedProject = transitionProjectStatus(
        withMeta,
        meta.status,
        updatedCatalog,
        now,
      );

      // F062 bug fix: persist customers via catalogStore.
      getCatalogStoreState().upsertCustomers(resolved.customers);

      set({
        projects: get().projects.map((p) =>
          p.id === id ? updatedProject : p,
        ),
      });

      persistSaveProject(updatedProject).catch((err) => {
        console.error('Error al guardar proyecto:', err);
      });
      toast({ type: 'success', message: '✓ Cambios guardados' });
    },

    deleteProject: (id, onProjectDeleted) => {
      persistDeleteProject(id).catch((err) => {
        console.error('Error al eliminar proyecto:', err);
      });
      patch(set, get, (ps) => ps.filter((p) => p.id !== id));
      onProjectDeleted?.(id);
      toast({ type: 'info', message: 'Cotización eliminada' });
    },

    duplicateProjectById: (id) => {
      const source = get().projects.find((p) => p.id === id);
      if (!source) return;
      const copy = deepCopyProject(source, {
        newId: newId(),
        itemIdFactory: newId,
        nowIso: new Date().toISOString(),
      });
      set({ projects: [...get().projects, copy] });
      persistCreateProject(copy).catch((err) => {
        console.error('Error al duplicar proyecto:', err);
        toast({
          type: 'error',
          message: 'No se pudo guardar el duplicado en el servidor',
        });
      });
      toast({ type: 'success', message: `✓ Duplicado como ${copy.name}` });
    },

    /** F036: accepted → produced (click-only; no export gate). */
    markProjectProduced: (id, catalog) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project || project.status !== 'accepted') return;
      const now = new Date().toISOString();
      const updated = transitionProjectStatus(project, 'produced', catalog, now);
      patch(set, get, (ps) => ps.map((p) => (p.id === id ? updated : p)));
      toast({ type: 'success', message: '✓ Marcada en producción' });
    },

    /** F036: closed → draft; clears price snapshot. */
    reopenProject: (id, catalog) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project || project.status === 'draft') return;
      const now = new Date().toISOString();
      const updated = transitionProjectStatus(project, 'draft', catalog, now);
      patch(set, get, (ps) => ps.map((p) => (p.id === id ? updated : p)));
      toast({
        type: 'info',
        message: 'Cotización reabierta a borrador (precios descongelados)',
      });
    },

    // --- Templates ---
    saveAsTemplate: (projectId, name) => {
      const source = get().projects.find((p) => p.id === projectId);
      if (!source) return;
      const now = new Date().toISOString();
      const template: ProjectTemplate = projectToTemplate(source, {
        newId: newId(),
        name,
        nowIso: now,
      });
      set({
        projectTemplates: [...get().projectTemplates, template],
      });
      persistCreateTemplate(template).catch((err) => {
        console.error('Error al guardar plantilla:', err);
        toast({
          type: 'error',
          message: 'No se pudo guardar la plantilla en el servidor',
        });
      });
      toast({ type: 'success', message: `✓ Plantilla "${name}" guardada` });
    },

    createFromTemplate: (templateId, draft, catalog, actor) => {
      const template = get().projectTemplates.find((t) => t.id === templateId);
      if (!template) return;
      const now = new Date().toISOString();
      const resolved = resolveCustomerFromDraft(
        draft,
        catalog.customers ?? [],
        newId,
      );
      const ownerUserId = resolveOwnerOnCreate(
        actor.id,
        actor.role,
        draft.ownerUserId,
      );
      const project = createProjectFromTemplate(template, {
        newId: newId(),
        itemIdFactory: newId,
        nowIso: now,
        customerId: resolved.customerId,
        name: draft.name,
        ownerUserId,
        createdBy: actor.id,
      });

      // F062 bug fix: persist customers via catalogStore.
      getCatalogStoreState().upsertCustomers(resolved.customers);

      set({ projects: [...get().projects, project] });

      persistCreateProject(project).catch((err) => {
        console.error('Error al crear proyecto desde plantilla:', err);
        toast({
          type: 'error',
          message: 'No se pudo crear la cotización en el servidor',
        });
      });
      toast({
        type: 'success',
        message: `✓ Cotización "${draft.name}" creada desde plantilla`,
      });
    },

    deleteTemplate: (templateId) => {
      set({
        projectTemplates: get().projectTemplates.filter(
          (t) => t.id !== templateId,
        ),
      });
      persistDeleteTemplate(templateId).catch((err) => {
        console.error('Error al borrar plantilla:', err);
      });
      toast({ type: 'info', message: '↓ Plantilla eliminada' });
    },

    // --- Item mutations ---
    addProjectItem: (projectId, input) => {
      const now = new Date().toISOString();
      const item: ProjectItem = {
        id: newId(),
        moduleId: input.moduleId,
        quantity: input.quantity,
        optionChoices: input.optionChoices,
        measurePresetId: input.measurePresetId,
      };
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? { ...p, items: [...p.items, item], updatedAt: now }
            : p,
        ),
      );
    },

    updateProjectItem: (projectId, item) => {
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? {
                ...p,
                items: p.items.map((i) => (i.id === item.id ? item : i)),
                updatedAt: now,
              }
            : p,
        ),
      );
    },

    removeProjectItem: (projectId, itemId) => {
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? {
                ...p,
                items: p.items.filter((i) => i.id !== itemId),
                updatedAt: now,
              }
            : p,
        ),
      );
    },

    updateProjectLevelChoices: (projectId, choices) => {
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? {
                ...p,
                projectLevelChoices:
                  Object.keys(choices).length > 0 ? choices : undefined,
                updatedAt: now,
              }
            : p,
        ),
      );
    },

    updateMeasureDefaults: (projectId, defaults) => {
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? { ...p, measureDefaults: defaults, updatedAt: now }
            : p,
        ),
      );
    },

    updateInstallationChecklist: (projectId, installationChecklist) => {
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? {
                ...p,
                installationChecklist: [...installationChecklist],
                updatedAt: now,
              }
            : p,
        ),
      );
    },

    updateKitchenLayout: (projectId, kitchenLayout) => {
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? {
                ...p,
                kitchenLayout:
                  kitchenLayout.walls.length === 0 &&
                  kitchenLayout.placements.length === 0
                    ? undefined
                    : kitchenLayout,
                updatedAt: now,
              }
            : p,
        ),
      );
    },

    applyScenarioB: (projectId, role, choiceId) => {
      const now = new Date().toISOString();
      const project = get().projects.find((p) => p.id === projectId);
      if (!project || project.status !== 'draft') {
        toast({
          type: 'error',
          message: 'Solo se puede aplicar el escenario B en borrador',
        });
        return;
      }
      const updated = applyRoleChoiceToProject(project, role, choiceId, now);
      patch(set, get, (ps) => ps.map((p) => (p.id === projectId ? updated : p)));
      toast({
        type: 'success',
        message: '✓ Escenario B aplicado a la cotización',
      });
    },

    importNestingResult: (projectId, nestingImport) => {
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? { ...p, nestingImport, updatedAt: now }
            : p,
        ),
      );
      toast({ type: 'success', message: '✓ Nesting importado' });
    },

    duplicateWithScenarioB: (projectId, role, choiceId, onNavigateToNewProject) => {
      const source = get().projects.find((p) => p.id === projectId);
      if (!source) return;
      const now = new Date().toISOString();
      const copy = deepCopyProject(source, {
        newId: newId(),
        itemIdFactory: newId,
        nowIso: now,
      });
      const withB = applyRoleChoiceToProject(copy, role, choiceId, now);
      set({ projects: [...get().projects, withB] });
      persistCreateProject(withB).catch((err) => {
        console.error('Error al duplicar con escenario B:', err);
        toast({
          type: 'error',
          message: 'No se pudo guardar el duplicado en el servidor',
        });
      });
      toast({
        type: 'success',
        message: '✓ Cotización duplicada con escenario B',
      });
      onNavigateToNewProject?.(withB.id);
    },
  }));
}

// ---------------------------------------------------------------------------
// Singleton + hook (same pattern as catalogStore)
// ---------------------------------------------------------------------------

let _singleton: ReturnType<typeof createProjectStore> | null = null;
let _lastDepsKey: string | null = null;
/**
 * Last deps captured by `ensureProjectStore`. Used by `useBackendBreakdownEffect`
 * to read fetchImpl / baseUrl / getAuthToken without re-passing them. Always
 * fresh because `ensureProjectStore` is idempotent per depsKey.
 */
let _lastDeps: ProjectStoreDeps | null = null;

function depsKey(deps: ProjectStoreDeps): string {
  return [
    deps.baseUrl,
    String(deps.createProject),
    String(deps.saveProject),
    String(deps.deleteProject),
    String(deps.createProjectTemplate),
    String(deps.deleteProjectTemplate),
    String(deps.getAuthToken),
  ].join('|');
}

export function ensureProjectStore(deps: ProjectStoreDeps): void {
  const key = depsKey(deps);
  if (_singleton && key === _lastDepsKey) {
    _lastDeps = deps; // refresh ref (functions may be stable but safer to refresh)
    return;
  }
  _singleton = createProjectStore({ deps });
  _lastDepsKey = key;
  _lastDeps = deps;
}

export function useProjectStore<T = ProjectState>(
  selector: (s: ProjectState) => T = identitySelector as (s: ProjectState) => T,
): T {
  if (!_singleton) {
    throw new Error(
      'projectStore not initialized — call ensureProjectStore(deps) first',
    );
  }
  return _singleton(selector);
}

function identitySelector<T>(s: T): T {
  return s;
}

export function getProjectStoreState(): ProjectState {
  if (!_singleton) {
    throw new Error(
      'projectStore not initialized — call ensureProjectStore(deps) first',
    );
  }
  return _singleton.getState();
}

// ---------------------------------------------------------------------------
// Backend breakdown hook (with debounce)
// ---------------------------------------------------------------------------

const BACKEND_BREAKDOWN_DEBOUNCE_MS = 300;

/**
 * Fetches backend breakdown for the selected project with 300ms debounce.
 * - On success: sets `backendBreakdown`.
 * - On failure: clears breakdown, sets friendly `breakdownError`, emits toast,
 *   App.tsx falls back to local `projectQuote.breakdown`.
 * - When session !== 'auth' or no project selected: clears all breakdown state.
 *
 * Hook form: lives in the store module because the deps (fetch, baseUrl,
 * authToken) are already in the store, and toast is read from uiStore.
 * App.tsx wires it with the router-derived `selectedProjectId` +
 * `selectedProject` + `session`.
 */
export function useBackendBreakdownEffect(
  projectId: string | null,
  project: Project | undefined,
  session: 'guest' | 'auth' | null,
): void {
  useEffect(() => {
    if (!_singleton || !_lastDeps) return;
    const store = _singleton;
    const fetchImpl = _lastDeps.fetchImpl ?? globalThis.fetch;
    const baseUrl = _lastDeps.baseUrl;
    const getAuthToken = _lastDeps.getAuthToken;
    // F064: toast read from uiStore inside the effect.
    const toast: ToastFn = (input) => getUiStoreState().toast(input);

    if (session !== 'auth' || !projectId || !project) {
      store.setState({
        backendBreakdown: null,
        breakdownLoading: false,
        breakdownError: null,
      });
      return;
    }

    let active = true;
    store.setState({
      breakdownLoading: true,
      breakdownError: null,
    });

    const fetchBreakdown = async () => {
      try {
        const token = getAuthToken();
        const res = await fetchImpl(
          `${baseUrl}/projects/${projectId}/calculate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
        );
        if (!res.ok) {
          throw new Error(`No se pudo recalcular (${res.status})`);
        }
        const data = breakdownFromApi(
          (await res.json()) as Record<string, unknown>,
        );
        if (active) {
          store.setState({
            backendBreakdown: data,
            breakdownError: null,
          });
        }
      } catch (err) {
        console.error('Backend calculation error:', err);
        if (active) {
          const message =
            'No se pudo recalcular en el servidor; mostrando valores locales';
          store.setState({
            backendBreakdown: null,
            breakdownError: message,
          });
          toast({ type: 'error', message });
        }
      } finally {
        if (active) {
          store.setState({ breakdownLoading: false });
        }
      }
    };

    const timeoutId = setTimeout(() => {
      void fetchBreakdown();
    }, BACKEND_BREAKDOWN_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, project, session]);
}
