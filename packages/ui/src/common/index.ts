/**
 * Shared presentational primitives (modal, toast, search, empty state, etc.).
 */

export { BrandMark, type BrandMarkProps } from './BrandMark';
export { CatalogImage, type CatalogImageProps } from './CatalogImage';
export {
  DropdownMenu,
  type DropdownMenuItem,
  type DropdownMenuSection,
  type DropdownMenuProps,
} from './DropdownMenu';
export { Modal, type ModalProps, type ModalSize } from './Modal';
export {
  ToastProvider,
  useToast,
  TOAST_DURATION_MS,
  TOAST_EXIT_MS,
  TOAST_MAX,
  type ToastInput,
  type ToastItem,
  type ToastType,
} from './Toast';
export { SearchInput, type SearchInputProps } from './SearchInput';
export { StatusChips, type StatusChipsProps } from './StatusChips';
export {
  EmptyState,
  type EmptyStateProps,
  type EmptyStateVariant,
} from './EmptyState';
export {
  ErrorBoundary,
  type ErrorBoundaryProps,
} from './ErrorBoundary';
export {
  useDebouncedValue,
  SEARCH_DEBOUNCE_MS,
} from './useDebouncedValue';
export {
  useRoutableEntitySelection,
  type UseRoutableEntitySelectionOptions,
  type UseRoutableEntitySelectionResult,
} from './useRoutableEntitySelection';
export { useDraftSession } from './useDraftSession';
export { EMPTY_PLACEHOLDER, formatEmpty } from './formatEmpty';
export {
  formatMoneyDisplay,
  type FormatMoneyDisplayOptions,
} from './formatMoneyDisplay';
export { Spinner, type SpinnerProps, type SpinnerSize } from './Spinner';
export { PageLoading, type PageLoadingProps } from './PageLoading';
export { InlineLoading, type InlineLoadingProps } from './InlineLoading';
export { ListSkeleton, type ListSkeletonProps } from './ListSkeleton';
export { submitBusyLabel } from './submitBusy';
export { Furniture3DViewer, type Furniture3DViewerProps } from './Furniture3DViewer';
