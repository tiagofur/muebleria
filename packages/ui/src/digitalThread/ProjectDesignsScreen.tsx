import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  Armchair,
  Box,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  GitCompareArrows,
  History,
  Layers,
  Plus,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  User,
} from 'lucide-react';
import {
  GraneteApiClient,
  GraneteApiError,
  type CreateDesignRequest,
  type Design,
  type DesignArtifactGrant,
  type DesignPublishArtifactKind,
  type DesignRevision,
  type DesignRevisionArtifact,
  type ProductionRelease,
} from '@granete/storage';
import { EmptyState, Modal, PageHeader, PageLoading, WorkspaceTabs } from '../common';
import {
  ARTIFACT_HEALTH_LABELS,
  ARTIFACT_KIND_LABELS,
  buildDesignLineage,
  canonicalArtifactSHA256,
  DESIGN_REVISION_STATUS_LABELS,
  DESIGN_SOURCE_TYPE_LABELS,
  formatArtifactSize,
  formatSha256Digest,
  getArtifactAvailability,
  artifactHealth,
  selectDesignRevision,
  type DesignLineageNode,
} from './designHistory';
import { resolveDesignArtifactUrl } from './designArtifactUrl';
import { SketchUpPairingModal } from './SketchUpPairingModal';
import { RevisionSnapshotItemsPanel } from './RevisionSnapshotItemsPanel';
import './digitalThread.css';

/**
 * #501 / WEB-DT-2 — Designs, immutable revisions and 3D artifact history.
 *
 * Second visible React surface of the Digital Thread (#396 / #384).
 * Visualizes:
 * - multiple Design alternatives per project;
 * - immutable R1 → R2 → R3 lineage;
 * - exact published snapshot inspection (physical items, definitions, materials);
 * - artifact integrity (.skp, .json, .png) with secure signed media grants;
 * - connection to ProductionRelease when active.
 *
 * Immutability contract:
 * - selecting an old revision keeps items, parameters, artifacts and preview
 *   pinned to that exact revision snapshot;
 * - the browser never parses .skp files to determine semantic state;
 * - published revisions cannot be mutated in place;
 * - #499 SketchUp pairing handoff is deferred.
 */

export interface ProjectDesignsContextState {
  readonly designId: string | null;
  readonly revisionId: string | null;
}

export interface ProjectDesignsQueryKeys {
  readonly root: QueryKey;
  readonly designs: QueryKey;
  readonly designWorkingCopy: (designId: string) => QueryKey;
  readonly designRevisions: (designId: string) => QueryKey;
  readonly designRevisionDetail: (designId: string, revisionId: string) => QueryKey;
  readonly designRevisionArtifacts: (designId: string, revisionId: string) => QueryKey;
  readonly productionReleases: QueryKey;
}

export function projectDesignsQueryKeys(
  scopeKey: readonly unknown[],
  projectId: string,
): ProjectDesignsQueryKeys {
  const root: QueryKey = ['project-designs', ...scopeKey, projectId];
  return {
    root,
    designs: [...root, 'designs'],
    designWorkingCopy: (designId: string) => [...root, 'designs', designId, 'working-copy'],
    designRevisions: (designId: string) => [...root, 'designs', designId, 'revisions'],
    designRevisionDetail: (designId: string, revisionId: string) => [
      ...root,
      'designs',
      designId,
      'revisions',
      revisionId,
      'detail',
    ],
    designRevisionArtifacts: (designId: string, revisionId: string) => [
      ...root,
      'designs',
      designId,
      'revisions',
      revisionId,
      'artifacts',
    ],
    productionReleases: [...root, 'production-releases'],
  };
}

export interface ProjectDesignsScreenProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  /** Project display name for header context; falls back to a neutral label. */
  readonly projectName?: string;
  readonly queryKeys: ProjectDesignsQueryKeys;
  readonly initialContext?: ProjectDesignsContextState | null;
  readonly onContextChange?: (context: ProjectDesignsContextState) => void;
  readonly onBack?: () => void;
  readonly onOpenFurnitureMatrix?: (context: { designId: string | null; revisionId: string | null }) => void;
  readonly onOpenReconciliation?: (context: { designId: string | null; revisionId: string | null }) => void;
  readonly canMutate?: boolean;
}

type ArtifactAccessErrorKind =
  | 'authorization'
  | 'invalid-grant'
  | 'popup-blocked'
  | 'popup-closed'
  | 'navigation';

interface ArtifactAccessError {
  readonly kind: ArtifactAccessErrorKind;
  readonly message: string;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * #641 — request truth. A failed request is never business absence: every
 * non-404 failure renders an explicit, actionable message instead of
 * collapsing into an empty list/hidden banner.
 */
function describeRequestFailure(err: unknown): string {
  if (err instanceof GraneteApiError) {
    if (err.status === 401) {
      return 'Tu sesión no es válida o expiró. Volvé a iniciar sesión e intentá de nuevo.';
    }
    if (err.status === 403 || err.code === 'FORBIDDEN') {
      return 'No tenés permiso para consultar esta información.';
    }
    if (err.status === 409) {
      return 'La información cambió mientras se consultaba. Reintentá en unos segundos.';
    }
  }
  return 'No se pudo contactar el servidor. Verificá tu conexión e intentá de nuevo.';
}

/**
 * #641 — subtle stale/refreshing mark for background refetches. Purely
 * visual: the exact pinned data stays visible and repeated polling must not
 * spam assistive tech, so this is deliberately NOT a live region.
 */
function RefreshingMark({ testId }: { readonly testId: string }) {
  return (
    <span className="pd-refreshing-mark" data-testid={testId} aria-hidden="true">
      <RefreshCw size={12} strokeWidth={1.5} className="spin" />
      Actualizando…
    </span>
  );
}

/**
 * #641 — technical copy affordance. Full IDs/digests get a focusable,
 * copyable, accessible path while product copy stays compact.
 */
function TechnicalCopyButton({
  valueKey,
  label,
  testId,
  value,
  copiedKey,
  onCopySuccess,
  onCopyReset,
}: {
  readonly valueKey: string;
  readonly label: string;
  readonly testId: string;
  readonly value: string | null;
  readonly copiedKey: string | null;
  readonly onCopySuccess: (key: string) => void;
  readonly onCopyReset: (key: string) => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-sm btn-secondary"
      data-testid={testId}
      aria-label={label}
      disabled={!value}
      onClick={() => {
        if (!value) return;
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            onCopySuccess(valueKey);
            window.setTimeout(() => onCopyReset(valueKey), 2000);
          })
          .catch(() => onCopyReset(valueKey));
      }}
    >
      <Copy size={14} strokeWidth={1.5} />
      <span aria-live="polite">{copiedKey === valueKey ? 'Copiado' : 'Copiar'}</span>
    </button>
  );
}

