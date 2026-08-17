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
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  DollarSign,
  FileText,
  Filter,
  Target,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react';

import type { Project, ProjectStatus } from '@muebles/domain';
import { formatMoneyDisplay, EmptyState } from '../common';
import {
  formatIsoDate,
  projectStatusLabel,
  projectStatusBadgeClass,
} from '../projects/projectHelpers';
import './sales.css';

/* ── Types ──────────────────────────────────────────────────────────────── */

type ProjectWithCustomer = Project & { readonly customerLabel?: string };

type SalesProjectRow = {
  readonly project: Project;
  readonly customerLabel: string;
  readonly salePrice: number | null;
  readonly ownerLabel: string;
};

type SalesAlert = {
  readonly type: 'old_quote' | 'slow_project';
  readonly projectId: string;
  readonly message: string;
};

type StatusStats = {
  count: number;
  totalValue: number;
};

type MonthlyStats = {
  mesActual: {
    cotizaciones: StatusStats;
    abiertas: StatusStats;
    cerradas: StatusStats;
    canceladas: StatusStats;
  };
  total: {
    cotizaciones: StatusStats;
    abiertas: StatusStats;
    cerradas: StatusStats;
    canceladas: StatusStats;
  };
};

type ClientRanking = {
  readonly customerId: string;
  readonly customerLabel: string;
  readonly totalValue: number;
  readonly projectCount: number;
  readonly openCount: number;
  readonly closedCount: number;
  readonly cancelledCount: number;
};

type VendedorOption = {
  readonly id: string;
  readonly name: string;
};

/* ── Helpers ────────────────────────────────────────────────────────────── */

function getSalePrice(p: Project): number | null {
  return p.priceSnapshot?.breakdown.salePrice ?? null;
}

function daysSince(iso: string): number {
  return Math.floor(
    (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24),
  );
}

