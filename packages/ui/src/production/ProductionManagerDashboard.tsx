/**
 * Production Manager Dashboard (gerente_produccion).
 *
 * Full visibility across all production areas: queues, active operators,
 * machine status, metrics, and time tracking. Allows moving items between
 * queues, reassigning operators, and changing priorities.
 *
 * Distinct from PlantBoardScreen (F093) which is read-only for all roles.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Factory,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  BarChart3,
  Settings,
  RefreshCw,
  Pause,
  Play,
  XCircle,
} from 'lucide-react';

import type { Project } from '@muebles/domain';
import {
  buildProjectFloorSummary,
  PRODUCTION_SECTOR_LABELS_ES,
  PIPELINE_SECTORS,
  type ProjectFloorSummary,
  type PipelineSector,
} from '@muebles/domain';
import { EmptyState } from '../common';
import './productionManagerDashboard.css';

// ─── Types ───────────────────────────────────────────────────────────────────

type ActiveJob = {
  readonly activityId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly itemId: string;
  readonly moduleCode: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly machineId?: string;
  readonly machineName?: string;
  readonly startedAt: string;
  readonly durationMin: number;
};

export type SectorDashboard = {
  readonly sector: string;
  readonly label: string;
  readonly activeOperators: number;
  readonly queueLength: number;
  readonly itemsInProgress: number;
  readonly itemsCompletedToday: number;
  readonly avgTimeMinutes: number;
  readonly activeJobs: readonly ActiveJob[];
};

export type DashboardMetrics = {
  readonly totalProjects: number;
  readonly totalItems: number;
  readonly totalInstalled: number;
  readonly avgProgress: number;
  readonly todayCompleted: number;
  readonly todayDamages: number;
  readonly sectors: readonly SectorDashboard[];
};

type DashboardProps = {
  readonly projects: readonly Project[];
  readonly customerLabelFor?: (customerId: string) => string;
  readonly onOpenProject?: (projectId: string) => void;
  readonly onOpenOrder?: (projectId: string) => void;
  readonly repo?: { getProductionDashboard?: () => Promise<DashboardMetrics>; getProductionActiveJobs?: () => Promise<readonly ActiveJob[]> };
  readonly testId?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min`;
  return `${Math.floor(hours / 24)}d`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}min`;
}

function getSectorIcon(sector: string): string {
  const icons: Record<string, string> = {
    cutting: '✂️',
    edge_banding: '🔧',
    assembly: '🪑',
    packaging: '📦',
    shipping: '🚚',
    installation: '🏠',
  };
  return icons[sector] ?? '⚙️';
}

// ─── Custom Hook ─────────────────────────────────────────────────────────────

function useProductionDashboard(repo?: { getProductionDashboard?: () => Promise<DashboardMetrics>; getProductionActiveJobs?: () => Promise<readonly ActiveJob[]> }) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [activeJobs, setActiveJobs] = useState<readonly ActiveJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (repo?.getProductionDashboard && repo?.getProductionActiveJobs) {
        // Fetch from real backend via repository
        const [dashResult, jobsResult] = await Promise.all([
          repo.getProductionDashboard(),
          repo.getProductionActiveJobs(),
        ]);
        setMetrics(dashResult);
        setActiveJobs(jobsResult);
      } else {
        // No repository — empty state (no backend connected)
        setMetrics({
          totalProjects: 0,
          totalItems: 0,
          totalInstalled: 0,
          avgProgress: 0,
          todayCompleted: 0,
          todayDamages: 0,
          sectors: PIPELINE_SECTORS.map((sector) => ({
            sector,
            label: PRODUCTION_SECTOR_LABELS_ES[sector],
            activeOperators: 0,
            queueLength: 0,
            itemsInProgress: 0,
            itemsCompletedToday: 0,
            avgTimeMinutes: 0,
            activeJobs: [],
          })),
        });
        setActiveJobs([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return { metrics, activeJobs, loading, error, refresh: fetchDashboard };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ProductionManagerDashboard({
  projects,
  customerLabelFor,
  onOpenProject,
  onOpenOrder,
  repo,
  testId,
}: DashboardProps) {
  const [selectedSector, setSelectedSector] = useState<PipelineSector | 'all'>('all');
  const [showMetrics, setShowMetrics] = useState(false);
  const { metrics, activeJobs, loading, error, refresh } = useProductionDashboard(repo);

  // Build summaries for all production projects
  const productionProjects = useMemo(() => {
    return projects
      .filter((p) => p.status === 'accepted' || p.status === 'produced')
      .map((project) => ({
        project,
        summary: buildProjectFloorSummary(project),
      }));
  }, [projects]);

  // Use backend metrics if available, fallback to local calculation
  const totalMetrics = useMemo(() => {
    if (metrics) {
      return {
        totalProjects: metrics.totalProjects,
        totalItems: metrics.totalItems,
        totalInstalled: metrics.totalInstalled,
        avgProgress: metrics.avgProgress,
        todayCompleted: metrics.todayCompleted,
        todayDamages: metrics.todayDamages,
      };
    }

    const totalProjects = productionProjects.length;
    const totalItems = productionProjects.reduce((acc, { summary }) => acc + summary.totalItems, 0);
    const totalInstalled = productionProjects.reduce((acc, { summary }) => acc + summary.installedItems, 0);
    const avgProgress = totalProjects > 0
      ? Math.round(productionProjects.reduce((acc, { summary }) => acc + summary.percentage, 0) / totalProjects)
      : 0;

    return {
      totalProjects,
      totalItems,
      totalInstalled,
      avgProgress,
      todayCompleted: 0,
      todayDamages: 0,
    };
  }, [metrics, productionProjects]);

  // Use backend sector data if available, fallback to local
  const sectorStatuses = useMemo(() => {
    if (metrics?.sectors && metrics.sectors.length > 0) {
      return metrics.sectors;
    }

    return PIPELINE_SECTORS.map((sector) => {
      const itemsInProgress = productionProjects.reduce((acc, { summary }) => {
        const stage = summary.stages.find((s) => s.sector === sector);
        return acc + (stage?.waiting ?? 0);
      }, 0);

      return {
        sector,
        label: PRODUCTION_SECTOR_LABELS_ES[sector],
        activeOperators: 0,
        queueLength: itemsInProgress,
        itemsInProgress: 0,
        itemsCompletedToday: 0,
        avgTimeMinutes: 0,
        activeJobs: [],
      };
    });
  }, [metrics, productionProjects]);

  // Filter active jobs by selected sector
  const filteredJobs = useMemo(() => {
    if (selectedSector === 'all') return activeJobs;
    return activeJobs.filter((job) => {
      const sector = sectorStatuses.find((s) => s.sector === selectedSector);
      return sector?.activeJobs.some((j) => j.activityId === job.activityId);
    });
  }, [activeJobs, selectedSector, sectorStatuses]);

  if (loading) {
    return (
      <section className="pm-dashboard" aria-label="Dashboard del Gerente de Producción" data-testid={testId}>
        <div className="pm-dashboard__loading">
          <RefreshCw size={32} className="pm-dashboard__spinner" />
          <p>Cargando datos de producción...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="pm-dashboard" aria-label="Dashboard del Gerente de Producción" data-testid={testId}>
        <div className="pm-dashboard__error">
          <AlertTriangle size={32} />
          <p>Error al cargar el dashboard: {error}</p>
          <button type="button" onClick={refresh} className="pm-dashboard__btn pm-dashboard__btn--primary">
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="pm-dashboard" aria-label="Dashboard del Gerente de Producción" data-testid={testId}>
      {/* Header */}
      <header className="pm-dashboard__header">
        <div className="pm-dashboard__title-row">
          <span className="pm-dashboard__title-icon" aria-hidden>
            <Factory size={24} strokeWidth={1.5} />
          </span>
          <div>
            <h1 className="pm-dashboard__title">Dashboard de Producción</h1>
            <p className="pm-dashboard__subtitle">
              Visibilidad completa de todas las áreas, operadores y métricas
            </p>
          </div>
        </div>
        <div className="pm-dashboard__header-actions">
          <button
            type="button"
            className="pm-dashboard__btn pm-dashboard__btn--secondary"
            onClick={refresh}
          >
            <RefreshCw size={16} />
            Actualizar
          </button>
          <button
            type="button"
            className="pm-dashboard__btn pm-dashboard__btn--secondary"
            onClick={() => setShowMetrics(!showMetrics)}
          >
            <BarChart3 size={16} />
            {showMetrics ? 'Ocultar Métricas' : 'Ver Métricas'}
          </button>
          <button
            type="button"
            className="pm-dashboard__btn pm-dashboard__btn--primary"
          >
            <Settings size={16} />
            Configurar
          </button>
        </div>
      </header>

      {/* Summary Cards */}
      <div className="pm-dashboard__summary">
        <div className="pm-dashboard__card pm-dashboard__card--highlight">
          <div className="pm-dashboard__card-icon">
            <Factory size={20} />
          </div>
          <div className="pm-dashboard__card-content">
            <span className="pm-dashboard__card-value">{totalMetrics.totalProjects}</span>
            <span className="pm-dashboard__card-label">Proyectos en Planta</span>
          </div>
        </div>

        <div className="pm-dashboard__card">
          <div className="pm-dashboard__card-icon">
            <Users size={20} />
          </div>
          <div className="pm-dashboard__card-content">
            <span className="pm-dashboard__card-value">{activeJobs.length}</span>
            <span className="pm-dashboard__card-label">Operadores Activos</span>
          </div>
        </div>

        <div className="pm-dashboard__card">
          <div className="pm-dashboard__card-icon">
            <CheckCircle2 size={20} />
          </div>
          <div className="pm-dashboard__card-content">
            <span className="pm-dashboard__card-value">{totalMetrics.todayCompleted}</span>
            <span className="pm-dashboard__card-label">Completados Hoy</span>
          </div>
        </div>

        <div className="pm-dashboard__card">
          <div className="pm-dashboard__card-icon">
            <Clock size={20} />
          </div>
          <div className="pm-dashboard__card-content">
            <span className="pm-dashboard__card-value">{totalMetrics.avgProgress}%</span>
            <span className="pm-dashboard__card-label">Avance Promedio</span>
          </div>
        </div>
      </div>

      {/* Sector Status Bar */}
      <div className="pm-dashboard__sectors">
        <h2 className="pm-dashboard__section-title">Estado por Sector</h2>
        <div className="pm-dashboard__sector-grid">
          {sectorStatuses.map((status) => (
            <button
              key={status.sector}
              type="button"
              className={`pm-dashboard__sector-btn ${
                selectedSector === status.sector ? 'pm-dashboard__sector-btn--active' : ''
              }`}
              onClick={() => setSelectedSector(status.sector as PipelineSector)}
            >
              <span className="pm-dashboard__sector-icon">{getSectorIcon(status.sector)}</span>
              <span className="pm-dashboard__sector-name">{status.label}</span>
              <span className="pm-dashboard__sector-count">
                {status.activeOperators} activos
              </span>
              <span className="pm-dashboard__sector-count">
                {status.queueLength} en cola
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Metrics Panel (collapsible) */}
      {showMetrics && (
        <div className="pm-dashboard__metrics">
          <h2 className="pm-dashboard__section-title">Métricas de Producción</h2>
          <div className="pm-dashboard__metrics-grid">
            <div className="pm-dashboard__metric">
              <span className="pm-dashboard__metric-label">Piezas Completadas Hoy</span>
              <span className="pm-dashboard__metric-value">{totalMetrics.todayCompleted}</span>
            </div>
            <div className="pm-dashboard__metric">
              <span className="pm-dashboard__metric-label">Piezas Dañadas Hoy</span>
              <span className="pm-dashboard__metric-value">{totalMetrics.todayDamages}</span>
            </div>
            {sectorStatuses.map((sector) => (
              <div key={sector.sector} className="pm-dashboard__metric">
                <span className="pm-dashboard__metric-label">{sector.label}</span>
                <span className="pm-dashboard__metric-value">
                  {sector.itemsCompletedToday} completados
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Jobs */}
      {filteredJobs.length > 0 && (
        <div className="pm-dashboard__jobs">
          <h2 className="pm-dashboard__section-title">Trabajos Activos</h2>
          <div className="pm-dashboard__job-list">
            {filteredJobs.map((job) => (
              <ActiveJobRow key={job.activityId} job={job} />
            ))}
          </div>
        </div>
      )}

      {/* Project List */}
      <div className="pm-dashboard__projects">
        <h2 className="pm-dashboard__section-title">Proyectos en Producción</h2>
        
        {productionProjects.length === 0 ? (
          <EmptyState
            title="Sin proyectos en planta"
            description="Cuando se apruebe una cotización, aparecerá acá con su estado completo."
          />
        ) : (
          <div className="pm-dashboard__project-list">
            {productionProjects.map(({ project, summary }) => (
              <ProjectDashboardRow
                key={project.id}
                project={project}
                summary={summary}
                customerLabelFor={customerLabelFor}
                onOpenProject={onOpenProject}
                onOpenOrder={onOpenOrder}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Active Job Row ──────────────────────────────────────────────────────────

function ActiveJobRow({ job }: { readonly job: ActiveJob }) {
  return (
    <div className="pm-dashboard__job-row" data-testid={`pm-active-job-${job.activityId}`}>
      <div className="pm-dashboard__job-info">
        <span className="pm-dashboard__job-operator">
          <Users size={14} />
          {job.operatorName}
        </span>
        <span className="pm-dashboard__job-project">
          {job.projectName}
        </span>
        <span className="pm-dashboard__job-module">
          {job.moduleCode}
        </span>
        {job.machineName && (
          <span className="pm-dashboard__job-machine">
            <Settings size={12} />
            {job.machineName}
          </span>
        )}
      </div>
      <div className="pm-dashboard__job-time">
        <Clock size={14} />
        <span>{formatDuration(job.durationMin)}</span>
      </div>
    </div>
  );
}

// ─── Project Row ─────────────────────────────────────────────────────────────

function ProjectDashboardRow({
  project,
  summary,
  customerLabelFor,
  onOpenProject,
  onOpenOrder,
}: {
  readonly project: Project;
  readonly summary: ProjectFloorSummary;
  readonly customerLabelFor?: (customerId: string) => string;
  readonly onOpenProject?: (projectId: string) => void;
  readonly onOpenOrder?: (projectId: string) => void;
}) {
  const activeSectorLabel = summary.activeSector
    ? PRODUCTION_SECTOR_LABELS_ES[summary.activeSector]
    : 'Completado';

  return (
    <div className="pm-dashboard__project-row" data-testid={`pm-project-row-${project.id}`}>
      <div className="pm-dashboard__project-info">
        <div className="pm-dashboard__project-name">
          {onOpenOrder ? (
            <button
              type="button"
              className="pm-dashboard__project-link"
              onClick={() => onOpenOrder(project.id)}
            >
              {project.name}
            </button>
          ) : onOpenProject ? (
            <button
              type="button"
              className="pm-dashboard__project-link"
              onClick={() => onOpenProject(project.id)}
            >
              {project.name}
            </button>
          ) : (
            <span>{project.name}</span>
          )}
          <span className="pm-dashboard__project-customer">
            {customerLabelFor?.(project.customerId) || '—'}
          </span>
        </div>
        <div className="pm-dashboard__project-meta">
          <span>{summary.totalItems} muebles</span>
          <span>•</span>
          <span>En {activeSectorLabel}</span>
        </div>
      </div>

      <div className="pm-dashboard__project-progress">
        <div className="pm-dashboard__progress-bar">
          <div
            className="pm-dashboard__progress-fill"
            style={{ width: `${summary.percentage}%` }}
          />
        </div>
        <span className="pm-dashboard__progress-text">{summary.percentage}%</span>
      </div>

      <div className="pm-dashboard__project-stages">
        {summary.stages.map((stage) => {
          const done = stage.done >= stage.total;
          const active = summary.activeSector === stage.sector;
          return (
            <div
              key={stage.sector}
              className={`pm-dashboard__stage ${
                done ? 'pm-dashboard__stage--done' : active ? 'pm-dashboard__stage--active' : ''
              }`}
              title={`${PRODUCTION_SECTOR_LABELS_ES[stage.sector]}: ${stage.done}/${stage.total}`}
            >
              <span className="pm-dashboard__stage-icon">{getSectorIcon(stage.sector)}</span>
              <span className="pm-dashboard__stage-count">
                {stage.done}/{stage.total}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
