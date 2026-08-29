import { describe, expect, it, vi } from 'vitest';
import { GraneteApiClient } from './apiClient';
import { GraneteApiError } from './apiErrors';

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('GraneteApiClient generated runtime boundary (#448)', () => {
  it('rejects invalid JSON instead of accepting a cast', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json([{ user_id: 'u1' }]));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    await expect(client.listTeam('token')).rejects.toThrow('Invalid API response');
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
    const error = await client.updateMemberActive('token','u1',3,{active:false}).catch((value: unknown) => value);
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
      user_id: 'u1', roles: ['admin'], active: true, version: 5,
    }));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    await client.updateMemberRoles('token','u1',4,{roles:['admin']});
    const init = fetchImpl.mock.calls[0]![1]!;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer token');
    expect(headers.get('If-Match')).toBe('"v4"');
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
      active: true, created_at: '2026-08-28T00:00:00Z', memberships: [{
        organization_id: 'org1', organization_name: 'Factory One', organization_slug: 'factory-one',
        roles: ['admin'], active: true, version: 2,
      }],
    }]));
    const users = await new GraneteApiClient('http://api.test', fetchImpl).listPlatformUsers('token');
    expect(users[0]?.memberships[0]?.organization_name).toBe('Factory One');

    fetchImpl.mockResolvedValueOnce(json([{
      id: 'u1', email: 'owner@example.test', name: 'Owner', platform_admin: false,
      active: true, created_at: '2026-08-28T00:00:00Z',
      memberships: [{ organization: { id: 'org1', name: 'legacy' }, roles: ['admin'] }],
    }]));
    await expect(new GraneteApiClient('http://api.test', fetchImpl).listPlatformUsers('token')).rejects.toThrow('Invalid API response');
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
