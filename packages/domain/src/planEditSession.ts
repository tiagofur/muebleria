/**
 * Soft lock for Proyectar (kitchen plan) multi-user collaboration.
 * Not real-time OT — prevents silent overwrite when another user has the plan open.
 */

import type { ProjectPlanEditSession } from './types';

/** How long a plan edit session stays valid without renew. */
export const PLAN_EDIT_SESSION_TTL_MS = 2 * 60 * 1000;

export type PlanEditActor = {
  readonly userId: string;
  readonly userName: string;
};

export function isPlanEditSessionExpired(
  session: ProjectPlanEditSession | undefined | null,
  nowMs: number = Date.now(),
): boolean {
  if (!session?.expiresAt) return true;
  const exp = Date.parse(session.expiresAt);
  if (!Number.isFinite(exp)) return true;
  return exp <= nowMs;
}

/** True when another user holds a non-expired session. */
export function planEditSessionHeldByOther(
  session: ProjectPlanEditSession | undefined | null,
  actorUserId: string,
  nowMs: number = Date.now(),
): boolean {
  if (!session || isPlanEditSessionExpired(session, nowMs)) return false;
  return session.userId.trim() !== '' && session.userId !== actorUserId;
}

/**
 * Try to acquire (or re-acquire own) edit session.
 * Returns null if another user holds a live session.
 */
export function acquirePlanEditSession(
  current: ProjectPlanEditSession | undefined | null,
  actor: PlanEditActor,
  nowMs: number = Date.now(),
  ttlMs: number = PLAN_EDIT_SESSION_TTL_MS,
): ProjectPlanEditSession | null {
  if (planEditSessionHeldByOther(current, actor.userId, nowMs)) {
    return null;
  }
  return {
    userId: actor.userId,
    userName: actor.userName.trim() || 'Usuario',
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
}

/**
 * Renew only if this actor currently holds the session (or it expired).
 * Returns null if held by another user.
 */
export function renewPlanEditSession(
  current: ProjectPlanEditSession | undefined | null,
  actor: PlanEditActor,
  nowMs: number = Date.now(),
  ttlMs: number = PLAN_EDIT_SESSION_TTL_MS,
): ProjectPlanEditSession | null {
  if (planEditSessionHeldByOther(current, actor.userId, nowMs)) {
    return null;
  }
  // Only renew if we own it or free.
  if (
    current &&
    !isPlanEditSessionExpired(current, nowMs) &&
    current.userId !== actor.userId
  ) {
    return null;
  }
  return {
    userId: actor.userId,
    userName: actor.userName.trim() || current?.userName || 'Usuario',
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
}

/**
 * Release only if held by this actor. Otherwise leave unchanged.
 * Returns undefined when cleared, or the foreign session if not ours.
 */
export function releasePlanEditSession(
  current: ProjectPlanEditSession | undefined | null,
  actorUserId: string,
  nowMs: number = Date.now(),
): ProjectPlanEditSession | undefined {
  if (!current || isPlanEditSessionExpired(current, nowMs)) {
    return undefined;
  }
  if (current.userId !== actorUserId) {
    return current;
  }
  return undefined;
}
