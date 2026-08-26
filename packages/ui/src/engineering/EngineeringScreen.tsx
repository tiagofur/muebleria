/**
 * EngineeringScreen — Landing page for the engineering workspace.
 *
 * Shows a stat summary bar + project cards with engineering status.
 * Engineers can start or continue engineering work on a project.
 *
 * Design: follows eng-landing pattern from engineering.css.
 */

import { useMemo, useState } from 'react';
import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  SearchX,
} from 'lucide-react';

import './engineering.css';

import {
  engineeringStatus,
  ENGINEERING_STATUS_LABELS_ES,
  projectProcessStage,
  type EngineeringStatus,
  type Project,
} from '@granete/domain';
import {
  EmptyState,
  PageHeader,
  PageToolbar,
  SearchInput,
  StatusChips,
  type StatusChipOption,
} from '../common';

type ProjectWithCustomer = Project & { readonly customerLabel?: string };

type FilterStatus = EngineeringStatus | 'all';

const STATUS_CHIP_OPTIONS: readonly StatusChipOption<FilterStatus>[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'in_progress', label: 'En proceso' },
  { value: 'documented', label: 'Documentados' },
];

/** Engineering status → semantic status-badge modifier (design.md §5.2). */
const STATUS_BADGE_MODIFIER: Readonly<Record<EngineeringStatus, string>> = {
  pending: 'open',
  in_progress: 'progress',
  documented: 'done',
};

