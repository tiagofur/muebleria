/**
 * Production workspace shell: queue list OR order hub (PROD-0.1).
 */

import { useMemo, useState, type ReactNode } from 'react';
import type {
  Catalog,
  HardwarePurchaseRow,
  ItemFloorStatus,
  Module,
  NestingImportResult,
  ProductionCutRow,
  Project,
} from '@muebles/domain';
import {
  buildProductionElevations,
  ensureProductionRevision,
  getProductionStaleInfo,
  listProductionSpaceOptions,
  PRODUCTION_SCOPE_ALL,
  projectScopedToProductionSpace,
} from '@muebles/domain';
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
  readonly onExportCutListCsv?: (projectId: string) => void | Promise<void>;
  readonly onMarkProduced: (projectId: string) => void;
  readonly exportBusy?: boolean;
  readonly loading?: boolean;
  readonly cutRowsFor?: ProductionQueueProps['cutRowsFor'];
  /** PROD-0.4 / 1.x / 2.x */
  readonly modules?: readonly Module[];
  readonly catalog3d?: Module3DCatalogInput | null;
  readonly catalog?: Catalog | null;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  readonly hideHardwareCosts?: boolean;
  readonly onImportNesting?: (
    projectId: string,
    nesting: NestingImportResult,
  ) => void;
  readonly canImportNesting?: boolean;
  readonly onSetFloorStatus?: (
    projectId: string,
    itemId: string,
    status: ItemFloorStatus,
  ) => void;
  readonly canSetFloorStatus?: boolean;
  readonly onExportCncPilot?: (projectId: string) => void | Promise<void>;
  readonly onExportAssemblySheets?: (projectId: string) => void | Promise<void>;
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
  onExportCutListCsv,
  onMarkProduced,
  exportBusy = false,
  loading = false,
  cutRowsFor,
  modules = [],
  catalog3d = null,
  catalog = null,
  resolveMediaUrl,
  resolveHardware,
  hideHardwareCosts = false,
  onImportNesting,
  canImportNesting = false,
  onSetFloorStatus,
  canSetFloorStatus = false,
  onExportCncPilot,
  onExportAssemblySheets,
}: ProductionWorkspaceProps): ReactNode {
  const [productionScopeId, setProductionScopeId] =
    useState<string>(PRODUCTION_SCOPE_ALL);

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

    const spaceOptions = listProductionSpaceOptions(orderProject);
    const scopedProject = projectScopedToProductionSpace(
      orderProject,
      productionScopeId,
    );

    // Cut/hardware resolved on full project for export truth; views use scoped.
    // For filtered UI lists, resolve cut rows on scoped project via domain later
    // by filtering cut rows client-side when scope is set.
    const cut = resolveCutRows(orderProject.id);
    const scopedCutRows =
      productionScopeId === PRODUCTION_SCOPE_ALL || !cut.rows
        ? cut.rows
        : cut.rows.filter((r) =>
            scopedProject.items.some(
              (it) =>
                modules.find((m) => m.id === it.moduleId)?.code === r.moduleCode ||
                !r.moduleCode,
            ),
          );

    const readiness = buildProductionOrderReadiness({
      project: scopedProject,
      cutRows: scopedCutRows,
      cutListError: cut.error,
    });
    const hardware = resolveHardware
      ? resolveHardware(orderProject.id)
      : { rows: null as readonly HardwarePurchaseRow[] | null, error: null };
    const elevations = buildProductionElevations(scopedProject, modules);
    // Ensure OP revision exists for plant-ready projects (display only; persist via store on export/floor).
    const projectForHubBase =
      orderProject.status === 'accepted' || orderProject.status === 'produced'
        ? ensureProductionRevision(orderProject, new Date().toISOString())
        : orderProject;
    const projectForHub = {
      ...projectScopedToProductionSpace(projectForHubBase, productionScopeId),
      production: projectForHubBase.production,
    };
    const staleInfo = getProductionStaleInfo(projectForHubBase);

    return (
      <ProductionOrderHub
        project={projectForHub}
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
        onExportCutListCsv={
          onExportCutListCsv
            ? () => onExportCutListCsv(orderProject.id)
            : undefined
        }
        onMarkProduced={
          orderProject.status === 'accepted'
            ? () => onMarkProduced(orderProject.id)
            : undefined
        }
        exportBusy={exportBusy}
        modules={modules}
        cutRows={scopedCutRows}
        cutListError={cut.error}
        hardwareRows={hardware.rows}
        hardwareError={hardware.error}
        catalog3d={catalog3d}
        catalog={catalog}
        resolveMediaUrl={resolveMediaUrl}
        hideHardwareCosts={hideHardwareCosts}
        elevationsAvailable={elevations.walls.length > 0}
        onImportNesting={
          onImportNesting
            ? (nesting) => onImportNesting(orderProject.id, nesting)
            : undefined
        }
        canImportNesting={canImportNesting}
        onSetFloorStatus={
          onSetFloorStatus
            ? (itemId, status) =>
                onSetFloorStatus(orderProject.id, itemId, status)
            : undefined
        }
        canSetFloorStatus={canSetFloorStatus}
        staleInfo={staleInfo}
        onExportCncPilot={
          onExportCncPilot
            ? () => onExportCncPilot(orderProject.id)
            : undefined
        }
        onExportAssemblySheets={
          onExportAssemblySheets
            ? () => onExportAssemblySheets(orderProject.id)
            : undefined
        }
        spaceOptions={spaceOptions}
        productionScopeId={productionScopeId}
        onProductionScopeChange={setProductionScopeId}
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
