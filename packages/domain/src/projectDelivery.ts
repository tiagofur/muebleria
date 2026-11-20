/**
 * #1648 — committed delivery date: derived delivery status for lists, boards
 * and the dashboard. The committed date is a server-authored fact
 * (`project.committedDeliveryDate`); the ACTUAL delivery comes only from the
 * delivery milestones in the lifecycle log, never from the committed date or
 * createdAt. Estimated dates do not exist yet: a project without commitment is
 * `none`, not "on time".
 */
import type { Project } from './types';
import type { ProjectEvent, ProjectEventType } from './projectLifecycle';

/** Lifecycle events that mean the order reached the customer. */
export const DELIVERY_DONE_EVENT_TYPES: readonly ProjectEventType[] = [
  'installation_completed',
  'client_signed_off',
  'project_closed',
];

/** Days ahead that count as "vence esta semana". */
export const DELIVERY_DUE_SOON_DAYS = 7;

export type DeliveryStatus = 'none' | 'on_track' | 'due_soon' | 'overdue' | 'delivered' | 'closed';

export interface DeliveryInfo {
  readonly status: DeliveryStatus;
  /** Committed date (YYYY-MM-DD) when present. */
  readonly committedDate?: string;
  /** Actual delivery timestamp from the lifecycle log, when delivered. */
  readonly deliveredAt?: string;
  /** Days until the committed date (negative = days late). */
  readonly daysToCommitted?: number;
}

export const DELIVERY_STATUS_LABELS_ES: Readonly<Record<DeliveryStatus, string>> = {
  none: 'Sin fecha comprometida',
  on_track: 'En fecha',
  due_soon: 'Vence esta semana',
  overdue: 'Atrasado',
  delivered: 'Entregado',
  closed: 'Sin entrega',
};

/** Local calendar date (YYYY-MM-DD) of an instant. */
export function localIsoDate(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayNumber(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/**
 * First delivery milestone in the lifecycle log, if any. `project_closed`
 * only counts when the order was not lost or cancelled: closing a cancelled
 * order is administrative, not a delivery.
 */
export function actualDeliveryEvent(
  events: readonly ProjectEvent[] | undefined,
  options: { readonly excludeProjectClosed?: boolean } = {},
): ProjectEvent | undefined {
  let first: ProjectEvent | undefined;
  for (const ev of events ?? []) {
    if (!DELIVERY_DONE_EVENT_TYPES.includes(ev.type)) continue;
    if (options.excludeProjectClosed && ev.type === 'project_closed') continue;
    if (!first || ev.at < first.at) first = ev;
  }
  return first;
}

/**
 * Delivery status of a project on a given local day (`today` YYYY-MM-DD).
 * Overdue = committed date before today and no delivery milestone.
 */
export function projectDeliveryInfo(
  project: Pick<Project, 'committedDeliveryDate' | 'commercialStatus'> & { readonly events?: readonly ProjectEvent[] },
  today: string,
): DeliveryInfo {
  const committedDate = project.committedDeliveryDate || undefined;
  const closedCommercially = project.commercialStatus === 'lost' || project.commercialStatus === 'cancelled';
  const delivered = actualDeliveryEvent(project.events, { excludeProjectClosed: closedCommercially });
  if (delivered) return { status: 'delivered', committedDate, deliveredAt: delivered.at };
  if (closedCommercially) return { status: 'closed', committedDate };
  if (!committedDate) return { status: 'none' };
  const due = dayNumber(committedDate);
  const now = dayNumber(today);
  if (due === null || now === null) return { status: 'none' };
  const daysToCommitted = due - now;
  if (daysToCommitted < 0) return { status: 'overdue', committedDate, daysToCommitted };
  if (daysToCommitted <= DELIVERY_DUE_SOON_DAYS) return { status: 'due_soon', committedDate, daysToCommitted };
  return { status: 'on_track', committedDate, daysToCommitted };
}

/** True when the order needs attention: late or due within the week. */
export function isDeliveryAttention(info: DeliveryInfo): boolean {
  return info.status === 'overdue' || info.status === 'due_soon';
}

/** Late and due-this-week counts for the dashboard (#1648 scope item 4). */
export interface DeliveryRiskSummary {
  readonly overdue: number;
  readonly dueSoon: number;
  /** Open orders with a committed date (not delivered, not lost/cancelled). */
  readonly tracked: number;
}

export function summarizeDeliveryRisk(
  projects: readonly (Pick<Project, 'committedDeliveryDate' | 'commercialStatus'> & {
    readonly events?: readonly ProjectEvent[];
  })[],
  today: string,
): DeliveryRiskSummary {
  let overdue = 0;
  let dueSoon = 0;
  let tracked = 0;
  for (const project of projects) {
    const { status } = projectDeliveryInfo(project, today);
    if (status === 'overdue') overdue += 1;
    else if (status === 'due_soon') dueSoon += 1;
    if (status === 'overdue' || status === 'due_soon' || status === 'on_track') tracked += 1;
  }
  return { overdue, dueSoon, tracked };
}

/** Comparator: earliest committed date first; projects without date last. */
export function compareByCommittedDelivery(
  a: Pick<Project, 'committedDeliveryDate'>,
  b: Pick<Project, 'committedDeliveryDate'>,
): number {
  const da = a.committedDeliveryDate || '';
  const db = b.committedDeliveryDate || '';
  if (da === db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da < db ? -1 : 1;
}

/** Spanish short copy for the days-to-committed figure. */
export function deliveryDaysLabelEs(info: DeliveryInfo): string {
  const d = info.daysToCommitted;
  if (d === undefined) return DELIVERY_STATUS_LABELS_ES[info.status];
  if (d < 0) return d === -1 ? 'Atrasado 1 día' : `Atrasado ${-d} días`;
  if (d === 0) return 'Vence hoy';
  if (d === 1) return 'Vence mañana';
  return `Faltan ${d} días`;
}

/** Command input for the server-authored delivery commitment. */
export interface DeliveryCommitmentInput {
  readonly date: string;
  /** Required by the server when changing an existing commitment. */
  readonly reason?: string;
}

/** Server outcome of the delivery commitment command. */
export interface DeliveryCommitmentOutcome {
  readonly committedDeliveryDate: string;
  readonly previousDate?: string;
  readonly event: ProjectEvent;
}
