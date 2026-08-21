/**
 * Production workspace UI (F038 + PROD-0.1 / PROD-0.3).
 */

export {
  ProjectFloorProgressStrip,
  ProjectFloorStageChip,
} from './ProjectFloorProgressStrip';
export { PlantBoardScreen } from './PlantBoardScreen';
export { FabricScreen, summarizeFabricMetrics } from './FabricScreen';
export type {
  FabricActiveClaim,
  FabricProjectMetrics,
  FabricStation,
} from './fabricProjectCards';
export {
  EmbarquesScreen,
  embarquesProjects,
} from './EmbarquesScreen';
export { EmbarquesProjectDetail } from './EmbarquesProjectDetail';
export type { EmbarquesProjectDetailProps } from './EmbarquesProjectDetail';
export {
  InstalacionesScreen,
  instalacionesProjects,
} from './InstalacionesScreen';
export { InstallationJobPanel } from './InstallationJobPanel';
export type { InstallationJobPanelHandlers } from './InstallationJobPanel';
export {
  installationJobCardView,
  canCompleteInstallationNow,
  type InstallationJobCardView,
} from './installationJobView';
export type {
  DashboardMetrics,
  SectorDashboard,
} from './ProductionManagerDashboard';

export {
  ProductionQueue,
  type ProductionQueueProps,
  type ProductionQueueItem,
} from './ProductionQueue';

export {
  ProductionBoardView,
  type ProductionBoardViewProps,
} from './ProductionBoardView';

export {
  ProductionOrderHub,
  type ProductionOrderHubProps,
} from './ProductionOrderHub';

export {
  ProductionWorkspace,
  type ProductionWorkspaceProps,
} from './ProductionWorkspace';

export {
  filterProductionQueue,
  filterProductionVisible,
  isProductionQueueStatus,
  PRODUCTION_QUEUE_STATUSES,
  type ProductionQueueTab,
} from './productionHelpers';

export {
  PRODUCTION_ORDER_TABS,
  PRODUCTION_ORDER_TAB_LABELS,
  buildProductionOrderReadiness,
  isProductionOrderTab,
  parseProductionOrderTab,
  projectAllowsProductionOrder,
  type ProductionOrderTab,
  type ProductionOrderReadiness,
} from './productionOrderModel';

export {
  buildProductionModuleRows,
  type ProductionModuleRow,
} from './productionModuleRows';

export {
  ProductionOrderModulesPanel,
  type ProductionOrderModulesPanelProps,
} from './ProductionOrderModulesPanel';

export {
  ProductionOrderViewsPanel,
  type ProductionOrderViewsPanelProps,
} from './ProductionOrderViewsPanel';

export {
  ProductionOrderDespiecePanel,
  type ProductionOrderDespiecePanelProps,
} from './ProductionOrderDespiecePanel';

export {
  ProductionOrderLabelsPanel,
  type ProductionOrderLabelsPanelProps,
} from './ProductionOrderLabelsPanel';

export {
  readLabelPrinterSettings,
  writeLabelPrinterSettings,
  DEFAULT_LABEL_PRINTER_SETTINGS,
  type LabelPrinterSettings,
} from './labelPrinterSettings';

export {
  ProductionOrderHardwarePanel,
  type ProductionOrderHardwarePanelProps,
} from './ProductionOrderHardwarePanel';

export {
  ProductionOrderDocumentsPanel,
  type ProductionOrderDocumentsPanelProps,
  type ProductionDocumentItem,
} from './ProductionOrderDocumentsPanel';

export {
  ProductionElevationPreview,
  type ProductionElevationPreviewProps,
} from './ProductionElevationPreview';

export {
  ProductionOrderOptimizationPanel,
  type ProductionOrderOptimizationPanelProps,
} from './ProductionOrderOptimizationPanel';

export {
  ProductionOrderPaperlessPanel,
  type ProductionOrderPaperlessPanelProps,
} from './ProductionOrderPaperlessPanel';

export {
  ProductionOrderDispatchPanel,
  type ProductionOrderDispatchPanelProps,
} from './ProductionOrderDispatchPanel';

export {
  CsvExportConfigModal,
  type CsvExportConfigModalProps,
} from './CsvExportConfigModal';

export { ProductionManagerDashboard } from './ProductionManagerDashboard';
