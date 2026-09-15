import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  engineeringReleaseQueryKey,
  fetchEngineeringReleaseContext,
} from './engineeringReleaseContext';

const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const RELEASE_ID = '20000000-0000-4000-8000-000000000002';
const Q1_ID = '30000000-0000-4000-8000-000000000003';

function stubFetch(handler: (url: string) => { status: number; body: unknown } | undefined) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const routed = handler(url);
    if (routed) {
      return new Response(JSON.stringify(routed.body), {
        status: routed.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchEngineeringReleaseContext (#738)', () => {
  it('resolves the exact release and its quote label from authoritative reads', async () => {
    stubFetch((url) => {
      if (url.endsWith(`/projects/${PROJECT_ID}/production-releases/${RELEASE_ID}`)) {
        return {
          status: 200,
          body: {
            id: RELEASE_ID,
            project_id: PROJECT_ID,
            release_number: 1,
            design_id: 'd-1',
            design_revision_id: 'dr-1',
            design_revision_number: 1,
            quote_revision_id: Q1_ID,
            manufacturing_fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            status: 'active',
            released_by: 'u-1',
            released_at: '2026-09-15T10:00:00Z',
            staleness: { manufacturing_stale: false, current_design_revision_id: null, current_design_revision_number: null },
          },
        };
      }
      if (url.endsWith(`/projects/${PROJECT_ID}/quote-revisions`)) {
        return {
          status: 200,
          body: [{ id: Q1_ID, projectId: PROJECT_ID, revisionNumber: 1, status: 'accepted', sourceType: 'manual', createdAt: '2026-09-15T09:00:00Z', items: [] }],
        };
      }
      return undefined;
    });
    const result = await fetchEngineeringReleaseContext({
      baseUrl: 'http://api.test',
      token: 'token-1',
      projectId: PROJECT_ID,
      releaseId: RELEASE_ID,
    });
    expect(result.release.id).toBe(RELEASE_ID);
    expect(result.quoteLabel).toBe('Q1');
  });

  it('an unknown release fails — never a silent "latest"', async () => {
    stubFetch(() => ({ status: 404, body: { error: { code: 'NOT_FOUND' } } }));
    await expect(
      fetchEngineeringReleaseContext({
        baseUrl: 'http://api.test',
        token: 'token-1',
        projectId: PROJECT_ID,
        releaseId: RELEASE_ID,
      }),
    ).rejects.toThrow();
  });

  it('rejects a release that does not belong to the requested project', async () => {
    stubFetch((url) => {
      if (url.endsWith(`/projects/${PROJECT_ID}/production-releases/${RELEASE_ID}`)) {
        return {
          status: 200,
          body: {
            id: RELEASE_ID,
            project_id: 'another-project',
            release_number: 9,
            design_revision_id: 'dr-9',
            design_revision_number: 9,
            manufacturing_fingerprint: 'sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            status: 'active',
            released_by: 'u-1',
            released_at: '2026-09-15T10:00:00Z',
            staleness: { manufacturing_stale: false, current_design_revision_id: null, current_design_revision_number: null },
          },
        };
      }
      if (url.endsWith(`/projects/${PROJECT_ID}/quote-revisions`)) {
        return { status: 200, body: [] };
      }
      return undefined;
    });
    await expect(
      fetchEngineeringReleaseContext({
        baseUrl: 'http://api.test',
        token: 'token-1',
        projectId: PROJECT_ID,
        releaseId: RELEASE_ID,
      }),
    ).rejects.toThrow('La liberación no corresponde a esta obra');
  });

  it('a release without a resolvable quote reference shows no invented label', async () => {
    stubFetch((url) => {
      if (url.endsWith(`/projects/${PROJECT_ID}/production-releases/${RELEASE_ID}`)) {
        return {
          status: 200,
          body: {
            id: RELEASE_ID,
            project_id: PROJECT_ID,
            release_number: 1,
            design_revision_id: 'dr-1',
            design_revision_number: 1,
            quote_revision_id: null,
            manufacturing_fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            status: 'active',
            released_by: 'u-1',
            released_at: '2026-09-15T10:00:00Z',
            staleness: { manufacturing_stale: false, current_design_revision_id: null, current_design_revision_number: null },
          },
        };
      }
      if (url.endsWith(`/projects/${PROJECT_ID}/quote-revisions`)) {
        return { status: 200, body: [] };
      }
      return undefined;
    });
    const result = await fetchEngineeringReleaseContext({
      baseUrl: 'http://api.test',
      token: 'token-1',
      projectId: PROJECT_ID,
      releaseId: RELEASE_ID,
    });
    expect(result.quoteLabel).toBeNull();
  });

  it('query keys are session/project/release scoped (no cross-context bleed)', () => {
    const a = engineeringReleaseQueryKey(['session', 'gen-1', 'org-a'], PROJECT_ID, RELEASE_ID);
    const b = engineeringReleaseQueryKey(['session', 'gen-2', 'org-b'], PROJECT_ID, RELEASE_ID);
    const c = engineeringReleaseQueryKey(['session', 'gen-1', 'org-a'], PROJECT_ID, 'another-release');
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toContain(RELEASE_ID);
  });
});
