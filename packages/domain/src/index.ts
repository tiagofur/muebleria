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
  BoardFace,
  PlacementSlot,
  BoardPart,
  HardwareLine,
  ExternalDims,
  Module,
  Structure,
  DimensionPreset,
  FurnitureComponent,
  FurnitureComponentKind,
  ModuleComponentRef,
  ProjectItem,
  Project,
  QuotePriceSnapshot,
  Catalog,
  WorkshopSettings,
  Workspace,
  ResolvedBoardPart,
  ResolvedHardwareLine,
  ResolvedBom,
  AssemblyCompleteness,
  PlacedBoardPart,
  ResolvedAssembly,
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
  FURNITURE_COMPONENT_KINDS,
  furnitureComponentKindLabelEs,
  isFurnitureComponentKind,
} from './furnitureComponents';

export {
  BOARD_FACES,
  PLACEMENT_SLOTS,
  DEFAULT_DESIGN_THICKNESS_MM,
  isBoardFace,
  isPlacementSlot,
  boardFaceLabelEs,
  placementSlotLabelEs,
  defaultPoseForSlot,
} from './spatial';

export { resolveAssembly } from './assembly';

export type { BoardLineCost, HardwareLineCost, LineCost, PartFormulaDims } from './engine';

export {
  resolveBom,
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
  validateHardwareLine,
  validateModule,
  validateStructure,
  validateFurnitureComponent,
  validateModuleComponentRefs,
  validatePartSpatialFormulas,
  expandModuleComponents,
  resolveFurnitureComponentParts,
  validateCatalogEntityCodes,
  evaluatePartFormula,
  isValidPartFormula,
  PART_FORMULA_PATTERN,
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