export function ProjectDesignsScreen({
  baseUrl,
  token,
  projectId,
  projectName,
  queryKeys,
  initialContext,
  onContextChange,
  onBack,
  onOpenFurnitureMatrix,
  onOpenReconciliation,
  canMutate = false,
}: ProjectDesignsScreenProps): ReactNode {
  const queryClient = useQueryClient();
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);

  const [designId, setDesignId] = useState<string | null>(() => initialContext?.designId ?? null);
  const [revisionId, setRevisionId] = useState<string | null>(() => initialContext?.revisionId ?? null);

  const [isCreatingDesign, setIsCreatingDesign] = useState(false);
  const [newDesignName, setNewDesignName] = useState('');
  const [createDesignError, setCreateDesignError] = useState<string | null>(null);
  const [isSubmittingDesign, setIsSubmittingDesign] = useState(false);

  const [authorizingKind, setAuthorizingKind] = useState<string | null>(null);
  const [artifactAccessError, setArtifactAccessError] = useState<ArtifactAccessError | null>(null);
  const [previewLoadError, setPreviewLoadError] = useState(false);
  const [showTechnicalAudit, setShowTechnicalAudit] = useState(false);
  const [copiedTechnicalKey, setCopiedTechnicalKey] = useState<string | null>(null);

  const handleTechnicalCopySuccess = (key: string) => setCopiedTechnicalKey(key);
  const handleTechnicalCopyReset = (key: string) =>
    setCopiedTechnicalKey((current) => (current === key ? null : current));

  // #499 "Abrir en SketchUp": the pin is FROZEN at click time from the exact
  // timeline selection (or null when nothing is published). A later publish
  // never rewrites an open sheet — the modal keeps its own frozen snapshot.
  const [pairing, setPairing] = useState<{
    readonly designId: string;
    readonly baseRevisionId: string | null;
    readonly baseRevisionLabel: string | null;
    readonly designName: string;
  } | null>(null);

  // Sync internal state when pinned initialContext changes from outside
  useEffect(() => {
    if (initialContext) {
      if (initialContext.designId !== undefined && initialContext.designId !== designId) {
        setDesignId(initialContext.designId);
      }
      if (initialContext.revisionId !== undefined && initialContext.revisionId !== revisionId) {
        setRevisionId(initialContext.revisionId);
      }
    }
  }, [initialContext]);

  // 1. Designs query
  const designsQuery = useQuery({
    queryKey: queryKeys.designs,
    queryFn: ({ signal }) => api.listProjectDesigns(token, projectId, signal),
  });
  const designs: readonly Design[] = designsQuery.data ?? [];

  // 1. Resolve selectedDesign:
  // Case A: designId == null -> default to first design if available
  // Case B: designId != null -> resolve ONLY that exact ID; if not found, selectedDesign is null (never silently retarget)
  const selectedDesign = useMemo(() => {
    if (!designId) {
      return designs[0] ?? null;
    }
    return designs.find((d) => d.id === designId) ?? null;
  }, [designs, designId]);

  const isInvalidExplicitDesign = Boolean(
    designId && designsQuery.isSuccess && !designsQuery.isLoading && designs.length > 0 && !selectedDesign,
  );

  // Default design selection ONLY when designId was NOT explicitly provided
  useEffect(() => {
    if (designsQuery.isSuccess && designs.length > 0 && !designId) {
      const first = designs[0]!;
      setDesignId(first.id);
      onContextChange?.({ designId: first.id, revisionId: null });
    }
  }, [designsQuery.isSuccess, designs, designId, onContextChange]);

  const activeDesignId = selectedDesign?.id ?? null;

  // 2. Revisions query for active design
  const revisionsQuery = useQuery({
    queryKey: activeDesignId
      ? queryKeys.designRevisions(activeDesignId)
      : ['project-designs', 'revisions', 'none'],
    queryFn: ({ signal }) => api.listDesignRevisions(token, activeDesignId as string, signal),
    enabled: activeDesignId !== null,
  });
  const revisions: readonly DesignRevision[] = revisionsQuery.data ?? [];

  // 3. Working Copy query for active design (404-resilient: missing working copy is not a page failure)
  const workingCopyQuery = useQuery({
    queryKey: activeDesignId
      ? queryKeys.designWorkingCopy(activeDesignId)
      : ['project-designs', 'working-copy', 'none'],
    queryFn: async ({ signal }) => {
      try {
        return await api.getDesignWorkingCopy(token, activeDesignId as string, signal);
      } catch (err) {
        if (err instanceof GraneteApiError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },
    enabled: activeDesignId !== null,
  });
  const workingCopy = workingCopyQuery.data ?? null;
  // #641: only a successful 404 is honest absence; any other failure of the
  // working-copy request is a visible, actionable error (never a hidden banner).
  const workingCopyAbsent = workingCopyQuery.isSuccess && workingCopyQuery.data === null;
  const workingCopyInitialLoading = workingCopyQuery.isLoading && !workingCopyQuery.data;
  const workingCopyBackgroundFailure = workingCopyQuery.isError && Boolean(workingCopyQuery.data);

  // 4. Production Releases query
  const releasesQuery = useQuery({
    queryKey: queryKeys.productionReleases,
    queryFn: ({ signal }) => api.listProjectProductionReleases(token, projectId, signal),
  });
  const releases: readonly ProductionRelease[] = releasesQuery.data ?? [];

  // Lineage & header-level selected revision (from list, items NOT included)
  const lineage = useMemo(() => buildDesignLineage(revisions), [revisions]);

  // #641: request truth for the revision list. A failed first load is an
  // explicit error; a failed background refetch keeps the exact known
  // timeline visible with an honest stale notice. Neither may render as
  // "no revisions".
  const revisionsRequestFailed = revisionsQuery.isError && !revisionsQuery.data;
  const revisionsBackgroundFailure = revisionsQuery.isError && Boolean(revisionsQuery.data);
  const revisionsBackgroundRefresh = revisionsQuery.isFetching && lineage.length > 0;

  const selectedRevisionHeader = useMemo(
    () => selectDesignRevision(revisions, revisionId),
    [revisions, revisionId],
  );

  const isInvalidExplicitRevision = Boolean(
    revisionId && revisionsQuery.isSuccess && !revisionsQuery.isLoading && !selectedRevisionHeader,
  );

  // Sync revisionId default ONLY when revisionId was NOT specified
  useEffect(() => {
    if (revisionsQuery.isSuccess && revisions.length > 0 && !revisionId && selectedRevisionHeader) {
      // Keep state pinned to selectedRevision
      onContextChange?.({ designId: activeDesignId, revisionId: selectedRevisionHeader.id });
    }
  }, [revisionsQuery.isSuccess, revisions, revisionId, selectedRevisionHeader, activeDesignId, onContextChange]);

  // 5. Full revision detail query: getDesignRevision returns items + artifacts (listDesignRevisions does NOT).
  // This is the ONLY authoritative source for the inspector — never fall back to header data.
  const revisionDetailQuery = useQuery({
    queryKey:
      activeDesignId && selectedRevisionHeader
        ? queryKeys.designRevisionDetail(activeDesignId, selectedRevisionHeader.id)
        : ['project-designs', 'revision-detail', 'none'],
    queryFn: ({ signal }) =>
      api.getDesignRevision(token, activeDesignId as string, selectedRevisionHeader!.id, signal),
    enabled: activeDesignId !== null && selectedRevisionHeader !== null,
  });

  // Explicit states for the inspector. Never collapse detail into header:
  // - loading: getDesignRevision is in flight
  // - success: use revisionDetailQuery.data (has items + artifacts)
  // - error (no data): honest error + retry, never substitute header
  // - error (stale data): keep the exact pinned snapshot visible + notice (#641)
  const selectedRevisionDetail = revisionDetailQuery.data ?? null;
  const revisionDetailLoading = revisionDetailQuery.isLoading && selectedRevisionHeader !== null;
  const revisionDetailFailed = revisionDetailQuery.isError && !revisionDetailQuery.data;
  const revisionDetailBackgroundFailure =
    revisionDetailQuery.isError && Boolean(revisionDetailQuery.data);
  const revisionDetailBackgroundRefresh =
    revisionDetailQuery.isFetching && selectedRevisionDetail !== null;


  // ProductionRelease linked to this exact revision (canonical active release with highest release_number).
  // Uses the detail object so release linkage is only shown after the exact snapshot is confirmed.
  const linkedRelease = useMemo(() => {
    if (!selectedRevisionDetail) return null;
    const matches = releases.filter(
      (rel) => rel.design_revision_id === selectedRevisionDetail.id && rel.status === 'active',
    );
    if (matches.length === 0) return null;
    return matches.sort((a, b) => b.release_number - a.release_number)[0] ?? null;
  }, [releases, selectedRevisionDetail]);

  // Artifacts: prefer embedded in revision detail (getDesignRevision already loads them).
  // Only fall back to the artifact list endpoint if detail has no embedded artifacts (legacy artifact-less publish).
  const artifactsQuery = useQuery({
    queryKey:
      activeDesignId && selectedRevisionDetail
        ? queryKeys.designRevisionArtifacts(activeDesignId, selectedRevisionDetail.id)
        : ['project-designs', 'artifacts', 'none'],
    queryFn: ({ signal }) =>
      api.listDesignRevisionArtifacts(
        token,
        activeDesignId as string,
        selectedRevisionDetail!.id,
        signal,
      ),
    enabled:
      activeDesignId !== null &&
      selectedRevisionDetail !== null &&
      revisionDetailQuery.isSuccess &&
      (!selectedRevisionDetail.artifacts || selectedRevisionDetail.artifacts.length === 0),
  });

  const artifacts: readonly DesignRevisionArtifact[] = useMemo(() => {
    if (selectedRevisionDetail?.artifacts && selectedRevisionDetail.artifacts.length > 0) {
      return selectedRevisionDetail.artifacts;
    }
    return artifactsQuery.data ?? [];
  }, [selectedRevisionDetail, artifactsQuery.data]);

  // #641: artifact metadata fallback truth. A failed fallback request is an
  // explicit error (or a stale notice when the last known list is shown) —
  // never a silent "zero artifacts".
  const artifactsFallbackFailed = artifactsQuery.isError && artifacts.length === 0;
  const artifactsFallbackBackgroundFailure = artifactsQuery.isError && artifacts.length > 0;
  const artifactsBackgroundRefresh = artifactsQuery.isFetching && artifacts.length > 0;


  const availability = useMemo(() => getArtifactAvailability(artifacts), [artifacts]);

  // #640: only explicitly available preview bytes may request a grant.
  // Missing, mismatched, and legacy/unknown health all fail closed.
  const previewHealth = availability.preview ? artifactHealth(availability.preview) : null;
  const previewUnusable = availability.preview !== null && previewHealth !== 'available';

  // Preview Grant Query: conservative cache bounded to 2m (less than MediaGrantTTL of 3m)
  const previewGrantQuery = useQuery({
    queryKey:
      activeDesignId && selectedRevisionDetail && availability.preview
        ? [...queryKeys.root, 'grant', activeDesignId, selectedRevisionDetail.id, 'preview']
        : ['project-designs', 'grant', 'none'],
    queryFn: ({ signal }) =>
      api.authorizeDesignRevisionArtifact(
        token,
        activeDesignId as string,
        selectedRevisionDetail!.id,
        'preview',
        signal,
      ),
    enabled:
      activeDesignId !== null &&
      selectedRevisionDetail !== null &&
      availability.preview !== null &&
      !previewUnusable,
    staleTime: 1000 * 60 * 2, // 2 minutes cache (strictly within 3-minute backend MediaGrantTTL)
  });

  const previewUrl = useMemo(() => {
    if (!previewGrantQuery.data) return null;
    try {
      return resolveDesignArtifactUrl(baseUrl, previewGrantQuery.data.url);
    } catch {
      return null;
    }
  }, [baseUrl, previewGrantQuery.data]);

  useEffect(() => {
    setPreviewLoadError(false);
  }, [selectedRevisionDetail?.id, previewGrantQuery.data?.url]);


  const handleSelectDesign = (newId: string) => {
    setDesignId(newId);
    setRevisionId(null);
    onContextChange?.({ designId: newId, revisionId: null });
  };

  const handleSelectRevision = (node: DesignLineageNode) => {
    setRevisionId(node.revision.id);
    onContextChange?.({ designId: activeDesignId, revisionId: node.revision.id });
  };

  const handleCreateDesign = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newDesignName.trim();
    if (!trimmed) {
      setCreateDesignError('Ingresá un nombre para la alternativa de diseño.');
      return;
    }
    setIsSubmittingDesign(true);
    setCreateDesignError(null);
    try {
      const payload: CreateDesignRequest = { name: trimmed };
      const created = await api.createProjectDesign(token, projectId, payload);
      await queryClient.invalidateQueries({ queryKey: queryKeys.designs });
      setIsCreatingDesign(false);
      setNewDesignName('');
      handleSelectDesign(created.id);
    } catch (err) {
      if (err instanceof GraneteApiError) {
        setCreateDesignError(err.message);
      } else {
        setCreateDesignError('No se pudo crear la alternativa de diseño.');
      }
    } finally {
      setIsSubmittingDesign(false);
    }
  };

  const handleAuthorizeAndOpen = async (kind: DesignPublishArtifactKind) => {
    if (!activeDesignId || !selectedRevisionDetail) return;
    const artifactWindow = window.open('', '_blank');
    if (!artifactWindow) {
      setArtifactAccessError({
        kind: 'popup-blocked',
        message:
          'El navegador bloqueó la nueva pestaña. Habilitá las ventanas emergentes y volvé a intentar.',
      });
      return;
    }
    artifactWindow.opener = null;
    setAuthorizingKind(kind);
    setArtifactAccessError(null);
    let grant: DesignArtifactGrant;
    try {
      grant = await api.authorizeDesignRevisionArtifact(
        token,
        activeDesignId,
        selectedRevisionDetail.id,
        kind,
      );
    } catch {
      artifactWindow.close();
      setArtifactAccessError({
        kind: 'authorization',
        message: 'El servidor rechazó el acceso al artefacto. Verificá tus permisos y volvé a intentar.',
      });
      setAuthorizingKind(null);
      return;
    }

    let url: string;
    try {
      url = resolveDesignArtifactUrl(baseUrl, grant.url);
    } catch {
      artifactWindow.close();
      setArtifactAccessError({
        kind: 'invalid-grant',
        message: 'El servidor devolvió un enlace de acceso no válido. Volvé a solicitar el artefacto.',
      });
      setAuthorizingKind(null);
      return;
    }

    if (artifactWindow.closed) {
      setArtifactAccessError({
        kind: 'popup-closed',
        message: 'La pestaña del artefacto se cerró antes de abrirlo. Volvé a intentar y mantenela abierta.',
      });
      setAuthorizingKind(null);
      return;
    }

    try {
      artifactWindow.location.replace(url);
    } catch {
      artifactWindow.close();
      setArtifactAccessError({
        kind: 'navigation',
        message: 'No se pudo abrir el artefacto en la nueva pestaña. Volvé a intentar.',
      });
    }
    setAuthorizingKind(null);
  };

  const handleOpenInSketchUp = (): void => {
    if (!selectedDesign) return;
    // Exact selection rule: the grant pins the revision the user selected in
    // the timeline (presentation default = highest), never an implicit
    // "latest" resolved later by the server. No published revision ⇒ null.
    setPairing({
      designId: selectedDesign.id,
      baseRevisionId: selectedRevisionHeader?.id ?? null,
      baseRevisionLabel: selectedRevisionHeader
        ? `R${selectedRevisionHeader.revision_number}`
        : null,
      designName: selectedDesign.name,
    });
  };

  if (designsQuery.isLoading) {
    return <PageLoading label="Cargando diseños de la obra…" />;
  }

  if (designsQuery.isError) {
    const err = designsQuery.error;
    const msg =
      err instanceof GraneteApiError && err.code === 'FORBIDDEN'
        ? 'No tenés permiso para ver los diseños de esta obra.'
        : 'Error al consultar los diseños. Verificá tu conexión.';
    return (
      <div className="pd-error-container" role="alert">
        <TriangleAlert size={28} className="text-danger" />
        <p>{msg}</p>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="retry-designs-btn"
          onClick={() => void designsQuery.refetch()}
        >
          Reintentar
        </button>
        {onBack && (
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Volver al proyecto
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="pd-workspace" data-testid="project-designs-workspace">
      <PageHeader
        title="Diseños 3D y revisiones inmutables"
        subtitle={`Historial inmutable de alternativas, revisiones publicadas y artefactos 3D${
          projectName ? ` — ${projectName}` : ' de la obra'
        }.`}
        primaryAction={
          selectedDesign ? (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="open-in-sketchup-btn"
              onClick={handleOpenInSketchUp}
            >
              <ExternalLink size={16} />
              <span>Abrir en SketchUp</span>
            </button>
          ) : canMutate ? (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="create-design-btn"
              onClick={() => {
                setNewDesignName('');
                setCreateDesignError(null);
                setIsCreatingDesign(true);
              }}
            >
              <Plus size={16} />
              <span>Nueva alternativa</span>
            </button>
          ) : undefined
        }
        secondaryActions={
          <div className="pd-header-actions">
            {selectedDesign && canMutate ? (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="create-design-btn"
                onClick={() => {
                  setNewDesignName('');
                  setCreateDesignError(null);
                  setIsCreatingDesign(true);
                }}
              >
                <Plus size={16} />
                <span>Nueva alternativa</span>
              </button>
            ) : null}
            {onOpenFurnitureMatrix && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="open-furniture-matrix-btn"
                onClick={() =>
                  onOpenFurnitureMatrix({
                    designId: activeDesignId,
                    revisionId: selectedRevisionDetail?.id ?? selectedRevisionHeader?.id ?? null,
                  })
                }
              >
                <Box size={16} />
                <span>Ver matriz de muebles</span>
              </button>
            )}
            {/* Reconciliation needs a DesignRevision (#502); with zero designs
                the destination only dead-ends in its "Falta contexto" state. */}
            {onOpenReconciliation && designs.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="open-reconciliation-btn"
                onClick={() =>
                  onOpenReconciliation({
                    designId: activeDesignId,
                    revisionId: selectedRevisionDetail?.id ?? selectedRevisionHeader?.id ?? null,
                  })
                }
              >
                <GitCompareArrows size={16} />
                <span>Reconciliar y liberar</span>
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

      {/* Alternatives Selector */}
      {designs.length === 0 ? (
        <EmptyState
          icon={Armchair}
          title="No hay diseños en esta obra"
          description={
            canMutate
              ? 'Creá el primer diseño para empezar a modelar; después podés abrirlo en SketchUp con un código de vinculación seguro.'
              : 'Aún no se ha creado ninguna alternativa de diseño para el proyecto.'
          }
          actionLabel={canMutate ? 'Crear primer diseño' : undefined}
          onAction={
            canMutate
              ? () => {
                  setNewDesignName('Diseño Principal');
                  setIsCreatingDesign(true);
                }
              : undefined
          }
        />
      ) : (
        <>
          <div className="pd-alternatives-wrapper">
            <WorkspaceTabs
              ariaLabel="Alternativas de diseño"
              idPrefix="design-alt"
              testIdPrefix="design"
              activeTab={activeDesignId ?? ''}
              onTabChange={(id) => handleSelectDesign(id)}
              tabs={designs.map((d) => ({
                id: d.id,
                label: d.name,
              }))}
            />
          </div>

          {isInvalidExplicitDesign ? (
            <div className="pd-context-invalid" data-testid="invalid-design-notice">
              <div className="pd-alert pd-alert--error">
                <strong>Diseño no disponible</strong>
                <p>
                  El diseño seleccionado ya no está disponible en este proyecto.
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="view-available-designs-btn"
                  onClick={() => {
                    if (designs.length > 0) {
                      handleSelectDesign(designs[0]!.id);
                    }
                  }}
                >
                  Ver diseños disponibles
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Working Copy Banner — #641: data | request failure | honest 404 absence */}
              {workingCopyInitialLoading ? (
                <div
                  className="pd-working-copy-banner pd-working-copy-banner--pending"
                  data-testid="working-copy-loading"
                  role="status"
                >
                  <div className="pd-working-copy-banner__info">
                    <RefreshCw
                      size={18}
                      strokeWidth={1.5}
                      className="pd-working-copy-banner__icon spin"
                    />
                    <span>Consultando borrador de trabajo…</span>
                  </div>
                </div>
              ) : workingCopyQuery.isError && !workingCopy ? (
                <div
                  className="pd-working-copy-banner pd-working-copy-banner--error"
                  data-testid="working-copy-error"
                  role="alert"
                >
                  <div className="pd-working-copy-banner__info">
                    <TriangleAlert
                      size={18}
                      strokeWidth={1.5}
                      className="pd-working-copy-banner__icon"
                    />
                    <div>
                      <strong>No se pudo verificar el borrador de trabajo.</strong>{' '}
                      <span>{describeRequestFailure(workingCopyQuery.error)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    data-testid="retry-working-copy-btn"
                    onClick={() => void workingCopyQuery.refetch()}
                  >
                    Reintentar
                  </button>
                </div>
              ) : workingCopy ? (
                <>
                  <div className="pd-working-copy-banner" data-testid="working-copy-banner">
                    <div className="pd-working-copy-banner__info">
                      <Layers
                        size={18}
                        strokeWidth={1.5}
                        className="pd-working-copy-banner__icon"
                      />
                      <div>
                        <strong>Borrador de trabajo (Working Copy):</strong>{' '}
                        <span>
                          {workingCopy.items.length}{' '}
                          {workingCopy.items.length === 1 ? 'mueble' : 'muebles'} modelados
                        </span>
                        {workingCopy.base_revision_id ? (
                          <span
                            className="pd-working-copy-banner__meta"
                            title={workingCopy.base_revision_id}
                          >
                            {' '}
                            · Base: {workingCopy.base_revision_id.slice(0, 8)}…
                          </span>
                        ) : (
                          <span className="pd-working-copy-banner__meta">
                            {' '}
                            · Sin revisión base
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="pd-working-copy-banner__date">
                      Modificado: {formatWhen(workingCopy.updated_at)}
                      {workingCopyQuery.isFetching && !workingCopyBackgroundFailure && (
                        <RefreshingMark testId="working-copy-refreshing" />
                      )}
                    </span>
                  </div>
                  {workingCopyBackgroundFailure && (
                    <div
                      className="pd-lineage-error pd-lineage-error--inline"
                      data-testid="working-copy-stale-error"
                      role="alert"
                    >
                      <TriangleAlert size={14} strokeWidth={1.5} />
                      <span>
                        No se pudo actualizar el borrador; se muestra la última versión conocida.
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        data-testid="retry-working-copy-btn"
                        onClick={() => void workingCopyQuery.refetch()}
                      >
                        Reintentar
                      </button>
                    </div>
                  )}
                </>
              ) : workingCopyAbsent ? (
                <div
                  className="pd-working-copy-banner pd-working-copy-banner--absent"
                  data-testid="no-working-copy-notice"
                >
                  <div className="pd-working-copy-banner__info">
                    <Layers
                      size={18}
                      strokeWidth={1.5}
                      className="pd-working-copy-banner__icon"
                    />
                    <span>No hay borrador de trabajo para este diseño.</span>
                  </div>
                </div>
              ) : null}

              {/* Lineage Timeline (R1 → R2 → R3) */}
              <div className="pd-lineage-container" data-testid="design-lineage-timeline">
                <div className="pd-lineage-header">
                  <div className="pd-lineage-title">
                    <History size={18} strokeWidth={1.5} />
                    <h3>Linaje de revisiones inmutables</h3>
                  </div>
                  <span className="pd-lineage-count">
                    {lineage.length} {lineage.length === 1 ? 'publicación' : 'publicaciones'}{' '}
                    {revisionsBackgroundRefresh && <RefreshingMark testId="revisions-refreshing" />}
                  </span>
                </div>

                {/* #641: a failed request is an explicit error with retry — never
                    the "no revisions" empty state. A failed background refetch
                    keeps the exact known timeline visible with a stale notice. */}
                {revisionsQuery.isLoading ? (
                  <div className="pd-lineage-loading" role="status" data-testid="revisions-loading">
                    Cargando revisiones…
                  </div>
                ) : revisionsRequestFailed ? (
                  <div className="pd-lineage-error" data-testid="revisions-error" role="alert">
                    <TriangleAlert size={18} strokeWidth={1.5} />
                    <div>
                      <strong>No se pudo cargar el linaje de revisiones.</strong>
                      <p>{describeRequestFailure(revisionsQuery.error)}</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      data-testid="retry-revisions-btn"
                      onClick={() => void revisionsQuery.refetch()}
                    >
                      Reintentar
                    </button>
                  </div>
                ) : revisionsBackgroundFailure && lineage.length === 0 ? (
                  <div
                    className="pd-lineage-error"
                    data-testid="revisions-stale-error"
                    role="alert"
                  >
                    <TriangleAlert size={18} strokeWidth={1.5} />
                    <div>
                      <strong>No se pudo actualizar el linaje de revisiones.</strong>
                      <p>
                        La última respuesta conocida estaba vacía; intenta nuevamente antes de
                        asumir que no hay publicaciones.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      data-testid="retry-revisions-btn"
                      onClick={() => void revisionsQuery.refetch()}
                    >
                      Reintentar
                    </button>
                  </div>
                ) : lineage.length === 0 ? (
                  <div className="pd-lineage-empty" data-testid="no-revisions-notice">
                    <p>
                      Este diseño no cuenta con revisiones inmutables publicadas todavía. El trabajo
                      actual reside en el borrador de trabajo (Working Copy).
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      data-testid="no-revisions-open-sketchup-btn"
                      onClick={handleOpenInSketchUp}
                    >
                      <ExternalLink size={14} strokeWidth={1.5} />
                      <span>Abrir en SketchUp para modelar</span>
                    </button>
                  </div>
                ) : (
                  <>
                    {revisionsBackgroundFailure && (
                      <div
                        className="pd-lineage-error pd-lineage-error--inline"
                        data-testid="revisions-stale-error"
                        role="alert"
                      >
                        <TriangleAlert size={14} strokeWidth={1.5} />
                        <span>
                          No se pudo actualizar el linaje; se muestra la última versión conocida.
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          data-testid="retry-revisions-btn"
                          onClick={() => void revisionsQuery.refetch()}
                        >
                          Reintentar
                        </button>
                      </div>
                    )}
                    <div className="pd-lineage-track" role="list">
                      {lineage.map((node, index) => {
                        const isSelected = selectedRevisionHeader?.id === node.revision.id;
                        const statusLabel =
                          DESIGN_REVISION_STATUS_LABELS[node.status] ?? node.status;
                        const sourceLabel =
                          DESIGN_SOURCE_TYPE_LABELS[node.sourceType] ?? node.sourceType;
                        // A connector between currentNode and nextNode is authoritative ONLY
                        // when nextNode explicitly references this currentNode as its parent.
                        const nextNode = lineage[index + 1];
                        const connectorIsAuthoritative = Boolean(
                          nextNode && nextNode.parentRevisionId === node.revision.id,
                        );

                        return (
                          <div key={node.revision.id} className="pd-lineage-step" role="listitem">
                            <button
                              type="button"
                              className={`pd-lineage-node ${
                                isSelected ? 'pd-lineage-node--selected' : ''
                              } ${node.isApproved ? 'pd-lineage-node--approved' : ''}`}
                              onClick={() => handleSelectRevision(node)}
                              aria-current={isSelected ? 'step' : undefined}
                              data-testid={`revision-node-R${node.revisionNumber}`}
                            >
                              <div className="pd-lineage-node__top">
                                <span className="pd-lineage-node__badge">R{node.revisionNumber}</span>
                                <span
                                  className={`status-badge ${
                                    node.isApproved
                                      ? 'status-badge--done'
                                      : node.status === 'superseded'
                                      ? 'status-badge--inactive'
                                      : 'status-badge--open'
                                  }`}
                                >
                                  {statusLabel}
                                </span>
                              </div>
                              <div className="pd-lineage-node__source">{sourceLabel}</div>
                              <div className="pd-lineage-node__date">
                                {formatWhen(node.revision.created_at)}
                              </div>
                              {node.revision.created_by_display_name && (
                                <div className="pd-lineage-node__author">
                                  {node.revision.created_by_display_name}
                                </div>
                              )}
                            </button>
                            {index < lineage.length - 1 && (
                              <div
                                className={`pd-lineage-connector ${
                                  connectorIsAuthoritative
                                    ? ''
                                    : 'pd-lineage-connector--orphan'
                                }`}
                                aria-hidden="true"
                                title={connectorIsAuthoritative ? undefined : 'Parent no disponible'}
                              >
                                <ChevronRight size={18} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

          {/* Selected Revision Inspector (Pinned View) */}
          {isInvalidExplicitRevision ? (
            <div className="pd-context-invalid" data-testid="invalid-revision-notice">
              <div className="pd-alert pd-alert--error">
                <strong>Revisión no disponible</strong>
                <p>
                  La revisión seleccionada no pertenece a este diseño o ya no está disponible.
                </p>
              </div>
            </div>
          ) : revisionDetailLoading ? (
            <div className="pd-detail-loading" data-testid="revision-detail-loading" role="status">
              <RefreshCw size={20} className="spin" />
              <span>
                Cargando snapshot exacto de R{selectedRevisionHeader?.revision_number}…
              </span>
            </div>
          ) : revisionDetailFailed ? (
            <div className="pd-context-invalid" data-testid="revision-detail-error">
              <div className="pd-alert pd-alert--error" role="alert">
                <strong>Error al cargar el snapshot exacto</strong>
                <p>
                  No se pudo cargar el snapshot exacto de R
                  {selectedRevisionHeader?.revision_number}. {describeRequestFailure(revisionDetailQuery.error)}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="retry-revision-detail-btn"
                  onClick={() => void revisionDetailQuery.refetch()}
                >
                  Reintentar
                </button>
              </div>
            </div>
          ) : selectedRevisionDetail ? (
            <div className="pd-inspector" data-testid="revision-inspector">

              <div className="pd-inspector__header">
                <div>
                  <h2 className="pd-inspector__title">
                    Revisión R{selectedRevisionDetail.revision_number}
                    {selectedRevisionDetail.status === 'approved' && (

                      <span className="status-badge status-badge--done">
                        <ShieldCheck size={14} /> Aprobada
                      </span>
                    )}
                    {selectedRevisionDetail.status === 'superseded' && (
                      <span className="status-badge status-badge--warning">
                        Reemplazada (Histórica)
                      </span>
                    )}
                  </h2>
                  <p className="pd-inspector__subtitle">
                    Snapshot inmutable publicado el {formatWhen(selectedRevisionDetail.created_at)} por{' '}
                    <strong>{selectedRevisionDetail.created_by_display_name ?? (selectedRevisionDetail.created_by ? 'Autor histórico no disponible' : 'Sistema')}</strong> desde{' '}
                    <strong>
                      {DESIGN_SOURCE_TYPE_LABELS[selectedRevisionDetail.source_type] ??
                        selectedRevisionDetail.source_type}
                    </strong>
                    .
                  </p>
                  {selectedRevisionDetail.approved_by_display_name && (
                    <p className="pd-inspector__subtitle">
                      Aprobada por <strong>{selectedRevisionDetail.approved_by_display_name}</strong>
                      {selectedRevisionDetail.approved_at ? ` el ${formatWhen(selectedRevisionDetail.approved_at)}` : ''}.
                    </p>
                  )}

                </div>

                {/* #641: release area request truth — loading, honest absence
                    (no badge), linked release, or an explicit unavailable state
                    with retry. A failed request never looks like "no release". */}
                <div className="pd-inspector__header-aux">
                  {linkedRelease && (
                    <div className="pd-inspector__release-badge" data-testid="linked-release-badge">
                      <CheckCircle2 size={16} strokeWidth={1.5} className="text-success" />
                      <span>Liberación a producción #{linkedRelease.release_number} vinculada</span>
                      {releasesQuery.isFetching && <RefreshingMark testId="release-refreshing" />}
                    </div>
                  )}
                  {releasesQuery.isLoading && !linkedRelease && (
                    <span
                      className="pd-inspector__release-badge pd-inspector__release-badge--pending"
                      data-testid="release-status-loading"
                      role="status"
                    >
                      Consultando estado de liberación…
                    </span>
                  )}
                  {releasesQuery.isError && (
                    <div
                      className="pd-inspector__release-badge pd-inspector__release-badge--unavailable"
                      data-testid="release-status-error"
                      role="alert"
                    >
                      <TriangleAlert size={16} strokeWidth={1.5} />
                      <span>Estado de liberación no disponible</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        data-testid="retry-releases-btn"
                        onClick={() => void releasesQuery.refetch()}
                      >
                        Reintentar
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* #641: a failed background refresh keeps the exact pinned
                  snapshot visible and says so — it never blanks the inspector. */}
              {(revisionDetailBackgroundFailure || revisionDetailBackgroundRefresh) && (
                <div className="pd-inspector__refresh">
                  {revisionDetailBackgroundFailure ? (
                    <div
                      className="pd-alert pd-alert--error"
                      data-testid="revision-detail-stale-error"
                      role="alert"
                    >
                      <span>
                        No se pudo actualizar el snapshot exacto de R
                        {selectedRevisionDetail?.revision_number}; se muestra la última versión
                        conocida.
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        data-testid="retry-revision-detail-btn"
                        onClick={() => void revisionDetailQuery.refetch()}
                      >
                        Reintentar
                      </button>
                    </div>
                  ) : (
                    <RefreshingMark testId="revision-detail-refreshing" />
                  )}
                </div>
              )}

              {/* Grid: Left Column (Items & Attributes) / Right Column (3D Preview & Artifacts) */}
              <div className="pd-inspector__grid">
                <div className="pd-inspector__main">
                  {/* Physical Items list */}
                  <div className="pd-card">
                    <div className="pd-card__header">
                      <div className="pd-card__title">
                        <Box size={18} />
                        <h3>Unidades físicas contenidas ({selectedRevisionDetail.items.length})</h3>
                      </div>
                    </div>

                    <RevisionSnapshotItemsPanel items={selectedRevisionDetail.items} />
                  </div>
                </div>

                <div className="pd-inspector__sidebar">
                  {/* 3D Preview Card */}
                  <div className="pd-card pd-preview-card" data-testid="preview-card">
                    <div className="pd-card__header">
                      <div className="pd-card__title">
                        <Armchair size={18} />
                        <h3>Vista previa 3D</h3>
                      </div>
                    </div>

                    <div className="pd-preview-card__body">
                      {previewUnusable ? (
                        <div
                          className={`pd-preview-placeholder ${
                            previewHealth === 'missing'
                              ? 'pd-preview-warning'
                              : 'pd-preview-error'
                          }`}
                          data-testid={`preview-health-${previewHealth ?? 'unknown'}`}
                          role="alert"
                        >
                          <TriangleAlert size={24} strokeWidth={1.5} />
                          {previewHealth === 'missing' ? (
                            <span>
                              La vista previa está registrada pero sus bytes ya no están
                              disponibles en el almacenamiento.
                            </span>
                          ) : previewHealth === 'integrity_mismatch' ? (
                            <span>
                              Los bytes de la vista previa no coinciden con el artefacto
                              publicado: su integridad está comprometida.
                            </span>
                          ) : (
                            <span>
                              El servidor no informó un estado verificable para la vista previa.
                              El acceso permanece bloqueado por seguridad.
                            </span>
                          )}
                          {previewHealth !== null && <p className="pd-recovery-hint">
                              La revisión publicada es inmutable y no se repara en el lugar.
                              Publicá una nueva revisión del diseño para regenerar la vista previa.
                            </p>}
                          {canMutate && previewHealth !== null && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleOpenInSketchUp}
                              data-testid="preview-recovery-open-sketchup-btn"
                            >
                              <ExternalLink size={14} strokeWidth={1.5} />
                              <span>Abrir en SketchUp y publicar nueva revisión</span>
                            </button>
                          )}
                        </div>
                      ) : previewGrantQuery.isLoading ? (
                        <div
                          className="pd-preview-placeholder pd-preview-loading"
                          role="status"
                          data-testid="preview-grant-loading"
                        >
                          <RefreshCw size={24} className="spin" />
                          <span>Obteniendo acceso a vista previa…</span>
                        </div>
                      ) : previewGrantQuery.isError ? (
                        <div
                          className="pd-preview-placeholder pd-preview-error"
                          role="alert"
                          data-testid="preview-error"
                        >
                          <TriangleAlert size={24} strokeWidth={1.5} />
                          <span>No se pudo autorizar la vista previa.</span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void previewGrantQuery.refetch()}
                          >
                            Reintentar acceso
                          </button>
                        </div>
                      ) : previewGrantQuery.data && !previewUrl ? (
                        <div
                          className="pd-preview-placeholder pd-preview-error"
                          data-testid="preview-grant-error"
                          role="alert"
                        >
                          <TriangleAlert size={24} strokeWidth={1.5} />
                          <span>El servidor devolvió un enlace no válido para la vista previa.</span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void previewGrantQuery.refetch()}
                          >
                            Solicitar nuevo acceso
                          </button>
                        </div>
                      ) : previewLoadError ? (
                        <div
                          className="pd-preview-placeholder pd-preview-error"
                          data-testid="preview-load-error"
                          role="alert"
                        >
                          <TriangleAlert size={24} strokeWidth={1.5} />
                          <span>No se pudo cargar la imagen de vista previa.</span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setPreviewLoadError(false);
                              void previewGrantQuery.refetch();
                            }}
                          >
                            Reintentar vista previa
                          </button>
                        </div>
                      ) : previewUrl ? (
                        <div className="pd-preview-image-wrapper">
                          <img
                            src={previewUrl}
                            alt={`Vista previa 3D R${selectedRevisionDetail.revision_number}`}
                            className="pd-preview-image"
                            data-testid="preview-image"
                            onError={() => setPreviewLoadError(true)}
                          />
                        </div>
                      ) : (
                        <div
                          className="pd-preview-placeholder pd-preview-empty"
                          data-testid="no-preview-placeholder"
                        >
                          <Armchair size={36} className="text-muted" />
                          <span>Sin vista previa 3D publicada</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Artifacts Table */}
                  <div className="pd-card" data-testid="artifacts-card">
                    <div className="pd-card__header">
                      <div className="pd-card__title">
                        <FileText size={18} />
                        <h3>Artefactos publicados ({artifacts.length})</h3>
                        {artifactsBackgroundRefresh && <RefreshingMark testId="artifacts-refreshing" />}
                      </div>
                    </div>

                    {artifactAccessError && (
                      <div
                        className="pd-alert pd-alert--error"
                        role="alert"
                        data-testid={`artifact-access-error-${artifactAccessError.kind}`}
                      >
                        {artifactAccessError.message}
                      </div>
                    )}

                    {artifacts.some((art) => {
                      const h = artifactHealth(art);
                      return h === 'missing' || h === 'integrity_mismatch';
                    }) &&
                      artifacts.length > 0 && (
                        <div
                          className="pd-alert pd-alert--warning"
                          role="alert"
                          data-testid="artifact-health-recovery"
                        >
                          <p>
                            Uno o más artefactos de esta revisión no están disponibles o no
                            coinciden con lo publicado. La revisión es inmutable y no se
                            repara en el lugar: publicá una nueva revisión del diseño para
                            regenerar los artefactos.
                          </p>
                          {canMutate && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleOpenInSketchUp}
                              data-testid="artifact-recovery-open-sketchup-btn"
                            >
                              <ExternalLink size={14} strokeWidth={1.5} />
                              <span>Abrir en SketchUp y publicar nueva revisión</span>
                            </button>
                          )}
                        </div>
                      )}

                    {artifactsFallbackBackgroundFailure && (
                      <div
                        className="pd-alert pd-alert--error"
                        data-testid="artifacts-stale-error"
                        role="alert"
                      >
                        <p>
                          No se pudo actualizar el estado de los artefactos; se muestra la última
                          versión conocida.
                        </p>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          data-testid="retry-artifacts-btn"
                          onClick={() => void artifactsQuery.refetch()}
                        >
                          Reintentar
                        </button>
                      </div>
                    )}

                    {artifactsQuery.isLoading && artifacts.length === 0 ? (
                      <p
                        className="pd-empty-hint"
                        data-testid="artifacts-loading-hint"
                        role="status"
                      >
                        Cargando artefactos de la revisión…
                      </p>
                    ) : artifactsFallbackFailed ? (
                      <div
                        className="pd-alert pd-alert--error"
                        data-testid="artifacts-error-hint"
                        role="alert"
                      >
                        <p>No se pudo verificar el estado de los artefactos de la revisión.</p>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          data-testid="retry-artifacts-btn"
                          onClick={() => void artifactsQuery.refetch()}
                        >
                          Reintentar
                        </button>
                      </div>
                    ) : artifacts.length === 0 ? (
                      <p className="pd-empty-hint" data-testid="no-artifacts-hint">
                        Esta revisión no posee artefactos binarios registrados.
                      </p>
                    ) : (
                      <div className="pd-table-container">
                        <table
                          className="pd-artifacts-table"
                          data-testid="artifacts-table"
                        >
                          <thead>
                            <tr>
                              <th>Artefacto</th>
                              <th>Tamaño</th>
                              <th>Integridad</th>
                              <th>Acción</th>
                            </tr>
                          </thead>
                          <tbody>
                            {artifacts.map((art) => {
                              const label = ARTIFACT_KIND_LABELS[art.kind] ?? art.kind;
                              const isAuthorizing = authorizingKind === art.kind;
                              // #640: access is only offered for artifacts whose
                              // bytes the server verified as available; unhealthy
                              // or unverifiable artifacts fail closed here too.
                              const health = artifactHealth(art);
                              const isHealthy = health === 'available';
                              const actionLabel =
                                art.kind === 'model'
                                  ? 'Descargar modelo SKP'
                                  : art.kind === 'manifest'
                                    ? 'Descargar manifest JSON'
                                    : 'Abrir vista previa PNG';

                              return (
                                <tr key={art.id} data-testid={`artifact-row-${art.kind}`}>
                                  <td>
                                    <div className="pd-artifact-kind">
                                      {art.kind === 'model' ? (
                                        <Box size={16} />
                                      ) : art.kind === 'manifest' ? (
                                        <FileCode size={16} />
                                      ) : (
                                        <Armchair size={16} />
                                      )}
                                      <span>{label}</span>
                                    </div>
                                  </td>
                                  <td>{formatArtifactSize(art.size_bytes)}</td>
                                  <td>
                                    <span
                                      className="pd-hash-badge"
                                      aria-label={`SHA-256 del artefacto ${label}`}
                                      title={canonicalArtifactSHA256(art.sha256) ?? art.sha256}
                                    >
                                      {formatSha256Digest(art.sha256)}
                                    </span>{' '}
                                    <span
                                      className={`status-badge ${
                                        health === 'available'
                                          ? 'status-badge--done'
                                          : health === 'integrity_mismatch'
                                            ? 'status-badge--danger'
                                            : 'status-badge--warning'
                                      }`}
                                      data-testid={`artifact-health-${art.kind}`}
                                    >
                                      {health !== null
                                        ? ARTIFACT_HEALTH_LABELS[health]
                                        : 'Estado no informado'}
                                    </span>
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      disabled={isAuthorizing || !isHealthy}
                                      onClick={() => handleAuthorizeAndOpen(art.kind)}
                                      data-testid={`download-artifact-${art.kind}`}
                                      aria-label={actionLabel}
                                    >
                                      {isAuthorizing ? (
                                        <RefreshCw size={14} className="spin" />
                                      ) : (
                                        <Download size={14} />
                                      )}
                                      <span>{isAuthorizing ? 'Autorizando…' : 'Acceder'}</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Technical Details Toggle — #641: disclosure exposes
                      aria-expanded/aria-controls and the controlled region
                      keeps a stable, always-mounted id. */}
                  <div className="pd-technical-drawer">
                    <button
                      type="button"
                      className="pd-toggle-btn"
                      onClick={() => setShowTechnicalAudit(!showTechnicalAudit)}
                      data-testid="toggle-technical-audit"
                      aria-expanded={showTechnicalAudit}
                      aria-controls="technical-audit-panel"
                    >
                      <ChevronRight
                        size={16}
                        className={`pd-toggle-icon ${showTechnicalAudit ? 'rotate-90' : ''}`}
                      />
                      <span>Detalles técnicos de auditoría</span>
                    </button>

                    <div
                      id="technical-audit-panel"
                      className="pd-audit-region"
                      hidden={!showTechnicalAudit}
                    >
                      <dl className="pd-audit-grid" data-testid="technical-audit-details">
                        {/* #641: every truncated ID gets a focusable, copyable,
                            accessible full-value path in this technical region. */}
                        {[
                          { label: 'Revision ID', value: selectedRevisionDetail.id, testId: 'copy-revision-id' },
                          { label: 'Design ID', value: selectedRevisionDetail.design_id, testId: 'copy-design-id' },
                          ...(selectedRevisionDetail.parent_revision_id
                            ? [{
                                label: 'Parent Revision',
                                value: selectedRevisionDetail.parent_revision_id,
                                testId: 'copy-parent-revision-id',
                              }]
                            : []),
                          ...(workingCopy?.base_revision_id
                            ? [{
                                label: 'Base del borrador (Working Copy)',
                                value: workingCopy.base_revision_id,
                                testId: 'copy-working-copy-base-id',
                              }]
                            : []),
                        ].map((entry) => (
                          <Fragment key={entry.testId}>
                            <dt>{entry.label}</dt>
                            <dd>
                              <div className="pd-audit-copyable">
                                <code className="pd-audit-copyable__value">{entry.value}</code>
                                <TechnicalCopyButton
                                  valueKey={`id:${entry.value}`}
                                  label={`Copiar ${entry.label} completo`}
                                  testId={entry.testId}
                                  value={entry.value}
                                  copiedKey={copiedTechnicalKey}
                                  onCopySuccess={handleTechnicalCopySuccess}
                                  onCopyReset={handleTechnicalCopyReset}
                                />
                              </div>
                            </dd>
                          </Fragment>
                        ))}
                        {!selectedRevisionDetail.parent_revision_id && (
                          <>
                            <dt>Parent Revision</dt>
                            <dd>Raíz (null)</dd>
                          </>
                        )}
                        {selectedRevisionDetail.approved_at && (
                          <>
                            <dt>Aprobado el</dt>
                            <dd>{formatWhen(selectedRevisionDetail.approved_at)}</dd>
                            <dt>Aprobado por</dt>
                            <dd>{selectedRevisionDetail.approved_by ?? '—'}</dd>
                          </>
                        )}

                        <dt>Cantidad ítems</dt>
                        <dd>{selectedRevisionDetail.items.length}</dd>

                        <dt>Cantidad artefactos</dt>
                        <dd>{artifacts.length}</dd>

                        {artifacts.length > 0 && (
                          <>
                            <dt>SHA-256 de artefactos</dt>
                            <dd>
                              <ul className="pd-audit-digests" data-testid="artifact-digests-list">
                                {artifacts.map((art) => {
                                  const label = ARTIFACT_KIND_LABELS[art.kind] ?? art.kind;
                                  const digest = canonicalArtifactSHA256(art.sha256);
                                  return (
                                    <li key={art.id} data-testid={`artifact-digest-${art.kind}`}>
                                      <span className="pd-audit-digest-kind">{label}</span>
                                      <code className="pd-audit-digest-value">
                                        {digest ?? '—'}
                                      </code>
                                      <TechnicalCopyButton
                                        valueKey={`sha256:${art.kind}`}
                                        label={`Copiar SHA-256 de ${label}`}
                                        testId={`copy-sha256-${art.kind}`}
                                        value={digest}
                                        copiedKey={copiedTechnicalKey}
                                        onCopySuccess={handleTechnicalCopySuccess}
                                        onCopyReset={handleTechnicalCopyReset}
                                      />
                                    </li>
                                  );
                                })}
                              </ul>
                            </dd>
                          </>
                        )}
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="pd-no-revision-selected">
              <p>Seleccioná una revisión del linaje para inspeccionar sus contenidos.</p>
            </div>
          )}

            </>
          )}
        </>
      )}

      {/* #499: SketchUp pairing sheet — exact Project/Design/base frozen at open */}
      {pairing && selectedDesign ? (
        <SketchUpPairingModal
          baseUrl={baseUrl}
          token={token}
          projectId={projectId}
          designId={pairing.designId}
          baseRevisionId={pairing.baseRevisionId}
          baseRevisionLabel={pairing.baseRevisionLabel}
          projectName={projectName ?? 'la obra actual'}
          designName={pairing.designName}
          onClose={() => setPairing(null)}
        />
      ) : null}

      {/* Modal: Create Design Alternative */}
      {isCreatingDesign && (
        <Modal
          open={isCreatingDesign}
          title="Nueva alternativa de diseño"
          onClose={() => {
            if (!isSubmittingDesign) {
              setIsCreatingDesign(false);
            }
          }}
        >
          <form onSubmit={handleCreateDesign} className="pd-modal-form">
            <p className="pd-modal-hint">
              Creá una nueva propuesta de diseño para esta obra (por ejemplo: &quot;Propuesta B - Con Isla&quot;).
            </p>

            {createDesignError && (
              <div className="pd-alert pd-alert--error" role="alert">
                {createDesignError}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="new-design-name">Nombre de la alternativa</label>
              <input
                id="new-design-name"
                type="text"
                className="form-control"
                placeholder="Ej. Cocina lineal sin alacenas"
                value={newDesignName}
                onChange={(e) => setNewDesignName(e.target.value)}
                disabled={isSubmittingDesign}
                autoFocus
                required
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isSubmittingDesign}
                onClick={() => setIsCreatingDesign(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmittingDesign}
                data-testid="submit-create-design"
              >
                {isSubmittingDesign ? 'Creando…' : 'Crear alternativa'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
