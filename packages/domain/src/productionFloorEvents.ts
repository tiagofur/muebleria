/**
 * Shop-floor transition log (F092, Phase 0 of the sectors/roles plan).
 *
 * Every floor status change must produce one immutable FloorStatusEvent so
 * the workshop can answer who/when/how — the audit trail JD-C3 found
 * missing. `advanceFloorStatus` is the single transition helper: callers
 * that need today's looser semantics (dispatch jumps, arbitrary select)
 * pass `allowJump` and the event records it instead of rejecting.
 */

import type {
  FloorEventSource,
  FloorStatusEvent,
  ItemFloorStatus,
  Project,
} from './types';
import {
  ITEM_FLOOR_STATUSES,
  isItemFloorStatus,
  normalizeItemFloorStatus,
  nextItemFloorStatus,
} from './productionFloor';

function newFloorEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface AdvanceFloorStatusInput {
  readonly projectId: string;
  readonly itemId: string;
  /** Current status of the item (normalized when invalid/missing). */
  readonly current: ItemFloorStatus | undefined;
  /** Explicit target; combined with `advance` like the floor-scan contract. */
  readonly target?: ItemFloorStatus;
  /** Advance to next status when no explicit target. */
  readonly advance?: boolean;
  /**
   * Allow non-adjacent targets (dispatch loading jumps, supervisor
   * corrections). The event records the skip via `note`.
   */
  readonly allowJump?: boolean;
  readonly by?: { readonly userId?: string; readonly name?: string };
  readonly source?: FloorEventSource;
  readonly note?: string;
  readonly now?: string;
  readonly eventId?: string;
}

export type AdvanceFloorStatusResult =
  | {
      readonly ok: true;
      readonly status: ItemFloorStatus;
      /** Null when the transition was a no-op (same status). */
      readonly event: FloorStatusEvent | null;
    }
  | {
      readonly ok: false;
      readonly reason: 'invalid-target' | 'jump-not-allowed' | 'at-end';
    };

/**
 * Unified floor transition. Resolves the next status (target wins over
 * advance), validates the move against the linear pipeline unless
 * `allowJump`, and builds the audit event.
 */
export function advanceFloorStatus(
  input: AdvanceFloorStatusInput,
): AdvanceFloorStatusResult {
  const from = normalizeItemFloorStatus(input.current);
  let to: ItemFloorStatus | null = null;

  if (input.target !== undefined) {
    if (!isItemFloorStatus(input.target)) return { ok: false, reason: 'invalid-target' };
    to = input.target;
  } else if (input.advance) {
    to = nextItemFloorStatus(from);
    if (!to) return { ok: false, reason: 'at-end' };
  } else {
    return { ok: false, reason: 'invalid-target' };
  }

  if (to === from) {
    return { ok: true, status: to, event: null };
  }

  const fromIdx = normalizeIndex(from);
  const toIdx = normalizeIndex(to);
  const isJump = toIdx - fromIdx !== 1;
  if (isJump && !input.allowJump) {
    return { ok: false, reason: 'jump-not-allowed' };
  }

  const event: FloorStatusEvent = {
    id: input.eventId ?? newFloorEventId(),
    projectId: input.projectId,
    itemId: input.itemId,
    from,
    to,
    at: input.now ?? new Date().toISOString(),
    byUserId: input.by?.userId,
    byName: input.by?.name,
    source: input.source ?? 'api',
    note: isJump
      ? buildJumpNote(input.note, from, to)
      : input.note,
  };
  return { ok: true, status: to, event };
}

function normalizeIndex(status: ItemFloorStatus): number {
  const idx = ITEM_FLOOR_STATUSES.indexOf(status);
  return idx < 0 ? 0 : idx;
}

function buildJumpNote(
  note: string | undefined,
  from: ItemFloorStatus,
  to: ItemFloorStatus,
): string {
  const skip = `salto ${from} → ${to}`;
  return note ? `${note} (${skip})` : skip;
}

/**
 * Append an event to a project's floor log (local JSON persistence path).
 * Returns the same project when the event is already present (idempotent
 * by event id — safe for re-syncs).
 */
export function appendFloorEvent(
  project: Project,
  event: FloorStatusEvent,
): Project {
  if (project.floorEvents?.some((e) => e.id === event.id)) return project;
  return {
    ...project,
    floorEvents: [...(project.floorEvents ?? []), event],
  };
}

/** Events for one item, oldest first. */
export function floorTimelineForItem(
  events: readonly FloorStatusEvent[] | undefined,
  itemId: string,
): FloorStatusEvent[] {
  return (events ?? []).filter((e) => e.itemId === itemId);
}

/** Most recent event of a project (any item), or undefined. */
export function latestFloorEvent(
  events: readonly FloorStatusEvent[] | undefined,
): FloorStatusEvent | undefined {
  if (!events || events.length === 0) return undefined;
  return events.reduce((latest, e) => (e.at >= latest.at ? e : latest));
}
