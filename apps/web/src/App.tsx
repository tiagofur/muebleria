/**
 * Thin web shell — holds catalog state; presentation lives in @muebles/ui.
 * Price formulas call @muebles/domain only here (not in UI package).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  Catalog,
  Component,
  Customer,
  EdgeBand,
  ExportIssue,
  Hardware,
  MaterialBoard,
  Module,
  ModuleCategory,
  ComponentPlacement,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
  ProjectMaterialSummary,
  ProjectStatus,
  ProjectTemplate,
  QuoteBreakdown,
  Structure,
  WorkshopSettings,
  Workspace,
} from '@muebles/domain';
import {
  applyRoleChoiceToProject,
  bumpStructureRevision,
  calcMaterialCostPerM2,
  calcProjectBreakdown,
  defaultMeasurePresetId,
  generateCutRows,
  generateHardwareList,
  generatePieceLabels,
  generateModuleLabels,
  generateProjectMaterialSummary,
  createEngineeringLog,
  duplicateModule as deepCopyModule,
  duplicateProject as deepCopyProject,
  projectToTemplate,
  createProjectFromTemplate,
  navIdsForRole,
  resolveOwnerOnCreate,
  resolveOwnerOnUpdate,
  resolveWorkshopSettings,
  roleCanAccessNav,
  roleCanAssignOwner,
  roleCanDeleteProject,
  canExportProductionForProject,
  roleCanExportProduction,
  roleCanMarkProduced,
  roleCanMutateCatalog,
  roleCanMutateModules,
  roleCanMutateProjects,
  roleCanReopenProject,
  roleCanViewCosts,
  roleCanViewPortfolioDashboard,
  computeWorkshopAnalytics,
  type AnalyticsPeriodDays,
  type WarrantyTicket,
  roleLabelEs,
  roleUsesProductionQueue,
  roleCanAccessProductionNav,
  roleIsScopedBySector,
  suggestDuplicateCode,
  transitionProjectStatus,
} from '@muebles/domain';


import {
  AppShell,
  EdgesCatalog,
  HardwareCatalog,
  AmbientMaterialsCatalog,
  MaterialsCatalog,
  ModulesScreen,
  ShowcaseScreen,
  OptionGroupsScreen,

  ProjectsScreen,
  ProductionWorkspace,
  PlantBoardScreen,
  FabricScreen,
  EngineeringScreen,
  EngineeringWorkspace,
  SalesDashboard,
  ProductionManagerDashboard,
  ProjectFloorProgressStrip,
  filterProductionVisible,
  parseProductionOrderTab,
  Dashboard,
  LoginScreen,
  RegisterScreen,
  SettingsScreen,
  UsersScreen,
  OnboardingTourModal,
  getHasSeenOnboardingTour,
  canShowPricePreview,
  canShowProjectPricePreview,
  aggregatePortfolioByOwner,
  countActiveMaterials,
  countActiveProjects,
  countModules,
  defaultOptionChoicesForModule,
  edgesFromFlags,
  parseOptionalNumber,
  requiredGroupCodesForModule,
  selectableGroupCodesForModule,
  resolveCustomerName,
  selectRecentProjects,
  sumMonthlyQuotedTotal,
  type AppNavId,
  type EdgeDraft,
  type HardwareDraft,
  type MaterialDraft,
  type ModuleDraft,
  type CategoryDraft,
  type OptionGroupDraft,
  type ProjectDraft,
  CustomersScreen,
  type CustomerDraft,
  StructuresScreen,
  type StructureDraft,
  ComponentsScreen,
  type ComponentDraft,
  AgregadosScreen,
  PageLoading,
  buildProductionOrderReadiness,
  type CommandPaletteItem,
} from '@muebles/ui';
import {
  APIWorkspaceRepository,
  LocalStorageWorkspaceRepository,
  breakdownFromApi,
  createSeedWorkspace,
} from '@muebles/storage';
import { buildCommercialQuoteExport } from './exportCommercialQuote';
import { buildCommercialQuotePdfExport } from './exportCommercialQuotePdf';
import { buildHardwareListExport } from './exportHardwareList';
import {
  buildPieceLabelsExport,
  type PieceLabelsExportOptions,
} from './exportPieceLabels';
import {
  buildModuleLabelsExport,
  type ModuleLabelsExportOptions,
} from './exportModuleLabels';
import { buildProductionPackExport } from './exportProductionPack';
import { buildWallElevationsExport } from './exportWallElevations';
import { buildCutListCsvExport } from './exportCutListCsv';
import { buildCncPilotExport } from './exportCncPilot';
import { buildAssemblySheetsExport } from './exportAssemblySheets';
import { buildCommercialScenarioPdfExport } from './exportScenarioPdf';
import {
  buildOptimizerExport,
  deliverExcelFile,
} from './exportOptimizer';
import {
  componentEditIdFromPath,
  entityIdFromPath,
  entityPath,
  engineeringProjectFromPath,
  engineeringProjectPath,
  isEntityEditPath,
  isEntitySection,
  moduleEditIdFromPath,
  moduleEditPath,
  navFromPath,
  pathForNav,
  productionOrderFromPath,
  productionOrderPath,
  projectPath,
  structureEditIdFromPath,
  type EntitySection,
} from './routes';
import {
  clearSession,
  DEFAULT_API_BASE,
  isAdminRole,
  loginRequest,
  readAuthToken,
  readAuthUser,
  readSessionMode,
  registerRequest,
  storeAuthToken,
  storeAuthUser,
  writeSessionMode,
  type SessionMode,
} from './session';
import {
  useCatalogStore,
  useWorkspaceStore,
  ensureCatalogStore,
  getCatalogStoreState,
  useProjectStore,
  ensureProjectStore,
  getProjectStoreState,
  useBackendBreakdownEffect,
  useUiStore,
} from './stores';
import { ToastViewport } from './components/ToastViewport';
import { BoardEditor } from './components/BoardEditor';


function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function optionalNotes(notes: string): string | undefined {
  const trimmed = notes.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * MOD-06: domain cost preview for a single saved module using default option choices.
 * Pure wiring in the shell — UI only receives QuoteBreakdown props.
 * Exported for unit tests (preset default + honest missing groups).
 */
