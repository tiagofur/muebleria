import type {
  DesignPublishArtifactKind,
  DesignRevision,
  DesignRevisionArtifact,
  DesignRevisionSourceType,
  DesignRevisionStatus,
} from '@granete/storage';

/**
 * #501 / WEB-DT-2 — Pure lineage and artifact presentation model.
 *
 * Implements the lineage visualization (R1 → R2 → R3) and exact revision
 * selection rules. Revisions are immutable: an older revision snapshot
 * never mutates or falls back to latest data silently.
 */

export interface DesignLineageNode {
  readonly revision: DesignRevision;
  readonly revisionNumber: number;
  readonly isRoot: boolean;
  readonly parentRevisionId: string | null;
  readonly hasValidParent: boolean;
  readonly status: DesignRevisionStatus;
  readonly sourceType: DesignRevisionSourceType;
  readonly isLatest: boolean;
  readonly isApproved: boolean;
}

export const DESIGN_SOURCE_TYPE_LABELS: Readonly<Record<DesignRevisionSourceType, string>> = {
  sketchup: 'SketchUp',
  proyectar: 'Proyectar 3D',
  import: 'Importación',
  system: 'Sistema',
  manual: 'Manual',
};

export const DESIGN_REVISION_STATUS_LABELS: Readonly<Record<DesignRevisionStatus, string>> = {
  published: 'Publicada',
  approved: 'Aprobada',
  superseded: 'Reemplazada',
};

export const ARTIFACT_KIND_LABELS: Readonly<Record<DesignPublishArtifactKind, string>> = {
  model: 'Modelo 3D (.skp)',
  manifest: 'Manifest (.json)',
  preview: 'Vista previa (.png)',
};

/**
 * Builds an ordered immutable revision lineage chain (R1 → R2 → ...).
 * Revisions are sorted strictly ascending by revision_number.
 */
export function buildDesignLineage(
  revisions: ReadonlyArray<DesignRevision>,
): ReadonlyArray<DesignLineageNode> {
  if (!revisions || revisions.length === 0) return [];

  const sorted = [...revisions].sort((a, b) => {
    if (a.revision_number !== b.revision_number) {
      return a.revision_number - b.revision_number;
    }
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const knownIds = new Set<string>(sorted.map((r) => r.id));
  const maxRevisionNumber = sorted[sorted.length - 1]?.revision_number ?? 0;

  return sorted.map((rev) => {
    const parentId = rev.parent_revision_id?.trim() || null;
    const isRoot = parentId === null || rev.revision_number === 1;
    const hasValidParent = isRoot || (parentId !== null && knownIds.has(parentId));
    const isLatest = rev.revision_number === maxRevisionNumber;
    const isApproved = rev.status === 'approved' || Boolean(rev.approved_at);

    return {
      revision: rev,
      revisionNumber: rev.revision_number,
      isRoot,
      parentRevisionId: parentId,
      hasValidParent,
      status: rev.status,
      sourceType: rev.source_type,
      isLatest,
      isApproved,
    };
  });
}

/**
 * Selects an exact revision snapshot.
 *
 * Negative proof contract (#501):
 * - if `revisionId` is specified, it MUST match that exact revision id;
 *   if not found, returns null (never silently substitutes latest);
 * - if `revisionId` is empty or null, defaults to the latest published revision.
 */
export function selectDesignRevision(
  revisions: ReadonlyArray<DesignRevision>,
  revisionId?: string | null,
): DesignRevision | null {
  if (!revisions || revisions.length === 0) return null;

  const trimmedId = revisionId?.trim();
  if (trimmedId) {
    const exact = revisions.find((r) => r.id === trimmedId);
    return exact ?? null;
  }

  // Default to highest revision_number (latest published projection).
  return revisions.reduce<DesignRevision | null>((latest, current) => {
    if (!latest) return current;
    return current.revision_number > latest.revision_number ? current : latest;
  }, null);
}

export interface ArtifactAvailability {
  readonly model: DesignRevisionArtifact | null;
  readonly manifest: DesignRevisionArtifact | null;
  readonly preview: DesignRevisionArtifact | null;
  readonly totalArtifacts: number;
}

/**
 * Classifies published artifacts by standard kinds (model, manifest, preview).
 */
export function getArtifactAvailability(
  artifacts?: ReadonlyArray<DesignRevisionArtifact> | null,
): ArtifactAvailability {
  if (!artifacts || artifacts.length === 0) {
    return { model: null, manifest: null, preview: null, totalArtifacts: 0 };
  }

  let model: DesignRevisionArtifact | null = null;
  let manifest: DesignRevisionArtifact | null = null;
  let preview: DesignRevisionArtifact | null = null;

  for (const a of artifacts) {
    if (a.kind === 'model') model = a;
    else if (a.kind === 'manifest') manifest = a;
    else if (a.kind === 'preview') preview = a;
  }

  return {
    model,
    manifest,
    preview,
    totalArtifacts: artifacts.length,
  };
}

/**
 * Formats byte size into human-readable representation (B, KB, MB).
 */
export function formatArtifactSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/**
 * #640: validates and returns the canonical digest form
 * `sha256-<64 lowercase hex>` exactly as persisted/generated by the contract,
 * or null when the value is not canonical. Arbitrary strings are never
 * reinterpreted as digests.
 */
export function canonicalArtifactSHA256(sha: string | null | undefined): string | null {
  const trimmed = sha?.trim() ?? '';
  return /^sha256-[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

/**
 * Formats a SHA-256 hash for compact presentation (#640 §5): the canonical
 * `sha256-` prefix renders exactly once — `sha256-sha256-…` can never happen.
 * Non-canonical values fall back to a neutral marker instead of a misleading
 * digest; technical details expose the full canonical digest.
 */
export function formatSha256Digest(sha: string, prefixLength = 8): string {
  const canonical = canonicalArtifactSHA256(sha);
  if (!canonical) return 'sha256-—';
  const hex = canonical.slice('sha256-'.length);
  if (hex.length <= prefixLength) return `sha256-${hex}`;
  return `sha256-${hex.slice(0, prefixLength)}…`;
}

/** Authoritative artifact health states (#640). */
export type DesignArtifactHealthStatus = 'available' | 'missing' | 'integrity_mismatch';

export const ARTIFACT_HEALTH_LABELS: Readonly<Record<DesignArtifactHealthStatus, string>> = {
  available: 'Disponible',
  missing: 'Bytes no disponibles',
  integrity_mismatch: 'Integridad comprometida',
};

/**
 * Resolves the authoritative health of one artifact. Health is absent only
 * for legacy contract-less payloads; callers must treat that explicitly and
 * never fold it into "available" (#640 §4).
 */
export function artifactHealth(
  artifact: DesignRevisionArtifact,
): DesignArtifactHealthStatus | null {
  const status = artifact.health?.status;
  return status === 'available' || status === 'missing' || status === 'integrity_mismatch'
    ? status
    : null;
}
