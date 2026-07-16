/**
 * App home dashboard — presentation only; stats precomputed by shell (F023).
 * Empty workspace: «Primeros pasos» checklist (issue #33).
 */

import type { ProjectStatus } from '@muebles/domain';
import type { ReactNode } from 'react';
import {
  CheckCircle2,
  Circle,
  DollarSign,
  FileText,
  Layers,
  LayoutDashboard,
  Package,
  Plus,
} from 'lucide-react';
import { EmptyState, PageLoading } from '../common';
import '../catalogs/catalogs.css';
import '../projects/projects.css';
import {
  formatIsoDate,
  projectStatusBadgeClass,
  projectStatusLabel,
} from '../projects/projectHelpers';
import {
  formatDashboardMoney,
  shouldShowGettingStarted,
} from './dashboardHelpers';
import './dashboard.css';

export type DashboardRecentProject = {
  readonly id: string;
  readonly name: string;
  readonly customerLabel: string;
  readonly status: ProjectStatus;
  readonly updatedAt: string;
  readonly salePrice: number | null;
};

export type DashboardStats = {
  readonly activeProjects: number;
  readonly monthlyQuotedTotal: number;
  readonly modulesCount: number;
  readonly activeMaterials: number;
};

export type DashboardProps = {
  readonly stats: DashboardStats;
  readonly recentProjects: readonly DashboardRecentProject[];
  /** Total projects in workspace (any status) — for getting-started gate. */
  readonly projectsCount?: number;
  readonly onOpenProject: (projectId: string) => void;
  readonly onNewProject: () => void;
  readonly onNewModule: () => void;
  /** Navigate to materials + open create (shell requestCreateKey). */
  readonly onNewMaterial?: () => void;
  /** When true, show loading instead of stats (workspace gate). */
  readonly loading?: boolean;
};

function StatusBadge({ status }: { readonly status: ProjectStatus }): ReactNode {
  return (
    <span className={`status-badge ${projectStatusBadgeClass(status)}`}>
      <span className="status-badge__dot" aria-hidden>
        ●
      </span>
      {projectStatusLabel(status)}
    </span>
  );
}

type GettingStartedStep = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly done: boolean;
  readonly doneLabel: string;
  readonly actionLabel: string;
  readonly onAction: (() => void) | undefined;
  readonly testId: string;
};

