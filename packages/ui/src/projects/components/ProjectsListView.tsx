/**
 * Projects list view — toolbar + search + status chips + card grid + empty states.
 * Extracted from ProjectsScreen.tsx renderList (F058c).
 * Fase 2 UI: status chips + EmptyState secondary CTA (from template).
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
  PageHeader,
  PageToolbar,
  SearchInput,
  StatusChips,
} from '../../common';
import {
  PROJECT_STATUS_FILTER_OPTIONS,
  resolveCustomerName,
  formatIsoDate,
  type ProjectStatusFilter,
} from '../projectHelpers';
import { StatusBadge } from './StatusBadge';

export interface ProjectsListViewProps {
  readonly projects: readonly Project[];
  readonly filtered: readonly Project[];
  readonly customers: readonly Customer[] | undefined;
  readonly projectTemplates: readonly ProjectTemplate[] | undefined;
  readonly search: string;
  readonly statusFilter: ProjectStatusFilter;
  readonly isTrulyEmpty: boolean;
  readonly isFilterEmpty: boolean;
  readonly canMutate: boolean;
  readonly hasCreateFromTemplate: boolean;
  readonly hasDeleteTemplate: boolean;
  readonly estimateLabel: (projectId: string) => ReactNode;
  readonly onSearchChange: (value: string) => void;
  readonly onStatusFilterChange: (value: ProjectStatusFilter) => void;
  readonly onClearFilters: () => void;
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
  statusFilter,
  isTrulyEmpty,
  isFilterEmpty,
  canMutate,
  hasCreateFromTemplate,
  hasDeleteTemplate,
  estimateLabel,
  onSearchChange,
  onStatusFilterChange,
  onClearFilters,
  onNewProject,
  onFromTemplate,
  onManageTemplates,
  onOpenProject,
}: ProjectsListViewProps): ReactNode {
  const hasTemplates =
    projectTemplates && projectTemplates.length > 0;
  const showTemplateSecondary =
    Boolean(canMutate && hasTemplates && hasCreateFromTemplate);

  return (
    <>
      <PageHeader
        title="Cotizaciones"
        primaryAction={
          canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onNewProject}
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nueva cotización
            </button>
          ) : undefined
        }
        overflowActions={
          canMutate && hasTemplates
            ? [
                ...(hasCreateFromTemplate
                  ? [
                      {
                        id: 'from-template',
                        label: 'Desde plantilla',
                        onSelect: onFromTemplate,
                      },
                    ]
                  : []),
                ...(hasDeleteTemplate
                  ? [
                      {
                        id: 'manage-templates',
                        label: 'Gestionar plantillas',
                        onSelect: onManageTemplates,
                      },
                    ]
                  : []),
              ]
            : []
        }
      />

      {!isTrulyEmpty ? (
        <PageToolbar
          ariaLabel="Buscar y filtrar cotizaciones"
          search={
            <SearchInput
              value={search}
              onChange={onSearchChange}
              placeholder="Buscar cotizaciones o clientes…"
              aria-label="Buscar cotizaciones"
            />
          }
          filters={
            <StatusChips
              value={statusFilter}
              onChange={onStatusFilterChange}
              options={PROJECT_STATUS_FILTER_OPTIONS}
              aria-label="Filtrar cotizaciones por estado"
              data-testid="project-status-chips"
            />
          }
        />
      ) : null}

      {isTrulyEmpty ? (
        <EmptyState
          icon={FileText}
          title="No hay cotizaciones"
          description="Creá la primera cotización para un cliente y agregá muebles del catálogo."
          actionLabel={canMutate ? 'Nueva cotización' : undefined}
          onAction={canMutate ? onNewProject : undefined}
          secondaryActionLabel={
            showTemplateSecondary ? 'Crear desde plantilla' : undefined
          }
          onSecondaryAction={
            showTemplateSecondary ? onFromTemplate : undefined
          }
          secondaryActionTestId="empty-from-template-btn"
        />
      ) : isFilterEmpty ? (
        <EmptyState
          variant="no-results"
          icon={SearchX}
          title="Sin resultados"
          description={
            statusFilter !== 'all'
              ? 'No hay cotizaciones con ese estado (ni que coincidan con la búsqueda).'
              : 'No hay cotizaciones que coincidan con la búsqueda.'
          }
          actionLabel="Limpiar filtros"
          onAction={onClearFilters}
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
