import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitCompareArrows,
  History,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import {
  GraneteApiClient,
  GraneteApiError,
  type Design,
  type DesignRevision,
  type ManufacturingPreflightIssue,
  type ProductionRelease,
  type QuoteRevision,
  type QuoteRevisionDetail,
  type ReconciliationItem,
} from '@granete/storage';
import { EmptyState, PageHeader, PageLoading } from '../common';
import {
  AcceptQuoteModal,
  ApprovalPanel,
  CommandErrorAlert,
  PreflightPanel,
  QuoteLifecyclePanel,
  ReleaseHistoryList,
  ReleasePanel,
  ReleaseReviewModal,
  RequoteReviewModal,
  describeCommandError,
  preflightIssuesFromError,
  quoteStatusLabelOf,
  type CommandErrorView,
} from './ReconciliationCommandPanels';
import {
  PREFLIGHT_STATUS_LABELS,
  RECONCILIATION_STATUS_LABELS,
  impactChips,
  formatQuoteRevisionLabel,
  formatDesignRevisionLabel,
  formatDifferencePath,
  formatDifferenceValue,
  findContextualRelease,
  isHistoricalComparison,
  isIncorporableChange,
} from './reconciliationWorkspace';
import './digitalThread.css';

/**
 * #502 / WEB-DT-3 — Reconciliation, approval and exact ProductionRelease
 * workspace.
 *
 * Third visible React surface of the Digital Thread (#396 / #384). It chains
 * the explicit, auditable flow:
 *
 *   exact QuoteRevision → exact DesignRevision → authoritative reconciliation
 *   → explicit requote (new immutable draft) → authoritative preflight
 *   → exact DesignRevision approval → exact ProductionRelease → durable history.
 *
 * Authority contract:
 * - every classification, impact, blocker, count and verdict comes verbatim
 *   from the generated backend contracts (#393/#394/#466/#395); this screen
 *   never compares parameters or infers impact;
 * - every action sends exact revision IDs — never `latest`/`current`;
 * - success only renders after the authoritative response (no optimistic
 *   business success);
 * - an accepted QuoteRevision is never mutated: requote always creates a new
 *   draft revision;
 * - #499 SketchUp handoff and #503 machine evidence are deferred.
 */

export interface ProjectReconciliationContextState {
  readonly quoteRevisionId: string | null;
  readonly designId: string | null;
  readonly designRevisionId: string | null;
}

export interface ProjectReconciliationQueryKeys {
  readonly root: QueryKey;
  readonly quoteAuthority: QueryKey;
  readonly quoteRevisions: QueryKey;
  readonly designs: QueryKey;
  readonly designRevisions: (designId: string) => QueryKey;
  readonly reconciliation: (quoteRevisionId: string, designRevisionId: string) => QueryKey;
  readonly preflight: (designId: string, designRevisionId: string) => QueryKey;
  readonly productionReleases: QueryKey;
}

export function projectReconciliationQueryKeys(
  scopeKey: readonly unknown[],
  projectId: string,
): ProjectReconciliationQueryKeys {
  const root: QueryKey = ['project-reconciliation', ...scopeKey, projectId];
  return {
    root,
    quoteAuthority: ['quote-revision-authority', ...scopeKey, projectId],
    quoteRevisions: [...root, 'quote-revisions'],
    designs: [...root, 'designs'],
    designRevisions: (designId: string) => [...root, 'designs', designId, 'revisions'],
    // Each exact Q/R pair gets its own cache entry: Q1/R1, Q2/R1 and Q1/R2
    // never share reconciliation truth.
    reconciliation: (quoteRevisionId: string, designRevisionId: string) => [
      ...root,
      'reconciliation',
      quoteRevisionId,
      designRevisionId,
    ],
    preflight: (designId: string, designRevisionId: string) => [
      ...root,
      'designs',
      designId,
      'revisions',
      designRevisionId,
      'preflight',
    ],
    productionReleases: [...root, 'production-releases'],
  };
}

export interface ProjectReconciliationScreenProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly queryKeys: ProjectReconciliationQueryKeys;
  readonly initialContext?: ProjectReconciliationContextState | null;
  readonly onContextChange?: (context: ProjectReconciliationContextState) => void;
  readonly onBack?: () => void;
  readonly onOpenDesigns?: (context: { designId: string | null; revisionId: string | null }) => void;
  readonly onOpenFurnitureMatrix?: (context: {
    quoteRevisionId: string | null;
    designId: string | null;
    revisionId: string | null;
  }) => void;
  /** Role hints (server remains the authority for every command). */
  readonly canRequote?: boolean;
  readonly canApprove?: boolean;
  readonly canRelease?: boolean;
  readonly canMutateQuote?: boolean;
  readonly canAcceptQuote?: boolean;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ProjectReconciliationScreen({
  baseUrl,
  token,
  projectId,
  queryKeys,
  initialContext,
  onContextChange,
  onBack,
  onOpenDesigns,
  onOpenFurnitureMatrix,
  canRequote = false,
  canApprove = false,
  canRelease = false,
  canMutateQuote = false,
  canAcceptQuote = false,
}: ProjectReconciliationScreenProps): ReactNode {
  const queryClient = useQueryClient();
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);

  const [quoteRevisionId, setQuoteRevisionId] = useState<string | null>(
    () => initialContext?.quoteRevisionId ?? null,
  );
  const [designId, setDesignId] = useState<string | null>(() => initialContext?.designId ?? null);
  const [designRevisionId, setDesignRevisionId] = useState<string | null>(
    () => initialContext?.designRevisionId ?? null,
  );

  // Commercial QuoteRevision lifecycle state (#571 / WEB-DT-4)
  const [createQuoteSubmitting, setCreateQuoteSubmitting] = useState(false);
  const [createQuoteError, setCreateQuoteError] = useState<CommandErrorView | null>(null);

  const [publishQuoteSubmitting, setPublishQuoteSubmitting] = useState(false);
  const [publishQuoteError, setPublishQuoteError] = useState<CommandErrorView | null>(null);

  const [acceptModalOpen, setAcceptModalOpen] = useState(false);
  const [acceptQuoteSubmitting, setAcceptQuoteSubmitting] = useState(false);
  const [acceptQuoteError, setAcceptQuoteError] = useState<CommandErrorView | null>(null);
  const [quoteLifecycleNotice, setQuoteLifecycleNotice] = useState<string | null>(null);

  // Requote flow state
  const [requoteOpen, setRequoteOpen] = useState(false);
  const [requoteSelected, setRequoteSelected] = useState<readonly string[]>([]);
  const [requoteSubmitting, setRequoteSubmitting] = useState(false);
  const [requoteError, setRequoteError] = useState<CommandErrorView | null>(null);
  const [requoteResult, setRequoteResult] = useState<{
    readonly quoteRevision: QuoteRevision;
    readonly sourceQuoteRevisionId: string;
    readonly sourceDesignRevisionId: string;
  } | null>(null);

  // Approval flow state
  const [approveSubmitting, setApproveSubmitting] = useState(false);
  const [approveError, setApproveError] = useState<CommandErrorView | null>(null);
  const [approveResult, setApproveResult] = useState<{ readonly revision: DesignRevision } | null>(null);

  // Release flow state
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseSubmitting, setReleaseSubmitting] = useState(false);
  const [releaseError, setReleaseError] = useState<CommandErrorView | null>(null);
  const [releasePreflightIssues, setReleasePreflightIssues] = useState<
    readonly ManufacturingPreflightIssue[]
  >([]);
  const [releaseResult, setReleaseResult] = useState<{ readonly release: ProductionRelease } | null>(null);

  const [showTechnicalAudit, setShowTechnicalAudit] = useState(false);

  const pinContext = (next: ProjectReconciliationContextState) => {
    setQuoteRevisionId(next.quoteRevisionId);
    setDesignId(next.designId);
    setDesignRevisionId(next.designRevisionId);
    onContextChange?.(next);
  };

  // ---- Read models -------------------------------------------------------------

  const quoteRevisionsQuery = useQuery({
    queryKey: queryKeys.quoteRevisions,
    queryFn: ({ signal }) => api.listProjectQuoteRevisions(token, projectId, signal),
  });
  const quoteRevisions: readonly QuoteRevisionDetail[] = quoteRevisionsQuery.data ?? [];

  const designsQuery = useQuery({
    queryKey: queryKeys.designs,
    queryFn: ({ signal }) => api.listProjectDesigns(token, projectId, signal),
  });
  const designs: readonly Design[] = designsQuery.data ?? [];

  const selectedDesign = useMemo(() => {
    if (!designId) return designs[0] ?? null;
    return designs.find((d) => d.id === designId) ?? null;
  }, [designs, designId]);
  const isInvalidExplicitDesign = Boolean(
    designId && designsQuery.isSuccess && designs.length > 0 && !selectedDesign,
  );
  const activeDesignId = selectedDesign?.id ?? null;

  const designRevisionsQuery = useQuery({
    queryKey: activeDesignId
      ? queryKeys.designRevisions(activeDesignId)
      : ['project-reconciliation', 'revisions', 'none'],
    queryFn: ({ signal }) => api.listDesignRevisions(token, activeDesignId as string, signal),
    enabled: activeDesignId !== null,
  });
  const designRevisions: readonly DesignRevision[] = designRevisionsQuery.data ?? [];

  // Convenience defaults ONLY while the context is unpinned: newest quote
  // revision and newest published design revision. Once pinned, an ID that
  // disappears fails closed below — never retargets to latest.
  useEffect(() => {
    if (quoteRevisionsQuery.isSuccess && quoteRevisions.length > 0 && !quoteRevisionId) {
      const newest = quoteRevisions[quoteRevisions.length - 1]!;
      setQuoteRevisionId(newest.id);
      onContextChange?.({
        quoteRevisionId: newest.id,
        designId: activeDesignId,
        designRevisionId,
      });
    }
  }, [quoteRevisionsQuery.isSuccess, quoteRevisions, quoteRevisionId, activeDesignId, designRevisionId, onContextChange]);

  useEffect(() => {
    if (designsQuery.isSuccess && designs.length > 0 && !designId) {
      setDesignId(designs[0]!.id);
      onContextChange?.({ quoteRevisionId, designId: designs[0]!.id, designRevisionId: null });
    }
  }, [designsQuery.isSuccess, designs, designId, quoteRevisionId, designRevisionId, onContextChange]);

  useEffect(() => {
    if (designRevisionsQuery.isSuccess && designRevisions.length > 0 && !designRevisionId) {
      const newest = [...designRevisions].sort(
        (a, b) => b.revision_number - a.revision_number,
      )[0]!;
      setDesignRevisionId(newest.id);
      onContextChange?.({ quoteRevisionId, designId: activeDesignId, designRevisionId: newest.id });
    }
  }, [designRevisionsQuery.isSuccess, designRevisions, designRevisionId, quoteRevisionId, activeDesignId, onContextChange]);

  const selectedQuoteRevision = useMemo(
    () => quoteRevisions.find((q) => q.id === quoteRevisionId) ?? null,
    [quoteRevisions, quoteRevisionId],
  );
  const isInvalidExplicitQuote = Boolean(
    quoteRevisionId &&
      quoteRevisionsQuery.isSuccess &&
      !quoteRevisionsQuery.isLoading &&
      quoteRevisions.length > 0 &&
      !selectedQuoteRevision,
  );

  const selectedDesignRevision = useMemo(
    () => designRevisions.find((r) => r.id === designRevisionId) ?? null,
    [designRevisions, designRevisionId],
  );
  const isInvalidExplicitRevision = Boolean(
    designRevisionId &&
      designRevisionsQuery.isSuccess &&
      !designRevisionsQuery.isLoading &&
      !selectedDesignRevision,
  );

  // ---- Authoritative reconciliation (exact Q/R pair) --------------------------

  const reconciliationQuery = useQuery({
    queryKey:
      quoteRevisionId && designRevisionId
        ? queryKeys.reconciliation(quoteRevisionId, designRevisionId)
        : ['project-reconciliation', 'reconciliation', 'none'],
    queryFn: ({ signal }) =>
      api.reconcileProjectDesign(
        token,
        projectId,
        { quoteRevisionId: quoteRevisionId as string, designRevisionId: designRevisionId as string },
        signal,
      ),
    enabled: quoteRevisionId !== null && designRevisionId !== null,
  });
  const reconciliation = reconciliationQuery.data ?? null;

  // ---- Authoritative preflight (exact revision) --------------------------------

  const preflightQuery = useQuery({
    queryKey:
      activeDesignId && designRevisionId
        ? queryKeys.preflight(activeDesignId, designRevisionId)
        : ['project-reconciliation', 'preflight', 'none'],
    queryFn: ({ signal }) =>
      api.evaluateDesignRevisionPreflight(
        token,
        activeDesignId as string,
        designRevisionId as string,
        signal,
      ),
    enabled: activeDesignId !== null && designRevisionId !== null,
  });
  const preflight = preflightQuery.data ?? null;

  // ---- Releases ----------------------------------------------------------------

  const releasesQuery = useQuery({
    queryKey: queryKeys.productionReleases,
    queryFn: ({ signal }) => api.listProjectProductionReleases(token, projectId, signal),
  });
  const releases: readonly ProductionRelease[] = releasesQuery.data ?? [];
  const contextualRelease = useMemo(
    () => findContextualRelease(releases, quoteRevisionId, designRevisionId),
    [releases, quoteRevisionId, designRevisionId],
  );

  const historicalComparison = isHistoricalComparison(
    selectedQuoteRevision?.status,
    selectedDesignRevision?.status,
  );

  const incorporableItems = useMemo(
    () => (reconciliation ? reconciliation.items.filter(isIncorporableChange) : []),
    [reconciliation],
  );

  // ---- Commands (no optimistic business success) ---------------------------------

  const invalidateQuoteRevisionReads = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.quoteRevisions }),
      queryClient.invalidateQueries({ queryKey: queryKeys.quoteAuthority }),
      queryClient.invalidateQueries({ queryKey: [...queryKeys.root, 'reconciliation'] }),
    ]);
  };

  // Commercial QuoteRevision lifecycle commands (#571 / WEB-DT-4)
  const handleCreateInitialQuote = async () => {
    setCreateQuoteSubmitting(true);
    setCreateQuoteError(null);
    setQuoteLifecycleNotice(null);
    try {
      const created = await api.createInitialProjectQuoteRevision(token, projectId, {});
      await invalidateQuoteRevisionReads();
      setQuoteRevisionId(created.id);
      onContextChange?.({
        quoteRevisionId: created.id,
        designId: activeDesignId,
        designRevisionId,
      });
      setQuoteLifecycleNotice(`Revisión Q${created.revisionNumber} creada como borrador.`);
    } catch (err) {
      setCreateQuoteError(describeCommandError(err));
    } finally {
      setCreateQuoteSubmitting(false);
    }
  };

  const handlePublishQuote = async () => {
    if (!selectedQuoteRevision) return;
    setPublishQuoteSubmitting(true);
    setPublishQuoteError(null);
    setQuoteLifecycleNotice(null);
    try {
      const published = await api.publishProjectQuoteRevision(
        token,
        projectId,
        selectedQuoteRevision.id,
      );
      await invalidateQuoteRevisionReads();
      setQuoteLifecycleNotice(`Revisión Q${published.revisionNumber} publicada.`);
    } catch (err) {
      setPublishQuoteError(describeCommandError(err));
    } finally {
      setPublishQuoteSubmitting(false);
    }
  };

  const handleConfirmAcceptQuote = async () => {
    if (!selectedQuoteRevision) return;
    setAcceptQuoteSubmitting(true);
    setAcceptQuoteError(null);
    try {
      const accepted = await api.acceptProjectQuoteRevision(
        token,
        projectId,
        selectedQuoteRevision.id,
      );
      await invalidateQuoteRevisionReads();
      if (activeDesignId && designRevisionId) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.preflight(activeDesignId, designRevisionId),
        });
      }
      setAcceptModalOpen(false);
      setApproveError(null);
      setReleaseError(null);
      setQuoteLifecycleNotice(
        `Revisión Q${accepted.revisionNumber} aceptada y fijada como base comercial autoritativa.`,
      );
    } catch (err) {
      setAcceptQuoteError(describeCommandError(err));
    } finally {
      setAcceptQuoteSubmitting(false);
    }
  };

  const handleOpenRequote = () => {
    // Pre-select every incorporable unit: the user reviews and may unselect —
    // the server revalidates the final selection fail-closed.
    setRequoteSelected(incorporableItems.map((i) => i.furnitureInstanceId));
    setRequoteError(null);
    setRequoteOpen(true);
  };

  const handleToggleRequoteItem = (furnitureInstanceId: string, checked: boolean) => {
    setRequoteSelected((prev) =>
      checked ? [...prev, furnitureInstanceId] : prev.filter((id) => id !== furnitureInstanceId),
    );
  };

  const handleRequote = async () => {
    if (!quoteRevisionId || !designRevisionId) return;
    setRequoteSubmitting(true);
    setRequoteError(null);
    try {
      const result = await api.requoteProjectQuote(token, projectId, {
        baseQuoteRevisionId: quoteRevisionId,
        designRevisionId,
        includeFurnitureInstanceIds: requoteSelected.length > 0 ? [...requoteSelected] : undefined,
      });
      // Success only AFTER the authoritative response: refresh the exact
      // scopes (quote revisions + every reconciliation pair of this project).
      await invalidateQuoteRevisionReads();
      setRequoteResult({
        quoteRevision: result.quoteRevision,
        sourceQuoteRevisionId: quoteRevisionId,
        sourceDesignRevisionId: designRevisionId,
      });
      setRequoteOpen(false);
    } catch (err) {
      setRequoteError(describeCommandError(err));
    } finally {
      setRequoteSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!activeDesignId || !designRevisionId) return;
    setApproveSubmitting(true);
    setApproveError(null);
    setApproveResult(null);
    try {
      // #502 production approval: the always-gated command REQUIRES the
      // exact QuoteRevision — the server enforces the same authoritative
      // commercial + preflight gates as the release command (typed 409
      // blockers on any violation; there is no skip mode).
      if (!quoteRevisionId) {
        setApproveError({
          kind: 'validation',
          title: 'Cotización exacta requerida',
          message: 'Seleccioná la cotización exacta que aprueba esta revisión para producción.',
        });
        return;
      }
      const revision = await api.approveProjectDesignRevisionForProduction(
        token,
        projectId,
        activeDesignId,
        designRevisionId,
        { quoteRevisionId },
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.designRevisions(activeDesignId) });
      setApproveResult({ revision });
    } catch (err) {
      setApproveError(describeCommandError(err));
    } finally {
      setApproveSubmitting(false);
    }
  };

  const handleRelease = async () => {
    if (!designRevisionId) return;
    setReleaseSubmitting(true);
    setReleaseError(null);
    setReleasePreflightIssues([]);
    try {
      // #502: the release always pins the exact selected commercial baseline
      // (the panel/review only allow accepted quotes; the server re-verifies).
      const release = await api.createProductionRelease(token, projectId, {
        design_revision_id: designRevisionId,
        quote_revision_id: quoteRevisionId,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.productionReleases });
      setReleaseResult({ release });
      setReleaseOpen(false);
    } catch (err) {
      setReleaseError(describeCommandError(err));
      setReleasePreflightIssues(preflightIssuesFromError(err));
    } finally {
      setReleaseSubmitting(false);
    }
  };

  // ---- Loading / error gates -----------------------------------------------------

  if (designsQuery.isLoading || quoteRevisionsQuery.isLoading) {
    return <PageLoading label="Cargando contexto de reconciliación…" />;
  }

  const loadError = designsQuery.error ?? quoteRevisionsQuery.error;
  if (loadError) {
    const msg =
      loadError instanceof GraneteApiError && loadError.code === 'FORBIDDEN'
        ? 'No tenés permiso para ver esta obra.'
        : 'Error al cargar el contexto de la obra. Verificá tu conexión.';
    return (
      <div className="pd-error-container" role="alert">
        <TriangleAlert size={28} className="text-danger" />
        <p>{msg}</p>
        {onBack && (
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Volver al proyecto
          </button>
        )}
      </div>
    );
  }

  const quoteLabel = formatQuoteRevisionLabel(selectedQuoteRevision);
  const revLabel = formatDesignRevisionLabel(selectedDesignRevision);
  const summary = reconciliation?.summary ?? null;
  const impactSummary = reconciliation?.impact ?? null;

  return (
    <div className="pr-workspace" data-testid="project-reconciliation-workspace">
      <PageHeader
        title="Reconciliación y liberación"
        subtitle="Comparación exacta cotización ↔ diseño, re-cotización explícita, preflight autoritativo, aprobación y liberación inmutable."
        secondaryActions={
          <div className="pd-header-actions">
            {onOpenDesigns && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="open-designs-btn"
                onClick={() =>
                  onOpenDesigns({ designId: activeDesignId, revisionId: designRevisionId })
                }
              >
                <History size={16} />
                <span>Ver diseños</span>
              </button>
            )}
            {onOpenFurnitureMatrix && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="open-furniture-btn"
                onClick={() =>
                  onOpenFurnitureMatrix({
                    quoteRevisionId,
                    designId: activeDesignId,
                    revisionId: designRevisionId,
                  })
                }
              >
                <ArrowRightLeft size={16} />
                <span>Ver muebles</span>
              </button>
            )}
            {onBack && (
              <button type="button" className="btn btn-secondary" onClick={onBack}>
                Volver
              </button>
            )}
          </div>
        }
      />

      {designs.length === 0 || quoteRevisions.length === 0 ? (
        <div className="pd-card pr-panel" style={{ padding: '2rem', alignItems: 'center' }}>
          <EmptyState
            icon={GitCompareArrows}
            title="Falta contexto para reconciliar"
            description={
              quoteRevisions.length === 0
                ? 'Esta obra no tiene revisiones de cotización todavía.'
                : 'Esta obra no tiene diseños con revisiones publicadas todavía.'
            }
          />
          {quoteRevisions.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
              <CommandErrorAlert error={createQuoteError} />
              <button
                type="button"
                className="btn btn-primary"
                data-testid="create-initial-quote-btn"
                disabled={createQuoteSubmitting || !canMutateQuote}
                onClick={() => void handleCreateInitialQuote()}
              >
                {createQuoteSubmitting ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
                <span>{createQuoteSubmitting ? 'Creando Q1…' : 'Crear revisión de cotización (Q1)'}</span>
              </button>
              {!canMutateQuote && (
                <p className="pr-panel__why" data-testid="create-quote-permission-hint">
                  Tu rol no tiene permiso para crear revisiones de cotización.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Exact context selectors */}
          <section className="pd-card pr-context-bar" data-testid="reconciliation-context-bar">
            <div className="pr-context-bar__field">
              <label htmlFor="pr-quote-select">Cotización (exacta)</label>
              <select
                id="pr-quote-select"
                className="form-control"
                data-testid="quote-revision-select"
                value={quoteRevisionId ?? ''}
                onChange={(e) =>
                  pinContext({
                    quoteRevisionId: e.target.value || null,
                    designId: activeDesignId,
                    designRevisionId,
                  })
                }
              >
                {quoteRevisions.map((q) => (
                  <option key={q.id} value={q.id}>
                    Q{q.revisionNumber} · {quoteStatusLabelOf(q)}
                  </option>
                ))}
              </select>
            </div>
            <div className="pr-context-bar__field">
              <label htmlFor="pr-design-select">Diseño</label>
              <select
                id="pr-design-select"
                className="form-control"
                data-testid="design-select"
                value={activeDesignId ?? ''}
                onChange={(e) =>
                  pinContext({
                    quoteRevisionId,
                    designId: e.target.value || null,
                    designRevisionId: null,
                  })
                }
              >
                {designs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="pr-context-bar__field">
              <label htmlFor="pr-revision-select">Revisión de diseño (exacta)</label>
              <select
                id="pr-revision-select"
                className="form-control"
                data-testid="design-revision-select"
                value={designRevisionId ?? ''}
                onChange={(e) =>
                  pinContext({
                    quoteRevisionId,
                    designId: activeDesignId,
                    designRevisionId: e.target.value || null,
                  })
                }
              >
                {designRevisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    R{r.revision_number} ·{' '}
                    {r.status === 'approved'
                      ? 'Aprobada'
                      : r.status === 'superseded'
                        ? 'Reemplazada'
                        : 'Publicada'}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Fail-closed notices — an explicit ID that no longer exists never retargets */}
          {isInvalidExplicitQuote && (
            <div className="pd-context-invalid" data-testid="invalid-quote-notice">
              <div className="pd-alert pd-alert--error">
                <strong>Cotización no disponible</strong>
                <p>La revisión de cotización seleccionada no existe en esta obra.</p>
              </div>
            </div>
          )}
          {isInvalidExplicitDesign && (
            <div className="pd-context-invalid" data-testid="invalid-design-notice">
              <div className="pd-alert pd-alert--error">
                <strong>Diseño no disponible</strong>
                <p>El diseño seleccionado ya no está disponible en esta obra.</p>
              </div>
            </div>
          )}
          {isInvalidExplicitRevision && (
            <div className="pd-context-invalid" data-testid="invalid-revision-notice">
              <div className="pd-alert pd-alert--error">
                <strong>Revisión no disponible</strong>
                <p>La revisión seleccionada no pertenece a este diseño o ya no existe.</p>
              </div>
            </div>
          )}

          {!isInvalidExplicitQuote && !isInvalidExplicitDesign && !isInvalidExplicitRevision && (
            <>
              {/* Exact context header */}
              <section className="pr-exact-header" data-testid="exact-context-header">
                <div className="pr-exact-header__side">
                  <span className="pr-exact-header__kind">Cotización</span>
                  <strong>
                    {quoteLabel} · {quoteStatusLabelOf(selectedQuoteRevision)}
                  </strong>
                </div>
                <span className="pr-exact-header__vs">vs</span>
                <div className="pr-exact-header__side">
                  <span className="pr-exact-header__kind">Diseño</span>
                  <strong>
                    {revLabel} ·{' '}
                    {selectedDesignRevision
                      ? selectedDesignRevision.status === 'approved'
                        ? 'Aprobada'
                        : selectedDesignRevision.status === 'superseded'
                          ? 'Reemplazada'
                          : 'Publicada'
                      : '—'}
                  </strong>
                </div>
                {contextualRelease && (
                  <span
                    className="pd-inspector__release-badge"
                    data-testid="contextual-release-badge"
                    title={`Fijada a ${quoteLabel} + ${revLabel}`}
                  >
                    <CheckCircle2 size={14} />
                    Liberación contextual #{contextualRelease.release_number}
                  </span>
                )}
              </section>

              {historicalComparison && (
                <div className="pd-alert pd-alert--warning" data-testid="historical-comparison-note">
                  Esta comparación es histórica: una o ambas revisiones fueron reemplazadas. Los
                  comandos basados en ellas serán validados por el servidor.
                </div>
              )}

              {/* Reconciliation (server-owned truth) */}
              {reconciliationQuery.isLoading ? (
                <div className="pd-detail-loading" data-testid="reconciliation-loading">
                  <RefreshCw size={20} className="spin" />
                  <span>Calculando reconciliación autoritativa {quoteLabel} ↔ {revLabel}…</span>
                </div>
              ) : reconciliationQuery.isError ? (
                <div className="pd-context-invalid" data-testid="reconciliation-error">
                  <div className="pd-alert pd-alert--error">
                    <strong>Error al reconciliar</strong>
                    <p>
                      El servidor no pudo comparar {quoteLabel} con {revLabel}.
                      {(reconciliationQuery.error instanceof GraneteApiError &&
                        reconciliationQuery.error.message) ||
                        ''}
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void reconciliationQuery.refetch()}
                    >
                      Reintentar
                    </button>
                  </div>
                </div>
              ) : reconciliation ? (
                <>
                  {/* Summary — server counts, verbatim */}
                  <section className="pd-card pr-summary" data-testid="reconciliation-summary">
                    <div className="pd-card__header">
                      <div className="pd-card__title">
                        <GitCompareArrows size={18} />
                        <h3>Resumen de reconciliación</h3>
                      </div>
                      {impactSummary && (
                        <span className="pr-summary__state" data-testid="reconciliation-state">
                          {impactSummary.requiresResolution
                            ? 'Conflictos requieren resolución'
                            : impactSummary.requiresRequote
                              ? 'Cambios comerciales requieren atención'
                              : 'Sin cambios que requieran acción'}
                        </span>
                      )}
                    </div>
                    <dl className="pr-summary__grid">
                      <div>
                        <dt>Sincronizados</dt>
                        <dd data-testid="summary-synced">{summary?.synced ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Cambios (modificados)</dt>
                        <dd data-testid="summary-modified">{summary?.modified ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Cotizados no modelados</dt>
                        <dd data-testid="summary-quoted-not-modeled">
                          {summary?.quotedNotModeled ?? 0}
                        </dd>
                      </div>
                      <div>
                        <dt>Modelados no cotizados</dt>
                        <dd data-testid="summary-modeled-not-quoted">
                          {summary?.modeledNotQuoted ?? 0}
                        </dd>
                      </div>
                      <div>
                        <dt>Conflictos</dt>
                        <dd data-testid="summary-conflict">{summary?.conflict ?? 0}</dd>
                      </div>
                      {impactSummary && (
                        <>
                          <div>
                            <dt>Cambios comerciales</dt>
                            <dd>{impactSummary.commercialChanges}</dd>
                          </div>
                          <div>
                            <dt>Cambios de fabricación</dt>
                            <dd>{impactSummary.manufacturingChanges}</dd>
                          </div>
                          <div>
                            <dt>Sólo espaciales</dt>
                            <dd>{impactSummary.spatialChanges}</dd>
                          </div>
                        </>
                      )}
                    </dl>
                  </section>

                  {/* Unit list — keyed by furnitureInstanceId */}
                  <section className="pd-card pr-units" data-testid="reconciliation-units">
                    <div className="pd-card__header">
                      <div className="pd-card__title">
                        <FileText size={18} />
                        <h3>Unidades físicas ({reconciliation.items.length})</h3>
                      </div>
                      {canRequote && impactSummary && !impactSummary.requiresResolution && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          data-testid="open-requote-btn"
                          disabled={incorporableItems.length === 0}
                          onClick={handleOpenRequote}
                        >
                          <GitCompareArrows size={14} />
                          <span>Nueva cotización desde {quoteLabel}</span>
                        </button>
                      )}
                    </div>
                    {incorporableItems.length === 0 && canRequote && !impactSummary?.requiresResolution && (
                      <p className="pr-panel__why" data-testid="requote-unavailable-hint">
                        {impactSummary?.requiresRequote
                          ? 'Los cambios actuales no son incorporables a una nueva cotización.'
                          : 'Sin cambios comerciales que incorporar: no hace falta re-cotizar.'}
                      </p>
                    )}
                    {reconciliation.items.length === 0 ? (
                      <p className="pd-empty-hint">Ninguna unidad física participa en esta comparación.</p>
                    ) : (
                      <div className="pd-table-container">
                        <table className="pd-items-table" data-testid="reconciliation-items-table">
                          <thead>
                            <tr>
                              <th scope="col">Unidad física</th>
                              <th scope="col">Estado</th>
                              <th scope="col">Diferencias</th>
                              <th scope="col">Impacto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconciliation.items.map((item) => (
                              <ReconciliationUnitRow key={item.furnitureInstanceId} item={item} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <p className="pd-empty-hint">Seleccioná una cotización y una revisión publicada.</p>
              )}

              {/* Command results (only after authoritative responses) */}
              {requoteResult && (
                <div className="pd-alert pd-alert--success" data-testid="requote-success">
                  <strong>
                    Nueva cotización Q{requoteResult.quoteRevision.revisionNumber} creada como
                    borrador.
                  </strong>{' '}
                  <span>
                    La cotización base Q
                    {quoteRevisions.find((q) => q.id === requoteResult.sourceQuoteRevisionId)
                      ?.revisionNumber ?? '?'}{' '}
                    permanece intacta. Origen de diseño:{' '}
                    {formatDesignRevisionLabel(selectedDesignRevision)}.
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    data-testid="compare-new-quote-btn"
                    onClick={() => {
                      setRequoteResult(null);
                      pinContext({
                        quoteRevisionId: requoteResult.quoteRevision.id,
                        designId: activeDesignId,
                        designRevisionId: requoteResult.sourceDesignRevisionId,
                      });
                    }}
                  >
                    Comparar Q{requoteResult.quoteRevision.revisionNumber} con{' '}
                    {formatDesignRevisionLabel(selectedDesignRevision)}
                  </button>
                </div>
              )}
              {quoteLifecycleNotice && (
                <div className="pd-alert pd-alert--success" data-testid="quote-lifecycle-success">
                  <strong>{quoteLifecycleNotice}</strong>
                </div>
              )}
              {approveResult && (
                <div className="pd-alert pd-alert--success" data-testid="approval-success">
                  <strong>
                    Revisión R{approveResult.revision.revision_number} aprobada
                    {approveResult.revision.approved_at
                      ? ` el ${formatWhen(approveResult.revision.approved_at)}`
                      : ''}
                    .
                  </strong>
                </div>
              )}
              {releaseResult && (
                <div className="pd-alert pd-alert--success" data-testid="release-success">
                  <strong>Liberación #{releaseResult.release.release_number} creada.</strong>{' '}
                  <span>
                    Fijada a {releaseResult.release.quote_revision_id ? quoteLabel : 'sin cotización'}{' '}
                    + R{releaseResult.release.design_revision_number} · Contexto de fabricación:{' '}
                    {releaseResult.release.manufacturing_fingerprint.slice(0, 19)}…
                  </span>
                </div>
              )}

              {/* Command panels */}
              <div className="pr-panels-grid">
                <QuoteLifecyclePanel
                  quoteRevision={selectedQuoteRevision}
                  previousAcceptedRevision={quoteRevisions.find(
                    (q) => q.status === 'accepted' && q.id !== selectedQuoteRevision?.id,
                  )}
                  canMutateQuote={canMutateQuote}
                  canAcceptQuote={canAcceptQuote}
                  publishing={publishQuoteSubmitting}
                  accepting={acceptQuoteSubmitting}
                  publishError={publishQuoteError}
                  acceptError={acceptQuoteError}
                  onPublish={() => void handlePublishQuote()}
                  onOpenAccept={() => {
                    setAcceptQuoteError(null);
                    setAcceptModalOpen(true);
                  }}
                />
                <PreflightPanel
                  preflight={preflight}
                  loading={preflightQuery.isLoading && designRevisionId !== null}
                  error={preflightQuery.isError && designRevisionId !== null}
                  onRetry={() => void preflightQuery.refetch()}
                />
                <ApprovalPanel
                  canApprove={canApprove}
                  revisionStatus={selectedDesignRevision?.status ?? null}
                  approvedBy={selectedDesignRevision?.approved_by}
                  approvedAt={selectedDesignRevision?.approved_at}
                  quoteAccepted={selectedQuoteRevision?.status === 'accepted'}
                  quoteLabel={quoteLabel}
                  preflightBlocked={preflight ? preflight.status === 'blocked' : null}
                  submitting={approveSubmitting}
                  error={approveError}
                  onApprove={() => void handleApprove()}
                />
                <ReleasePanel
                  canRelease={canRelease}
                  revisionApproved={selectedDesignRevision?.status === 'approved'}
                  quoteAccepted={selectedQuoteRevision?.status === 'accepted'}
                  quoteLabel={quoteLabel}
                  preflightReady={preflight ? preflight.status === 'ready' : null}
                  submitting={releaseSubmitting}
                  error={releaseError}
                  preflightIssues={releasePreflightIssues}
                  onOpenReview={() => {
                    setReleaseError(null);
                    setReleasePreflightIssues([]);
                    setReleaseOpen(true);
                  }}
                />
              </div>

              {/* Release history (exact pins, durable) */}
              <ReleaseHistoryList
                releases={releases}
                quoteRevisions={quoteRevisions}
                latestRelease={releases[0] ?? null}
              />

              {/* Technical audit drawer */}
              <div className="pd-technical-drawer">
                <button
                  type="button"
                  className="pd-toggle-btn"
                  onClick={() => setShowTechnicalAudit(!showTechnicalAudit)}
                  data-testid="toggle-technical-audit"
                >
                  <ChevronRight
                    size={16}
                    className={`pd-toggle-icon ${showTechnicalAudit ? 'rotate-90' : ''}`}
                  />
                  <span>Detalles técnicos de auditoría</span>
                </button>
                {showTechnicalAudit && (
                  <dl className="pd-audit-grid" data-testid="technical-audit-details">
                    <dt>QuoteRevision ID</dt>
                    <dd>{quoteRevisionId ?? '—'}</dd>
                    <dt>Design ID</dt>
                    <dd>{activeDesignId ?? '—'}</dd>
                    <dt>DesignRevision ID</dt>
                    <dd>{designRevisionId ?? '—'}</dd>
                    <dt>Preflight scope</dt>
                    <dd>{preflight?.scope ?? '—'}</dd>
                    {contextualRelease && (
                      <>
                        <dt>ProductionRelease ID</dt>
                        <dd>{contextualRelease.id}</dd>
                        <dt>Manufacturing fingerprint</dt>
                        <dd>{contextualRelease.manufacturing_fingerprint}</dd>
                      </>
                    )}
                    {reconciliation?.items.map((item) => (
                      <FragmentRow key={item.furnitureInstanceId} id={item.furnitureInstanceId} />
                    ))}
                  </dl>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Modals */}
      <RequoteReviewModal
        open={requoteOpen}
        onClose={() => setRequoteOpen(false)}
        items={reconciliation?.items ?? []}
        selectedIds={requoteSelected}
        onToggle={handleToggleRequoteItem}
        quoteLabel={quoteLabel}
        quoteStatusLabel={quoteStatusLabelOf(selectedQuoteRevision)}
        designRevisionLabel={revLabel}
        submitting={requoteSubmitting}
        error={requoteError}
        onSubmit={() => void handleRequote()}
      />
      <AcceptQuoteModal
        open={acceptModalOpen}
        onClose={() => setAcceptModalOpen(false)}
        quoteRevision={selectedQuoteRevision}
        previousAcceptedRevision={quoteRevisions.find(
          (q) => q.status === 'accepted' && q.id !== selectedQuoteRevision?.id,
        )}
        submitting={acceptQuoteSubmitting}
        error={acceptQuoteError}
        onConfirm={() => void handleConfirmAcceptQuote()}
      />
      <ReleaseReviewModal
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        projectName={selectedDesign?.name ?? null}
        quoteLabel={quoteLabel}
        quoteStatusLabel={quoteStatusLabelOf(selectedQuoteRevision)}
        designRevisionLabel={revLabel}
        preflightStatus={
          preflight ? (PREFLIGHT_STATUS_LABELS[preflight.status] ?? preflight.status) : null
        }
        approvalStatus={
          selectedDesignRevision?.status === 'approved' ? 'Aprobada' : selectedDesignRevision?.status ?? '—'
        }
        submitting={releaseSubmitting}
        error={releaseError}
        onSubmit={() => void handleRelease()}
      />
    </div>
  );
}

function FragmentRow({ id }: { readonly id: string }): ReactNode {
  return (
    <>
      <dt>FurnitureInstance ID</dt>
      <dd>{id}</dd>
    </>
  );
}

function ReconciliationUnitRow({ item }: { readonly item: ReconciliationItem }): ReactNode {
  const statusLabel = RECONCILIATION_STATUS_LABELS[item.status] ?? item.status;
  const badgeClass =
    item.status === 'synced'
      ? 'status-badge--done'
      : item.status === 'conflict'
        ? 'status-badge--danger'
        : item.status === 'modified' || item.status === 'modeled_not_quoted'
          ? 'status-badge--warning'
          : 'status-badge--open';
  const chips = impactChips(item.impact);
  return (
    <tr data-testid={`reconciliation-item-${item.furnitureInstanceId}`}>
      <td>
        <span className="pd-code-pill" title={item.furnitureInstanceId}>
          {item.furnitureInstanceId.slice(0, 13)}…
        </span>
      </td>
      <td>
        <span className={`status-badge ${badgeClass}`}>{statusLabel}</span>
        {item.notes && <div className="text-muted">{item.notes}</div>}
      </td>
      <td>
        {item.differences.length === 0 ? (
          <span className="text-muted">Sin diferencias</span>
        ) : (
          <ul className="pr-diff-list">
            {item.differences.map((diff, index) => (
              <li key={`${diff.path}-${index}`} className="pr-diff-list__item">
                <span className="pr-diff-list__path">{formatDifferencePath(diff.path)}</span>
                <span className="pr-diff-list__values">
                  {formatDifferenceValue(diff.quoteValue)} → {formatDifferenceValue(diff.designValue)}
                </span>
                <span className="pr-diff-list__code">{diff.path}</span>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td>
        {chips.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="pr-impact-chips" data-testid={`impact-${item.furnitureInstanceId}`}>
            {chips.join(' + ')}
          </span>
        )}
      </td>
    </tr>
  );
}
