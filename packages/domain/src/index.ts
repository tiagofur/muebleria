/**
 * Domain package entry — pure TypeScript (no UI, fs, or Excel).
 */

export const PACKAGE_NAME = '@muebles/domain' as const;

export type {
  HardwareUnit,
  OptionGroupKind,
  Grain,
  EdgeSide,
  ProjectStatus,
  OptionChoices,
  AmbientSurfaceType,
  AmbientMaterial,
  AmbientCategory,
  CategoryNode,
  MaterialBoard,
  EdgeBand,
  Hardware,
  User,
  UserRole,
  Customer,
  OptionGroup,
  ModuleCategory,
  EdgeAssignment,
  BoardPart,
  HardwareLine,
  AnchorFace,
  HardwarePlacement,
  ExternalDims,
  Module,
  Structure,
  StructureRevision,
  FurnitureType,
  DimensionPreset,
  ComponentPlacement,
  ComponentGeometry,
  Perforation,
  MachiningOperationKind,
  MachiningEntryFace,
  MachiningOperation,
  HardwareMachiningPart,
  HardwareMachiningProfile,
  JointKind,
  PanelJointRule,
  BackPanelRule,
  DoorHingeRule,
  JointDrillingRules,
  Component,
  ModuleComponentInstance,
  Agregado,
  ModuleAgregadoInstance,
  ProjectItem,
  ItemFloorStatus,
  FloorEventSource,
  FloorStatusEvent,
  ProjectProductionState,
  Project,
  ProjectVersion,
  ProjectTemplate,
  PlacementElevation,
  PlacementMode,
  KitchenWall,
  ProjectItemPlacement,
  KitchenPlanUnderlay,
  KitchenSpace,
  ProjectKitchenLayout,
  ModuleBaseMode,
  ProjectPlanEditSession,
  InstallationChecklistItem,
  QuotePriceSnapshot,
  Catalog,
  WorkshopSettings,
  Workspace,
  ResolvedBoardPart,
  ResolvedHardwareLine,
  ResolvedBom,
  QuoteBreakdown,
  ProductionCutRow,
  HardwarePurchaseRow,
  PieceLabel,
  ModuleLabel,
  MaterialUsageRow,
  EdgeUsageRow,
  ProjectMaterialSummary,
  ProjectPhotoStage,
  ProjectPhoto,
  ProjectTechnicalStatus,
  ProjectInternalMessageType,
  ProjectInternalMessage,
  WarrantyTicketCategory,
  WarrantyTicketPriority,
  WarrantyTicketStatus,
  WarrantyPhotoKind,
  WarrantyRefabricationPiece,
  WarrantyTicketPhoto,
  WarrantyTicket,
} from './types';



export * from './crm';
export * from './metrics/workshopMetrics';


export {
  DEFAULT_WORKSHOP_SETTINGS,
  resolveWorkshopSettings,
  withWorkshopSettings,
} from './workshopSettings';

export { effectiveOptionChoices } from './optionChoices';

export {
  canAccessOwnedResource,
  resolveOwnerOnCreate,
  resolveOwnerOnUpdate,
  roleCanAssignOwner,
  roleSeesAllOwners,
} from './ownership';

export type { ProductRole } from './rbac';
export {
  ASSIGNABLE_ROLES,
  PRODUCT_ROLES,
  USER_ROLES,
  isValidUserRole,
  navIdsForRole,
  roleCanAccessCatalogNav,
  roleCanAccessCustomers,
  roleCanAccessModulesNav,
  roleCanAccessShowcaseNav,
  roleCanAccessNav,
  roleCanAccessProjects,
  roleCanAccessSettings,
  roleCanDeleteProject,
  canExportProductionForProject,
  projectAllowsProductionExport,
  roleCanExportProduction,
  roleCanManageUsers,
  roleCanManageProductionStaff,
  roleCanManageSalesStaff,
  roleCanMarkProduced,
  roleCanMutateCatalog,
  roleCanMutateCustomers,
  roleCanMutateModules,
  roleCanMutateProjects,
  roleCanReopenProject,
  roleCanViewCosts,
  roleCanViewPortfolioDashboard,
  roleLabelEs,
  roleUsesProductionQueue,
  roleCanAccessProductionNav,
  roleCanAccessProductionDashboard,
  roleCanAccessEngineeringDashboard,
  roleCanAccessEngineeringNav,
  roleCanAccessSalesDashboard,
  roleCanClaimProductionJob,
  roleIsScopedBySector,
  roleCanAccessFabricNav,
  roleCanAccessShippingNav,
  roleCanAccessEmbarquesNav,
  sectorsAllowedForRole,
  roleCanAdvanceStation,
  roleCanAccessPurchasingNav,
  roleCanAccessWarehouseDashboard,
  roleCanMarkPicking,
  roleCanManageStock,
  roleCanManagePurchasing,
  roleCanAppendProjectEvent,
  type CostVisibilityOptions,
  type UserSector,
  roleCanSuperviseFloor,
} from './rbac';

