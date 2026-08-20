/**
 * Production Manager Dashboard (gerente_produccion).
 *
 * Full visibility across all production areas: queues, active operators,
 * machine status, metrics, and time tracking. Allows moving items between
 * queues, reassigning operators, and changing priorities.
 *
 * Distinct from PlantBoardScreen (F093) which is read-only for all roles.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  Factory,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  RefreshCw,
} from 'lucide-react';
import type { Project } from '@muebles/domain';
import {
  buildProjectFloorSummary,
  PIPELINE_SECTORS,
  PRODUCTION_SECTOR_LABELS_ES,
  type PipelineSector,
} from '@muebles/domain';
import { PageHeader } from '../common';
import {
  useProductionDashboard,
  type ProductionManagerRepo,
  type DashboardMetrics,
  type SectorDashboard,
} from './manager/useProductionDashboardState';

export type { DashboardMetrics, SectorDashboard };
import { ProductionManagerSectorsGrid } from './manager/ProductionManagerSectorsGrid';
import { ProductionManagerActiveJobs } from './manager/ProductionManagerActiveJobs';
import { ProductionManagerProjectsTable } from './manager/ProductionManagerProjectsTable';
import './productionManagerDashboard.css';

export type DashboardProps = {
  readonly projects: readonly Project[];
  readonly customerLabelFor?: (customerId: string) => string;
  readonly onOpenProject?: (projectId: string) => void;
  readonly onOpenOrder?: (projectId: string) => void;
  readonly repo?: ProductionManagerRepo;
  readonly testId?: string;
};

export function ProductionManagerDashboard({
  projects,
  customerLabelFor,
  onOpenProject,
  onOpenOrder,
  repo,
  testId,
}: DashboardProps): ReactNode {
  const [selectedSector, setSelectedSector] = useState<PipelineSector | 'all'>(
    'all',
  );
  const [showMetrics, setShowMetrics] = useState(false);
  const { metrics, activeJobs, loading, error, refresh } =
    useProductionDashboard(repo);

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
        totalProjects: productionProjects.length,
        totalItems: metrics.totalItems,
        totalInstalled: metrics.totalInstalled,
        avgProgress: metrics.avgProgress,
        todayCompleted: metrics.todayCompleted,
        todayDamages: metrics.todayDamages,
      };
    }

    const totalProjects = productionProjects.length;
    const totalItems = productionProjects.reduce(
      (acc, { summary }) => acc + summary.totalItems,
      0,
    );
    const totalInstalled = productionProjects.reduce(
      (acc, { summary }) => acc + summary.installedItems,
      0,
    );
    const avgProgress =
      totalProjects > 0
        ? Math.round(
            productionProjects.reduce(
              (acc, { summary }) => acc + summary.percentage,
              0,
            ) / totalProjects,
          )
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
      <section
        className="pm-dashboard"
        aria-label="Dashboard del Gerente de Producción"
        data-testid={testId}
      >
        <div className="pm-dashboard__loading" role="status">
          <RefreshCw
            size={32}
            strokeWidth={1.5}
            className="pm-dashboard__spinner"
            aria-hidden
          />
          <p>Cargando datos de producción...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        className="pm-dashboard"
        aria-label="Dashboard del Gerente de Producción"
        data-testid={testId}
      >
        <div className="pm-dashboard__error" role="alert">
          <AlertTriangle size={32} strokeWidth={1.5} aria-hidden />
          <p>Error al cargar el dashboard: {error}</p>
          <button type="button" onClick={refresh} className="btn btn--primary">
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="pm-dashboard"
      aria-label="Dashboard del Gerente de Producción"
      data-testid={testId}
    >
      <PageHeader
        title="Dashboard de Producción"
        subtitle="Visibilidad completa de todas las áreas, operadores y métricas"
        icon={<BarChart3 size={16} strokeWidth={1.5} />}
        secondaryActions={
          <>
            <button type="button" className="btn" onClick={refresh}>
              <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
              Actualizar
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setShowMetrics(!showMetrics)}
              aria-pressed={showMetrics}
            >
              <BarChart3 size={16} strokeWidth={1.5} aria-hidden />
              {showMetrics ? 'Ocultar Métricas' : 'Ver Métricas'}
            </button>
          </>
        }
      />

      {/* Summary Cards */}
      <div className="pm-dashboard__summary">
        <div className="stat-card stat-card--work stat-card--emphasis">
          <div className="stat-card__icon">
            <Factory size={20} strokeWidth={1.5} aria-hidden />
          </div>
          <div className="stat-card__body">
            <span className="stat-card__value" data-testid="pm-total-projects">
              {totalMetrics.totalProjects}
            </span>
            <span className="stat-card__label">Obras en Producción</span>
          </div>
        </div>

        <div className="stat-card stat-card--work">
          <div className="stat-card__icon">
            <Users size={20} strokeWidth={1.5} aria-hidden />
          </div>
          <div className="stat-card__body">
            <span className="stat-card__value">{activeJobs.length}</span>
            <span className="stat-card__label">Operadores Activos</span>
          </div>
        </div>

        <div className="stat-card stat-card--work">
          <div className="stat-card__icon">
            <CheckCircle2 size={20} strokeWidth={1.5} aria-hidden />
          </div>
          <div className="stat-card__body">
            <span className="stat-card__value">
              {totalMetrics.todayCompleted}
            </span>
            <span className="stat-card__label">Completados Hoy</span>
          </div>
        </div>

        <div className="stat-card stat-card--work">
          <div className="stat-card__icon">
            <Clock size={20} strokeWidth={1.5} aria-hidden />
          </div>
          <div className="stat-card__body">
            <span className="stat-card__value">
              {totalMetrics.avgProgress.toFixed(2)}%
            </span>
            <span className="stat-card__label">Avance Promedio</span>
          </div>
        </div>
      </div>

      <ProductionManagerSectorsGrid
        sectorStatuses={sectorStatuses}
        selectedSector={selectedSector}
        onSelectSector={setSelectedSector}
        showMetrics={showMetrics}
        todayCompleted={totalMetrics.todayCompleted}
        todayDamages={totalMetrics.todayDamages}
      />

      <ProductionManagerActiveJobs jobs={filteredJobs} />

      <ProductionManagerProjectsTable
        productionProjects={productionProjects}
        customerLabelFor={customerLabelFor}
        onOpenProject={onOpenProject}
        onOpenOrder={onOpenOrder}
      />
    </section>
  );
}
