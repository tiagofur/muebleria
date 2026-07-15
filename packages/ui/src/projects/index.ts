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
  PROJECT_STATUSES,
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
  optionsForGroup,
  projectStatusBadgeClass,
  projectStatusLabel,
  projectToDraft,
  resolveCustomerName,
  validateItemQuantity,
  validateProjectDraft,
} from './projectHelpers';
