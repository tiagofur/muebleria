/**
 * SalesDashboard — powerful sales analytics for vendedor / gerente_ventas roles.
 *
 * Monthly stats, pipeline, client rankings, and project list.
 * Vendedor sees only own projects; gerente_ventas/admin sees all with filters.
 *
 * docs/roadmap-screens/01-ventas.md
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  DollarSign,
  FileText,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';

import { formatMoneyDisplay, EmptyState, PageHeader, PageToolbar } from '../common';
import {
  formatIsoDate,
  projectStatusLabel,
  projectStatusBadgeClass,
} from '../projects/projectHelpers';
import {
  daysSince,
  getSalePrice,
  isCancelled,
  isClosed,
  isCurrentMonth,
  isOpen,
  monthlyActivity,
  type ClientRanking,
  type MonthlyStats,
  type ProjectWithCustomer,
  type SalesAlert,
  type SalesProjectRow,
  type StatusStats,
  type VendedorOption,
} from './components/salesDashboardHelpers';
import { MonthlyStatsSection } from './components/MonthlyStatsSection';
import { MonthlyActivityChart } from './components/MonthlyActivityChart';
import { ClientRankingTable } from './components/ClientRankingTable';
import { PipelineBar } from './components/PipelineBar';
import { AlertsSection } from './components/AlertsSection';
import { VendedorFilter } from './components/VendedorFilter';
import './sales.css';

export { monthlyActivity };

export function SalesDashboard({
  projects,
  onOpenProject,
  onCancelProject,
  isVendedor = false,
  currentUserId,
  vendedores = [],
  ownerLabels = {},
}: {
  /** All projects (already role-filtered by caller). */
  readonly projects: readonly ProjectWithCustomer[];
  /** Called when user clicks a project row. */
  readonly onOpenProject: (projectId: string) => void;
  /** True when current user is vendedor (shows own stats only). */
  readonly isVendedor?: boolean;
  /** Current user id (for vendedor filtering). */
  readonly currentUserId?: string;
  /** List of vendedores for filter dropdown (gerente_ventas/admin only). */
  readonly vendedores?: readonly VendedorOption[];
  /** Map of userId -> display name. */
  readonly ownerLabels?: Record<string, string>;
  /** Called when user explicitly cancels a project (sets cancelledAt). */
  readonly onCancelProject?: (projectId: string) => void;
}): ReactNode {
  const [selectedVendedor, setSelectedVendedor] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  // For vendedor: always filter to their projects
  // For gerente_ventas/admin: use filter or show all
  const effectiveVendedorId = isVendedor ? currentUserId : selectedVendedor;

  // Filter projects by vendedor if selected
  const filteredProjects = useMemo(() => {
    if (!effectiveVendedorId) return projects;
    return projects.filter((p) => p.ownerUserId === effectiveVendedorId);
  }, [projects, effectiveVendedorId]);

  // Get selected vendedor name for display
  const selectedVendedorName = useMemo(() => {
    if (!effectiveVendedorId) return null;
    return ownerLabels[effectiveVendedorId] ?? vendedores.find((v) => v.id === effectiveVendedorId)?.name ?? null;
  }, [effectiveVendedorId, ownerLabels, vendedores]);

  /* Monthly + total stats */
  const stats = useMemo((): MonthlyStats => {
    const empty: StatusStats = { count: 0, totalValue: 0 };

    const result: MonthlyStats = {
      mesActual: {
        cotizaciones: { ...empty },
        abiertas: { ...empty },
        cerradas: { ...empty },
        canceladas: { ...empty },
        instaladas: { ...empty },
      },
      total: {
        cotizaciones: { ...empty },
        abiertas: { ...empty },
        cerradas: { ...empty },
        canceladas: { ...empty },
        instaladas: { ...empty },
      },
    };

    for (const p of filteredProjects) {
      const price = getSalePrice(p) ?? 0;
      const current = isCurrentMonth(p.createdAt);

      if (p.status === 'draft' || p.status === 'quoted') {
        result.total.cotizaciones.count++;
        result.total.cotizaciones.totalValue += price;
        if (current) {
          result.mesActual.cotizaciones.count++;
          result.mesActual.cotizaciones.totalValue += price;
        }
      }

      if (isOpen(p)) {
        result.total.abiertas.count++;
        result.total.abiertas.totalValue += price;
        if (current) {
          result.mesActual.abiertas.count++;
          result.mesActual.abiertas.totalValue += price;
        }
      }

      if (isClosed(p)) {
        result.total.cerradas.count++;
        result.total.cerradas.totalValue += price;
        if (current) {
          result.mesActual.cerradas.count++;
          result.mesActual.cerradas.totalValue += price;
        }
      }

      if (isCancelled(p)) {
        result.total.canceladas.count++;
        result.total.canceladas.totalValue += price;
        if (current) {
          result.mesActual.canceladas.count++;
          result.mesActual.canceladas.totalValue += price;
        }
      }

      if (
        p.technicalStatus === 'installed' ||
        p.technicalStatus === 'completed'
      ) {
        result.total.instaladas.count++;
        result.total.instaladas.totalValue += price;
        if (current) {
          result.mesActual.instaladas.count++;
          result.mesActual.instaladas.totalValue += price;
        }
      }
    }

    return result;
  }, [filteredProjects]);

  /* Client rankings */
  const clientRankings = useMemo((): ClientRanking[] => {
    const map = new Map<string, ClientRanking>();

    for (const p of filteredProjects) {
      const key = p.customerId;
      const price = getSalePrice(p) ?? 0;

      if (!map.has(key)) {
        map.set(key, {
          customerId: key,
          customerLabel: p.customerLabel ?? p.customerId,
          totalValue: 0,
          projectCount: 0,
          openCount: 0,
          closedCount: 0,
          cancelledCount: 0,
        });
      }

      const c = map.get(key)!;
      const mutable = { ...c };
      mutable.totalValue += price;
      mutable.projectCount++;
      if (isOpen(p)) mutable.openCount++;
      if (isClosed(p)) mutable.closedCount++;
      if (isCancelled(p)) mutable.cancelledCount++;
      map.set(key, mutable);
    }

    return Array.from(map.values());
  }, [filteredProjects]);

  /* Alerts */
  const alerts = useMemo((): SalesAlert[] => {
    const result: SalesAlert[] = [];

    for (const p of filteredProjects) {
      if (p.status === 'quoted' && daysSince(p.updatedAt) > 7) {
        result.push({
          type: 'old_quote',
          projectId: p.id,
          message: `"${p.name}" — cotización sin respuesta (${daysSince(p.updatedAt)} días)`,
        });
      }

      if (p.status === 'produced' && daysSince(p.updatedAt) > 30) {
        result.push({
          type: 'slow_project',
          projectId: p.id,
          message: `"${p.name}" — más de 30 días en fábrica`,
        });
      }
    }

    return result;
  }, [filteredProjects]);

  /* Project list */
  const rows = useMemo((): SalesProjectRow[] => {
    return filteredProjects
      .map((p) => ({
        project: p,
        customerLabel: p.customerLabel ?? '',
        salePrice: getSalePrice(p),
        ownerLabel: ownerLabels[p.ownerUserId ?? ''] ?? '',
      }))
      .sort((a, b) => {
        const aOpen = isOpen(a.project) ? 0 : 1;
        const bOpen = isOpen(b.project) ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return (
          new Date(b.project.updatedAt).getTime() -
          new Date(a.project.updatedAt).getTime()
        );
      });
  }, [filteredProjects, ownerLabels]);

  /* Total pipeline value */
  const totalValue = stats.total.abiertas.totalValue + stats.total.cerradas.totalValue;

  /* Monthly activity follows the active vendedor filter. */
  const monthlyChartData = useMemo(
    () => monthlyActivity(filteredProjects),
    [filteredProjects],
  );

  if (projects.length === 0) {
    return (
      <section className="sales-dashboard" aria-label="Dashboard de Ventas">
        <EmptyState
          icon={TrendingUp}
          title="Sin proyectos"
          description="No hay proyectos disponibles para mostrar."
        />
      </section>
    );
  }

  return (
    <section className="sales-dashboard" aria-label="Dashboard de Ventas">
      <PageHeader
        title="Dashboard de Ventas"
        subtitle={
          <>
            {isVendedor
              ? 'Tus estadísticas y proyectos del mes.'
              : 'Pipeline comercial y estadísticas del equipo.'}
            {selectedVendedorName ? (
              <span className="sales-dashboard__filter-badge">
                — {selectedVendedorName}
              </span>
            ) : null}
          </>
        }
        icon={<TrendingUp size={16} strokeWidth={1.5} />}
        contextualControls={
          totalValue > 0 ? (
            <div className="sales-dashboard__total">
              <span className="sales-dashboard__total-label">Pipeline total</span>
              <span className="sales-dashboard__total-value">
                {formatMoneyDisplay(totalValue)}
              </span>
            </div>
          ) : undefined
        }
      />

      {/* Vendedor filter (gerente_ventas/admin only) */}
      {!isVendedor && vendedores.length > 0 ? (
        <PageToolbar
          ariaLabel="Filtrar dashboard de ventas"
          filters={
            <VendedorFilter
              vendedores={vendedores}
              selectedId={selectedVendedor}
              onChange={setSelectedVendedor}
            />
          }
        />
      ) : null}

      {/* Monthly + total stats */}
      <MonthlyStatsSection
        stats={stats}
        title={selectedVendedorName ? `Estadísticas de ${selectedVendedorName}` : 'Resumen de Ventas'}
      />

      {/* Pipeline bar */}
      <PipelineBar
        abiertas={stats.total.abiertas}
        cerradas={stats.total.cerradas}
        canceladas={stats.total.canceladas}
      />

      {/* Monthly activity chart (Fase 4.2) */}
      <MonthlyActivityChart data={monthlyChartData} />

      {/* Client rankings */}
      <div className="sales-rankings">
        <ClientRankingTable
          title="Top clientes por valor"
          icon={DollarSign}
          clients={clientRankings}
          valueField="totalValue"
        />
        <ClientRankingTable
          title="Top clientes por proyectos"
          icon={FileText}
          clients={clientRankings}
          valueField="projectCount"
        />
        <ClientRankingTable
          title="Clientes con más abiertos"
          icon={Target}
          clients={clientRankings.filter((c) => c.openCount > 0)}
          valueField="openCount"
        />
        <ClientRankingTable
          title="Clientes con más cancelados"
          icon={XCircle}
          clients={clientRankings.filter((c) => c.cancelledCount > 0)}
          valueField="cancelledCount"
        />
      </div>

      {/* Project list */}
      <div className="sales-list">
        <h3 className="sales-section-title">
          <FileText size={16} strokeWidth={1.5} />
          {isVendedor ? 'Mis proyectos' : selectedVendedorName ? `Proyectos de ${selectedVendedorName}` : 'Todos los proyectos'}
        </h3>
        <ul className="sales-list__items">
          {rows.map((row) => (
            <li key={row.project.id} className="sales-list__row">
              <button
                type="button"
                className="sales-list__link"
                onClick={() => onOpenProject(row.project.id)}
              >
                <div className="sales-list__main">
                  <span className="sales-list__name">{row.project.name}</span>
                  <div className="sales-list__meta-row">
                    {row.customerLabel ? (
                      <span className="sales-list__customer">{row.customerLabel}</span>
                    ) : null}
                    {!isVendedor && !selectedVendedor && row.ownerLabel ? (
                      <span className="sales-list__owner">· {row.ownerLabel}</span>
                    ) : null}
                  </div>
                </div>
                <div className="sales-list__meta">
                  {row.salePrice !== null ? (
                    <span className="sales-list__price">
                      {formatMoneyDisplay(row.salePrice, { currency: row.project.currency })}
                    </span>
                  ) : null}
                  <span className={`status-badge ${projectStatusBadgeClass(row.project.status)}`}>
                    <span className="status-badge__dot" aria-hidden>
                      ●
                    </span>
                    {projectStatusLabel(row.project.status)}
                  </span>
                  {row.project.cancelledAt ? (
                    <span className="status-badge status-badge--cancelled">
                      <span className="status-badge__dot" aria-hidden>
                        ●
                      </span>
                      Cancelada
                    </span>
                  ) : null}
                  <span className="sales-list__date">
                    {formatIsoDate(row.project.updatedAt)}
                  </span>
                  {onCancelProject && !row.project.cancelledAt && isOpen(row.project) ? (
                    confirmCancelId === row.project.id ? (
                      <span className="sales-list__confirm-cancel">
                        <button
                          type="button"
                          className="btn btn--danger btn--small"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCancelProject(row.project.id);
                            setConfirmCancelId(null);
                          }}
                        >
                          Sí, cancelar
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmCancelId(null);
                          }}
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--ghost btn--small sales-list__cancel-btn"
                        title="Cancelar cotización"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmCancelId(row.project.id);
                        }}
                      >
                        Cancelar
                      </button>
                    )
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Alerts */}
      <AlertsSection alerts={alerts} />
    </section>
  );
}
