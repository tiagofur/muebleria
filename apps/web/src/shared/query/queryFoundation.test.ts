import { describe, expect, it } from 'vitest';
import { GraneteApiError } from '@granete/storage';
import { createGraneteQueryClient, shouldRetryServerQuery } from './queryClient';
import { normalizeQueryFilters, organizationKeys, platformKeys } from './queryKeys';
import { sessionScopeKey, type SessionScope } from './sessionScope';

const scope: SessionScope = {
  userId: 'user-1',
  membershipId: 'membership-1',
  organizationId: 'organization-1',
  mode: 'auth',
  supportSessionId: null,
  recoverySessionId: null,
  membershipCredentialVersion: 4,
  organizationCredentialVersion: 7,
  absoluteExpiresAt: '2026-08-31T00:00:00Z',
};

describe('tenant-safe query foundation (#458)', () => {
  it('isolates cache keys by the complete authoritative session scope', () => {
    const baseline = sessionScopeKey(scope);
    const variants: SessionScope[] = [
      { ...scope, userId: 'user-2' },
      { ...scope, organizationId: 'organization-2' },
      { ...scope, mode: 'support', supportSessionId: 'support-1' },
      { ...scope, membershipCredentialVersion: 5 },
      { ...scope, organizationCredentialVersion: 8 },
      { ...scope, absoluteExpiresAt: '2026-08-31T01:00:00Z' },
    ];

    for (const variant of variants) expect(sessionScopeKey(variant)).not.toEqual(baseline);
    expect(organizationKeys.team(scope)).toContain('organization-1');
    expect(platformKeys.users(scope)).toContain('user-1');
  });

  it('normalizes filter order and omits undefined values', () => {
    expect(normalizeQueryFilters({ status: ['suspended', 'active'], search: undefined, page: 1 }))
      .toEqual(normalizeQueryFilters({ page: 1, status: ['active', 'suspended'] }));
  });

  it('retries only one network or explicitly retryable server failure', () => {
    const apiError = (status: number, retryable: boolean) => new GraneteApiError(status, {
      code: 'INTERNAL_ERROR', message: 'failed', fieldErrors: {}, requestId: 'request-1', retryable,
      details: {},
    });

    expect(shouldRetryServerQuery(0, new TypeError('network'))).toBe(true);
    expect(shouldRetryServerQuery(1, new TypeError('network'))).toBe(false);
    expect(shouldRetryServerQuery(0, apiError(503, true))).toBe(true);
    expect(shouldRetryServerQuery(0, apiError(503, false))).toBe(false);
    expect(shouldRetryServerQuery(0, apiError(409, true))).toBe(false);
    expect(shouldRetryServerQuery(0, new DOMException('cancelled', 'AbortError'))).toBe(false);
  });

  it('creates a non-persisted per-tab client with bounded defaults', () => {
    const first = createGraneteQueryClient();
    const second = createGraneteQueryClient();
    expect(first).not.toBe(second);
    expect(first.getDefaultOptions().queries).toMatchObject({
      staleTime: 15_000,
      gcTime: 300_000,
      refetchOnWindowFocus: true,
    });
    expect(first.getDefaultOptions().mutations?.retry).toBe(false);
  });
});
