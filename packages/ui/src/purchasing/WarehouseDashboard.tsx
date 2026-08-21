/**
 * WarehouseDashboard — Analytics, material demand, stock health and picking overview.
 *
 * Dedicated dashboard for warehouse operators, purchasing managers and supervisors
 * (admin, almacen, gerente_produccion) following design.md §5.4.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleDashed,
  Layers,
  LayoutDashboard,
  PackageCheck,
  Ruler,
  ShoppingCart,
  Warehouse,
  Wrench,
} from 'lucide-react';
import {
  computeWarehouseDashboardStats,
  type MaterialStock,
  type PurchaseOrder,
  type ProjectPickingState,
  type PickingStatus,
  type WarehouseProjectInput,
} from '@muebles/domain';
import { EmptyState, PageHeader, PageToolbar, SearchInput, StatusChips } from '../common';
import './purchasing.css';

export type WarehouseDashboardProps = {
  /** Active projects in warehouse (accepted/produced). */
  readonly projects: readonly WarehouseProjectInput[];
  /** Current material stock items. */
  readonly stock?: readonly MaterialStock[] | null;
  /** Active and historical purchase orders. */
  readonly purchaseOrders?: readonly PurchaseOrder[] | null;
  /** Persisted picking states. */
  readonly initialPicking?: readonly ProjectPickingState[] | Record<string, PickingStatus> | null;
  /** Navigate to operational warehouse queue / picking workspace. */
  readonly onOpenQueue?: () => void;
  /** Open a specific project in the warehouse picking workspace. */
  readonly onOpenProject?: (projectId: string) => void;
  /** Resolved catalog label dictionary for materials. */
  readonly materialLabels?: Readonly<Record<string, string>>;
};

type PickingFilterOption = 'all' | 'pending' | 'complete';

const PICKING_FILTER_OPTIONS: readonly { readonly value: PickingFilterOption; readonly label: string }[] = [
  { value: 'all', label: 'Todos los proyectos' },
  { value: 'pending', label: 'Pendientes de despacho' },
  { value: 'complete', label: 'Despacho completo' },
];