export type { CategoryFilterId } from './categories';
export {
  MAX_CATEGORY_DEPTH,
  UNCATEGORIZED_FILTER,
  assertCategoryPlacement,
  canPlaceCategory,
  cascadeFromCategoryId,
  cascadeOptions,
  cascadeSelectedCategoryId,
  categoryDepth,
  categoryFilterIdSet,
  categoryPath,
  childrenOf,
  collectDescendantIds,
  filterModulesByCategory,
  filterAmbientMaterialsByCategory,
  subtreeHeight,
} from './categories';

export { DomainError, ValidationError, ResolutionError } from './errors';

export {
  defaultMeasurePresetId,
  moduleHasMeasurePresets,
  pickPresetByMeasureDefaults,
  resolveModuleMeasurePreset,
  validateModulePresets,
} from './measurePresets';

export {
  DEFAULT_MATERIAL_PREVIEW_COLOR,
  DEFAULT_AMBIENT_MATERIALS,
  resolveAmbientMaterials,
  isValidPreviewColor,
  normalizePreviewColor,
} from './materialPreview';

export {
  defaultPoseForPlacement,
  type PlacementDims,
  type SpatialPose,
} from './spatialPlacement';

export {
  eulerXyzMatrix,
  localBoxMinCornerRenderOffset,
  localOriginWorkshopFromMinCorner,
  groupPositionFromMinCorner,
  type BoardLocalSize,
  type SpatialRotation,
  type Vec3,
} from './spatialAnchor';

export {
  resolveHardwarePlacement,
  normalizeHardwarePreview,
  snapValue,
  convertWorldDeltaToFaceMm,
  type ResolveHardwarePlacementParams,
  type ResolvedHardwarePlacement,
  type NormalizedHardwarePreview,
} from './hardwarePlacement';
export {
  HARDWARE_FINISHES,
  HARDWARE_PART_ROLES,
  HARDWARE_PART_ROLE_LABELS_ES,
  getHardwareFinish,
  hardwarePartRolesForShape,
  matchHardwareFinish,
  normalizeHardwarePartFinishes,
  resolveHardwarePartFinish,
  type HardwareFinish,
  type HardwareFinishId,
} from './hardwareFinishes';

export {
  previewPartForComponent,
  type ComponentPreviewInput,
  type ComponentPreviewOptions,
} from './previewComponentPart';

export type { BoardLineCost, HardwareLineCost, LineCost, ComposedModuleInput, ComposedModuleResult } from './engine';

export {
  resolveBom,
  resolveComposedModule,
  calcMaterialCostPerM2,
  calcBoardLineMetrics,
  calcBoardLineCost,
  calcHardwareLineCost,
  calcLineCost,
  calcProjectBreakdown,
  isProjectClosed,
  projectAllowsContentMutation,
  projectAllowsReopenToDraft,
  captureQuoteSnapshot,
  transitionProjectStatus,
  generateCutRows,
  generateCutRowsWithLinks,
  formatOptimizerPartDescription,
  generatePieceLabels,
  formatEdgeBandingInstruction,
  generateHardwareList,
  generateProjectMaterialSummary,
  validateAmbientRefs,
  validateBoardPart,
  validateComponent,
  validateHardwareLine,
  validateModule,
  validateStructure,
  validateCatalogEntityCodes,
  evaluatePartFormula,
  resolveStructure,
} from './engine';

export type { ExportIssue } from './exportIssues';
export {
  collectExportIssues,
  collectModuleOptionRoles,
  domainErrorToExportIssue,
} from './exportIssues';

