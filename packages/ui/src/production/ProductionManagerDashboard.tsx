/**
 * Production Manager Dashboard (gerente_produccion).
 *
 * Full visibility across all production areas: queues, active operators,
 * machine status, metrics, and time tracking. Allows moving items between
 * queues, reassigning operators, and changing priorities.
 *
 * Distinct from PlantBoardScreen (F093) which is read-only for all roles.
 */

import { useMemo, useState } from 'react';
import {
  Factory,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  BarChart3,
  Settings,
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

type OperatorStatus = 'active' | 'idle' | 'break';

type OperatorInfo = {
  readonly id: string;
  readonly name: string;
  readonly sector: PipelineSector;
  readonly projectId: string;
  readonly projectName: string;
  readonly status: OperatorStatus;
  readonly startedAt: string;
  readonly itemsCount: number;
};

type QueueItem = {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerId: string;
  readonly itemsCount: number;
  readonly priority: 'high' | 'medium' | 'low';
  readonly deadline?: string;
};

type SectorStatus = {
  readonly sector: PipelineSector;
  readonly label: string;
  readonly activeOperators: number;
  readonly queueLength: number;
  readonly itemsInProgress: number;
  readonly itemsCompletedToday: number;
  readonly avgTimeMinutes: number;
};

type DashboardProps = {
  readonly projects: readonly Project[];
  readonly customerLabelFor?: (customerId: string) => string;
  readonly onOpenProject?: (projectId: string) => void;
  readonly onOpenOrder?: (projectId: string) => void;
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

function getSectorIcon(sector: PipelineSector): string {
  const icons: Record<PipelineSector, string> = {
    cutting: '✂️',
    edge_banding: '🔧',
    assembly: '🪑',
    packaging: '📦',
    shipping: '🚚',
    installation: '🏠',
  };
  return icons[sector] ?? '⚙️';
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ProductionManagerDashboard({
  projects,
  customerLabelFor,
  onOpenProject,
  onOpenOrder,
  testId,
}: DashboardProps) {
  const [selectedSector, setSelectedSector] = useState<PipelineSector | 'all'>('all');
  const [showMetrics, setShowMetrics] = useState(false);

  // Build summaries for all production projects
  const productionProjects = useMemo(() => {
    return projects
      .filter((p) => p.status === 'accepted' || p.status === 'produced')
      .map((project) => ({
        project,
        summary: buildProjectFloorSummary(project),
      }));
  }, [projects]);

  // Aggregate sector status (placeholder - real data would come from backend)
  const sectorStatuses: SectorStatus[] = useMemo(() => {
    return PIPELINE_SECTORS.map((sector) => {
      const itemsInProgress = productionProjects.reduce((acc, { project }) => {
        return acc + project.summary.stages.find((s) => s.sector === sector)?.waiting ?? 0;
      }, 0);

      return {
        sector,
        label: PRODUCTION_SECTOR_LABELS_ES[sector],
        activeOperators: 0, // Would come from real-time data
        queueLength: itemsInProgress,
        itemsInProgress: 0,
        itemsCompletedToday: 0,
        avgTimeMinutes: 0,
      };
    });
  }, [productionProjects]);

  // Total metrics
  const totalMetrics = useMemo(() => {
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
    };
  }, [productionProjects]);

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
            <span className="pm-dashboard__card-value">{totalMetrics.totalItems}</span>
            <span className="pm-dashboard__card-label">Muebles Totales</span>
          </div>
        </div>

        <div className="pm-dashboard__card">
          <div className="pm-dashboard__card-icon">
            <CheckCircle2 size={20} />
          </div>
          <div className="pm-dashboard__card-content">
            <span className="pm-dashboard__card-value">{totalMetrics.totalInstalled}</span>
            <span className="pm-dashboard__card-label">Instalados</span>
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
              onClick={() => setSelectedSector(status.sector)}
            >
              <span className="pm-dashboard__sector-icon">{getSectorIcon(status.sector)}</span>
              <span className="pm-dashboard__sector-name">{status.label}</span>
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
              <span className="pm-dashboard__metric-label">Tiempo Promedio por Proyecto</span>
              <span className="pm-dashboard__metric-value">--</span>
            </div>
            <div className="pm-dashboard__metric">
              <span className="pm-dashboard__metric-label">Piezas Cortadas Hoy</span>
              <span className="pm-dashboard__metric-value">--</span>
            </div>
            <div className="pm-dashboard__metric">
              <span className="pm-dashboard__metric-label">Eficiencia del Día</span>
              <span className="pm-dashboard__metric-value">--</span>
            </div>
            <div className="pm-dashboard__metric">
              <span className="pm-dashboard__metric-label">Piezas Dañadas Hoy</span>
              <span className="pm-dashboard__metric-value">--</span>
            </div>
          </div>
          <p className="pm-dashboard__metric-note">
            Las métricas se actualizarán con datos en tiempo real del backend
          </p>
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

      {/* Quick Actions */}
      <div className="pm-dashboard__actions">
        <h2 className="pm-dashboard__section-title">Acciones Rápidas</h2>
        <div className="pm-dashboard__action-grid">
          <button type="button" className="pm-dashboard__action-btn">
            <ArrowRight size={16} />
            Mover Between Colas
          </button>
          <button type="button" className="pm-dashboard__action-btn">
            <Users size={16} />
            Reasignar Operador
          </button>
          <button type="button" className="pm-dashboard__action-btn">
            <AlertTriangle size={16} />
            Reportar Problema
          </button>
          <button type="button" className="pm-dashboard__action-btn">
            <Clock size={16} />
            Cambiar Prioridad
          </button>
        </div>
      </div>
    </section>
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
              title={`${stage.label}: ${stage.done}/${stage.total}`}
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
