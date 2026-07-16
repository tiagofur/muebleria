/**
 * Module editor UI surface.
 */

export {
  ModulesScreen,
  type ModulesScreenProps,
  type ModuleDraft,
  type BoardPartDraft,
  type HardwareLineDraft,
  type CategoryDraft,
} from './ModulesScreen';

export {
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
  moduleToDraft,
  boardPartToDraft,
  hardwareLineToDraft,
  optionGroupsByKind,
  optionGroupsForBoardParts,
  optionGroupsForHardware,
  parseOptionalNumber,
  SEED_MODULE_CODES,
  suggestPartCode,
  validateModuleCode,
  nextGridEnterTarget,
  modulePartGridInputId,
  moduleHardwareGridInputId,
  MODULE_PART_GRID_FIELDS,
} from './moduleHelpers';
