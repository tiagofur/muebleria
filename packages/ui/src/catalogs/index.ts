/**
 * Catalog ABM screens and helpers (presentation only).
 */

export {
  filterActiveForPicker,
  filterCatalogItems,
  findActiveCodeConflict,
  matchesCodeOrName,
  normalizeCode,
  validateNonNegativeNumber,
  validateRequiredName,
  validateUniqueCode,
  type ActiveFilterable,
  type CatalogStatusFilter,
  type CodedCatalogItem,
  type FilterCatalogOptions,
  type SearchableCoded,
} from './catalogHelpers';

export {
  ActiveBadge,
  CatalogTable,
  type CatalogColumn,
  type CatalogTableProps,
} from './CatalogTable';

export {
  CatalogPicker,
  type CatalogPickerOption,
  type CatalogPickerProps,
} from './CatalogPicker';

export {
  MaterialsCatalog,
  type MaterialDraft,
  type MaterialsCatalogProps,
} from './materials/MaterialsCatalog';

export {
  extractDominantColorFromImageFile,
  extractDominantColorFromRgba,
  type DominantColorOptions,
} from './extractDominantColor';

export {
  EdgesCatalog,
  type EdgeDraft,
  type EdgesCatalogProps,
} from './EdgesCatalog';

export {
  HardwareCatalog,
  type HardwareDraft,
  type HardwareCatalogProps,
} from './hardware/HardwareCatalog';

export {
  HardwareProfilesCatalog,
  type HardwareProfilesCatalogProps,
  type HardwareProfileRow,
} from './hardware/HardwareProfilesCatalog';
export type {
  HardwareProfileDraft,
  HardwareProfileItemDraft,
} from './hardware/hardwareProfileDraft';

export {
  AmbientMaterialsCatalog,
  type AmbientCategoryDraft,
  type AmbientMaterialDraft,
  type AmbientMaterialsCatalogProps,
} from './ambient/AmbientMaterialsCatalog';

export {
  LibraryDraftWorkspaceBanner,
  type LibraryDraftWorkspaceBannerProps,
} from './LibraryDraftWorkspaceBanner';

export {
  LibraryDraftValidationPanel,
  type LibraryDraftValidationPanelProps,
} from './LibraryDraftValidationPanel';

export {
  LibraryPublishConfirmContent,
  type LibraryPublishConfirmContentProps,
} from './LibraryPublishConfirmContent';

export {
  LibraryPublishHistoryPanel,
  type LibraryPublishHistoryPanelProps,
} from './LibraryPublishHistoryPanel';

export {
  LibraryConsumerViewPanel,
  type LibraryConsumerViewPanelProps,
} from './LibraryConsumerViewPanel';
