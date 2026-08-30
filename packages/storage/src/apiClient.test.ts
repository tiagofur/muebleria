import { describe, expect, it, vi } from 'vitest';
import { GraneteApiClient } from './apiClient';
import { GraneteApiError } from './apiErrors';

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('GraneteApiClient generated runtime boundary (#448)', () => {
  it('rejects invalid JSON instead of accepting a cast', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json([{ user_id: 'u1' }]));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    await expect(client.listMemberships('token')).rejects.toThrow('Invalid API response');
  });

  it('decodes the generated Team directory and summary read models', async () => {
    const member = {
      membership_id: '11111111-1111-1111-1111-111111111111', user_id: '22222222-2222-2222-2222-222222222222',
      email: 'team@example.test', name: 'Team Member', account_status: 'active', membership_status: 'active',
      roles: ['vendedor'], sectors: [], offboarding_blocking_count: 0,
      joined_at: '2026-08-29T00:00:00Z', version: 2, last_activity: '2026-08-30T00:00:00Z',
      credential_version: 2, sessions_revoked_at: '2026-08-30T01:00:00Z',
    };
    const summary = {
      active_members: 1, suspended_members: 0, left_members: 0, max_active_members: null,
      team_version: 3, entitlements_version: 4, capabilities: ['team:view', 'team:manage:sales'],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ items: [member], summary }))
      .mockResolvedValueOnce(json(summary));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    const directory = await client.listMemberships('token');
    expect(directory.items[0]?.email).toBe('team@example.test');
    expect(directory.summary.max_active_members).toBeNull();
    expect((await client.getTeamSummary('token')).capabilities).toContain('team:manage:sales');
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'http://api.test/org/memberships', 'http://api.test/org/team/summary',
    ]);
  });

  it('enforces generated minimum and date-time constraints', async () => {
    const organization = {
      id: 'org1', name: 'Factory', slug: 'factory', type: 'factory', license_plan: 'none',
      active: true, member_count: 0, created_at: '2026-08-28T00:00:00Z',
      updated_at: '2026-08-28T00:00:00Z', version: 1,
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json([{ ...organization, version: 0 }]));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    await expect(client.listPlatformOrganizations('token')).rejects.toThrow('minimum 1');

    fetchImpl.mockResolvedValueOnce(json([{ ...organization, created_at: 'not-a-date' }]));
    await expect(client.listPlatformOrganizations('token')).rejects.toThrow('date-time');
  });

  it('rejects unknown generated request properties before fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    await expect(client.login({
      email: 'user@example.test', password: 'secret123', transport: 'mobile', unexpected: true,
    } as never)).rejects.toThrow('no additional property');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses structured error code independently of localized message', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({
      code: 'MEMBERSHIP_VERSION_CONFLICT', message: 'texto que puede cambiar', fieldErrors: {},
      requestId: 'request-448-error', retryable: false, details: {},
    }, 412));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    const error = await client.updateMembershipStatus('token', 'membership-1', 3, {
      status: 'suspended',
    }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GraneteApiError);
    expect((error as GraneteApiError).code).toBe('MEMBERSHIP_VERSION_CONFLICT');
    expect((error as GraneteApiError).requestId).toBe('request-448-error');
  });

  it('preserves the response request ID when an upstream error envelope is invalid', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json', {
      status: 502, headers: { 'X-Request-ID': 'request-upstream-448' },
    }));
    const error = await new GraneteApiClient('http://api.test', fetchImpl).getSession('token').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GraneteApiError);
    expect((error as GraneteApiError).requestId).toBe('request-upstream-448');
    expect((error as GraneteApiError).retryable).toBe(true);
  });

  it('centralizes auth, request ID, If-Match and idempotency headers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({
      membership_id: 'membership-1', user_id: 'u1', roles: ['admin'], status: 'active', version: 5,
    }));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    await client.updateMembershipRoles('token', 'membership-1', 4, { roles: ['admin'] });
    const init = fetchImpl.mock.calls[0]![1]!;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer token');
    expect(headers.get('If-Match')).toBe('"v4"');
    expect(headers.get('Idempotency-Key')).toMatch(/^web:/);
    expect(headers.get('X-Request-ID')).toBeTruthy();
  });

  it('rejects non-string fieldErrors values from an error envelope', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({
      code: 'BAD_REQUEST', message: 'invalid', fieldErrors: { email: 123 },
      requestId: 'request-invalid-fields', retryable: false, details: {},
    }, 400));
    const error = await new GraneteApiClient('http://api.test', fetchImpl).getSession('token').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GraneteApiError);
    expect((error as GraneteApiError).code).toBe('INTERNAL_ERROR');
    expect((error as GraneteApiError).payload.details).toEqual({ invalidEnvelope: true });
  });

  it('locks Platform users to the flattened membership contract emitted by Go', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json([{
      id: 'u1', email: 'owner@example.test', name: 'Owner', platform_admin: false,
      account_status: 'active', created_at: '2026-08-28T00:00:00Z', memberships: [{
        organization_id: 'org1', organization_name: 'Factory One', organization_slug: 'factory-one',
        roles: ['admin'], status: 'active', version: 2,
      }],
    }]));
    const users = await new GraneteApiClient('http://api.test', fetchImpl).listPlatformUsers('token');
    expect(users[0]?.memberships[0]?.organization_name).toBe('Factory One');

    fetchImpl.mockResolvedValueOnce(json([{
      id: 'u1', email: 'owner@example.test', name: 'Owner', platform_admin: false,
      account_status: 'active', created_at: '2026-08-28T00:00:00Z',
      memberships: [{ organization: { id: 'org1', name: 'legacy' }, roles: ['admin'] }],
    }]));
    await expect(new GraneteApiClient('http://api.test', fetchImpl).listPlatformUsers('token')).rejects.toThrow('Invalid API response');
  });

  it('uses the generated idempotent Platform command for global account lifecycle', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({
      user_id: 'user-1', account_status: 'disabled', updated_at: '2026-08-29T00:00:00Z',
    }));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    const result = await client.setPlatformUserAccountStatus(
      'platform-token',
      'user-1',
      { account_status: 'disabled', reason: 'Security review' },
      'platform-account-450',
    );
    expect(result.account_status).toBe('disabled');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'http://api.test/platform/users/user-1:set-account-status',
    );
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer platform-token');
    expect(headers.get('Idempotency-Key')).toBe('platform-account-450');

    const invalidFetch = vi.fn<typeof fetch>();
    await expect(new GraneteApiClient('http://api.test', invalidFetch).setPlatformUserAccountStatus(
      'platform-token',
      'user-1',
      { account_status: 'suspended', reason: 'Invalid account state' } as never,
    )).rejects.toThrow('active | disabled');
    expect(invalidFetch).not.toHaveBeenCalled();
  });

  it('accepts canonical membership lifecycle shapes and rejects boolean legacy status fields', async () => {
    const member = {
      membership_id: 'membership-1', user_id: 'user-1', email: 'owner@example.test', name: 'Owner',
      account_status: 'active', membership_status: 'suspended', roles: ['admin'],
      sectors: [], offboarding_blocking_count: 0, joined_at: '2026-08-28T00:00:00Z', version: 2,
      last_activity: null, credential_version: 1, sessions_revoked_at: null,
    };
    const summary = {
      active_members: 0, suspended_members: 1, left_members: 0, max_active_members: null,
      team_version: 1, entitlements_version: 1, capabilities: ['team:view'],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ items: [member], summary }));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    const members = await client.listMemberships('token');
    expect(members.items[0]?.membership_status).toBe('suspended');

    fetchImpl.mockResolvedValueOnce(json({ items: [{
      ...member,
      account_status: undefined,
      membership_status: undefined,
      account_active: true,
      membership_active: false,
    }], summary }));
    await expect(client.listMemberships('token')).rejects.toThrow('Invalid API response');
  });

  it('keeps invitation lifecycle metadata typed and rejects persisted token hashes', async () => {
    const invitation = {
      id: 'invitation-1', organization_id: 'organization-1', email: 'invitee@example.test',
      status: 'pending', roles: ['operator'], expires_at: '2026-08-30T00:00:00Z',
      created_at: '2026-08-29T00:00:00Z', invited_by: 'user-1', accepted_at: null,
      accepted_by: null, revoked_at: null, revoked_by: null, revoked_reason: null, version: 1,
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json([invitation]));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    const invitations = await client.listInvitations('token');
    expect(invitations[0]?.status).toBe('pending');

    fetchImpl.mockResolvedValueOnce(json([{ ...invitation, status: 'delivered' }]));
    await expect(client.listInvitations('token')).resolves.toMatchObject([{ status: 'delivered' }]);
    fetchImpl.mockResolvedValueOnce(json([{ ...invitation, status: 'opened' }]));
    await expect(client.listInvitations('token')).resolves.toMatchObject([{ status: 'opened' }]);

    fetchImpl.mockResolvedValueOnce(json([{ ...invitation, token_hash: 'must-never-cross-api' }]));
    await expect(client.listInvitations('token')).rejects.toThrow('Invalid API response');
    fetchImpl.mockResolvedValueOnce(json([{ ...invitation, status: 'sent' }]));
    await expect(client.listInvitations('token')).rejects.toThrow(
      'pending | delivered | opened | accepted | expired | revoked',
    );
  });

  it('locks audit events to ip/details and rejects legacy ip_address/metadata', async () => {
    const clientFor = (event: unknown) => new GraneteApiClient(
      'http://api.test', vi.fn<typeof fetch>().mockResolvedValue(json([event])),
    );
    const current = {
      id: 'a1', event_type: 'support_session_started', ip: '127.0.0.1',
      details: { request_id: 'request-448-audit' }, created_at: '2026-08-28T00:00:00Z',
    };
    const events = await clientFor(current).listSecurityAudit('token', 'org1');
    expect(events[0]?.details.request_id).toBe('request-448-audit');
    await expect(clientFor({ ...current, ip: undefined, details: undefined, ip_address: '127.0.0.1', metadata: {} })
      .listSecurityAudit('token', 'org1')).rejects.toThrow('Invalid API response');
  });
});
