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
import { FileQuestion } from 'lucide-react';
import type {
  Catalog,
  Component,
  Customer,
  EdgeBand,
  ExportIssue,
  Hardware,
  HardwarePurchaseRow,
  ProductionCutRow,
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
  BoardSheetEstimate,
  Workspace,
  ProjectPickingState,
  PickingMaterial,
  PickingStatus,
  MaterialStock,
  StockMaterialKind,
  StockMovement,
  StockMovementType,
  PurchaseOrder,
  Supplier,
} from '@muebles/domain';
import {
  applyRoleChoiceToProject,
  bumpStructureRevision,
  calcMaterialCostPerM2,
  calcProjectBreakdown,
  computeProductionTotals,
  defaultMeasurePresetId,
  estimateBoardSheets,
  generateCutRows,
  generateHardwareList,
  generatePieceLabels,
  generateModuleLabels,
  generateProjectMaterialSummary,
  duplicateModule as deepCopyModule,
  duplicateProject as deepCopyProject,
  projectToTemplate,
  createProjectFromTemplate,
  navIdsForRole,
  resolveOwnerOnCreate,
  resolveOwnerOnUpdate,
  resolveWorkshopSettings,
  roleCanAssignOwner,
  roleCanDeleteProject,
  canExportProductionForProject,
  roleCanExportProduction,
  roleCanMarkPicking,
  roleCanMarkProduced,
  roleCanMutateCatalog,
  roleCanAccessPurchasingNav,
  roleCanManagePurchasing,
  roleCanMutateModules,
  roleCanMutateProjects,
  roleCanReopenProject,
  roleCanViewCosts,
  roleCanViewPortfolioDashboard,
  computeWorkshopAnalytics,
  type AnalyticsPeriodDays,
  type WarrantyTicket,
  type ItemFloorStatus,
  ITEM_FLOOR_STATUS_LABELS_ES,
  roleLabelEs,
  roleUsesProductionQueue,
  roleCanAccessProductionNav,
  roleIsScopedBySector,
  roleCanAccessFabricNav,   roleCanAccessShippingNav,
   roleCanAccessEmbarquesNav,
  filterProjectsByProcessStage,
  isProductionReady,
  suggestDuplicateCode,
  transitionProjectStatus,
  type WarehouseProjectInput,
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
  EmbarquesScreen,
  EmbarquesProjectDetail,
  InstalacionesScreen,
  type DashboardMetrics,
  type FabricActiveClaim,
  type FabricProjectMetrics,
  type FabricStation,
  EmptyState,
  ScreenBoundary,
  EngineeringDashboard,
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
  Modal,
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
  type ActiveProjectMaterial,
  PurchasingScreen,
  WarehouseDashboard,
  type PoLineInput,
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
import { runExport, type ExportDelivery } from './exports/runExport';
import { useExportHandlers } from './exports/useExportHandlers';
import { buildStockCatalog } from './derivations/stockCatalog';
import { usePurchasingDerivations } from './derivations/usePurchasingDerivations';
import { useQuoteDerivations } from './derivations/useQuoteDerivations';
import {
  computeModuleCostPreview,
  computeSelectedProjectBreakdown,
  resolveDisplayBreakdown,
} from './derivations/breakdown';
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
import { downloadDespiecePdf } from './exportDespiecePdf';
import { downloadCutPlanPdf } from './exportCutPlanPdf';
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
  NAV_PATHS,
  navBlockedForSession,
  navFromPath,
  pathForNav,
  productionOrderFromPath,
  productionOrderPath,
  shipmentDetailFromPath,
  shipmentDetailPath,
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
  resetCatalogStore,
  useProjectStore,
  ensureProjectStore,
  getProjectStoreState,
  resetProjectStore,
  useBackendBreakdownEffect,
  useUiStore,
  getUiStoreState,
  usePurchasingStore,
  ensurePurchasingStore,
  getPurchasingStoreState,
  resetPurchasingStore,
  type PurchasingState,
} from './stores';
import { SessionGate } from './SessionGate';
import { ToastViewport } from './components/ToastViewport';
import { BoardEditor } from './components/BoardEditor';


function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}


