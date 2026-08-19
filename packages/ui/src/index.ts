/**
 * Shared React UI components (no business logic).
 */

export { Placeholder } from './placeholder';
export const PACKAGE_NAME = '@muebles/ui' as const;

export {
  ActiveBadge,
  AmbientMaterialsCatalog,
  CatalogPicker,
  CatalogTable,
  EdgesCatalog,
  filterActiveForPicker,
  filterCatalogItems,
  findActiveCodeConflict,
  HardwareCatalog,
  MaterialsCatalog,
  matchesCodeOrName,
  normalizeCode,
  validateNonNegativeNumber,
  validateRequiredName,
  validateUniqueCode,
  type ActiveFilterable,
  type CatalogColumn,
  type CatalogPickerOption,
  type CatalogPickerProps,
  type CatalogStatusFilter,
  type CatalogTableProps,
  type CodedCatalogItem,
  type AmbientCategoryDraft,
  type AmbientMaterialDraft,
  type AmbientMaterialsCatalogProps,
  type EdgeDraft,
  type EdgesCatalogProps,
  type FilterCatalogOptions,
  type HardwareDraft,
  type HardwareCatalogProps,
  type MaterialDraft,
  type MaterialsCatalogProps,
  type SearchableCoded,
} from './catalogs';

export {
  canShowPricePreview,
  filterOptionIdsByMembers,
  findOptionGroupCodeConflict,
  membersForKind,
  optionGroupKindLabel,
  OptionGroupsScreen,
  PricePreviewGate,
  requiredGroupCodesForModule,
  selectableGroupCodesForModule,
  SEED_OPTION_GROUP_CODES,
  validateOptionGroupCode,
  type CatalogMember,
  type ModuleLikeForRoles,
  type OptionGroupDraft,
  type OptionGroupsScreenProps,
  type PricePreviewGateProps,
  type PricePreviewGateResult,
} from './optionGroups';

export {
  ModulesScreen,
  ModuleShowcase,
  boardPartToDraft,
  defaultOptionChoicesForModule,
  edgesFromFlags,
  emptyBoardPartDraft,
  emptyCategoryDraft,
  emptyHardwareLineDraft,
  emptyModuleDraft,
  filterModulesByQuery,
  flattenCategoriesForSelect,
  flagsFromEdges,
  findModuleCodeConflict,
  formatModuleMoney,
  hardwareLineToDraft,
  moduleToDraft,
  draftToModule,
  mergeBoardOverridesIntoDraft,
  moduleCompositionKey,
  patchInstanceOverrides,
  cleanInstanceOverrides,
  instanceOverridesSummary,
  instanceOverridesKey,
  optionGroupsByKind,
  optionGroupsForBoardParts,
  optionGroupsForHardware,
  parseOptionalNumber,
  SEED_MODULE_CODES,
  suggestPartCode,
  validateModuleCode,
  type BoardPartDraft,
  type CategoryDraft,
  type HardwareLineDraft,
  type ModuleDraft,
  type ModulesScreenProps,
  type ModuleShowcaseProps,
} from './modules';

export {
  ProjectsScreen,
  ExportIssueList,
  PROJECT_STATUSES,
  canShowProjectPricePreview,
  countItemsWithModule,
  customersForProjectPicker,
  defaultChoicesForNewItem,
  emptyAddItemDraft,
  emptyProjectDraft,
  filterProjectsByQuery,
  findModuleById,
  formatIsoDate,
  formatProjectMoney,
  groupsForModuleItem,
  optionsForGroup,
  projectStatusBadgeClass,
  projectStatusLabel,
  projectToDraft,
  resolveCustomerName,
  validateItemQuantity,
  validateProjectDraft,
  InternalCommsPanel,
  ProjectPhotosGallery,
  WarrantyTicketsPanel,
  type InternalCommsPanelProps,
  type ProjectPhotosGalleryProps,
  type WarrantyTicketsPanelProps,
  type AddItemDraft,
  type ExportIssueListProps,
  type ProjectDraft,
  type ProjectsScreenProps,
} from './projects';


export {
  ShowcaseScreen,
  type ShowcaseScreenProps,
} from './showcase/ShowcaseScreen';
export {
  ProjectsPortfolioView,
  type ProjectsPortfolioViewProps,
} from './showcase/ProjectsPortfolioView';


export {
  WhatsAppButton,
  WhatsAppModal,

  type WhatsAppButtonProps,
  type WhatsAppModalProps,
} from './crm';


export {
  AppShell,
  APP_NAV_SECTIONS,
  CommandPalette,
  labelForNavId,
  resolveNavSections,
  useCommandPaletteHotkey,
  type AppNavId,
  type AppShellProps,
  type AppShellSessionUser,
  type CommandPaletteItem,
  type CommandPaletteProps,
} from './shell';

export {
  SettingsScreen,
  type SettingsScreenProps,
} from './settings';

