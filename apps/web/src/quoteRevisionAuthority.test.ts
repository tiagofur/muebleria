/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteRevisionDetail } from '@granete/storage';
import { selectCommercialQuoteRevision, useQuoteRevisionAuthority } from './quoteRevisionAuthority';
import { __resetWebAuthClientForTests, configureWebAuthClient } from './webAuthClient';
import { __resetWebAuthRuntimeForTests, applyWebCredential } from './webAuthRuntime';
import {
  __setWebSessionLockBackendForTests,
  createInMemoryWebSessionLockBackendForTests,
} from './webSessionLock';

const BASE = 'http://api.test/api';
const PROJECT = 'project-1';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function revision(revisionNumber: number, status: QuoteRevisionDetail['status']): QuoteRevisionDetail {
  return {
    id: `00000000-0000-4000-8000-${String(revisionNumber).padStart(12, '0')}`,
    projectId: '10000000-0000-4000-8000-000000000001',
    revisionNumber,
    status,
    sourceType: 'manual',
    createdAt: '2026-09-10T12:00:00Z',
    items: [],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function refreshBody() {
  return {
    token: 'access-NEW',
    session_id: 'session-1',
    access_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    absolute_session_expires_at: new Date(Date.now() + 18 * 60 * 60_000).toISOString(),
    user: { id: 'user-1' },
    organization: { id: 'org-1' },
  };
}

beforeEach(() => {
  __resetWebAuthRuntimeForTests();
  __resetWebAuthClientForTests();
  __setWebSessionLockBackendForTests(createInMemoryWebSessionLockBackendForTests());
  applyWebCredential({
    accessToken: 'access-OLD',
    accessExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    absoluteSessionExpiresAt: new Date(Date.now() + 18 * 60 * 60_000).toISOString(),
    sessionId: 'session-1',
    userId: 'user-1',
    organizationId: 'org-1',
  });
});

afterEach(() => {
  __resetWebAuthRuntimeForTests();
  __resetWebAuthClientForTests();
  __setWebSessionLockBackendForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generated quote client through the production React query', () => {
  it('returns the final quote body after a recoverable 401 without a manual reload', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
      if (url.endsWith('/auth/refresh')) return json(refreshBody());
      if (url === `${BASE}/projects/${PROJECT}/quote-revisions`) {
        return calls.filter((call) => call.url === url).length === 1
          ? json({ code: 'UNAUTHORIZED', message: 'invalid token' }, 401)
          : json([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    configureWebAuthClient({ baseUrl: BASE, fetchImpl: fetchImpl as typeof fetch });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div');
    const root = createRoot(container);
    function Probe() {
      const result = useQuoteRevisionAuthority({
        baseUrl: BASE,
        token: 'access-OLD',
        projectId: PROJECT,
        queryKey: ['quote-authority', PROJECT],
      });
      return createElement('output', null, `${result.authority.kind}:${result.revisions.length}`);
    }

    try {
      await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
      await vi.waitFor(() => expect(container.textContent).toBe('empty:0'));
      expect(calls).toEqual([
        { url: `${BASE}/projects/${PROJECT}/quote-revisions`, authorization: 'Bearer access-OLD' },
        { url: `${BASE}/auth/refresh`, authorization: null },
        { url: `${BASE}/projects/${PROJECT}/quote-revisions`, authorization: 'Bearer access-NEW' },
      ]);
    } finally {
      act(() => root.unmount());
      client.clear();
    }
  });
});

describe('selectCommercialQuoteRevision', () => {
  it('selects the accepted revision instead of a newer draft', () => {
    expect(
      selectCommercialQuoteRevision([
        revision(1, 'superseded'),
        revision(2, 'accepted'),
        revision(3, 'draft'),
      ])?.revisionNumber,
    ).toBe(2);
  });

  it('selects the newest exact revision when none is accepted', () => {
    expect(
      selectCommercialQuoteRevision([revision(2, 'draft'), revision(1, 'published')])
        ?.revisionNumber,
    ).toBe(2);
  });
});
