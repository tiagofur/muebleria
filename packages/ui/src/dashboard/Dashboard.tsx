/**
 * App home dashboard — presentation only; stats precomputed by shell (F023).
 */

import type { ProjectStatus } from '@muebles/domain';
import type { ReactNode } from 'react';
import {
  DollarSign,
  FileText,
  Layers,
  LayoutDashboard,
  Package,
  Plus,
} from 'lucide-react';
import '../catalogs/catalogs.css';
import '../projects/projects.css';
import {
  formatIsoDate,
  projectStatusBadgeClass,
  projectStatusLabel,
} from '../projects/projectHelpers';
import { formatDashboardMoney } from './dashboardHelpers';
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
  readonly onOpenProject: (projectId: string) => void;
  readonly onNewProject: () => void;
  readonly onNewModule: () => void;
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

export function Dashboard({
  stats,
  recentProjects,
  onOpenProject,
  onNewProject,
  onNewModule,
}: DashboardProps): ReactNode {
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
              Resumen del workspace y accesos rápidos
            </p>
          </div>
        </div>
        <div className="dashboard__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={onNewProject}
            data-testid="dashboard-new-project"
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nueva cotización
          </button>
          <button
            type="button"
            className="btn"
            onClick={onNewModule}
            data-testid="dashboard-new-module"
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nuevo mueble
          </button>
        </div>
      </header>

      <ul className="dashboard__stats" aria-label="Indicadores">
        <li className="dashboard-stat" data-testid="stat-active-projects">
          <span className="dashboard-stat__icon" aria-hidden>
            <FileText size={18} strokeWidth={1.5} />
          </span>
          <p className="dashboard-stat__label">Proyectos activos</p>
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
          <p className="dashboard-stat__label">Módulos en catálogo</p>
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

      <section className="dashboard__section" aria-labelledby="dashboard-recent-title">
        <h3 id="dashboard-recent-title" className="dashboard__section-title">
          Cotizaciones recientes
        </h3>
        {recentProjects.length === 0 ? (
          <p className="dashboard__empty" role="status">
            No hay cotizaciones todavía. Creá la primera con «Nueva cotización».
          </p>
        ) : (
          <ul className="dashboard__recent" aria-label="Cotizaciones recientes">
            {recentProjects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className="dashboard-recent-card"
                  data-testid={`dashboard-recent-${project.id}`}
                  onClick={() => onOpenProject(project.id)}
                >
                  <div className="dashboard-recent-card__top">
                    <h4 className="dashboard-recent-card__name">{project.name}</h4>
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
    </section>
  );
}
