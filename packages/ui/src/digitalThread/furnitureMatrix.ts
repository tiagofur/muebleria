/**
 * #500 / WEB-DT-1 — pure view-model derivation for the Project Furniture
 * matrix.
 *
 * Authority rules (issue #500, tracker #396, #389 / DT-5):
 * - Physical identity, origin, and lifecycle come verbatim from the generated
 *   `FurnitureInstance` read model. Nothing here derives identity from name,
 *   definition, position, or array index.
 * - Contextual placed/pending and action-required status derive strictly from
 *   the backend read model (`POST /projects/{projectId}/furniture-workspace`).
 *   React NEVER joins design items or invents next-step remediations locally.
 * - Commercial quantity grouping provenance (`Unidad i de N`) comes strictly
 *   from `quote_line_furniture_instances` truth (via `commercialGrouping`).
 *   Units without commercial line provenance do NOT render artificial 1 of 1.
 * - Reconciliation badges mirror server truth only; React never invents them.
 */

import type {
  Design,
  FurnitureInstance,
  FurnitureWorkspaceCommercialGrouping,
  FurnitureWorkspaceDesignPresence,
  ProductionRelease,
  ProjectFurnitureWorkspace,
  QuoteRevisionDetail,
  ReconciliationItem,
  ReconciliationStatus,
} from '@granete/storage';

export type FurnitureOrigin = FurnitureInstance['origin'];
export type FurnitureLifecycle = FurnitureInstance['lifecycle_status'];

export type DesignPresence = 'placed' | 'pending' | 'no-design';

export interface DesignContextSelection {
  readonly kind: 'none' | 'working' | 'revision';
  readonly designId: string | null;
  readonly designRevisionId: string | null;
}

export interface MatrixFilters {
  readonly search: string;
  readonly origins: readonly FurnitureOrigin[];
  readonly presences: readonly DesignPresence[];
  readonly lifecycles: readonly FurnitureLifecycle[];
  readonly attention: boolean;
}

export const EMPTY_MATRIX_FILTERS: MatrixFilters = {
  search: '',
  origins: [],
  presences: [],
  lifecycles: [],
  attention: false,
};

export interface FurnitureMatrixRow {
  readonly instance: FurnitureInstance;
  /** Human-friendly label; technical ids stay in the detail drawer. */
  readonly label: string;
  readonly dimensionsLabel: string | null;
  readonly origin: FurnitureOrigin;
  readonly originLabel: string;
  readonly duplicateOfInstanceId: string | null;
  readonly lifecycle: FurnitureLifecycle;
  readonly lifecycleLabel: string;
  readonly isActive: boolean;
  /** Commercial quantity grouping provenance (#386 / QuoteLine ↔ FurnitureInstance). */
  readonly commercialGrouping: FurnitureWorkspaceCommercialGrouping | null;
  readonly unitIndex: number | null;
  readonly unitTotal: number | null;
  readonly unitProvenanceLabel: string | null;
  readonly presence: DesignPresence;
  /** Membership in the exact selected QuoteRevision snapshot. */
  readonly quotedInSelectedRevision: boolean;
  /** Server-derived reconciliation status for the exact revisions, if any. */
  readonly reconciliation: ReconciliationStatus | null;
  readonly reconciliationItem: ReconciliationItem | null;
  /** Read-model reason + next step; server-projected, never persisted status. */
  readonly actionRequired: string | null;
  readonly nextStep: string | null;
  readonly actionCode: string | null;
}

export interface FurnitureMatrixSummary {
  readonly total: number;
  readonly activeUnits: number;
  readonly quotedActive: number;
  readonly placedInDesign: number;
  readonly pendingPlacement: number;
  readonly requireAttention: number;
  readonly removed: number;
  readonly cancelled: number;
}

export interface FurnitureMatrixInput {
  readonly workspace: ProjectFurnitureWorkspace;
}

