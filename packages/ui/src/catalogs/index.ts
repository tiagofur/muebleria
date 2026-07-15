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
} from './MaterialsCatalog';

export {
  EdgesCatalog,
  type EdgeDraft,
  type EdgesCatalogProps,
} from './EdgesCatalog';

export {
  HardwareCatalog,
  type HardwareDraft,
  type HardwareCatalogProps,
} from './HardwareCatalog';