export type {
  CreateProjectFromTemplateOptions,
  DuplicateModuleOptions,
  DuplicateProjectOptions,
  ProjectToTemplateOptions,
} from './duplicate';
export {
  suggestDuplicateCode,
  duplicateModule,
  duplicateProject,
  createProjectFromTemplate,
  projectToTemplate,
} from './duplicate';

export {
  DEFAULT_WALL_CABINET_Z_MM,
  DEFAULT_BASE_CLEARANCE_MM,
  BASE_CLEARANCE_PRESETS_MM,
  WALL_CABINET_Z_PRESETS_MM,
  emptyKitchenLayout,
  DEFAULT_KITCHEN_SPACE_ID,
  DEFAULT_KITCHEN_SPACE_NAME,
  ensureKitchenSpaces,
  syncActiveKitchenSpace,
  setActiveKitchenSpace,
  addKitchenSpace,
  renameKitchenSpace,
  removeKitchenSpace,
  allKitchenPlacements,
  isFreePlacement,
  resolveWallFrames,
  kitchenLayoutWarnings,
  pruneKitchenLayout,
  pruneKitchenLayoutOrClear,
  isKitchenLayoutEmpty,
  wallDirectionYawDeg,
  placementAabb,
  reorderPlacementOnWall,
  offsetMmFromPlanPoint,
  snapOffsetOnWall,
  repackPlacementsOnWall,
  resolveBaseClearanceMm,
  resolveWallCabinetZMm,
  layoutKitchenPlacements,
  nextOffsetOnWall,
  createDefaultLWalls,
  seedDefaultLWallsIfEmpty,
  aabbOverlap2D,
  placedModuleAabb,
  placedModuleCollides,
} from './kitchenLayout';
export type { WallOffsetPeer } from './kitchenLayout';
export type {
  KitchenFootprint,
  ResolvedWallFrame,
  KitchenPlacedModule,
  KitchenLayoutResult,
  Aabb2D,
  CollisionPeer,
} from './kitchenLayout';

export { roundHardwarePurchaseQuantity } from './engine/labels';

export {
  PLAN_EDIT_SESSION_TTL_MS,
  isPlanEditSessionExpired,
  planEditSessionHeldByOther,
  acquirePlanEditSession,
  renewPlanEditSession,
  releasePlanEditSession,
} from './planEditSession';
export type { PlanEditActor } from './planEditSession';

export {
  parseDxfToKitchenWalls,
  createPlanUnderlay,
  scalePlanUnderlay,
  DEFAULT_UNDERLAY_WIDTH_MM,
  DEFAULT_UNDERLAY_HEIGHT_MM,
} from './planImport';
export type { DxfImportResult, ParseDxfOptions } from './planImport';

export {
  ZOCLO_BOARD_ROLE,
  ZOCLO_STRIP_ROLE,
  PATAS_ROLE,
  ZOCLO_BOARD_FALLBACK_ROLE,
  isModuleBaseMode,
  resolveModuleBaseMode,
  resolveModuleBaseClearanceMm,
  resolveBoardOptionChoiceId,
  plinthStripMeters,
  filterComponentInstancesForBaseMode,
  applyBaseModeToHardwareLines,
  isZocloBoardRole,
  isZocloStripRole,
  isPatasRole,
  defaultBaseModeForFurnitureType,
  resolveBaseModeWithContext,
  resolveBaseClearanceWithContext,
  synthesizeBaseBoardPart,
  synthesizeBaseHardwareLine,
  applyBaseTreatment,
  baseContextForItem,
  plinthSidesForPlacement,
  plinthReturnDepthMm,
  PLINTH_SIDE_GAP_MM,
  SYNTHETIC_ZOCLO_PART_ID_SUFFIX,
  SYNTHETIC_ZOCLO_PART_CODE,
  SYNTHETIC_ZOCLO_SIDE_CODE,
  computeWallRunPlinthMap,
  type BaseResolutionContext,
  type PlinthSides,
  type PlinthRunInfo,
} from './plinth';

export { estimateBoardSheets } from './boardSheetEstimate';
export type { BoardSheetEstimate } from './boardSheetEstimate';

export {
  buildProductionElevations,
  hasProductionElevations,
  type ProductionElevationUnit,
  type ProductionWallElevation,
  type ProductionUnplacedUnit,
  type ProductionElevationsResult,
} from './productionElevations';

