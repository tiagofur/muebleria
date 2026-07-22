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
  generateProjectMaterialSummary,
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
  roleLabelEs,
  roleUsesProductionQueue,
  suggestDuplicateCode,
  transitionProjectStatus,
} from '@muebles/domain';
import {
  AppShell,
  EdgesCatalog,
  HardwareCatalog,
  MaterialsCatalog,
  ModulesScreen,
  ModuleShowcase,
  OptionGroupsScreen,
  ProjectsScreen,
  ProductionQueue,
  filterProductionVisible,
  Dashboard,
  LoginScreen,
  RegisterScreen,
  SettingsScreen,
  UsersScreen,
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
  PageLoading,
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
import { buildPieceLabelsExport } from './exportPieceLabels';
import { buildProductionPackExport } from './exportProductionPack';
import {
  buildOptimizerExport,
  deliverExcelFile,
} from './exportOptimizer';
import {
  componentEditIdFromPath,
  entityIdFromPath,
  entityPath,
  isEntityEditPath,
  isEntitySection,
  moduleEditIdFromPath,
  moduleEditPath,
  navFromPath,
  pathForNav,
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
 */
function computeModuleCostPreview(
  module: Module,
  catalog: Workspace['catalog'],
): {
  costPreview: QuoteBreakdown | null;
  previewBlocked: boolean;
  missingGroups: readonly string[];
} {
  const required = requiredGroupCodesForModule(module, catalog.optionGroups, catalog.components, catalog.structures);
  const choices = defaultOptionChoicesForModule(
    module,
    catalog.optionGroups,
    catalog.components,
    catalog.structures,
  ) as OptionChoices;
  const gate = canShowPricePreview(required, choices);
  if (!gate.ok) {
    return {
      costPreview: null,
      previewBlocked: true,
      missingGroups: gate.missingGroups,
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
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  try {
    const costPreview = calcProjectBreakdown(project, catalog);
    return { costPreview, previewBlocked: false, missingGroups: [] };
  } catch {
    return {
      costPreview: null,
      previewBlocked: true,
      missingGroups: required,
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
 * PRJ-06 / UX-03: domain breakdown for the selected project when option gate is open.
 */
function computeSelectedProjectBreakdown(
  project: Project | undefined,
  catalog: Workspace['catalog'],
): {
  breakdown: QuoteBreakdown | null;
  previewBlocked: boolean;
  missingGroups: readonly string[];
} {
  if (!project) {
    return { breakdown: null, previewBlocked: false, missingGroups: [] };
  }
  if (project.items.length === 0) {
    return { breakdown: null, previewBlocked: false, missingGroups: [] };
  }

  const gate = canShowProjectPricePreview(
    project,
    catalog.modules,
    catalog.optionGroups,
  );
  if (!gate.ok) {
    return {
      breakdown: null,
      previewBlocked: true,
      missingGroups: gate.missingGroups,
    };
  }

  try {
    const breakdown = calcProjectBreakdown(project, catalog);
    return { breakdown, previewBlocked: false, missingGroups: [] };
  } catch {
    return {
      breakdown: null,
      previewBlocked: true,
      missingGroups: [],
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
  });
  const projects = useProjectStore((s) => s.projects);
  const projectTemplates = useProjectStore((s) => s.projectTemplates);
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
  const canMarkProduced =
    session === 'guest' || roleCanMarkProduced(actorRole);
  const canExportProduction =
    session === 'guest' || roleCanExportProduction(actorRole);
  const canViewPortfolioDashboard =
    session === 'guest' || roleCanViewPortfolioDashboard(actorRole);
  const useProductionQueue =
    session === 'auth' && roleUsesProductionQueue(actorRole);
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

  // Derive catalog slices safely so hooks below always run (Rules of Hooks).
  // Early return for loading MUST stay after every useCallback/useMemo.
  // F062: catalog now lives in catalogStore; workspace still owns projects.
  const materials = catalog?.materials ?? [];
  const edges = catalog?.edges ?? [];
  const hardware = catalog?.hardware ?? [];
  const optionGroups = catalog?.optionGroups ?? [];
  const modules = catalog?.modules ?? [];
  const structures = catalog?.structures ?? [];
  const components = catalog?.components ?? [];
  const categories = catalog?.categories ?? [];
  const customers = catalog?.customers ?? [];
  // F063: `projects` and `projectTemplates` come from projectStore (line above).
  /** F038: producción only works accepted/produced quotes. */
  const projectsForRole = useMemo(
    () =>
      useProductionQueue ? filterProductionVisible(projects) : projects,
    [useProductionQueue, projects],
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
      };
    }
    const mod = modules.find((m) => m.id === editingModuleId);
    if (!mod) {
      return {
        costPreview: null,
        previewBlocked: true,
        missingGroups: [] as readonly string[],
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
  const reopenProject = useCallback(
    (id: string) => {
      if (!catalog) return;
      projectActions.reopenProject(id, catalog);
    },
    [projectActions, catalog],
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
  const applyScenarioB = projectActions.applyScenarioB;
  const importNestingResult = projectActions.importNestingResult;
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
        const result = await buildPieceLabelsExport(
          project,
          catalog,
          customers,
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
          catalog,
          customers,
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
      if (isEntityEditPath(location.pathname, section)) {
        return;
      }
      const target = id ? entityPath(section, id) : pathForNav(section);
      if (location.pathname !== target) {
        navigate(target);
      }
    },
    [location.pathname, navigate],
  );

  /**
   * Navigate to the inline editor route `/section/:id/edit` (Fase 3 UI).
   * Used by ModulesScreen / StructuresScreen / ComponentsScreen when the user
   * clicks "Editar" on the read-only detail. Replaces the old Modal LG flow.
   * For "Nuevo", the screen passes the NEW_ENTITY_ID sentinel.
   */
  const onEntityEditRequest = useCallback(
    (section: EntitySection, id: string) => {
      const target =
        section === 'modules'
          ? moduleEditPath(id)
          : section === 'structures'
            ? `${entityPath(section, id)}/edit`
            : `${entityPath(section, id)}/edit`;
      if (location.pathname !== target) {
        navigate(target);
      }
    },
    [location.pathname, navigate],
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
      {navId === 'production' && useProductionQueue ? (
        <ProductionQueue
          projects={projects}
          customerLabelFor={(customerId) =>
            resolveCustomerName(customerId, customers)
          }
          salePriceFor={(id) => projectEstimates[id] ?? null}
          onExportOptimizer={(id) => {
            void handleExportOptimizer(id);
          }}
          onExportHardware={(id) => {
            void handleExportHardwareList(id);
          }}
          onExportPieceLabels={(id) => {
            void handleExportPieceLabels(id);
          }}
          onExportProductionPack={(id) => {
            void handleExportProductionPack(id);
          }}
          onMarkProduced={markProjectProduced}
          exportBusy={exportBusy}
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
      {navId === 'optionGroups' ? (
        <OptionGroupsScreen
          optionGroups={optionGroups}
          materials={materials}
          edges={edges}
          hardware={hardware}
          modules={modules}
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
        />
      ) : null}
      {navId === 'showcase' ? (
        <ModuleShowcase
          modules={modules}
          categories={categories}
          resolveImageUrl={resolveMediaUrl}
          onUseInQuote={
            canMutateProjects ? onShowcaseUseInQuote : undefined
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
          missingGroups={modulePreview.missingGroups}
          groupLabels={groupLabels}
          moduleEstimates={moduleEstimates}
          requestCreateKey={modulesCreateKey}
          structures={structures}
          catalogComponents={components}
          materials={materials}
          edges={edges}
          canMutate={canMutateModules}
          resolveImageUrl={resolveMediaUrl}
          onUploadImage={
            canMutateModules && session === 'auth' && authToken
              ? uploadCatalogImage
              : undefined
          }
        />
      ) : null}
      {navId === 'structures' ? (
        <StructuresScreen
          structures={structures}
          optionGroups={optionGroups}
          catalogComponents={components}
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
      {navId === 'projects' ? (
        <ProjectsScreen
          projects={projectsForRole}
          modules={modules}
          categories={categories}
          optionGroups={optionGroups}
          materials={materials}
          edges={edges}
          hardware={hardware}
          catalogStructures={structures}
          catalogComponents={components}
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
          onApplyScenarioB={applyScenarioB}
          onDuplicateWithScenarioB={duplicateWithScenarioB}
          onUpdateInstallationChecklist={updateInstallationChecklist}
          onImportNesting={importNestingResult}
          onSelectionChange={onProjectSelectionChange}
          breakdown={backendBreakdown ?? projectQuote.breakdown}
          materialSummary={materialSummary}
          breakdownLoading={breakdownLoading}
          breakdownError={breakdownError}
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
          onExportCommercialQuote={
            useProductionQueue ? undefined : handleExportCommercialQuote
          }
          onExportCommercialQuotePdf={
            useProductionQueue
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
          canMarkProduced={canMarkProduced}
          onMarkProduced={markProjectProduced}
          onReopen={reopenProject}
          showCosts={showCosts}
        />
      ) : null}
    </AppShell>
  );
}
