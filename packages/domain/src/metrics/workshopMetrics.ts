/**
 * Workshop analytics (F090): commercial conversion funnel + post-sale
 * warranty aggregation. Pure functions over Project / WarrantyTicket —
 * the shell computes, the dashboard renders (UI does not calculate domain).
 *
 * Date honesty: `avgDaysToClose` uses createdAt → priceSnapshot.capturedAt
 * (the snapshot is rewritten on every status change, so for won projects it
 * approximates the acceptance date). Periods bucket by creation date.
 */

import type {
  Project,
  ProjectStatus,
  WarrantyTicket,
  WarrantyTicketCategory,
  WarrantyRefabricationPiece,
} from '../types';

export type AnalyticsPeriodDays = 30 | 90 | 365 | 'all';

export const ANALYTICS_PERIODS: readonly {
  readonly value: AnalyticsPeriodDays;
  readonly label: string;
}[] = [
  { value: 30, label: '30 días' },
  { value: 90, label: '90 días' },
  { value: 365, label: '12 meses' },
  { value: 'all', label: 'Todo' },
];

export type CommercialFunnelMetrics = {
  readonly period: AnalyticsPeriodDays;
  /** Projects created within the period, by current status. */
  readonly counts: Readonly<Record<ProjectStatus, number>>;
  /** draft + quoted created in the period. */
  readonly openPipelineCount: number;
  /** Σ salePrice of open-pipeline snapshots (0 when nothing quoted yet). */
  readonly openPipelineValue: number;
  /** accepted + produced created in the period. */
  readonly wonCount: number;
  /**
   * won / (quoted + won): of everything quoted in the period, how much
   * closed. Drafts are excluded (not yet offered). Null when nothing was
   * quoted. There is no `rejected` status in the workflow — reopen goes
   * back to draft.
   */
  readonly quoteToWonRate: number | null;
  /** Mean days createdAt → snapshot.capturedAt for won projects. */
  readonly avgDaysToClose: number | null;
  /** Mean salePrice of won snapshots. */
  readonly avgTicket: number | null;
  /** Open (draft/quoted) untouched for more than stalledAfterDays. */
  readonly stalledCount: number;
  readonly stalledOldestDays: number | null;
};

export type WarrantyPieceIncidence = {
  readonly label: string;
  readonly occurrences: number;
  readonly quantity: number;
  readonly boardM2: number;
};

export type WarrantyAnalyticsMetrics = {
  readonly period: AnalyticsPeriodDays;
  readonly total: number;
  readonly open: number;
  readonly resolved: number;
  readonly byCategory: Readonly<Record<WarrantyTicketCategory, number>>;
  readonly refabricatedPieceCount: number;
  readonly refabricatedBoardM2: number;
  /** Top refabricated pieces by ticket occurrences (max 5). */
  readonly topPieces: readonly WarrantyPieceIncidence[];
  readonly projectsAffected: number;
  /**
   * Σ (salePrice − directCost) of snapshot-backed projects that raised
   * tickets in the period; null when no affected project has a snapshot.
   */
  readonly marginAtRisk: number | null;
};

export type WorkshopAnalytics = {
  readonly funnel: CommercialFunnelMetrics;
  readonly warranties: WarrantyAnalyticsMetrics;
};

const MS_PER_DAY = 86_400_000;
const TOP_PIECES_LIMIT = 5;

function daysBetween(fromIso: string, toMs: number): number {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, (toMs - from) / MS_PER_DAY);
}

/** True when an ISO date falls inside the period window ending at `now`. */
export function withinAnalyticsPeriod(
  isoDate: string | undefined,
  now: Date,
  period: AnalyticsPeriodDays,
): boolean {
  if (!isoDate) return false;
  if (period === 'all') return true;
  const at = Date.parse(isoDate);
  if (Number.isNaN(at)) return false;
  return now.getTime() - at <= period * MS_PER_DAY;
}

const EMPTY_COUNTS: Readonly<Record<ProjectStatus, number>> = {
  draft: 0,
  quoted: 0,
  accepted: 0,
  produced: 0,
};

const EMPTY_CATEGORY_COUNTS: Readonly<Record<WarrantyTicketCategory, number>> = {
  hardware_adjustment: 0,
  damaged_part: 0,
  finishing_defect: 0,
  installation_issue: 0,
  other: 0,
};

