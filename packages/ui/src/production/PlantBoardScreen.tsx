import { useMemo } from 'react';
import { KanbanSquare } from 'lucide-react';

import {
  buildProjectFloorSummary,
  PRODUCTION_SECTOR_LABELS_ES,
  PIPELINE_SECTORS,
  type ProjectFloorSummary,
} from '@muebles/domain';
import type { Project } from '@muebles/domain';
import { EmptyState, PageHeader } from '../common';

/**
 * Estado de Planta (F093 — Fase 1 visibilidad): every project in the
 * factory as a row, every sector as a column. Read-only, visible to all
 * roles with access to the projects (sales answers "¿en qué está mi
 * obra?" without entering the production hub).
 */
export function PlantBoardScreen({
  projects,
  customerLabelFor,
  onOpenProject,
  onOpenOrder,
  testId,
}: {
  /** Projects visible to the current user (ownership already applied). */
  readonly projects: readonly Project[];
  readonly customerLabelFor?: (customerId: string) => string;
  readonly onOpenProject?: (projectId: string) => void;
  /** Only wired when the role may enter the production hub. */
  readonly onOpenOrder?: (projectId: string) => void;
  readonly testId?: string;
}) {
  const rows = useMemo(() => {
    return projects
      .filter((p) => p.status === 'accepted' || p.status === 'produced')
      .map((project) => ({
        project,
        summary: buildProjectFloorSummary(project),
      }));
  }, [projects]);

  return (
    <section className="plant-board" aria-label="Estado de planta">
      <PageHeader
        title="Estado de Planta"
        subtitle="Dónde está cada obra en el taller, por sector. Solo lectura — el avance se marca desde Producción."
        icon={<KanbanSquare size={16} strokeWidth={1.5} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Sin obras en fábrica"
          description="Cuando aceptes una cotización, el avance por sector aparece acá para todo el taller."
        />
      ) : (
        <div className="plant-board__scroll">
          <table className="plant-board__table" data-testid={testId ?? 'plant-board-table'}>
            <thead>
              <tr>
                <th scope="col" className="plant-board__th plant-board__th--project">
                  Obra
                </th>
                {PIPELINE_SECTORS.map((sector) => (
                  <th key={sector} scope="col" className="plant-board__th">
                    {PRODUCTION_SECTOR_LABELS_ES[sector]}
                  </th>
                ))}
                <th scope="col" className="plant-board__th plant-board__th--pct">
                  Avance
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ project, summary }) => (
                <PlantBoardRow
                  key={project.id}
                  project={project}
                  summary={summary}
                  customerLabelFor={customerLabelFor}
                  onOpenProject={onOpenProject}
                  onOpenOrder={onOpenOrder}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PlantBoardRow({
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
  return (
    <tr className="plant-board__row" data-testid={`plant-board-row-${project.id}`}>
      <td className="plant-board__td plant-board__td--project">
        {onOpenOrder ? (
          <button
            type="button"
            className="plant-board__open-order"
            onClick={() => onOpenOrder(project.id)}
            data-testid={`plant-board-open-order-${project.id}`}
            title="Abrir la orden de producción"
          >
            {project.name}
          </button>
        ) : onOpenProject ? (
          <button
            type="button"
            className="plant-board__open-project"
            onClick={() => onOpenProject(project.id)}
            data-testid={`plant-board-open-project-${project.id}`}
          >
            {project.name}
          </button>
        ) : (
          <span className="plant-board__name">{project.name}</span>
        )}
        <span className="plant-board__customer">
          {customerLabelFor?.(project.customerId) || '—'}
        </span>
        <span className="plant-board__counts">
          {summary.totalItems}{' '}
          {summary.totalItems === 1 ? 'mueble' : 'muebles'}
        </span>
      </td>
      {summary.stages.map((stage) => {
        const done = stage.done >= stage.total;
        const active = summary.activeSector === stage.sector;
        const cls = done
          ? 'plant-board__td plant-board__td--done'
          : active
            ? 'plant-board__td plant-board__td--active'
            : 'plant-board__td';
        return (
          <td key={stage.sector} className={cls}>
            <span className="plant-board__cell-count">
              {stage.done}/{stage.total}
            </span>
            {!done && stage.waiting > 0 ? (
              <span className="plant-board__cell-waiting">
                {stage.waiting} en cola
              </span>
            ) : null}
          </td>
        );
      })}
      <td className="plant-board__td plant-board__td--pct">
        <span className="plant-board__pct">{summary.percentage}%</span>
        {summary.activeSector ? (
          <span className="plant-board__bottleneck">
            en {PRODUCTION_SECTOR_LABELS_ES[summary.activeSector]}
          </span>
        ) : (
          <span className="plant-board__bottleneck plant-board__bottleneck--done">
            completo
          </span>
        )}
      </td>
    </tr>
  );
}
