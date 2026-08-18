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
  ItemFloorStatus,
  ModuleBaseMode,
  OptionChoices,
  Project,
  ProjectItem,
  ProjectKitchenLayout,
  ProjectPhoto,
  ProjectPhotoStage,
  ProjectStatus,
  ProjectTechnicalStatus,
  ProjectInternalMessage,
  ProjectInternalMessageType,
  ProjectTemplate,
  QuoteBreakdown,
  WarrantyPhotoKind,
  WarrantyRefabricationPiece,
  WarrantyTicket,
  WarrantyTicketCategory,
  WarrantyTicketPriority,
  WarrantyTicketStatus,
  ShowcasePhotoItem,
} from '@muebles/domain';

import {
  exportWarrantyRefabricationOptimizer,
  warrantyRefabricationFilename,
} from '@muebles/excel';



import {
  acquirePlanEditSession as acquirePlanEditSessionDomain,
  applyRoleChoiceToProject,
  createProjectFromTemplate,
  duplicateProject as deepCopyProject,
  ensureProductionRevision as ensureProductionRevisionDomain,
  isKitchenLayoutEmpty,
  projectAllowsContentMutation,
  projectAllowsReopenToDraft,
  projectToTemplate,
  pruneKitchenLayoutOrClear,
  recordProductionExport as recordProductionExportDomain,
  releasePlanEditSession as releasePlanEditSessionDomain,
  renewPlanEditSession as renewPlanEditSessionDomain,
  resolveOwnerOnCreate,
  resolveOwnerOnUpdate,
  advanceFloorStatus,
  appendFloorEvent,
  setProjectItemFloorStatus,
  transitionProjectStatus,
  snapshotOnStatusChange,
  createEngineeringLog,
  recordGeneration,
  recordSentToProduction,
  restoreProjectVersion,
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
  | 'assignedEngineerId'
  | 'technicalStatus'
  | 'surveyCompletedAt'
  | 'installationScheduledDate'
> {
  return {
    name: draft.name.trim(),
    customerId,
    currency: draft.currency.trim(),
    marginFactor: Number(draft.marginFactor),
    laborFixedCost: Number(draft.laborFixedCost),
    status: draft.status,
    notes: optionalNotes(draft.notes),
    assignedEngineerId: draft.assignedEngineerId?.trim() || undefined,
    technicalStatus: draft.technicalStatus,
    surveyCompletedAt: draft.surveyCompletedAt || undefined,
    installationScheduledDate: draft.installationScheduledDate || undefined,
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
  /** Project photos (CRM Phase 1). */
  readonly getProjectPhotos?: (projectId: string) => Promise<readonly ProjectPhoto[]>;
  readonly uploadProjectPhoto?: (
    projectId: string,
    file: File,
    stage: ProjectPhotoStage,
    caption?: string,
  ) => Promise<ProjectPhoto>;
  readonly updateProjectPhoto?: (
    projectId: string,
    photoId: string,
    updates: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
  ) => Promise<ProjectPhoto>;
  readonly deleteProjectPhoto?: (
    projectId: string,
    photoId: string,
  ) => Promise<void>;
  /** Project internal messages and technical workflow (CRM Phase 2). */
  readonly getProjectInternalMessages?: (projectId: string) => Promise<readonly ProjectInternalMessage[]>;
  readonly createProjectInternalMessage?: (message: {
    projectId: string;
    messageType?: ProjectInternalMessageType;
    content: string;
    senderName?: string;
    attachments?: readonly string[];
  }) => Promise<ProjectInternalMessage>;
  readonly updateProjectTechnicalWorkflow?: (
    projectId: string,
    updates: {
      assignedEngineerId?: string;
      technicalStatus?: ProjectTechnicalStatus;
      surveyCompletedAt?: string;
      installationScheduledDate?: string;
      comment?: string;
    },
  ) => Promise<Project>;
  /** Warranty Desk (CRM Phase 3). */
  readonly getWarrantyTickets?: (filter?: {
    projectId?: string;
    customerId?: string;
    status?: string;
  }) => Promise<readonly WarrantyTicket[]>;
  readonly createWarrantyTicket?: (
    ticket: Partial<WarrantyTicket> & Pick<WarrantyTicket, 'projectId' | 'title'>,
  ) => Promise<WarrantyTicket>;
  readonly updateWarrantyTicket?: (
    ticketId: string,
    updates: Partial<WarrantyTicket>,
  ) => Promise<WarrantyTicket>;
  readonly deleteWarrantyTicket?: (ticketId: string) => Promise<void>;
  readonly uploadWarrantyTicketPhoto?: (
    ticketId: string,
    file: File,
    data?: { kind?: WarrantyPhotoKind; caption?: string },
  ) => Promise<any>;
  /** Commercial Showcase / Portfolio (CRM Phase 4). */
  readonly listShowcasePhotos?: (onlyShowcase?: boolean) => Promise<readonly ShowcasePhotoItem[]>;
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
  /** roadmap-screens 2a.6 — create + persist the engineering log. */
  readonly startEngineering: (id: string, byUserId: string) => void;
  /** roadmap-screens 2a — stamp generatedBy/At when docs are exported. */
  readonly recordEngineeringGeneration: (id: string, byUserId: string) => void;
  /**
   * roadmap-screens 2a.15 — the engineering→factory handshake: records
   * sentToProductionBy/At, bumps the log revision, and transitions
   * accepted → produced (same snapshot machinery as markProjectProduced).
   */
  readonly sendProjectToProduction: (
    id: string,
    byUserId: string,
    catalog: Catalog,
  ) => void;
  readonly cancelProject: (id: string) => void;
  /** Generic status transition: draft→quoted, quoted→accepted (gap #3). */
  readonly changeProjectStatus: (
    id: string,
    status: ProjectStatus,
    catalog: Catalog,
  ) => void;
  readonly reopenProject: (
    id: string,
    catalog: Catalog,
    actorRole?: string | null,
  ) => void;
  readonly restoreProjectVersion: (id: string, version: number) => void;

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
      /** Base treatment default resolved by the caller (F087). */
      readonly baseMode?: ModuleBaseMode;
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
  /** Soft lock for Proyectar multi-user. Returns false if another user holds it. */
  readonly acquirePlanEditSession: (
    projectId: string,
    actor: { readonly userId: string; readonly userName: string },
  ) => boolean;
  readonly renewPlanEditSession: (
    projectId: string,
    actor: { readonly userId: string; readonly userName: string },
  ) => boolean;
  readonly releasePlanEditSession: (
    projectId: string,
    userId: string,
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
  /** PROD-3.1 — shop-floor status per line item. */
  readonly setItemFloorStatus: (
    projectId: string,
    itemId: string,
    status: ItemFloorStatus,
  ) => void;
  /** PROD-3.2 — stamp export revision after factory pack/export. */
  readonly recordProductionExport: (projectId: string) => void;
  /** PROD-3.2 — ensure OP revision when opening plant-ready order. */
  readonly ensureProductionRevision: (projectId: string) => void;
  readonly duplicateWithScenarioB: (
    projectId: string,
    role: string,
    choiceId: string,
    onNavigateToNewProject?: (id: string) => void,
  ) => void;

  // --- Project Photos (CRM Phase 1) ---
  readonly photos: Readonly<Record<string, readonly ProjectPhoto[]>>;
  readonly loadProjectPhotos: (projectId: string) => Promise<void>;
  readonly uploadProjectPhotos: (
    projectId: string,
    files: File[],
    stage: ProjectPhotoStage,
    caption?: string,
  ) => Promise<void>;
  readonly updateProjectPhoto: (
    projectId: string,
    photoId: string,
    updates: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
  ) => Promise<void>;
  readonly deleteProjectPhoto: (projectId: string, photoId: string) => Promise<void>;

  // --- Internal Communications & Technical Handoff (CRM Phase 2) ---
  readonly internalMessages: Readonly<Record<string, readonly ProjectInternalMessage[]>>;
  readonly loadProjectMessages: (projectId: string) => Promise<void>;
  readonly sendProjectMessage: (message: {
    projectId: string;
    messageType?: ProjectInternalMessageType;
    content: string;
    senderName?: string;
    attachments?: readonly string[];
  }) => Promise<void>;
  readonly updateProjectTechnicalWorkflow: (
    projectId: string,
    updates: {
      assignedEngineerId?: string;
      technicalStatus?: ProjectTechnicalStatus;
      surveyCompletedAt?: string;
      installationScheduledDate?: string;
      comment?: string;
    },
  ) => Promise<void>;

  // --- Warranty Desk & Refabrication (CRM Phase 3) ---
  readonly warranties: Readonly<Record<string, readonly WarrantyTicket[]>>;
  readonly loadProjectWarranties: (projectId: string) => Promise<void>;
  readonly createWarrantyTicket: (
    ticket: Partial<WarrantyTicket> & Pick<WarrantyTicket, 'projectId' | 'title'>,
  ) => Promise<void>;
  readonly updateWarrantyTicket: (
    ticketId: string,
    updates: Partial<WarrantyTicket>,
  ) => Promise<void>;
  readonly deleteWarrantyTicket: (ticketId: string, projectId: string) => Promise<void>;
  readonly uploadWarrantyPhoto: (
    ticketId: string,
    projectId: string,
    file: File,
    kind?: WarrantyPhotoKind,
    caption?: string,
  ) => Promise<void>;
  readonly exportWarrantyRefabricationOptimizer: (
    ticket: WarrantyTicket,
  ) => Promise<void>;

  // --- Showcase & Commercial Portfolio (CRM Phase 4) ---
  readonly showcasePhotos: readonly ShowcasePhotoItem[];
  readonly isLoadingShowcase: boolean;
  readonly loadShowcasePhotos: (onlyShowcase?: boolean) => Promise<void>;
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
          toast({
            type: 'error',
            message: 'No se pudieron guardar los cambios en el servidor.',
          });
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
    photos: {},

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
      // #257: commercial meta only while draft (status via workflow buttons).
      if (!projectAllowsContentMutation(existing.status)) {
        toast({
          type: 'error',
          message: 'Cotización cerrada: no se puede editar. Reabrí a borrador (gerente).',
        });
        return;
      }

      const withMeta: Project = {
        ...existing,
        name: meta.name,
        customerId: meta.customerId,
        currency: meta.currency,
        marginFactor: meta.marginFactor,
        laborFixedCost: meta.laborFixedCost,
        notes: meta.notes,
        // Keep existing status — meta form no longer changes lifecycle (#257).
        ownerUserId: resolveOwnerOnUpdate(
          actor.role,
          existing.ownerUserId,
          draft.ownerUserId,
        ),
        updatedAt: now,
      };
      // Status stays draft; no transition via meta.
      const withTransition = transitionProjectStatus(
        withMeta,
        existing.status,
        updatedCatalog,
        now,
      );
      const updatedProject = snapshotOnStatusChange(
        withTransition,
        existing.status,
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
        toast({
          type: 'error',
          message: 'No se pudo guardar el proyecto. Reintentá en unos segundos.',
        });
      });
      toast({ type: 'success', message: '✓ Cambios guardados' });
    },

    deleteProject: (id, onProjectDeleted) => {
      persistDeleteProject(id).catch((err) => {
        console.error('Error al eliminar proyecto:', err);
        toast({
          type: 'error',
          message: 'No se pudo eliminar el proyecto. Reintentá en unos segundos.',
        });
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
      const cat = catalog ?? getCatalogStoreState().catalog ?? {
        materials: [],
        edges: [],
        hardware: [],
        categories: [],
        optionGroups: [],
        modules: [],
      };
      const withTransition = transitionProjectStatus(project, 'produced', cat, now);
      const updated = snapshotOnStatusChange(withTransition, 'produced');
      patch(set, get, (ps) => ps.map((p) => (p.id === id ? updated : p)));
      toast({ type: 'success', message: '✓ Marcada en producción' });
    },

    // --- Engineering lifecycle (roadmap-screens 2a). All persist via
    // patch() → saveProject PUT → engineering_log column (migration 000053).

    startEngineering: (id, byUserId) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project || project.engineeringLog) return;
      const now = new Date().toISOString();
      const log = createEngineeringLog(byUserId, now);
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === id ? { ...p, engineeringLog: log, updatedAt: now } : p,
        ),
      );
    },

    recordEngineeringGeneration: (id, byUserId) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project?.engineeringLog) return;
      const now = new Date().toISOString();
      const log = recordGeneration(project.engineeringLog, byUserId, now);
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === id ? { ...p, engineeringLog: log, updatedAt: now } : p,
        ),
      );
    },

    sendProjectToProduction: (id, byUserId, catalog) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project || project.status !== 'accepted') return;
      const now = new Date().toISOString();
      const cat = catalog ?? getCatalogStoreState().catalog ?? {
        materials: [],
        edges: [],
        hardware: [],
        categories: [],
        optionGroups: [],
        modules: [],
      };
      const log = project.engineeringLog
        ? recordSentToProduction(project.engineeringLog, byUserId, now)
        : undefined;
      const withTransition = transitionProjectStatus(project, 'produced', cat, now);
      const updated = snapshotOnStatusChange(withTransition, 'produced');
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === id
            ? { ...updated, ...(log ? { engineeringLog: log } : {}) }
            : p,
        ),
      );
      toast({
        type: 'success',
        message: log
          ? `✓ Enviada a producción · rev. ${log.revision}`
          : '✓ Marcada en producción',
      });
    },

    /** Explicit cancel: stamps cancelledAt, excludes from pipeline. */
    cancelProject: (id) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project || project.cancelledAt) return;
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) => (p.id === id ? { ...p, cancelledAt: now } : p)),
      );
      toast({ type: 'info', message: 'Cotización cancelada' });
    },

    /** Gap #3: draft→quoted, quoted→accepted. Reuses the same transition +
     *  snapshot machinery as markProduced/reopen. */
    changeProjectStatus: (id, status, catalog) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project || project.status === status) return;
      const now = new Date().toISOString();
      const cat = catalog ?? getCatalogStoreState().catalog ?? {
        materials: [],
        edges: [],
        hardware: [],
        categories: [],
        optionGroups: [],
        modules: [],
      };
      const withTransition = transitionProjectStatus(project, status, cat, now);
      const updated = snapshotOnStatusChange(withTransition, status);
      patch(set, get, (ps) => ps.map((p) => (p.id === id ? updated : p)));
      const label =
        status === 'quoted'
          ? '✓ Cotización enviada (precios congelados)'
          : status === 'accepted'
            ? '✓ Cotización aceptada'
            : `✓ Estado: ${status}`;
      toast({ type: 'success', message: label });
    },

    /**
     * #257: quoted → draft (vendedor OK); accepted/produced → draft only if
     * role is admin/gerente (pass actor via optional 3rd arg; store uses workspace).
     */
    reopenProject: (id, catalog, actorRole?: string | null) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project) return;
      if (project.status === 'draft') return;
      if (!projectAllowsReopenToDraft(project.status, actorRole)) {
        toast({
          type: 'error',
          message:
            project.status === 'quoted'
              ? 'No se pudo reabrir la cotización.'
              : 'Después de aceptar, solo admin/gerente puede reabrir a borrador.',
        });
        return;
      }
      const now = new Date().toISOString();
      const cat = catalog ?? getCatalogStoreState().catalog ?? {
        materials: [],
        edges: [],
        hardware: [],
        categories: [],
        optionGroups: [],
        modules: [],
      };
      const withTransition = transitionProjectStatus(project, 'draft', cat, now);
      const updated = snapshotOnStatusChange(withTransition, 'draft');
      patch(set, get, (ps) => ps.map((p) => (p.id === id ? updated : p)));
      toast({
        type: 'info',
        message: 'Cotización reabierta a borrador (precios descongelados)',
      });
    },

    /** Restore a project to a previous version (#200). */
    restoreProjectVersion: (id, version) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project) return;
      const updated = restoreProjectVersion(project, version);
      patch(set, get, (ps) => ps.map((p) => (p.id === id ? updated : p)));
      toast({
        type: 'success',
        message: `✓ Versión ${version} restaurada`,
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

    // --- Item mutations (draft only — #257) ---
    addProjectItem: (projectId, input) => {
      const existing = get().projects.find((p) => p.id === projectId);
      if (!existing || !projectAllowsContentMutation(existing.status)) return;
      const now = new Date().toISOString();
      const item: ProjectItem = {
        id: newId(),
        moduleId: input.moduleId,
        quantity: input.quantity,
        optionChoices: input.optionChoices,
        measurePresetId: input.measurePresetId,
        ...(input.baseMode ? { baseMode: input.baseMode } : {}),
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
      const existing = get().projects.find((p) => p.id === projectId);
      if (!existing || !projectAllowsContentMutation(existing.status)) return;
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) => {
          if (p.id !== projectId) return p;
          const items = p.items.map((i) => (i.id === item.id ? item : i));
          return {
            ...p,
            items,
            kitchenLayout: pruneKitchenLayoutOrClear(p.kitchenLayout, items),
            updatedAt: now,
          };
        }),
      );
    },

    removeProjectItem: (projectId, itemId) => {
      const existing = get().projects.find((p) => p.id === projectId);
      if (!existing || !projectAllowsContentMutation(existing.status)) return;
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) => {
          if (p.id !== projectId) return p;
          const items = p.items.filter((i) => i.id !== itemId);
          return {
            ...p,
            items,
            kitchenLayout: pruneKitchenLayoutOrClear(p.kitchenLayout, items),
            updatedAt: now,
          };
        }),
      );
    },

    updateProjectLevelChoices: (projectId, choices) => {
      const existing = get().projects.find((p) => p.id === projectId);
      if (!existing || !projectAllowsContentMutation(existing.status)) return;
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
      const existing = get().projects.find((p) => p.id === projectId);
      if (!existing || !projectAllowsContentMutation(existing.status)) return;
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
      // Installation checklist is commercial prep — draft only (#257).
      const existing = get().projects.find((p) => p.id === projectId);
      if (!existing || !projectAllowsContentMutation(existing.status)) return;
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
      const existing = get().projects.find((p) => p.id === projectId);
      if (!existing || !projectAllowsContentMutation(existing.status)) return;
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? {
                ...p,
                // Multi-space: empty active space must NOT wipe other ambientes.
                kitchenLayout: isKitchenLayoutEmpty(kitchenLayout)
                  ? undefined
                  : kitchenLayout,
                updatedAt: now,
              }
            : p,
        ),
      );
    },

    acquirePlanEditSession: (projectId, actor) => {
      const project = get().projects.find((p) => p.id === projectId);
      if (!project) return false;
      const next = acquirePlanEditSessionDomain(project.planEditSession, actor);
      if (!next) return false;
      // Already hold a live session: skip patch so open Proyectar does not
      // thrash project → re-render → effect loops (Maximum update depth).
      const cur = project.planEditSession;
      if (
        cur &&
        cur.userId === next.userId &&
        cur.userName === next.userName
      ) {
        const exp = Date.parse(cur.expiresAt);
        if (Number.isFinite(exp) && exp > Date.now()) {
          return true;
        }
      }
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? { ...p, planEditSession: next, updatedAt: now }
            : p,
        ),
      );
      return true;
    },

    renewPlanEditSession: (projectId, actor) => {
      const project = get().projects.find((p) => p.id === projectId);
      if (!project) return false;
      const next = renewPlanEditSessionDomain(project.planEditSession, actor);
      if (!next) return false;
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) =>
          p.id === projectId
            ? { ...p, planEditSession: next, updatedAt: now }
            : p,
        ),
      );
      return true;
    },

    releasePlanEditSession: (projectId, userId) => {
      const project = get().projects.find((p) => p.id === projectId);
      if (!project) return;
      const next = releasePlanEditSessionDomain(project.planEditSession, userId);
      const now = new Date().toISOString();
      patch(set, get, (ps) =>
        ps.map((p) => {
          if (p.id !== projectId) return p;
          if (next === undefined) {
            const { planEditSession: _drop, ...rest } = p;
            return { ...rest, updatedAt: now };
          }
          return { ...p, planEditSession: next, updatedAt: now };
        }),
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

    setItemFloorStatus: (projectId, itemId, status) => {
      const project = get().projects.find((p) => p.id === projectId);
      if (!project) return;
      const item = project.items.find((it) => it.id === itemId);
      if (!item) return;
      const now = new Date().toISOString();
      // F092 — unified transition + audit event (manual path keeps arbitrary
      // targets for the Modules select; jumps are recorded in the note).
      const advance = advanceFloorStatus({
        projectId,
        itemId,
        current: item.floorStatus,
        target: status,
        allowJump: true,
        source: 'manual',
        now,
      });
      if (!advance.ok) return;
      let updated = setProjectItemFloorStatus(
        project,
        itemId,
        advance.status,
        now,
      );
      if (advance.event) updated = appendFloorEvent(updated, advance.event);
      if (updated === project) return;
      patch(set, get, (ps) =>
        ps.map((p) => (p.id === projectId ? updated : p)),
      );
    },

    recordProductionExport: (projectId) => {
      const project = get().projects.find((p) => p.id === projectId);
      if (!project) return;
      const now = new Date().toISOString();
      const updated = recordProductionExportDomain(project, now);
      patch(set, get, (ps) =>
        ps.map((p) => (p.id === projectId ? updated : p)),
      );
    },

    ensureProductionRevision: (projectId) => {
      const project = get().projects.find((p) => p.id === projectId);
      if (!project) return;
      if (project.status !== 'accepted' && project.status !== 'produced') return;
      const now = new Date().toISOString();
      const updated = ensureProductionRevisionDomain(project, now);
      if (updated === project) return;
      patch(set, get, (ps) =>
        ps.map((p) => (p.id === projectId ? updated : p)),
      );
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

    // --- Project Photos (CRM Phase 1) ---
    loadProjectPhotos: async (projectId: string) => {
      if (!options.deps.getProjectPhotos) return;
      try {
        const items = await options.deps.getProjectPhotos(projectId);
        set((state) => ({
          photos: { ...state.photos, [projectId]: items },
        }));
      } catch (err) {
        console.error('Error loading project photos:', err);
      }
    },

    uploadProjectPhotos: async (
      projectId: string,
      files: File[],
      stage: ProjectPhotoStage,
      caption?: string,
    ) => {
      if (!options.deps.uploadProjectPhoto) return;
      try {
        const uploaded = await Promise.all(
          files.map((f) => options.deps.uploadProjectPhoto!(projectId, f, stage, caption)),
        );
        set((state) => {
          const existing = state.photos[projectId] ?? [];
          return {
            photos: {
              ...state.photos,
              [projectId]: [...uploaded, ...existing],
            },
          };
        });
        toast({ type: 'success', message: `${files.length} foto(s) subida(s) con éxito` });
      } catch (err) {
        console.error('Error uploading project photos:', err);
        toast({ type: 'error', message: 'Error al subir fotos' });
      }
    },

    updateProjectPhoto: async (
      projectId: string,
      photoId: string,
      updates: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
    ) => {
      // Optimistic update
      set((state) => {
        const existing = state.photos[projectId] ?? [];
        const next = existing.map((p) => (p.id === photoId ? { ...p, ...updates } : p));
        return {
          photos: { ...state.photos, [projectId]: next },
        };
      });
      if (options.deps.updateProjectPhoto) {
        try {
          await options.deps.updateProjectPhoto(projectId, photoId, updates);
        } catch (err) {
          console.error('Error updating project photo:', err);
          void get().loadProjectPhotos(projectId);
        }
      }
    },

    deleteProjectPhoto: async (projectId: string, photoId: string) => {
      // Optimistic delete
      set((state) => {
        const existing = state.photos[projectId] ?? [];
        const next = existing.filter((p) => p.id !== photoId);
        return {
          photos: { ...state.photos, [projectId]: next },
        };
      });
      if (options.deps.deleteProjectPhoto) {
        try {
          await options.deps.deleteProjectPhoto(projectId, photoId);
          toast({ type: 'success', message: 'Foto eliminada' });
        } catch (err) {
          console.error('Error deleting project photo:', err);
          toast({ type: 'error', message: 'Error al eliminar foto' });
          void get().loadProjectPhotos(projectId);
        }
      }
    },

    // --- Internal Communications & Technical Handoff (CRM Phase 2) ---
    internalMessages: {},

    loadProjectMessages: async (projectId: string) => {
      if (!options.deps.getProjectInternalMessages) return;
      try {
        const msgs = await options.deps.getProjectInternalMessages(projectId);
        set((state) => ({
          internalMessages: {
            ...state.internalMessages,
            [projectId]: msgs,
          },
        }));
      } catch (err) {
        console.error('Failed to load project internal messages', err);
      }
    },

    sendProjectMessage: async (message) => {
      if (!options.deps.createProjectInternalMessage) return;
      try {
        const created = await options.deps.createProjectInternalMessage(message);
        set((state) => {
          const current = state.internalMessages[message.projectId] ?? [];
          return {
            internalMessages: {
              ...state.internalMessages,
              [message.projectId]: [...current, created],
            },
          };
        });
        toast({ type: 'success', message: 'Mensaje enviado correctamente' });
      } catch (err) {
        toast({
          type: 'error',
          message: `Error al enviar mensaje: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },

    updateProjectTechnicalWorkflow: async (projectId, updates) => {
      if (!options.deps.updateProjectTechnicalWorkflow) {
        patch(set, get, (prev) =>
          prev.map((p) => {
            if (p.id !== projectId) return p;
            return {
              ...p,
              assignedEngineerId:
                updates.assignedEngineerId !== undefined
                  ? updates.assignedEngineerId
                  : p.assignedEngineerId,
              technicalStatus: updates.technicalStatus ?? p.technicalStatus,
              surveyCompletedAt: updates.surveyCompletedAt ?? p.surveyCompletedAt,
              installationScheduledDate:
                updates.installationScheduledDate ?? p.installationScheduledDate,
              updatedAt: new Date().toISOString(),
            };
          }),
        );
        return;
      }
      try {
        const updated = await options.deps.updateProjectTechnicalWorkflow(
          projectId,
          updates,
        );
        patch(set, get, (prev) =>
          prev.map((p) => (p.id === projectId ? updated : p)),
        );

        if (options.deps.getProjectInternalMessages) {
          const msgs = await options.deps.getProjectInternalMessages(projectId);
          set((state) => ({
            internalMessages: {
              ...state.internalMessages,
              [projectId]: msgs,
            },
          }));
        }
        toast({ type: 'success', message: 'Flujo técnico actualizado' });
      } catch (err) {
        toast({
          type: 'error',
          message: `Error al actualizar flujo técnico: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },

    // --- Warranty Desk (CRM Phase 3) ---
    warranties: {},

    loadProjectWarranties: async (projectId: string) => {
      if (!options.deps.getWarrantyTickets) return;
      try {
        const tickets = await options.deps.getWarrantyTickets({ projectId });
        set((state) => ({
          warranties: {
            ...state.warranties,
            [projectId]: tickets,
          },
        }));
      } catch (err) {
        console.error('Failed to load project warranty tickets', err);
      }
    },

    createWarrantyTicket: async (ticket) => {
      if (!options.deps.createWarrantyTicket) return;
      try {
        const created = await options.deps.createWarrantyTicket(ticket);
        set((state) => {
          const current = state.warranties[ticket.projectId] ?? [];
          return {
            warranties: {
              ...state.warranties,
              [ticket.projectId]: [created, ...current],
            },
          };
        });
        toast({ type: 'success', message: 'Ticket de garantía creado' });
      } catch (err) {
        toast({
          type: 'error',
          message: `Error al crear ticket: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },

    updateWarrantyTicket: async (ticketId, updates) => {
      if (!options.deps.updateWarrantyTicket) return;
      try {
        const updated = await options.deps.updateWarrantyTicket(ticketId, updates);
        set((state) => {
          const projectId = updated.projectId;
          const current = state.warranties[projectId] ?? [];
          return {
            warranties: {
              ...state.warranties,
              [projectId]: current.map((t) => (t.id === ticketId ? updated : t)),
            },
          };
        });
        toast({ type: 'success', message: 'Ticket de garantía actualizado' });
      } catch (err) {
        toast({
          type: 'error',
          message: `Error al actualizar ticket: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },

    deleteWarrantyTicket: async (ticketId, projectId) => {
      if (!options.deps.deleteWarrantyTicket) return;
      try {
        await options.deps.deleteWarrantyTicket(ticketId);
        set((state) => {
          const current = state.warranties[projectId] ?? [];
          return {
            warranties: {
              ...state.warranties,
              [projectId]: current.filter((t) => t.id !== ticketId),
            },
          };
        });
        toast({ type: 'success', message: 'Ticket eliminado' });
      } catch (err) {
        toast({
          type: 'error',
          message: `Error al eliminar ticket: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },

    uploadWarrantyPhoto: async (ticketId, projectId, file, kind, caption) => {
      if (!options.deps.uploadWarrantyTicketPhoto) return;
      try {
        await options.deps.uploadWarrantyTicketPhoto(ticketId, file, { kind, caption });
        if (options.deps.getWarrantyTickets) {
          const tickets = await options.deps.getWarrantyTickets({ projectId });
          set((state) => ({
            warranties: {
              ...state.warranties,
              [projectId]: tickets,
            },
          }));
        }
        toast({ type: 'success', message: 'Foto adjuntada al ticket' });
      } catch (err) {
        toast({
          type: 'error',
          message: `Error al subir foto: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },

    exportWarrantyRefabricationOptimizer: async (ticket) => {
      try {
        const bytes = await exportWarrantyRefabricationOptimizer(ticket);
        const filename = warrantyRefabricationFilename(ticket);
        const blob = new Blob([bytes as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({ type: 'success', message: `Descargado: ${filename}` });
      } catch (err) {
        console.error('Error exportando re-corte a optimizer:', err);
        toast({
          type: 'error',
          message: `Error al exportar re-corte: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },

    // --- Showcase & Commercial Portfolio (CRM Phase 4) ---
    showcasePhotos: [],
    isLoadingShowcase: false,

    loadShowcasePhotos: async (onlyShowcase = false) => {
      if (!options.deps.listShowcasePhotos) return;
      set({ isLoadingShowcase: true });
      try {
        const photos = await options.deps.listShowcasePhotos(onlyShowcase);
        set({ showcasePhotos: photos, isLoadingShowcase: false });
      } catch (err) {
        console.error('Error loading showcase photos:', err);
        set({ isLoadingShowcase: false });
      }
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
