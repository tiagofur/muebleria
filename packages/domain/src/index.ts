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
  ProjectItem,
  Project,
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
  roleCanExportProduction,
  roleCanManageUsers,
  roleCanMutateCatalog,
  roleCanMutateCustomers,
  roleCanMutateModules,
  roleCanMutateProjects,
  roleLabelEs,
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

export type { BoardLineCost, HardwareLineCost, LineCost } from './engine';

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
  generateHardwareList,
  validateBoardPart,
  validateHardwareLine,
  validateModule,
  validateCatalogEntityCodes,
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
