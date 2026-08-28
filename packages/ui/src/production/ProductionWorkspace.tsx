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
  PieceLabel,
  ModuleLabel,
  ProductionCutRow,
  Project,
} from '@granete/domain';
import {
  buildProductionElevations,
  ensureProductionRevision,
  generateCutRows,
  generateHardwareList,
  generatePieceLabels,
  generateModuleLabels,
  getProductionStaleInfo,
  listProductionSpaceOptions,
  PRODUCTION_SCOPE_ALL,
  projectScopedToProductionSpace,
} from '@granete/domain';
import { EmptyState } from '../common';
import { Factory } from 'lucide-react';
import { ProductionQueue, type ProductionQueueProps } from './ProductionQueue';
import { ProductionOrderHub } from './ProductionOrderHub';
import type { FabricActiveClaim } from './fabricProjectCards';
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
  /** Etiquetas tab / labels PDF — hub passes scoped labels + copy mode. */
  readonly onExportPieceLabels?: (
    projectId: string,
    labels: readonly PieceLabel[],
    options: { readonly perUnit: boolean },
  ) => void | Promise<void>;
  readonly onExportModuleLabels?: (
    projectId: string,
    labels: readonly ModuleLabel[],
  ) => void | Promise<void>;
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
  /** Active cutting/floor claims — used to filter the "Ya en producción" queue. */
  readonly activeClaims?: readonly FabricActiveClaim[];
  /**
   * P0-2c (pre-demo audit): resolves an order id against the UNFILTERED
   * project list. An accepted project without materialsRelease is filtered
   * out of the queue; without this lookup the order screen dead-ended with
   * "Orden no encontrada" instead of explaining the missing warehouse
   * release step.
   */
  readonly lookupProject?: (projectId: string) => Project | undefined;
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
  onExportModuleLabels,
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
  activeClaims = [],
  lookupProject,
}: ProductionWorkspaceProps): ReactNode {
  const [productionScopeId, setProductionScopeId] =
    useState<string>(PRODUCTION_SCOPE_ALL);

  const orderProject = useMemo(() => {
    if (!orderProjectId) return null;
    return projects.find((p) => p.id === orderProjectId) ?? null;
  }, [orderProjectId, projects]);

  if (orderProjectId) {
    if (!orderProject) {
      // P0-2c: the queue filter (isProductionReady) hides accepted projects
      // without materialsRelease and non-accepted ones. Resolve the id
      // against the unfiltered list and explain the real next step instead
      // of claiming the order does not exist.
      const unfiltered = lookupProject?.(orderProjectId);
      if (unfiltered && projectAllowsProductionOrder(unfiltered)) {
        return (
          <section className="prod-hub" data-testid="prod-order-pending-release">
            <EmptyState
              variant="empty"
              icon={Factory}
              title="Falta liberar materiales"
              description="La cotización está aceptada, pero Almacén todavía no liberó los materiales al piso. Liberá los materiales para que la obra entre a la cola de producción."
              actionLabel="Ver cotización"
              onAction={() => onOpenDesign(unfiltered.id)}
              secondaryActionLabel="Volver a la cola"
              onSecondaryAction={onBackToQueue}
            />
          </section>
        );
      }
      if (unfiltered && !projectAllowsProductionOrder(unfiltered)) {
        return (
          <section className="prod-hub" data-testid="prod-order-not-ready">
            <EmptyState
              variant="empty"
              icon={Factory}
              title="Aún no está en fábrica"
              description="La orden de producción se habilita cuando la cotización está aceptada o ya en producción."
              actionLabel="Ver cotización / diseño"
              onAction={() => onOpenDesign(unfiltered.id)}
              secondaryActionLabel="Volver a la cola"
              onSecondaryAction={onBackToQueue}
            />
          </section>
        );
      }
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
            description="La orden de producción se habilita cuando la cotización está aceptada o ya en producción."
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

    // Full-project cut for export readiness path; scoped UI recomputes from items.
    const cut = resolveCutRows(orderProject.id);
    let scopedCutRows = cut.rows;
    let scopedCutError = cut.error;
    if (
      productionScopeId !== PRODUCTION_SCOPE_ALL &&
      catalog &&
      scopedProject.items.length >= 0
    ) {
      try {
        scopedCutRows = generateCutRows(scopedProject, catalog);
        scopedCutError = null;
      } catch (err) {
        scopedCutRows = null;
        scopedCutError =
          err instanceof Error ? err.message : 'Error al resolver despiece';
      }
    }

    const readiness = buildProductionOrderReadiness({
      project: scopedProject,
      cutRows: scopedCutRows,
      cutListError: scopedCutError,
    });
    let hardware: {
      readonly rows: readonly HardwarePurchaseRow[] | null;
      readonly error?: string | null;
    } = resolveHardware
      ? resolveHardware(orderProject.id)
      : { rows: null, error: null };
    if (productionScopeId !== PRODUCTION_SCOPE_ALL && catalog) {
      try {
        hardware = { rows: generateHardwareList(scopedProject, catalog), error: null };
      } catch (err) {
        hardware = {
          rows: null,
          error:
            err instanceof Error ? err.message : 'Error al resolver herrajes',
        };
      }
    }
    const elevations = buildProductionElevations(scopedProject, modules);
    // Piece labels resolve with the same domain engine the PDF uses — one
    // data source for office PDF and plant ZPL (Etiquetas tab).
    let pieceLabels: readonly PieceLabel[] | null = null;
    let pieceLabelsError: string | null = null;
    let moduleLabels: readonly ModuleLabel[] | null = null;
    let moduleLabelsError: string | null = null;
    if (catalog) {
      try {
        pieceLabels = generatePieceLabels(scopedProject, catalog);
      } catch (err) {
        pieceLabelsError =
          err instanceof Error ? err.message : 'Error al resolver etiquetas de piezas';
      }
      try {
        moduleLabels = generateModuleLabels(scopedProject, catalog, {
          customerName: customerLabelFor(orderProject.customerId),
          revision: orderProject.production?.revision?.toString(),
        });
      } catch (err) {
        moduleLabelsError =
          err instanceof Error ? err.message : 'Error al resolver etiquetas de muebles';
      }
    }
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
        catalog={catalog}
        customerLabel={customerLabelFor(orderProject.customerId)}
        salePrice={salePriceFor(orderProject.id)}
        readiness={readiness}
        activeTab={orderTab}
        onTabChange={onOrderTabChange}
        onBackToQueue={onBackToQueue}
        onOpenDesign={() => onOpenDesign(orderProject.id)}
        onExportOptimizer={() => onExportOptimizer(orderProject.id)}
        onExportHardware={() => onExportHardware(orderProject.id)}
        pieceLabels={pieceLabels}
        pieceLabelsError={pieceLabelsError}
        moduleLabels={moduleLabels}
        moduleLabelsError={moduleLabelsError}
        onExportPieceLabels={
          onExportPieceLabels
            ? (labels, options) =>
                onExportPieceLabels(orderProject.id, labels, {
                  perUnit: options?.perUnit ?? false,
                })
            : undefined
        }
        onExportModuleLabels={
          onExportModuleLabels
            ? (labels) => onExportModuleLabels(orderProject.id, labels)
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
        hideHardwareCosts={hideHardwareCosts}
        elevationsAvailable={
          elevations.walls.length > 0 || elevations.islands.length > 0
        }
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
      onExportProductionPack={onExportProductionPack}
      onMarkProduced={onMarkProduced}
      exportBusy={exportBusy}
      loading={loading}
      cutRowsFor={cutRowsFor}
      activeClaims={activeClaims}
    />
  );
}
