/**
 * Pure presentation mappers for QuoteRevision commercial authority (#642).
 *
 * Joins frozen QuoteCommercialSnapshot lines and units with QuoteRevision items
 * strictly by quoteLineId and furnitureInstanceId. Never by name, index,
 * geometry, or live catalog defaults.
 */

import type { Customer, Project } from '@granete/domain';
import type {
  ProjectCommercialQuoteStatus,
  ProjectCommercialSummary,
  QuoteCommercialOption,
  QuoteCommercialSnapshot,
  QuoteRevisionItem,
} from '@granete/storage';
import { filterProjectsByQuery } from './helpers/projectFilterHelpers';

export interface ProjectRevisionUnitView {
  readonly furnitureInstanceId: string;
  readonly quoteLineId: string;
  readonly moduleCode: string;
  readonly moduleName: string;
  readonly lifecycleStatus: string;
  readonly dimensionsFormatted: string | null;
  readonly options: ReadonlyArray<QuoteCommercialOption>;
}

export interface ProjectRevisionLineView {
  readonly quoteLineId: string;
  readonly quantity: number;
  readonly furnitureInstanceIds: ReadonlyArray<string>;
  readonly moduleName: string;
  readonly moduleCode: string;
  readonly salePrice: number | null;
  readonly units: ReadonlyArray<ProjectRevisionUnitView>;
  readonly isMultiUnit: boolean;
}