const ORIGIN_LABELS: Readonly<Record<FurnitureOrigin, string>> = {
  quote: 'Cotización',
  design: 'Diseño',
  manual: 'Manual',
  import: 'Importado',
  duplicate: 'Duplicado',
};

const LIFECYCLE_LABELS: Readonly<Record<FurnitureLifecycle, string>> = {
  active: 'Activa',
  removed: 'Retirada',
  cancelled: 'Cancelada',
};

function instanceLabel(instance: FurnitureInstance): string {
  const name = instance.display?.name?.trim();
  return name && name.length > 0 ? name : 'Mueble del proyecto';
}

function dimensionsLabel(instance: FurnitureInstance): string | null {
  const dims = instance.display?.dimensions_mm;
  if (!dims) return null;
  const parts = [dims.width, dims.height, dims.depth].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (parts.length === 0) return null;
  return `${parts.join(' × ')} mm`;
}

function mapPresence(presence: FurnitureWorkspaceDesignPresence): DesignPresence {
  if (presence === 'placed') return 'placed';
  if (presence === 'pending') return 'pending';
  return 'no-design';
}

/**
 * Derive the per-unit matrix rows and summary from authoritative backend
 * read model (`POST /projects/{projectId}/furniture-workspace`).
 * Deterministic: rows sort by label, then unit index, then id.
 */
export function buildFurnitureMatrix(input: FurnitureMatrixInput): {
  rows: readonly FurnitureMatrixRow[];
  summary: FurnitureMatrixSummary;
} {
  const { workspace } = input;

  const rows: FurnitureMatrixRow[] = (workspace.units ?? []).map((unit) => {
    const instance = unit.furnitureInstance;
    const grouping = unit.commercialGrouping ?? null;
    const unitIndex = grouping?.unitIndex ?? null;
    const unitTotal = grouping?.unitTotal ?? null;
    const unitProvenanceLabel =
      unitIndex !== null && unitTotal !== null ? `Unidad ${unitIndex} de ${unitTotal}` : null;

    const presence = mapPresence(unit.design?.presence ?? 'none');
    const reconciliationStatus = unit.reconciliation?.status ?? null;
    const actionRequired = unit.actionRequired?.message ?? null;
    const nextStep = unit.actionRequired?.remediation ?? null;
    const actionCode = unit.actionRequired?.code ?? null;

    return {
      instance,
      label: instanceLabel(instance),
      dimensionsLabel: dimensionsLabel(instance),
      origin: instance.origin,
      originLabel: ORIGIN_LABELS[instance.origin] ?? instance.origin,
      duplicateOfInstanceId: instance.origin_furniture_instance_id ?? null,
      lifecycle: instance.lifecycle_status,
      lifecycleLabel: LIFECYCLE_LABELS[instance.lifecycle_status] ?? instance.lifecycle_status,
      isActive: instance.lifecycle_status === 'active',
      commercialGrouping: grouping,
      unitIndex,
      unitTotal,
      unitProvenanceLabel,
      presence,
      quotedInSelectedRevision: unit.commercial?.present ?? false,
      reconciliation: reconciliationStatus,
      reconciliationItem: unit.reconciliation ?? null,
      actionRequired,
      nextStep,
      actionCode,
    };
  });

  rows.sort((a, b) => {
    const labelCmp = a.label.localeCompare(b.label, 'es');
    if (labelCmp !== 0) return labelCmp;
    const aIndex = a.unitIndex ?? 0;
    const bIndex = b.unitIndex ?? 0;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.instance.id.localeCompare(b.instance.id);
  });

  const summary: FurnitureMatrixSummary = {
    total: workspace.summary?.total ?? rows.length,
    activeUnits: workspace.summary?.activeUnits ?? rows.filter((r) => r.isActive).length,
    quotedActive:
      workspace.summary?.quoted ?? rows.filter((r) => r.quotedInSelectedRevision).length,
    placedInDesign:
      workspace.summary?.placed ?? rows.filter((r) => r.presence === 'placed').length,
    pendingPlacement:
      workspace.summary?.pending ?? rows.filter((r) => r.presence === 'pending').length,
    requireAttention:
      workspace.summary?.actionRequired ?? rows.filter((r) => r.actionRequired !== null).length,
    removed: workspace.summary?.removed ?? rows.filter((r) => r.lifecycle === 'removed').length,
    cancelled:
      workspace.summary?.cancelled ?? rows.filter((r) => r.lifecycle === 'cancelled').length,
  };

  return { rows, summary };
}

