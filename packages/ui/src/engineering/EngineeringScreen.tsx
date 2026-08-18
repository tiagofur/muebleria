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
  Clock,
  FileCheck,
  FileText,
  SearchX,
} from 'lucide-react';

import './engineering.css';

import {
  engineeringStatus,
  ENGINEERING_STATUS_LABELS_ES,
  projectProcessStage,
  type EngineeringStatus,
  type Project,
} from '@muebles/domain';
import { EmptyState, SearchInput } from '../common';

type ProjectWithCustomer = Project & { readonly customerLabel?: string };

/** Status filter options. */
const STATUS_FILTERS: readonly EngineeringStatus[] = [
  'pending',
  'in_progress',
  'documented',
];

/** Status → stat card icon. */
const STATUS_ICON: Readonly<Record<EngineeringStatus, typeof ClipboardList>> = {
  pending: Clock,
  in_progress: FileText,
  documented: FileCheck,
};

export function EngineeringScreen({
  projects,
  onStartEngineering,
  onOpenProject,
  currentUserId,
}: {
  /** All projects (already role-filtered). */
  readonly projects: readonly ProjectWithCustomer[];
  /** Called when user clicks "Iniciar ingeniería" on a pending project. */
  readonly onStartEngineering: (projectId: string) => void;
  /** Called when user clicks a project row to open the workspace. */
  readonly onOpenProject: (projectId: string) => void;
  /** Current user id for display. */
  readonly currentUserId?: string;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EngineeringStatus | null>(null);

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
    if (statusFilter) {
      result = result.filter((p) => engineeringStatus(p.engineeringLog) === statusFilter);
    }
    return result;
  }, [queue, search, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<EngineeringStatus, number> = { pending: 0, in_progress: 0, documented: 0 };
    for (const p of queue) {
      c[engineeringStatus(p.engineeringLog)]++;
    }
    return c;
  }, [queue]);

  return (
    <section className="eng-landing" aria-label="Ingeniería">
      {/* Header */}
      <header className="eng-landing__header">
        <div>
          <h2 className="eng-landing__title">Ingeniería</h2>
          <p className="eng-landing__subtitle">
            Documentación técnica, optimización y preparación de producción por proyecto.
          </p>
        </div>
      </header>

      {/* Stat cards */}
      <div className="eng-stats">
        {STATUS_FILTERS.map((s) => {
          const Icon = STATUS_ICON[s];
          const isActive = statusFilter === s;
          return (
            <button
              key={s}
              type="button"
              className={`eng-stat ${isActive ? 'eng-stat--active' : ''}`}
              onClick={() => setStatusFilter(isActive ? null : s)}
              data-testid={`eng-stat-${s}`}
            >
              <span className={`eng-stat__icon eng-stat__icon--${s}`}>
                <Icon size={18} strokeWidth={1.5} />
              </span>
              <div className="eng-stat__body">
                <span className="eng-stat__value">{counts[s]}</span>
                <span className="eng-stat__label">{ENGINEERING_STATUS_LABELS_ES[s]}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="eng-landing__toolbar">
        <div className="eng-landing__search">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar proyecto..." />
        </div>
      </div>

      {/* Project list */}
      {filtered.length === 0 && queue.length > 0 ? (
        <EmptyState
          icon={SearchX}
          title="Sin resultados"
          description="No hay proyectos que coincidan con los filtros."
          actionLabel="Limpiar filtros"
          onAction={() => { setSearch(''); setStatusFilter(null); }}
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
                className={`eng-project-card eng-project-card--${status}`}
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
                    <span className={`eng-badge eng-badge--${status}`}>
                      {ENGINEERING_STATUS_LABELS_ES[status]}
                    </span>
                  </div>
                </button>
                {status === 'pending' && (
                  <div className="eng-project-card__action">
                    <button
                      type="button"
                      className="btn btn--primary btn--small"
                      onClick={(e) => { e.stopPropagation(); onStartEngineering(project.id); }}
                    >
                      <FileText size={14} strokeWidth={1.5} />
                      Iniciar
                    </button>
                  </div>
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
                    <span className="eng-badge eng-badge--documented">
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
