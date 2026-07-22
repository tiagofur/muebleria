/**
 * Projects list view — toolbar + search + card grid + empty states.
 * Extracted from ProjectsScreen.tsx renderList (F058c).
 */

import type { ReactNode } from 'react';
import {
  FileText,
  LayoutTemplate,
  Package,
  Plus,
  SearchX,
} from 'lucide-react';
import type { Customer, Project, ProjectTemplate } from '@muebles/domain';
import {
  EmptyState,
  SearchInput,
} from '../../common';
import { resolveCustomerName, formatIsoDate } from '../projectHelpers';
import { StatusBadge } from './StatusBadge';

export interface ProjectsListViewProps {
  readonly projects: readonly Project[];
  readonly filtered: readonly Project[];
  readonly customers: readonly Customer[] | undefined;
  readonly projectTemplates: readonly ProjectTemplate[] | undefined;
  readonly search: string;
  readonly isTrulyEmpty: boolean;
  readonly isFilterEmpty: boolean;
  readonly canMutate: boolean;
  readonly hasCreateFromTemplate: boolean;
  readonly hasDeleteTemplate: boolean;
  readonly estimateLabel: (projectId: string) => ReactNode;
  readonly onSearchChange: (value: string) => void;
  readonly onNewProject: () => void;
  readonly onFromTemplate: () => void;
  readonly onManageTemplates: () => void;
  readonly onOpenProject: (project: Project) => void;
}

export function ProjectsListView({
  projects,
  filtered,
  customers,
  projectTemplates,
  search,
  isTrulyEmpty,
  isFilterEmpty,
  canMutate,
  hasCreateFromTemplate,
  hasDeleteTemplate,
  estimateLabel,
  onSearchChange,
  onNewProject,
  onFromTemplate,
  onManageTemplates,
  onOpenProject,
}: ProjectsListViewProps): ReactNode {
  const hasTemplates =
    projectTemplates && projectTemplates.length > 0;

  return (
    <>
      <div className="catalog-page__header">
        <h2 className="catalog-page__title">Cotizaciones</h2>
        <div className="catalog-page__toolbar">
          {canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onNewProject}
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nueva cotización
            </button>
          ) : null}
          {canMutate && hasTemplates && hasCreateFromTemplate ? (
            <button
              type="button"
              className="btn"
              onClick={onFromTemplate}
              data-testid="new-from-template-btn"
            >
              <LayoutTemplate size={16} strokeWidth={1.5} aria-hidden />
              Desde plantilla
            </button>
          ) : null}
          {canMutate && hasTemplates && hasDeleteTemplate ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onManageTemplates}
              data-testid="manage-templates-btn"
              title="Gestionar plantillas"
            >
              <LayoutTemplate size={16} strokeWidth={1.5} aria-hidden />
              Plantillas
            </button>
          ) : null}
        </div>
      </div>

      {!isTrulyEmpty ? (
        <div className="catalog-page__filters">
          <SearchInput
            value={search}
            onChange={onSearchChange}
            placeholder="Buscar cotizaciones o clientes…"
            aria-label="Buscar cotizaciones"
          />
        </div>
      ) : null}

      {isTrulyEmpty ? (
        <div>
          <EmptyState
            icon={FileText}
            title="No hay cotizaciones"
            description="Creá la primera cotización para un cliente y agregá muebles del catálogo."
            actionLabel="Nueva cotización"
            onAction={onNewProject}
          />
          {canMutate && hasTemplates && hasCreateFromTemplate ? (
            <div style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn"
                onClick={onFromTemplate}
                data-testid="empty-from-template-btn"
              >
                <LayoutTemplate size={16} strokeWidth={1.5} aria-hidden />
                Crear desde plantilla
              </button>
            </div>
          ) : null}
        </div>
      ) : isFilterEmpty ? (
        <EmptyState
          variant="no-results"
          icon={SearchX}
          title="Sin resultados"
          description="No hay cotizaciones que coincidan con la búsqueda."
          actionLabel="Limpiar filtros"
          onAction={() => onSearchChange('')}
        />
      ) : (
        <ul className="project-card-grid" aria-label="Lista de cotizaciones">
          {filtered.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="project-card"
                onClick={() => onOpenProject(project)}
                data-testid={`project-card-${project.id}`}
              >
                <div className="project-card__top">
                  <h3 className="project-card__name">{project.name}</h3>
                  <StatusBadge status={project.status} />
                </div>
                <p className="project-card__client">
                  {resolveCustomerName(project.customerId, customers)}
                </p>
                <div className="project-card__stats">
                  <span className="project-card__stat">
                    <Package size={14} strokeWidth={1.5} aria-hidden />
                    {project.items.length} mueble
                    {project.items.length === 1 ? '' : 's'}
                  </span>
                  <span className="project-card__stat">
                    Act. {formatIsoDate(project.updatedAt)}
                  </span>
                </div>
                <div className="project-card__price">
                  <span className="project-card__price-label">
                    Precio total
                  </span>
                  {estimateLabel(project.id)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
