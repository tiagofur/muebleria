/**
 * Shared presentational primitives (modal, toast, search, empty state, etc.).
 */

import './statusBadge.css';
import './statCard.css';
import './cardOpen.css';

export { BrandMark, type BrandMarkProps } from './BrandMark';
export { PageHeader, type PageHeaderProps } from './PageHeader';
export { PageToolbar, type PageToolbarProps } from './PageToolbar';
export { CatalogImage, type CatalogImageProps } from './CatalogImage';
export {
  DropdownMenu,
  type DropdownMenuItem,
  type DropdownMenuSection,
  type DropdownMenuProps,
} from './DropdownMenu';
export { Modal, type ModalProps, type ModalSize } from './Modal';
export {
  FullscreenDialog,
  type FullscreenDialogProps,
} from './FullscreenDialog';
export { SearchInput, type SearchInputProps } from './SearchInput';
export {
  StatusChips,
  type StatusChipsProps,
  type StatusChipOption,
} from './StatusChips';
export {
  EmptyState,
  type EmptyStateProps,
  type EmptyStateVariant,
} from './EmptyState';
export {
  ConfirmDialog,
  type ConfirmDialogProps,
} from './ConfirmDialog';
export {
  ErrorBoundary,
  type ErrorBoundaryProps,
} from './ErrorBoundary';
export {
  useDebouncedValue,
  SEARCH_DEBOUNCE_MS,
} from './useDebouncedValue';
export { useUndoRedo, type UndoRedoApi } from './useUndoRedo';
export {
  useRoutableEntitySelection,
  type UseRoutableEntitySelectionOptions,
  type UseRoutableEntitySelectionResult,
} from './useRoutableEntitySelection';
export {
  useDraftSession,
  readDraftSession,
  seedEditorDraftFromBaseline,
} from './useDraftSession';
export {
  useEntityEditorState,
  type EntityEditorState,
  type UseEntityEditorStateOptions,
} from './useEntityEditorState';
export {
  EntityEditorLayout,
  type EntityEditorLayoutProps,
} from './EntityEditorLayout';
export {
  EngineeringDetailLayout,
  type EngineeringDetailLayoutProps,
} from './EngineeringDetailLayout';
export { EMPTY_PLACEHOLDER, formatEmpty } from './formatEmpty';
export {
  formatMoneyDisplay,
  type FormatMoneyDisplayOptions,
} from './formatMoneyDisplay';
export { Spinner, type SpinnerProps, type SpinnerSize } from './Spinner';
export { PageLoading, type PageLoadingProps } from './PageLoading';
export { InlineLoading, type InlineLoadingProps } from './InlineLoading';
export {
  useRovingTabList,
  type RovingTabList,
} from './rovingTabList';
export { WorkflowTabs, WorkspaceTabs, type TabDefinition } from './Tabs';
export {
  ScreenBoundary,
  type ScreenBoundaryProps,
} from './ScreenBoundary';
export { ListSkeleton, type ListSkeletonProps } from './ListSkeleton';
export { submitBusyLabel } from './submitBusy';
export { Furniture3DViewer, type Furniture3DViewerProps } from './Furniture3DViewer';