function isCurrentMonth(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function isOpen(p: Project): boolean {
  return p.status === 'draft' || p.status === 'quoted' || p.status === 'accepted';
}

function isClosed(p: Project): boolean {
  return p.status === 'produced';
}

function isCancelled(p: Project): boolean {
  return p.status === 'quoted' && daysSince(p.updatedAt) > 30;
}

/* ── Vendedor filter ────────────────────────────────────────────────────── */

function VendedorFilter({
  vendedores,
  selectedId,
  onChange,
}: {
  readonly vendedores: readonly VendedorOption[];
  readonly selectedId: string | null;
  readonly onChange: (id: string | null) => void;
}): ReactNode {
  return (
    <div className="sales-filter">
      <Filter size={14} strokeWidth={1.5} />
      <label className="sales-filter__label" htmlFor="vendedor-filter">
        Vendedor:
      </label>
      <select
        id="vendedor-filter"
        className="sales-filter__select"
        value={selectedId ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Todos los vendedores</option>
        {vendedores.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── Monthly stats component ────────────────────────────────────────────── */

function MonthlyStatsSection({
  stats,
  title,
}: {
  readonly stats: MonthlyStats;
  readonly title: string;
}): ReactNode {
  return (
    <div className="sales-monthly">
      <h3 className="sales-section-title">
        <BarChart3 size={16} strokeWidth={1.5} />
        {title}
      </h3>

      <div className="sales-monthly__grid">
        {/* Mes actual */}
        <div className="sales-monthly__card">
          <h4 className="sales-monthly__card-title">Este mes</h4>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Cotizaciones</span>
            <span className="sales-monthly__value">
              {stats.mesActual.cotizaciones.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.mesActual.cotizaciones.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Abiertas</span>
            <span className="sales-monthly__value sales-monthly__value--open">
              {stats.mesActual.abiertas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.mesActual.abiertas.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Cerradas</span>
            <span className="sales-monthly__value sales-monthly__value--closed">
              {stats.mesActual.cerradas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.mesActual.cerradas.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Canceladas</span>
            <span className="sales-monthly__value sales-monthly__value--cancelled">
              {stats.mesActual.canceladas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.mesActual.canceladas.totalValue)}
            </span>
          </div>
        </div>

        {/* Totales */}
        <div className="sales-monthly__card">
          <h4 className="sales-monthly__card-title">Totales</h4>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Cotizaciones</span>
            <span className="sales-monthly__value">
              {stats.total.cotizaciones.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.total.cotizaciones.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Abiertas</span>
            <span className="sales-monthly__value sales-monthly__value--open">
              {stats.total.abiertas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.total.abiertas.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Cerradas</span>
            <span className="sales-monthly__value sales-monthly__value--closed">
              {stats.total.cerradas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.total.cerradas.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Canceladas</span>
            <span className="sales-monthly__value sales-monthly__value--cancelled">
              {stats.total.canceladas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.total.canceladas.totalValue)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Client ranking table ───────────────────────────────────────────────── */

function ClientRankingTable({
  title,
  icon: Icon,
  clients,
  valueField,
}: {
  readonly title: string;
  readonly icon: typeof Users;
  readonly clients: readonly ClientRanking[];
  readonly valueField: 'totalValue' | 'projectCount' | 'openCount' | 'cancelledCount';
}): ReactNode {
  if (clients.length === 0) return null;

  const sorted = [...clients].sort((a, b) => b[valueField] - a[valueField]);
  const top = sorted.slice(0, 5);

  const formatValue = (c: ClientRanking): string => {
    switch (valueField) {
      case 'totalValue':
        return formatMoneyDisplay(c.totalValue);
      case 'projectCount':
        return `${c.projectCount}`;
      case 'openCount':
        return `${c.openCount}`;
      case 'cancelledCount':
        return `${c.cancelledCount}`;
    }
  };

  return (
    <div className="sales-ranking">
      <h3 className="sales-section-title">
        <Icon size={16} strokeWidth={1.5} />
        {title}
      </h3>
      <ul className="sales-ranking__list">
        {top.map((c, i) => (
          <li key={c.customerId} className="sales-ranking__item">
            <span className="sales-ranking__rank">{i + 1}</span>
            <div className="sales-ranking__info">
              <span className="sales-ranking__name">{c.customerLabel}</span>
              <span className="sales-ranking__detail">
                {c.projectCount} proyectos · {c.openCount} abiertos · {c.closedCount} cerrados
              </span>
            </div>
            <span className="sales-ranking__value">{formatValue(c)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Pipeline bar ───────────────────────────────────────────────────────── */

function PipelineBar({
  abiertas,
  cerradas,
  canceladas,
}: {
  readonly abiertas: StatusStats;
  readonly cerradas: StatusStats;
  readonly canceladas: StatusStats;
}): ReactNode {
  const total = abiertas.count + cerradas.count + canceladas.count;
  if (total === 0) return null;

  return (
    <div className="sales-pipeline" aria-label="Pipeline de ventas">
      <div className="sales-pipeline__bar">
        {abiertas.count > 0 && (
          <div
            className="sales-pipeline__seg sales-pipeline__seg--abiertas"
            style={{ width: `${(abiertas.count / total) * 100}%` }}
            title={`Abiertas: ${abiertas.count}`}
          />
        )}
        {cerradas.count > 0 && (
          <div
            className="sales-pipeline__seg sales-pipeline__seg--cerradas"
            style={{ width: `${(cerradas.count / total) * 100}%` }}
            title={`Cerradas: ${cerradas.count}`}
          />
        )}
        {canceladas.count > 0 && (
          <div
            className="sales-pipeline__seg sales-pipeline__seg--canceladas"
            style={{ width: `${(canceladas.count / total) * 100}%` }}
            title={`Canceladas: ${canceladas.count}`}
          />
        )}
      </div>
      <div className="sales-pipeline__legend">
        <span className="sales-pipeline__legend-item">
          <span className="sales-pipeline__dot sales-pipeline__dot--abiertas" />
          Abiertas ({abiertas.count})
        </span>
        <span className="sales-pipeline__legend-item">
          <span className="sales-pipeline__dot sales-pipeline__dot--cerradas" />
          Cerradas ({cerradas.count})
        </span>
        <span className="sales-pipeline__legend-item">
          <span className="sales-pipeline__dot sales-pipeline__dot--canceladas" />
          Canceladas ({canceladas.count})
        </span>
      </div>
    </div>
  );
}

/* ── Alerts section ─────────────────────────────────────────────────────── */

function AlertsSection({
  alerts,
}: {
  readonly alerts: readonly SalesAlert[];
}): ReactNode {
  if (alerts.length === 0) return null;

  return (
    <div className="sales-alerts">
      <h3 className="sales-alerts__title">
        <AlertTriangle size={16} strokeWidth={1.5} />
        Alertas
      </h3>
      <ul className="sales-alerts__list">
        {alerts.map((alert) => (
          <li key={`${alert.type}-${alert.projectId}`} className="sales-alerts__item">
            <span className="sales-alerts__text">{alert.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────── */

export function SalesDashboard({
  projects,
  onOpenProject,
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
}): ReactNode {
  const [selectedVendedor, setSelectedVendedor] = useState<string | null>(null);

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
      },
      total: {
        cotizaciones: { ...empty },
        abiertas: { ...empty },
        cerradas: { ...empty },
        canceladas: { ...empty },
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
      {/* Header */}
      <header className="sales-dashboard__header">
        <div>
          <h2 className="sales-dashboard__title">
            Dashboard de Ventas
            {selectedVendedorName ? (
              <span className="sales-dashboard__filter-badge">
                — {selectedVendedorName}
              </span>
            ) : null}
          </h2>
          <p className="sales-dashboard__subtitle">
            {isVendedor
              ? 'Tus estadísticas y proyectos del mes.'
              : 'Pipeline comercial y estadísticas del equipo.'}
          </p>
        </div>
        {totalValue > 0 ? (
          <div className="sales-dashboard__total">
            <span className="sales-dashboard__total-label">Pipeline total</span>
            <span className="sales-dashboard__total-value">
              {formatMoneyDisplay(totalValue)}
            </span>
          </div>
        ) : null}
      </header>

      {/* Vendedor filter (gerente_ventas/admin only) */}
      {!isVendedor && vendedores.length > 0 ? (
        <VendedorFilter
          vendedores={vendedores}
          selectedId={selectedVendedor}
          onChange={setSelectedVendedor}
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
                  <span className={`sales-badge ${projectStatusBadgeClass(row.project.status)}`}>
                    {projectStatusLabel(row.project.status)}
                  </span>
                  <span className="sales-list__date">
                    {formatIsoDate(row.project.updatedAt)}
                  </span>
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
