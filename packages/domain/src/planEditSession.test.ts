import { describe, expect, it } from 'vitest';
import {
  acquirePlanEditSession,
  isPlanEditSessionExpired,
  planEditSessionHeldByOther,
  releasePlanEditSession,
  renewPlanEditSession,
  PLAN_EDIT_SESSION_TTL_MS,
} from './planEditSession';

const actorA = { userId: 'u-a', userName: 'Ana' };
const actorB = { userId: 'u-b', userName: 'Beto' };

describe('planEditSession', () => {
  it('acquires free session', () => {
    const now = 1_000_000;
    const s = acquirePlanEditSession(undefined, actorA, now, 60_000);
    expect(s).not.toBeNull();
    expect(s!.userId).toBe('u-a');
    expect(Date.parse(s!.expiresAt)).toBe(now + 60_000);
  });

  it('blocks acquire when other holds live session', () => {
    const now = 1_000_000;
    const held = {
      userId: 'u-a',
      userName: 'Ana',
      expiresAt: new Date(now + 30_000).toISOString(),
    };
    expect(planEditSessionHeldByOther(held, 'u-b', now)).toBe(true);
    expect(acquirePlanEditSession(held, actorB, now)).toBeNull();
  });

  it('allows acquire after expiry', () => {
    const now = 1_000_000;
    const expired = {
      userId: 'u-a',
      userName: 'Ana',
      expiresAt: new Date(now - 1).toISOString(),
    };
    expect(isPlanEditSessionExpired(expired, now)).toBe(true);
    const s = acquirePlanEditSession(expired, actorB, now);
    expect(s!.userId).toBe('u-b');
  });

  it('renews only for owner', () => {
    const now = 1_000_000;
    const held = {
      userId: 'u-a',
      userName: 'Ana',
      expiresAt: new Date(now + 10_000).toISOString(),
    };
    expect(renewPlanEditSession(held, actorB, now)).toBeNull();
    const next = renewPlanEditSession(held, actorA, now, PLAN_EDIT_SESSION_TTL_MS);
    expect(next!.userId).toBe('u-a');
    expect(Date.parse(next!.expiresAt)).toBe(now + PLAN_EDIT_SESSION_TTL_MS);
  });

  it('release only clears own session', () => {
    const now = 1_000_000;
    const held = {
      userId: 'u-a',
      userName: 'Ana',
      expiresAt: new Date(now + 10_000).toISOString(),
    };
    expect(releasePlanEditSession(held, 'u-b', now)).toEqual(held);
    expect(releasePlanEditSession(held, 'u-a', now)).toBeUndefined();
  });
});
