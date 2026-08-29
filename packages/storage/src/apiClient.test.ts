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
    const error = await new GraneteApiClient('http://api.test', fetchImpl).me('token').catch((value: unknown) => value);
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
