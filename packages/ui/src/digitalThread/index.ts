/**
 * Digital Thread Web surfaces (#396 tracker).
 *
 * WEB-DT-1 (#500): Project Furniture matrix and physical-unit traceability.
 */

export {
  ProjectFurnitureScreen,
  projectFurnitureQueryKeys,
  type ProjectFurnitureContextState,
  type ProjectFurnitureQueryKeys,
  type ProjectFurnitureScreenProps,
} from './ProjectFurnitureScreen';

export {
  buildFurnitureMatrix,
  currentReleaseReference,
  defaultDesignContext,
  defaultQuoteRevisionId,
  EMPTY_MATRIX_FILTERS,
  filterMatrixRows,
  filtersAreActive,
  ORIGIN_LABEL_LIST,
  LIFECYCLE_LABEL_LIST,
  PRESENCE_LABELS,
  type DesignContextSelection,
  type DesignPresence,
  type FurnitureLifecycle,
  type FurnitureMatrixInput,
  type FurnitureMatrixRow,
  type FurnitureMatrixSummary,
  type FurnitureOrigin,
  type MatrixFilters,
} from './furnitureMatrix';
