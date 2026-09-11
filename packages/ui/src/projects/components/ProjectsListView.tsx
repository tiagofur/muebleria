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
import type { Customer, Project, ProjectTemplate } from '@granete/domain';
import type { ProjectCommercialSummary } from '@granete/storage';
import {
  EmptyState,
  PageHeader,
  PageToolbar,
  SearchInput,
  StatusChips,
} from '../../common';
import { formatMoneyDisplay } from '../../common/formatMoneyDisplay';
import {
  resolveCustomerName,
  formatIsoDate,
} from '../projectHelpers';
import {
  QUOTE_COMMERCIAL_FILTER_OPTIONS,
  type QuoteCommercialStatusFilter,
} from '../quoteRevisionPresentation';
import { CommercialStatusBadge } from './CommercialStatusBadge';

export interface ProjectsListViewProps {
  readonly projects: readonly Project[];
  readonly filtered: readonly Project[];
  readonly customers: readonly Customer[] | undefined;
  readonly projectTemplates: readonly ProjectTemplate[] | undefined;
  readonly search: string;
  readonly statusFilter: QuoteCommercialStatusFilter;
  readonly commercialSummaries?: ReadonlyMap<string, ProjectCommercialSummary> | undefined;
  readonly commercialSummariesLoading?: boolean;
  readonly commercialSummariesError?: string | null;
  readonly onRetryCommercialSummaries?: () => void;
  readonly isTrulyEmpty: boolean;
  readonly isFilterEmpty: boolean;
  readonly canMutate: boolean;
  readonly hasCreateFromTemplate: boolean;
  readonly hasDeleteTemplate: boolean;
  readonly estimateLabel: (projectId: string) => ReactNode;
  readonly onSearchChange: (value: string) => void;
  readonly onStatusFilterChange: (value: QuoteCommercialStatusFilter) => void;
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
  commercialSummaries,
  commercialSummariesLoading,
  commercialSummariesError,
  onRetryCommercialSummaries,
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
              options={QUOTE_COMMERCIAL_FILTER_OPTIONS}
              aria-label="Filtrar cotizaciones por estado"
              data-testid="project-status-chips"
            />
          }
        />
      ) : null}

      {commercialSummariesError ? (
        <div
          className="alert alert--danger"
          role="alert"
          style={{
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>
            No se pudieron cargar los estados comerciales: {commercialSummariesError}
          </span>
          {onRetryCommercialSummaries ? (
            <button
              type="button"
              className="btn btn--small btn--secondary"
              onClick={onRetryCommercialSummaries}
            >
              Reintentar
            </button>
          ) : null}
        </div>
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
          {filtered.map((project) => {
            const summary = commercialSummaries?.get(project.id);
            const furnitureCount =
              summary?.furnitureQuantity ?? project.items.length;
            const activityDate =
              summary?.commercialActivityAt ?? project.updatedAt;
            const formattedTotal =
              summary?.saleTotal != null
                ? formatMoneyDisplay(summary.saleTotal, { currency: summary.currency })
                : '—';

            return (
              <li key={project.id}>
                <button
                  type="button"
                  className="project-card"
                  onClick={() => onOpenProject(project)}
                  data-testid={`project-card-${project.id}`}
                >
                  <div className="project-card__top">
                    <h3 className="project-card__name">{project.name}</h3>
                    <CommercialStatusBadge
                      summary={summary}
                      loading={commercialSummariesLoading}
                    />
                  </div>
                  <p className="project-card__client">
                    {resolveCustomerName(project.customerId, customers)}
                  </p>
                  <div className="project-card__stats">
                    <span className="project-card__stat">
                      <Package size={14} strokeWidth={1.5} aria-hidden />
                      {furnitureCount} mueble
                      {furnitureCount === 1 ? '' : 's'}
                    </span>
                    <span className="project-card__stat">
                      Act. {formatIsoDate(activityDate)}
                    </span>
                  </div>
                  {summary?.activeDraftRevisionNumber != null ? (
                    <div
                      className="project-card__substat"
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                        marginTop: '0.25rem',
                      }}
                    >
                      Q{summary.activeDraftRevisionNumber} en borrador
                    </div>
                  ) : null}
                  {summary?.isLegacy ? (
                    <div
                      className="project-card__legacy-badge"
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        marginTop: '0.25rem',
                      }}
                    >
                      <span className="badge badge--neutral-subtle">
                        Cotización anterior
                      </span>
                    </div>
                  ) : null}
                  <div className="project-card__price">
                    <span className="project-card__price-label">
                      Precio total
                    </span>
                    {summary ? (
                      <span
                        className={
                          summary.saleTotal == null
                            ? 'project-card__price-value project-card__price-value--muted'
                            : 'project-card__price-value'
                        }
                      >
                        {formattedTotal}
                      </span>
                    ) : (
                      estimateLabel(project.id)
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
