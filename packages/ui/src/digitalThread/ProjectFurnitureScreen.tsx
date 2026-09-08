import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import {
  Armchair,
  CheckCircle2,
  CircleAlert,
  CircleMinus,
  ClipboardCheck,
  Layers,
  OctagonAlert,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import {
  GraneteApiClient,
  GraneteApiError,
  type Design,
  type DesignRevision,
  type FurnitureWorkspaceReleaseContext,
  type ProjectFurnitureWorkspace,
  type QuoteRevisionDetail,
  type ReconciliationStatus,
} from '@granete/storage';
import { EmptyState, ListSkeleton, Modal, PageHeader, SearchInput, StatusChips } from '../common';
import {
  buildFurnitureMatrix,
  defaultDesignContext,
  defaultQuoteRevisionId,
  EMPTY_MATRIX_FILTERS,
  filterMatrixRows,
  filtersAreActive,
  LIFECYCLE_LABEL_LIST,
  ORIGIN_LABEL_LIST,
  PRESENCE_LABELS,
  type DesignContextSelection,
  type DesignPresence,
  type FurnitureLifecycle,
  type FurnitureMatrixRow,
  type FurnitureMatrixSummary,
  type FurnitureOrigin,
  type MatrixFilters,
} from './furnitureMatrix';
import './digitalThread.css';

/**
 * #500 / WEB-DT-1 — Project Furniture matrix: the first React surface of the
 * Digital Thread. It tells the story of the project's physical units across
 * an EXACT commercial context (selected QuoteRevision) and an EXACT design
 * context (working copy or selected DesignRevision).
 *
 * Authority contract (tracker #396 / #384):
 * - every read comes from the generated client with runtime validation;
 * - pending/placed and actionRequired derive strictly from the server read model
 *   (POST /projects/{projectId}/furniture-workspace); React never does local joins;
 * - reconciliation badges mirror the server reconciliation result only;
 * - read-only: no local operation pretends to mutate physical identity;
 * - the exact context is pinned through onContextChange so a newer revision
 *   can never silently retarget what the user is viewing.
 */

export interface ProjectFurnitureContextState {
  readonly quoteRevisionId: string | null;
  readonly designId: string | null;
  readonly designContextKind: 'none' | 'working' | 'revision';
  readonly designRevisionId: string | null;
}

export interface ProjectFurnitureQueryKeys {
  readonly root: QueryKey;
  readonly workspace: (context: ProjectFurnitureContextState) => QueryKey;
  readonly quoteRevisions: QueryKey;
  readonly designs: QueryKey;
  readonly designRevisions: (designId: string) => QueryKey;
  readonly furniture?: QueryKey;
  readonly productionReleases?: QueryKey;
  readonly designWorkingCopy?: (designId: string) => QueryKey;
  readonly reconciliation?: (quoteRevisionId: string, designRevisionId: string) => QueryKey;
}

/** Tenant/session-scoped key factory: every key carries the scope so an
 * organization switch invalidates the whole tree (plus the remount key in
 * the shell), and the project id keeps units from leaking across projects. */
export function projectFurnitureQueryKeys(
  scopeKey: readonly unknown[],
  projectId: string,
): ProjectFurnitureQueryKeys {
  const root: QueryKey = ['project-furniture', ...scopeKey, projectId];
  return {
    root,
    workspace: (context: ProjectFurnitureContextState) => [
      ...root,
      'workspace',
      context.quoteRevisionId,
      context.designId,
      context.designContextKind,
      context.designRevisionId,
    ],
    furniture: [...root, 'furniture-instances'],
    quoteRevisions: [...root, 'quote-revisions'],
    designs: [...root, 'designs'],
    productionReleases: [...root, 'production-releases'],
    designWorkingCopy: (designId: string) => [...root, 'designs', designId, 'working-copy'],
    designRevisions: (designId: string) => [...root, 'designs', designId, 'revisions'],
    reconciliation: (quoteRevisionId: string, designRevisionId: string) => [
      ...root,
      'reconciliation',
      quoteRevisionId,
      designRevisionId,
    ],
  };
}

export interface ProjectFurnitureScreenProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly queryKeys: ProjectFurnitureQueryKeys;
  /** Exact context pinned in the URL by the shell (historical views stay pinned). */
  readonly initialContext?: ProjectFurnitureContextState | null;
  readonly onContextChange?: (context: ProjectFurnitureContextState) => void;
  readonly onBack?: () => void;
  /** WEB-DT-2 (#501): cross-surface link to designs workspace. */
  readonly onOpenDesigns?: (context: { designId: string | null; revisionId: string | null }) => void;
}

const QUOTE_REVISION_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'borrador',
  published: 'publicada',
  accepted: 'aceptada',
  superseded: 'reemplazada',
};

const DESIGN_REVISION_STATUS_LABELS: Readonly<Record<string, string>> = {
  published: 'publicada',
  approved: 'aprobada',
  superseded: 'reemplazada',
};

const RECONCILIATION_BADGES: Readonly<
  Record<ReconciliationStatus, { label: string; className: string; icon: LucideIcon }>
> = {
  synced: {
    label: 'Sincronizada',
    className: 'status-badge status-badge--done',
    icon: CheckCircle2,
  },
  quoted_not_modeled: {
    label: 'Cotizada sin modelar',
    className: 'status-badge status-badge--warning',
    icon: CircleAlert,
  },
  modeled_not_quoted: {
    label: 'Modelada sin cotizar',
    className: 'status-badge status-badge--warning',
    icon: CircleAlert,
  },
  modified: {
    label: 'Modificada',
    className: 'status-badge status-badge--warning',
    icon: CircleAlert,
  },
  removed: {
    label: 'Retirada del diseño',
    className: 'status-badge status-badge--danger',
    icon: CircleMinus,
  },
  conflict: {
    label: 'Conflicto',
    className: 'status-badge status-badge--danger',
    icon: OctagonAlert,
  },
};