export {
  BrandMark,
  CatalogImage,
  EmptyState,
  ErrorBoundary,
  FullscreenDialog,
  ScreenBoundary,
  formatMoneyDisplay,
  InlineLoading,
  ListSkeleton,
  Modal,
  PageLoading,
  SearchInput,
  Spinner,
  StatusChips,
  submitBusyLabel,
  useDebouncedValue,
  SEARCH_DEBOUNCE_MS,
  type BrandMarkProps,
  type EmptyStateProps,
  type ErrorBoundaryProps,
  type ScreenBoundaryProps,
  type FormatMoneyDisplayOptions,
  type InlineLoadingProps,
  type ListSkeletonProps,
  type PageLoadingProps,
  type SpinnerProps,
  type SpinnerSize,
  type FullscreenDialogProps,
  type ModalProps,
  type ModalSize,
  type SearchInputProps,
  type StatusChipsProps,
  Furniture3DViewer,
  type Furniture3DViewerProps,
} from './common';

export {
  CustomersScreen,
  type CustomerDraft,
  type CustomersScreenProps,
} from './customers';

export {
  Dashboard,
  countActiveMaterials,
  aggregatePortfolioByOwner,
  countActiveProjects,
  countModules,
  formatDashboardMoney,
  selectRecentProjects,
  sumMonthlyQuotedTotal,
  type DashboardProps,
  type DashboardRecentProject,
  type DashboardStats,
} from './dashboard';

export {
  ProductionQueue,
  ProductionWorkspace,
  ProductionOrderHub,
  ProjectFloorProgressStrip,
  ProjectFloorStageChip,
  PlantBoardScreen,
  FabricScreen,
  summarizeFabricMetrics,
  EmbarquesScreen,
  embarquesProjects,
  EmbarquesProjectDetail,
  type EmbarquesProjectDetailProps,
  InstalacionesScreen,
  instalacionesProjects,
  type DashboardMetrics,
  type SectorDashboard,
  type FabricActiveClaim,
  type FabricProjectMetrics,
  type FabricStation,
  ProductionManagerDashboard,
  filterProductionQueue,
  filterProductionVisible,
  isProductionQueueStatus,
  type ProductionQueueProps,
  type ProductionWorkspaceProps,
  type ProductionOrderHubProps,
  ProductionBoardView,
  type ProductionBoardViewProps,
  ProductionOrderDispatchPanel,
  type ProductionOrderDispatchPanelProps,
  PRODUCTION_ORDER_TABS,
  parseProductionOrderTab,
  projectAllowsProductionOrder,
  buildProductionOrderReadiness,
  type ProductionOrderTab,
  type ProductionOrderReadiness,
} from './production';

export {
  EngineeringScreen,
  EngineeringWorkspace,
} from './engineering';

export {
  PurchasingScreen,
  PurchaseOrdersPanel,
  type ActiveProjectMaterial,
  type PurchasingScreenProps,
  type PoLineInput,
} from './purchasing';

export {
  SalesDashboard,
} from './sales';

export {
  LoginScreen,
  RegisterScreen,
  type LoginScreenProps,
  type RegisterScreenProps,
} from './auth';

export {
  UsersScreen,
  type UserFilter,
  type UserRow,
  type UsersScreenProps,
} from './users';

export {
  StructuresScreen,
  type StructureDraft,
  type StructuresScreenProps,
} from './structures';

export {
  ComponentsScreen,
  type ComponentDraft,
  type ComponentsScreenProps,
} from './components';

export {
  AgregadosScreen,
  type AgregadosScreenProps,
  type AgregadoDraft,
} from './agregados';

export {
  ModuleScene3D,
  FurnitureScene3D,
  PartInspector,
  PartList,
  canUseWebGL,
  boardPartToVisual,
  boardPartsToVisuals,
  colorForOptionRole,
  colorForMaterialId,
  materialColorMap,
  materialTextureMap,
  resolveMaterialSurface,
  resolvePartColor,
  sceneFraming,
  layoutProjectRun,
  resolveProject3DPreview,
  DEFAULT_MATERIAL_SURFACE_MODE,
  DEFAULT_TEXTURE_TILE_MM,
  type ModuleScene3DProps,
  type FurnitureScene3DProps,
  type FurnitureSceneModule,
  type PartInspectorProps,
  type PartListProps,
  type BoardPartVisual,
  type BoardColorMode,
  type MaterialColorLookup,
  type MaterialSurfaceMode,
  type MaterialTextureEntry,
  type MaterialTextureLookup,
  type Project3DPreviewResult,
} from './preview3d';

// --- Board-first editor (Fase 1) ---
export {
  BoardCanvas,
  type BoardCanvasProps,
  BoardPropertiesPanel,
  type BoardPropertiesPanelProps,
  BoardCostSummary,
  type BoardCostSummaryProps,
  type PartPose,
  type PartDimensions,
  isoProject,
  isoBox,
  boxCorners,
  projectedBounds,
  viewBoxFromBounds,
  type Point2D,
  type Point3D,
  type IsoFace,
} from './editor';

// --- Onboarding Tour (F076) ---
export {
  OnboardingTourModal,
  getHasSeenOnboardingTour,
  setHasSeenOnboardingTour,
  type OnboardingTourModalProps,
} from './onboarding/OnboardingTourModal';

