import { describe, expect, it, vi } from 'vitest';
import { GraneteApiClient } from './apiClient';

/**
 * #1049 regression guard: list/set ride the COLLECTION path
 * `/catalog/components/{id}/side-assignments` (the routes the backend serves
 * with GET/PUT); only remove carries `{side}`. The generated client once
 * emitted the raw `{side}` placeholder for list/set and every web save 405'd.
 */

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

const assignment = { componentId: 'c1', side: 'left' as const, profileId: 'p1' };

describe('GraneteApiClient component side assignments (#1049)', () => {
  it('lists assignments from the collection path', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json([assignment]));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    await expect(client.listComponentSideAssignments('token', 'c1')).resolves.toEqual([assignment]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://api.test/catalog/components/c1/side-assignments');
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('sets one assignment on the collection path', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(assignment));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    await expect(client.setComponentSideAssignment('token', 'c1', { side: 'left', profileId: 'p1' }))
      .resolves.toEqual(assignment);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://api.test/catalog/components/c1/side-assignments');
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('PUT');
  });

  it('removes one side from the item path', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ status: 'removed' }));
    const client = new GraneteApiClient('http://api.test', fetchImpl);
    await expect(client.removeComponentSideAssignment('token', 'c1', 'left'))
      .resolves.toEqual({ status: 'removed' });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://api.test/catalog/components/c1/side-assignments/left');
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });
});