function ReconciliationBadge({ status }: { readonly status: ReconciliationStatus }): ReactNode {
  const badge = RECONCILIATION_BADGES[status];
  const Icon = badge.icon;
  return (
    <span className={badge.className}>
      <Icon size={12} aria-hidden />
      {badge.label}
    </span>
  );
}

const EMPTY_SUMMARY: FurnitureMatrixSummary = {
  total: 0,
  activeUnits: 0,
  quotedActive: 0,
  placedInDesign: 0,
  pendingPlacement: 0,
  requireAttention: 0,
  removed: 0,
  cancelled: 0,
};

function presenceBadgeClass(presence: DesignPresence): string {
  if (presence === 'placed') return 'status-badge status-badge--done';
  if (presence === 'pending') return 'status-badge status-badge--open';
  return 'status-badge status-badge--inactive';
}

function lifecycleBadgeClass(lifecycle: FurnitureLifecycle): string {
  if (lifecycle === 'active') return 'status-badge status-badge--active';
  return 'status-badge status-badge--cancelled';
}

function formatDimensions(row: FurnitureMatrixRow): string {
  return row.dimensionsLabel ?? '—';
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof GraneteApiError) {
    if (error.code === 'FORBIDDEN') {
      return 'No tenés permiso para ver los muebles de esta obra.';
    }
    if (error.code === 'NOT_FOUND') {
      return 'La obra no existe o no es accesible desde tu organización.';
    }
  }
  return 'No se pudo cargar los muebles de la obra. Revisá tu conexión y volvé a intentar.';
}

function quoteRevisionLabel(revision: QuoteRevisionDetail): string {
  const status = QUOTE_REVISION_STATUS_LABELS[revision.status] ?? revision.status;
  return `Q${revision.revisionNumber} · ${status} · ${formatWhen(revision.createdAt)}`;
}

