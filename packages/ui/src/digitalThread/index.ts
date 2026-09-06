/**
 * Digital Thread Web surfaces (#396 tracker).
 *
 * WEB-DT-1 (#500): Project Furniture matrix and physical-unit traceability.
 * WEB-DT-2 (#501): Designs, immutable revisions and 3D artifact history.
 * WEB-DT-3 (#502): Reconciliation, approval and exact ProductionRelease.
 */

export {
  ProjectFurnitureScreen,
  projectFurnitureQueryKeys,
  type ProjectFurnitureContextState,
  type ProjectFurnitureQueryKeys,
  type ProjectFurnitureScreenProps,
} from './ProjectFurnitureScreen';

export {
  ProjectDesignsScreen,
  projectDesignsQueryKeys,
  type ProjectDesignsContextState,
  type ProjectDesignsQueryKeys,
  type ProjectDesignsScreenProps,
} from './ProjectDesignsScreen';

export {
  buildDesignLineage,
  selectDesignRevision,
  getArtifactAvailability,
  formatArtifactSize,
  formatSha256Digest,
  ARTIFACT_KIND_LABELS,
  DESIGN_REVISION_STATUS_LABELS,
  DESIGN_SOURCE_TYPE_LABELS,
  type ArtifactAvailability,
  type DesignLineageNode,
} from './designHistory';

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

export {
  ProjectReconciliationScreen,
  projectReconciliationQueryKeys,
  type ProjectReconciliationContextState,
  type ProjectReconciliationQueryKeys,
  type ProjectReconciliationScreenProps,
} from './ProjectReconciliationScreen';

export {
  findContextualRelease,
  formatDifferencePath,
  formatDifferenceValue,
  formatQuoteRevisionLabel,
  formatDesignRevisionLabel,
  impactChips,
  isHistoricalComparison,
  isIncorporableChange,
  PREFLIGHT_ISSUE_CODE_LABELS,
  PREFLIGHT_STATUS_LABELS,
  QUOTE_REVISION_STATUS_LABELS,
  QUOTE_SOURCE_TYPE_LABELS,
  RECONCILIATION_STATUS_LABELS,
} from './reconciliationWorkspace';
