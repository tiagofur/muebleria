/**
 * Projects list view — toolbar + search + status chips + card grid + empty states.
 * Extracted from ProjectsScreen.tsx renderList (F058c).
 * Fase 2 UI: status chips + EmptyState secondary CTA (from template).
 * #642 / 2A: every card consumes the batch commercial summaries read model —
 * loading/error/none are distinct dataset states and a valid snapshot owns the
 * frozen identity (name, customer, currency, total, active quantity).
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
  type CommercialSummariesStatus,
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
  /** Dataset state of the batch summaries request — loading/error are never "Sin cotización". */
  readonly commercialSummariesStatus?: CommercialSummariesStatus;
  readonly commercialSummariesError?: string | null;
  readonly onRetryCommercialSummaries?: () => void;
  readonly commercialFiltersDisabled?: boolean;
  readonly isTrulyEmpty: boolean;
  readonly isFilterEmpty: boolean;
  readonly canMutate: boolean;
  readonly hasCreateFromTemplate: boolean;
  readonly hasDeleteTemplate: boolean;
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
  commercialSummariesStatus = 'ready',
  commercialSummariesError,
  onRetryCommercialSummaries,
  commercialFiltersDisabled = false,
  isTrulyEmpty,
  isFilterEmpty,
  canMutate,
  hasCreateFromTemplate,
  hasDeleteTemplate,
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

  // Dataset gates (#642 / 2A): the commercial representation of every card is
  // authoritative ONLY while the batch request is ready. Loading keeps the
  // badge pending; error surfaces the banner and never "Sin cotización".
  const summariesReady = commercialSummariesStatus === 'ready';
  const summariesFailed = commercialSummariesStatus === 'error';

  const cardIdentity = (
    project: Project,
    summary?: ProjectCommercialSummary,
  ): { readonly name: string; readonly customer: string | null } => {
    // Frozen identity: a valid snapshot owns the historical name. Projects
    // without a revision (none) or with a legacy revision keep their CURRENT
    // project identity — the only identity the contract can assert there.
    const frozen =
      summariesReady &&
      summary != null &&
      !summary.isLegacy &&
      summary.quoteStatus !== 'none';
    return {
      name: frozen ? summary.projectName : project.name,
      customer: !summariesReady
        ? null
        : frozen && summary.customerName != null
          ? summary.customerName
          : resolveCustomerName(project.customerId, customers),
    };
  };

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
              disabled={commercialFiltersDisabled}
              aria-label="Filtrar cotizaciones por estado"
              data-testid="project-status-chips"
            />
          }
        />
      ) : null}

      {summariesFailed ? (
        <div
          className="alert alert--danger"
          role="alert"
          data-testid="commercial-summaries-error"
        >
          <span>No se pudo cargar la información comercial.</span>
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
            const identity = cardIdentity(project, summary);
            // Loading/error keep navigation identity only: no legacy price,
            // no mutable quantity, no Project activity as commercial truth.
            const furnitureCount = summariesReady
              ? (summary?.furnitureQuantity ?? 0)
              : null;
            const activityDate =
              summariesReady ? (summary?.commercialActivityAt ?? null) : null;
            const formattedTotal =
              summariesReady && summary?.saleTotal != null
                ? formatMoneyDisplay(summary.saleTotal, { currency: summary.currency })
                : null;

            return (
              <li key={project.id}>
                <button
                  type="button"
                  className="project-card"
                  onClick={() => onOpenProject(project)}
                  data-testid={`project-card-${project.id}`}
                >
                  <div className="project-card__top">
                    <h3 className="project-card__name">{identity.name}</h3>
                    <CommercialStatusBadge
                      summary={summary}
                      loading={!summariesReady && !summariesFailed}
                      error={summariesFailed}
                    />
                  </div>
                  {identity.customer != null ? (
                    <p className="project-card__client">{identity.customer}</p>
                  ) : null}
                  <div className="project-card__stats">
                    {furnitureCount != null ? (
                      <span className="project-card__stat">
                        <Package size={14} strokeWidth={1.5} aria-hidden />
                        {furnitureCount} mueble
                        {furnitureCount === 1 ? '' : 's'}
                      </span>
                    ) : null}
                    {activityDate != null ? (
                      <span className="project-card__stat">
                        Act. {formatIsoDate(activityDate)}
                      </span>
                    ) : null}
                  </div>
                  {summariesReady && summary?.activeDraftRevisionNumber != null ? (
                    <div className="project-card__substat">
                      Q{summary.activeDraftRevisionNumber} en borrador
                    </div>
                  ) : null}
                  {summariesReady && summary?.isLegacy ? (
                    <div className="project-card__legacy">
                      <span className="badge badge--neutral-subtle">
                        Cotización anterior
                      </span>
                    </div>
                  ) : null}
                  <div className="project-card__price">
                    <span className="project-card__price-label">
                      Precio total
                    </span>
                    {formattedTotal != null ? (
                      <span className="project-card__price-value">
                        {formattedTotal}
                      </span>
                    ) : (
                      <span className="project-card__price-value project-card__price-value--muted">
                        —
                      </span>
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