export function computeModuleCostPreview(
  module: Module,
  catalog: Workspace['catalog'],
): {
  costPreview: QuoteBreakdown | null;
  previewBlocked: boolean;
  missingGroups: readonly string[];
  previewError: string | null;
} {
  const required = requiredGroupCodesForModule(module, catalog.optionGroups, catalog.components, catalog.structures);
  const choices = defaultOptionChoicesForModule(
    module,
    catalog.optionGroups,
    catalog.components,
    catalog.structures,
    catalog.agregados,
  ) as OptionChoices;
  const gate = canShowPricePreview(required, choices);
  if (!gate.ok) {
    return {
      costPreview: null,
      previewBlocked: true,
      missingGroups: gate.missingGroups,
      previewError: null,
    };
  }

  const now = new Date().toISOString();
  const project: Project = {
    id: 'module-preview-project',
    name: 'Preview módulo',
    customerId: 'Preview',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [
      {
        id: 'module-preview-item',
        moduleId: module.id,
        quantity: 1,
        optionChoices: choices,
        // Modules with commercial presets demand a selection — preview with
        // the default one (first), like the add-item flow does.
        measurePresetId: defaultMeasurePresetId(module),
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  try {
    const costPreview = calcProjectBreakdown(project, catalog);
    return { costPreview, previewBlocked: false, missingGroups: [], previewError: null };
  } catch (e) {
    // Honest missing list: every used group (required or optional) without a
    // default choice — NOT a blanket dump of all required groups, which
    // pointed users at groups that were fine (F087 follow-up).
    const selectable = selectableGroupCodesForModule(
      module,
      catalog.optionGroups,
      catalog.components,
      catalog.structures,
      catalog.agregados,
    );
    const missing = selectable.filter((code) => !choices[code]?.trim());
    return {
      costPreview: null,
      previewBlocked: true,
      missingGroups: missing,
      previewError: e instanceof Error ? e.message : null,
    };
  }
}

/**
 * Prefer an existing catalog customer id from the draft. Only create when the
 * "Nuevo cliente" path sends a name without a selected id.
 * Stores Project.customerId, never free-text on Project.
 */
// F063: resolveCustomerFromDraft + draftToProjectMeta moved to projectStore.


/**
 * Unify list-card estimate vs detail totals (same project must show the same
 * sale price). List always uses local domain (`projectEstimates` / F022).
 *
 * - With costs visible (admin/guest): prefer local so detail matches the list
 *   and does not "jump" when the backend calculate response arrives.
 * - Cost-redacted roles (vendedor): catalog unit prices are zeroed client-side,
 *   so the server salePrice is authoritative when present.
 * - Fallbacks: local → remote → null.
 */
export function resolveDisplayBreakdown(
  local: QuoteBreakdown | null,
  remote: QuoteBreakdown | null,
  showCosts: boolean,
): QuoteBreakdown | null {
  if (!showCosts && remote) return remote;
  return local ?? remote;
}

/**
 * PRJ-06 / UX-03: domain breakdown for the selected project when option gate is open.
 */
function computeSelectedProjectBreakdown(
  project: Project | undefined,
  catalog: Workspace['catalog'],
): {
  breakdown: QuoteBreakdown | null;
  previewBlocked: boolean;
  missingGroups: readonly string[];
  /** Human-readable reason when the breakdown threw (missing ref, bad dims, …). */
  breakdownError: string | null;
} {
  if (!project) {
    return { breakdown: null, previewBlocked: false, missingGroups: [], breakdownError: null };
  }
  if (project.items.length === 0) {
    return { breakdown: null, previewBlocked: false, missingGroups: [], breakdownError: null };
  }

  const gate = canShowProjectPricePreview(
    project,
    catalog.modules,
    catalog.optionGroups,
    catalog.components,
    catalog.structures,
  );
  if (!gate.ok) {
    return {
      breakdown: null,
      previewBlocked: true,
      missingGroups: gate.missingGroups,
      breakdownError: null,
    };
  }

  try {
    const breakdown = calcProjectBreakdown(project, catalog);
    return { breakdown, previewBlocked: false, missingGroups: [], breakdownError: null };
  } catch (e) {
    // Preserve the engine's message so the user sees *why* the quote is
    // blocked (missing material, invalid dims, …) instead of a generic wall.
    const reason =
      e instanceof Error
        ? e.message
        : 'No se pudo calcular el presupuesto.';
    return {
      breakdown: null,
      previewBlocked: true,
      missingGroups: [],
      breakdownError: reason,
    };
  }
}

/** Thin web shell — wiring only; cost formulas only via domain engine. */
export function App(): ReactNode {
  // F064: ToastViewport reads from uiStore and portals toasts to document.body.
  // No ToastProvider wrapper — uiStore is the single source of truth.
  return (
    <>
      <SessionGate />
      <ToastViewport />
    </>
  );
}

/**
 * Login gate: session null → LoginScreen | RegisterScreen;
 * guest|auth → workspace app. Reads session/auth state from workspaceStore
 * (F057). No local state — just wiring.
 */
function SessionGate(): ReactNode {
  const session = useWorkspaceStore((s) => s.session);
  const authGate = useWorkspaceStore((s) => s.authGate);
  const loginLoading = useWorkspaceStore((s) => s.loginLoading);
  const loginError = useWorkspaceStore((s) => s.loginError);
  const registerLoading = useWorkspaceStore((s) => s.registerLoading);
  const registerError = useWorkspaceStore((s) => s.registerError);
  const setAuthGate = useWorkspaceStore((s) => s.setAuthGate);
  const clearAuthErrors = useWorkspaceStore((s) => s.clearAuthErrors);
  const enterAsGuest = useWorkspaceStore((s) => s.enterAsGuest);
  const login = useWorkspaceStore((s) => s.login);
  const register = useWorkspaceStore((s) => s.register);
  const logout = useWorkspaceStore((s) => s.logout);
  const sessionEndReason = useWorkspaceStore((s) => s.sessionEndReason);

  if (session === null) {
    if (authGate === 'register') {
      return (
        <RegisterScreen
          onRegister={register}
          onBack={() => {
            setAuthGate('login');
            clearAuthErrors();
          }}
          loading={registerLoading}
          error={registerError}
        />
      );
    }
    return (
      <LoginScreen
        onLogin={login}
        onGuestAccess={enterAsGuest}
        onRegister={() => {
          clearAuthErrors();
          setAuthGate('register');
        }}
        loading={loginLoading}
        error={loginError}
        notice={
          sessionEndReason === 'expired'
            ? 'Tu sesión expiró. Volvé a iniciar sesión para continuar donde estabas.'
            : null
        }
      />
    );
  }

  return <AppContent session={session} onLogout={logout} />;
}

function AppContent({
  session,
  onLogout,
}: {
  readonly session: SessionMode;
  readonly onLogout: () => void;
}): ReactNode {
  // F064: toast comes from uiStore (no more Provider/context).
  const toast = useUiStore((s) => s.toast);
  // F057: workspace lifecycle state lives in workspaceStore.
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspaceLoadError = useWorkspaceStore((s) => s.workspaceLoadError);
  const assignableOwners = useWorkspaceStore((s) => s.assignableOwners);
  // Latest workspace for patches — avoids stale closures (#15).
  // Still maintained locally until F062/F063 move catalog/projects to their
  // own stores; keep in sync with the store.
  const workspaceRef = useRef<Workspace | null>(workspace);
  workspaceRef.current = workspace;
  const setWorkspaceFromStore = useWorkspaceStore((s) => s.setWorkspace);
  const setWorkspaceLoadError = useWorkspaceStore(
    (s) => s.setWorkspaceLoadError,
  );
  const loadWorkspace = useWorkspaceStore((s) => s.loadWorkspace);
  const loadAssignableOwners = useWorkspaceStore(
    (s) => s.loadAssignableOwners,
  );
  /**
   * Wrapper that accepts both a direct value and an updater function — many
   * catalog/project handlers use the `setWorkspace((prev) => ...)` pattern.
   * The store action only accepts direct values; we read latest state via
   * `getState()` to avoid stale closures. (F062/F063 will deprecate this
   * pattern entirely when catalog/project mutations move to their own stores.)
   */
  const setWorkspace = useCallback(
    (
      next:
        | Workspace
        | null
        | ((prev: Workspace | null) => Workspace | null),
    ) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: Workspace | null) => Workspace | null)(
              useWorkspaceStore.getState().workspace,
            )
          : next;
      setWorkspaceFromStore(resolved);
      workspaceRef.current = resolved;
    },
    [setWorkspaceFromStore],
  );
  const getAuthToken = useWorkspaceStore((s) => s.getAuthToken);
  const getAuthUser = useWorkspaceStore((s) => s.getAuthUser);
  const getRepository = useWorkspaceStore((s) => s.getRepository);
  const saveWorkshopSettingsAction = useWorkspaceStore(
    (s) => s.saveWorkshopSettings,
  );
  const resolveMediaUrlFromStore = useWorkspaceStore((s) => s.resolveMediaUrl);
  const uploadCatalogImageFromStore = useWorkspaceStore(
    (s) => s.uploadCatalogImage,
  );

  // --- F062: catalogStore init + sync ---
  // catalogStore owns the catalog slice; workspaceStore drops it.
  // Init runs in the component body (NOT a useEffect) so the store exists
  // before any `useCatalogStore()` hook reads from it on first render.
  // `ensureCatalogStore` is idempotent — safe to call every render.
  ensureCatalogStore({
    newId,
    saveCatalog: (c) => getRepository().saveCatalog(c) as Promise<void>,
    getAuthToken: () => useWorkspaceStore.getState().getAuthToken(),
    getSession: () => useWorkspaceStore.getState().session,
    getDraftProjectsCount: () =>
      // F063: projectStore owns projects now; read via getState().
      (
        getProjectStoreState().projects ?? []
      ).filter((p) => p.status === 'draft').length,
    baseUrl: DEFAULT_API_BASE,
  });
  const catalog = useCatalogStore((s) => s.catalog);
  const catalogActions = useCatalogStore();
  // Keep catalogStore in sync with workspace load (one-way: workspace → catalog).
  useEffect(() => {
    if (workspace?.catalog) {
      getCatalogStoreState().setCatalog(workspace.catalog);
    } else {
      getCatalogStoreState().setCatalog(null);
    }
  }, [workspace]);

  // --- F063: projectStore init + sync ---
  // projectStore owns projects + projectTemplates + backend breakdown.
  // Init in body (idempotent) so hooks read a populated store on first paint.
  ensureProjectStore({
    newId,
    createProject: (p) => getRepository().createProject(p) as Promise<void>,
    saveProject: (p) => getRepository().saveProject(p) as Promise<void>,
    deleteProject: (id) => getRepository().deleteProject(id) as Promise<void>,
    createProjectTemplate: (t) =>
      getRepository().createProjectTemplate(t) as Promise<void>,
    deleteProjectTemplate: (id) =>
      getRepository().deleteProjectTemplate(id) as Promise<void>,
    getAuthToken: () => useWorkspaceStore.getState().getAuthToken(),
    baseUrl: DEFAULT_API_BASE,
    getProjectPhotos: (id) => {
      const repo = getRepository();
      return repo?.getProjectPhotos ? repo.getProjectPhotos(id) : Promise.resolve([]);
    },
    uploadProjectPhoto: (id, file, stage, caption) => {
      const repo = getRepository();
      return repo?.uploadProjectPhoto
        ? repo.uploadProjectPhoto(id, file, { stage, caption })
        : Promise.reject(new Error('No storage'));
    },
    updateProjectPhoto: (id, photoId, updates) => {
      const repo = getRepository();
      return repo?.updateProjectPhoto
        ? repo.updateProjectPhoto(id, photoId, updates)
        : Promise.reject(new Error('No storage'));
    },
    deleteProjectPhoto: (id, photoId) => {
      const repo = getRepository();
      return repo?.deleteProjectPhoto
        ? repo.deleteProjectPhoto(id, photoId)
        : Promise.resolve();
    },
    getProjectInternalMessages: (id) => {
      const repo = getRepository();
      return repo?.getProjectInternalMessages ? repo.getProjectInternalMessages(id) : Promise.resolve([]);
    },
    createProjectInternalMessage: (msg) => {
      const repo = getRepository();
      return repo?.createProjectInternalMessage
        ? repo.createProjectInternalMessage(msg)
        : Promise.reject(new Error('No storage'));
    },
    updateProjectTechnicalWorkflow: (id, updates) => {
      const repo = getRepository();
      return repo?.updateProjectTechnicalWorkflow
        ? repo.updateProjectTechnicalWorkflow(id, updates)
        : Promise.reject(new Error('No storage'));
    },
    getWarrantyTickets: (filter) => {
      const repo = getRepository();
      return repo?.getWarrantyTickets ? repo.getWarrantyTickets(filter) : Promise.resolve([]);
    },
    createWarrantyTicket: (ticket) => {
      const repo = getRepository();
      return repo?.createWarrantyTicket
        ? repo.createWarrantyTicket(ticket)
        : Promise.reject(new Error('No storage'));
    },
    updateWarrantyTicket: (id, updates) => {
      const repo = getRepository();
      return repo?.updateWarrantyTicket
        ? repo.updateWarrantyTicket(id, updates)
        : Promise.reject(new Error('No storage'));
    },
    deleteWarrantyTicket: (id) => {
      const repo = getRepository();
      return repo?.deleteWarrantyTicket
        ? repo.deleteWarrantyTicket(id)
        : Promise.resolve();
    },
    uploadWarrantyTicketPhoto: (ticketId, file, data) => {
      const repo = getRepository();
      return repo?.uploadWarrantyTicketPhoto
        ? repo.uploadWarrantyTicketPhoto(ticketId, file, data)
        : Promise.reject(new Error('No storage'));
    },
    listShowcasePhotos: (onlyShowcase) => {
      const repo = getRepository();
      return repo?.listShowcasePhotos
        ? repo.listShowcasePhotos(onlyShowcase)
        : Promise.resolve([]);
    },
  });

  const projects = useProjectStore((s) => s.projects);
  const projectTemplates = useProjectStore((s) => s.projectTemplates);
  const showcasePhotos = useProjectStore((s) => s.showcasePhotos);
  const isLoadingShowcase = useProjectStore((s) => s.isLoadingShowcase);
  const projectActions = useProjectStore();

  // Keep projectStore in sync with workspace load (one-way: workspace → projectStore).
  // Project mutations go through projectStore only; workspace.projects becomes
  // stale after first mutation (intentional — F064 will fully decouple workspace).
  useEffect(() => {
    if (workspace?.projects) {
      getProjectStoreState().setProjects(workspace.projects);
      getProjectStoreState().setProjectTemplates(
        workspace.projectTemplates ?? [],
      );
    } else {
      getProjectStoreState().setProjects([]);
      getProjectStoreState().setProjectTemplates([]);
    }
  }, [workspace]);

  const authUser = useMemo(
    () => (session === 'auth' ? getAuthUser() : null),
    [session, getAuthUser],
  );
  const authToken = useMemo(
    () => (session === 'auth' ? getAuthToken() : null),
    [session, getAuthToken],
  );
  const showAdminUsers = session === 'auth' && isAdminRole(authUser?.role);
  const canAssignOwner = roleCanAssignOwner(authUser?.role);
  /** Guest (local) has full tool; auth uses product RBAC (F035). */
  const actorRole = session === 'auth' ? authUser?.role : null;
  const allowedNavIds = useMemo(
    () => navIdsForRole(session === 'auth' ? authUser?.role : null),
    [session, authUser?.role],
  );
  // F094 — own station assignments (Mi Estación). Loaded for scoped
  // operator roles; null = unrestricted / local mode.
  const isSectorScoped = roleIsScopedBySector(actorRole);
  const [mySectors, setMySectors] = useState<string[] | null>(null);
  useEffect(() => {
    if (session !== 'auth' || !isSectorScoped) {
      setMySectors(null);
      return;
    }
    const repo = getRepository();
    if (!repo.getMySectors) {
      setMySectors(null);
      return;
    }
    let cancelled = false;
    repo
      .getMySectors()
      .then((sectors) => {
        if (cancelled) return;
        setMySectors(sectors.map((s) => s.sector));
      })
      .catch(() => {
        if (!cancelled) setMySectors(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session, isSectorScoped]);
  const canMutateCatalog =
    session === 'guest' || roleCanMutateCatalog(actorRole);
  const canMutateModules =
    session === 'guest' || roleCanMutateModules(actorRole);
  const canMutateProjects =
    session === 'guest' || roleCanMutateProjects(actorRole);
  const canDeleteProjects =
    session === 'guest' || roleCanDeleteProject(actorRole);
  const canReopenProjects =
    session === 'guest' || roleCanReopenProject(actorRole);
  /** accepted/produced → draft: admin + gerente only (vendedor never). */
  const canForceReopenClosed =
    session === 'guest' ||
    actorRole === 'admin' ||
    actorRole === 'gerente_ventas';
  const canMarkProduced =
    session === 'guest' || roleCanMarkProduced(actorRole);
  const canExportProduction =
    session === 'guest' || roleCanExportProduction(actorRole);
  const canViewPortfolioDashboard =
    session === 'guest' || roleCanViewPortfolioDashboard(actorRole);
  /** F038: producción role only sees plant-ready quotes in project list. */
  const filterProjectsToPlant =
    session === 'auth' && roleUsesProductionQueue(actorRole);
  /** PROD-0.1: factory workspace nav (export roles). */
  const useProductionWorkspace =
    session === 'auth' && roleCanAccessProductionNav(actorRole);
  const repository = useMemo(
    () => getRepository(),
    [getRepository],
  );

  useEffect(() => {
    if (!canAssignOwner || !authToken) {
      // Store keeps last value; we don't auto-clear here to avoid races —
      // loadAssignableOwners short-circuits when not authed.
      return;
    }
    // loadAssignableOwners handles fetch + fallback + filtering.
    void loadAssignableOwners();
  }, [canAssignOwner, authToken, authUser, loadAssignableOwners]);

  const ownerLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of assignableOwners) {
      map[u.id] = u.name;
    }
    if (authUser) {
      map[authUser.id] = authUser.name || authUser.email;
    }
    return map;
  }, [assignableOwners, authUser]);

  // Load workspace from repository on session change.
  // Note: catalog/projects mutations still go through local `workspace` state
  // below (until F062/F063 move them to their own stores). We sync via
  // setWorkspace from the store after load.
  useEffect(() => {
    if (session === null) return;
    setWorkspace(null);
    setWorkspaceLoadError(null);
    void loadWorkspace();
  }, [session, loadWorkspace, setWorkspace, setWorkspaceLoadError]);

  const location = useLocation();
  const navigate = useNavigate();
  const locationPathnameRef = useRef(location.pathname);
  locationPathnameRef.current = location.pathname;

  // Fase 3 slice 3.5: detect ?present=projectId for shared presentation links.
  const presentId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('present') ?? null;
  }, [location.search]);
  const navId: AppNavId = navFromPath(location.pathname) ?? 'home';
  const routeEntityId =
    isEntitySection(navId)
      ? entityIdFromPath(location.pathname, navId)
      : null;
  const routeProjectId =
    navId === 'projects' ? routeEntityId : null;
  const routeModuleId = navId === 'modules' ? routeEntityId : null;
  const routeStructureId = navId === 'structures' ? routeEntityId : null;
  const routeComponentId = navId === 'components' ? routeEntityId : null;
  const productionOrderRoute =
    navId === 'production' ? productionOrderFromPath(location.pathname) : null;
  const routeProductionOrderId = productionOrderRoute?.projectId ?? null;
  const routeProductionOrderTab = parseProductionOrderTab(
    productionOrderRoute?.tab ?? 'resumen',
  );
  const routeEngineeringProjectId =
    navId === 'engineering' ? engineeringProjectFromPath(location.pathname) : null;
  // Fase 3 UI: editor routes /section/:id/edit (separate from view /section/:id).
  const routeModuleEditId =
    navId === 'modules' ? moduleEditIdFromPath(location.pathname) : null;
  const routeStructureEditId =
    navId === 'structures' ? structureEditIdFromPath(location.pathname) : null;
  const routeComponentEditId =
    navId === 'components' ? componentEditIdFromPath(location.pathname) : null;

  // Keep the address bar on a known section path (bookmarkable SPA routes).
  useEffect(() => {
    const resolved = navFromPath(location.pathname);
    if (resolved === null) {
      navigate(pathForNav('home'), { replace: true });
      return;
    }
    if (session === 'auth' && !roleCanAccessNav(actorRole, resolved)) {
      toast({
        type: 'error',
        message:
          'No tenés permiso para esta sección. Pedile a un admin que te asigne el puesto correcto.',
      });
      navigate(pathForNav('home'), { replace: true });
    }
  }, [location.pathname, navigate, session, actorRole, toast]);

  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [showOnboardingTour, setShowOnboardingTour] = useState(false);

  // Welcome tour auto-opens at Inicio only — never above factory routes
  // (/produccion) or deep links. Any dismiss persists (see modal).
  useEffect(() => {
    if (navId === 'home' && !getHasSeenOnboardingTour()) {
      setShowOnboardingTour(true);
    }
  }, [navId]);

  // Load commercial portfolio photos when visiting showcase
  useEffect(() => {
    if (navId === 'showcase') {
      getProjectStoreState().loadShowcasePhotos();
    }
  }, [navId]);


  const handleLoadCocinaLopezDemo = useCallback(() => {
    const targetPath = projectPath('proj-cocina-lopez-demo');
    if (location.pathname !== targetPath) {
      navigate(targetPath);
    }
  }, [location.pathname, navigate]);

  // Gap #1: BoardEditor overrides bridge — the editor reports pose/dim edits,
  // merged into the module draft on save.
  const [boardOverrides, setBoardOverrides] = useState<Readonly<Record<string, unknown>>>({});
  const handleOverridesChange = useCallback(
    (overrides: Readonly<Record<string, unknown>>) => {
      setBoardOverrides(overrides);
    },
    [],
  );
  // Reset overrides when switching/closing the module editor.
  useEffect(() => {
    if (!editingModuleId) setBoardOverrides({});
  }, [editingModuleId]);
  // Calculate / export target follows URL detail when present.
  const selectedProjectId = routeProjectId;
  // F064: export UI + create keys live in uiStore.
  const exportErrors = useUiStore((s) => s.exportErrors);
  const exportBusy = useUiStore((s) => s.exportBusy);
  const setExportErrors = useUiStore((s) => s.setExportErrors);
  const setExportBusy = useUiStore((s) => s.setExportBusy);
  const projectsCreateKey = useUiStore((s) => s.projectsCreateKey);
  const bumpProjectsCreateKey = useUiStore((s) => s.bumpProjectsCreateKey);
  const modulesCreateKey = useUiStore((s) => s.modulesCreateKey);
  const bumpModulesCreateKey = useUiStore((s) => s.bumpModulesCreateKey);
  const materialsCreateKey = useUiStore((s) => s.materialsCreateKey);
  const bumpMaterialsCreateKey = useUiStore((s) => s.bumpMaterialsCreateKey);

  // F063: backend breakdown state lives in projectStore; hook drives fetch.
  const backendBreakdown = useProjectStore((s) => s.backendBreakdown);
  const breakdownLoading = useProjectStore((s) => s.breakdownLoading);
  const breakdownError = useProjectStore((s) => s.breakdownError);

  const selectedProject = useMemo(() => {
    if (!projects) return undefined;
    return projects.find((p) => p.id === selectedProjectId);
  }, [projects, selectedProjectId]);

  useBackendBreakdownEffect(selectedProjectId, selectedProject, session);

  useEffect(() => {
    if (selectedProjectId) {
      void getProjectStoreState().loadProjectPhotos(selectedProjectId);
      void getProjectStoreState().loadProjectMessages(selectedProjectId);
      void getProjectStoreState().loadProjectWarranties(selectedProjectId);
    }
  }, [selectedProjectId]);

  const selectedProjectCutRows = useMemo(() => {
    if (!selectedProject || !catalog) return [];
    try {
      return generateCutRows(selectedProject, catalog);
    } catch {
      return [];
    }
  }, [selectedProject, catalog]);




  // Derive catalog slices safely so hooks below always run (Rules of Hooks).
  // Early return for loading MUST stay after every useCallback/useMemo.
  // F062: catalog now lives in catalogStore; workspace still owns projects.
  const materials = catalog?.materials ?? [];
  const edges = catalog?.edges ?? [];
  const hardware = catalog?.hardware ?? [];
  const ambientMaterials = catalog?.ambientMaterials ?? [];
  const ambientCategories = catalog?.ambientCategories ?? [];
  const optionGroups = catalog?.optionGroups ?? [];
  const modules = catalog?.modules ?? [];
  const structures = catalog?.structures ?? [];
  const agregados = catalog?.agregados ?? [];
  const components = catalog?.components ?? [];
  const categories = catalog?.categories ?? [];
  const customers = catalog?.customers ?? [];
  // F063: `projects` and `projectTemplates` come from projectStore (line above).
  /** F038: producción only works accepted/produced quotes. */
  const projectsForRole = useMemo(
    () =>
      filterProjectsToPlant ? filterProductionVisible(projects) : projects,
    [filterProjectsToPlant, projects],
  );
  const workshopSettings = resolveWorkshopSettings(workspace?.settings);
  /** Guest/local: full costs; auth uses COST-01 + COST-02 flag (F039/F044). */
  const showCosts =
    session === 'guest' ||
    roleCanViewCosts(actorRole, {
      vendedorCanViewCosts: workshopSettings.vendedorCanViewCosts,
    });

  const modulePreview = useMemo(() => {
    if (!editingModuleId || !catalog) {
      return {
        costPreview: null as QuoteBreakdown | null,
        previewBlocked: false,
        missingGroups: [] as readonly string[],
        previewError: null as string | null,
      };
    }
    const mod = modules.find((m) => m.id === editingModuleId);
    if (!mod) {
      return {
        costPreview: null,
        previewBlocked: true,
        missingGroups: [] as readonly string[],
        previewError: null as string | null,
      };
    }
    return computeModuleCostPreview(mod, catalog);
  }, [editingModuleId, modules, catalog]);

  /** Sale-price estimates for module cards — domain only in the shell (F021). */
  const moduleEstimates = useMemo(() => {
    const map: Record<string, number | null> = {};
    if (!catalog) return map;
    for (const mod of modules) {
      const preview = computeModuleCostPreview(mod, catalog);
      map[mod.id] = preview.costPreview?.salePrice ?? null;
    }
    return map;
  }, [modules, catalog]);

  const projectQuote = useMemo(
    () =>
      catalog
        ? computeSelectedProjectBreakdown(selectedProject, catalog)
        : {
            breakdown: null as QuoteBreakdown | null,
            previewBlocked: false,
            missingGroups: [] as readonly string[],
            breakdownError: null as string | null,
          },
    [selectedProject, catalog],
  );

  /** F047: m² / herrajes summary — same gate as price preview. */
  const materialSummary = useMemo((): ProjectMaterialSummary | null => {
    if (!catalog || !selectedProject) return null;
    if (projectQuote.previewBlocked || !projectQuote.breakdown) return null;
    try {
      return generateProjectMaterialSummary(selectedProject, catalog);
    } catch {
      return null;
    }
  }, [catalog, selectedProject, projectQuote.previewBlocked, projectQuote.breakdown]);

  /** Sale-price estimates for project cards — domain only in the shell (F022). */
  const projectEstimates = useMemo(() => {
    const map: Record<string, number | null> = {};
    if (!catalog) return map;
    for (const project of projects) {
      if (project.priceSnapshot) {
        map[project.id] = project.priceSnapshot.breakdown.salePrice;
        continue;
      }
      const quote = computeSelectedProjectBreakdown(project, catalog);
      map[project.id] = quote.breakdown?.salePrice ?? null;
    }
    return map;
  }, [projects, catalog]);

  /**
   * Dashboard stats + recent list (F023).
   * monthlyQuotedTotal: sum of sale prices for quoted/accepted projects whose
   * updatedAt falls in the current calendar month (uses projectEstimates /
   * priceSnapshot — domain engine only in shell).
   */
  const dashboardStats = useMemo(
    () => ({
      activeProjects: countActiveProjects(projects),
      monthlyQuotedTotal: sumMonthlyQuotedTotal(projects, projectEstimates),
      modulesCount: countModules(modules),
      activeMaterials: countActiveMaterials(materials),
    }),
    [projects, projectEstimates, modules, materials],
  );

  const dashboardRecent = useMemo(() => {
    return selectRecentProjects(projects, 5).map((project) => ({
      id: project.id,
      name: project.name,
      customerLabel: resolveCustomerName(project.customerId, customers),
      status: project.status,
      updatedAt: project.updatedAt,
      salePrice: projectEstimates[project.id] ?? null,
    }));
  }, [projects, customers, projectEstimates]);

  /** F037: multi-owner portfolio table for gerente/admin only. */
  const dashboardOwnerBreakdown = useMemo(() => {
    if (!canViewPortfolioDashboard) return undefined;
    return aggregatePortfolioByOwner(
      projects,
      projectEstimates,
      assignableOwners,
      (role) => roleLabelEs(role),
    );
  }, [
    canViewPortfolioDashboard,
    projects,
    projectEstimates,
    assignableOwners,
  ]);

  /** F090: workshop analytics — funnel + warranties for gerente/admin. */
  const [analyticsPeriod, setAnalyticsPeriod] =
    useState<AnalyticsPeriodDays>('all');
  const [warrantyTickets, setWarrantyTickets] = useState<
    readonly WarrantyTicket[] | null
  >(null);
  useEffect(() => {
    if (!canViewPortfolioDashboard) return;
    let cancelled = false;
    const repo = getRepository();
    if (!repo?.getWarrantyTickets) {
      setWarrantyTickets([]);
      return;
    }
    repo
      .getWarrantyTickets()
      .then((tickets) => {
        if (!cancelled) setWarrantyTickets(tickets);
      })
      .catch(() => {
        if (!cancelled) setWarrantyTickets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canViewPortfolioDashboard, getRepository]);

  const workshopAnalytics = useMemo(() => {
    if (!canViewPortfolioDashboard) return undefined;
    return computeWorkshopAnalytics(projects, warrantyTickets ?? [], {
      period: analyticsPeriod,
    });
  }, [canViewPortfolioDashboard, projects, warrantyTickets, analyticsPeriod]);

  const onDashboardOpenProject = useCallback(
    (projectId: string) => {
      navigate(projectPath(projectId));
    },
    [navigate],
  );

  const onDashboardNewProject = useCallback(() => {
    bumpProjectsCreateKey();
    navigate(pathForNav('projects'));
  }, [navigate]);

  const onDashboardNewModule = useCallback(() => {
    bumpModulesCreateKey();
    navigate(pathForNav('modules'));
  }, [navigate]);

  const onDashboardNewMaterial = useCallback(() => {
    bumpMaterialsCreateKey();
    navigate(pathForNav('materials'));
  }, [navigate]);

  const onDashboardOpenShowcase = useCallback(() => {
    navigate(pathForNav('showcase'));
  }, [navigate]);

  const onDashboardOpenMaterials = useCallback(() => {
    navigate(pathForNav('materials'));
  }, [navigate]);

  const onDashboardOpenModules = useCallback(() => {
    navigate(pathForNav('modules'));
  }, [navigate]);

  const onShowcaseUseInQuote = useCallback(
    (moduleId: string) => {
      const mod = modules.find((m) => m.id === moduleId);
      bumpProjectsCreateKey();
      navigate(pathForNav('projects'));
      toast({
        type: 'info',
        message: mod
          ? `Nueva cotización: agregá «${mod.name}» (${mod.code}) con Agregar mueble.`
          : 'Nueva cotización: agregá el mueble desde Agregar mueble.',
      });
    },
    [modules, navigate, toast],
  );

  const onShowcaseUseProjectAsReference = useCallback(
    (projectId: string) => {
      const proj = projects.find((p) => p.id === projectId);
      bumpProjectsCreateKey();
      navigate(pathForNav('projects'));
      toast({
        type: 'info',
        message: proj
          ? `Nueva cotización inspirada en «${proj.name}».`
          : 'Nueva cotización iniciada desde el portafolio.',
      });
    },
    [projects, navigate, toast],
  );


  const dashboardHomeMode = useMemo(():
    | 'default'
    | 'sales'
    | 'engineering' => {
    if (session !== 'auth' || !actorRole) return 'default';
    if (actorRole === 'vendedor') return 'sales';
    if (actorRole === 'ingeniero') return 'engineering';
    return 'default';
  }, [session, actorRole]);

  const modulesWithoutPhotoCount = useMemo(
    () => modules.filter((m) => !m.imageUrl).length,
    [modules],
  );

  /** Recent entities for Cmd+K palette (issue #54). */
  const commandItems = useMemo((): CommandPaletteItem[] => {
    const projectItems: CommandPaletteItem[] = selectRecentProjects(
      projects,
      12,
    ).map((p) => ({
      id: `project:${p.id}`,
      label: p.name,
      group: 'Cotizaciones',
      keywords: resolveCustomerName(p.customerId, customers),
    }));
    const moduleItems: CommandPaletteItem[] = [...modules]
      .slice(0, 12)
      .map((m) => ({
        id: `module:${m.id}`,
        label: `${m.code} — ${m.name}`,
        group: 'Muebles',
        keywords: m.code,
      }));
    return [...projectItems, ...moduleItems];
  }, [projects, modules, customers]);

  const onCommandItem = useCallback(
    (id: string) => {
      if (id.startsWith('project:')) {
        navigate(projectPath(id.slice('project:'.length)));
        return;
      }
      if (id.startsWith('module:')) {
        navigate(entityPath('modules', id.slice('module:'.length)));
      }
    },
    [navigate],
  );

  const groupLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of optionGroups) {
      map[g.code] = `${g.name} (${g.code})`;
    }
    return map;
  }, [optionGroups]);

  const getMaterialCostPerM2 = useCallback(
    (input: {
      widthMm: number;
      lengthMm: number;
      boardPrice: number;
      wastePercent: number;
    }) =>
      calcMaterialCostPerM2(
        input.widthMm,
        input.lengthMm,
        input.boardPrice,
        input.wastePercent,
      ),
    [],
  );

  // F062: catalog handlers delegate to catalogStore. App.tsx no longer owns
  // the catalog reducer wrapper, draftToModule/Structure/Component mappers, or
  // workspaceRef reads for catalog — they live in the store + catalogMappers.
  const createMaterial = catalogActions.createMaterial;
  const updateMaterial = catalogActions.updateMaterial;
  const setMaterialActive = catalogActions.setMaterialActive;
  const createEdge = catalogActions.createEdge;
  const updateEdge = catalogActions.updateEdge;
  const setEdgeActive = catalogActions.setEdgeActive;
  const createHardware = catalogActions.createHardware;
  const updateHardware = catalogActions.updateHardware;
  const setHardwareActive = catalogActions.setHardwareActive;
  const createAmbientMaterial = catalogActions.createAmbientMaterial;
  const updateAmbientMaterial = catalogActions.updateAmbientMaterial;
  const setAmbientMaterialActive = catalogActions.setAmbientMaterialActive;
  const createAmbientCategory = catalogActions.createAmbientCategory;
  const updateAmbientCategory = catalogActions.updateAmbientCategory;
  const deleteAmbientCategory = catalogActions.deleteAmbientCategory;
  const createOptionGroup = catalogActions.createOptionGroup;
  const updateOptionGroup = catalogActions.updateOptionGroup;
  const deleteOptionGroup = catalogActions.deleteOptionGroup;
  const createCategory = catalogActions.createCategory;
  const updateCategory = catalogActions.updateCategory;
  const deleteCategory = catalogActions.deleteCategory;
  const createModule = catalogActions.createModule;
  const updateModule = catalogActions.updateModule;
  const deleteModule = useCallback(
    (id: string) => {
      catalogActions.deleteModule(id, (deletedId) => {
        if (editingModuleId === deletedId) {
          setEditingModuleId(null);
        }
      });
    },
    [catalogActions, editingModuleId],
  );
  const duplicateModuleById = catalogActions.duplicateModuleById;
  const createStructure = catalogActions.createStructure;
  const updateStructure = catalogActions.updateStructure;
  const deleteStructure = catalogActions.deleteStructure;
  const setStructureActive = catalogActions.setStructureActive;
  const createComponent = catalogActions.createComponent;
  const updateComponent = catalogActions.updateComponent;
  const toggleComponentActive = catalogActions.toggleComponentActive;
  const createAgregado = catalogActions.createAgregado;
  const updateAgregado = catalogActions.updateAgregado;
  const deleteAgregado = catalogActions.deleteAgregado;
  const createCustomer = useCallback(
    (draft: CustomerDraft) => {
      catalogActions.createCustomer(draft, {
        id: authUser?.id,
        role: authUser?.role,
      });
    },
    [catalogActions, authUser?.id, authUser?.role],
  );
  const updateCustomer = useCallback(
    (id: string, draft: CustomerDraft) => {
      catalogActions.updateCustomer(id, draft, { role: authUser?.role });
    },
    [catalogActions, authUser?.role],
  );
  const setCustomerActive = catalogActions.setCustomerActive;

  const saveWorkshopSettings = useCallback(
    async (settings: WorkshopSettings) => {
      try {
        await saveWorkshopSettingsAction(settings);
        // Sync local workspaceRef with the new state from the store.
        workspaceRef.current = useWorkspaceStore.getState().workspace ?? null;
        toast({ type: 'success', message: '✓ Preferencias del taller guardadas' });
      } catch {
        toast({
          type: 'error',
          message: 'No se pudieron guardar los ajustes',
        });
      }
    },
    [saveWorkshopSettingsAction, toast],
  );

  // F063: project handlers delegate to projectStore. App.tsx no longer owns
  // project reducer wrapper, draftToProjectMeta/resolveCustomerFromDraft helpers,
  // or workspaceRef reads for projects — they live in the store.
  // Cross-store handlers (createProject/updateProject/createFromTemplate) need
  // `catalog` + `authUser`; App.tsx wraps them in useCallback to inject those.
  const createProject = useCallback(
    (draft: ProjectDraft) => {
      if (!catalog) return;
      projectActions.createProject(draft, catalog, {
        id: authUser?.id,
        role: authUser?.role,
      });
    },
    [projectActions, catalog, authUser?.id, authUser?.role],
  );
  const updateProject = useCallback(
    (id: string, draft: ProjectDraft) => {
      if (!catalog) return;
      projectActions.updateProject(id, draft, catalog, {
        role: authUser?.role,
      });
    },
    [projectActions, catalog, authUser?.role],
  );
  const deleteProject = useCallback(
    (id: string) => {
      projectActions.deleteProject(id, (deletedId) => {
        if (selectedProjectId === deletedId) {
          navigate(pathForNav('projects'));
        }
      });
    },
    [projectActions, selectedProjectId, navigate],
  );
  const markProjectProduced = useCallback(
    (id: string) => {
      if (!catalog) return;
      projectActions.markProjectProduced(id, catalog);
    },
    [projectActions, catalog],
  );
  const startEngineering = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project || project.engineeringLog) return;
      const log = createEngineeringLog(
        authUser?.id ?? 'unknown',
        new Date().toISOString(),
      );
      // Patch the project's engineeringLog directly via setProjects.
      projectActions.setProjects(
        projects.map((p) =>
          p.id === projectId ? { ...p, engineeringLog: log, updatedAt: new Date().toISOString() } : p,
        ),
      );
      navigate(engineeringProjectPath(projectId));
    },
    [projects, authUser?.id, projectActions, navigate],
  );
  const changeProjectStatus = useCallback(
    (id: string, status: ProjectStatus) => {
      if (!catalog) return;
      projectActions.changeProjectStatus(id, status, catalog);
    },
    [projectActions, catalog],
  );
  const reopenProject = useCallback(
    (id: string) => {
      if (!catalog) return;
      // Guest shell acts as full admin for local demo.
      const role =
        session === 'guest' ? 'admin' : (authUser?.role ?? null);
      projectActions.reopenProject(id, catalog, role);
    },
    [projectActions, catalog, session, authUser?.role],
  );
  const restoreProjectVersion = useCallback(
    (id: string, version: number) => {
      projectActions.restoreProjectVersion(id, version);
    },
    [projectActions],
  );
  const duplicateProjectById = projectActions.duplicateProjectById;
  const saveAsTemplate = projectActions.saveAsTemplate;
  const createFromTemplate = useCallback(
    (templateId: string, draft: ProjectDraft) => {
      if (!catalog) return;
      projectActions.createFromTemplate(templateId, draft, catalog, {
        id: authUser?.id,
        role: authUser?.role,
      });
    },
    [projectActions, catalog, authUser?.id, authUser?.role],
  );
  const deleteTemplate = projectActions.deleteTemplate;
  const addProjectItem = projectActions.addProjectItem;
  const updateProjectItem = projectActions.updateProjectItem;
  const removeProjectItem = projectActions.removeProjectItem;
  const updateProjectLevelChoices = projectActions.updateProjectLevelChoices;
  const updateMeasureDefaults = projectActions.updateMeasureDefaults;
  const updateInstallationChecklist = projectActions.updateInstallationChecklist;
  const updateKitchenLayout = projectActions.updateKitchenLayout;
  const planActor = useMemo(
    () =>
      authUser
        ? {
            userId: authUser.id,
            userName: authUser.name?.trim() || authUser.email || 'Usuario',
          }
        : undefined,
    [authUser],
  );
  // Use getState() so callbacks stay stable when project store patches
  // (useProjectStore() whole-state would change identity every save).
  const acquirePlanEditSession = useCallback(
    (projectId: string) => {
      if (!planActor) return false;
      return getProjectStoreState().acquirePlanEditSession(projectId, planActor);
    },
    [planActor],
  );
  const renewPlanEditSession = useCallback(
    (projectId: string) => {
      if (!planActor) return false;
      return getProjectStoreState().renewPlanEditSession(projectId, planActor);
    },
    [planActor],
  );
  const releasePlanEditSession = useCallback(
    (projectId: string) => {
      if (!planActor) return;
      getProjectStoreState().releasePlanEditSession(projectId, planActor.userId);
    },
    [planActor],
  );
  const applyScenarioB = projectActions.applyScenarioB;
  const importNestingResult = projectActions.importNestingResult;
  const setItemFloorStatus = projectActions.setItemFloorStatus;
  const recordProductionExport = projectActions.recordProductionExport;
  const ensureProductionRevisionOnProject =
    projectActions.ensureProductionRevision;

  // PROD-3.2: freeze OP revision when opening a plant-ready order.
  useEffect(() => {
    if (!routeProductionOrderId) return;
    ensureProductionRevisionOnProject(routeProductionOrderId);
  }, [routeProductionOrderId, ensureProductionRevisionOnProject]);

  const duplicateWithScenarioB = useCallback(
    (projectId: string, role: string, choiceId: string) => {
      projectActions.duplicateWithScenarioB(
        projectId,
        role,
        choiceId,
        (newId) => navigate(entityPath('projects', newId)),
      );
    },
    [projectActions, navigate],
  );

  const exportCommercialScenarioPdf = useCallback(
    async (projectId: string, role: string, choiceId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      const customerName = resolveCustomerName(project.customerId, customers);
      const res = await buildCommercialScenarioPdfExport(
        project,
        catalog!,
        role,
        choiceId,
        customerName,
      );
      if (res.ok) {
        deliverExcelFile(res.bytes, res.fileName);
        toast({ type: 'success', message: '✓ PDF Comparativo A/B descargado' });
      } else {
        toast({ type: 'error', message: res.message });
      }
    },
    [projects, customers, catalog, toast],
  );


  // F062: media helpers now delegate to catalogStore (which reads authToken
  // from workspaceStore). Toast on upload success/error stays here.
  const resolveMediaUrl = catalogActions.resolveMediaUrl;
  const uploadCatalogImage = useCallback(
    async (file: File): Promise<string> => {
      try {
        const url = await catalogActions.uploadCatalogImage(file);
        toast({ type: 'success', message: '✓ Imagen subida' });
        return url;
      } catch (err) {
        toast({ type: 'error', message: 'No se pudo subir la imagen' });
        throw err;
      }
    },
    [catalogActions, toast],
  );

  const handleExportOptimizer = useCallback(
    async (projectId?: string) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      // F041: production cut-list only for roles+statuses allowed.
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      setExportBusy(true);
      setExportErrors([]);
      try {
        const result = await buildOptimizerExport(project, catalog);
        if (!result.ok) {
          // Validation issues stay inline (ExportIssueList) — not as toasts.
          setExportErrors(result.issues);
          if (projectId != null) {
            toast({
              type: 'error',
              message: 'No se pudo exportar el corte: revisá las opciones del pedido',
            });
          }
          return;
        }
        const delivery = await deliverExcelFile(result.bytes, result.fileName);
        if (delivery === 'cancelled') {
          toast({ type: 'info', message: 'Export cancelado' });
          return;
        }
        toast({
          type: 'success',
          message:
            delivery === 'saved'
              ? `✓ ${result.fileName} guardado`
              : `✓ ${result.fileName} descargado`,
        });
      } finally {
        setExportBusy(false);
      }
    },
    [selectedProject, projects, catalog, toast, session, actorRole],
  );

  const handleExportHardwareList = useCallback(
    async (projectId?: string) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      setExportBusy(true);
      setExportErrors([]);
      try {
        const result = await buildHardwareListExport(project, catalog);
        if (!result.ok) {
          setExportErrors(result.issues);
          if (projectId != null) {
            toast({
              type: 'error',
              message: 'No se pudo exportar herrajes: revisá el pedido',
            });
          }
          return;
        }
        const delivery = await deliverExcelFile(result.bytes, result.fileName);
        if (delivery === 'cancelled') {
          toast({ type: 'info', message: 'Export cancelado' });
          return;
        }
        toast({
          type: 'success',
          message:
            delivery === 'saved'
              ? `✓ ${result.fileName} guardado`
              : `✓ ${result.fileName} descargado`,
        });
      } finally {
        setExportBusy(false);
      }
    },
    [selectedProject, projects, catalog, toast, session, actorRole],
  );

  const handleExportPieceLabels = useCallback(
    async (
      projectId?: string,
      labelOptions?: PieceLabelsExportOptions,
    ) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      setExportBusy(true);
      setExportErrors([]);
      try {
        const result = await buildPieceLabelsExport(
          project,
          catalog,
          customers,
          labelOptions ?? {},
        );
        if (!result.ok) {
          setExportErrors(result.issues);
          if (projectId != null) {
            toast({
              type: 'error',
              message: 'No se pudo exportar etiquetas: revisá el pedido',
            });
          }
          return;
        }
        const delivery = await deliverExcelFile(result.bytes, result.fileName);
        if (delivery === 'cancelled') {
          toast({ type: 'info', message: 'Export cancelado' });
          return;
        }
        toast({
          type: 'success',
          message:
            delivery === 'saved'
              ? `✓ ${result.fileName} guardado`
              : `✓ ${result.fileName} descargado`,
        });
      } finally {
        setExportBusy(false);
      }
    },
    [selectedProject, projects, catalog, customers, toast, session, actorRole],
  );

  const handleExportModuleLabels = useCallback(
    async (
      projectId?: string,
      labelOptions?: ModuleLabelsExportOptions,
    ) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      setExportBusy(true);
      setExportErrors([]);
      try {
        const result = await buildModuleLabelsExport(
          project,
          catalog,
          customers,
          labelOptions ?? {},
        );
        if (!result.ok) {
          setExportErrors(result.issues);
          if (projectId != null) {
            toast({
              type: 'error',
              message: 'No se pudo exportar etiquetas de muebles: revisá el pedido',
            });
          }
          return;
        }
        const delivery = await deliverExcelFile(result.bytes, result.fileName);
        if (delivery === 'cancelled') {
          toast({ type: 'info', message: 'Export cancelado' });
          return;
        }
        toast({
          type: 'success',
          message:
            delivery === 'saved'
              ? `✓ ${result.fileName} guardado`
              : `✓ ${result.fileName} descargado`,
        });
      } finally {
        setExportBusy(false);
      }
    },
    [selectedProject, projects, catalog, customers, toast, session, actorRole],
  );

  const handleExportElevations = useCallback(
    async (projectId?: string) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      setExportBusy(true);
      setExportErrors([]);
      try {
        const result = await buildWallElevationsExport(
          project,
          catalog,
          resolveCustomerName(project.customerId, customers),
        );
        if (!result.ok) {
          setExportErrors(result.issues);
          toast({
            type: 'error',
            message:
              result.issues[0]?.message ??
              'No se pudo exportar elevaciones (¿hay muros en el layout?)',
          });
          return;
        }
        const delivery = await deliverExcelFile(result.bytes, result.fileName);
        if (delivery === 'cancelled') {
          toast({ type: 'info', message: 'Export cancelado' });
          return;
        }
        if (projectId != null) {
          recordProductionExport(projectId);
        } else if (project) {
          recordProductionExport(project.id);
        }
        toast({
          type: 'success',
          message:
            delivery === 'saved'
              ? `✓ ${result.fileName} guardado`
              : `✓ ${result.fileName} descargado`,
        });
      } finally {
        setExportBusy(false);
      }
    },
    [
      selectedProject,
      projects,
      catalog,
      customers,
      toast,
      session,
      actorRole,
      recordProductionExport,
    ],
  );

  const handleExportCncPilot = useCallback(
    async (projectId?: string) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      setExportBusy(true);
      setExportErrors([]);
      try {
        const result = await buildCncPilotExport(project, catalog);
        if (!result.ok) {
          setExportErrors(result.issues);
          toast({
            type: 'error',
            message: 'No se pudo generar CNC pilot JSON',
          });
          return;
        }
        const delivery = await deliverExcelFile(result.bytes, result.fileName);
        if (delivery === 'cancelled') {
          toast({ type: 'info', message: 'Export cancelado' });
          return;
        }
        toast({
          type: 'success',
          message:
            delivery === 'saved'
              ? `✓ ${result.fileName} guardado`
              : `✓ ${result.fileName} descargado`,
        });
      } finally {
        setExportBusy(false);
      }
    },
    [selectedProject, projects, catalog, toast, session, actorRole],
  );

  const handleExportAssemblySheets = useCallback(
    async (projectId?: string) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      setExportBusy(true);
      setExportErrors([]);
      try {
        const result = await buildAssemblySheetsExport(
          project,
          catalog,
          resolveCustomerName(project.customerId, customers),
        );
        if (!result.ok) {
          setExportErrors(result.issues);
          toast({
            type: 'error',
            message: 'No se pudo generar hojas de armado',
          });
          return;
        }
        const delivery = await deliverExcelFile(result.bytes, result.fileName);
        if (delivery === 'cancelled') {
          toast({ type: 'info', message: 'Export cancelado' });
          return;
        }
        toast({
          type: 'success',
          message:
            delivery === 'saved'
              ? `✓ ${result.fileName} guardado`
              : `✓ ${result.fileName} descargado`,
        });
      } finally {
        setExportBusy(false);
      }
    },
    [selectedProject, projects, catalog, customers, toast, session, actorRole],
  );

  const handleExportCutListCsv = useCallback(
    async (projectId?: string) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      setExportBusy(true);
      setExportErrors([]);
      try {
        const result = await buildCutListCsvExport(project, catalog);
        if (!result.ok) {
          setExportErrors(result.issues);
          toast({
            type: 'error',
            message: 'No se pudo exportar cut-list CSV',
          });
          return;
        }
        const delivery = await deliverExcelFile(result.bytes, result.fileName);
        if (delivery === 'cancelled') {
          toast({ type: 'info', message: 'Export cancelado' });
          return;
        }
        toast({
          type: 'success',
          message:
            delivery === 'saved'
              ? `✓ ${result.fileName} guardado`
              : `✓ ${result.fileName} descargado`,
        });
      } finally {
        setExportBusy(false);
      }
    },
    [selectedProject, projects, catalog, toast, session, actorRole],
  );

  const handleReleaseToDelivery = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      try {
        await projectActions.updateProjectTechnicalWorkflow(projectId, {
          technicalStatus: 'ready_to_install',
          comment:
            '✓ 100% de los bultos cargados en el transporte. Orden liberada para entrega.',
        });
        toast({
          type: 'success',
          message: '✓ Orden liberada exitosamente a entrega / transporte',
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Error al liberar orden a entrega';
        toast({
          type: 'error',
          message: msg,
        });
      }
    },
    [projects, projectActions, toast],
  );

  const handleExportProductionPack = useCallback(
    async (projectId?: string) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      setExportBusy(true);
      setExportErrors([]);
      try {
        const result = await buildProductionPackExport(
          project,
          catalog!,
          resolveCustomerName(project.customerId, customers),
        );
        if (!result.ok) {
          setExportErrors(result.issues);
          toast({
            type: 'error',
            message:
              'No se pudo armar el pack: revisá el pedido (falta el corte Optimizer)',
          });
          return;
        }
        const delivery = await deliverExcelFile(result.bytes, result.fileName);
        if (delivery === 'cancelled') {
          toast({ type: 'info', message: 'Export cancelado' });
          return;
        }
        // PROD-3.2 — stamp OP export revision so stale detection works.
        recordProductionExport(project.id);
        // Optional annexes that failed are listed — never silently missing.
        const omissionNote =
          result.omissions.length > 0
            ? ` (sin: ${result.omissions.join(', ')})`
            : '';
        toast({
          type: 'success',
          message:
            delivery === 'saved'
              ? `✓ ${result.fileName} guardado${omissionNote}`
              : `✓ ${result.fileName} descargado${omissionNote}`,
        });
      } finally {
        setExportBusy(false);
      }
    },
    [
      selectedProject,
      projects,
      catalog,
      customers,
      toast,
      session,
      actorRole,
      recordProductionExport,
    ],
  );

  const handleExportCommercialQuote = useCallback(async () => {
    if (!selectedProject || !catalog) return;
    setExportBusy(true);
    setExportErrors([]);
    try {
      const result = await buildCommercialQuoteExport(
        selectedProject,
        catalog,
        customers,
      );
      if (!result.ok) {
        setExportErrors(result.issues);
        return;
      }
      const delivery = await deliverExcelFile(result.bytes, result.fileName);
      if (delivery === 'cancelled') {
        toast({ type: 'info', message: 'Export cancelado' });
        return;
      }
      toast({
        type: 'success',
        message:
          delivery === 'saved'
            ? `✓ ${result.fileName} guardado`
            : `✓ ${result.fileName} descargado`,
      });
    } finally {
      setExportBusy(false);
    }
  }, [selectedProject, catalog, customers, toast]);

  const handleExportCommercialQuotePdf = useCallback(
    async (variant: 'detailed' | 'summary') => {
      if (!selectedProject || !catalog) return;
      setExportBusy(true);
      setExportErrors([]);
      try {
        const result = await buildCommercialQuotePdfExport(
          selectedProject,
          catalog,
          customers,
          variant,
          workspace?.settings,
        );
        if (!result.ok) {
          setExportErrors(result.issues);
          return;
        }
        const delivery = await deliverExcelFile(result.bytes, result.fileName);
        if (delivery === 'cancelled') {
          toast({ type: 'info', message: 'Export cancelado' });
          return;
        }
        toast({
          type: 'success',
          message:
            delivery === 'saved'
              ? `✓ ${result.fileName} guardado`
              : `✓ ${result.fileName} descargado`,
        });
      } finally {
        setExportBusy(false);
      }
    },
    [selectedProject, catalog, customers, toast],
  );

  const onEntitySelectionChange = useCallback(
    (section: EntitySection, id: string | null) => {
      if (section === 'projects') {
        setExportErrors([]);
      }
      // Fase 3 UI: do not navigate away from /section/:id/edit. The editor
      // owns the URL while open; ModulesScreen's onSelectionChange effect can
      // still fire (e.g. when selectedId changes from null → id), but if we
      // are currently in edit mode we keep the URL stable.
      const currentPathname = locationPathnameRef.current;
      if (isEntityEditPath(currentPathname, section)) {
        return;
      }
      const target = id ? entityPath(section, id) : pathForNav(section);
      if (currentPathname !== target) {
        navigate(target);
      }
    },
    [navigate],
  );

  /**
   * Navigate to the inline editor route `/section/:id/edit` (Fase 3 UI).
   * Used by ModulesScreen / StructuresScreen / ComponentsScreen when the user
   * clicks "Editar" on the read-only detail. Replaces the old Modal LG flow.
   * For "Nuevo", the screen passes the NEW_ENTITY_ID sentinel.
   */
  const onEntityEditRequest = useCallback(
    (section: EntitySection, id: string | null) => {
      const currentPathname = locationPathnameRef.current;
      if (!id) {
        if (currentPathname !== pathForNav(section)) {
          navigate(pathForNav(section));
        }
        return;
      }
      const target =
        section === 'modules'
          ? moduleEditPath(id)
          : section === 'structures'
            ? `${entityPath(section, id)}/edit`
            : `${entityPath(section, id)}/edit`;
      if (currentPathname !== target) {
        navigate(target);
      }
    },
    [navigate],
  );

  const onProjectSelectionChange = useCallback(
    (projectId: string | null) => {
      onEntitySelectionChange('projects', projectId);
    },
    [onEntitySelectionChange],
  );

  const onModuleSelectionChange = useCallback(
    (moduleId: string | null) => {
      onEntitySelectionChange('modules', moduleId);
    },
    [onEntitySelectionChange],
  );

  const onStructureSelectionChange = useCallback(
    (structureId: string | null) => {
      onEntitySelectionChange('structures', structureId);
    },
    [onEntitySelectionChange],
  );

  const onComponentSelectionChange = useCallback(
    (componentId: string | null) => {
      onEntitySelectionChange('components', componentId);
    },
    [onEntitySelectionChange],
  );

  const onNavigate = useCallback(
    (id: AppNavId) => {
      if (id === 'users' && !showAdminUsers) return;
      navigate(pathForNav(id));
    },
    [navigate, showAdminUsers],
  );

  // Loading / recover gate AFTER all hooks — never return early before useCallback/useMemo.
  if (workspaceLoadError) {
    return (
      <div
        className="workspace-load-error"
        role="alert"
        data-testid="workspace-load-error"
      >
        <div className="workspace-load-error__card">
          <h1 className="workspace-load-error__title">
            No se pudo cargar el espacio de trabajo
          </h1>
          <p className="workspace-load-error__message">{workspaceLoadError}</p>
          <div className="workspace-load-error__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reintentar
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setWorkspace(createSeedWorkspace());
                setWorkspaceLoadError(null);
              }}
            >
              Usar datos demo
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!workspace || !catalog) {
    return (
      <PageLoading
        fullPage
        label="Cargando espacio de trabajo…"
        data-testid="workspace-loading"
      />
    );
  }

  return (
    <AppShell
      activeId={navId}
      onNavigate={onNavigate}
      hrefForNav={pathForNav}
      meta={`schema v${workspace.schemaVersion}`}
      onLogout={onLogout}
      sessionMode={session}
      user={
        authUser ? { email: authUser.email, role: authUser.role } : null
      }
      showAdminUsers={showAdminUsers}
      allowedNavIds={allowedNavIds}
      commandItems={commandItems}
      onCommandItem={onCommandItem}
    >
      {navId === 'home' ? (
        <Dashboard
          stats={dashboardStats}
          recentProjects={dashboardRecent}
          projectsCount={projects.length}
          onOpenProject={onDashboardOpenProject}
          onNewProject={canMutateProjects ? onDashboardNewProject : undefined}
          onNewModule={canMutateModules ? onDashboardNewModule : undefined}
          onNewMaterial={canMutateCatalog ? onDashboardNewMaterial : undefined}
          ownerBreakdown={dashboardOwnerBreakdown}
          homeMode={dashboardHomeMode}
          analytics={workshopAnalytics}
          analyticsPeriod={analyticsPeriod}
          onAnalyticsPeriodChange={
            workshopAnalytics ? setAnalyticsPeriod : undefined
          }
          analyticsLoading={warrantyTickets === null}
          onOpenShowcase={
            dashboardHomeMode === 'sales'
              ? onDashboardOpenShowcase
              : undefined
          }
          onOpenMaterials={
            dashboardHomeMode === 'engineering'
              ? onDashboardOpenMaterials
              : undefined
          }
          onOpenModules={
            dashboardHomeMode === 'engineering'
              ? onDashboardOpenModules
              : undefined
          }
          modulesWithoutPhotoCount={
            dashboardHomeMode === 'engineering'
              ? modulesWithoutPhotoCount
              : undefined
          }
        />
      ) : null}
      {navId === 'fabric' && isSectorScoped ? (
        <FabricScreen
          projects={projectsForRole}
          assignedSectors={mySectors}
          canAdvance={
            session === 'auth' &&
            (canMarkProduced || roleCanExportProduction(actorRole))
          }
          onAdvance={(projectId, itemId, target) => {
            const repo = getRepository();
            if (repo.setProjectItemFloorStatus) {
              // Server path enforces station scoping + writes the audit
              // event (F094); mirror locally to keep the list in sync.
              void repo
                .setProjectItemFloorStatus(projectId, itemId, target)
                .then((res) => {
                  if (res.floorStatus === target) {
                    setItemFloorStatus(projectId, itemId, target);
                  }
                })
                .catch((err) => {
                  toast({
                    type: 'error',
                    message:
                      err instanceof Error && err.message
                        ? err.message
                        : 'No se pudo avanzar el mueble',
                  });
                });
            } else {
              setItemFloorStatus(projectId, itemId, target);
            }
          }}
          customerLabelFor={(customerId) =>
            resolveCustomerName(customerId, customers)
          }
        />
      ) : null}
      {navId === 'engineering' && !routeEngineeringProjectId ? (
        <EngineeringScreen
          projects={projectsForRole.map((p) => ({
            ...p,
            customerLabel: resolveCustomerName(p.customerId, customers),
          }))}
          onStartEngineering={startEngineering}
          onOpenProject={(id) => {
            const target = engineeringProjectPath(id);
            if (location.pathname !== target) navigate(target);
          }}
          currentUserId={authUser?.id}
        />
      ) : null}
      {navId === 'engineering' && routeEngineeringProjectId ? (() => {
        const engProject = projects.find((p) => p.id === routeEngineeringProjectId);
        if (!engProject) {
          return (
            <div className="empty-state">
              <p>Proyecto no encontrado.</p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => navigate(pathForNav('engineering'))}
              >
                Volver a Ingeniería
              </button>
            </div>
          );
        }
        const engModules = modules.filter((m) =>
          engProject.items.some((item) => item.moduleId === m.id),
        );
        let engCutRows: ReturnType<typeof generateCutRows> | null = null;
        let engCutError: string | null = null;
        if (catalog) {
          try {
            engCutRows = generateCutRows(engProject, catalog);
          } catch (err) {
            engCutError = err instanceof Error ? err.message : 'Error al resolver despiece';
          }
        }
        const engReadiness = buildProductionOrderReadiness({
          project: engProject,
          cutRows: engCutRows,
          cutListError: engCutError,
        });
        let engLabels: ReturnType<typeof generatePieceLabels> | null = null;
        let engLabelsError: string | null = null;
        let engModuleLabels: ReturnType<typeof generateModuleLabels> | null = null;
        let engModuleLabelsError: string | null = null;
        if (catalog) {
          try {
            engLabels = generatePieceLabels(engProject, catalog);
          } catch (err) {
            engLabelsError = err instanceof Error ? err.message : 'Error al resolver etiquetas';
          }
          try {
            engModuleLabels = generateModuleLabels(engProject, catalog, {
              customerName: resolveCustomerName(engProject.customerId, customers),
              revision: engProject.production?.revision?.toString(),
            });
          } catch (err) {
            engModuleLabelsError = err instanceof Error ? err.message : 'Error al resolver etiquetas de módulo';
          }
        }
        let engHardwareRows: ReturnType<typeof generateHardwareList> | null = null;
        let engHardwareError: string | null = null;
        if (catalog) {
          try {
            engHardwareRows = generateHardwareList(engProject, catalog);
          } catch (err) {
            engHardwareError = err instanceof Error ? err.message : 'Error al resolver herrajes';
          }
        }
        return (
          <EngineeringWorkspace
            project={engProject}
            modules={engModules}
            catalog={catalog}
            catalog3d={
              catalog
                ? {
                    modules,
                    structures,
                    components,
                    agregados,
                    materials,
                    edges,
                    hardware,
                    optionGroups,
                    ambientMaterials,
                    ambientCategories,
                  }
                : null
            }
            cutRows={engCutRows}
            cutError={engCutError}
            readiness={engReadiness}
            labels={engLabels}
            labelsError={engLabelsError}
            moduleLabels={engModuleLabels}
            moduleLabelsError={engModuleLabelsError}
            hardwareRows={engHardwareRows}
            hardwareError={engHardwareError}
            customerLabel={resolveCustomerName(engProject.customerId, customers)}
            onBack={() => navigate(pathForNav('engineering'))}
            resolveMediaUrl={resolveMediaUrl}
            onExportCsv={() => { void handleExportCutListCsv(engProject.id); }}
            onExportPdf={(labels, perUnit) => { void handleExportPieceLabels(engProject.id, { labels, perUnit }); }}
            onExportModulePdf={(labels) => { void handleExportModuleLabels(engProject.id, { labels }); }}
            onExportHardware={() => { void handleExportHardwareList(engProject.id); }}
            onExportElevations={() => { void handleExportElevations(engProject.id); }}
            onExportOptimizer={() => { void handleExportOptimizer(engProject.id); }}
            onExportProductionPack={() => { void handleExportProductionPack(engProject.id); }}
            onExportCutListCsv={() => { void handleExportCutListCsv(engProject.id); }}
            onExportPieceLabels={(lbls, opts) => { void handleExportPieceLabels(engProject.id, { labels: lbls, perUnit: opts.perUnit }); }}
            onExportModuleLabels={(lbls) => { void handleExportModuleLabels(engProject.id, { labels: lbls }); }}
            canImportNesting={canMarkProduced || roleCanExportProduction(actorRole)}
            onImportNesting={(result) => { importNestingResult(engProject.id, result); }}
            exportBusy={exportBusy}
          />
        );
      })() : null}
      {navId === 'salesDashboard' ? (
        <SalesDashboard
          projects={projectsForRole.map((p) => ({
            ...p,
            customerLabel: resolveCustomerName(p.customerId, customers),
          }))}
          onOpenProject={(id) => {
            const target = projectPath(id);
            if (location.pathname !== target) navigate(target);
          }}
          isVendedor={actorRole === 'vendedor'}
          currentUserId={authUser?.id}
          vendedores={assignableOwners.map((u) => ({ id: u.id, name: u.name }))}
          ownerLabels={ownerLabels}
        />
      ) : null}
      {navId === 'plantBoard' ? (
        <PlantBoardScreen
          projects={projectsForRole}
          customerLabelFor={(customerId) =>
            resolveCustomerName(customerId, customers)
          }
          onOpenOrder={
            useProductionWorkspace
              ? (id) => {
                  const target = productionOrderPath(id);
                  if (location.pathname !== target) navigate(target);
                }
              : undefined
          }
          onOpenProject={(id) => {
            const target = projectPath(id);
            if (location.pathname !== target) navigate(target);
          }}
        />
      ) : null}
      {navId === 'productionDashboard' ? (
        <ProductionManagerDashboard
          projects={projectsForRole}
          customerLabelFor={(customerId) =>
            resolveCustomerName(customerId, customers)
          }
          onOpenOrder={
            useProductionWorkspace
              ? (id) => {
                  const target = productionOrderPath(id);
                  if (location.pathname !== target) navigate(target);
                }
              : undefined
          }
          onOpenProject={(id) => {
            const target = projectPath(id);
            if (location.pathname !== target) navigate(target);
          }}
          repo={getRepository()}
        />
      ) : null}
      {navId === 'production' && useProductionWorkspace ? (
        <ProductionWorkspace
          projects={
            filterProjectsToPlant ? projectsForRole : filterProductionVisible(projects)
          }
          orderProjectId={routeProductionOrderId}
          orderTab={routeProductionOrderTab}
          onOrderTabChange={(tab) => {
            if (!routeProductionOrderId) return;
            const target = productionOrderPath(routeProductionOrderId, tab);
            if (location.pathname !== target) navigate(target);
          }}
          onOpenOrder={(id) => {
            const target = productionOrderPath(id);
            if (location.pathname !== target) navigate(target);
          }}
          onBackToQueue={() => {
            const target = pathForNav('production');
            if (location.pathname !== target) navigate(target);
          }}
          onOpenDesign={(id) => {
            const target = projectPath(id);
            if (location.pathname !== target) navigate(target);
          }}
          customerLabelFor={(customerId) =>
            resolveCustomerName(customerId, customers)
          }
          salePriceFor={(id) => projectEstimates[id] ?? null}
          resolveCutRows={(projectId) => {
            if (!catalog) {
              return { rows: null, error: 'Catálogo no disponible' };
            }
            const project = projects.find((p) => p.id === projectId);
            if (!project) {
              return { rows: null, error: 'Proyecto no encontrado' };
            }
            try {
              return { rows: generateCutRows(project, catalog) };
            } catch (err) {
              const message =
                err instanceof Error ? err.message : 'Error al resolver despiece';
              return { rows: null, error: message };
            }
          }}
          onExportOptimizer={(id) => {
            void handleExportOptimizer(id);
          }}
          onExportHardware={(id) => {
            void handleExportHardwareList(id);
          }}
          onExportPieceLabels={(id, labels, options) => {
            void handleExportPieceLabels(id, { labels, perUnit: options.perUnit });
          }}
          onExportModuleLabels={(id, labels) => {
            void handleExportModuleLabels(id, { labels });
          }}
          onExportProductionPack={(id) => {
            void handleExportProductionPack(id);
          }}
          onExportElevations={(id) => {
            void handleExportElevations(id);
          }}
          onExportCutListCsv={(id) => {
            void handleExportCutListCsv(id);
          }}
          onMarkProduced={markProjectProduced}
          exportBusy={exportBusy}
          cutRowsFor={
            catalog
              ? (projectId) => {
                  const project = projects.find((p) => p.id === projectId);
                  if (!project) return undefined;
                  try {
                    return generateCutRows(project, catalog);
                  } catch {
                    return undefined;
                  }
                }
              : undefined
          }
          resolveHardware={
            catalog
              ? (projectId) => {
                  const project = projects.find((p) => p.id === projectId);
                  if (!project) {
                    return { rows: null, error: 'Proyecto no encontrado' };
                  }
                  try {
                    return { rows: generateHardwareList(project, catalog) };
                  } catch (err) {
                    return {
                      rows: null,
                      error:
                        err instanceof Error
                          ? err.message
                          : 'Error al resolver herrajes',
                    };
                  }
                }
              : undefined
          }
          modules={modules}
          catalog={catalog}
          catalog3d={
            catalog
              ? {
                  modules,
                  structures,
                  components,
                  agregados,
                  materials,
                  edges,
                  hardware,
                  optionGroups,
                  ambientMaterials,
                  ambientCategories,
                }
              : null
          }
          resolveMediaUrl={resolveMediaUrl}
          hideHardwareCosts={!showCosts}
          onImportNesting={importNestingResult}
          canImportNesting={canMutateProjects || canMarkProduced}
          onSetFloorStatus={(projectId, itemId, status) => {
            setItemFloorStatus(projectId, itemId, status);
          }}
          canSetFloorStatus={
            session === 'auth' &&
            (canMarkProduced || roleCanExportProduction(actorRole))
          }
          onExportCncPilot={(id) => {
            void handleExportCncPilot(id);
          }}
          onExportAssemblySheets={(id) => {
            void handleExportAssemblySheets(id);
          }}
          onReleaseToDelivery={(id) => {
            void handleReleaseToDelivery(id);
          }}
        />
      ) : null}
      {navId === 'materials' ? (
        <MaterialsCatalog
          materials={materials}
          edges={edges}
          onCreate={createMaterial}
          onCreateEdge={createEdge}
          onUpdate={updateMaterial}
          onDeactivate={(id) => setMaterialActive(id, false)}
          onReactivate={(id) => setMaterialActive(id, true)}
          getCostPerM2={getMaterialCostPerM2}
          openEntityId={routeEntityId}
          onSelectionChange={(id) => onEntitySelectionChange('materials', id)}
          requestCreateKey={materialsCreateKey}
          canMutate={canMutateCatalog}
          showCosts={showCosts}
          resolveImageUrl={resolveMediaUrl}
          onUploadImage={
            canMutateCatalog && session === 'auth' && authToken
              ? uploadCatalogImage
              : undefined
          }
        />
      ) : null}
      {navId === 'edges' ? (
        <EdgesCatalog
          edges={edges}
          onCreate={createEdge}
          onUpdate={updateEdge}
          onDeactivate={(id) => setEdgeActive(id, false)}
          onReactivate={(id) => setEdgeActive(id, true)}
          openEntityId={routeEntityId}
          onSelectionChange={(id) => onEntitySelectionChange('edges', id)}
          canMutate={canMutateCatalog}
          showCosts={showCosts}
        />
      ) : null}
      {navId === 'hardware' ? (
        <HardwareCatalog
          hardware={hardware}
          onCreate={createHardware}
          onUpdate={updateHardware}
          onDeactivate={(id) => setHardwareActive(id, false)}
          onReactivate={(id) => setHardwareActive(id, true)}
          openEntityId={routeEntityId}
          onSelectionChange={(id) => onEntitySelectionChange('hardware', id)}
          canMutate={canMutateCatalog}
          showCosts={showCosts}
          resolveImageUrl={resolveMediaUrl}
          onUploadImage={
            canMutateCatalog && session === 'auth' && authToken
              ? uploadCatalogImage
              : undefined
          }
        />
      ) : null}
      {navId === 'ambientMaterials' ? (
        <AmbientMaterialsCatalog
          materials={ambientMaterials}
          categories={ambientCategories}
          onCreate={createAmbientMaterial}
          onUpdate={updateAmbientMaterial}
          onDeactivate={(id) => setAmbientMaterialActive(id, false)}
          onReactivate={(id) => setAmbientMaterialActive(id, true)}
          onCreateCategory={createAmbientCategory}
          onUpdateCategory={updateAmbientCategory}
          onDeleteCategory={deleteAmbientCategory}
          canMutate={canMutateCatalog}
          resolveImageUrl={resolveMediaUrl}
          onUploadImage={
            canMutateCatalog && session === 'auth' && authToken
              ? uploadCatalogImage
              : undefined
          }
        />
      ) : null}
      {navId === 'optionGroups' ? (
        <OptionGroupsScreen
          optionGroups={optionGroups}
          materials={materials}
          edges={edges}
          hardware={hardware}
          modules={modules}
          catalogComponents={components}
          catalogStructures={structures}
          onCreate={createOptionGroup}
          onUpdate={updateOptionGroup}
          onDelete={deleteOptionGroup}
          openEntityId={routeEntityId}
          onSelectionChange={(id) =>
            onEntitySelectionChange('optionGroups', id)
          }
          canMutate={canMutateCatalog}
        />
      ) : null}
      {navId === 'customers' ? (
        <CustomersScreen
          customers={customers}
          projects={projectsForRole}
          onOpenProject={(projectId) => {
            navigate(`/cotizaciones/${projectId}`);
          }}
          workshopName={workshopSettings?.workshopName}
          onCreate={createCustomer}
          onUpdate={updateCustomer}
          onDeactivate={(id) => setCustomerActive(id, false)}
          onReactivate={(id) => setCustomerActive(id, true)}
          openEntityId={routeEntityId}
          onSelectionChange={(id) => onEntitySelectionChange('customers', id)}
          canAssignOwner={canAssignOwner}
          assignableOwners={assignableOwners}
          currentUserId={authUser?.id ?? ''}
          ownerLabels={ownerLabels}
        />
      ) : null}

      {navId === 'users' && showAdminUsers && authToken ? (
        <UsersScreen baseUrl={DEFAULT_API_BASE} token={authToken} />
      ) : null}
      {navId === 'settings' ? (
        <SettingsScreen
          settings={workshopSettings}
          onSave={saveWorkshopSettings}
          onOpenOnboardingTour={() => setShowOnboardingTour(true)}
        />
      ) : null}
      {navId === 'showcase' ? (
        <ShowcaseScreen
          photos={showcasePhotos}
          modules={modules}
          categories={categories}
          resolveImageUrl={resolveMediaUrl}
          isLoadingPhotos={isLoadingShowcase}
          onUseModuleInQuote={
            canMutateProjects ? onShowcaseUseInQuote : undefined
          }
          onUseProjectAsReference={
            canMutateProjects ? onShowcaseUseProjectAsReference : undefined
          }
        />
      ) : null}

      {navId === 'modules' ? (
        <ModulesScreen
          modules={modules}
          optionGroups={optionGroups}
          hardware={hardware}
          categories={categories}
          onCreate={createModule}
          onUpdate={updateModule}
          onDelete={deleteModule}
          onCreateCategory={createCategory}
          onUpdateCategory={updateCategory}
          onDeleteCategory={deleteCategory}
          onDuplicate={duplicateModuleById}
          onEditingChange={setEditingModuleId}
          onSelectionChange={onModuleSelectionChange}
          openModuleId={routeModuleId}
          openModuleEditId={routeModuleEditId}
          onRequestEdit={(id) => onEntityEditRequest('modules', id)}
          costPreview={showCosts ? modulePreview.costPreview : null}
          previewBlocked={modulePreview.previewBlocked}
          previewError={modulePreview.previewError}
          missingGroups={modulePreview.missingGroups}
          groupLabels={groupLabels}
          moduleEstimates={moduleEstimates}
          requestCreateKey={modulesCreateKey}
          structures={structures}
          catalogComponents={components}
          catalogAgregados={agregados}
          materials={materials}
          edges={edges}
          canMutate={canMutateModules}
          resolveImageUrl={resolveMediaUrl}
          onUploadImage={
            canMutateModules && session === 'auth' && authToken
              ? uploadCatalogImage
              : undefined
          }
          renderBoardEditor={
            catalog
              ? ({ module, compositionKey }) => (
                  <BoardEditor
                    module={module}
                    catalog={catalog}
                    moduleWidth={module.externalDims?.width}
                    moduleHeight={module.externalDims?.height}
                    moduleDepth={module.externalDims?.depth}
                    compositionKey={compositionKey}
                    onOverridesChange={handleOverridesChange}
                  />
                )
              : undefined
          }
          boardOverrides={boardOverrides}
        />
      ) : null}
      {navId === 'structures' ? (
        <StructuresScreen
          structures={structures}
          optionGroups={optionGroups}
          catalogComponents={components}
          catalogAgregados={agregados}
          catalogMaterials={materials}
          catalogEdges={edges}
          catalogHardware={hardware}
          onCreate={createStructure}
          onUpdate={updateStructure}
          onDelete={deleteStructure}
          onDeactivate={(id) => setStructureActive(id, false)}
          onReactivate={(id) => setStructureActive(id, true)}
          openStructureId={routeStructureId}
          openStructureEditId={routeStructureEditId}
          onRequestEdit={(id) => onEntityEditRequest('structures', id)}
          onSelectionChange={onStructureSelectionChange}
          canMutate={canMutateModules}
          resolveImageUrl={resolveMediaUrl}
        />
      ) : null}
      {navId === 'components' ? (
        <ComponentsScreen
          components={components}
          optionGroups={optionGroups}
          materials={materials}
          onCreate={createComponent}
          onUpdate={updateComponent}
          onToggleActive={toggleComponentActive}
          openComponentId={routeComponentId}
          openComponentEditId={routeComponentEditId}
          onRequestEdit={(id) => onEntityEditRequest('components', id)}
          onSelectionChange={onComponentSelectionChange}
          canMutate={canMutateModules}
        />
      ) : null}
      {navId === 'agregados' ? (
        <AgregadosScreen
          agregados={agregados}
          catalogComponents={components}
          catalogHardware={hardware}
          onCreate={createAgregado}
          onUpdate={updateAgregado}
          onDelete={deleteAgregado}
          canMutate={canMutateModules}
          optionGroups={optionGroups}
          catalogMaterials={materials}
          catalogEdges={edges}
          resolveImageUrl={resolveMediaUrl}
        />
      ) : null}
      {navId === 'projects' ? (
        <ProjectsScreen
          projects={projectsForRole}
          modules={modules}
          categories={categories}
          optionGroups={optionGroups}
          materials={materials}
          edges={edges}
          hardware={hardware}
          ambientMaterials={ambientMaterials}
          ambientCategories={ambientCategories}
          catalogStructures={structures}
          catalogComponents={components}
          catalogAgregados={agregados}
          resolveImageUrl={resolveMediaUrl}
          customers={customers}
          canAssignOwner={canAssignOwner}
          assignableOwners={assignableOwners}
          ownerLabels={ownerLabels}
          onCreate={createProject}
          onUpdate={updateProject}
          onDelete={deleteProject}
          onDuplicate={duplicateProjectById}
          projectTemplates={projectTemplates}
          onSaveAsTemplate={saveAsTemplate}
          onCreateFromTemplate={createFromTemplate}
          onDeleteTemplate={deleteTemplate}
          onAddItem={addProjectItem}
          onUpdateItem={updateProjectItem}
          onRemoveItem={removeProjectItem}
          onUpdateProjectLevelChoices={updateProjectLevelChoices}
          onUpdateMeasureDefaults={updateMeasureDefaults}
          onUpdateKitchenLayout={updateKitchenLayout}
          planActor={planActor}
          onAcquirePlanEdit={
            planActor ? acquirePlanEditSession : undefined
          }
          onRenewPlanEdit={planActor ? renewPlanEditSession : undefined}
          onReleasePlanEdit={
            planActor ? releasePlanEditSession : undefined
          }
          onApplyScenarioB={applyScenarioB}
          onDuplicateWithScenarioB={duplicateWithScenarioB}
          onExportScenarioPdf={exportCommercialScenarioPdf}
          onUpdateInstallationChecklist={updateInstallationChecklist}
          onImportNesting={importNestingResult}
          onSelectionChange={onProjectSelectionChange}
          breakdown={resolveDisplayBreakdown(
            projectQuote.breakdown,
            backendBreakdown,
            showCosts,
          )}
          materialSummary={materialSummary}
          breakdownLoading={breakdownLoading}
          breakdownError={breakdownError ?? projectQuote.breakdownError}
          previewBlocked={projectQuote.previewBlocked}
          missingGroups={projectQuote.missingGroups}
          groupLabels={groupLabels}
          onExport={
            canExportProduction
              ? () => {
                  void handleExportOptimizer();
                }
              : undefined
          }
          onExportHardware={
            canExportProduction
              ? () => {
                  void handleExportHardwareList();
                }
              : undefined
          }
          onExportPieceLabels={
            canExportProduction
              ? () => {
                  void handleExportPieceLabels();
                }
              : undefined
          }
          onExportProductionPack={
            canExportProduction
              ? () => {
                  void handleExportProductionPack();
                }
              : undefined
          }
          onOpenInProduction={
            useProductionWorkspace
              ? (projectId) => {
                  const target = productionOrderPath(projectId);
                  if (location.pathname !== target) navigate(target);
                }
              : undefined
          }
          onExportCommercialQuote={
            filterProjectsToPlant ? undefined : handleExportCommercialQuote
          }
          onExportCommercialQuotePdf={
            filterProjectsToPlant
              ? undefined
              : (variant) => {
                  void handleExportCommercialQuotePdf(variant);
                }
          }
          exportErrors={exportErrors}
          exportBusy={exportBusy}
          projectEstimates={projectEstimates}
          openProjectId={routeProjectId}
          requestCreateKey={projectsCreateKey}
          workshopSettings={workshopSettings}
          canMutate={canMutateProjects}
          canDelete={canDeleteProjects}
          canReopen={canReopenProjects}
          canForceReopenClosed={canForceReopenClosed}
          canMarkProduced={canMarkProduced}
          onMarkProduced={markProjectProduced}
          onChangeStatus={changeProjectStatus}
          onReopen={reopenProject}
          onRestoreVersion={restoreProjectVersion}
          showCosts={showCosts}
          autoPresentId={presentId}
          photos={selectedProjectId ? projectActions.photos[selectedProjectId] : undefined}
          onUploadPhotos={projectActions.uploadProjectPhotos}
          onUpdatePhoto={projectActions.updateProjectPhoto}
          onDeletePhoto={projectActions.deleteProjectPhoto}
          workshopName={workshopSettings?.workshopName}
          internalMessages={selectedProjectId ? projectActions.internalMessages[selectedProjectId] : undefined}
          onSendInternalMessage={projectActions.sendProjectMessage}
          onUpdateTechnicalWorkflow={projectActions.updateProjectTechnicalWorkflow}
          currentUserId={authUser?.id}
          warranties={selectedProjectId ? projectActions.warranties[selectedProjectId] : undefined}
          availableCutRows={selectedProjectCutRows}
          onCreateWarrantyTicket={projectActions.createWarrantyTicket}
          onUpdateWarrantyTicket={projectActions.updateWarrantyTicket}
          onDeleteWarrantyTicket={(ticketId) => {
            if (selectedProjectId) {
              return projectActions.deleteWarrantyTicket(ticketId, selectedProjectId);
            }
            return Promise.resolve();
          }}
          onUploadWarrantyPhoto={(ticketId, file, kind, caption) => {
            if (selectedProjectId) {
              return projectActions.uploadWarrantyPhoto(ticketId, selectedProjectId, file, kind, caption);
            }
            return Promise.resolve();
          }}
          onExportWarrantyRefabricationOptimizer={projectActions.exportWarrantyRefabricationOptimizer}
        />





      ) : null}

      <OnboardingTourModal
        isOpen={showOnboardingTour}
        onClose={() => setShowOnboardingTour(false)}
        onLoadDemoProject={handleLoadCocinaLopezDemo}
      />
    </AppShell>
  );
}