function parseFiniteDim(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

/**
 * Formats dimensions from item parameters.
 * Returns `${w}×${h}×${d} mm` when all 3 dimensions are present, or null.
 * Shows honest absence instead of falling back to catalog presets or project items.
 */
export function formatRevisionUnitDimensions(
  parameters?: Record<string, unknown> | null,
): string | null {
  if (!parameters) return null;
  const width = parseFiniteDim(parameters.widthMm ?? parameters.width);
  const height = parseFiniteDim(parameters.heightMm ?? parameters.height);
  const depth = parseFiniteDim(parameters.depthMm ?? parameters.depth);
  if (width == null || height == null || depth == null) return null;
  return `${width}×${height}×${depth} mm`;
}

/**
 * Formats a QuoteRevision lifecycle status into Spanish UI copy (#642/3).
 */
export function formatQuoteRevisionStatus(status: string): string {
  switch (status) {
    case 'draft':
      return 'Borrador';
    case 'published':
      return 'Publicada';
    case 'accepted':
      return 'Aceptada';
    case 'superseded':
      return 'Reemplazada';
    default:
      return status;
  }
}

/**
 * Formats a furniture instance lifecycle status into Spanish UI copy (#642).
 */
export function formatLifecycleStatus(status?: string): string {
  switch (status) {
    case 'active':
      return 'Activa';
    case 'removed':
      return 'Retirada';
    case 'cancelled':
      return 'Cancelada';
    default:
      return status || '—';
  }
}

export interface BuildRevisionLinesOptions {
  /**
   * Whether line amounts are authorized for display in the current context.
   * When false (e.g. cost-blind actor without cost visibility), salePrice is null
   * so line cards do not mislead users by showing hidden amounts as free ($0.00).
   * When true (default), legitimate zero prices (0.00) are faithfully preserved.
   */
  readonly amountsVisible?: boolean;
}

/**
 * Builds coherent presentation lines from the exact commercial snapshot and items.
 *
 * Rules:
 * 1. Each line in snapshot.lines maps to one ProjectRevisionLineView keyed by quoteLineId.
 * 2. Units match strictly by u.quoteLineId === line.quoteLineId.
 * 3. Parameters match strictly by item.furnitureInstanceId === unit.furnitureInstanceId.
 * 4. salePrice is included when amountsVisible is true (default); legitimate 0.00 is preserved,
 *    while hidden/unauthorized amounts (amountsVisible: false) map to null to prevent misleading
 *    users with "$0.00" items.
 * 5. Distinct lines with identical module names remain distinct.
 */
export function buildRevisionLines(
  snapshot: QuoteCommercialSnapshot,
  items?: ReadonlyArray<QuoteRevisionItem>,
  options?: BuildRevisionLinesOptions,
): ReadonlyArray<ProjectRevisionLineView> {
  const itemByInstance = new Map<string, QuoteRevisionItem>();
  if (items) {
    for (const item of items) {
      if (item.furnitureInstanceId) {
        itemByInstance.set(item.furnitureInstanceId, item);
      }
    }
  }

  const amountsVisible = options?.amountsVisible ?? true;

  return snapshot.lines.map((line) => {
    const lineUnits = snapshot.units.filter(
      (u) => u.quoteLineId === line.quoteLineId,
    );

    const units: ProjectRevisionUnitView[] = lineUnits.map((u) => {
      const item = itemByInstance.get(u.furnitureInstanceId);
      return {
        furnitureInstanceId: u.furnitureInstanceId,
        quoteLineId: u.quoteLineId,
        moduleCode: u.moduleCode,
        moduleName: u.moduleName,
        lifecycleStatus: u.lifecycleStatus,
        dimensionsFormatted: formatRevisionUnitDimensions(item?.parameters),
        options: u.options ?? [],
      };
    });

    const firstUnit = units[0];
    const moduleName = firstUnit?.moduleName ?? 'Mueble';
    const moduleCode = firstUnit?.moduleCode ?? '';

    let salePrice: number | null = null;
    if (
      amountsVisible &&
      line.amounts &&
      typeof line.amounts.salePrice === 'number' &&
      Number.isFinite(line.amounts.salePrice)
    ) {
      salePrice = line.amounts.salePrice;
    }

    return {
      quoteLineId: line.quoteLineId,
      quantity: line.quantity,
      furnitureInstanceIds: line.furnitureInstanceIds,
      moduleName,
      moduleCode,
      salePrice,
      units,
      isMultiUnit: line.quantity > 1 || units.length > 1,
    };
  });
}

/**
 * Dataset state of the batch commercial summaries request (#642 / 2A).
 * Kept strictly separate from the per-project quoteStatus: an HTTP failure or
 * an in-flight request must never be read as `quoteStatus: 'none'`.
 */
export type CommercialSummariesStatus = 'loading' | 'ready' | 'error';

/**
 * Filter value for the Cotizaciones list screen (#642 / 2A).
 * Canonical QuoteRevision status authority replaces mutable Project.status filtering.
 */
export type QuoteCommercialStatusFilter =
  | 'all'
  | 'draft'
  | 'published'
  | 'accepted'
  | 'superseded'
  | 'none';

export interface QuoteCommercialFilterOption {
  readonly value: QuoteCommercialStatusFilter;
  readonly label: string;
}

export const QUOTE_COMMERCIAL_FILTER_OPTIONS: ReadonlyArray<QuoteCommercialFilterOption> = [
  { value: 'all', label: 'Todas' },
  { value: 'draft', label: 'Borrador' },
  { value: 'published', label: 'Publicada' },
  { value: 'accepted', label: 'Aceptada' },
  { value: 'superseded', label: 'Reemplazada' },
  { value: 'none', label: 'Sin cotización' },
];

export interface CommercialBadgeView {
  readonly label: string;
  readonly modifier: string;
  readonly ariaLabel: string;
}

/**
 * Formats badge presentation data for a project's authoritative commercial revision (#642).
 */
export function formatCommercialSummaryBadge(
  summary?: ProjectCommercialSummary,
): CommercialBadgeView {
  if (!summary || summary.quoteStatus === 'none') {
    return {
      label: 'Sin cotización',
      modifier: 'status-badge--draft',
      ariaLabel: 'Estado comercial: sin cotización',
    };
  }

  const revPrefix =
    summary.quoteRevisionNumber != null ? `Q${summary.quoteRevisionNumber} · ` : '';

  switch (summary.quoteStatus) {
    case 'accepted':
      return {
        label: `${revPrefix}Aceptada`,
        modifier: 'status-badge--accepted',
        ariaLabel: `Estado comercial: Q${summary.quoteRevisionNumber ?? ''} aceptada`,
      };
    case 'published':
      return {
        label: `${revPrefix}Publicada`,
        modifier: 'status-badge--quoted',
        ariaLabel: `Estado comercial: Q${summary.quoteRevisionNumber ?? ''} publicada`,
      };
    case 'draft':
      return {
        label: `${revPrefix}Borrador`,
        modifier: 'status-badge--draft',
        ariaLabel: `Estado comercial: Q${summary.quoteRevisionNumber ?? ''} borrador`,
      };
    case 'superseded':
      return {
        label: `${revPrefix}Reemplazada`,
        modifier: 'status-badge--inactive',
        ariaLabel: `Estado comercial: Q${summary.quoteRevisionNumber ?? ''} reemplazada`,
      };
    default:
      return {
        label: `${revPrefix}${summary.quoteStatus}`,
        modifier: 'status-badge--draft',
        ariaLabel: `Estado comercial: ${summary.quoteStatus}`,
      };
  }
}

/**
 * Filter projects by query and authoritative QuoteRevision commercial status (#642 / 2A).
 *
 * The status filter only applies when the summaries dataset is READY: a failed
 * or in-flight request never classifies projects as `none` (BLOCKER #5 of the
 * 2A review — request error ≠ Sin cotización).
 */
export function filterProjectsByCommercialStatus(
  projects: readonly Project[],
  query: string,
  status: QuoteCommercialStatusFilter,
  customers: readonly Customer[] = [],
  commercialSummaries?: ReadonlyMap<string, ProjectCommercialSummary>,
  summariesStatus: CommercialSummariesStatus = 'ready',
): Project[] {
  const byQuery = filterProjectsByQuery(projects, query, customers);
  if (status === 'all' || summariesStatus !== 'ready') return byQuery;

  // Ready dataset: a project missing from the batch is one with no revision
  // (e.g. just created) — 'none'. Loading/error never reach this branch.
  return byQuery.filter((project) => {
    const summary = commercialSummaries?.get(project.id);
    const quoteStatus = summary?.quoteStatus ?? 'none';
    return quoteStatus === status;
  });
}