export function computeCommercialFunnel(
  projects: readonly Project[],
  opts: {
    readonly now?: Date;
    readonly period?: AnalyticsPeriodDays;
    readonly stalledAfterDays?: number;
  } = {},
): CommercialFunnelMetrics {
  const now = opts.now ?? new Date();
  const period = opts.period ?? 'all';
  const stalledAfterDays = opts.stalledAfterDays ?? 14;
  const inPeriod = projects.filter((p) =>
    withinAnalyticsPeriod(p.createdAt, now, period),
  );

  const counts = { ...EMPTY_COUNTS };
  let openPipelineValue = 0;
  const closeDays: number[] = [];
  const wonPrices: number[] = [];

  for (const p of inPeriod) {
    counts[p.status] += 1;
    const snapshot = p.priceSnapshot;
    if (p.status === 'draft' || p.status === 'quoted') {
      openPipelineValue += snapshot?.breakdown.salePrice ?? 0;
    }
    if (p.status === 'accepted' || p.status === 'produced') {
      if (snapshot) {
        wonPrices.push(snapshot.breakdown.salePrice);
        closeDays.push(daysBetween(p.createdAt, Date.parse(snapshot.capturedAt)));
      }
    }
  }

  const open = inPeriod.filter(
    (p) => p.status === 'draft' || p.status === 'quoted',
  );
  let stalledCount = 0;
  let stalledOldestDays: number | null = null;
  for (const p of open) {
    const idle = daysBetween(p.updatedAt, now.getTime());
    if (idle > stalledAfterDays) {
      stalledCount += 1;
      stalledOldestDays = Math.max(stalledOldestDays ?? 0, idle);
    }
  }

  const wonCount = counts.accepted + counts.produced;
  const quotedOrWon = counts.quoted + wonCount;
  const mean = (xs: readonly number[]) =>
    xs.length === 0
      ? null
      : xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    period,
    counts,
    openPipelineCount: open.length,
    openPipelineValue,
    wonCount,
    quoteToWonRate: quotedOrWon === 0 ? null : wonCount / quotedOrWon,
    avgDaysToClose: mean(closeDays),
    avgTicket: mean(wonPrices),
    stalledCount,
    stalledOldestDays,
  };
}

function pieceBoardM2(piece: WarrantyRefabricationPiece): number {
  const qty = piece.quantity > 0 ? piece.quantity : 1;
  return (piece.lengthMm * piece.widthMm * qty) / 1_000_000;
}

export function computeWarrantyAnalytics(
  tickets: readonly WarrantyTicket[],
  projects: readonly Project[],
  opts: {
    readonly now?: Date;
    readonly period?: AnalyticsPeriodDays;
  } = {},
): WarrantyAnalyticsMetrics {
  const now = opts.now ?? new Date();
  const period = opts.period ?? 'all';
  const inPeriod = tickets.filter((t) =>
    withinAnalyticsPeriod(t.createdAt, now, period),
  );

  const byCategory = { ...EMPTY_CATEGORY_COUNTS };
  let refabricatedPieceCount = 0;
  let refabricatedBoardM2 = 0;
  const affectedProjects = new Set<string>();
  const incidence = new Map<string, WarrantyPieceIncidence & { tickets: Set<string> }>();

  for (const ticket of inPeriod) {
    byCategory[ticket.category] += 1;
    if (ticket.projectId) affectedProjects.add(ticket.projectId);
    for (const piece of ticket.refabricationPieces) {
      refabricatedPieceCount += piece.quantity > 0 ? piece.quantity : 1;
      refabricatedBoardM2 += pieceBoardM2(piece);
      const label = piece.pieceDescription?.trim() || piece.materialName?.trim();
      if (!label) continue;
      const prev = incidence.get(label);
      if (prev) {
        incidence.set(label, {
          label,
          occurrences: prev.occurrences,
          quantity: prev.quantity + (piece.quantity > 0 ? piece.quantity : 1),
          boardM2: prev.boardM2 + pieceBoardM2(piece),
          tickets: prev.tickets.add(ticket.id),
        });
      } else {
        incidence.set(label, {
          label,
          occurrences: 0,
          quantity: piece.quantity > 0 ? piece.quantity : 1,
          boardM2: pieceBoardM2(piece),
          tickets: new Set([ticket.id]),
        });
      }
    }
  }

  const topPieces = [...incidence.values()]
    .map((entry) => ({
      label: entry.label,
      occurrences: entry.tickets.size,
      quantity: entry.quantity,
      boardM2: entry.boardM2,
    }))
    .sort(
      (a, b) =>
        b.occurrences - a.occurrences ||
        b.quantity - a.quantity ||
        a.label.localeCompare(b.label),
    )
    .slice(0, TOP_PIECES_LIMIT);

  let marginAtRisk: number | null = null;
  for (const projectId of affectedProjects) {
    const snapshot = projects.find((p) => p.id === projectId)?.priceSnapshot;
    if (!snapshot) continue;
    const margin = snapshot.breakdown.salePrice - snapshot.breakdown.directCost;
    marginAtRisk = (marginAtRisk ?? 0) + margin;
  }

  const resolved = inPeriod.filter(
    (t) => t.status === 'resolved' || t.status === 'cancelled',
  ).length;

  return {
    period,
    total: inPeriod.length,
    open: inPeriod.length - resolved,
    resolved,
    byCategory,
    refabricatedPieceCount,
    refabricatedBoardM2,
    topPieces,
    projectsAffected: affectedProjects.size,
    marginAtRisk,
  };
}

export function computeWorkshopAnalytics(
  projects: readonly Project[],
  tickets: readonly WarrantyTicket[],
  opts: {
    readonly now?: Date;
    readonly period?: AnalyticsPeriodDays;
    readonly stalledAfterDays?: number;
  } = {},
): WorkshopAnalytics {
  return {
    funnel: computeCommercialFunnel(projects, opts),
    warranties: computeWarrantyAnalytics(tickets, projects, opts),
  };
}
