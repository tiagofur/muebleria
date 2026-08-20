/**
 * Factory floor project list and row component for ProductionManagerDashboard.
 */

import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import type { Project, ProjectFloorSummary } from '@muebles/domain';
import { PRODUCTION_SECTOR_LABELS_ES } from '@muebles/domain';
import { EmptyState } from '../../common';
import { SectorIcon } from './ProductionManagerSectorsGrid';

export interface ProductionProjectItem {
  readonly project: Project;
  readonly summary: ProjectFloorSummary;
}

export function ProjectDashboardRow({
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
}): ReactNode {
  const hasItems = summary.totalItems > 0;
  const activeSectorLabel = !hasItems
    ? 'Sin módulos cargados'
    : summary.activeSector
      ? PRODUCTION_SECTOR_LABELS_ES[summary.activeSector]
      : 'Completado';

  return (
    <div
      className="pm-dashboard__project-row"
      data-testid={`pm-project-row-${project.id}`}
    >
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
          <span>
            {hasItems ? `En ${activeSectorLabel}` : activeSectorLabel}
          </span>
        </div>
      </div>

      <div className="pm-dashboard__project-progress">
        <div className="pm-dashboard__progress-bar">
          <div
            className="pm-dashboard__progress-fill"
            style={{ width: `${summary.percentage}%` }}
            role="progressbar"
            aria-label={`Avance de ${project.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.percentage}
          />
        </div>
        <span className="pm-dashboard__progress-text">
          {hasItems ? `${summary.percentage.toFixed(2)}%` : '—'}
        </span>
      </div>

      {hasItems ? (
        <div className="pm-dashboard__project-stages">
          {summary.stages.map((stage) => {
            const done = stage.done >= stage.total;
            const active = summary.activeSector === stage.sector;
            return (
              <div
                key={stage.sector}
                className={`pm-dashboard__stage ${
                  done
                    ? 'pm-dashboard__stage--done'
                    : active
                      ? 'pm-dashboard__stage--active'
                      : ''
                }`}
                aria-label={`${PRODUCTION_SECTOR_LABELS_ES[stage.sector]}: ${stage.done}/${stage.total}`}
              >
                <span className="pm-dashboard__stage-icon">
                  <SectorIcon sector={stage.sector} size={14} />
                </span>
                <span className="pm-dashboard__stage-count">
                  {stage.done}/{stage.total}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <span
          className="pm-dashboard__project-meta"
          data-testid={`pm-project-empty-${project.id}`}
        >
          <CircleAlert size={14} strokeWidth={1.5} aria-hidden />
          Sin módulos cargados
        </span>
      )}
    </div>
  );
}

export interface ProductionManagerProjectsTableProps {
  readonly productionProjects: readonly ProductionProjectItem[];
  readonly customerLabelFor?: (customerId: string) => string;
  readonly onOpenProject?: (projectId: string) => void;
  readonly onOpenOrder?: (projectId: string) => void;
}

export function ProductionManagerProjectsTable({
  productionProjects,
  customerLabelFor,
  onOpenProject,
  onOpenOrder,
}: ProductionManagerProjectsTableProps): ReactNode {
  return (
    <div className="pm-dashboard__projects">
      <h3 className="pm-dashboard__section-title">Proyectos en Producción</h3>

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
  );
}
