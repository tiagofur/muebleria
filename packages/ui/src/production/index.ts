/**
 * Production workspace UI (F038 + PROD-0.1 / PROD-0.3).
 */

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
  CsvExportConfigModal,
  type CsvExportConfigModalProps,
} from './CsvExportConfigModal';

