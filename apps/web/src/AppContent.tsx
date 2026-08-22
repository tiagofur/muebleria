/**
 * AppContent — the authenticated/guest shell orchestration (F121 extract
 * from App.tsx): store wiring, effects, handlers, derivations and the ctx
 * for ShellView. App.tsx is the thin composition root.
 */

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
  roleCanAppendProjectEvent,
  roleCanViewPortfolioDashboard,
  roleCanSuperviseFloor,
  computeWorkshopAnalytics,
  deriveOpsExceptions,
  type AnalyticsPeriodDays,
  type WarrantyTicket,
  type ItemFloorStatus,
  ITEM_FLOOR_STATUS_LABELS_ES,
  roleLabelEs,
  roleUsesProductionQueue,
  roleCanAccessProductionNav,
  roleIsScopedBySector,
  roleCanAccessFabricNav,
  roleCanAccessShippingNav,
  roleCanAccessEmbarquesNav,
  filterProjectsByProcessStage,
  isProductionReady,
  suggestDuplicateCode,
  transitionProjectStatus,
  type WarehouseProjectInput,
  deriveProjectPartExecutions,
  scheduleInstallationVisit,
  startInstallationVisit,
  completeInstallationVisit,
  cancelInstallationVisit,
  reportFieldIssue,
  transitionFieldIssue,
  openPunchItem,
  closePunchItem,
  completeInstallation,
  recordClientSignOff,
  closeProjectCloseout,
  type FieldIssueStatus,
  type InstallationJob,
  type InstallationVisitResult,
  type PunchSeverity,
  buildMaterialRequirements,
  materializeRequirements,
  reserveProjectMaterials,
  consumePlannedMaterials,
  releaseProjectMaterials,
  reportQualityIssue,
  captureCostBaseline,
  setLaborRate,
  recordTimeEntry,
  voidTimeEntry,
  recordOtherCost,
  voidOtherCost,
  computeJobCostSummary,
  reworkCostSummary,
  createSiteSurvey,
  upsertSurveySpace,
  removeSurveySpace,
  captureSpaceMeasures,
  verifySiteSurvey,
  approveSpaceMeasures,
  freezeMeasuresForFabrication,
  transitionQualityIssue,
  recordReworkAction,
  recordUnitQc,
  overrideUnitQc,
  type MaterialRequirementLine,
  type ReworkActionType,
  type QualityIssueCategory,
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
  materialPlanningCardView,
  shortagePoLines,
  qualityPanelView,
  type MaterialPlanningCardView,
  type MaterialPlanningHandlers,
  type QualityPanelView,
  type QualityHandlers,
  costingPanelView,
  MATERIAL_BASIS_LABELS_ES,
  type CostingPanelView,
  type CostingHandlers,
  type SurveyHandlers,
  type ProjectOverviewNav,
} from '@muebles/ui';
import {
  APIWorkspaceRepository,
  LocalStorageWorkspaceRepository,
  breakdownFromApi,
  createSeedWorkspace,
  type JobCostingView,
  type SiteSurveyView,
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
  installationDetailPath,
  installationDetailFromPath,
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
import { ShellView } from './ShellView';
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


export function AppContent({
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
  const routeInstallationProjectId =
    navId === 'installations' ? installationDetailFromPath(location.pathname) : null;
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
    requirementLinesFor,
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

  /**
   * R2 (F138): a picking despacho hands material to the project — its active
   * reservations are consumed (oldest first). API mode hits the dedicated
   * endpoint and applies the server planning; the local workspace runs the
   * pure action. An unmark reverts stock but never revokes consumption (the
   * reservation record is history).
   */
  const consumeOnDespachado = useCallback(
    (projectId: string, lines: readonly { kind: string; materialId: string; quantity: number }[]) => {
      if (lines.length === 0) return;
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project?.materialPlanning) return;
      const typedLines = lines as Array<{ kind: 'herrajes' | 'tableros' | 'cintillas'; materialId: string; quantity: number }>;
      const repo = getRepository();
      if (repo.consumeMaterials) {
        void repo
          .consumeMaterials(projectId, typedLines)
          .then((view) => {
            projectActions.applyMaterialPlanningProject(projectId, {
              ...project,
              materialPlanning: view.planning ?? project.materialPlanning,
            });
          })
          .catch(() => {
            // El despacho de stock ya quedó; el consumo se reintenta en el
            // próximo despacho (oldest-first) — no bloquea al operador.
          });
        return;
      }
      const next = consumePlannedMaterials(project.materialPlanning, typedLines);
      if (next && next !== project.materialPlanning) {
        projectActions.applyMaterialPlanningProject(projectId, { ...project, materialPlanning: next });
      }
    },
    [getRepository, projectActions],
  );

  const handleTogglePick = useCallback(
    (input: {
      projectId: string;
      material: PickingMaterial;
      status: PickingStatus;
    }) => {
      // F119: persistence + ledger revert live in purchasingStore; the debit
      // lines derive from live projects/catalog so they're computed here.
      getPurchasingStoreState().togglePick(input, stockDebitLinesFor, {
        onDespachado: consumeOnDespachado,
      });
    },
    [stockDebitLinesFor, consumeOnDespachado],
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

  // OC-090 — exception-first list for the owner/manager home. Derived from
  // real project state; shortage/WIP/material inputs arrive from the shell
  // derivations when available (no invented KPIs).
  const opsExceptions = useMemo(() => {
    if (!canViewPortfolioDashboard) return [];
    return deriveOpsExceptions(projects);
  }, [canViewPortfolioDashboard, projects]);

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

  // #301 — physical advances: piece operations and unit transitions go
  // through the part-executions endpoints (server gate + audit); the local
  // mirror applies the same pure domain logic to keep lists in sync. The
  // offline/local workspace uses the pure path directly.
  const handleAdvancePart = useCallback(
    (projectId: string, partId: string) => {
      const repo = getRepository();
      if (repo.advancePartOperation) {
        void repo
          .advancePartOperation(projectId, partId, { advance: true, source: 'manual' })
          .then(() => {
            projectActions.advancePartInstanceLocal(projectId, partId);
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'No se pudo avanzar la pieza',
            });
          });
      } else {
        projectActions.advancePartInstanceLocal(projectId, partId);
      }
    },
    [getRepository, projectActions, toast],
  );

  const handleAdvanceUnit = useCallback(
    (projectId: string, unitId: string) => {
      const repo = getRepository();
      if (repo.advanceModuleUnit) {
        void repo
          .advanceModuleUnit(projectId, unitId, { advance: true, source: 'manual' })
          .then(() => {
            projectActions.advanceModuleUnitLocal(projectId, unitId);
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'No se pudo avanzar la unidad',
            });
          });
      } else {
        const result = projectActions.advanceModuleUnitLocal(projectId, unitId);
        if (!result.ok) {
          toast({ type: 'error', message: result.blockers.join(' · ') });
        }
      }
    },
    [getRepository, projectActions, toast],
  );

  /**
   * #301 — generate the physical executions of a released project from its
   * catalog BOM. API mode validates server-side (lines/quantities/released
   * revision, progress guard); local mode sets them directly. No-op when the
   * project already progressed physically (regeneration needs supervision).
   */
  const handleGeneratePartExecutions = useCallback(
    (projectId: string) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project || !project.productionRelease || !catalog) return;
      if (project.partInstances?.length) {
        const hasProgress =
          project.partInstances.some((p) =>
            p.requiredOperations.some((op) => op.status === 'completed' || op.status === 'rework'),
          ) ||
          project.moduleUnits?.some((u) => u.status !== 'awaiting_parts');
        if (hasProgress) return; // regeneration is a supervised action, never automatic
      }
      const derived = deriveProjectPartExecutions(project, catalog);
      if (!derived.ok) {
        toast({
          type: 'error',
          message: `No se pudieron generar las piezas físicas (línea ${derived.error.projectItemId}): ${derived.error.message}`,
        });
        return;
      }
      const { parts, units } = derived.executions;
      const repo = getRepository();
      if (repo.generatePartExecutions) {
        void repo
          .generatePartExecutions(projectId, { partInstances: parts, moduleUnits: units })
          .then(() => {
            projectActions.setPartExecutions(projectId, parts, units);
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'No se pudo generar la ejecución física',
            });
          });
      } else {
        projectActions.setPartExecutions(projectId, parts, units);
      }
    },
    [catalog, getRepository, projectActions, toast],
  );

  /**
   * #303 (OC-070..OC-074) — installation job actions. The pure domain action
   * validates client-side and computes the next job; API mode PUTs it to the
   * installation endpoint (server re-validates transitions and appends the
   * audit lifecycle events) and mirrors the server-persisted job; the
   * local/offline workspace applies the pure result (job + events) directly.
   */
  const runInstallationJobAction = useCallback(
    (
      projectId: string,
      action: (project: Project) => { project: Project; job: InstallationJob },
    ) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project) return;
      let result: { project: Project; job: InstallationJob };
      try {
        result = action(project);
      } catch (err) {
        toast({
          type: 'error',
          message:
            err instanceof Error && err.message
              ? err.message
              : 'Acción de instalación inválida',
        });
        return;
      }
      const repo = getRepository();
      if (repo.saveInstallation) {
        void repo
          .saveInstallation(projectId, result.job)
          .then(() => {
            projectActions.setInstallationJob(projectId, result.job);
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'No se pudo guardar la instalación',
            });
          });
      } else {
        projectActions.applyInstallationProject(projectId, result.project);
      }
    },
    [getRepository, projectActions, toast],
  );

  /**
   * #303 — server-authoritative closeout milestones: completar instalación,
   * conformidad del cliente y cierre del proyecto (OC-074 gates). The pure
   * action gives the same validation offline; the endpoint enforces it for
   * every client.
   */
  const runInstallationCloseout = useCallback(
    (
      projectId: string,
      payload: {
        action: 'complete_installation' | 'sign_off' | 'close';
        signedOffBy?: string;
      },
      action: (project: Project) => { project: Project },
    ) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project) return;
      let local: { project: Project };
      try {
        local = action(project);
      } catch (err) {
        toast({
          type: 'error',
          message:
            err instanceof Error && err.message
              ? err.message
              : 'Acción de cierre inválida',
        });
        return;
      }
      const repo = getRepository();
      if (repo.installationCloseout) {
        void repo
          .installationCloseout(projectId, payload)
          .then((res) => {
            projectActions.setInstallationJob(projectId, res.installation);
            toast({
              type: 'success',
              message:
                payload.action === 'complete_installation'
                  ? '✓ Instalación completada'
                  : payload.action === 'sign_off'
                    ? '✓ Conformidad registrada'
                    : '✓ Proyecto cerrado',
            });
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'No se pudo completar la acción de cierre',
            });
          });
      } else {
        projectActions.applyInstallationProject(projectId, local.project);
        toast({
          type: 'success',
          message:
            payload.action === 'complete_installation'
              ? '✓ Instalación completada'
              : payload.action === 'sign_off'
                ? '✓ Conformidad registrada'
                : '✓ Proyecto cerrado',
        });
      }
    },
    [getRepository, projectActions, toast],
  );

  const installationJobHandlers = useMemo(
    () => ({
      onScheduleVisit: (projectId: string, params: { date: string; crew: readonly string[]; notes?: string }) =>
        runInstallationJobAction(projectId, (p) => scheduleInstallationVisit(p, params)),
      onStartVisit: (projectId: string, visitId: string) =>
        runInstallationJobAction(projectId, (p) => startInstallationVisit(p, visitId, {})),
      onCompleteVisit: (
        projectId: string,
        visitId: string,
        params: { result: InstallationVisitResult; resultNotes?: string },
      ) => runInstallationJobAction(projectId, (p) => completeInstallationVisit(p, visitId, params)),
      onCancelVisit: (projectId: string, visitId: string) =>
        runInstallationJobAction(projectId, (p) => cancelInstallationVisit(p, visitId, {})),
      onReportIssue: (projectId: string, params: { description: string }) =>
        runInstallationJobAction(projectId, (p) => reportFieldIssue(p, params)),
      onTransitionIssue: (projectId: string, issueId: string, to: FieldIssueStatus) =>
        runInstallationJobAction(projectId, (p) => transitionFieldIssue(p, issueId, to, {})),
      onOpenPunch: (
        projectId: string,
        params: {
          description: string;
          owner: string;
          dueDate?: string;
          severity: PunchSeverity;
          isBlocker: boolean;
        },
      ) => runInstallationJobAction(projectId, (p) => openPunchItem(p, params)),
      onClosePunch: (projectId: string, punchItemId: string, params: { resolutionNotes: string }) =>
        runInstallationJobAction(projectId, (p) => closePunchItem(p, punchItemId, params)),
      onCompleteInstallation: (projectId: string) =>
        runInstallationCloseout(projectId, { action: 'complete_installation' }, (p) =>
          completeInstallation(p, {}),
        ),
      onSignOff: (projectId: string, params: { signedOffBy: string }) =>
        runInstallationCloseout(
          projectId,
          { action: 'sign_off', signedOffBy: params.signedOffBy },
          (p) => recordClientSignOff(p, { signedOffBy: params.signedOffBy }),
        ),
      onCloseProject: (projectId: string) =>
        runInstallationCloseout(projectId, { action: 'close' }, (p) => closeProjectCloseout(p, {})),
    }),
    [runInstallationJobAction, runInstallationCloseout],
  );
  /** Evidence view per almacén-stage project (coverage + release gates). */
  const planningByProject = useMemo<Readonly<Record<string, MaterialPlanningCardView>>>(() => {
    const plannings = projectActions.projects
      .map((p) => p.materialPlanning)
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    const entries = filterProjectsByProcessStage(projectActions.projects, 'almacen')
      .map((project) => [
        project.id,
        materialPlanningCardView(project, plannings, stockRows ?? [], purchaseOrders ?? []),
      ] as const);
    return Object.fromEntries(entries);
  }, [projectActions.projects, stockRows, purchaseOrders]);

  /**
   * #302 (OC-050..OC-054) — material planning actions. API mode calls the
   * dedicated materials endpoints (server enforces the release binding,
   * reservation caps and the OC-054 gates with audited override); the
   * local/offline workspace runs the pure domain actions.
   */
  const runMaterialPlanningAction = useCallback(
    (
      projectId: string,
      kind: 'derive' | 'reserve' | 'release',
      payload: { lines?: readonly MaterialRequirementLine[]; overrideReason?: string },
      localAction: (project: Project) => Project,
      successMessage: string,
    ) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project) return;
      let local: Project;
      try {
        local = localAction(project);
      } catch (err) {
        toast({
          type: 'error',
          message: err instanceof Error && err.message ? err.message : 'Acción de materiales inválida',
        });
        return;
      }
      const applyLocal = (): void => {
        projectActions.applyMaterialPlanningProject(projectId, local);
        toast({ type: 'success', message: successMessage });
      };
      const fail = (err: unknown): void => {
        toast({
          type: 'error',
          message: err instanceof Error && err.message ? err.message : 'No se pudo completar la acción de materiales',
        });
      };
      const repo = getRepository();
      // API mode: the server re-computes caps/gates/stamps — apply the
      // server-returned planning (not the local mirror) so ids/timestamps
      // stay the server truth until the next refresh.
      const applyServer = (view: { planning: unknown; released: boolean }): void => {
        const serverPlanning = view.planning as Project['materialPlanning'];
        projectActions.applyMaterialPlanningProject(projectId, {
          ...local,
          materialPlanning: serverPlanning ?? local.materialPlanning,
          materialsRelease: view.released
            ? (local.materialsRelease ?? project.materialsRelease)
            : project.materialsRelease,
        });
        toast({ type: 'success', message: successMessage });
      };
      if (kind === 'derive' && repo.deriveMaterialRequirements && payload.lines) {
        void repo.deriveMaterialRequirements(projectId, payload.lines).then(applyServer).catch(fail);
        return;
      }
      if (kind === 'reserve' && repo.reserveMaterials) {
        void repo.reserveMaterials(projectId).then(applyServer).catch(fail);
        return;
      }
      if (kind === 'release' && repo.releaseMaterials) {
        void repo.releaseMaterials(projectId, payload.overrideReason).then(applyServer).catch(fail);
        return;
      }
      applyLocal();
    },
    [getRepository, projectActions, toast],
  );

  const planningHandlers = useMemo<MaterialPlanningHandlers>(
    () => ({
      onDerive: (projectId) => {
        const lines = requirementLinesFor(projectId);
        if (lines.length === 0) {
          toast({ type: 'error', message: 'El BOM liberado no produjo líneas de requerimiento' });
          return;
        }
        runMaterialPlanningAction(
          projectId,
          'derive',
          { lines },
          (p) => materializeRequirements(p, { lines, derivedBy: authUser?.id }).project,
          '✓ Requerimientos derivados del BOM liberado',
        );
      },
      onReserve: (projectId) => {
        const plannings = projectActions.projects
          .map((p) => p.materialPlanning)
          .filter((x): x is NonNullable<typeof x> => Boolean(x));
        runMaterialPlanningAction(
          projectId,
          'reserve',
          {},
          (p) => reserveProjectMaterials(p, { stock: stockRows ?? [], plannings }).project,
          '✓ Material reservado (el faltante queda auditado)',
        );
      },
      onRelease: (projectId, overrideReason) => {
        const plannings = projectActions.projects
          .map((p) => p.materialPlanning)
          .filter((x): x is NonNullable<typeof x> => Boolean(x));
        runMaterialPlanningAction(
          projectId,
          'release',
          { overrideReason },
          (p) =>
            releaseProjectMaterials(p, {
              stock: stockRows ?? [],
              plannings,
              byUserId: authUser?.id,
              overrideReason,
            }).project,
          overrideReason
            ? '✓ Material liberado con override (auditado)'
            : '✓ Material completo — liberado a producción',
        );
      },
      onCreateShortagePO: (projectId) => {
        const view = planningByProject[projectId];
        if (!view || view.shortageLines.length === 0) return;
        const items = shortagePoLines(view).map((l) => ({ ...l, allocatedProjectId: projectId }));
        void getPurchasingStoreState()
          .savePurchaseOrder({
            supplierId: '',
            items,
            requiredBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          })
          .then(() => {
            toast({
              type: 'success',
              message: `✓ Borrador de OC creado con ${items.length} línea(s) del faltante — completá el proveedor en Compras`,
            });
          })
          .catch((err) => {
            toast({
              type: 'error',
              message: err instanceof Error && err.message ? err.message : 'No se pudo crear la OC',
            });
          });
      },
    }),
    [runMaterialPlanningAction, requirementLinesFor, stockRows, projectActions.projects, authUser?.id, planningByProject],
  );

  /**
   * #302 (OC-060..OC-062) — quality actions: report issues, rework with
   * costing (physical piece effect included), per-unit QC checklist and the
   * audited supervisor override.
   */
  const runQualityAction = useCallback(
    (
      projectId: string,
      opts: {
        api?: (repo: ReturnType<typeof getRepository>) => Promise<unknown> | null;
        local: (project: Project) => { project: Project };
        successMessage: string;
      },
    ) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project) return;
      let local: { project: Project };
      try {
        local = opts.local(project);
      } catch (err) {
        toast({
          type: 'error',
          message: err instanceof Error && err.message ? err.message : 'Acción de calidad inválida',
        });
        return;
      }
      const repo = getRepository();
      const apiPromise = opts.api ? opts.api(repo) : null;
      if (apiPromise) {
        void apiPromise
          .then(() => {
            projectActions.applyQualityProject(projectId, local.project);
            toast({ type: 'success', message: opts.successMessage });
          })
          .catch((err) => {
            toast({
              type: 'error',
              message: err instanceof Error && err.message ? err.message : 'No se pudo completar la acción de calidad',
            });
          });
        return;
      }
      projectActions.applyQualityProject(projectId, local.project);
      toast({ type: 'success', message: opts.successMessage });
    },
    [getRepository, projectActions, toast],
  );

  const qualityHandlers = useMemo<QualityHandlers>(
    () => ({
      onReportIssue: (projectId, payload) =>
        runQualityAction(projectId, {
          api: (repo) => (repo.reportQualityIssue ? repo.reportQualityIssue(projectId, payload) : null),
          local: (p) => reportQualityIssue(p, payload),
          successMessage: '✓ Problema de calidad reportado',
        }),
      onRework: (projectId, payload) =>
        runQualityAction(projectId, {
          api: (repo) => (repo.recordQualityRework ? repo.recordQualityRework(projectId, payload) : null),
          local: (p) => recordReworkAction(p, payload.issueId, payload),
          successMessage: '✓ Retrabajo registrado con costo',
        }),
      onTransition: (projectId, issueId, toStatus, notes) =>
        runQualityAction(projectId, {
          api: (repo) =>
            repo.transitionQualityIssue ? repo.transitionQualityIssue(projectId, issueId, toStatus, notes) : null,
          local: (p) => transitionQualityIssue(p, issueId, toStatus, { notes }),
          successMessage: '✓ Estado de calidad actualizado',
        }),
      onRecordQc: (projectId, unitId, checklist) =>
        runQualityAction(projectId, {
          api: (repo) => (repo.recordQualityUnitQc ? repo.recordQualityUnitQc(projectId, unitId, checklist) : null),
          local: (p) => recordUnitQc(p, unitId, { checklist }),
          successMessage: '✓ QC de unidad registrado',
        }),
      onOverrideQc: (projectId, unitId, reason) =>
        runQualityAction(projectId, {
          api: (repo) => (repo.overrideQualityUnitQc ? repo.overrideQualityUnitQc(projectId, unitId, reason) : null),
          local: (p) => overrideUnitQc(p, unitId, { reason }),
          successMessage: '✓ Override de QC registrado (auditado)',
        }),
    }),
    [runQualityAction],
  );

  /** Quality view per project with units at/past the QC gate. */
  const qualityByProject = useMemo<Readonly<Record<string, QualityPanelView>>>(() => {
    const entries = projectActions.projects
      .filter(
        (p) =>
          (p.moduleUnits ?? []).some((u) => u.status === 'module_qc' || u.status === 'packaged') ||
          (p.quality?.issues.length ?? 0) > 0,
      )
      .map((project) => [project.id, qualityPanelView(project)] as const);
    return Object.fromEntries(entries);
  }, [projectActions.projects]);

  // ── Job costing (OC-080..OC-084, #304) ────────────────────────────────────
  // Views resolve locally from the project aggregate; when the server costing
  // view is loaded (repo API), its summary/material take over — the server is
  // the only one that can value the job-assigned stock consumption (OC-082).

  const [costingServerViews, setCostingServerViews] = useState<
    Readonly<Record<string, JobCostingView>>
  >({});

  const costingViewByProject = useMemo<Readonly<Record<string, CostingPanelView>>>(() => {
    if (!showCosts) return {};
    const entries: [string, CostingPanelView][] = [];
    for (const project of projectActions.projects) {
      const costing = project.costing;
      const hasSource = Boolean(project.priceSnapshot || project.productionRelease);
      if (!costing && !hasSource) continue;
      const serverView = costingServerViews[project.id];
      if (serverView) {
        entries.push([
          project.id,
          costingPanelView(project, {
            summary: serverView.summary,
            materialLines: serverView.material.lines.map((line) => ({
              ...line,
              basisLabel: MATERIAL_BASIS_LABELS_ES[line.basis] ?? line.basis,
            })),
            missingValuationMaterialIds: serverView.material.missingValuationMaterialIds,
          }),
        ]);
        continue;
      }
      const rework = reworkCostSummary(project.quality);
      entries.push([
        project.id,
        costingPanelView(project, {
          summary: computeJobCostSummary({
            baseline: costing?.baseline,
            timeEntries: costing?.timeEntries ?? [],
            laborRatePerHour: costing?.laborRatePerHour ?? 0,
            rework,
            otherCosts: costing?.otherCosts ?? [],
          }),
        }),
      ]);
    }
    return Object.fromEntries(entries);
  }, [showCosts, projectActions.projects, costingServerViews]);

  const costingLabelsByMaterial = useMemo<Readonly<Record<string, string>>>(() => {
    const labels: Record<string, string> = {};
    for (const board of catalog?.materials ?? []) labels[board.id] = `${board.code} — ${board.name}`;
    for (const edge of catalog?.edges ?? []) labels[edge.id] = `${edge.code} — ${edge.name}`;
    for (const hardware of catalog?.hardware ?? []) labels[hardware.id] = `${hardware.code} — ${hardware.name}`;
    return labels;
  }, [catalog]);

  const runCostingAction = useCallback(
    (
      projectId: string,
      opts: {
        api?: (repo: ReturnType<typeof getRepository>) => Promise<JobCostingView> | null;
        local: (project: Project) => { project: Project };
        successMessage: string;
      },
    ) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project) return;
      let local: { project: Project };
      try {
        local = opts.local(project);
      } catch (err) {
        toast({
          type: 'error',
          message: err instanceof Error && err.message ? err.message : 'Acción de costos inválida',
        });
        return;
      }
      const repo = getRepository();
      const apiPromise = opts.api ? opts.api(repo) : null;
      if (apiPromise) {
        void apiPromise
          .then((view) => {
            projectActions.applyCostingProject(projectId, local.project);
            setCostingServerViews((prev) => ({ ...prev, [projectId]: view }));
            toast({ type: 'success', message: opts.successMessage });
          })
          .catch((err) => {
            toast({
              type: 'error',
              message: err instanceof Error && err.message ? err.message : 'No se pudo completar la acción de costos',
            });
          });
        return;
      }
      projectActions.applyCostingProject(projectId, local.project);
      toast({ type: 'success', message: opts.successMessage });
    },
    [getRepository, projectActions, toast],
  );

  const costingHandlers = useMemo<CostingHandlers>(
    () => ({
      onCaptureBaseline: (projectId) =>
        runCostingAction(projectId, {
          api: (repo) => (repo.captureCostBaseline ? repo.captureCostBaseline(projectId) : null),
          local: (p) => captureCostBaseline(p, { byUserId: authUser?.id }),
          successMessage: '✓ Baseline de costos capturado',
        }),
      onSetLaborRate: (projectId, ratePerHour) =>
        runCostingAction(projectId, {
          api: (repo) => (repo.setCostingLaborRate ? repo.setCostingLaborRate(projectId, ratePerHour) : null),
          local: (p) => setLaborRate(p, { ratePerHour }),
          successMessage: '✓ Tarifa horaria actualizada',
        }),
      onRecordTime: (projectId, payload) =>
        runCostingAction(projectId, {
          api: (repo) =>
            repo.recordCostingTime
              ? repo.recordCostingTime(projectId, {
                  category: payload.category as never,
                  minutes: payload.minutes,
                  note: payload.note,
                })
              : null,
          local: (p) =>
            recordTimeEntry(p, {
              category: payload.category as never,
              minutes: payload.minutes,
              note: payload.note,
              byUserId: authUser?.id,
              byName: authUser?.name,
            }),
          successMessage: '✓ Tiempo registrado',
        }),
      onVoidTime: (projectId, entryId) =>
        runCostingAction(projectId, {
          api: (repo) => (repo.voidCostingTime ? repo.voidCostingTime(projectId, entryId) : null),
          local: (p) => voidTimeEntry(p, entryId, { byUserId: authUser?.id }),
          successMessage: '✓ Registro anulado',
        }),
      onRecordOtherCost: (projectId, payload) =>
        runCostingAction(projectId, {
          api: (repo) =>
            repo.recordCostingOtherCost
              ? repo.recordCostingOtherCost(projectId, {
                  kind: payload.kind as never,
                  amount: payload.amount,
                  vendor: payload.vendor,
                  note: payload.note,
                })
              : null,
          local: (p) =>
            recordOtherCost(p, {
              kind: payload.kind as never,
              amount: payload.amount,
              vendor: payload.vendor,
              note: payload.note,
              byUserId: authUser?.id,
              byName: authUser?.name,
            }),
          successMessage: '✓ Costo registrado',
        }),
      onVoidOtherCost: (projectId, costId) =>
        runCostingAction(projectId, {
          api: (repo) => (repo.voidCostingOtherCost ? repo.voidCostingOtherCost(projectId, costId) : null),
          local: (p) => voidOtherCost(p, costId, { byUserId: authUser?.id }),
          successMessage: '✓ Costo anulado',
        }),
    }),
    [runCostingAction, authUser?.id, authUser?.name],
  );

  // #305 — structured site survey (OC-040/OC-041). Same dual-write pattern as
  // costing: the server endpoints are authoritative; offline/local mode runs
  // the mirrored domain functions.
  const runSurveyAction = useCallback(
    (
      projectId: string,
      opts: {
        api?: (repo: ReturnType<typeof getRepository>) => Promise<SiteSurveyView> | null;
        local: (project: Project) => { project: Project };
        successMessage: string;
      },
    ) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project) return;
      let local: { project: Project };
      try {
        local = opts.local(project);
      } catch (err) {
        toast({
          type: 'error',
          message: err instanceof Error && err.message ? err.message : 'Acción de levantamiento inválida',
        });
        return;
      }
      const repo = getRepository();
      const apiPromise = opts.api ? opts.api(repo) : null;
      if (apiPromise) {
        void apiPromise
          .then(() => {
            projectActions.applyCostingProject(projectId, local.project);
            toast({ type: 'success', message: opts.successMessage });
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message ? err.message : 'No se pudo completar la acción de levantamiento',
            });
          });
        return;
      }
      projectActions.applyCostingProject(projectId, local.project);
      toast({ type: 'success', message: opts.successMessage });
    },
    [projectActions],
  );

  const surveyHandlers = useMemo<SurveyHandlers>(
    () => ({
      onStart: (projectId) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.startSiteSurvey ? repo.startSiteSurvey(projectId) : null),
          local: (p) => createSiteSurvey(p, { byUserId: authUser?.id }),
          successMessage: '✓ Levantamiento iniciado',
        }),
      onUpsertSpace: (projectId, input) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.upsertSurveySpace ? repo.upsertSurveySpace(projectId, input) : null),
          local: (p) => upsertSurveySpace(p, input),
          successMessage: '✓ Espacio guardado',
        }),
      onRemoveSpace: (projectId, spaceId) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.removeSurveySpace ? repo.removeSurveySpace(projectId, spaceId) : null),
          local: (p) => removeSurveySpace(p, spaceId),
          successMessage: '✓ Espacio eliminado',
        }),
      onCaptureMeasures: (projectId, spaceId, measures) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.captureSurveyMeasures ? repo.captureSurveyMeasures(projectId, spaceId, measures) : null),
          local: (p) => captureSpaceMeasures(p, { spaceId, measures, byUserId: authUser?.id }),
          successMessage: '✓ Medidas levantadas en obra',
        }),
      onVerify: (projectId) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.verifySiteSurvey ? repo.verifySiteSurvey(projectId) : null),
          local: (p) => verifySiteSurvey(p, { byUserId: authUser?.id }),
          successMessage: '✓ Levantamiento verificado',
        }),
      onApproveSpace: (projectId, spaceId) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.approveSurveyMeasures ? repo.approveSurveyMeasures(projectId, spaceId) : null),
          local: (p) => approveSpaceMeasures(p, { spaceId, byUserId: authUser?.id }),
          successMessage: '✓ Medidas aprobadas',
        }),
      onFreeze: (projectId) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.freezeSurveyMeasures ? repo.freezeSurveyMeasures(projectId) : null),
          local: (p) => freezeMeasuresForFabrication(p, { byUserId: authUser?.id }),
          successMessage: '✓ Medidas congeladas para fabricación',
        }),
    }),
    [runSurveyAction, authUser?.id],
  );

  const canCaptureSurvey =
    session === 'auth' && roleCanAppendProjectEvent(authUser?.role, 'survey_captured');
  const canVerifySurvey =
    session === 'auth' && roleCanAppendProjectEvent(authUser?.role, 'survey_verified');
  const canApproveSurvey =
    session === 'auth' && roleCanAppendProjectEvent(authUser?.role, 'survey_measures_approved');

  // OC-091 — transversal workspace navigation from the overview panel.
  const overviewNav = useMemo<ProjectOverviewNav>(
    () => ({
      onOpenInProduction: (projectId) => navigate(productionOrderPath(projectId, 'resumen')),
      onOpenEngineering: (projectId) => navigate(engineeringProjectPath(projectId)),
      onOpenShipments: (projectId) => navigate(shipmentDetailPath(projectId)),
      onOpenInstallation: (projectId) => navigate(installationDetailPath(projectId)),
    }),
    [navigate],
  );

  // Refresh the server costing views (real material valuation) for obras that
  // already have a costing payload — the baseline capture responses keep them
  // fresh afterwards.
  useEffect(() => {
    if (!showCosts) return;
    const repo = getRepository();
    if (!repo.getJobCosting) return;
    for (const project of projectActions.projects) {
      if (!project.costing || costingServerViews[project.id]) continue;
      void repo
        .getJobCosting(project.id)
        .then((view) => setCostingServerViews((prev) => ({ ...prev, [project.id]: view })))
        .catch(() => undefined);
    }
  }, [showCosts, getRepository, projectActions.projects, costingServerViews]);

  const costingView = showCosts;
  const canManageCosting =
    costingView && session === 'auth' && roleCanAppendProjectEvent(actorRole, 'cost_time_recorded');
  const canCaptureCosting =
    costingView && session === 'auth' && roleCanAppendProjectEvent(actorRole, 'cost_baseline_captured');
  const canRecordOtherCosting =
    costingView && session === 'auth' && roleCanAppendProjectEvent(actorRole, 'cost_other_recorded');
  const canVoidCosting =
    costingView && session === 'auth' && roleCanAppendProjectEvent(actorRole, 'cost_entry_voided');

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
    handleExportCutPlanDxf,
    handleExportCutPlanPtx,
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

  const shellViewCtx = {
    acquirePlanEditSession,
    actorRole,
    addProjectItem,
    agregados,
    allowedNavIds,
    ambientCategories,
    ambientMaterials,
    analyticsPeriod,
    applyScenarioB,
    assignableOwners,
    authToken,
    authUser,
    backendBreakdown,
    boardOverrides,
    breakdownError,
    breakdownLoading,
    canAssignOwner,
    canDeleteProjects,
    canExportProduction,
    canForceReopenClosed,
    canMarkProduced,
    canMutateCatalog,
    canMutateModules,
    canMutateProjects,
    canOpenFabric,
    canReopenProjects,
    catalog,
    categories,
    changeProjectStatus,
    commandItems,
    components,
    createAgregado,
    createAmbientCategory,
    createAmbientMaterial,
    createCategory,
    createComponent,
    createCustomer,
    createEdge,
    createFromTemplate,
    createHardware,
    createMaterial,
    createModule,
    createOptionGroup,
    createProject,
    createStructure,
    customers,
    dashboardHomeMode,
    dashboardOwnerBreakdown,
    dashboardRecent,
    dashboardStats,
    deleteAgregado,
    deleteAmbientCategory,
    deleteCategory,
    deleteModule,
    deleteOptionGroup,
    deleteProject,
    deleteStructure,
    deleteTemplate,
    dismissGuestImport,
    duplicateModuleById,
    duplicateProjectById,
    duplicateWithScenarioB,
    edges,
    exportBusy,
    exportCommercialScenarioPdf,
    exportErrors,
    fabricActiveClaims,
    fabricBatchConfirmMessage,
    fabricMetrics,
    fabricMetricsByProject,
    filterProjectsToPlant,
    getMaterialCostPerM2,
    getRepository,
    goHomeFromScreen,
    groupLabels,
    guestImportError,
    guestImportLoading,
    handleCancelPurchaseOrder,
    handleDeactivateSupplier,
    handleEmitPurchaseOrder,
    handleExportAssemblySheets,
    handleExportCncPilot,
    handleExportCommercialQuote,
    handleExportCommercialQuotePdf,
    handleExportCutListCsv,
    handleExportCutPlanPdf,
    handleExportCutPlanDxf,
    handleExportCutPlanPtx,
    handleExportDespiecePdf,
    handleExportElevations,
    handleExportHardwareList,
    handleExportModuleLabels,
    handleExportOptimizer,
    handleExportPieceLabels,
    handleExportProductionPack,
    handleFabricBatchAdvance,
    handleFabricClaim,
    handleFabricFinish,
    handleFloorAdvance,
    handleAdvancePart,
    handleAdvanceUnit,
    handleGeneratePartExecutions,
    installationJobHandlers,
    planningByProject,
    planningHandlers,
    qualityByProject,
    qualityHandlers,
    costingViewByProject,
    costingHandlers,
    costingLabelsByMaterial,
    canManageCosting,
    canCaptureCosting,
    canRecordOtherCosting,
    canVoidCosting,
    surveyHandlers,
    canCaptureSurvey,
    canVerifySurvey,
    canApproveSurvey,
    overviewNav,
    opsExceptions,
    canOverrideQc: session === 'auth' && roleCanSuperviseFloor(authUser?.role),
    handleLoadCocinaLopezDemo,
    handleOverridesChange,
    handleReceivePurchaseOrder,
    handleRecordStockMovement,
    handleReleaseToDelivery,
    handleSavePurchaseOrder,
    handleSaveSupplier,
    handleTogglePick,
    handleUpsertStockMin,
    hardware,
    importGuestWorkspace,
    importNestingResult,
    isLoadingShowcase,
    isSectorScoped,
    location,
    markProjectProduced,
    materialSummary,
    materials,
    materialsCreateKey,
    moduleEstimates,
    moduleLabelForFabric,
    modulePreview,
    modules,
    modulesCreateKey,
    modulesWithoutPhotoCount,
    mySectors,
    navId,
    navigate,
    onAddOnsSelectionChange,
    onCommandItem,
    onComponentSelectionChange,
    onDashboardNewMaterial,
    onDashboardNewModule,
    onDashboardNewProject,
    onDashboardOpenMaterials,
    onDashboardOpenModules,
    onDashboardOpenProject,
    onDashboardOpenShowcase,
    onEntityEditRequest,
    onEntitySelectionChange,
    onFinishesSelectionChange,
    onLogout,
    onModuleSelectionChange,
    onNavigate,
    onProjectSelectionChange,
    onShowcaseUseInQuote,
    onShowcaseUseProjectAsReference,
    onStructureSelectionChange,
    optionGroups,
    ownerLabels,
    pendingGuestImport,
    pickingStates,
    planActor,
    presentId,
    projectActions,
    projectEstimates,
    projectQuote,
    projectTemplates,
    projects,
    projectsCreateKey,
    projectsForRole,
    purchaseOrders,
    purchasingProjects,
    releasePlanEditSession,
    removeProjectItem,
    renewPlanEditSession,
    reopenProject,
    resolveMediaUrl,
    restoreProjectVersion,
    routeComponentEditId,
    routeComponentId,
    routeEngineeringProjectId,
    routeEntityId,
    routeModuleEditId,
    routeModuleId,
    routeProductionOrderId,
    routeProductionOrderTab,
    routeProjectId,
    routeShipmentProjectId,
    routeInstallationProjectId,
    routeStructureEditId,
    routeStructureId,
    saveAsTemplate,
    saveWorkshopSettings,
    selectedProjectCutRows,
    selectedProjectId,
    session,
    setAmbientMaterialActive,
    setAnalyticsPeriod,
    setCustomerActive,
    setEdgeActive,
    setEditingModuleId,
    setHardwareActive,
    setItemFloorStatus,
    setMaterialActive,
    setShowOnboardingTour,
    setStructureActive,
    showAdminUsers,
    showCosts,
    showOnboardingTour,
    showcasePhotos,
    startEngineering,
    stockCatalog,
    stockMovements,
    stockRows,
    structures,
    suppliers,
    toggleComponentActive,
    updateAgregado,
    updateAmbientCategory,
    updateAmbientMaterial,
    updateCategory,
    updateComponent,
    updateCustomer,
    updateEdge,
    updateHardware,
    updateInstallationChecklist,
    updateKitchenLayout,
    updateMaterial,
    updateMeasureDefaults,
    updateModule,
    updateOptionGroup,
    updateProject,
    updateProjectItem,
    updateProjectLevelChoices,
    updateStructure,
    uploadCatalogImage,
    useProductionWorkspace,
    warehouseProjects,
    warrantyTickets,
    workshopAnalytics,
    workshopSettings,
  };

  return <ShellView ctx={shellViewCtx} />;
}