export function Dashboard({
  stats,
  recentProjects,
  projectsCount = recentProjects.length,
  onOpenProject,
  onNewProject,
  onNewModule,
  onNewMaterial,
  loading = false,
}: DashboardProps): ReactNode {
  if (loading) {
    return (
      <section className="dashboard" aria-label="Inicio">
        <PageLoading label="Cargando inicio…" data-testid="dashboard-loading" />
      </section>
    );
  }

  const showGettingStarted = shouldShowGettingStarted({
    modulesCount: stats.modulesCount,
    projectsCount,
  });

  const steps: readonly GettingStartedStep[] = [
    {
      id: 'material',
      title: 'Crear un material',
      description:
        'Tableros del catálogo: base de precios y corte para tus muebles.',
      done: stats.activeMaterials > 0,
      doneLabel:
        stats.activeMaterials === 1
          ? '1 material activo'
          : `${stats.activeMaterials} materiales activos`,
      actionLabel: 'Nuevo material',
      onAction: onNewMaterial,
      testId: 'getting-started-material',
    },
    {
      id: 'module',
      title: 'Crear un mueble',
      description: 'Plantilla reutilizable con piezas de tablero y herrajes.',
      done: stats.modulesCount > 0,
      doneLabel:
        stats.modulesCount === 1
          ? '1 mueble en catálogo'
          : `${stats.modulesCount} muebles en catálogo`,
      actionLabel: 'Nuevo mueble',
      onAction: onNewModule,
      testId: 'getting-started-module',
    },
    {
      id: 'project',
      title: 'Crear una cotización',
      description: 'Cotización para un cliente con opciones y precio de venta.',
      done: projectsCount > 0,
      doneLabel:
        projectsCount === 1 ? '1 cotización' : `${projectsCount} cotizaciones`,
      actionLabel: 'Nueva cotización',
      onAction: onNewProject,
      testId: 'getting-started-project',
    },
  ];

  return (
    <section className="dashboard" aria-label="Inicio">
      <header className="dashboard__header">
        <div className="dashboard__title-row">
          <LayoutDashboard
            className="dashboard__title-icon"
            size={28}
            strokeWidth={1.5}
            aria-hidden
          />
          <div>
            <h2 className="dashboard__title">Inicio</h2>
            <p className="dashboard__subtitle">
              {showGettingStarted
                ? 'Empezá el flujo del taller: material → mueble → cotización'
                : 'Resumen del workspace y accesos rápidos'}
            </p>
          </div>
        </div>
        {/* Empty workspace: no header primary — sole primary lives on the active checklist step. */}
        <div className="dashboard__actions">
          <button
            type="button"
            className={
              showGettingStarted ? 'btn btn--ghost' : 'btn btn--primary'
            }
            onClick={onNewProject}
            data-testid="dashboard-new-project"
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nueva cotización
          </button>
          <button
            type="button"
            className={showGettingStarted ? 'btn btn--ghost' : 'btn'}
            onClick={onNewModule}
            data-testid="dashboard-new-module"
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nuevo mueble
          </button>
        </div>
      </header>

      {showGettingStarted ? (
        <section
          className="dashboard__section dashboard-getting-started"
          aria-labelledby="dashboard-getting-started-title"
          data-testid="dashboard-getting-started"
        >
          <h3
            id="dashboard-getting-started-title"
            className="dashboard__section-title"
          >
            Primeros pasos
          </h3>
          <p className="dashboard-getting-started__lead">
            Completá el flujo básico para cotizar sin pelearte con fórmulas.
          </p>
          <ol className="dashboard-getting-started__list">
            {steps.map((step, index) => (
              <li
                key={step.id}
                className={
                  step.done
                    ? 'dashboard-getting-started__item dashboard-getting-started__item--done'
                    : 'dashboard-getting-started__item'
                }
                data-testid={step.testId}
              >
                <span className="dashboard-getting-started__marker" aria-hidden>
                  {step.done ? (
                    <CheckCircle2 size={22} strokeWidth={1.5} />
                  ) : (
                    <Circle size={22} strokeWidth={1.5} />
                  )}
                </span>
                <div className="dashboard-getting-started__body">
                  <p className="dashboard-getting-started__step-label">
                    Paso {index + 1}
                  </p>
                  <h4 className="dashboard-getting-started__item-title">
                    {step.title}
                  </h4>
                  <p className="dashboard-getting-started__item-desc">
                    {step.description}
                  </p>
                  {step.done ? (
                    <p
                      className="dashboard-getting-started__done-label"
                      data-testid={`${step.testId}-done`}
                    >
                      {step.doneLabel}
                    </p>
                  ) : step.onAction ? (
                    <button
                      type="button"
                      className={
                        steps.find((s) => !s.done)?.id === step.id
                          ? 'btn btn--primary btn--small'
                          : 'btn btn--small'
                      }
                      onClick={step.onAction}
                      data-testid={`${step.testId}-action`}
                    >
                      <Plus size={14} strokeWidth={1.5} aria-hidden />
                      {step.actionLabel}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <>
          <ul className="dashboard__stats" aria-label="Indicadores">
            <li className="dashboard-stat" data-testid="stat-active-projects">
              <span className="dashboard-stat__icon" aria-hidden>
                <FileText size={18} strokeWidth={1.5} />
              </span>
              <p className="dashboard-stat__label">Cotizaciones activas</p>
              <p className="dashboard-stat__value">{stats.activeProjects}</p>
            </li>
            <li className="dashboard-stat" data-testid="stat-monthly-quoted">
              <span className="dashboard-stat__icon" aria-hidden>
                <DollarSign size={18} strokeWidth={1.5} />
              </span>
              <p className="dashboard-stat__label">Total cotizado del mes</p>
              <p className="dashboard-stat__value">
                {formatDashboardMoney(stats.monthlyQuotedTotal)}
              </p>
            </li>
            <li className="dashboard-stat" data-testid="stat-modules">
              <span className="dashboard-stat__icon" aria-hidden>
                <Package size={18} strokeWidth={1.5} />
              </span>
              <p className="dashboard-stat__label">Muebles en catálogo</p>
              <p className="dashboard-stat__value">{stats.modulesCount}</p>
            </li>
            <li className="dashboard-stat" data-testid="stat-materials">
              <span className="dashboard-stat__icon" aria-hidden>
                <Layers size={18} strokeWidth={1.5} />
              </span>
              <p className="dashboard-stat__label">Materiales activos</p>
              <p className="dashboard-stat__value">{stats.activeMaterials}</p>
            </li>
          </ul>

          <section
            className="dashboard__section"
            aria-labelledby="dashboard-recent-title"
          >
            <h3
              id="dashboard-recent-title"
              className="dashboard__section-title"
            >
              Cotizaciones recientes
            </h3>
            {recentProjects.length === 0 ? (
              <EmptyState
                variant="empty"
                icon={FileText}
                title="No hay cotizaciones todavía"
                description="Creá la primera cotización para verla acá y seguir el flujo del taller."
                actionLabel="Nueva cotización"
                onAction={onNewProject}
              />
            ) : (
              <ul
                className="dashboard__recent"
                aria-label="Cotizaciones recientes"
              >
                {recentProjects.map((project) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      className="dashboard-recent-card"
                      data-testid={`dashboard-recent-${project.id}`}
                      onClick={() => onOpenProject(project.id)}
                    >
                      <div className="dashboard-recent-card__top">
                        <h4 className="dashboard-recent-card__name">
                          {project.name}
                        </h4>
                        <StatusBadge status={project.status} />
                      </div>
                      <p className="dashboard-recent-card__client">
                        {project.customerLabel || '—'}
                      </p>
                      <div className="dashboard-recent-card__meta">
                        <span className="dashboard-recent-card__date">
                          {formatIsoDate(project.updatedAt)}
                        </span>
                        {project.salePrice === null ? (
                          <span className="dashboard-recent-card__price dashboard-recent-card__price--muted">
                            —
                          </span>
                        ) : (
                          <span className="dashboard-recent-card__price">
                            {formatDashboardMoney(project.salePrice)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