export {
  ITEM_FLOOR_STATUSES,
  ITEM_FLOOR_STATUS_LABELS_ES,
  isItemFloorStatus,
  normalizeItemFloorStatus,
  nextItemFloorStatus,
  setProjectItemFloorStatus,
  countFloorStatuses,
  allModulesPackaged,
  allModulesLoaded,
  calculateLoadingProgress,
  type LoadingProgressResult,
  type LoadingProgress,
} from './productionFloor';

export {
  PRODUCTION_SECTORS,
  PIPELINE_SECTORS,
  PRODUCTION_SECTOR_LABELS_ES,
  isProductionSector,
  sectorForFloorStatus,
  floorStatusForSector,
  itemsWaitingForSector,
  buildProjectFloorSummary,
  type ProductionSector,
  type PipelineSector,
  type FloorStageProgress,
  type ProjectFloorSummary,
} from './productionSectors';

export {
  advanceFloorStatus,
  appendFloorEvent,
  floorTimelineForItem,
  latestFloorEvent,
  type AdvanceFloorStatusInput,
  type AdvanceFloorStatusResult,
} from './productionFloorEvents';

export {
  generateModuleLabels,
  type GenerateModuleLabelsOptions,
} from './moduleLabels';

export {
  computeProductionTotals,
  summarizeProductionTotals,
  type ProductionTotals,
  type ProductionMaterialTotal,
  type ProductionEdgeTotal,
} from './productionTotals';

export {
  PICKING_MATERIALS,
  PICKING_STATUS_LABELS_ES,
  pickingKey,
  activeDespachosFor,
  computeWarehouseDashboardStats,
  type PickingMaterial,
  type PickingStatus,
  type ProjectPickingState,
  type WarehouseProjectMetrics,
  type WarehouseStockAlert,
  type WarehouseDashboardStats,
  type WarehouseProjectInput,
} from './purchasing';

export {
  STOCK_KIND_LABELS_ES,
  STOCK_MATERIAL_KINDS,
  STOCK_MOVEMENT_LABELS_ES,
  STOCK_MOVEMENT_TYPES,
  STOCK_STATUS_LABELS_ES,
  applyStockMovement,
  stockMovementDelta,
  stockStatus,
  stockUnitLabel,
  stockUnitPlural,
  stockValue,
  type MaterialStock,
  type StockMaterialKind,
  type StockMovement,
  type StockMovementType,
  type StockStatus,
} from './stock';

export {
  PO_STATUSES,
  PO_STATUS_LABELS_ES,
  isValidPoStatus,
  poCanCancel,
  poCanEmit,
  poCanReceive,
  poFullyReceived,
  poRemaining,
  poLineCost,
  poTotalCost,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type PurchaseOrderStatus,
  type Supplier,
} from './purchasingOrders';

export {
  computeProductionDesignFingerprint,
  ensureProductionRevision,
  recordProductionExport,
  getProductionStaleInfo,
  type ProductionStaleInfo,
} from './productionRevision';

export {
  engineeringStatus,
  canSendToProduction,
  createEngineeringLog,
  recordGeneration,
  recordSentToProduction,
  computeEngineeringDashboardStats,
  ENGINEERING_STATUS_LABELS_ES,
  type EngineeringLog,
  type EngineeringStatus,
  type EngineeringDashboardProjectMetrics,
  type EngineerWorkloadSummary,
  type EngineeringDashboardStats,
} from './engineering';

export {
  DATA_TRUTH_ORIGIN_LABELS_ES,
  type DataTruthOrigin,
  type DataTruthMetric,
} from './dataTruth';

export {
  projectProcessStage,
  filterProjectsByProcessStage,
  canReleaseMaterials,
  isProductionReady,
  PROCESS_STAGE_LABELS_ES,
  type ProjectProcessStage,
  type MaterialsRelease,
} from './processStage';

export {
  buildCncPilotDocument,
  cncPilotDocumentToJson,
  type CncPilotDocument,
  type CncPilotPiece,
  type CncPilotOutline,
} from './cncPilot';

export {
  buildAssemblySheets,
  type AssemblySheet,
  type AssemblySheetHardwareLine,
} from './assemblySheets';

export {
  PRODUCTION_SCOPE_ALL,
  listProductionSpaceOptions,
  itemIdsForProductionSpace,
  unplacedItemIdsForProduction,
  projectScopedToProductionSpace,
  type ProductionSpaceOption,
} from './productionScope';

