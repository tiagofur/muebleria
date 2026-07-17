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
  ModuleShowcase,
  type ModuleShowcaseProps,
} from './ModuleShowcase';

export {
  Module3DPreview,
  type Module3DPreviewProps,
} from './preview3d/Module3DPreview';

export {
  assemblyToBoxes,
  placedBoardToBox,
  mmToScene,
  type BoardBoxMm,
} from './preview3d/placedBoardGeometry';

export {
  defaultOptionChoicesForModule,
  edgesFromFlags,
  emptyBoardPartDraft,
  emptyCategoryDraft,
  emptyHardwareLineDraft,
  emptyModuleComponentRefDraft,
  emptyModuleDraft,
  filterModulesByQuery,
  flattenCategoriesForSelect,
  flagsFromEdges,
  findModuleCodeConflict,
  formatModuleMoney,
  moduleToDraft,
  boardPartToDraft,
  hardwareLineToDraft,
  spatialFieldsFromDraft,
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
