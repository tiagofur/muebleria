/**
 * Production workspace shell: queue list OR order hub (PROD-0.1).
 */

import { useMemo, type ReactNode } from 'react';
import type {
  HardwarePurchaseRow,
  Module,
  ProductionCutRow,
  Project,
} from '@muebles/domain';
import { buildProductionElevations } from '@muebles/domain';
import { EmptyState } from '../common';
import { Factory } from 'lucide-react';
import { ProductionQueue, type ProductionQueueProps } from './ProductionQueue';
import { ProductionOrderHub } from './ProductionOrderHub';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import {
  buildProductionOrderReadiness,
  projectAllowsProductionOrder,
  type ProductionOrderTab,
} from './productionOrderModel';

export type ProductionWorkspaceProps = {
  readonly projects: readonly Project[];
  /** When set, shows hub for this project id. */
  readonly orderProjectId: string | null;
  readonly orderTab: ProductionOrderTab;
  readonly onOrderTabChange: (tab: ProductionOrderTab) => void;
  readonly onOpenOrder: (projectId: string) => void;
  readonly onBackToQueue: () => void;
  readonly onOpenDesign: (projectId: string) => void;
  readonly customerLabelFor: (customerId: string) => string;
  readonly salePriceFor: (projectId: string) => number | null;
  /**
   * Resolve cut rows for readiness. Return null on domain failure
   * (optional error message via second form).
   */
  readonly resolveCutRows: (projectId: string) => {
    readonly rows: readonly ProductionCutRow[] | null;
    readonly error?: string | null;
  };
  readonly resolveHardware?: (projectId: string) => {
    readonly rows: readonly HardwarePurchaseRow[] | null;
    readonly error?: string | null;
  };
  readonly onExportOptimizer: (projectId: string) => void | Promise<void>;
  readonly onExportHardware: (projectId: string) => void | Promise<void>;
  readonly onExportPieceLabels?: (projectId: string) => void | Promise<void>;
  readonly onExportProductionPack?: (projectId: string) => void | Promise<void>;
  readonly onExportElevations?: (projectId: string) => void | Promise<void>;
  readonly onMarkProduced: (projectId: string) => void;
  readonly exportBusy?: boolean;
  readonly loading?: boolean;
  readonly cutRowsFor?: ProductionQueueProps['cutRowsFor'];
  /** PROD-0.4 / 1.x */
  readonly modules?: readonly Module[];
  readonly catalog3d?: Module3DCatalogInput | null;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  readonly hideHardwareCosts?: boolean;
};

export function ProductionWorkspace({
  projects,
  orderProjectId,
  orderTab,
  onOrderTabChange,
  onOpenOrder,
  onBackToQueue,
  onOpenDesign,
  customerLabelFor,
  salePriceFor,
  resolveCutRows,
  onExportOptimizer,
  onExportHardware,
  onExportPieceLabels,
  onExportProductionPack,
  onExportElevations,
  onMarkProduced,
  exportBusy = false,
  loading = false,
  cutRowsFor,
  modules = [],
  catalog3d = null,
  resolveMediaUrl,
  resolveHardware,
  hideHardwareCosts = false,
}: ProductionWorkspaceProps): ReactNode {
  const orderProject = useMemo(() => {
    if (!orderProjectId) return null;
    return projects.find((p) => p.id === orderProjectId) ?? null;
  }, [orderProjectId, projects]);

  if (orderProjectId) {
    if (!orderProject) {
      return (
        <section className="prod-hub" data-testid="prod-order-missing">
          <EmptyState
            variant="empty"
            icon={Factory}
            title="Orden no encontrada"
            description="Esa obra no está en la cola de producción o no tenés acceso."
            actionLabel="Volver a la cola"
            onAction={onBackToQueue}
          />
        </section>
      );
    }

    if (!projectAllowsProductionOrder(orderProject)) {
      return (
        <section className="prod-hub" data-testid="prod-order-not-ready">
          <EmptyState
            variant="empty"
            icon={Factory}
            title="Aún no está en fábrica"
            description="La orden de producción se habilita cuando la cotización está aceptada o ya en planta."
            actionLabel="Ver cotización / diseño"
            onAction={() => onOpenDesign(orderProject.id)}
            secondaryActionLabel="Volver a la cola"
            onSecondaryAction={onBackToQueue}
          />
        </section>
      );
    }

    const cut = resolveCutRows(orderProject.id);
    const readiness = buildProductionOrderReadiness({
      project: orderProject,
      cutRows: cut.rows,
      cutListError: cut.error,
    });
    const hardware = resolveHardware
      ? resolveHardware(orderProject.id)
      : { rows: null as readonly HardwarePurchaseRow[] | null, error: null };
    const elevations = buildProductionElevations(orderProject, modules);

    return (
      <ProductionOrderHub
        project={orderProject}
        customerLabel={customerLabelFor(orderProject.customerId)}
        salePrice={salePriceFor(orderProject.id)}
        readiness={readiness}
        activeTab={orderTab}
        onTabChange={onOrderTabChange}
        onBackToQueue={onBackToQueue}
        onOpenDesign={() => onOpenDesign(orderProject.id)}
        onExportOptimizer={() => onExportOptimizer(orderProject.id)}
        onExportHardware={() => onExportHardware(orderProject.id)}
        onExportPieceLabels={
          onExportPieceLabels
            ? () => onExportPieceLabels(orderProject.id)
            : undefined
        }
        onExportProductionPack={
          onExportProductionPack
            ? () => onExportProductionPack(orderProject.id)
            : undefined
        }
        onExportElevations={
          onExportElevations
            ? () => onExportElevations(orderProject.id)
            : undefined
        }
        onMarkProduced={
          orderProject.status === 'accepted'
            ? () => onMarkProduced(orderProject.id)
            : undefined
        }
        exportBusy={exportBusy}
        modules={modules}
        cutRows={cut.rows}
        cutListError={cut.error}
        hardwareRows={hardware.rows}
        hardwareError={hardware.error}
        catalog3d={catalog3d}
        resolveMediaUrl={resolveMediaUrl}
        hideHardwareCosts={hideHardwareCosts}
        elevationsAvailable={elevations.walls.length > 0}
      />
    );
  }

  return (
    <ProductionQueue
      projects={projects}
      customerLabelFor={customerLabelFor}
      salePriceFor={salePriceFor}
      onOpenOrder={onOpenOrder}
      onExportOptimizer={onExportOptimizer}
      onExportHardware={onExportHardware}
      onExportPieceLabels={onExportPieceLabels}
      onExportProductionPack={onExportProductionPack}
      onMarkProduced={onMarkProduced}
      exportBusy={exportBusy}
      loading={loading}
      cutRowsFor={cutRowsFor}
    />
  );
}
