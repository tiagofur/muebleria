import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  Armchair,
  Box,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  FileCode,
  FileText,
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
  type DesignPublishArtifactKind,
  type DesignRevision,
  type DesignRevisionArtifact,
  type ProductionRelease,
} from '@granete/storage';
import { EmptyState, Modal, PageHeader, PageLoading, WorkspaceTabs } from '../common';
import {
  ARTIFACT_KIND_LABELS,
  buildDesignLineage,
  DESIGN_REVISION_STATUS_LABELS,
  DESIGN_SOURCE_TYPE_LABELS,
  formatArtifactSize,
  formatSha256Digest,
  getArtifactAvailability,
  selectDesignRevision,
  type DesignLineageNode,
} from './designHistory';
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
  readonly queryKeys: ProjectDesignsQueryKeys;
  readonly initialContext?: ProjectDesignsContextState | null;
  readonly onContextChange?: (context: ProjectDesignsContextState) => void;
  readonly onBack?: () => void;
  readonly onOpenFurnitureMatrix?: (context: { designId: string | null; revisionId: string | null }) => void;
  readonly canMutate?: boolean;
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

function formatParameters(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return '—';
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

function formatMaterials(materials: Record<string, string>): string {
  const entries = Object.entries(materials);
  if (entries.length === 0) return '—';
  return entries.map(([role, mat]) => `${role}: ${mat}`).join(', ');
}

export function ProjectDesignsScreen({
  baseUrl,
  token,
  projectId,
  queryKeys,
  initialContext,
  onContextChange,
  onBack,
  onOpenFurnitureMatrix,
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
  const [authorizeError, setAuthorizeError] = useState<string | null>(null);
  const [showTechnicalAudit, setShowTechnicalAudit] = useState(false);

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

  // Default design selection
  useEffect(() => {
    if (designsQuery.isSuccess && designs.length > 0 && !designId) {
      const first = designs[0]!;
      setDesignId(first.id);
      onContextChange?.({ designId: first.id, revisionId: null });
    }
  }, [designsQuery.isSuccess, designs, designId, onContextChange]);

  const selectedDesign = useMemo(
    () => designs.find((d) => d.id === designId) ?? designs[0] ?? null,
    [designs, designId],
  );
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

  // 3. Working Copy query for active design
  const workingCopyQuery = useQuery({
    queryKey: activeDesignId
      ? queryKeys.designWorkingCopy(activeDesignId)
      : ['project-designs', 'working-copy', 'none'],
    queryFn: ({ signal }) => api.getDesignWorkingCopy(token, activeDesignId as string, signal),
    enabled: activeDesignId !== null,
  });
  const workingCopy = workingCopyQuery.data ?? null;

  // 4. Production Releases query
  const releasesQuery = useQuery({
    queryKey: queryKeys.productionReleases,
    queryFn: ({ signal }) => api.listProjectProductionReleases(token, projectId, signal),
  });
  const releases: readonly ProductionRelease[] = releasesQuery.data ?? [];

  // Lineage & selected revision
  const lineage = useMemo(() => buildDesignLineage(revisions), [revisions]);

  const selectedRevision = useMemo(
    () => selectDesignRevision(revisions, revisionId),
    [revisions, revisionId],
  );

  // Sync revisionId default when not specified
  useEffect(() => {
    if (revisionsQuery.isSuccess && revisions.length > 0 && !revisionId && selectedRevision) {
      // Keep state pinned to selectedRevision
      onContextChange?.({ designId: activeDesignId, revisionId: selectedRevision.id });
    }
  }, [revisionsQuery.isSuccess, revisions, revisionId, selectedRevision, activeDesignId, onContextChange]);

  // ProductionRelease linked to this exact revision
  const linkedRelease = useMemo(() => {
    if (!selectedRevision) return null;
    return releases.find((rel) => rel.design_revision_id === selectedRevision.id) ?? null;
  }, [releases, selectedRevision]);

  // Artifacts fallback query if not embedded in revision
  const artifactsQuery = useQuery({
    queryKey:
      activeDesignId && selectedRevision
        ? queryKeys.designRevisionArtifacts(activeDesignId, selectedRevision.id)
        : ['project-designs', 'artifacts', 'none'],
    queryFn: ({ signal }) =>
      api.listDesignRevisionArtifacts(token, activeDesignId as string, selectedRevision!.id, signal),
    enabled:
      activeDesignId !== null &&
      selectedRevision !== null &&
      (!selectedRevision.artifacts || selectedRevision.artifacts.length === 0),
  });

  const artifacts: readonly DesignRevisionArtifact[] = useMemo(() => {
    if (selectedRevision?.artifacts && selectedRevision.artifacts.length > 0) {
      return selectedRevision.artifacts;
    }
    return artifactsQuery.data ?? [];
  }, [selectedRevision, artifactsQuery.data]);

  const availability = useMemo(() => getArtifactAvailability(artifacts), [artifacts]);

  // Preview Grant Query
  const previewGrantQuery = useQuery({
    queryKey:
      activeDesignId && selectedRevision && availability.preview
        ? [...queryKeys.root, 'grant', activeDesignId, selectedRevision.id, 'preview']
        : ['project-designs', 'grant', 'none'],
    queryFn: ({ signal }) =>
      api.authorizeDesignRevisionArtifact(
        token,
        activeDesignId as string,
        selectedRevision!.id,
        'preview',
        signal,
      ),
    enabled: activeDesignId !== null && selectedRevision !== null && availability.preview !== null,
    staleTime: 1000 * 60 * 5, // 5 minutes cache
  });

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
    if (!activeDesignId || !selectedRevision) return;
    setAuthorizingKind(kind);
    setAuthorizeError(null);
    try {
      const grant = await api.authorizeDesignRevisionArtifact(
        token,
        activeDesignId,
        selectedRevision.id,
        kind,
      );
      const cleanBase = baseUrl.replace(/\/+$/, '');
      const url = grant.url.startsWith('http')
        ? grant.url
        : `${cleanBase}${grant.url.startsWith('/') ? '' : '/'}${grant.url}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setAuthorizeError(`No se pudo autorizar el acceso al artefacto (${kind}).`);
    } finally {
      setAuthorizingKind(null);
    }
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
        subtitle="Historial inmutable de alternativas de diseño, revisiones publicadas y artefactos 3D de la obra."
        primaryAction={
          canMutate ? (
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
            {onOpenFurnitureMatrix && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="open-furniture-matrix-btn"
                onClick={() =>
                  onOpenFurnitureMatrix({
                    designId: activeDesignId,
                    revisionId: selectedRevision?.id ?? null,
                  })
                }
              >
                <Box size={16} />
                <span>Ver matriz de muebles</span>
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
          description="Aún no se ha creado ninguna alternativa de diseño para el proyecto."
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

          {/* Working Copy Banner */}
          {workingCopy && (
            <div className="pd-working-copy-banner" data-testid="working-copy-banner">
              <div className="pd-working-copy-banner__info">
                <Layers size={18} className="pd-working-copy-banner__icon" />
                <div>
                  <strong>Borrador de trabajo (Working Copy):</strong>{' '}
                  <span>
                    {workingCopy.items.length}{' '}
                    {workingCopy.items.length === 1 ? 'mueble' : 'muebles'} modelados
                  </span>
                  {workingCopy.base_revision_id ? (
                    <span className="pd-working-copy-banner__meta">
                      {' '}
                      · Base: {workingCopy.base_revision_id.slice(0, 8)}…
                    </span>
                  ) : (
                    <span className="pd-working-copy-banner__meta"> · Sin revisión base</span>
                  )}
                </div>
              </div>
              <span className="pd-working-copy-banner__date">
                Modificado: {formatWhen(workingCopy.updated_at)}
              </span>
            </div>
          )}

          {/* Lineage Timeline (R1 → R2 → R3) */}
          <div className="pd-lineage-container" data-testid="design-lineage-timeline">
            <div className="pd-lineage-header">
              <div className="pd-lineage-title">
                <History size={18} />
                <h3>Linaje de revisiones inmutables</h3>
              </div>
              <span className="pd-lineage-count">
                {lineage.length} {lineage.length === 1 ? 'publicación' : 'publicaciones'}
              </span>
            </div>

            {revisionsQuery.isLoading ? (
              <div className="pd-lineage-loading">Cargando revisiones…</div>
            ) : lineage.length === 0 ? (
              <div className="pd-lineage-empty" data-testid="no-revisions-notice">
                <p>
                  Este diseño no cuenta con revisiones inmutables publicadas todavía. El trabajo
                  actual reside en el borrador de trabajo (Working Copy).
                </p>
              </div>
            ) : (
              <div className="pd-lineage-track" role="list">
                {lineage.map((node, index) => {
                  const isSelected = selectedRevision?.id === node.revision.id;
                  const statusLabel =
                    DESIGN_REVISION_STATUS_LABELS[node.status] ?? node.status;
                  const sourceLabel =
                    DESIGN_SOURCE_TYPE_LABELS[node.sourceType] ?? node.sourceType;

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
                        {node.revision.created_by && (
                          <div className="pd-lineage-node__author">
                            {node.revision.created_by}
                          </div>
                        )}
                      </button>
                      {index < lineage.length - 1 && (
                        <div className="pd-lineage-connector" aria-hidden="true">
                          <ChevronRight size={18} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Revision Inspector (Pinned View) */}
          {selectedRevision ? (
            <div className="pd-inspector" data-testid="revision-inspector">
              <div className="pd-inspector__header">
                <div>
                  <h2 className="pd-inspector__title">
                    Revisión R{selectedRevision.revision_number}
                    {selectedRevision.status === 'approved' && (
                      <span className="status-badge status-badge--done">
                        <ShieldCheck size={14} /> Aprobada
                      </span>
                    )}
                    {selectedRevision.status === 'superseded' && (
                      <span className="status-badge status-badge--warning">
                        Reemplazada (Histórica)
                      </span>
                    )}
                  </h2>
                  <p className="pd-inspector__subtitle">
                    Snapshot inmutable publicado el {formatWhen(selectedRevision.created_at)} por{' '}
                    <strong>{selectedRevision.created_by ?? 'Sistema'}</strong> desde{' '}
                    <strong>
                      {DESIGN_SOURCE_TYPE_LABELS[selectedRevision.source_type] ??
                        selectedRevision.source_type}
                    </strong>
                    .
                  </p>
                </div>

                {linkedRelease && (
                  <div className="pd-inspector__release-badge" data-testid="linked-release-badge">
                    <CheckCircle2 size={16} className="text-success" />
                    <span>Liberación a producción vinculada</span>
                  </div>
                )}
              </div>

              {/* Grid: Left Column (Items & Attributes) / Right Column (3D Preview & Artifacts) */}
              <div className="pd-inspector__grid">
                <div className="pd-inspector__main">
                  {/* Physical Items list */}
                  <div className="pd-card">
                    <div className="pd-card__header">
                      <div className="pd-card__title">
                        <Box size={18} />
                        <h3>Unidades físicas contenidas ({selectedRevision.items.length})</h3>
                      </div>
                    </div>

                    {selectedRevision.items.length === 0 ? (
                      <p className="pd-empty-hint">Esta revisión no contiene unidades físicas.</p>
                    ) : (
                      <div className="pd-table-container">
                        <table
                          className="pd-items-table"
                          data-testid="revision-items-table"
                        >
                          <thead>
                            <tr>
                              <th>Unidad física (ID)</th>
                              <th>Definición / Módulo</th>
                              <th>Parámetros</th>
                              <th>Materiales</th>
                              <th>Ambiente</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedRevision.items.map((item) => (
                              <tr key={item.id} data-testid={`revision-item-${item.id}`}>
                                <td>
                                  <span
                                    className="pd-code-pill"
                                    title={item.furniture_instance_id}
                                  >
                                    {item.furniture_instance_id.slice(0, 13)}…
                                  </span>
                                </td>
                                <td>
                                  {item.furniture_definition_id ? (
                                    <span>
                                      {item.furniture_definition_id}
                                      {item.definition_version != null && (
                                        <small className="text-muted">
                                          {' '}
                                          v{item.definition_version}
                                        </small>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-muted">—</span>
                                  )}
                                </td>
                                <td className="pd-param-cell">
                                  {formatParameters(item.parameters)}
                                </td>
                                <td className="pd-param-cell">
                                  {formatMaterials(item.material_choices)}
                                </td>
                                <td>{item.room_id ?? <span className="text-muted">—</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
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
                      {previewGrantQuery.isLoading ? (
                        <div className="pd-preview-placeholder pd-preview-loading">
                          <RefreshCw size={24} className="spin" />
                          <span>Obteniendo acceso a vista previa…</span>
                        </div>
                      ) : previewGrantQuery.isError ? (
                        <div
                          className="pd-preview-placeholder pd-preview-error"
                          data-testid="preview-error"
                        >
                          <TriangleAlert size={24} />
                          <span>No se pudo cargar la vista previa</span>
                        </div>
                      ) : previewGrantQuery.data ? (
                        <div className="pd-preview-image-wrapper">
                          <img
                            src={
                              previewGrantQuery.data.url.startsWith('http')
                                ? previewGrantQuery.data.url
                                : `${baseUrl.replace(/\/+$/, '')}${
                                    previewGrantQuery.data.url.startsWith('/') ? '' : '/'
                                  }${previewGrantQuery.data.url}`
                            }
                            alt={`Vista previa 3D R${selectedRevision.revision_number}`}
                            className="pd-preview-image"
                            data-testid="preview-image"
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
                      </div>
                    </div>

                    {authorizeError && (
                      <div className="pd-alert pd-alert--error" role="alert">
                        {authorizeError}
                      </div>
                    )}

                    {artifacts.length === 0 ? (
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
                                      title={`SHA-256: ${art.sha256}`}
                                    >
                                      {formatSha256Digest(art.sha256)}
                                    </span>
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      disabled={isAuthorizing}
                                      onClick={() => handleAuthorizeAndOpen(art.kind)}
                                      data-testid={`download-artifact-${art.kind}`}
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

                  {/* Technical Details Toggle */}
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
                        <dt>Revision ID</dt>
                        <dd>{selectedRevision.id}</dd>
                        <dt>Design ID</dt>
                        <dd>{selectedRevision.design_id}</dd>
                        <dt>Parent Revision</dt>
                        <dd>{selectedRevision.parent_revision_id ?? 'Raíz (null)'}</dd>
                        {selectedRevision.approved_at && (
                          <>
                            <dt>Aprobado el</dt>
                            <dd>{formatWhen(selectedRevision.approved_at)}</dd>
                            <dt>Aprobado por</dt>
                            <dd>{selectedRevision.approved_by ?? '—'}</dd>
                          </>
                        )}
                        <dt>Cantidad ítems</dt>
                        <dd>{selectedRevision.items.length}</dd>
                        <dt>Cantidad artefactos</dt>
                        <dd>{artifacts.length}</dd>
                      </dl>
                    )}
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