export {
  projectWithRoleChoice,
  compareRoleScenario,
  applyRoleChoiceToProject,
} from './scenarioCompare';
export type {
  ScenarioCompareResult,
  ScenarioCompareError,
} from './scenarioCompare';

export { DEFAULT_INSTALLATION_CHECKLIST } from './types';

export {
  DEFAULT_STRUCTURE_REVISION,
  bumpStructureRevision,
  captureProjectItemStructurePins,
  reifyResolvedStructure,
  resolveStructureForPin,
  resolveStructureRevision,
  snapshotStructureRevision,
  structureRevision,
} from './structures/versioning';
export type { ResolvedStructureRevision } from './structures/versioning';

export {
  PIECE_LABEL_QR_SCHEME,
  parsePieceLabelScan,
  pieceLabelQrPayload,
  pieceLabelQrPayloadUrl,
  moduleLabelQrPayload,
  moduleLabelQrPayloadUrl,
  unwrapPieceLabelQrUrl,
} from './pieceLabelQr';
export type {
  ParsedPieceLabelScan,
  PieceLabelQrFields,
  ModuleLabelQrFields,
} from './pieceLabelQr';

export {
  parseNestingImportCsv,
  nestingImportFromRows,
} from './nestingImport';
export type {
  NestingImportRow,
  NestingImportResult,
} from './nestingImport';

// --- Command pattern + undo/redo (PRD §4.3, F061) ---
export { CommandManager, type Command } from './commandManager';
export {
  addProjectItemCommand,
  removeProjectItemWithSnapshotCommand,
  changeOptionChoiceWithSnapshotCommand,
  updateProjectItemCommand,
  changeQuantityCommand,
  reorderProjectItemsCommand,
} from './projectCommands';

// --- Workshop rules (Fase 5 slice 5.1) ---
export {
  suggestHingeCount,
  suggestSlideLength,
  suggestShelfCount,
  suggestHandleCount,
  suggestLegCount,
  suggestHardwareForModule,
  type WorkshopSuggestion,
} from './workshopRules';

// --- Tiered pricing / volume discounts (#202) ---
export type { DiscountTier } from './types';
export {
  resolveDiscountTier,
  applyTieredDiscount,
  totalItemQuantity,
} from './tieredPricing';
export type { ResolvedDiscount } from './tieredPricing';

// --- Project versioning / history (#200) ---
export {
  currentVersion,
  snapshotProjectVersion,
  restoreProjectVersion,
  snapshotOnStatusChange,
  diffVersions,
} from './projectVersioning';

// --- ZPL Thermal Labels (F071) ---
export {
  pieceToZpl,
  pieceBatchToZpl,
  moduleToZpl,
  moduleBatchToZpl,
  pieceLabelEdgeSides,
  sanitizeZplText,
  dotsPerMm,
  ZPL_SIZE_PRESETS,
  type ZplSizePreset,
  type ZplDpi,
  type ZplExportOptions,
  type ZplSizeDimensions,
} from './zplLabels';

// --- Configurable CSV Cut List (F073) ---
export {
  cutListConfigurableCsvExport,
  type CsvDelimiter,
  type CsvOptimizerPreset,
  type CutListCsvExportOptions,
} from './cutListConfigurableCsv';

// --- Part Drilling Data (F074) ---
export {
  DEFAULT_BOARD_THICKNESS_MM,
  generatePartDrillingData,
  inferHolesForPiece,
  type HoleFace,
  type HoleType,
  type HoleDefinition,
  type PartDrillingPattern,
  type ProjectDrillingData,
} from './partDrilling';

// --- Part Drilling Resolution Engine (F128) ---
export {
  resolvePartDrilling,
  assertDrillingValid,
  validateDrillingHoles,
  deduplicateHoles,
  getFaceDimensions,
  OPPOSITE_FACE,
  type DrillingIssue,
  type DrillingIssueCode,
  type ResolvedPartDrilling,
  type ResolvePartDrillingParams,
  type HardwareCatalogLookup,
  type PieceDescriptor,
} from './partDrillingResolver';

// --- Project Drilling Assembler (F130) ---
export {
  resolveProjectDrilling,
  type ResolveProjectDrillingParams,
  type ProjectDrillingResult,
} from './projectDrilling';

