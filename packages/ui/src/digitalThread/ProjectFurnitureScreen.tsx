import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Armchair, ClipboardCheck, RefreshCw, TriangleAlert } from 'lucide-react';
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
import { EmptyState, Modal, PageHeader, PageLoading, SearchInput, StatusChips } from '../common';
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
  Record<ReconciliationStatus, { label: string; className: string }>
> = {
  synced: { label: 'Sincronizada', className: 'status-badge status-badge--done' },
  quoted_not_modeled: {
    label: 'Cotizada sin modelar',
    className: 'status-badge status-badge--warning',
  },
  modeled_not_quoted: {
    label: 'Modelada sin cotizar',
    className: 'status-badge status-badge--warning',
  },
  modified: { label: 'Modificada', className: 'status-badge status-badge--warning' },
  removed: { label: 'Retirada del diseño', className: 'status-badge status-badge--danger' },
  conflict: { label: 'Conflicto', className: 'status-badge status-badge--danger' },
};

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

export function ProjectFurnitureScreen({
  baseUrl,
  token,
  projectId,
  queryKeys,
  initialContext,
  onContextChange,
  onBack,
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
          onBack ? (
            <button type="button" className="btn btn--secondary" onClick={onBack}>
              Volver a la obra
            </button>
          ) : null
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
        <PageLoading label="Cargando muebles de la obra…" />
      ) : workspaceQuery.isError ? (
        <EmptyState
          variant="empty"
          title="No se pudo cargar la matriz de muebles"
          description={loadErrorMessage(workspaceQuery.error)}
          actionLabel="Reintentar"
          onAction={reloadAll}
        />
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
            contextualRelease={contextualRelease}
            latestProjectRelease={latestProjectRelease}
            busy={contextBusy}
          />

          <ProjectFurnitureSummaryCards summary={summary} />

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
            <div className="data-table-wrap" data-testid="pf-table-wrap">
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
                    <th scope="col">Estado</th>
                    <th scope="col">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.instance.id} data-testid={`pf-row-${row.instance.id}`}>
                      <td>
                        <div className="pf-cell-title">
                          <span className="pf-label">{row.label}</span>
                          {row.unitProvenanceLabel ? (
                            <span className="meta-chip">{row.unitProvenanceLabel}</span>
                          ) : null}
                        </div>
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
                      <td>
                        {row.reconciliation === null ? (
                          <span className="pf-muted">—</span>
                        ) : (
                          <span className={RECONCILIATION_BADGES[row.reconciliation].className}>
                            {RECONCILIATION_BADGES[row.reconciliation].label}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={lifecycleBadgeClass(row.lifecycle)}>
                          {row.lifecycleLabel}
                        </span>
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
                  ))}
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
  readonly contextualRelease: FurnitureWorkspaceReleaseContext | null;
  readonly latestProjectRelease: FurnitureWorkspaceReleaseContext | null;
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
  contextualRelease,
  latestProjectRelease,
  busy,
}: ContextBarProps): ReactNode {
  const releaseQuote = contextualRelease?.quoteRevisionId
    ? quoteRevisions.find((revision) => revision.id === contextualRelease.quoteRevisionId)
    : null;

  return (
    <div className="pf-context" data-testid="pf-context-bar">
      <div className="pf-context__selectors">
        <label className="pf-field">
          <span>Cotización (contexto comercial exacto)</span>
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

      <div className="pf-context__reference">
        {designContext.kind === 'revision' ? null : (
          <p className="pf-context__note">
            La reconciliación se calcula contra una revisión de diseño publicada exacta; el
            trabajo en curso muestra presencia, no reconciliación.
          </p>
        )}
        {contextualRelease ? (
          <p className="pf-context__release" data-testid="pf-release-reference">
            <ClipboardCheck size={14} aria-hidden />
            Release #{contextualRelease.releaseNumber} fijado a R{contextualRelease.designRevisionNumber}
            {contextualRelease.quoteRevisionId && releaseQuote
              ? ` y Q${releaseQuote.revisionNumber}`
              : ''}
            {contextualRelease.manufacturingStale ? (
              <span
                className="status-badge status-badge--warning"
                title="Una revisión más reciente cambió la huella de manufactura"
              >
                <TriangleAlert size={12} aria-hidden /> desactualizado
              </span>
            ) : null}
          </p>
        ) : designContext.kind === 'working' ? (
          <p className="pf-context__release pf-context__release--none" data-testid="pf-release-reference">
            <ClipboardCheck size={14} aria-hidden />
            <span>Release del contexto: Ninguno (trabajo en curso)</span>
            {latestProjectRelease ? (
              <span className="pf-muted">
                {' '}· Último release del proyecto: #{latestProjectRelease.releaseNumber} (fijado a R{latestProjectRelease.designRevisionNumber})
              </span>
            ) : null}
          </p>
        ) : latestProjectRelease ? (
          <p className="pf-context__release pf-context__release--none" data-testid="pf-release-reference">
            <ClipboardCheck size={14} aria-hidden />
            <span>Release del contexto: Ninguno</span>
            <span className="pf-muted">
              {' '}· Último release del proyecto: #{latestProjectRelease.releaseNumber} (fijado a R{latestProjectRelease.designRevisionNumber})
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ProjectFurnitureSummaryCards({
  summary,
}: {
  readonly summary: FurnitureMatrixSummary;
}): ReactNode {
  const cards = [
    {
      id: 'active',
      label: 'Unidades activas',
      value: summary.activeUnits,
      hint: `de ${summary.total} unidades históricas`,
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
      value: summary.requireAttention,
      hint: 'acción sugerida',
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
      {cards.map((card) => (
        <div className="pf-summary__card" key={card.id} data-testid={`pf-summary-${card.id}`}>
          <span className="pf-summary__value">{card.value}</span>
          <span className="pf-summary__label">{card.label}</span>
          <span className="pf-summary__hint">{card.hint}</span>
        </div>
      ))}
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
                <span className={RECONCILIATION_BADGES[row.reconciliationItem.status].className}>
                  {RECONCILIATION_BADGES[row.reconciliationItem.status].label}
                </span>
              </p>
              {row.nextStep ? (
                <p className="pf-detail__next-step">Próximo paso: {row.nextStep}</p>
              ) : null}
              {row.reconciliationItem.differences.length > 0 ? (
                <ul className="pf-kv-list">
                  {row.reconciliationItem.differences.map((difference, index) => (
                    <li key={`${difference.path}-${index}`}>
                      <span>{difference.path}</span>
                      <span>
                        {formatScalar(difference.quoteValue)} →{' '}
                        {formatScalar(difference.designValue)}
                      </span>
                    </li>
                  ))}
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
