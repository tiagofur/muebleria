/**
 * Projects list view — toolbar + search + status chips + card grid + empty states.
 * Extracted from ProjectsScreen.tsx renderList (F058c).
 * Fase 2 UI: status chips + EmptyState secondary CTA (from template).
 * #642 / 2A: every card consumes the batch commercial summaries read model —
 * loading/error/none are distinct dataset states and a valid snapshot owns the
 * frozen identity (name, customer, currency, total, active quantity).
 * #710: a discreet meta row under the toolbar reports visible vs received
 * cards and offers filter recovery while results are on screen. It describes
 * the navigation set only — never commercial dataset truth.
 */
import '../../common/alert.css';

import { useEffect, useState, type ReactNode } from 'react';
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
  filterProjectsByCommercialStatus,
  resolveCommercialCardIdentity,
  PROJECT_LIST_SORT_OPTIONS,
  type CommercialSummariesStatus,
  type ProjectListSortKey,
  type QuoteCommercialStatusFilter,
} from '../quoteRevisionPresentation';
import { CommercialStatusBadge } from './CommercialStatusBadge';

function quoteNoun(count: number): string {
  return count === 1 ? 'cotización' : 'cotizaciones';
}

/** #1118: paginación incremental — 500 tab stops no son triage. */
const LIST_PAGE_SIZE = 24;

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
  /** #1118: refresh fallido sobre datos anteriores — banner + Reintentar. */
  readonly commercialSummariesStale?: string | null;
  readonly onRetryCommercialSummaries?: () => void;
  readonly commercialFiltersDisabled?: boolean;
  readonly sortKey?: ProjectListSortKey;
  readonly onSortChange?: (key: ProjectListSortKey) => void;
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
  commercialSummariesStale,
  onRetryCommercialSummaries,
  commercialFiltersDisabled = false,
  sortKey = 'recent',
  onSortChange,
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
  const summariesUnavailable = commercialSummariesStatus === 'unavailable';

  // #1118: contadores por chip — sólo con dataset ready (nunca clasificar
  // sobre datos que no llegaron).
  const chipOptions = summariesReady
    ? QUOTE_COMMERCIAL_FILTER_OPTIONS.map((option) => {
        const count =
          option.value === 'all'
            ? projects.length
            : filterProjectsByCommercialStatus(
                projects,
                '',
                option.value,
                customers ?? [],
                commercialSummaries,
                'ready',
              ).length;
        return { ...option, label: `${option.label} (${count})` };
      })
    : QUOTE_COMMERCIAL_FILTER_OPTIONS;

  // #1118: paginación incremental; el límite se reinicia al cambiar filtros.
  const [visibleLimit, setVisibleLimit] = useState(LIST_PAGE_SIZE);
  useEffect(() => {
    setVisibleLimit(LIST_PAGE_SIZE);
  }, [search, statusFilter]);
  const visibleProjects = filtered.slice(0, visibleLimit);
  const hiddenCount = filtered.length - visibleProjects.length;

  // #710: recovery stays reachable while restricted results are on screen.
  // `filtered` follows the parent's debounced search, so right after the user
  // empties the searchbox the visible subset can outlive the live `search`
  // prop — the strict-subset check (counts only, no extra state) keeps the
  // action available until the cards themselves are unrestricted again.
  const showsRestrictedSubset =
    filtered.length > 0 && filtered.length < projects.length;
  const showClearFilters =
    filtered.length > 0 &&
    (search.trim() !== '' || statusFilter !== 'all' || showsRestrictedSubset);

  const cardIdentity = (
    project: Project,
    summary?: ProjectCommercialSummary,
  ): { readonly name: string; readonly customer: string | null } =>
    // #642: frozen identity rule shared with the Inicio recent cards — a
    // valid snapshot owns the historical name; none/legacy keep the current
    // project identity; not-ready keeps navigation identity only.
    resolveCommercialCardIdentity(
      project,
      summary,
      summariesReady,
      () => resolveCustomerName(project.customerId, customers),
    );

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
              options={chipOptions}
              disabled={commercialFiltersDisabled}
              aria-label={
                commercialFiltersDisabled
                  ? 'Filtrar cotizaciones por estado (requiere conexión al servidor)'
                  : 'Filtrar cotizaciones por estado'
              }
              data-testid="project-status-chips"
            />
          }
          contextualControls={
            <div className="project-sort">
              <label className="project-sort__label" htmlFor="project-sort">
                Ordenar
              </label>
              <select
                id="project-sort"
                className="input project-sort__select"
                value={sortKey}
                onChange={(e) => onSortChange?.(e.target.value as ProjectListSortKey)}
                data-testid="project-sort"
              >
                {PROJECT_LIST_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          }
        />
      ) : null}

      {!isTrulyEmpty ? (
        <div className="project-list-meta">
          <p aria-live="polite" data-testid="projects-results-summary">
            {filtered.length < projects.length
              ? filtered.length === 1
                ? `Mostrando 1 de 1 cotización que coincide, de ${projects.length} en total`
                : `Mostrando ${visibleProjects.length} de ${filtered.length} ${quoteNoun(filtered.length)} que coinciden, de ${projects.length} en total`
              : `Mostrando ${visibleProjects.length} de ${projects.length} ${quoteNoun(projects.length)}`}
          </p>
          {summariesReady ? (
            <p
              className="project-list-meta__legend"
              data-testid="projects-price-legend"
            >
              Los montos son el precio total de venta congelado de cada obra.
            </p>
          ) : null}
          {/* With zero matches the no-results EmptyState already owns the only
              recovery action — never render a second Limpiar filtros here. */}
          {showClearFilters ? (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={onClearFilters}
              data-testid="projects-clear-filters"
            >
              Limpiar filtros
            </button>
          ) : null}
        </div>
      ) : null}

      {/* #1118: sesión sin acceso al batch — estado explícito, nunca
          «Cargando…» eterno. */}
      {summariesUnavailable ? (
        <div
          className="alert alert--warning"
          role="status"
          data-testid="commercial-summaries-unavailable"
        >
          <span>
            La información comercial requiere una sesión con acceso al
            servidor.
          </span>
        </div>
      ) : null}

      {/* #1118: refresh fallido sobre datos anteriores — decidir con cuidado. */}
      {summariesReady && commercialSummariesStale ? (
        <div
          className="alert alert--warning"
          role="status"
          data-testid="commercial-summaries-stale"
        >
          <span>{commercialSummariesStale}</span>
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

      {summariesFailed ? (
        <div
          className="alert alert--danger"
          role="alert"
          data-testid="commercial-summaries-error"
        >
          <span>
            {commercialSummariesError ??
              'No se pudo cargar la información comercial.'}
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
          {visibleProjects.map((project) => {
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
                      loading={!summariesReady && !summariesFailed && !summariesUnavailable}
                      error={summariesFailed}
                      unavailable={summariesUnavailable}
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
                        Actualizada {formatIsoDate(activityDate)}
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
                  <div
                    className="project-card__price"
                    title="Precio total"
                  >
                    {formattedTotal != null ? (
                      <span className="project-card__price-value">
                        {formattedTotal}
                      </span>
                    ) : summariesReady && summary?.isLegacy ? (
                      <span
                        className="project-card__price-value project-card__price-value--muted"
                        data-testid={`project-card-price-legacy-${project.id}`}
                        title="Precio histórico no disponible: esta revisión se creó antes del historial comercial congelado."
                      >
                        No disponible
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
      {hiddenCount > 0 ? (
        <div className="project-list-more">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setVisibleLimit((n) => n + LIST_PAGE_SIZE)}
            data-testid="projects-show-more"
          >
            Mostrar más ({hiddenCount} restantes)
          </button>
        </div>
      ) : null}
    </>
  );
}
