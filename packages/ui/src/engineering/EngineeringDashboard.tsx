/**
 * EngineeringDashboard — Analytics, cycle times, workload, and technical KPIs.
 *
 * Dedicated analytics screen for engineering leadership (admin, ingeniero, gerente_produccion).
 * Distinct from the operative work queue (EngineeringScreen).
 *
 * docs/design.md §5.4 — Dashboards first, unique labels.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Compass,
  FileCheck,
  FileText,
  Layers,
  LayoutGrid,
  Send,
  Users,
  SearchX,
  ClipboardList,
} from 'lucide-react';

import './engineering.css';

import {
  computeEngineeringDashboardStats,
  ENGINEERING_STATUS_LABELS_ES,
  type EngineeringDashboardProjectMetrics,
  type EngineeringStatus,
  type Project,
} from '@muebles/domain';
import {
  EmptyState,
  PageHeader,
  PageToolbar,
  SearchInput,
  StatusChips,
  type StatusChipOption,
} from '../common';

type ProjectWithCustomer = Project & { readonly customerLabel?: string };

type PeriodOption = 'all' | 'month' | 'recent';

const PERIOD_CHIP_OPTIONS: readonly StatusChipOption<PeriodOption>[] = [
  { value: 'all', label: 'Histórico' },
  { value: 'month', label: 'Mes actual' },
  { value: 'recent', label: 'Últimos 30 días' },
];

/** Status badge modifiers for engineering (design.md §5.2). */
const STATUS_BADGE_MODIFIERS: Readonly<Record<EngineeringStatus, string>> = {
  pending: 'open',
  in_progress: 'progress',
  documented: 'done',
};

export interface EngineeringDashboardProps {
  /** Projects visible to the current role. */
  readonly projects: readonly ProjectWithCustomer[];
  /** Open workspace for a specific project. */
  readonly onOpenProject: (projectId: string) => void;
  /** Navigate directly to the operative Engineering Work Queue. */
  readonly onOpenQueue: () => void;
  /** List of assignable engineers for display and filtering. */
  readonly assignableEngineers?: readonly { readonly id: string; readonly name: string }[];
  /** Map of engineer userId -> displayName. */
  readonly engineerLabels?: Readonly<Record<string, string>>;
}

