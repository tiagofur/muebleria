/**
 * #500 / WEB-DT-1 — pure view-model derivation for the Project Furniture
 * matrix.
 *
 * Authority rules (issue #500, tracker #396, #389 / DT-5):
 * - Physical identity, origin and lifecycle come verbatim from the generated
 *   `FurnitureInstance` read model. Nothing here derives identity from name,
 *   definition, position or array index.
 * - Pending/placed derives from the SELECTED design context items joined by
 *   `furnitureInstanceId` — the exact same semantics the SketchUp Project
 *   Furniture panel uses (#389). No persisted global status exists.
 * - Reconciliation statuses (`quoted_not_modeled`, `modified`, …) are ONLY
 *   mirrored from the server `reconcileProjectDesign` result. This module
 *   never invents them.
 * - Commercial presence derives from the exact selected QuoteRevision items.
 *
 * Quantity > 1 keeps one row per physical unit; the visual grouping
 * (`unidad i de N`) groups by definition (fallback origin) exactly like the
 * plugin panel, so Web and SketchUp cannot drift apart.
 */

import type {
  Design,
  DesignRevision,
  DesignWorkingCopy,
  FurnitureInstance,
  ProductionRelease,
  ProjectDesignReconciliationResult,
  QuoteRevisionDetail,
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
  /** Quantity grouping provenance: `Unidad i de N` within the group. */
  readonly unitIndex: number;
  readonly unitTotal: number;
  readonly presence: DesignPresence;
  /** Membership in the exact selected QuoteRevision snapshot. */
  readonly quotedInSelectedRevision: boolean;
  /** Server-derived reconciliation status for the exact revisions, if any. */
  readonly reconciliation: ReconciliationStatus | null;
  /** Read-model reason + next step; never a persisted FurnitureInstance status. */
  readonly actionRequired: string | null;
  readonly nextStep: string | null;
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
  readonly instances: readonly FurnitureInstance[];
  readonly quoteRevisions: readonly QuoteRevisionDetail[];
  readonly selectedQuoteRevisionId: string | null;
  readonly designContext: DesignContextSelection;
  readonly workingCopy: DesignWorkingCopy | null;
  readonly designRevision: DesignRevision | null;
  readonly reconciliation: ProjectDesignReconciliationResult | null;
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

const RECONCILIATION_ACTIONS: Readonly<
  Record<ReconciliationStatus, { reason: string; nextStep: string | null }>
> = {
  synced: { reason: 'Sincronizada con la cotización y el diseño', nextStep: null },
  conflict: {
    reason: 'Conflicto entre cotización y diseño',
    nextStep: 'Resolví el conflicto antes de cotizar o producir',
  },
  modified: {
    reason: 'Modificada respecto de la cotización',
    nextStep: 'Generá una nueva revisión de cotización para incorporar el cambio',
  },
  quoted_not_modeled: {
    reason: 'Cotizada pero no modelada',
    nextStep: 'Colocá la unidad en el diseño',
  },
  modeled_not_quoted: {
    reason: 'Modelada pero no cotizada',
    nextStep: 'Incorporá la unidad en una nueva revisión de cotización',
  },
  removed: {
    reason: 'Retirada del diseño',
    nextStep: 'Confirmá la baja o reincorporá la unidad',
  },
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

/** Grouping key mirrors the SketchUp panel (#389): definition first, origin
 * fallback when the unit carries no definition. */
function groupingKey(instance: FurnitureInstance): string {
  return instance.furniture_definition_id ?? `origin:${instance.origin}`;
}

function designPresenceOf(
  instanceId: string,
  placedInstanceIds: ReadonlySet<string>,
  hasDesignContext: boolean,
): DesignPresence {
  if (!hasDesignContext) return 'no-design';
  return placedInstanceIds.has(instanceId) ? 'placed' : 'pending';
}

function actionFor(
  presence: DesignPresence,
  reconciliation: ReconciliationStatus | null,
): { actionRequired: string | null; nextStep: string | null } {
  if (reconciliation !== null && reconciliation !== 'synced') {
    const action = RECONCILIATION_ACTIONS[reconciliation];
    return { actionRequired: action.reason, nextStep: action.nextStep };
  }
  if (presence === 'pending') {
    return {
      actionRequired: 'Pendiente de colocar en el diseño',
      nextStep: 'Colocá la unidad desde el panel de muebles',
    };
  }
  return { actionRequired: null, nextStep: null };
}

/**
 * Derive the per-unit matrix rows and summary from authoritative generated
 * read models. Deterministic: rows sort by label, then unit index, then id.
 */
export function buildFurnitureMatrix(input: FurnitureMatrixInput): {
  rows: readonly FurnitureMatrixRow[];
  summary: FurnitureMatrixSummary;
} {
  const {
    instances,
    quoteRevisions,
    selectedQuoteRevisionId,
    designContext,
    workingCopy,
    designRevision,
    reconciliation,
  } = input;

  // Exact commercial context: per-unit membership comes from the immutable
  // snapshot of the selected revision only.
  const selectedQuoteRevision =
    quoteRevisions.find((revision) => revision.id === selectedQuoteRevisionId) ?? null;
  const quoteItemByInstanceId = new Map<string, QuoteRevisionDetail['items'][number]>();
  for (const item of selectedQuoteRevision?.items ?? []) {
    quoteItemByInstanceId.set(item.furnitureInstanceId, item);
  }

  // Selected design context items (working copy OR exact published revision).
  const hasDesignContext =
    designContext.kind === 'working'
      ? workingCopy !== null
      : designContext.kind === 'revision'
        ? designRevision !== null
        : false;
  const placedInstanceIds = new Set<string>();
  if (designContext.kind === 'working') {
    for (const item of workingCopy?.items ?? []) placedInstanceIds.add(item.furniture_instance_id);
  } else if (designContext.kind === 'revision') {
    for (const item of designRevision?.items ?? []) placedInstanceIds.add(item.furniture_instance_id);
  }

  // Server-derived reconciliation statuses for the exact revision pair.
  const reconciliationByInstanceId = new Map<string, ReconciliationStatus>();
  for (const item of reconciliation?.items ?? []) {
    reconciliationByInstanceId.set(item.furnitureInstanceId, item.status);
  }

  // Quantity grouping: index within definition/origin group, plugin parity.
  const groupTotals = new Map<string, number>();
  for (const instance of instances) {
    const key = groupingKey(instance);
    groupTotals.set(key, (groupTotals.get(key) ?? 0) + 1);
  }
  const groupCounters = new Map<string, number>();
  // Stable within-group ordering: creation, then identity.
  const ordered = [...instances].sort((a, b) =>
    a.created_at === b.created_at
      ? a.id.localeCompare(b.id)
      : a.created_at.localeCompare(b.created_at),
  );

  const rows: FurnitureMatrixRow[] = ordered.map((instance) => {
    const key = groupingKey(instance);
    const unitIndex = (groupCounters.get(key) ?? 0) + 1;
    groupCounters.set(key, unitIndex);

    const presence = designPresenceOf(instance.id, placedInstanceIds, hasDesignContext);
    const quoteItem = quoteItemByInstanceId.get(instance.id) ?? null;
    const reconciliationStatus = reconciliationByInstanceId.get(instance.id) ?? null;
    const { actionRequired, nextStep } = actionFor(presence, reconciliationStatus);

    return {
      instance,
      label: instanceLabel(instance),
      dimensionsLabel: dimensionsLabel(instance),
      origin: instance.origin,
      originLabel: ORIGIN_LABELS[instance.origin],
      duplicateOfInstanceId: instance.origin_furniture_instance_id ?? null,
      lifecycle: instance.lifecycle_status,
      lifecycleLabel: LIFECYCLE_LABELS[instance.lifecycle_status],
      isActive: instance.lifecycle_status === 'active',
      unitIndex,
      unitTotal: groupTotals.get(key) ?? 1,
      presence,
      quotedInSelectedRevision: quoteItem !== null,
      reconciliation: reconciliationStatus,
      actionRequired,
      nextStep,
    };
  });

  rows.sort((a, b) =>
    a.label === b.label
      ? a.unitIndex === b.unitIndex
        ? a.instance.id.localeCompare(b.instance.id)
        : a.unitIndex - b.unitIndex
      : a.label.localeCompare(b.label, 'es'),
  );

  const summary: FurnitureMatrixSummary = {
    total: rows.length,
    activeUnits: rows.filter((row) => row.isActive).length,
    quotedActive: rows.filter(
      (row) => row.quotedInSelectedRevision,
    ).length,
    placedInDesign: rows.filter((row) => row.presence === 'placed').length,
    pendingPlacement: rows.filter((row) => row.presence === 'pending').length,
    requireAttention: rows.filter((row) => row.actionRequired !== null).length,
    removed: rows.filter((row) => row.lifecycle === 'removed').length,
    cancelled: rows.filter((row) => row.lifecycle === 'cancelled').length,
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
  return first ? { kind: 'working', designId: first.id, designRevisionId: null } : { kind: 'none', designId: null, designRevisionId: null };
}

/** The release authority reference for the context header: newest release. */
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