/** Thin web shell — wiring only; cost formulas only via domain engine. */
export function App(): ReactNode {
  // F064: ToastViewport reads from uiStore and portals toasts to document.body.
  // No ToastProvider wrapper — uiStore is the single source of truth.

  // F118 S2: feature stores are module singletons that outlive SessionGate —
  // clear them when the session ends so the previous user's catalog/projects
  // never sit in memory behind the login screen.
  const appSession = useWorkspaceStore((s) => s.session);
  useEffect(() => {
    if (appSession === null) {
      resetCatalogStore();
      resetProjectStore();
      resetPurchasingStore();
    }
  }, [appSession]);

  const logout = useWorkspaceStore((s) => s.logout);

  return (
    <>
      {appSession != null ? (
        <SessionGate>
          <AppContent session={appSession} onLogout={logout} />
        </SessionGate>
      ) : (
        <SessionGate>
          <span />
        </SessionGate>
      )}
      <ToastViewport />
    </>
  );
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
  // Keep catalogStore in sync with workspace LOADS (one-way: workspace →
  // catalog). F118 S1: keyed on workspaceSeq (bumped only on wholesale
  // replacements), so a settings-only save can never re-inject the stale
  // load-time catalog into the store.
  const workspaceSeq = useWorkspaceStore((s) => s.workspaceSeq);
  useEffect(() => {
    const ws = useWorkspaceStore.getState().workspace;
    if (ws?.catalog) {
      getCatalogStoreState().setCatalog(ws.catalog);
    } else {
      getCatalogStoreState().setCatalog(null);
    }
  }, [workspaceSeq]);

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
    // F118 S1: same seq-keying as the catalog sync above.
    const ws = useWorkspaceStore.getState().workspace;
    if (ws?.projects) {
      getProjectStoreState().setProjects(ws.projects);
      getProjectStoreState().setProjectTemplates(
        ws.projectTemplates ?? [],
      );
    } else {
      getProjectStoreState().setProjects([]);
      getProjectStoreState().setProjectTemplates([]);
    }
  }, [workspaceSeq]);

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

  // ─── F119: Compras/Almacén lives in purchasingStore ─────────────────────
  const canAccessPurchasing =
    session === 'guest' || roleCanAccessPurchasingNav(actorRole);
  ensurePurchasingStore({ deps: { getRepository } });
  const pickingStates = usePurchasingStore((s) => s.pickingStates);
  const stockRows = usePurchasingStore((s) => s.stockRows);
  const stockMovements = usePurchasingStore((s) => s.stockMovements);
  const suppliers = usePurchasingStore((s) => s.suppliers);
  const purchaseOrders = usePurchasingStore((s) => s.purchaseOrders);

  // Bulk load per workspace/session (seq bumps on login/logout/reload).
  useEffect(() => {
    if (!canAccessPurchasing) {
      resetPurchasingStore();
      return;
    }
    void getPurchasingStoreState().loadAll();
  }, [canAccessPurchasing, workspaceSeq]);

  const canManagePurchasing = session === 'guest' || roleCanManagePurchasing(actorRole);

  const handleRecordStockMovement = useCallback(
    (payload: {
      kind: StockMaterialKind;
      materialId: string;
      type: StockMovementType;
      quantity: number;
      note?: string;
    }) => getPurchasingStoreState().recordStockMovement(payload),
    [],
  );

  const handleUpsertStockMin = useCallback(
    (payload: {
      kind: StockMaterialKind;
      materialId: string;
      minStock: number;
    }) => getPurchasingStoreState().upsertStockMin(payload),
    [],
  );

  const handleSaveSupplier = useCallback(
    async (data: Parameters<PurchasingState['saveSupplier']>[0]) => {
      if (!canManagePurchasing) return;
      await getPurchasingStoreState().saveSupplier(data);
    },
    [canManagePurchasing],
  );

  const handleDeactivateSupplier = useCallback(
    async (id: string) => {
      if (!canManagePurchasing) return;
      await getPurchasingStoreState().deactivateSupplier(id);
    },
    [canManagePurchasing],
  );

  const handleSavePurchaseOrder = useCallback(
    async (data: Parameters<PurchasingState['savePurchaseOrder']>[0]) => {
      if (!canManagePurchasing) return;
      await getPurchasingStoreState().savePurchaseOrder(data);
    },
    [canManagePurchasing],
  );

  const handleEmitPurchaseOrder = useCallback(
    async (id: string) => {
      if (!canManagePurchasing) return;
      await getPurchasingStoreState().emitPurchaseOrder(id);
    },
    [canManagePurchasing],
  );

  const handleCancelPurchaseOrder = useCallback(
    async (id: string) => {
      if (!canManagePurchasing) return;
      await getPurchasingStoreState().cancelPurchaseOrder(id);
    },
    [canManagePurchasing],
  );

  const handleReceivePurchaseOrder = useCallback(
    async (id: string, lines: readonly PoLineInput[]) => {
      if (!canManagePurchasing) return;
      await getPurchasingStoreState().receivePurchaseOrder(id, lines);
    },
    [canManagePurchasing],
  );

  /** Catálogo para el panel de stock (derivación pura, F119). */
  const stockCatalog = useMemo(() => buildStockCatalog(catalog), [catalog]);
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
  const loadDemoWorkspace = useWorkspaceStore((s) => s.loadDemoWorkspace);
  const pendingGuestImport = useWorkspaceStore((s) => s.pendingGuestImport);
  const guestImportLoading = useWorkspaceStore((s) => s.guestImportLoading);
  const guestImportError = useWorkspaceStore((s) => s.guestImportError);
  const dismissGuestImport = useWorkspaceStore((s) => s.dismissGuestImport);
  const importGuestWorkspace = useWorkspaceStore(
    (s) => s.importGuestWorkspace,
  );

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

  // F118 A1: export error lists are context-bound — never let them follow
  // the user to another screen.
  useEffect(() => {
    if (useUiStore.getState().exportErrors.length > 0) {
      useUiStore.getState().setExportErrors([]);
    }
  }, [navId]);

  // Fase 4.1 — Fábrica metrics for supervisors (admin / gerente_produccion):
  // fetched only when they open the screen; sector-scoped operators never do
  // (no toggle for them). Null until loaded or on failure → queue view only.
  const canOpenFabric = roleCanAccessFabricNav(actorRole);
  const [fabricMetrics, setFabricMetrics] = useState<DashboardMetrics | null>(null);
  const [fabricActiveClaims, setFabricActiveClaims] = useState<readonly FabricActiveClaim[]>([]);
  useEffect(() => {
    if (navId !== 'production' || isSectorScoped) return;
    const repo = getRepository();
    if (!repo.getProductionDashboard) return;
    let cancelled = false;
    setFabricMetrics(null);
    repo
      .getProductionDashboard()
      .then((metrics) => {
        if (!cancelled) setFabricMetrics(metrics);
      })
      .catch(() => {
        if (!cancelled) setFabricMetrics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [navId, isSectorScoped, getRepository]);

  useEffect(() => {
    if (navId !== 'production' && navId !== 'orders') return;
    const repo = getRepository();
    if (!repo.getProductionActiveJobs) return;
    let cancelled = false;
    repo.getProductionActiveJobs().then((jobs) => {
      if (cancelled) return;
      setFabricActiveClaims(jobs.flatMap((job) => {
        if (!['cutting', 'edge_banding', 'assembly', 'packaging'].includes(job.sector) || job.itemId) return [];
        return [{
          activityId: job.activityId,
          projectId: job.projectId,
          sector: job.sector as FabricStation,
          operatorName: job.operatorName,
          startedAt: job.startedAt,
        }];
      }));
    }).catch(() => {
      if (!cancelled) setFabricActiveClaims([]);
    });
    return () => { cancelled = true; };
  }, [navId, getRepository]);

  // Fase 5.4 — screen error boundaries' escape hatch (keeps the shell alive).
  const goHomeFromScreen = useCallback(() => {
    const target = pathForNav('home');
    if (location.pathname !== target) navigate(target);
  }, [location.pathname, navigate]);

  const routeEntityId =
    isEntitySection(navId)
      ? entityIdFromPath(location.pathname, navId)
      : null;
  const routeProjectId =
    navId === 'quotes' ? routeEntityId : null;
  const routeModuleId = navId === 'modules' ? routeEntityId : null;
  const routeStructureId = navId === 'structures' ? routeEntityId : null;
  const routeComponentId = navId === 'components' ? routeEntityId : null;
  const productionOrderRoute =
    navId === 'orders' ? productionOrderFromPath(location.pathname) : null;
  const routeProductionOrderId = productionOrderRoute?.projectId ?? null;
  const routeProductionOrderTab = parseProductionOrderTab(
    productionOrderRoute?.tab ?? 'resumen',
  );
  const routeShipmentProjectId =
    navId === 'shipments' ? shipmentDetailFromPath(location.pathname) : null;
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
    const blocked =
      (session === 'auth' || session === 'guest') &&
      navBlockedForSession(session, actorRole, resolved);
    if (blocked) {
      toast({
        type: 'error',
        message:
          session === 'guest'
            ? 'Esta sección necesita sesión con el servidor. Salí del modo local y entrá con tu cuenta.'
            : 'No tenés permiso para esta sección. Pedile a un admin que te asigne el puesto correcto.',
      });
      navigate(pathForNav('home'), { replace: true });
    }
  }, [location.pathname, navigate, session, actorRole, toast]);

  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [showOnboardingTour, setShowOnboardingTour] = useState(false);

  // Welcome tour auto-opens at Inicio only — never above factory routes
  // (/production) or deep links. Any dismiss persists (see modal).
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
    // F118 S6: the hardcoded seed id only exists in guest/demo workspaces —
    // resolve the real project (or fall back to the quotes list) so auth
    // users don't land on a dead end.
    const allProjects = getProjectStoreState().projects;
    const demo =
      allProjects.find((p) => p.id === 'proj-cocina-lopez-demo') ??
      allProjects.find((p) => /cocina\s*lopez/i.test(p.name));
    if (!demo) {
      navigate(NAV_PATHS.quotes);
      return;
    }
    const targetPath = projectPath(demo.id);
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

  // F120: production/purchasing derivations live in usePurchasingDerivations.
  const {
    purchasingProjects,
    warehouseProjects,
    fabricMetricsByProject,
    moduleLabelForFabric,
    stockDebitLinesFor,
  } = usePurchasingDerivations({
    catalog,
    projects,
    materials,
    customers,
    edges,
    modules,
    stockRows,
    stockCatalog,
  });

  const handleTogglePick = useCallback(
    (input: {
      projectId: string;
      material: PickingMaterial;
      status: PickingStatus;
    }) => {
      // F119: persistence + ledger revert live in purchasingStore; the debit
      // lines derive from live projects/catalog so they're computed here.
      getPurchasingStoreState().togglePick(input, stockDebitLinesFor);
    },
    [stockDebitLinesFor],
  );
  // F120: quote/dashboard derivations live in useQuoteDerivations.
  const {
    workshopSettings,
    showCosts,
    modulePreview,
    moduleEstimates,
    projectQuote,
    materialSummary,
    projectEstimates,
    dashboardStats,
    dashboardRecent,
    dashboardOwnerBreakdown,
  } = useQuoteDerivations({
    workspaceSettings: workspace?.settings,
    session,
    actorRole,
    catalog,
    modules,
    materials,
    customers,
    projects,
    selectedProject,
    editingModuleId,
    canViewPortfolioDashboard,
    assignableOwners,
  });

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
    navigate(pathForNav('quotes'));
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
      navigate(pathForNav('quotes'));
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
      navigate(pathForNav('quotes'));
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
          navigate(pathForNav('quotes'));
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
      // Store action persists via saveProject (engineering_log column).
      projectActions.startEngineering(projectId, authUser?.id ?? 'unknown');
      navigate(engineeringProjectPath(projectId));
    },
    [authUser?.id, projectActions, navigate],
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

  // Menu reorg — shared floor advance for Producción (stations) and
  // Embarques (cargar/instalar). Server path enforces station scoping +
  // writes the audit event (F094); mirror locally to keep lists in sync.
  const handleFloorAdvance = useCallback(
    (projectId: string, itemId: string, target: ItemFloorStatus) => {
      // packaged → loaded is a warehouse (Almacén) transition, not production.
      // Only almacen and admins can advance past packaged.
      if (target === 'loaded') {
        if (actorRole !== 'admin' && actorRole !== 'gerente_produccion' && actorRole !== 'almacen') {
          toast({ type: 'error', message: 'La carga de muebles es responsabilidad de Almacén.' });
          return;
        }
      }
      const repo = getRepository();
      if (repo.setProjectItemFloorStatus) {
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
    },
    [getRepository, setItemFloorStatus, toast, actorRole],
  );

  const handleFabricClaim = useCallback(async (projectId: string, sector: FabricStation): Promise<void> => {
    const repo = getRepository();
    if (!repo.claimProductionActivity) return;
    try {
      const activity = await repo.claimProductionActivity({ projectId, sector });
      setFabricActiveClaims((previous) => [...previous, {
        activityId: activity.id,
        projectId: activity.projectId,
        sector,
        operatorName: activity.operatorName,
        startedAt: activity.startedAt,
      }]);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo iniciar la estación' });
    }
  }, [getRepository, toast]);

  const handleFabricFinish = useCallback(async (activityId: string, piecesCount: number): Promise<void> => {
    const repo = getRepository();
    if (!repo.finishProductionActivity) return;
    try {
      await repo.finishProductionActivity(activityId, { piecesCount });
      setFabricActiveClaims((previous) => previous.filter((claim) => claim.activityId !== activityId));
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo terminar la estación' });
      throw err;
    }
  }, [getRepository, toast]);

  const handleFabricBatchAdvance = useCallback(
    (projectId: string, itemIds: readonly string[], target: ItemFloorStatus) => {
      for (const itemId of itemIds) handleFloorAdvance(projectId, itemId, target);
    },
    [handleFloorAdvance],
  );

  // F120: batch confirmation renders a design-system modal in FabricScreen;
  // the shell only provides the message.
  const fabricBatchConfirmMessage = useCallback(
    (itemCount: number, target: ItemFloorStatus): string =>
      `¿Marcar ${itemCount} módulos como ${ITEM_FLOOR_STATUS_LABELS_ES[target]}? Cada avance queda registrado por separado.`,
    [],
  );

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
        (newId) => navigate(entityPath('quotes', newId)),
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


  /**
   * roadmap-screens 2a — every successful engineering export stamps
   * generatedBy/At on the project's engineering log (makes "Documentado"
   * reachable and dated on the landing).
   */
  const stampEngineeringGeneration = useCallback(
    (projectId?: string) => {
      const id = projectId ?? selectedProject?.id;
      if (!id) return;
      projectActions.recordEngineeringGeneration(id, authUser?.id ?? 'unknown');
    },
    [projectActions, authUser?.id, selectedProject?.id],
  );


  // F120: the 14 export/workflow handlers live in useExportHandlers.
  const {
    handleExportOptimizer,
    handleExportHardwareList,
    handleExportPieceLabels,
    handleExportModuleLabels,
    handleExportElevations,
    handleExportCncPilot,
    handleExportAssemblySheets,
    handleExportCutListCsv,
    handleExportDespiecePdf,
    handleExportCutPlanPdf,
    handleReleaseToDelivery,
    handleExportProductionPack,
    handleExportCommercialQuote,
    handleExportCommercialQuotePdf,
  } = useExportHandlers({
    projects,
    selectedProject,
    catalog,
    customers,
    session,
    actorRole,
    workspaceSettings: workspace?.settings,
    toast,
    stampEngineeringGeneration,
    recordProductionExport,
    updateProjectTechnicalWorkflow: projectActions.updateProjectTechnicalWorkflow,
  });

  const onEntitySelectionChange = useCallback(
    (section: EntitySection, id: string | null) => {
      if (section === 'quotes') {
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

  /** Screen-level selection callback for sections without a bespoke one. */
  const onAddOnsSelectionChange = useCallback(
    (id: string | null) => onEntitySelectionChange('addOns', id),
    [onEntitySelectionChange],
  );

  const onFinishesSelectionChange = useCallback(
    (id: string | null) => onEntitySelectionChange('finishes', id),
    [onEntitySelectionChange],
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
      onEntitySelectionChange('quotes', projectId);
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
                // F118 S6: consistent demo recovery — clears error/loading
                // state and persists the seed in guest mode.
                void loadDemoWorkspace();
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
      {navId === 'production' && canOpenFabric ? (
        <ScreenBoundary screenLabel="Producción" onGoHome={goHomeFromScreen}>
        <FabricScreen
          projects={projectsForRole}
          assignedSectors={isSectorScoped ? mySectors : null}
          metrics={isSectorScoped ? undefined : fabricMetrics}
          canAdvance={
            session === 'auth' &&
            (canMarkProduced || roleCanExportProduction(actorRole))
          }
          onAdvance={handleFloorAdvance}
          customerLabelFor={(customerId) =>
            resolveCustomerName(customerId, customers)
          }
          moduleLabelFor={moduleLabelForFabric}
          metricsByProject={fabricMetricsByProject}
          pickingStates={pickingStates ?? []}
          activeClaims={fabricActiveClaims}
          onClaim={session === 'auth' ? handleFabricClaim : undefined}
          onFinish={session === 'auth' ? handleFabricFinish : undefined}
          onAdvanceBatch={handleFabricBatchAdvance}
          confirmBatchMessage={fabricBatchConfirmMessage}
        />
        </ScreenBoundary>
      ) : null}
      {navId === 'shipments' && roleCanAccessEmbarquesNav(actorRole) ? (
        <ScreenBoundary screenLabel="Embarques" onGoHome={goHomeFromScreen}>
        {routeShipmentProjectId ? (() => {
          const shipmentProject = projectsForRole.find(
            (p) => p.id === routeShipmentProjectId,
          );
          if (!shipmentProject) {
            return (
              <EmptyState
                title="Obra no encontrada"
                description="Esa obra no está en embarques o no tenés acceso."
                actionLabel="Volver a Embarques"
                onAction={() => navigate(pathForNav('shipments'))}
              />
            );
          }
          return (
            <EmbarquesProjectDetail
              project={shipmentProject}
              modules={modules}
              catalog={catalog}
              customerName={resolveCustomerName(
                shipmentProject.customerId,
                customers,
              )}
              onSetFloorStatus={
                session === 'auth'
                  ? (itemId, status) =>
                      handleFloorAdvance(shipmentProject.id, itemId, status)
                  : undefined
              }
              canSetFloorStatus={
                session === 'auth' &&
                roleCanAccessEmbarquesNav(actorRole)
              }
              onReleaseToDelivery={() => {
                void handleReleaseToDelivery(shipmentProject.id);
              }}
              canReleaseToDelivery={
                session === 'auth' &&
                roleCanAccessEmbarquesNav(actorRole)
              }
              onBack={() => navigate(pathForNav('shipments'))}
            />
          );
        })() : (
          <EmbarquesScreen
            projects={projectsForRole}
            customerLabelFor={(customerId) =>
              resolveCustomerName(customerId, customers)
            }
            onOpenProject={(id) => {
              const target = shipmentDetailPath(id);
              if (location.pathname !== target) navigate(target);
            }}
          />
        )}
        </ScreenBoundary>
      ) : null}
      {navId === 'installations' && roleCanAccessShippingNav(actorRole) ? (
        <ScreenBoundary screenLabel="Instalaciones" onGoHome={goHomeFromScreen}>
        <InstalacionesScreen
          projects={projectsForRole}
          canAdvance={
            session === 'auth' &&
            (canMarkProduced || roleCanExportProduction(actorRole))
          }
          onAdvance={handleFloorAdvance}
          customerFor={(customerId) =>
            customers.find((customer) => customer.id === customerId)
          }
        />
        </ScreenBoundary>
      ) : null}
      {navId === 'engineeringDashboard' ? (
        <ScreenBoundary screenLabel="Dashboard de Ingeniería" onGoHome={goHomeFromScreen}>
        <EngineeringDashboard
          projects={projectsForRole.map((p) => ({
            ...p,
            customerLabel: resolveCustomerName(p.customerId, customers),
          }))}
          onOpenProject={(id) => {
            const target = engineeringProjectPath(id);
            if (location.pathname !== target) navigate(target);
          }}
          onOpenQueue={() => {
            const target = pathForNav('engineering');
            if (location.pathname !== target) navigate(target);
          }}
          assignableEngineers={assignableOwners.map((u) => ({ id: u.id, name: u.name }))}
          engineerLabels={ownerLabels}
        />
        </ScreenBoundary>
      ) : null}
      {navId === 'engineering' && !routeEngineeringProjectId ? (
        <ScreenBoundary screenLabel="Ingeniería" onGoHome={goHomeFromScreen}>
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
          onOpenDashboard={() => {
            const target = pathForNav('engineeringDashboard');
            if (location.pathname !== target) navigate(target);
          }}
          currentUserId={authUser?.id}
        />
        </ScreenBoundary>
      ) : null}
      {navId === 'engineering' && routeEngineeringProjectId ? (
        <ScreenBoundary screenLabel="Ingeniería" onGoHome={goHomeFromScreen}>
        {(() => {
        const engProject = projects.find((p) => p.id === routeEngineeringProjectId);
        if (!engProject) {
          return (
            <EmptyState
              icon={FileQuestion}
              title="Proyecto no encontrado"
              description="Puede haberse eliminado o el enlace es de otra obra."
              actionLabel="Volver a Ingeniería"
              onAction={() => navigate(pathForNav('engineering'))}
            />
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
            onExportModulePdf={(labels) => { void handleExportModuleLabels(engProject.id, { labels }); }}
            onExportHardware={() => { void handleExportHardwareList(engProject.id); }}
            onExportElevations={() => { void handleExportElevations(engProject.id); }}
            onExportOptimizer={() => { void handleExportOptimizer(engProject.id); }}
            onExportProductionPack={() => { void handleExportProductionPack(engProject.id); }}
            onExportCutListCsv={() => { void handleExportCutListCsv(engProject.id); }}
            onExportPieceLabels={(lbls, opts) => { void handleExportPieceLabels(engProject.id, { labels: lbls, perUnit: opts.perUnit }); }}
            onExportModuleLabels={(lbls) => { void handleExportModuleLabels(engProject.id, { labels: lbls }); }}
            onExportAssemblySheets={() => { void handleExportAssemblySheets(engProject.id); }}
            onExportCncPilot={() => { void handleExportCncPilot(engProject.id); }}
            onExportDespiecePdf={() => { void handleExportDespiecePdf(engProject.id); }}
            onSaveCutPlan={(plan) => { projectActions.saveCutPlan(engProject.id, plan); }}
            onExportCutPlanPdf={(plan) => { void handleExportCutPlanPdf(plan); }}
            canImportNesting={canMarkProduced || roleCanExportProduction(actorRole)}
            onImportNesting={(result) => { importNestingResult(engProject.id, result); }}
            exportBusy={exportBusy}
            onSendToProduction={() => {
              if (!catalog) return;
              projectActions.sendProjectToProduction(
                engProject.id,
                authUser?.id ?? 'unknown',
                catalog,
              );
            }}
            onMarkDocumented={() => {
              projectActions.recordEngineeringGeneration(
                engProject.id,
                authUser?.id ?? 'unknown',
              );
            }}
          />
        );
        })()}
        </ScreenBoundary>
      ) : null}
      {navId === 'warehouseDashboard' ? (
        <ScreenBoundary screenLabel="Dashboard de Almacén" onGoHome={goHomeFromScreen}>
        <WarehouseDashboard
          projects={warehouseProjects}
          stock={stockRows}
          purchaseOrders={purchaseOrders}
          initialPicking={pickingStates}
          onOpenQueue={() => {
            const target = pathForNav('warehouse');
            if (location.pathname !== target) navigate(target);
          }}
          onOpenProject={(_id) => {
            const target = pathForNav('warehouse');
            if (location.pathname !== target) navigate(target);
          }}
          materialLabels={stockCatalog.labels}
        />
        </ScreenBoundary>
      ) : null}
      {navId === 'warehouse' ? (
        <ScreenBoundary screenLabel="Compras y Almacén" onGoHome={goHomeFromScreen}>
        <PurchasingScreen
          projects={purchasingProjects}
          role={actorRole ?? null}
          assignedSectors={mySectors}
          initialPicking={pickingStates}
          onTogglePick={handleTogglePick}
          onOpenDashboard={() => {
            const target = pathForNav('warehouseDashboard');
            if (location.pathname !== target) navigate(target);
          }}
          onReleaseMaterials={(projectId) =>
            projectActions.releaseProjectMaterials(
              projectId,
              authUser?.id ?? 'unknown',
            )
          }
          stock={stockRows}
          stockMovements={stockMovements}
          stockLabels={stockCatalog.labels}
          stockCatalogOptions={stockCatalog.options}
          materialIdByCode={stockCatalog.materialIdByCode}
          edgeIdByCode={stockCatalog.edgeIdByCode}
          stockPrices={stockCatalog.prices}
          showStockCosts={showCosts}
          currency={workshopSettings.defaultCurrency ?? undefined}
          onRecordStockMovement={handleRecordStockMovement}
          onUpsertStockMin={handleUpsertStockMin}
          suppliers={suppliers}
          purchaseOrders={purchaseOrders}
          onSaveSupplier={handleSaveSupplier}
          onDeactivateSupplier={handleDeactivateSupplier}
          onSavePurchaseOrder={handleSavePurchaseOrder}
          onEmitPurchaseOrder={handleEmitPurchaseOrder}
          onCancelPurchaseOrder={handleCancelPurchaseOrder}
          onReceivePurchaseOrder={handleReceivePurchaseOrder}
        />
        </ScreenBoundary>
      ) : null}
      {navId === 'salesDashboard' ? (
        <ScreenBoundary screenLabel="Dashboard de Ventas" onGoHome={goHomeFromScreen}>
        <SalesDashboard
          projects={projectsForRole.map((p) => ({
            ...p,
            customerLabel: resolveCustomerName(p.customerId, customers),
          }))}
          onOpenProject={(id) => {
            const target = projectPath(id);
            if (location.pathname !== target) navigate(target);
          }}
          onCancelProject={(id) => projectActions.cancelProject(id)}
          isVendedor={actorRole === 'vendedor'}
          currentUserId={authUser?.id}
          vendedores={assignableOwners.map((u) => ({ id: u.id, name: u.name }))}
          ownerLabels={ownerLabels}
        />
        </ScreenBoundary>
      ) : null}
      {navId === 'plantBoard' ? (
        <ScreenBoundary screenLabel="Estado de Planta" onGoHome={goHomeFromScreen}>
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
        </ScreenBoundary>
      ) : null}
      {navId === 'productionDashboard' ? (
        <ScreenBoundary screenLabel="Panel de producción">
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
        </ScreenBoundary>
      ) : null}
      {navId === 'orders' && useProductionWorkspace ? (
        <ProductionWorkspace
          projects={(filterProjectsToPlant ? projectsForRole : filterProductionVisible(projects)).filter(isProductionReady)}
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
            const target = pathForNav('orders');
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
          activeClaims={fabricActiveClaims}
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
      {navId === 'finishes' ? (
        <AmbientMaterialsCatalog
          openEntityId={navId === 'finishes' ? routeEntityId : null}
          onSelectionChange={onFinishesSelectionChange}
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
            // F118 S4: '/cotizaciones' does not exist in NAV_PATHS — the
            // guard bounced this to Home. Use the route helper.
            navigate(projectPath(projectId));
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
      {navId === 'addOns' ? (
        <AgregadosScreen
          agregados={agregados}
          openAgregadoId={navId === 'addOns' ? routeEntityId : null}
          onSelectionChange={onAddOnsSelectionChange}
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
      {navId === 'quotes' ? (
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

      {/* F118 S3: guest → auth handoff — offer to bring guest work in
          instead of discarding it silently. */}
      <Modal
        open={pendingGuestImport}
        onClose={dismissGuestImport}
        title="Tenés trabajo como invitado"
        size="sm"
        dataTestId="guest-import-modal"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={dismissGuestImport}
              disabled={guestImportLoading}
            >
              Dejarlo local
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                void importGuestWorkspace();
              }}
              disabled={guestImportLoading}
              data-testid="guest-import-confirm"
            >
              {guestImportLoading ? 'Importando…' : 'Traer a mi cuenta'}
            </button>
          </>
        }
      >
        <div className="catalog-form">
          <p>
            Encontramos cotizaciones hechas en modo invitado en este
            navegador. Podés importarlas a tu cuenta (catálogo, proyectos y
            plantillas) o dejarlas guardadas localmente para volver al modo
            invitado.
          </p>
          {guestImportError ? (
            <p className="catalog-form__error" data-testid="guest-import-error">
              {guestImportError}
            </p>
          ) : null}
        </div>
      </Modal>

      <OnboardingTourModal
        isOpen={showOnboardingTour}
        onClose={() => setShowOnboardingTour(false)}
        onLoadDemoProject={handleLoadCocinaLopezDemo}
      />
    </AppShell>
  );
}
