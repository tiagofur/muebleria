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
  DimensionPreset,
  ComponentPlacement,
  ComponentGeometry,
  Perforation,
  Component,
  ModuleComponentInstance,
  ProjectItem,
  Project,
  PlacementElevation,
  KitchenWall,
  ProjectItemPlacement,
  ProjectKitchenLayout,
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
  captureQuoteSnapshot,
  transitionProjectStatus,
  generateCutRows,
  formatOptimizerPartDescription,
  generatePieceLabels,
  formatEdgeBandingInstruction,
  generateHardwareList,
  generateProjectMaterialSummary,
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
  domainErrorToExportIssue,
} from './exportIssues';

export type {
  DuplicateModuleOptions,
  DuplicateProjectOptions,
} from './duplicate';
export {
  suggestDuplicateCode,
  duplicateModule,
  duplicateProject,
} from './duplicate';

export {
  DEFAULT_WALL_CABINET_Z_MM,
  emptyKitchenLayout,
  resolveWallFrames,
  kitchenLayoutWarnings,
  pruneKitchenLayout,
  layoutKitchenPlacements,
  nextOffsetOnWall,
  createDefaultLWalls,
} from './kitchenLayout';
export type {
  KitchenFootprint,
  ResolvedWallFrame,
  KitchenPlacedModule,
  KitchenLayoutResult,
} from './kitchenLayout';

export { estimateBoardSheets } from './boardSheetEstimate';
export type { BoardSheetEstimate } from './boardSheetEstimate';

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