// --- Joint Drilling Rules (F129) ---
export {
  DEFAULT_JOINT_DRILLING_RULES,
  deriveJointHardwarePlacements,
  hingePositions,
  jointFastenerPositions,
  type DerivedJointPlacement,
  type DeriveJointPlacementsParams,
  type JointPart,
} from './jointDrillingRules';

// --- Hardware Machining Profiles (F127) ---
export {
  MACHINING_OPERATION_KINDS,
  MACHINING_ENTRY_FACES,
  countMachiningOperations,
  normalizeMachiningProfile,
  validateMachiningProfile,
} from './hardwareMachining';

// --- Agregados helpers ---
export {
  mirrorComponentPlacement,
  mirrorComponentInstance,
  resolveAgregadoInstance,
  calculateAgregadoSubspaceUnits,
  type SubspaceUnit,
} from './agregados';

// --- Fixtures & Demo Seeds (F076) ---
export {
  createCocinaLopezDemoProject,
  seedCatalogExpandedLatAm,
  seedAmbientMaterials,
} from './__fixtures__/cocinaLopezDemo';
export {
  createPlantillaDemoProject,
  plantillaCatalogWithModules,
  seedCocinaEstandarTemplate,
} from './__fixtures__/plantillaDemo';

// --- CRM Showcase & Portfolio (CRM Phase 4) ---
export {
  filterShowcasePhotos,
  groupShowcasePhotosByProject,
  type ShowcasePhotoItem,
  type ShowcaseFilter,
  type ProjectShowcaseGroup,
} from './crm/showcase';

// --- 2D Guillotine Cut Plan & Optimization Engine (F115) ---
export * from './optimizer';

// --- Project Lifecycle, Events, Commercial Status, Design Revisions & Production Release (OC-010..OC-022) ---
export {
  COMMERCIAL_STATUS_LABELS_ES,
  PROJECT_STAGE_LABELS_ES,
  PROJECT_EVENT_TYPE_LABELS_ES,
  APPROVAL_STATUS_LABELS_ES,
  APPROVAL_TYPE_LABELS_ES,
  RELEASE_CHECK_LABELS_ES,
  generateEventId,
  createProjectEvent,
  appendProjectEvent,
  findLatestEvent,
  filterEventsByType,
  isEventRecorded,
  deriveCommercialStatus,
  setProjectCommercialStatus,
  mapLegacyStatusToCommercial,
  mapCommercialToLegacyStatus,
  deriveProjectStage,
  recordDepositReceived,
  getLatestDeposit,
  inferBackfillEvents,
  calcLifecycleKpis,
  calcBomFingerprint,
  createDesignRevision,
  getLatestDesignRevision,
  getProjectDesignRevisions,
  createApproval,
  getProjectApprovals,
  isCustomerApproved,
  isTechnicalApproved,
  evaluateProductionReleaseGates,
  canReleaseToProduction,
  createProductionRelease,
  getLatestProductionRelease,
  revokeProductionRelease,
  getProjectStalenessReport,
  isProjectStaleForProduction,
  getProjectChangeOrders,
  getActiveChangeOrder,
  createChangeOrder,
  submitChangeOrder,
  approveChangeOrder,
  rejectChangeOrder,
  cancelChangeOrder,
  CHANGE_ORDER_STATUS_LABELS_ES,
  STALENESS_REASON_LABELS_ES,
  PROJECT_EVENT_TYPES,
  isProjectEventType,
  type ProductionReleaseOptions,
  type ProjectEventSource,
  type CommercialEventType,
  type SurveyDesignApprovalEventType,
  type EngineeringReleaseEventType,
  type MaterialsEventType,
  type ProductionLogisticsEventType,
  type InstallationCloseEventType,
  type ProjectEventType,
  type ProjectEvent,
  type DepositReceivedPayload,
  type CommercialStatus,
  type ProjectStage,
  type LifecycleKpiResult,
  type DesignRevision,
  type ApprovalStatus,
  type ApprovalType,
  type Approval,
  type ProductionReleaseCheckCode,
  type ProductionReleaseCheck,
  type ProductionRelease,
  type StalenessReason,
  type ProductionStalenessReport,
  type ChangeOrderStatus,
  type ChangeOrderImpact,
  type ChangeOrder,
} from './projectLifecycle';

