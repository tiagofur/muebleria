import { describe, expect, it, vi } from 'vitest';

import {
  estimateStatus,
  fetchProjectBreakdown,
  quoteLessProjects,
} from './useProjectsServerEstimates';
import type { Project, QuoteBreakdown } from '@granete/domain';

const project = (overrides: Partial<Project> & { id: string }): Project =>
  ({
    name: 'P',
    customerId: 'C',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    quantity: 1,
    items: [],
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
    ...overrides,
  }) as Project;

const breakdown = (salePrice: number): QuoteBreakdown =>
  ({
    materialsCost: 0,
    edgeTotal: 0,
    hardwareTotal: 0,
    directCost: 0,
    laborModular: 0,
    laborFixedCost: 0,
    marginFactor: 1,
    salePrice,
  }) as QuoteBreakdown;

describe('quoteLessProjects', () => {
  it('only targets projects without a frozen snapshot', () => {
    const frozen = project({ id: 'frozen', priceSnapshot: { breakdown: breakdown(10) } as Project['priceSnapshot'] });
    const draft = project({ id: 'draft' });
    expect(quoteLessProjects([frozen, draft]).map((p) => p.id)).toEqual(['draft']);
  });
});

describe('estimateStatus', () => {
  it('maps failure counts honestly', () => {
    expect(estimateStatus(0, 3)).toBe('ready');
    expect(estimateStatus(1, 3)).toBe('partial-error');
    expect(estimateStatus(3, 3)).toBe('error');
  });
});

describe('fetchProjectBreakdown', () => {
  it('maps the served JSON through breakdownFromApi', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(breakdown(400)), { status: 200 })),
    );
    const result = await fetchProjectBreakdown(
      'http://api.test',
      'token-1',
      'draft-1',
      fetchImpl as unknown as typeof fetch,
      new AbortController().signal,
    );
    expect(result.salePrice).toBe(400);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('http://api.test/projects/draft-1/calculate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('throws on non-ok responses (caller falls back to the local estimate)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('boom', { status: 500 })));
    await expect(
      fetchProjectBreakdown(
        'http://api.test',
        'token-1',
        'broken',
        fetchImpl as unknown as typeof fetch,
        new AbortController().signal,
      ),
    ).rejects.toThrow('HTTP 500');
  });
});