export function EngineeringScreen({
  projects,
  onStartEngineering,
  onOpenProject,
  onOpenDashboard,
  currentUserId,
}: {
  /** All projects (already role-filtered). */
  readonly projects: readonly ProjectWithCustomer[];
  /** Called when user clicks "Iniciar ingeniería" on a pending project. */
  readonly onStartEngineering: (projectId: string) => void;
  /** Called when user clicks a project row to open the workspace. */
  readonly onOpenProject: (projectId: string) => void;
  /** Optional navigation to the Engineering Dashboard. */
  readonly onOpenDashboard?: () => void;
  /** Current user id for display. */
  readonly currentUserId?: string;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');

  // Process stage gating — the working queue is ONLY projects in the
  // ingeniería stage (accepted, engineering not sent yet). Projects already
  // sent to Almacén/Producción move to the read-only "Enviadas" section.
  const queue = useMemo(
    () => projects.filter((p) => projectProcessStage(p) === 'ingenieria'),
    [projects],
  );
  const sent = useMemo(
    () =>
      projects.filter((p) => {
        const stage = projectProcessStage(p);
        return stage === 'almacen' || stage === 'produccion';
      }),
    [projects],
  );

  const filtered = useMemo(() => {
    let result = queue;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.customerLabel ?? '').toLowerCase().includes(q),
      );
    }
    if (statusFilter !== 'all') {
      result = result.filter((p) => engineeringStatus(p.engineeringLog) === statusFilter);
    }
    return result;
  }, [queue, search, statusFilter]);

  return (
    <section className="eng-landing" aria-label="Ingeniería">
      <PageHeader
        title="Ingeniería"
        subtitle="Cola de documentación técnica, despiece y preparación de producción por proyecto."
        secondaryActions={
          onOpenDashboard ? (
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={onOpenDashboard}
              data-testid="eng-goto-dashboard"
            >
              <LayoutDashboard size={14} strokeWidth={1.5} />
              Dashboard
            </button>
          ) : undefined
        }
      />

      <PageToolbar
        ariaLabel="Buscar y filtrar proyectos de ingeniería"
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar proyecto..."
            aria-label="Buscar proyecto de ingeniería"
          />
        }
        filters={
          <StatusChips<FilterStatus>
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_CHIP_OPTIONS}
            aria-label="Filtrar por estado de ingeniería"
            data-testid="eng-status-chips"
          />
        }
      />

      {/* Project list */}
      {filtered.length === 0 && queue.length > 0 ? (
        <EmptyState
          icon={SearchX}
          title="Sin resultados"
          description="No hay proyectos que coincidan con los filtros."
          actionLabel="Limpiar filtros"
          onAction={() => { setSearch(''); setStatusFilter('all'); }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No hay obras para ingeniería"
          description="Cuando Ventas acepte una cotización, la obra aparece aquí para documentación técnica."
        />
      ) : (
        <ul className="eng-project-list">
          {filtered.map((project) => {
            const status = engineeringStatus(project.engineeringLog);
            const log = project.engineeringLog;
            return (
              <li
                key={project.id}
                className={`eng-project-card${status === 'pending' ? ' eng-project-card--startable' : ''}`}
                data-testid={`eng-project-${project.id}`}
              >
                <button
                  type="button"
                  className="eng-project-card__body"
                  onClick={() => onOpenProject(project.id)}
                >
                  <div className="eng-project-card__main">
                    <span className="eng-project-card__name">{project.name}</span>
                    {project.customerLabel ? (
                      <span className="eng-project-card__customer">
                        {project.customerLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="eng-project-card__meta">
                    {log?.startedAt ? (
                      <div className="eng-project-card__date-block">
                        <span className="eng-project-card__date-label">Inicio</span>
                        <span className="eng-project-card__date-value">
                          {new Date(log.startedAt).toLocaleDateString('es-AR')}
                        </span>
                      </div>
                    ) : null}
                    {log?.generatedAt ? (
                      <div className="eng-project-card__date-block">
                        <span className="eng-project-card__date-label">Docs</span>
                        <span className="eng-project-card__date-value">
                          {new Date(log.generatedAt).toLocaleDateString('es-AR')}
                        </span>
                      </div>
                    ) : null}
                    {log?.revision ? (
                      <span className="eng-project-card__revision">
                        Rev. {log.revision}
                      </span>
                    ) : null}
                    <span className={`status-badge status-badge--${STATUS_BADGE_MODIFIER[status]}`}>
                      <span className="status-badge__dot" aria-hidden>●</span>
                      {ENGINEERING_STATUS_LABELS_ES[status]}
                    </span>
                    {status === 'pending' && (
                      <span className="eng-project-card__start-slot" aria-hidden />
                    )}
                  </div>
                </button>
                {status === 'pending' && (
                  <button
                    type="button"
                    className="btn btn--primary btn--small eng-project-card__start"
                    onClick={(e) => { e.stopPropagation(); onStartEngineering(project.id); }}
                  >
                    <FileText size={14} strokeWidth={1.5} />
                    Iniciar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Sent works — read-only traceability (almacén / producción stage) */}
      {sent.length > 0 ? (
        <div className="eng-landing__sent">
          <h3 className="eng-landing__sent-title">
            Enviadas a producción ({sent.length})
          </h3>
          <ul className="eng-project-list eng-project-list--sent">
            {sent.map((project) => (
              <li
                key={project.id}
                className="eng-project-card eng-project-card--sent"
                data-testid={`eng-sent-${project.id}`}
              >
                <button
                  type="button"
                  className="eng-project-card__body"
                  onClick={() => onOpenProject(project.id)}
                >
                  <div className="eng-project-card__main">
                    <span className="eng-project-card__name">{project.name}</span>
                    {project.customerLabel ? (
                      <span className="eng-project-card__customer">
                        {project.customerLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="eng-project-card__meta">
                    {project.engineeringLog?.sentToProductionAt ? (
                      <span className="eng-project-card__date-value">
                        Enviada{' '}
                        {new Date(
                          project.engineeringLog.sentToProductionAt,
                        ).toLocaleDateString('es-AR')}
                      </span>
                    ) : null}
                    <span
                      className={`status-badge status-badge--${project.materialsRelease ? 'progress' : 'cancelled'}`}
                    >
                      <span className="status-badge__dot" aria-hidden>●</span>
                      {project.materialsRelease
                        ? 'En producción'
                        : 'En almacén'}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