export {
  PART_OPERATION_TYPES,
  isPartOperationType,
  PART_OPERATION_STATUSES,
  isPartOperationStatus,
  MODULE_UNIT_STATUSES,
  isModuleUnitStatus,
  MODULE_UNIT_STATUS_TRANSITIONS,
  canTransitionModuleUnitStatus,
  nextModuleUnitStatus,
  resolvePartRequiredOperations,
  derivePartInstancesForProject,
  deriveModuleUnitsForProject,
  advancePartOperation,
  checkAssemblyReadiness,
  aggregateAssemblyReadiness,
  recordSupervisorAssemblyOverride,
  partsWaitingForSector,
  unitsWaitingForSector,
  advanceModuleUnitStatus,
  triggerPartRework,
  deriveLegacyItemFloorStatus,
  physicalStationQueue,
  describeMissingPieces,
  type PhysicalStationSector,
  type PhysicalStationRow,
  type MissingPieceInfo,
  type PartOperationType,
  type PartOperationStatus,
  type ModuleUnitStatus,
  type PartOperation,
  type PartInstanceStatus,
  type PartInstance,
  type ModuleUnitExecution,
  type SupervisorAssemblyOverride,
  type AssemblyReadiness,
  type DerivePartInstancesOptions,
} from './partExecution';

export {
  deriveProjectPartExecutions,
  type ProjectPartExecutions,
  type DeriveProjectPartExecutionsResult,
  type DeriveProjectPartExecutionsError,
} from './partExecutionDerivation';

export {
  INSTALLATION_JOB_STATUSES,
  INSTALLATION_VISIT_STATUSES,
  INSTALLATION_VISIT_RESULTS,
  FIELD_ISSUE_STATUSES,
  FIELD_ISSUE_STATUS_TRANSITIONS,
  PUNCH_ITEM_STATUSES,
  PUNCH_SEVERITIES,
  INSTALLATION_JOB_STATUS_LABELS_ES,
  INSTALLATION_VISIT_STATUS_LABELS_ES,
  INSTALLATION_VISIT_RESULT_LABELS_ES,
  FIELD_ISSUE_STATUS_LABELS_ES,
  PUNCH_ITEM_STATUS_LABELS_ES,
  PUNCH_SEVERITY_LABELS_ES,
  CLOSEOUT_CHECK_LABELS_ES,
  canTransitionFieldIssueStatus,
  openInstallationVisits,
  openFieldIssues,
  openPunchItems,
  blockingPunchItems,
  isInstallationCloseoutSigned,
  isInstallationClosed,
  deriveInstallationJobStatus,
  installationUnitsSummary,
  evaluateCloseoutGates,
  evaluateCloseoutReadiness,
  validateCloseoutEventAppend,
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
  type InstallationJobStatus,
  type InstallationVisitStatus,
  type InstallationVisitResult,
  type FieldIssueStatus,
  type PunchItemStatus,
  type PunchSeverity,
  type InstallationVisit,
  type FieldIssue,
  type PunchItem,
  type ClientCloseout,
  type InstallationJob,
  type InstallationUnitsSummary,
  type CloseoutCheckCode,
  type CloseoutCheck,
  type CloseoutReadiness,
  type ScheduleVisitParams,
  type ReportFieldIssueParams,
  type OpenPunchItemParams,
} from './installation';

export {
  MATERIAL_RESERVATION_STATUSES,
  MATERIAL_RESERVATION_STATUS_LABELS_ES,
  MATERIALS_RELEASE_CHECK_LABELS_ES,
  buildMaterialRequirements,
  materializeRequirements,
  computeWarehouseAvailability,
  computeProjectMaterialCoverage,
  planShortagePurchaseLines,
  reserveProjectMaterials,
  consumePlannedMaterials,
  evaluateMaterialsReleaseReadiness,
  releaseProjectMaterials,
  isMaterialReservationStatus,
  activeReservations,
  type MaterialReservationStatus,
  type MaterialsReleaseCheckCode,
  type MaterialRequirementLine,
  type MaterialRequirementsSnapshot,
  type MaterialReservation,
  type MaterialsReleaseEvidence,
  type MaterialPlanning,
  type BuildRequirementsInput,
  type MaterialAvailability,
  type WarehouseAvailabilityInput,
  type ProjectMaterialLineCoverage,
  type ProjectCoverageInput,
  type ShortagePurchaseLine,
  type ReserveResult,
  type MaterialsReleaseCheck,
  type MaterialsReleaseReadiness,
} from './materialPlanning';

