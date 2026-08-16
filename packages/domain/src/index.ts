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
  Component,
  ModuleComponentInstance,
  Agregado,
  ModuleAgregadoInstance,
  ProjectItem,
  ItemFloorStatus,
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
  type CostVisibilityOptions,
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
  type BaseResolutionContext,
  type PlinthSides,
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
  generateModuleLabels,
  type GenerateModuleLabelsOptions,
} from './moduleLabels';

export {
  summarizeProductionTotals,
  type ProductionTotals,
  type ProductionMaterialTotal,
  type ProductionEdgeTotal,
} from './productionTotals';

export {
  computeProductionDesignFingerprint,
  ensureProductionRevision,
  recordProductionExport,
  getProductionStaleInfo,
  type ProductionStaleInfo,
} from './productionRevision';

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
  generatePartDrillingData,
  type HoleFace,
  type HoleType,
  type HoleDefinition,
  type PartDrillingPattern,
  type ProjectDrillingData,
} from './partDrilling';

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







