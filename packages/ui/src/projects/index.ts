/**
 * Project / quotation UI surface.
 */

export {
  ProjectsScreen,
  ExportIssueList,
  type ProjectsScreenProps,
  type ProjectDraft,
  type AddItemDraft,
  type ExportIssueListProps,
} from './ProjectsScreen';

export {
  InternalCommsPanel,
  type InternalCommsPanelProps,
} from './components/InternalCommsPanel';

export {
  ProjectPhotosGallery,
  type ProjectPhotosGalleryProps,
} from './components/ProjectPhotosGallery';

export {
  WarrantyTicketsPanel,
  type WarrantyTicketsPanelProps,
} from './components/WarrantyTicketsPanel';



export {
  ProjectStalenessBanner,
  type ProjectStalenessBannerProps,
} from './components/ProjectStalenessBanner';

export {
  ProductionReleaseModal,
  type ProductionReleaseModalProps,
} from './components/ProductionReleaseModal';

export {
  ChangeOrderModal,
  type ChangeOrderModalProps,
} from './components/ChangeOrderModal';

export {
  LifecyclePanel,
  type LifecyclePanelProps,
} from './components/LifecyclePanel';

export { CostingPanel } from './components/CostingPanel';
export type { CostingHandlers } from './components/CostingPanel';
export { costingPanelView, MATERIAL_TRUTH_LABELS_ES, MATERIAL_BASIS_LABELS_ES } from './costingView';
export type {
  CostingPanelView,
  CostingBaselineView,
  CostingSummaryView,
  CostingMaterialLineView,
  CostingTimeEntryView,
  CostingOtherCostView,
} from './costingView';

export {
  PROJECT_STATUSES,
  statusOptionsForRole,
  canEditQuoteContent,
  canShowProjectPricePreview,
  countItemsWithModule,
  customersForProjectPicker,
  defaultChoicesForNewItem,
  emptyAddItemDraft,
  emptyProjectDraft,
  filterProjectsByQuery,
  findModuleById,
  formatIsoDate,
  formatProjectMoney,
  groupsForModuleItem,
  optionLabelForId,
  optionsForGroup,
  projectStatusBadgeClass,
  projectStatusLabel,
  projectToDraft,
  resolveCustomerName,
  setItemOptionChoice,
  setProjectLevelChoice,
  validateItemQuantity,
  validateProjectDraft,
} from './projectHelpers';