export {
  QUALITY_ISSUE_CATEGORIES,
  QUALITY_ISSUE_CATEGORY_LABELS_ES,
  QUALITY_ISSUE_STATUSES,
  QUALITY_ISSUE_STATUS_LABELS_ES,
  QUALITY_ISSUE_STATUS_TRANSITIONS,
  REWORK_ACTION_TYPES,
  REWORK_ACTION_LABELS_ES,
  QC_CHECK_CODES,
  QC_CHECK_LABELS_ES,
  QC_GATE_CHECK_LABELS_ES,
  openQualityIssues,
  openIssuesForUnit,
  unitQcRecord,
  reworkCostSummary,
  evaluateUnitQcGate,
  isQualityIssueCategory,
  isReworkActionType,
  canTransitionQualityIssueStatus,
  reportQualityIssue,
  transitionQualityIssue,
  recordReworkAction,
  recordUnitQc,
  overrideUnitQc,
  type QualityIssueCategory,
  type QualityIssueStatus,
  type ReworkActionType,
  type QcCheckCode,
  type QualityStation,
  type QualityIssue,
  type ReworkAction,
  type UnitQcChecklistItem,
  type UnitQcRecord,
  type QualityJob,
  type QcGateCheckCode,
  type QcGateCheck,
  type UnitQcGateResult,
  type ReportQualityIssueParams,
  type RecordReworkActionParams,
  type RecordUnitQcParams,
} from './quality';

export {
  TIME_ENTRY_CATEGORIES,
  TIME_ENTRY_CATEGORY_LABELS_ES,
  OTHER_COST_KINDS,
  OTHER_COST_KIND_LABELS_ES,
  MATERIAL_VALUATION_BASES,
  isTimeEntryCategory,
  isOtherCostKind,
  activeTimeEntries,
  activeOtherCosts,
  valueMaterialConsumptions,
  computeJobCostSummary,
  timeEntryCost,
  captureCostBaseline,
  setLaborRate,
  recordTimeEntry,
  voidTimeEntry,
  recordOtherCost,
  voidOtherCost,
  validateJobCostingShape,
  type TimeEntryCategory,
  type OtherCostKind,
  type MaterialValuationBasis,
  type CostTruth,
  type CostBaseline,
  type TimeEntry,
  type OtherActualCost,
  type JobCosting,
  type MaterialConsumptionInput,
  type ValuedMaterialLine,
  type MaterialCostValuation,
  type ReworkCostInput,
  type JobCostSummaryInput,
  type JobCostSummary,
  type CaptureCostBaselineParams,
  type SetLaborRateParams,
  type RecordTimeEntryParams,
  type RecordOtherCostParams,
  type VoidEntryParams,
} from './jobCosting';











export {
  MEASURE_INTENTS,
  MEASURE_INTENT_LABELS_ES,
  SURVEY_ELEMENT_KINDS,
  SURVEY_ELEMENT_KIND_LABELS_ES,
  isMeasureIntent,
  isSurveyElementKind,
  surveyFabricationBlockers,
  isSurveyApprovedForFabrication,
  createSiteSurvey,
  upsertSurveySpace,
  captureSpaceMeasures,
  removeSurveySpace,
  verifySiteSurvey,
  approveSpaceMeasures,
  freezeMeasuresForFabrication,
  validateSiteSurveyShape,
  type MeasureIntent,
  type SurveyElementKind,
  type SurveyElement,
  type SpaceMeasures,
  type SurveySpace,
  type SiteSurvey,
  type SurveyGateBlocker,
  type CreateSiteSurveyParams,
  type UpsertSurveySpaceInput,
  type SurveyElementInput,
  type CaptureSpaceMeasuresParams,
  type VerifySiteSurveyParams,
  type ApproveSpaceMeasuresParams,
  type FreezeMeasuresParams,
} from './siteSurvey';

export {
  OPS_EXCEPTION_KINDS,
  deriveOpsExceptions,
  type OpsException,
  type OpsExceptionKind,
  type OpsExceptionSeverity,
  type OpsExceptionsOptions,
} from './opsExceptions';
