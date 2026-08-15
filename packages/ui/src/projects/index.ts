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
