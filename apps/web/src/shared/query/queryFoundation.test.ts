import { describe, expect, it, vi } from 'vitest';
import { GraneteApiError, GraneteNetworkError } from '@granete/storage';
import { createGraneteQueryClient, shouldRetryServerQuery } from './queryClient';
import { normalizeQueryFilters, organizationKeys, platformKeys } from './queryKeys';
import {
  createSessionGeneration,
  sessionScopeFromSession,
  sessionScopeKey,
} from './sessionScope';
import {
  registerTenantMemoryReset,
  registerTenantQueryClient,
  tenantTransition,
} from './tenantTransition';

const sessionDto = {
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'owner@example.test',
    normalized_email: 'owner@example.test',
    name: 'Owner',
    account_status: 'active',
    email_verified_at: '2026-08-30T00:00:00Z',
    last_login_at: '2026-08-30T01:00:00Z',
    platform_admin: false,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-30T01:00:00Z',
  },
  roles: ['admin'],
  memberships: [{
    id: '33333333-3333-4333-8333-333333333333',
    organization_id: '22222222-2222-4222-8222-222222222222',
    user_id: '11111111-1111-4111-8111-111111111111',
    status: 'active',
    roles: ['admin'],
    joined_at: '2026-08-29T00:00:00Z',
    version: 1,
    organization: {
      id: '22222222-2222-4222-8222-222222222222', name: 'Factory', slug: 'factory',
      type: 'factory', status: 'active',
      license: { plan: 'pro', status: 'active', expires_at: null },
    },
  }],
  organization: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Factory',
    slug: 'factory',
    type: 'factory',
    status: 'active',
    license: { plan: 'pro', status: 'active', expires_at: null },
  },
  transport: 'web',
  session_scope: {
    user_id: '11111111-1111-4111-8111-111111111111',
    membership_id: '33333333-3333-4333-8333-333333333333',
    organization_id: '22222222-2222-4222-8222-222222222222',
    mode: 'auth',
    support_session_id: null,
    recovery_session_id: null,
    membership_credential_version: 4,
    organization_credential_version: 7,
    absolute_expires_at: '2026-08-31T00:00:00Z',
  },
} as const;

describe('tenant-safe query foundation (#458)', () => {
  it('projects the query scope only from a generated runtime-validated session DTO', () => {
    const generation = createSessionGeneration();
    const scope = sessionScopeFromSession(sessionDto, generation);

    expect(sessionScopeKey(scope)).toEqual([
      'session',
      generation,
      sessionDto.user.id,
      sessionDto.session_scope.membership_id,
      sessionDto.organization.id,
      'auth',
      null,
      null,
      4,
      7,
      '2026-08-31T00:00:00Z',
      'web',
    ]);
    expect(() => sessionScopeFromSession({ ...sessionDto, transport: 'browser' }, generation))
      .toThrow('Invalid API response');
    expect(() => sessionScopeFromSession({
      ...sessionDto,
      session_scope: { ...sessionDto.session_scope, organization_id: '44444444-4444-4444-8444-444444444444' },
    }, generation)).toThrow('inconsistent session scope');
  });

  it('isolates a new login with the same user, membership, and organization in a different root', () => {
    const first = sessionScopeFromSession(sessionDto, createSessionGeneration());
    const relogin = sessionScopeFromSession(sessionDto, createSessionGeneration());

    expect(organizationKeys.all(relogin)).not.toEqual(organizationKeys.all(first));
    expect(platformKeys.all(relogin)).not.toEqual(platformKeys.all(first));
  });

  it('preserves ordered arrays and normalizes only explicitly set-like fields', () => {
    const setLike = new Set(['status']);
    expect(normalizeQueryFilters({ status: ['suspended', 'active'], search: undefined, page: 1 }, setLike))
      .toEqual(normalizeQueryFilters({ page: 1, status: ['active', 'suspended'] }, setLike));
    expect(normalizeQueryFilters({ sort: ['priority:desc', 'createdAt:asc'] }))
      .not.toEqual(normalizeQueryFilters({ sort: ['createdAt:asc', 'priority:desc'] }));

    const sourceOrder = ['priority:desc', 'createdAt:asc'];
    const normalized = normalizeQueryFilters({ sort: sourceOrder });
    sourceOrder.reverse();
    expect(normalized).toEqual({ sort: ['priority:desc', 'createdAt:asc'] });
  });

  it('retries only one network or explicitly retryable server failure', () => {
    const apiError = (status: number, retryable: boolean) => new GraneteApiError(status, {
      code: 'INTERNAL_ERROR', message: 'failed', fieldErrors: {}, requestId: 'request-1', retryable,
      details: {},
    });
    const networkError = new GraneteNetworkError(new TypeError('Failed to fetch'));

    expect(shouldRetryServerQuery(0, networkError)).toBe(true);
    expect(shouldRetryServerQuery(1, networkError)).toBe(false);
    expect(shouldRetryServerQuery(0, new TypeError('local query bug'))).toBe(false);
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

  it('cancels work before a transition and purges all tenant memory on commit', async () => {
    const queryClient = createGraneteQueryClient();
    const cancel = vi.spyOn(queryClient, 'cancelQueries');
    const clear = vi.spyOn(queryClient, 'clear');
    const reset = vi.fn();
    const unregister = registerTenantQueryClient(queryClient);
    registerTenantMemoryReset(reset);

    await tenantTransition.prepare();
    expect(cancel).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();

    tenantTransition.commit();
    expect(clear).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
    unregister();
    registerTenantMemoryReset(() => undefined);
  });
});
