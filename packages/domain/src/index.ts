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
  MaterialUsageRow,
  EdgeUsageRow,
  ProjectMaterialSummary,
} from './types';

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
} from './kitchenLayout';
export type { WallOffsetPeer } from './kitchenLayout';
export type {
  KitchenFootprint,
  ResolvedWallFrame,
  KitchenPlacedModule,
  KitchenLayoutResult,
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
} from './productionFloor';

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

export { pieceLabelQrPayload } from './pieceLabelQr';
export type { PieceLabelQrFields } from './pieceLabelQr';

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

// --- Agregados helpers ---
export {
  mirrorComponentPlacement,
  mirrorComponentInstance,
  resolveAgregadoInstance,
} from './agregados';