/** Presentation-only: sentence-case a status word for the exact-context header. */
function capitalizedStatus(labels: Readonly<Record<string, string>>, status: string): string {
  const label = labels[status];
  if (!label) return status;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function ProjectFurnitureScreen({
  baseUrl,
  token,
  projectId,
  queryKeys,
  initialContext,
  onContextChange,
  onBack,
  onOpenDesigns,
}: ProjectFurnitureScreenProps): ReactNode {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<MatrixFilters>(EMPTY_MATRIX_FILTERS);
  const [detailRow, setDetailRow] = useState<FurnitureMatrixRow | null>(null);

  // Exact context selection. Initialized from the pinned URL context; the
  // defaults below are VIEW defaults applied once, then pinned again so a
  // newer revision never retargets the view silently.
  const [quoteRevisionId, setQuoteRevisionId] = useState<string | null>(
    initialContext?.quoteRevisionId ?? null,
  );
  const [designContext, setDesignContext] = useState<DesignContextSelection>(() => ({
    kind: initialContext?.designContextKind ?? 'none',
    designId: initialContext?.designId ?? null,
    designRevisionId: initialContext?.designRevisionId ?? null,
  }));

  const quoteRevisionsQuery = useQuery({
    queryKey: queryKeys.quoteRevisions,
    queryFn: ({ signal }) => api.listProjectQuoteRevisions(token, projectId, signal),
  });
  const designsQuery = useQuery({
    queryKey: queryKeys.designs,
    queryFn: ({ signal }) => api.listProjectDesigns(token, projectId, signal),
  });

  const quoteRevisions: readonly QuoteRevisionDetail[] = quoteRevisionsQuery.data ?? [];
  const designs: readonly Design[] = designsQuery.data ?? [];

  // Apply view defaults exactly once, when the authoritative lists arrive and
  // no pinned context exists. Every applied default is re-pinned through
  // onContextChange.
  useEffect(() => {
    if (quoteRevisionsQuery.isSuccess && quoteRevisionId === null) {
      const defaulted = defaultQuoteRevisionId(quoteRevisions);
      if (defaulted !== null) setQuoteRevisionId(defaulted);
    }
  }, [quoteRevisionsQuery.isSuccess, quoteRevisions, quoteRevisionId]);

  useEffect(() => {
    if (designsQuery.isSuccess && designContext.kind === 'none') {
      const defaulted = defaultDesignContext(designs);
      if (defaulted.kind !== 'none') setDesignContext(defaulted);
    }
  }, [designsQuery.isSuccess, designs, designContext.kind]);

  const selectedDesignId = designContext.designId;
  const designRevisionsQuery = useQuery({
    queryKey: selectedDesignId
      ? queryKeys.designRevisions(selectedDesignId)
      : ['project-furniture', 'revisions', 'none'],
    queryFn: ({ signal }) => api.listDesignRevisions(token, selectedDesignId as string, signal),
    enabled: selectedDesignId !== null,
  });
  const designRevisions: readonly DesignRevision[] = designRevisionsQuery.data ?? [];
  const selectedDesignRevision =
    designRevisions.find((revision) => revision.id === designContext.designRevisionId) ?? null;

  // Single authoritative backend read-model query: POST /projects/{projectId}/furniture-workspace
  const currentContextState: ProjectFurnitureContextState = useMemo(
    () => ({
      quoteRevisionId,
      designId: designContext.designId,
      designContextKind: designContext.kind,
      designRevisionId: designContext.designRevisionId,
    }),
    [quoteRevisionId, designContext],
  );

  const workspaceQueryKey = useMemo(
    () =>
      queryKeys.workspace
        ? queryKeys.workspace(currentContextState)
        : [
            ...queryKeys.root,
            'workspace',
            quoteRevisionId,
            designContext.designId,
            designContext.kind,
            designContext.designRevisionId,
          ],
    [queryKeys, currentContextState, quoteRevisionId, designContext],
  );

  const workspaceQuery = useQuery({
    queryKey: workspaceQueryKey,
    queryFn: ({ signal }) =>
      api.getProjectFurnitureWorkspace(
        token,
        projectId,
        {
          quoteRevisionId,
          designId: designContext.designId,
          designContextKind: designContext.kind,
          designRevisionId: designContext.designRevisionId,
        },
        signal,
      ),
    // Keep the previous matrix on screen while the exact context changes:
    // switching revisions refreshes in place instead of flashing a spinner.
    placeholderData: keepPreviousData,
  });

  const workspace: ProjectFurnitureWorkspace | null = workspaceQuery.data ?? null;

  // Keep the URL pinned to the exact context being viewed. The ref guard
  // keeps inline callbacks from re-firing navigation on every render.
  const lastEmittedContext = useRef<ProjectFurnitureContextState | null>(null);
  useEffect(() => {
    const previous = lastEmittedContext.current;
    if (
      previous !== null &&
      previous.quoteRevisionId === currentContextState.quoteRevisionId &&
      previous.designId === currentContextState.designId &&
      previous.designContextKind === currentContextState.designContextKind &&
      previous.designRevisionId === currentContextState.designRevisionId
    ) {
      return;
    }
    lastEmittedContext.current = currentContextState;
    onContextChange?.(currentContextState);
  }, [onContextChange, currentContextState]);

  const { rows, summary } = useMemo(
    () => (workspace ? buildFurnitureMatrix({ workspace }) : { rows: [], summary: EMPTY_SUMMARY }),
    [workspace],
  );

  const visibleRows = useMemo(() => filterMatrixRows(rows, filters), [rows, filters]);
  const hasActiveFilters = filtersAreActive(filters);

  // Presentation-only derivations over the already-built rows: how many
  // units the server reconciliation marks as synced in this exact comparison.
  const hasComparison = rows.some((row) => row.reconciliation !== null);
  const syncedActive = rows.filter((row) => row.isActive && row.reconciliation === 'synced').length;

  const contextualRelease = workspace?.release ?? null;
  const latestProjectRelease = workspace?.latestProjectRelease ?? null;

  const selectedQuoteRevision =
    quoteRevisions.find((revision) => revision.id === quoteRevisionId) ?? null;

  const reloadAll = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.root });
  };

  const selectDesign = (designId: string): void => {
    setDesignContext(
      designId === ''
        ? { kind: 'none', designId: null, designRevisionId: null }
        : { kind: 'working', designId, designRevisionId: null },
    );
  };

  const selectDesignContextKind = (value: string): void => {
    if (designContext.designId === null) return;
    if (value === 'working') {
      setDesignContext({ kind: 'working', designId: designContext.designId, designRevisionId: null });
    } else if (value === 'revision') {
      const newest = [...designRevisions].sort((a, b) => b.revision_number - a.revision_number)[0];
      setDesignContext({
        kind: 'revision',
        designId: designContext.designId,
        designRevisionId: newest?.id ?? null,
      });
    } else {
      setDesignContext({ kind: 'none', designId: designContext.designId, designRevisionId: null });
    }
  };

  const contextBusy = workspaceQuery.isFetching || designRevisionsQuery.isFetching;

  return (
    <section className="catalog-page" aria-label="Muebles de la obra">
      <PageHeader
        title="Muebles"
        subtitle="Unidades físicas del proyecto: origen, contexto comercial y presencia en el diseño"
        icon={<Armchair size={16} strokeWidth={1.5} />}
        secondaryActions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {onBack ? (
              <button type="button" className="btn btn--secondary" onClick={onBack}>
                Volver a la obra
              </button>
            ) : null}
            {onOpenDesigns && (
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="open-designs-btn"
                onClick={() =>
                  onOpenDesigns({
                    designId: designContext.designId,
                    revisionId: designContext.designRevisionId,
                  })
                }
              >
                <Layers size={14} aria-hidden /> Diseños y revisiones
              </button>
            )}
          </div>
        }
        primaryAction={
          <button
            type="button"
            className="btn btn--primary"
            onClick={reloadAll}
            disabled={workspaceQuery.isFetching || quoteRevisionsQuery.isFetching}
          >
            <RefreshCw size={14} aria-hidden /> Actualizar
          </button>
        }
      />

      {workspaceQuery.isPending ? (
        <ProjectFurnitureSkeleton />
      ) : workspaceQuery.isError ? (
        <div className="pf-error" role="alert" data-testid="pf-error">
          <TriangleAlert size={24} aria-hidden />
          <h3>No se pudo cargar la matriz de muebles</h3>
          <p>{loadErrorMessage(workspaceQuery.error)}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={reloadAll}
            disabled={workspaceQuery.isFetching}
          >
            <RefreshCw size={14} aria-hidden /> Reintentar
          </button>
        </div>
      ) : (
        <>
          <ProjectFurnitureContextBar
            quoteRevisions={quoteRevisions}
            quoteRevisionId={quoteRevisionId}
            onQuoteRevisionChange={setQuoteRevisionId}
            designs={designs}
            designContext={designContext}
            onDesignChange={selectDesign}
            onDesignContextKindChange={selectDesignContextKind}
            designRevisions={designRevisions}
            onDesignRevisionChange={(revisionId) =>
              setDesignContext({
                kind: revisionId === '' ? 'working' : 'revision',
                designId: designContext.designId,
                designRevisionId: revisionId === '' ? null : revisionId,
              })
            }
            quoteRevisionsError={quoteRevisionsQuery.isError}
            busy={contextBusy}
          />

          <ProjectFurnitureExactContext
            selectedQuoteRevision={selectedQuoteRevision}
            hasQuoteRevisions={quoteRevisions.length > 0}
            designContext={designContext}
            designRevision={selectedDesignRevision}
            contextualRelease={contextualRelease}
            latestProjectRelease={latestProjectRelease}
          />

          <ProjectFurnitureSummaryCards
            summary={summary}
            syncedActive={syncedActive}
            hasComparison={hasComparison}
          />

          {hasComparison &&
          summary.requireAttention === 0 &&
          summary.pendingPlacement === 0 &&
          rows.length > 0 ? (
            <p className="pf-allclear" role="status" data-testid="pf-all-clear">
              <CheckCircle2 size={14} aria-hidden />
              Todas las unidades están sincronizadas en la comparación actual.
            </p>
          ) : null}

          {designContext.kind === 'none' && rows.length > 0 ? (
            <div className="pf-notice" data-testid="pf-no-design-notice">
              <CircleAlert size={16} aria-hidden />
              <p>
                Este proyecto tiene{' '}
                {summary.activeUnits === 1 ? '1 unidad física' : `${summary.activeUnits} unidades físicas`},
                pero todavía no hay un diseño seleccionado para comparar.
                {designs.length === 0
                  ? ' Creá un diseño para empezar a modelar estas unidades en SketchUp.'
                  : ' Elegí un diseño para ver presencia y reconciliación.'}
              </p>
              {onOpenDesigns ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  data-testid="pf-goto-designs-btn"
                  onClick={() => onOpenDesigns({ designId: null, revisionId: null })}
                >
                  <Layers size={14} aria-hidden /> {designs.length === 0 ? 'Crear diseño' : 'Ir a Diseños'}
                </button>
              ) : null}
            </div>
          ) : null}

          {designs.length === 0 && quoteRevisionsQuery.isSuccess && designsQuery.isSuccess ? (
            <div className="pf-notice" data-testid="pf-no-designs-at-all">
              <CircleAlert size={16} aria-hidden />
              <p>
                Esta obra todavía no tiene diseños. Al crear uno podrás modelarlo en SketchUp y
                publicar revisiones inmutables.
              </p>
              {onOpenDesigns ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  data-testid="pf-create-design-btn"
                  onClick={() => onOpenDesigns({ designId: null, revisionId: null })}
                >
                  <Layers size={14} aria-hidden /> Ir a Diseños
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="pf-toolbar">
            <SearchInput
              value={filters.search}
              onChange={(search) => setFilters((current) => ({ ...current, search }))}
              placeholder="Buscar por nombre o ID técnico…"
              aria-label="Buscar muebles"
            />
            <label className="pf-attention">
              <input
                type="checkbox"
                checked={filters.attention}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, attention: event.target.checked }))
                }
              />
              Sólo requieren atención
            </label>
            <StatusChips<FurnitureOrigin | 'all'>
              value={filters.origins.length === 1 ? (filters.origins[0] ?? 'all') : 'all'}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  origins: value === 'all' ? [] : [value],
                }))
              }
              options={[
                { value: 'all', label: 'Todos los orígenes' },
                ...ORIGIN_LABEL_LIST.map((option) => ({ value: option.id, label: option.label })),
              ]}
              aria-label="Filtrar por origen"
              data-testid="pf-filter-origin"
            />
            <StatusChips<DesignPresence | 'all'>
              value={filters.presences.length === 1 ? (filters.presences[0] ?? 'all') : 'all'}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  presences: value === 'all' ? [] : [value],
                }))
              }
              options={[
                { value: 'all', label: 'Toda presencia' },
                ...(Object.keys(PRESENCE_LABELS) as DesignPresence[]).map((presence) => ({
                  value: presence,
                  label: PRESENCE_LABELS[presence],
                })),
              ]}
              aria-label="Filtrar por presencia en el diseño"
              data-testid="pf-filter-presence"
            />
            <StatusChips<FurnitureLifecycle | 'all'>
              value={filters.lifecycles.length === 1 ? (filters.lifecycles[0] ?? 'all') : 'all'}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  lifecycles: value === 'all' ? [] : [value],
                }))
              }
              options={[
                { value: 'all', label: 'Todo estado' },
                ...LIFECYCLE_LABEL_LIST.map((option) => ({ value: option.id, label: option.label })),
              ]}
              aria-label="Filtrar por estado físico"
              data-testid="pf-filter-lifecycle"
            />
          </div>

          {workspaceQuery.isFetching ? (
            <p className="pf-stale-hint" role="status">
              Actualizando datos del servidor…
            </p>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              variant="empty"
              icon={Armchair}
              title="Esta obra todavía no tiene muebles físicos"
              description="Las unidades físicas nacen cuando se materializan líneas de cotización o cuando el diseño añade muebles al proyecto."
            />
          ) : visibleRows.length === 0 ? (
            <EmptyState
              variant="no-results"
              title="Ningún mueble coincide con los filtros"
              description="Probá con otro término de búsqueda o limpiá los filtros para ver todas las unidades."
              actionLabel="Limpiar filtros"
              onAction={() => setFilters(EMPTY_MATRIX_FILTERS)}
            />
          ) : (
            <div
              className={`data-table-wrap${workspaceQuery.isFetching ? ' pf-table-busy' : ''}`}
              data-testid="pf-table-wrap"
              aria-busy={workspaceQuery.isFetching}
            >
              <table className="data-table" data-testid="pf-table">
                <caption className="visually-hidden">
                  Matriz de muebles físicos de la obra, una fila por unidad
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Mueble</th>
                    <th scope="col">Origen</th>
                    <th scope="col">Cotización</th>
                    <th scope="col">Diseño</th>
                    <th scope="col">Reconciliación</th>
                    <th scope="col">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const rowTone =
                      row.reconciliation === 'conflict'
                        ? 'pf-row--danger'
                        : row.actionRequired !== null
                          ? 'pf-row--attention'
                          : '';
                    const rowInactive =
                      !row.isActive && row.actionRequired === null && row.reconciliation !== 'conflict'
                        ? 'pf-row--inactive'
                        : '';
                    return (
                      <tr
                        key={row.instance.id}
                        data-testid={`pf-row-${row.instance.id}`}
                        data-attention={row.actionRequired !== null ? 'true' : 'false'}
                        className={[rowTone, rowInactive].filter(Boolean).join(' ')}
                      >
                        <td>
                          <span className="pf-label">{row.label}</span>
                          {row.unitProvenanceLabel || !row.isActive ? (
                            <span className="pf-cell-meta">
                              {row.unitProvenanceLabel ? (
                                <span className="meta-chip">{row.unitProvenanceLabel}</span>
                              ) : null}
                              {!row.isActive ? (
                                <span className="status-badge status-badge--cancelled">
                                  {row.lifecycleLabel}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                          <span className="pf-dims">{formatDimensions(row)}</span>
                        </td>
                        <td>{row.originLabel}</td>
                        <td data-testid={`pf-cell-quote-${row.instance.id}`}>
                          {row.quotedInSelectedRevision ? (
                            selectedQuoteRevision ? (
                              <span title={quoteRevisionLabel(selectedQuoteRevision)}>
                                En Q{selectedQuoteRevision.revisionNumber}
                              </span>
                            ) : (
                              'Cotizada'
                            )
                          ) : (
                            <span className="pf-muted">—</span>
                          )}
                        </td>
                        <td>
                          <span className={presenceBadgeClass(row.presence)}>
                            {PRESENCE_LABELS[row.presence]}
                          </span>
                        </td>
                        <td data-testid={`pf-cell-reconciliation-${row.instance.id}`}>
                          {row.reconciliation === null ? (
                            <span className="pf-muted">—</span>
                          ) : (
                            <ReconciliationBadge status={row.reconciliation} />
                          )}
                          {row.nextStep ? (
                            <span className="pf-row-action">{row.nextStep}</span>
                          ) : null}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            aria-label={
                              row.unitProvenanceLabel
                                ? `Ver detalle de ${row.label} (${row.unitProvenanceLabel.toLowerCase()})`
                                : `Ver detalle de ${row.label}`
                            }
                            onClick={() => setDetailRow(row)}
                          >
                            Detalle
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {detailRow ? (
        <ProjectFurnitureDetailDrawer
          row={detailRow}
          selectedQuoteRevision={selectedQuoteRevision}
          designContext={designContext}
          designRevision={selectedDesignRevision}
          contextualRelease={contextualRelease}
          latestProjectRelease={latestProjectRelease}
          onClose={() => setDetailRow(null)}
        />
      ) : null}
    </section>
  );
}

interface ContextBarProps {
  readonly quoteRevisions: readonly QuoteRevisionDetail[];
  readonly quoteRevisionId: string | null;
  readonly onQuoteRevisionChange: (id: string | null) => void;
  readonly designs: readonly Design[];
  readonly designContext: DesignContextSelection;
  readonly onDesignChange: (designId: string) => void;
  readonly onDesignContextKindChange: (value: string) => void;
  readonly designRevisions: readonly DesignRevision[];
  readonly onDesignRevisionChange: (revisionId: string) => void;
  readonly quoteRevisionsError: boolean;
  readonly busy: boolean;
}

function ProjectFurnitureContextBar({
  quoteRevisions,
  quoteRevisionId,
  onQuoteRevisionChange,
  designs,
  designContext,
  onDesignChange,
  onDesignContextKindChange,
  designRevisions,
  onDesignRevisionChange,
  quoteRevisionsError,
  busy,
}: ContextBarProps): ReactNode {
  return (
    <div className="pf-context" data-testid="pf-context-bar">
      <div className="pf-context__selectors">
        <label className="pf-field">
          <span>Cotización</span>
          <select
            data-testid="pf-quote-revision-select"
            value={quoteRevisionId ?? ''}
            onChange={(event) => onQuoteRevisionChange(event.target.value || null)}
            disabled={quoteRevisionsError}
          >
            {quoteRevisions.length === 0 ? (
              <option value="">
                {quoteRevisionsError
                  ? 'No se pudieron cargar las revisiones'
                  : 'Sin revisiones de cotización'}
              </option>
            ) : (
              [...quoteRevisions]
                .sort((a, b) => b.revisionNumber - a.revisionNumber)
                .map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {quoteRevisionLabel(revision)}
                  </option>
                ))
            )}
          </select>
        </label>

        <label className="pf-field">
          <span>Diseño</span>
          <select
            data-testid="pf-design-select"
            value={designContext.designId ?? ''}
            onChange={(event) => onDesignChange(event.target.value)}
          >
            {designs.length === 0 ? (
              <option value="">Sin diseños</option>
            ) : (
              <>
                <option value="">Sin diseño</option>
                {designs.map((design) => (
                  <option key={design.id} value={design.id}>
                    {design.name}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>

        <label className="pf-field">
          <span>Contexto de diseño</span>
          <select
            data-testid="pf-design-context-select"
            value={
              designContext.kind === 'revision'
                ? (designContext.designRevisionId ?? '')
                : designContext.kind
            }
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'working' || value === 'none') {
                onDesignContextKindChange(value);
              } else {
                onDesignRevisionChange(value);
              }
            }}
            disabled={designContext.designId === null}
          >
            <option value="working">Trabajo en curso</option>
            {[...designRevisions]
              .sort((a, b) => b.revision_number - a.revision_number)
              .map((revision) => (
                <option key={revision.id} value={revision.id}>
                  R{revision.revision_number} ·{' '}
                  {DESIGN_REVISION_STATUS_LABELS[revision.status] ?? revision.status} ·{' '}
                  {formatWhen(revision.created_at)}
                </option>
              ))}
          </select>
        </label>

        {busy ? (
          <span className="pf-stale-hint" role="status">
            Actualizando contexto…
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface ExactContextProps {
  readonly selectedQuoteRevision: QuoteRevisionDetail | null;
  readonly hasQuoteRevisions: boolean;
  readonly designContext: DesignContextSelection;
  readonly designRevision: DesignRevision | null;
  readonly contextualRelease: FurnitureWorkspaceReleaseContext | null;
  readonly latestProjectRelease: FurnitureWorkspaceReleaseContext | null;
}

/**
 * Read-only echo of the exact context being viewed. The selects above own the
 * selection; this header answers "what am I looking at" in one glance
 * (Q# + status ↔ R#/working + status, plus the contextual release) without
 * ever implying a `latest` default.
 */
function ProjectFurnitureExactContext({
  selectedQuoteRevision,
  hasQuoteRevisions,
  designContext,
  designRevision,
  contextualRelease,
  latestProjectRelease,
}: ExactContextProps): ReactNode {
  const quoteValue = selectedQuoteRevision
    ? `Q${selectedQuoteRevision.revisionNumber} · ${capitalizedStatus(
        QUOTE_REVISION_STATUS_LABELS,
        selectedQuoteRevision.status,
      )}`
    : hasQuoteRevisions
      ? 'Elegí una revisión de cotización'
      : 'Sin revisiones de cotización';

  let designValue = 'Sin diseño';
  let designHint: string | null =
    'Elegí un diseño para ver presencia y reconciliación de cada unidad.';
  if (designContext.kind === 'working') {
    designValue = 'Trabajo en curso';
    designHint = 'Muestra presencia; la reconciliación requiere una revisión publicada exacta.';
  } else if (designContext.kind === 'revision') {
    designValue =
      designRevision !== null
        ? `R${designRevision.revision_number} · ${capitalizedStatus(
            DESIGN_REVISION_STATUS_LABELS,
            designRevision.status,
          )}`
        : 'Revisión no disponible';
    designHint = null;
  }

  const releaseTitle = contextualRelease
    ? `Liberación #${contextualRelease.releaseNumber} fijada a R${contextualRelease.designRevisionNumber}${
        contextualRelease.quoteRevisionId ? ' y a la revisión de cotización seleccionada' : ''
      }`
    : undefined;

  return (
    <section className="pf-exact-header" aria-label="Contexto exacto de la comparación" data-testid="pf-exact-context">
      <div className="pf-exact-header__side">
        <span className="pf-exact-header__kind">Cotización</span>
        <strong className="pf-exact-header__value" title={selectedQuoteRevision ? quoteRevisionLabel(selectedQuoteRevision) : undefined}>
          {quoteValue}
        </strong>
      </div>
      <span className="pf-exact-header__vs" aria-hidden>
        ↔
      </span>
      <div className="pf-exact-header__side">
        <span className="pf-exact-header__kind">Diseño</span>
        <strong className="pf-exact-header__value">{designValue}</strong>
        {designHint ? <span className="pf-exact-header__hint">{designHint}</span> : null}
      </div>

      <span
        className={`pf-exact-header__release${contextualRelease ? '' : ' pf-exact-header__release--none'}`}
        data-testid="pf-release-reference"
        title={releaseTitle}
      >
        <ClipboardCheck size={14} aria-hidden />
        {contextualRelease ? (
          <>
            Liberación #{contextualRelease.releaseNumber}
            {contextualRelease.manufacturingStale ? (
              <span
                className="status-badge status-badge--warning"
                title="Una revisión más reciente cambió la huella de manufactura"
              >
                <TriangleAlert size={12} aria-hidden /> desactualizado
              </span>
            ) : null}
          </>
        ) : (
          <>
            Sin liberación contextual
            {latestProjectRelease ? (
              <span className="pf-muted">
                {' '}· último release del proyecto: #{latestProjectRelease.releaseNumber} (R
                {latestProjectRelease.designRevisionNumber})
              </span>
            ) : null}
          </>
        )}
      </span>
    </section>
  );
}

function ProjectFurnitureSummaryCards({
  summary,
  syncedActive,
  hasComparison,
}: {
  readonly summary: FurnitureMatrixSummary;
  readonly syncedActive: number;
  readonly hasComparison: boolean;
}): ReactNode {
  const attention = summary.requireAttention;
  const cards: readonly {
    id: string;
    label: string;
    value: number | null;
    hint: string;
    icon?: LucideIcon;
    tone?: 'attention' | 'clear' | 'ok';
  }[] = [
    {
      id: 'active',
      label: 'Unidades activas',
      value: summary.activeUnits,
      hint: `de ${summary.total} unidades históricas`,
    },
    {
      id: 'synced',
      label: 'Sincronizadas',
      value: hasComparison ? syncedActive : null,
      hint: hasComparison ? 'comparación exacta actual' : 'requiere diseño publicado',
      icon: hasComparison ? CheckCircle2 : undefined,
      tone: 'ok',
    },
    {
      id: 'quoted',
      label: 'Cotizadas',
      value: summary.quotedActive,
      hint: 'en la revisión seleccionada',
    },
    {
      id: 'placed',
      label: 'En el diseño',
      value: summary.placedInDesign,
      hint: 'contexto seleccionado',
    },
    {
      id: 'pending',
      label: 'Pendientes de colocar',
      value: summary.pendingPlacement,
      hint: 'contexto seleccionado',
    },
    {
      id: 'attention',
      label: 'Requieren atención',
      value: attention,
      hint: attention > 0 ? 'acción sugerida' : 'sin acciones pendientes',
      icon: attention > 0 ? TriangleAlert : CheckCircle2,
      tone: attention > 0 ? 'attention' : 'clear',
    },
    {
      id: 'terminal',
      label: 'Retiradas / canceladas',
      value: summary.removed + summary.cancelled,
      hint: 'historial permanente',
    },
  ];
  return (
    <div className="pf-summary">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            className={`pf-summary__card${card.tone ? ` pf-summary__card--${card.tone}` : ''}`}
            key={card.id}
            data-testid={`pf-summary-${card.id}`}
          >
            <span className="pf-summary__value">
              {Icon ? <Icon size={14} aria-hidden /> : null}
              {card.value ?? '—'}
            </span>
            <span className="pf-summary__label">{card.label}</span>
            <span className="pf-summary__hint">{card.hint}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Structural loading placeholder: keeps the page shape stable (selectors +
 * summary + table rows) so the first paint never jumps when data arrives. */
function ProjectFurnitureSkeleton(): ReactNode {
  return (
    <div data-testid="pf-loading-skeleton" aria-busy="true">
      <div className="pf-skeleton-fields" aria-hidden>
        <div className="pf-skeleton-block pf-skeleton-block--field" />
        <div className="pf-skeleton-block pf-skeleton-block--field" />
        <div className="pf-skeleton-block pf-skeleton-block--field" />
      </div>
      <div className="pf-skeleton-summary" aria-hidden>
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="pf-skeleton-block pf-skeleton-block--card" />
        ))}
      </div>
      <ListSkeleton rows={6} />
    </div>
  );
}

interface DetailDrawerProps {
  readonly row: FurnitureMatrixRow;
  readonly selectedQuoteRevision: QuoteRevisionDetail | null;
  readonly designContext: DesignContextSelection;
  readonly designRevision: DesignRevision | null;
  readonly contextualRelease: FurnitureWorkspaceReleaseContext | null;
  readonly latestProjectRelease: FurnitureWorkspaceReleaseContext | null;
  readonly onClose: () => void;
}

function ProjectFurnitureDetailDrawer({
  row,
  selectedQuoteRevision,
  designContext,
  designRevision,
  contextualRelease,
  latestProjectRelease,
  onClose,
}: DetailDrawerProps): ReactNode {
  const quoteItem =
    selectedQuoteRevision?.items.find((item) => item.furnitureInstanceId === row.instance.id) ?? null;
  const designLabel =
    designContext.kind === 'revision' && designRevision
      ? `R${designRevision.revision_number}`
      : 'Trabajo en curso';

  return (
    <Modal
      open
      onClose={onClose}
      title={`Detalle de ${row.label}`}
      size="lg"
      dataTestId="pf-detail-modal"
    >
      <div className="pf-detail">
        <section className="pf-detail__section">
          <h4>Identidad física</h4>
          <dl className="pf-detail__grid">
            <dt>Unidad</dt>
            <dd>
              {row.label}
              {row.unitProvenanceLabel ? ` · ${row.unitProvenanceLabel}` : ''}
              {row.dimensionsLabel ? ` · ${row.dimensionsLabel}` : ''}
            </dd>
            <dt>Estado físico</dt>
            <dd>
              <span className={lifecycleBadgeClass(row.lifecycle)}>{row.lifecycleLabel}</span>
            </dd>
            <dt>ID técnico</dt>
            <dd className="pf-tech-id">{row.instance.id}</dd>
            <dt>Versión (ETag)</dt>
            <dd>v{row.instance.version}</dd>
            <dt>Proyecto</dt>
            <dd className="pf-tech-id">{row.instance.project_id}</dd>
            {row.instance.furniture_definition_id ? (
              <>
                <dt>Definición</dt>
                <dd className="pf-tech-id">{row.instance.furniture_definition_id}</dd>
              </>
            ) : null}
            <dt>Creada</dt>
            <dd>{formatWhen(row.instance.created_at)}</dd>
            <dt>Última actualización</dt>
            <dd>{formatWhen(row.instance.updated_at)}</dd>
          </dl>
        </section>

        <section className="pf-detail__section">
          <h4>Procedencia</h4>
          <dl className="pf-detail__grid">
            <dt>Origen</dt>
            <dd>{row.originLabel}</dd>
            {row.duplicateOfInstanceId ? (
              <>
                <dt>Duplicada de</dt>
                <dd className="pf-tech-id">{row.duplicateOfInstanceId}</dd>
              </>
            ) : null}
            {row.commercialGrouping ? (
              <>
                <dt>Línea de cotización</dt>
                <dd className="pf-tech-id">{row.commercialGrouping.quoteLineId}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className="pf-detail__section">
          <h4>
            Contexto comercial
            {selectedQuoteRevision
              ? ` — Q${selectedQuoteRevision.revisionNumber} (${
                  QUOTE_REVISION_STATUS_LABELS[selectedQuoteRevision.status] ??
                  selectedQuoteRevision.status
                })`
              : ''}
          </h4>
          {quoteItem ? (
            <dl className="pf-detail__grid">
              <dt>Parámetros cotizados</dt>
              <dd>
                <ul className="pf-kv-list">
                  {Object.entries(quoteItem.parameters).map(([key, value]) => (
                    <li key={key}>
                      <span>{key}</span>
                      <span>{String(value)}</span>
                    </li>
                  ))}
                </ul>
              </dd>
              <dt>Materiales</dt>
              <dd>
                <ul className="pf-kv-list">
                  {Object.entries(quoteItem.materialChoices).map(([key, value]) => (
                    <li key={key}>
                      <span>{key}</span>
                      <span>{value}</span>
                    </li>
                  ))}
                </ul>
              </dd>
              <dt>Estado en la revisión</dt>
              <dd>{quoteItem.lifecycleStatus}</dd>
            </dl>
          ) : (
            <p className="pf-muted">
              Esta unidad no forma parte de la revisión de cotización seleccionada.
            </p>
          )}
        </section>

        <section className="pf-detail__section">
          <h4>Contexto de diseño — {designLabel}</h4>
          <dl className="pf-detail__grid">
            <dt>Presencia</dt>
            <dd>
              <span className={presenceBadgeClass(row.presence)}>
                {PRESENCE_LABELS[row.presence]}
              </span>
            </dd>
          </dl>
        </section>

        <section className="pf-detail__section">
          <h4>Reconciliación</h4>
          {row.reconciliationItem ? (
            <>
              <p>
                <ReconciliationBadge status={row.reconciliationItem.status} />
              </p>
              {row.nextStep ? (
                <p className="pf-detail__next-step">Próximo paso: {row.nextStep}</p>
              ) : null}
              {row.reconciliationItem.differences.length > 0 ? (
                <ul className="pf-diff-list" data-testid="pf-diff-list">
                  {row.reconciliationItem.differences.map((difference, index) => {
                    const { scope, leaf, unitSuffix } = diffPathParts(difference.path);
                    return (
                      <li key={`${difference.path}-${index}`}>
                        <span className="pf-diff-path">
                          {scope ? `${scope} · ` : ''}
                          {leaf}
                        </span>
                        <span className="pf-diff-values">
                          <span className="pf-diff-value pf-diff-value--from">
                            {formatScalar(difference.quoteValue)}
                            {unitSuffix}
                          </span>
                          <span className="pf-diff-arrow" aria-hidden>
                            →
                          </span>
                          <span className="pf-diff-value pf-diff-value--to">
                            {formatScalar(difference.designValue)}
                            {unitSuffix}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {row.reconciliationItem.notes ? (
                <p className="pf-muted">{row.reconciliationItem.notes}</p>
              ) : null}
            </>
          ) : (
            <p className="pf-muted">
              {designContext.kind === 'revision'
                ? 'Sin diferencias reportadas por el servidor para esta unidad.'
                : 'Elegí revisiones exactas (cotización + diseño publicado) para ver la reconciliación del servidor.'}
            </p>
          )}
        </section>

        <section className="pf-detail__section">
          <h4>Producción</h4>
          {contextualRelease ? (
            <p>
              Release #{contextualRelease.releaseNumber} fijado a R{contextualRelease.designRevisionNumber}
              {contextualRelease.manufacturingStale
                ? ' — el release está desactualizado respecto de la última revisión de diseño.'
                : ''}
            </p>
          ) : designContext.kind === 'working' ? (
            <p className="pf-muted">
              El trabajo en curso no cuenta con un release de producción.
              {latestProjectRelease
                ? ` El último release del proyecto es el #${latestProjectRelease.releaseNumber} (fijado a R${latestProjectRelease.designRevisionNumber}).`
                : ' Todavía no hay releases de producción para esta obra.'}
            </p>
          ) : (
            <p className="pf-muted">
              Esta revisión no cuenta con un release de producción contextual.
              {latestProjectRelease
                ? ` El último release del proyecto es el #${latestProjectRelease.releaseNumber} (fijado a R${latestProjectRelease.designRevisionNumber}).`
                : ' Todavía no hay releases de producción para esta obra.'}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const DIFF_LEAF_LABELS: Readonly<Record<string, string>> = {
  width: 'Ancho',
  height: 'Alto',
  depth: 'Profundidad',
};

const DIFF_SCOPE_LABELS: Readonly<Record<string, string>> = {
  parameters: 'Parámetros',
  materials: 'Materiales',
  materialChoices: 'Materiales',
};

/**
 * Presentation-only humanizer for server diff paths: `parameters.width`
 * becomes `Parámetros · Ancho` with an `mm` suffix. Unknown segments fall
 * back verbatim — no new diff semantics, only readable copy.
 */
function diffPathParts(path: string): { scope: string | null; leaf: string; unitSuffix: string } {
  const parts = path.split('.');
  const leafKey = parts[parts.length - 1] ?? path;
  const scopeKey = parts.length > 1 ? parts.slice(0, -1).join('.') : null;
  const dimensionLabel = DIFF_LEAF_LABELS[leafKey];
  return {
    scope: scopeKey ? (DIFF_SCOPE_LABELS[scopeKey] ?? scopeKey) : null,
    leaf: dimensionLabel ?? leafKey.replace(/_/g, ' '),
    unitSuffix: dimensionLabel !== undefined ? ' mm' : '',
  };
}
