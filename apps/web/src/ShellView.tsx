/**
 * ShellView — the AppShell render of the web shell (F121 extract from
 * App.tsx): sidebar chrome + the navId screen branches, guest-import
 * handoff modal and onboarding tour. Receives every live value through one
 * context object; `C` is inferred at the call site so the ctx stays fully
 * typed without a hand-written interface.
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
import { ToastViewport } from './components/ToastViewport';
import { BoardEditor } from './components/BoardEditor';




import type {
  Agregado,
  AmbientMaterial,
  CategoryNode,
  CutPlan,
  InstallationChecklistItem,
  ModuleBaseMode,
  ProjectKitchenLayout,
  ShowcasePhotoItem,
  WorkshopAnalytics,
} from '@muebles/domain';
import type { AmbientMaterialDraft } from '@muebles/ui';
import type { OwnerPortfolioRow } from '@muebles/ui';
import type { WorkspaceRepository } from '@muebles/storage';
import type { AuthUser } from './session';
import type { AssignableOwner } from './stores/workspaceStore';
import type { StockCatalogView } from './derivations/stockCatalog';
import type { ProjectState } from './stores/projectStore';
import type { Dispatch, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';

export interface ShellViewCtx {
  readonly acquirePlanEditSession: (projectId: string) => boolean;
  readonly actorRole: string | null | undefined;
  readonly addProjectItem: (projectId: string, input: { readonly moduleId: string; readonly quantity: number; readonly optionChoices: OptionChoices; readonly measurePresetId?: string | undefined; readonly baseMode?: ModuleBaseMode | undefined; }) => void;
  readonly agregados: readonly Agregado[];
  readonly allowedNavIds: ReadonlySet<string>;
  readonly ambientCategories: readonly CategoryNode[];
  readonly ambientMaterials: readonly AmbientMaterial[];
  readonly analyticsPeriod: AnalyticsPeriodDays;
  readonly applyScenarioB: (projectId: string, role: string, choiceId: string) => void;
  readonly assignableOwners: readonly AssignableOwner[];
  readonly authToken: string | null;
  readonly authUser: AuthUser | null;
  readonly backendBreakdown: QuoteBreakdown | null;
  readonly boardOverrides: Readonly<Record<string, unknown>>;
  readonly breakdownError: string | null;
  readonly breakdownLoading: boolean;
  readonly canAssignOwner: boolean;
  readonly canDeleteProjects: boolean;
  readonly canExportProduction: boolean;
  readonly canForceReopenClosed: boolean;
  readonly canMarkProduced: boolean;
  readonly canMutateCatalog: boolean;
  readonly canMutateModules: boolean;
  readonly canMutateProjects: boolean;
  readonly canOpenFabric: boolean;
  readonly canReopenProjects: boolean;
  readonly catalog: Catalog;
  readonly categories: readonly CategoryNode[];
  readonly changeProjectStatus: (id: string, status: ProjectStatus) => void;
  readonly commandItems: CommandPaletteItem[];
  readonly components: readonly Component[];
  readonly createAgregado: (item: Agregado) => void;
  readonly createAmbientCategory: (draft: CategoryDraft) => void;
  readonly createAmbientMaterial: (draft: AmbientMaterialDraft) => void;
  readonly createCategory: (draft: CategoryDraft) => void;
  readonly createComponent: (draft: ComponentDraft) => void;
  readonly createCustomer: (draft: CustomerDraft) => void;
  readonly createEdge: (draft: EdgeDraft) => string;
  readonly createFromTemplate: (templateId: string, draft: ProjectDraft) => void;
  readonly createHardware: (draft: HardwareDraft) => void;
  readonly createMaterial: (draft: MaterialDraft) => void;
  readonly createModule: (draft: ModuleDraft) => void;
  readonly createOptionGroup: (draft: OptionGroupDraft) => void;
  readonly createProject: (draft: ProjectDraft) => void;
  readonly createStructure: (draft: StructureDraft) => void;
  readonly customers: readonly Customer[];
  readonly dashboardHomeMode: "default" | "sales" | "engineering";
  readonly dashboardOwnerBreakdown: readonly OwnerPortfolioRow[] | undefined;
  readonly dashboardRecent: { id: string; name: string; customerLabel: string; status: ProjectStatus; updatedAt: string; salePrice: number | null; }[];
  readonly dashboardStats: { activeProjects: number; monthlyQuotedTotal: number; modulesCount: number; activeMaterials: number; };
  readonly deleteAgregado: (id: string) => Promise<void>;
  readonly deleteAmbientCategory: (id: string) => Promise<void>;
  readonly deleteCategory: (id: string) => Promise<void>;
  readonly deleteModule: (id: string) => void;
  readonly deleteOptionGroup: (id: string) => Promise<void>;
  readonly deleteProject: (id: string) => void;
  readonly deleteStructure: (id: string) => Promise<void>;
  readonly deleteTemplate: (templateId: string) => void;
  readonly dismissGuestImport: () => void;
  readonly duplicateModuleById: (id: string) => void;
  readonly duplicateProjectById: (id: string) => void;
  readonly duplicateWithScenarioB: (projectId: string, role: string, choiceId: string) => void;
  readonly edges: readonly EdgeBand[];
  readonly exportBusy: boolean;
  readonly exportCommercialScenarioPdf: (projectId: string, role: string, choiceId: string) => Promise<void>;
  readonly exportErrors: readonly ExportIssue[];
  readonly fabricActiveClaims: readonly FabricActiveClaim[];
  readonly fabricBatchConfirmMessage: (itemCount: number, target: ItemFloorStatus) => string;
  readonly fabricMetrics: DashboardMetrics | null;
  readonly fabricMetricsByProject: Readonly<Record<string, FabricProjectMetrics>>;
  readonly filterProjectsToPlant: boolean;
  readonly getMaterialCostPerM2: (input: { widthMm: number; lengthMm: number; boardPrice: number; wastePercent: number; }) => number;
  readonly getRepository: () => WorkspaceRepository;
  readonly goHomeFromScreen: () => void;
  readonly groupLabels: Record<string, string>;
  readonly guestImportError: string | null;
  readonly guestImportLoading: boolean;
  readonly handleCancelPurchaseOrder: (id: string) => Promise<void>;
  readonly handleDeactivateSupplier: (id: string) => Promise<void>;
  readonly handleEmitPurchaseOrder: (id: string) => Promise<void>;
  readonly handleExportAssemblySheets: (projectId?: string | undefined) => Promise<void>;
  readonly handleExportCncPilot: (projectId?: string | undefined) => Promise<void>;
  readonly handleExportCommercialQuote: () => Promise<void>;
  readonly handleExportCommercialQuotePdf: (variant: "detailed" | "summary") => Promise<void>;
  readonly handleExportCutListCsv: (projectId?: string | undefined) => Promise<void>;
  readonly handleExportCutPlanPdf: (cutPlan: CutPlan) => Promise<void>;
  readonly handleExportCutPlanDxf: (cutPlan: CutPlan, variant: 'sheets' | 'pieces') => Promise<void>;
  readonly handleExportCutPlanPtx: (cutPlan: CutPlan) => Promise<void>;
  readonly handleExportDespiecePdf: (projectId?: string | undefined) => Promise<void>;
  readonly handleExportElevations: (projectId?: string | undefined) => Promise<void>;
  readonly handleExportHardwareList: (projectId?: string | undefined) => Promise<void>;
  readonly handleExportModuleLabels: (projectId?: string | undefined, labelOptions?: ModuleLabelsExportOptions | undefined) => Promise<void>;
  readonly handleExportOptimizer: (projectId?: string | undefined) => Promise<void>;
  readonly handleExportPieceLabels: (projectId?: string | undefined, labelOptions?: PieceLabelsExportOptions | undefined) => Promise<void>;
  readonly handleExportProductionPack: (projectId?: string | undefined) => Promise<void>;
  readonly handleFabricBatchAdvance: (projectId: string, itemIds: readonly string[], target: ItemFloorStatus) => void;
  readonly handleFabricClaim: (projectId: string, sector: FabricStation) => Promise<void>;
  readonly handleFabricFinish: (activityId: string, piecesCount: number) => Promise<void>;
  readonly handleFloorAdvance: (projectId: string, itemId: string, target: ItemFloorStatus) => void;
  readonly handleLoadCocinaLopezDemo: () => void;
  readonly handleOverridesChange: (overrides: Readonly<Record<string, unknown>>) => void;
  readonly handleReceivePurchaseOrder: (id: string, lines: readonly PoLineInput[]) => Promise<void>;
  readonly handleRecordStockMovement: (payload: { kind: "herrajes" | "tableros" | "cintillas"; materialId: string; type: "entrada" | "salida" | "ajuste" | "despacho"; quantity: number; note?: string | undefined; }) => Promise<void>;
  readonly handleReleaseToDelivery: (projectId: string) => Promise<void>;
  readonly handleSavePurchaseOrder: (data: { id?: string | undefined; supplierId: string; notes?: string | undefined; items: readonly PoLineInput[]; }) => Promise<void>;
  readonly handleSaveSupplier: (data: { id?: string | undefined; name: string; contactName?: string | undefined; email?: string | undefined; phone?: string | undefined; notes?: string | undefined; active?: boolean | undefined; }) => Promise<void>;
  readonly handleTogglePick: (input: { projectId: string; material: "herrajes" | "tableros" | "cintillas"; status: PickingStatus; }) => void;
  readonly handleUpsertStockMin: (payload: { kind: "herrajes" | "tableros" | "cintillas"; materialId: string; minStock: number; }) => Promise<void>;
  readonly hardware: readonly Hardware[];
  readonly importGuestWorkspace: () => Promise<void>;
  readonly importNestingResult: (projectId: string, nestingImport: { readonly importedAt: string; readonly sourceName?: string | undefined; readonly rows: readonly { readonly materialCode: string; readonly sheetsUsed: number; readonly areaM2?: number | undefined; }[]; }) => void;
  readonly isLoadingShowcase: boolean;
  readonly isSectorScoped: boolean;
  readonly location: ReturnType<typeof useLocation>;
  readonly markProjectProduced: (id: string) => void;
  readonly materialSummary: ProjectMaterialSummary | null;
  readonly materials: readonly MaterialBoard[];
  readonly materialsCreateKey: number;
  readonly moduleEstimates: Record<string, number | null>;
  readonly moduleLabelForFabric: (moduleId: string) => string;
  readonly modulePreview: { costPreview: QuoteBreakdown | null; previewBlocked: boolean; missingGroups: readonly string[]; previewError: string | null; };
  readonly modules: readonly Module[];
  readonly modulesCreateKey: number;
  readonly modulesWithoutPhotoCount: number;
  readonly mySectors: string[] | null;
  readonly navId: AppNavId;
  readonly navigate: NavigateFunction;
  readonly onAddOnsSelectionChange: (id: string | null) => void;
  readonly onCommandItem: (id: string) => void;
  readonly onComponentSelectionChange: (componentId: string | null) => void;
  readonly onDashboardNewMaterial: () => void;
  readonly onDashboardNewModule: () => void;
  readonly onDashboardNewProject: () => void;
  readonly onDashboardOpenMaterials: () => void;
  readonly onDashboardOpenModules: () => void;
  readonly onDashboardOpenProject: (projectId: string) => void;
  readonly onDashboardOpenShowcase: () => void;
  readonly onEntityEditRequest: (section: EntitySection, id: string | null) => void;
  readonly onEntitySelectionChange: (section: EntitySection, id: string | null) => void;
  readonly onFinishesSelectionChange: (id: string | null) => void;
  readonly onLogout: () => void;
  readonly onModuleSelectionChange: (moduleId: string | null) => void;
  readonly onNavigate: (id: AppNavId) => void;
  readonly onProjectSelectionChange: (projectId: string | null) => void;
  readonly onShowcaseUseInQuote: (moduleId: string) => void;
  readonly onShowcaseUseProjectAsReference: (projectId: string) => void;
  readonly onStructureSelectionChange: (structureId: string | null) => void;
  readonly optionGroups: readonly OptionGroup[];
  readonly ownerLabels: Record<string, string>;
  readonly pendingGuestImport: boolean;
  readonly pickingStates: ProjectPickingState[] | null;
  readonly planActor: { userId: string; userName: string; } | undefined;
  readonly presentId: string | null;
  readonly projectActions: ProjectState;
  readonly projectEstimates: Record<string, number | null>;
  readonly projectQuote: { breakdown: QuoteBreakdown | null; previewBlocked: boolean; missingGroups: readonly string[]; breakdownError: string | null; };
  readonly projectTemplates: readonly ProjectTemplate[];
  readonly projects: readonly Project[];
  readonly projectsCreateKey: number;
  readonly projectsForRole: readonly Project[];
  readonly purchaseOrders: PurchaseOrder[] | null;
  readonly purchasingProjects: ActiveProjectMaterial[];
  readonly releasePlanEditSession: (projectId: string) => void;
  readonly removeProjectItem: (projectId: string, itemId: string) => void;
  readonly renewPlanEditSession: (projectId: string) => boolean;
  readonly reopenProject: (id: string) => void;
  readonly resolveMediaUrl: (url: string | undefined) => string | undefined;
  readonly restoreProjectVersion: (id: string, version: number) => void;
  readonly routeComponentEditId: string | null;
  readonly routeComponentId: string | null;
  readonly routeEngineeringProjectId: string | null;
  readonly routeEntityId: string | null;
  readonly routeModuleEditId: string | null;
  readonly routeModuleId: string | null;
  readonly routeProductionOrderId: string | null;
  readonly routeProductionOrderTab: "herrajes" | "resumen" | "modulos" | "piso" | "despiece" | "etiquetas" | "vistas" | "optimizacion" | "documentos";
  readonly routeProjectId: string | null;
  readonly routeShipmentProjectId: string | null;
  readonly routeStructureEditId: string | null;
  readonly routeStructureId: string | null;
  readonly saveAsTemplate: (projectId: string, name: string) => void;
  readonly saveWorkshopSettings: (settings: WorkshopSettings) => Promise<void>;
  readonly selectedProjectCutRows: ProductionCutRow[];
  readonly selectedProjectId: string | null;
  readonly session: SessionMode;
  readonly setAmbientMaterialActive: (id: string, active: boolean) => void;
  readonly setAnalyticsPeriod: Dispatch<SetStateAction<AnalyticsPeriodDays>>;
  readonly setCustomerActive: (id: string, active: boolean) => void;
  readonly setEdgeActive: (id: string, active: boolean) => void;
  readonly setEditingModuleId: Dispatch<SetStateAction<string | null>>;
  readonly setHardwareActive: (id: string, active: boolean) => void;
  readonly setItemFloorStatus: (projectId: string, itemId: string, status: ItemFloorStatus) => void;
  readonly setMaterialActive: (id: string, active: boolean) => void;
  readonly setShowOnboardingTour: Dispatch<SetStateAction<boolean>>;
  readonly setStructureActive: (id: string, active: boolean) => void;
  readonly showAdminUsers: boolean;
  readonly showCosts: boolean;
  readonly showOnboardingTour: boolean;
  readonly showcasePhotos: readonly ShowcasePhotoItem[];
  readonly startEngineering: (projectId: string) => void;
  readonly stockCatalog: StockCatalogView;
  readonly stockMovements: StockMovement[] | null;
  readonly stockRows: MaterialStock[] | null;
  readonly structures: readonly Structure[];
  readonly suppliers: Supplier[] | null;
  readonly toggleComponentActive: (id: string) => void;
  readonly updateAgregado: (item: Agregado) => void;
  readonly updateAmbientCategory: (id: string, draft: CategoryDraft) => void;
  readonly updateAmbientMaterial: (id: string, draft: AmbientMaterialDraft) => void;
  readonly updateCategory: (id: string, draft: CategoryDraft) => void;
  readonly updateComponent: (id: string, draft: ComponentDraft) => void;
  readonly updateCustomer: (id: string, draft: CustomerDraft) => void;
  readonly updateEdge: (id: string, draft: EdgeDraft) => void;
  readonly updateHardware: (id: string, draft: HardwareDraft) => void;
  readonly updateInstallationChecklist: (projectId: string, installationChecklist: readonly InstallationChecklistItem[]) => void;
  readonly updateKitchenLayout: (projectId: string, kitchenLayout: ProjectKitchenLayout) => void;
  readonly updateMaterial: (id: string, draft: MaterialDraft) => void;
  readonly updateMeasureDefaults: (projectId: string, defaults: { readonly inferior?: { readonly depth?: number | undefined; readonly height?: number | undefined; } | undefined; readonly superior?: { readonly depth?: number | undefined; readonly height?: number | undefined; } | undefined; readonly alto?: { readonly depth?: number | undefined; readonly height?: number | undefined; } | undefined; } | undefined) => void;
  readonly updateModule: (id: string, draft: ModuleDraft) => void;
  readonly updateOptionGroup: (id: string, draft: OptionGroupDraft) => void;
  readonly updateProject: (id: string, draft: ProjectDraft) => void;
  readonly updateProjectItem: (projectId: string, item: ProjectItem) => void;
  readonly updateProjectLevelChoices: (projectId: string, choices: OptionChoices) => void;
  readonly updateStructure: (id: string, draft: StructureDraft) => void;
  readonly uploadCatalogImage: (file: File) => Promise<string>;
  readonly useProductionWorkspace: boolean;
  readonly warehouseProjects: readonly WarehouseProjectInput[];
  readonly warrantyTickets: readonly WarrantyTicket[] | null;
  readonly workshopAnalytics: WorkshopAnalytics | undefined;
  readonly workshopSettings: WorkshopSettings;
}

export function ShellView({ ctx }: { readonly ctx: ShellViewCtx }): ReactNode {
  const {
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
  } = ctx;
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
            onExportCutPlanDxf={(plan, variant) => { void handleExportCutPlanDxf(plan, variant); }}
            onExportCutPlanPtx={(plan) => { void handleExportCutPlanPtx(plan); }}
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
