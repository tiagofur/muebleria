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