export function WarehouseDashboard({
  projects,
  stock = null,
  purchaseOrders = null,
  initialPicking = null,
  onOpenQueue,
  onOpenProject,
  materialLabels = {},
}: WarehouseDashboardProps): ReactNode {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PickingFilterOption>('all');

  // Pure domain analytics
  const stats = useMemo(
    () => computeWarehouseDashboardStats(projects, stock, purchaseOrders, initialPicking),
    [projects, stock, purchaseOrders, initialPicking],
  );

  // Filtered projects list for table
  const filteredProjects = useMemo(() => {
    let list = stats.projects;
    if (statusFilter === 'pending') {
      list = list.filter((p) => !p.isFullyPicked);
    } else if (statusFilter === 'complete') {
      list = list.filter((p) => p.isFullyPicked);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.projectName.toLowerCase().includes(q) ||
          (p.customerLabel ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [stats.projects, statusFilter, search]);

  const resolveMaterialName = (id: string) => materialLabels[id] || id;

  return (
    <section className="warehouse-dashboard" aria-label="Dashboard de Almacén" data-testid="warehouse-dashboard">
      <PageHeader
        title="Dashboard de Almacén y Compras"
        subtitle="Métricas de picking, demanda agregada de materiales, salud de inventario y órdenes de compra."
        icon={<Warehouse size={16} strokeWidth={1.5} />}
        secondaryActions={
          onOpenQueue ? (
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={onOpenQueue}
              data-testid="wh-dash-goto-queue"
            >
              <PackageCheck size={14} strokeWidth={1.5} />
              Ir a Almacén / Picking
            </button>
          ) : undefined
        }
      />

      <PageToolbar
        ariaLabel="Filtros del dashboard de almacén"
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por obra o cliente..."
            aria-label="Buscar en proyectos de almacén"
          />
        }
        filters={
          <StatusChips<PickingFilterOption>
            value={statusFilter}
            onChange={setStatusFilter}
            options={PICKING_FILTER_OPTIONS}
            aria-label="Filtrar por estado de despacho"
            data-testid="wh-status-chips"
          />
        }
      />

      {/* Main KPI Stat Cards */}
      <div className="warehouse-dashboard__stats">
        <div className="stat-card stat-card--warehouse" data-testid="wh-stat-projects">
          <span className="stat-card__icon">
            <Warehouse size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.totalProjects}</span>
            <span className="stat-card__label">Proyectos en Almacén</span>
            <span className="stat-card__subtext">
              {stats.pendingPickingProjects} pendientes · {stats.fullyPickedProjects} completos
            </span>
          </div>
        </div>

        <div className="stat-card stat-card--warehouse" data-testid="wh-stat-boards">
          <span className="stat-card__icon">
            <Layers size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.totalBoardAreaM2} m²</span>
            <span className="stat-card__label">Demanda de Tableros</span>
            <span className="stat-card__subtext">
              {stats.boardAreaOrigin === 'proxy' ? 'Área estimada (~2.8 m²/mód)' : 'Área neta calculada'}
            </span>
          </div>
        </div>

        <div className="stat-card stat-card--warehouse" data-testid="wh-stat-edges">
          <span className="stat-card__icon">
            <Ruler size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.totalEdgeLengthMl} ml</span>
            <span className="stat-card__label">Demanda de Cintillas</span>
            <span className="stat-card__subtext">
              {stats.edgeLengthOrigin === 'proxy' ? 'Metros lineales estimados (~14 ml/mód)' : 'Metros lineales calculados'}
            </span>
          </div>
        </div>

        <div
          className={`stat-card ${stats.stockAlerts.length > 0 ? 'stat-card--danger' : 'stat-card--warehouse'}`}
          data-testid="wh-stat-stock"
        >
          <span className="stat-card__icon">
            <AlertTriangle size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.stockAlerts.length}</span>
            <span className="stat-card__label">Alertas de Inventario</span>
            <span className="stat-card__subtext">
              {stats.stockOutCount} agotados · {stats.stockLowCount} bajo mínimo
            </span>
          </div>
        </div>
      </div>

      {/* Stock Health & POs Summary Panels */}
      <div className="warehouse-dashboard__panels-grid">
        {/* POs Summary */}
        <section className="warehouse-dashboard__panel" aria-label="Resumen de Órdenes de Compra">
          <div className="warehouse-dashboard__panel-header">
            <span className="warehouse-dashboard__panel-icon">
              <ShoppingCart size={16} strokeWidth={1.5} />
            </span>
            <h3 className="warehouse-dashboard__panel-title">Órdenes de Compra</h3>
          </div>
          <div className="warehouse-dashboard__po-grid">
            <div className="warehouse-dashboard__po-item">
              <span className="warehouse-dashboard__po-value">{stats.poDraftCount}</span>
              <span className="warehouse-dashboard__po-label">Borradores</span>
            </div>
            <div className="warehouse-dashboard__po-item">
              <span className="warehouse-dashboard__po-value">{stats.poEmittedCount}</span>
              <span className="warehouse-dashboard__po-label">Emitidas / En curso</span>
            </div>
            <div className="warehouse-dashboard__po-item">
              <span className="warehouse-dashboard__po-value">{stats.poReceivedCount}</span>
              <span className="warehouse-dashboard__po-label">Recibidas</span>
            </div>
            <div className="warehouse-dashboard__po-item">
              <span className="warehouse-dashboard__po-value">{stats.poTotalCount}</span>
              <span className="warehouse-dashboard__po-label">Total Órdenes</span>
            </div>
          </div>
        </section>

        {/* Stock Health Breakdown */}
        <section className="warehouse-dashboard__panel" aria-label="Salud del Inventario">
          <div className="warehouse-dashboard__panel-header">
            <span className="warehouse-dashboard__panel-icon">
              <Boxes size={16} strokeWidth={1.5} />
            </span>
            <h3 className="warehouse-dashboard__panel-title">Salud del Inventario</h3>
          </div>
          <div className="warehouse-dashboard__stock-health">
            <div className="warehouse-dashboard__stock-bar">
              <div
                className="warehouse-dashboard__stock-bar-segment warehouse-dashboard__stock-bar-segment--ok"
                style={{
                  width: stats.stockTotalItems > 0 ? `${(stats.stockOkCount / stats.stockTotalItems) * 100}%` : '0%',
                }}
                title={`OK: ${stats.stockOkCount}`}
              />
              <div
                className="warehouse-dashboard__stock-bar-segment warehouse-dashboard__stock-bar-segment--low"
                style={{
                  width: stats.stockTotalItems > 0 ? `${(stats.stockLowCount / stats.stockTotalItems) * 100}%` : '0%',
                }}
                title={`Bajo mínimo: ${stats.stockLowCount}`}
              />
              <div
                className="warehouse-dashboard__stock-bar-segment warehouse-dashboard__stock-bar-segment--out"
                style={{
                  width: stats.stockTotalItems > 0 ? `${(stats.stockOutCount / stats.stockTotalItems) * 100}%` : '0%',
                }}
                title={`Agotado: ${stats.stockOutCount}`}
              />
            </div>
            <div className="warehouse-dashboard__stock-legend">
              <span className="warehouse-dashboard__stock-legend-item">
                <span className="warehouse-dashboard__stock-dot warehouse-dashboard__stock-dot--ok" />
                {stats.stockOkCount} Normal
              </span>
              <span className="warehouse-dashboard__stock-legend-item">
                <span className="warehouse-dashboard__stock-dot warehouse-dashboard__stock-dot--low" />
                {stats.stockLowCount} Bajo mínimo
              </span>
              <span className="warehouse-dashboard__stock-legend-item">
                <span className="warehouse-dashboard__stock-dot warehouse-dashboard__stock-dot--out" />
                {stats.stockOutCount} Agotado
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Critical Stock Alerts */}
      {stats.stockAlerts.length > 0 ? (
        <section className="warehouse-dashboard__alerts-section" aria-label="Alertas de reposición" data-testid="wh-stock-alerts">
          <div className="warehouse-dashboard__alerts-header">
            <AlertTriangle className="warehouse-dashboard__alert-icon" size={18} strokeWidth={1.5} />
            <h3 className="warehouse-dashboard__alerts-title">
              Materiales que requieren reposición ({stats.stockAlerts.length})
            </h3>
          </div>
          <ul className="warehouse-dashboard__alerts-list">
            {stats.stockAlerts.map((alert) => (
              <li
                key={`${alert.kind}-${alert.materialId}`}
                className="warehouse-dashboard__alert-item"
                data-testid={`wh-stock-alert-${alert.materialId}`}
              >
                <div className="warehouse-dashboard__alert-info">
                  <span className="warehouse-dashboard__alert-name">
                    {resolveMaterialName(alert.materialId)}
                  </span>
                  <span className="warehouse-dashboard__alert-kind">
                    {alert.kind}
                  </span>
                  <span
                    className={`warehouse-dashboard__alert-badge warehouse-dashboard__alert-badge--${alert.status}`}
                  >
                    {alert.status === 'agotado' ? 'Agotado (0)' : `Bajo stock (${alert.currentQuantity}/${alert.minStock})`}
                  </span>
                </div>
                <span className="warehouse-dashboard__alert-deficit">
                  Déficit: {alert.deficit} unidades
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Projects Table */}
      <section className="warehouse-dashboard__panel" aria-label="Proyectos y avance de picking">
        <div className="warehouse-dashboard__panel-header">
          <h3 className="warehouse-dashboard__panel-title">
            Proyectos en Almacén ({filteredProjects.length})
          </h3>
        </div>

        {filteredProjects.length === 0 ? (
          <EmptyState
            icon={Warehouse}
            title="No se encontraron proyectos"
            description="No hay proyectos que coincidan con los filtros aplicados."
          />
        ) : (
          <div className="table-wrapper">
            <table className="table" data-testid="wh-projects-table">
              <thead>
                <tr>
                  <th>Obra / Proyecto</th>
                  <th>Herrajes</th>
                  <th>Tableros</th>
                  <th>Cintillas</th>
                  <th>Material Completo</th>
                  <th className="table__cell--numeric">Días</th>
                  <th className="table__cell--actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((p) => (
                  <tr key={p.projectId} data-testid={`wh-project-row-${p.projectId}`}>
                    <td>
                      <div className="warehouse-dashboard__project-name-cell">
                        <span className="warehouse-dashboard__project-name">{p.projectName}</span>
                        {p.customerLabel ? (
                          <span className="warehouse-dashboard__project-customer">{p.customerLabel}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`status-badge status-badge--${p.hardwareStatus === 'despachado' ? 'done' : 'open'}`}
                      >
                        {p.hardwareStatus === 'despachado' ? (
                          <>
                            <CheckCircle2 size={11} strokeWidth={1.5} /> Despachado
                          </>
                        ) : (
                          <>
                            <CircleDashed size={11} strokeWidth={1.5} /> Pendiente
                          </>
                        )}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-badge status-badge--${p.tablerosStatus === 'despachado' ? 'done' : 'open'}`}
                      >
                        {p.tablerosStatus === 'despachado' ? (
                          <>
                            <CheckCircle2 size={11} strokeWidth={1.5} /> Despachado
                          </>
                        ) : (
                          <>
                            <CircleDashed size={11} strokeWidth={1.5} /> Pendiente
                          </>
                        )}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-badge status-badge--${p.cintillasStatus === 'despachado' ? 'done' : 'open'}`}
                      >
                        {p.cintillasStatus === 'despachado' ? (
                          <>
                            <CheckCircle2 size={11} strokeWidth={1.5} /> Despachado
                          </>
                        ) : (
                          <>
                            <CircleDashed size={11} strokeWidth={1.5} /> Pendiente
                          </>
                        )}
                      </span>
                    </td>
                    <td>
                      {p.materialsRelease ? (
                        <span className="status-badge status-badge--done">
                          <PackageCheck size={11} strokeWidth={1.5} /> Liberado
                        </span>
                      ) : (
                        <span className="status-badge status-badge--neutral">
                          En preparación
                        </span>
                      )}
                    </td>
                    <td className="table__cell--numeric">
                      {p.daysInWarehouse != null ? `${p.daysInWarehouse} d` : '—'}
                    </td>
                    <td className="table__cell--actions">
                      {onOpenProject ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--small"
                          onClick={() => onOpenProject(p.projectId)}
                          data-testid={`wh-open-project-${p.projectId}`}
                        >
                          Ver picking
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
