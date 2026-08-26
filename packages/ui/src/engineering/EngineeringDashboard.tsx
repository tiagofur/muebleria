/**
 * EngineeringDashboard — Analytics, cycle times, workload, and technical KPIs.
 *
 * Dedicated analytics screen for engineering leadership (admin, ingeniero, gerente_produccion).
 * Distinct from the operative work queue (EngineeringScreen).
 *
 * docs/design.md §5.4 — Dashboards first, unique labels.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ClipboardList } from 'lucide-react';

import './engineering.css';

import {
  computeEngineeringDashboardStats,
  type Project,
} from '@granete/domain';
import {
  PageHeader,
  PageToolbar,
  SearchInput,
  StatusChips,
  type StatusChipOption,
} from '../common';
import { EngineeringKpiStatsGrid } from './components/EngineeringKpiStatsGrid';
import { EngineeringStagnantAlerts } from './components/EngineeringStagnantAlerts';
import { EngineerWorkloadTable } from './components/EngineerWorkloadTable';
import { EngineeringProjectsTable } from './components/EngineeringProjectsTable';

type ProjectWithCustomer = Project & { readonly customerLabel?: string };

type PeriodOption = 'all' | 'month' | 'recent';

const PERIOD_CHIP_OPTIONS: readonly StatusChipOption<PeriodOption>[] = [
  { value: 'all', label: 'Histórico' },
  { value: 'month', label: 'Mes actual' },
  { value: 'recent', label: 'Últimos 30 días' },
];

export interface EngineeringDashboardProps {
  /** Projects visible to the current role. */
  readonly projects: readonly ProjectWithCustomer[];
  /** Open workspace for a specific project. */
  readonly onOpenProject: (projectId: string) => void;
  /** Navigate directly to the operative Engineering Work Queue. */
  readonly onOpenQueue: () => void;
  /** List of assignable engineers for display and filtering. */
  readonly assignableEngineers?: readonly {
    readonly id: string;
    readonly name: string;
  }[];
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
      const dateStr =
        p.engineeringLog?.startedAt || p.createdAt || p.updatedAt;
      if (!dateStr) return true;
      const d = new Date(dateStr);

      if (period === 'month') {
        return (
          d.getMonth() === currentMonth && d.getFullYear() === currentYear
        );
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
    <section
      className="eng-dashboard"
      aria-label="Dashboard de Ingeniería"
      data-testid="engineering-dashboard"
    >
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

      <EngineeringKpiStatsGrid stats={stats} />

      <EngineeringStagnantAlerts
        stagnantAlerts={stats.stagnantAlerts}
        onOpenProject={onOpenProject}
      />

      <EngineerWorkloadTable
        engineerWorkload={stats.engineerWorkload}
        resolveEngineerName={resolveEngineerName}
      />

      <EngineeringProjectsTable
        projects={filteredProjectList}
        resolveEngineerName={resolveEngineerName}
        onOpenProject={onOpenProject}
      />
    </section>
  );
}