export function EngineeringDashboard({
  projects,
  onOpenProject,
  onOpenQueue,
  assignableEngineers,
  engineerLabels = {},
}: EngineeringDashboardProps): ReactNode {
  const [period, setPeriod] = useState<PeriodOption>('all');
  const [selectedEngineer, setSelectedEngineer] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  // Filter projects by period if applicable
  const periodFilteredProjects = useMemo(() => {
    if (period === 'all') return projects;
    const now = Date.now();
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    return projects.filter((p) => {
      const dateStr = p.engineeringLog?.startedAt || p.createdAt || p.updatedAt;
      if (!dateStr) return true;
      const d = new Date(dateStr);

      if (period === 'month') {
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      }
      if (period === 'recent') {
        return now - d.getTime() <= 30 * 24 * 3600 * 1000;
      }
      return true;
    });
  }, [projects, period]);

  // Compute domain analytics on the filtered set
  const stats = useMemo(
    () => computeEngineeringDashboardStats(periodFilteredProjects),
    [periodFilteredProjects],
  );

  // Filter projects table by search and selected engineer
  const filteredProjectList = useMemo(() => {
    let list = stats.projects;
    if (selectedEngineer !== 'all') {
      list = list.filter((p) => p.engineerId === selectedEngineer);
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
  }, [stats.projects, selectedEngineer, search]);

  const resolveEngineerName = (id?: string) => {
    if (!id) return 'Sin asignar';
    return (
      engineerLabels[id] ||
      assignableEngineers?.find((e) => e.id === id)?.name ||
      id
    );
  };

  return (
    <section className="eng-dashboard" aria-label="Dashboard de Ingeniería" data-testid="engineering-dashboard">
      <PageHeader
        title="Dashboard de Ingeniería"
        subtitle="Métricas de documentación técnica, tiempos de ciclo, volumen procesado y trazabilidad."
        secondaryActions={
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={onOpenQueue}
            data-testid="eng-dash-goto-queue"
          >
            <ClipboardList size={14} strokeWidth={1.5} />
            Ir a Cola de Trabajo
          </button>
        }
      />

      <PageToolbar
        ariaLabel="Filtros del dashboard de ingeniería"
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por obra o cliente..."
            aria-label="Buscar en proyectos de ingeniería"
          />
        }
        filters={
          <div className="eng-dashboard__filters">
            <StatusChips<PeriodOption>
              value={period}
              onChange={setPeriod}
              options={PERIOD_CHIP_OPTIONS}
              aria-label="Filtrar por período"
              data-testid="eng-period-chips"
            />
            {assignableEngineers && assignableEngineers.length > 0 ? (
              <select
                className="select select--small eng-dashboard__engineer-select"
                value={selectedEngineer}
                onChange={(e) => setSelectedEngineer(e.target.value)}
                aria-label="Filtrar por ingeniero responsable"
                data-testid="eng-engineer-select"
              >
                <option value="all">Todos los ingenieros</option>
                {assignableEngineers.map((eng) => (
                  <option key={eng.id} value={eng.id}>
                    {eng.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        }
      />

      {/* Row 1: KPI Stat Cards */}
      <div className="eng-dashboard__stats-grid">
        <div className="stat-card stat-card--eng" data-testid="eng-stat-kpi-pending">
          <span className="stat-card__icon" aria-hidden>
            <Clock size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.pendingCount}</span>
            <span className="stat-card__label">En espera de inicio</span>
          </div>
        </div>

        <div className="stat-card stat-card--eng" data-testid="eng-stat-kpi-in-progress">
          <span className="stat-card__icon" aria-hidden>
            <FileText size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.inProgressCount}</span>
            <span className="stat-card__label">En modelado / despiece</span>
          </div>
        </div>

        <div
          className="stat-card stat-card--eng stat-card--emphasis"
          data-testid="eng-stat-kpi-documented"
        >
          <span className="stat-card__icon" aria-hidden>
            <FileCheck size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.documentedCount}</span>
            <span className="stat-card__label">Listas para enviar a planta</span>
          </div>
        </div>

        <div className="stat-card stat-card--eng" data-testid="eng-stat-kpi-sent">
          <span className="stat-card__icon" aria-hidden>
            <Send size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.sentToProductionCount}</span>
            <span className="stat-card__label">Despachadas a planta</span>
          </div>
        </div>
      </div>

      {/* Row 2: Performance & Cycle Times Grid */}
      <div className="eng-dashboard__metrics-grid">
        <div className="eng-dashboard__panel">
          <div className="eng-dashboard__panel-header">
            <Clock size={16} strokeWidth={1.5} className="eng-dashboard__panel-icon" />
            <h3 className="eng-dashboard__panel-title">Tiempos de Ciclo y Calidad</h3>
          </div>
          <div className="eng-dashboard__cycle-grid">
            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">
                {stats.avgWaitTimeHours !== null ? `${stats.avgWaitTimeHours}h` : '—'}
              </span>
              <span className="eng-dashboard__cycle-label">
                Espera en cola promedio
                <span className="eng-dashboard__cycle-sub"> (aceptación → inicio)</span>
              </span>
            </div>

            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">
                {stats.avgCycleTimeHours !== null ? `${stats.avgCycleTimeHours}h` : '—'}
              </span>
              <span className="eng-dashboard__cycle-label">
                Documentación técnica
                <span className="eng-dashboard__cycle-sub"> (inicio → envío a planta)</span>
              </span>
            </div>

            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">
                {stats.avgRevisionCount !== null ? `v${stats.avgRevisionCount}` : 'v1.0'}
              </span>
              <span className="eng-dashboard__cycle-label">
                Revisiones promedio
                <span className="eng-dashboard__cycle-sub"> (packs generados por obra)</span>
              </span>
            </div>
          </div>
        </div>

        <div className="eng-dashboard__panel">
          <div className="eng-dashboard__panel-header">
            <Layers size={16} strokeWidth={1.5} className="eng-dashboard__panel-icon" />
            <h3 className="eng-dashboard__panel-title">Volumen Técnico Procesado</h3>
          </div>
          <div className="eng-dashboard__cycle-grid">
            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">{stats.totalModulesCalculated}</span>
              <span className="eng-dashboard__cycle-label">Módulos procesados</span>
            </div>

            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">{stats.totalCutPiecesCalculated}</span>
              <span className="eng-dashboard__cycle-label">Piezas calculadas</span>
            </div>

            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">{stats.totalActiveQueue}</span>
              <span className="eng-dashboard__cycle-label">Obras en circuito</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Stagnant Alerts if any */}
      {stats.stagnantAlerts.length > 0 ? (
        <div className="eng-dashboard__alerts-section" data-testid="eng-stagnant-alerts">
          <div className="eng-dashboard__alerts-header">
            <AlertTriangle size={18} strokeWidth={1.5} className="eng-dashboard__alert-icon" />
            <h3 className="eng-dashboard__alerts-title">
              Alertas de Obras Demoradas ({stats.stagnantAlerts.length})
            </h3>
          </div>
          <ul className="eng-dashboard__alerts-list">
            {stats.stagnantAlerts.map((alert) => (
              <li key={alert.projectId} className="eng-dashboard__alert-item">
                <div className="eng-dashboard__alert-info">
                  <span className="eng-dashboard__alert-name">{alert.projectName}</span>
                  {alert.customerLabel ? (
                    <span className="eng-dashboard__alert-customer">· {alert.customerLabel}</span>
                  ) : null}
                  <span className="eng-dashboard__alert-reason">{alert.stagnantReason}</span>
                </div>
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={() => onOpenProject(alert.projectId)}
                >
                  Abrir obra <ArrowRight size={12} strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Row 4: Team Workload Breakdown */}
      {stats.engineerWorkload.length > 0 ? (
        <div className="eng-dashboard__panel" data-testid="eng-workload-panel">
          <div className="eng-dashboard__panel-header">
            <Users size={16} strokeWidth={1.5} className="eng-dashboard__panel-icon" />
            <h3 className="eng-dashboard__panel-title">Carga por Ingeniero Responsable</h3>
          </div>
          <div className="eng-dashboard__workload-grid">
            {stats.engineerWorkload.map((eng) => (
              <div key={eng.engineerId} className="eng-dashboard__workload-card">
                <div className="eng-dashboard__workload-header">
                  <span className="eng-dashboard__workload-name">
                    {resolveEngineerName(eng.engineerId)}
                  </span>
                  <span className="meta-chip">{eng.totalAssigned} obras</span>
                </div>
                <div className="eng-dashboard__workload-metrics">
                  <div className="eng-dashboard__workload-stat">
                    <span className="eng-dashboard__workload-num">{eng.activeCount}</span>
                    <span className="eng-dashboard__workload-lbl">En proceso</span>
                  </div>
                  <div className="eng-dashboard__workload-stat">
                    <span className="eng-dashboard__workload-num">{eng.documentedCount}</span>
                    <span className="eng-dashboard__workload-lbl">Documentadas</span>
                  </div>
                  <div className="eng-dashboard__workload-stat">
                    <span className="eng-dashboard__workload-num">{eng.sentCount}</span>
                    <span className="eng-dashboard__workload-lbl">Enviadas</span>
                  </div>
                  <div className="eng-dashboard__workload-stat">
                    <span className="eng-dashboard__workload-num">
                      {eng.avgCycleHours !== null ? `${eng.avgCycleHours}h` : '—'}
                    </span>
                    <span className="eng-dashboard__workload-lbl">Ciclo prom.</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Row 5: Detailed Project Tracker */}
      <div className="eng-dashboard__panel">
        <div className="eng-dashboard__panel-header">
          <LayoutGrid size={16} strokeWidth={1.5} className="eng-dashboard__panel-icon" />
          <h3 className="eng-dashboard__panel-title">
            Trazabilidad Técnica de Obras ({filteredProjectList.length})
          </h3>
        </div>

        {filteredProjectList.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Sin obras para mostrar"
            description="No hay proyectos que coincidan con los filtros seleccionados."
          />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table" aria-label="Proyectos de ingeniería">
              <thead>
                <tr>
                  <th>Obra / Cliente</th>
                  <th>Estado</th>
                  <th>Responsable</th>
                  <th>Revisión</th>
                  <th>Espera</th>
                  <th>Ciclo</th>
                  <th>Módulos</th>
                  <th style={{ textAlign: 'right' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjectList.map((p) => (
                  <tr key={p.projectId} data-testid={`eng-row-${p.projectId}`}>
                    <td>
                      <div className="eng-dashboard__table-project">
                        <span className="eng-dashboard__table-name">{p.projectName}</span>
                        {p.customerLabel ? (
                          <span className="eng-dashboard__table-sub">{p.customerLabel}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`status-badge status-badge--${
                          p.isSentToProduction
                            ? 'done'
                            : STATUS_BADGE_MODIFIERS[p.status]
                        }`}
                      >
                        <span className="status-badge__dot" aria-hidden>●</span>
                        {p.isSentToProduction
                          ? 'Enviada a planta'
                          : ENGINEERING_STATUS_LABELS_ES[p.status]}
                      </span>
                    </td>
                    <td>
                      <span className="eng-dashboard__table-engineer">
                        {resolveEngineerName(p.engineerId)}
                      </span>
                    </td>
                    <td>
                      <span className="meta-chip">Rev. {p.revision}</span>
                    </td>
                    <td>
                      <span className="eng-dashboard__table-time">
                        {p.waitTimeHours !== undefined ? `${p.waitTimeHours}h` : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="eng-dashboard__table-time">
                        {p.cycleTimeHours !== undefined ? `${p.cycleTimeHours}h` : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="eng-dashboard__table-num">{p.moduleCount}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--small"
                        onClick={() => onOpenProject(p.projectId)}
                        aria-label={`Abrir workspace de ${p.projectName}`}
                      >
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