function matchesFilters(row: FurnitureMatrixRow, filters: MatrixFilters): boolean {
  const search = filters.search.trim().toLowerCase();
  if (search.length > 0) {
    const haystack = `${row.label} ${row.instance.id}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (filters.origins.length > 0 && !filters.origins.includes(row.origin)) return false;
  if (filters.presences.length > 0 && !filters.presences.includes(row.presence)) return false;
  if (filters.lifecycles.length > 0 && !filters.lifecycles.includes(row.lifecycle)) return false;
  if (filters.attention && row.actionRequired === null) return false;
  return true;
}

export function filterMatrixRows(
  rows: readonly FurnitureMatrixRow[],
  filters: MatrixFilters,
): readonly FurnitureMatrixRow[] {
  return rows.filter((row) => matchesFilters(row, filters));
}

export function filtersAreActive(filters: MatrixFilters): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.origins.length > 0 ||
    filters.presences.length > 0 ||
    filters.lifecycles.length > 0 ||
    filters.attention
  );
}

/** Newest revision is only the VIEW default; once selected the id is pinned
 * in the URL so a newer revision can never silently retarget the view. */
export function defaultQuoteRevisionId(
  quoteRevisions: readonly QuoteRevisionDetail[],
): string | null {
  let newest: QuoteRevisionDetail | null = null;
  for (const revision of quoteRevisions) {
    if (
      newest === null ||
      revision.revisionNumber > newest.revisionNumber ||
      (revision.revisionNumber === newest.revisionNumber && revision.id > newest.id)
    ) {
      newest = revision;
    }
  }
  return newest?.id ?? null;
}

/** First design (stable by creation then id) with the working context as the
 * default view — matching where authoring happens (#389). */
export function defaultDesignContext(
  designs: readonly Design[],
): DesignContextSelection {
  if (designs.length === 0) return { kind: 'none', designId: null, designRevisionId: null };
  const sorted = [...designs].sort((a, b) =>
    a.created_at === b.created_at
      ? a.id.localeCompare(b.id)
      : a.created_at.localeCompare(b.created_at),
  );
  const first = sorted[0];
  return first
    ? { kind: 'working', designId: first.id, designRevisionId: null }
    : { kind: 'none', designId: null, designRevisionId: null };
}

/** Kept for backwards compatibility; preferred release authority is workspace.release. */
export function currentReleaseReference(
  releases: readonly ProductionRelease[],
): ProductionRelease | null {
  let current: ProductionRelease | null = null;
  for (const release of releases) {
    if (current === null || release.release_number > current.release_number) {
      current = release;
    }
  }
  return current;
}

export const ORIGIN_LABEL_LIST: readonly { id: FurnitureOrigin; label: string }[] = (
  Object.keys(ORIGIN_LABELS) as FurnitureOrigin[]
).map((id) => ({ id, label: ORIGIN_LABELS[id] ?? id }));

export const PRESENCE_LABELS: Readonly<Record<DesignPresence, string>> = {
  placed: 'En el diseño',
  pending: 'Pendiente de colocar',
  'no-design': 'Sin diseño',
};

export const LIFECYCLE_LABEL_LIST: readonly { id: FurnitureLifecycle; label: string }[] = (
  Object.keys(LIFECYCLE_LABELS) as FurnitureLifecycle[]
).map((id) => ({ id, label: LIFECYCLE_LABELS[id] ?? id }));
