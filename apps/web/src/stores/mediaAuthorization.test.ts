import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MediaAuthorizationContext,
  authorizedMediaIdle,
  invalidateAuthorizedMedia,
  resolveAuthorizedMediaUrl,
  subscribeToAuthorizedMedia,
} from './mediaAuthorization';

/**
 * #460 SEC-3 — resource-scoped signed media URLs for the web app. These tests
 * pin the security behaviors: no session JWT in URLs, batched/deduplicated
 * authorize requests, token-scoped cache (organization switch never reuses
 * another tenant's grants), TTL refresh and late-response dropping.
 */

const FILE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
const FILE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png';

function grantResponse(...files: string[]): unknown {
  return {
    grants: files.map((filename) => ({
      filename,
      url: `/api/media/${filename}?grant=grant-${filename.slice(0, 6)}`,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    })),
  };
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeContext(
  fetchImpl: typeof fetch,
  token: string | null = 'session-jwt',
): MediaAuthorizationContext {
  let currentToken: string | null = token;
  return {
    baseUrl: 'http://test/api',
    getAuthToken: () => currentToken,
    fetchImpl: ((...args: Parameters<typeof fetch>) =>
      fetchImpl(...args)) as typeof fetch,
    // Tests rotate the token through this handle to simulate org switches.
    ...({ setToken: (t: string | null) => (currentToken = t) } as object),
  } as MediaAuthorizationContext;
}

describe('mediaAuthorization — resolveAuthorizedMediaUrl', () => {
  beforeEach(() => {
    invalidateAuthorizedMedia();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('passes through absolute, blob and data URLs', () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const ctx = makeContext(fetchImpl);
    expect(resolveAuthorizedMediaUrl('https://cdn.example.com/x.png', ctx)).toBe(
      'https://cdn.example.com/x.png',
    );
    expect(resolveAuthorizedMediaUrl('blob:local-object', ctx)).toBe('blob:local-object');
    expect(resolveAuthorizedMediaUrl('data:image/png;base64,xx', ctx)).toBe(
      'data:image/png;base64,xx',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns undefined without an authenticated session (no ?token= URL)', () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const ctx = makeContext(fetchImpl, null);
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx)).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('batches one render’s images into a single authorize request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk(grantResponse(FILE_A, FILE_B)),
    );
    const ctx = makeContext(fetchImpl);

    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx)).toBeUndefined();
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_B}`, ctx)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://test/api/media:authorize');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      resources: [FILE_A, FILE_B],
    });
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer session-jwt',
    });

    await authorizedMediaIdle();
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx)).toBe(
      `http://test/api/media/${FILE_A}?grant=grant-${FILE_A.slice(0, 6)}`,
    );
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_B}`, ctx)).toBe(
      `http://test/api/media/${FILE_B}?grant=grant-${FILE_B.slice(0, 6)}`,
    );
  });

  it('reuses cached grants within their TTL (no request storm on rerender)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk(grantResponse(FILE_A)),
    );
    const ctx = makeContext(fetchImpl);
    resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx);
    await vi.advanceTimersByTimeAsync(20);
    await authorizedMediaIdle();

    for (let i = 0; i < 25; i += 1) {
      resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('notifies listeners exactly when grants land', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonOk(grantResponse(FILE_A)),
    );
    const ctx = makeContext(fetchImpl);
    const listener = vi.fn();
    const unsubscribe = subscribeToAuthorizedMedia(listener);

    resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx);
    await vi.advanceTimersByTimeAsync(20);
    await authorizedMediaIdle();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('never reuses another tenant’s grants after the token changes', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(jsonOk(grantResponse(FILE_A)));
    const ctx = makeContext(fetchImpl, 'org-a-token');
    resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx);
    await vi.advanceTimersByTimeAsync(20);
    await authorizedMediaIdle();
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx)).toContain(
      'grant=',
    );

    // Organization switch: same file, different session scope → the old
    // grant must not survive, and a new authorize runs with the new token.
    fetchImpl.mockResolvedValueOnce(
      jsonOk({
        grants: [
          {
            filename: FILE_A,
            url: `/api/media/${FILE_A}?grant=org-b-grant`,
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
          },
        ],
      }),
    );
    (ctx as unknown as { setToken: (t: string) => void }).setToken('org-b-token');
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20);
    await authorizedMediaIdle();
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx)).toBe(
      `http://test/api/media/${FILE_A}?grant=org-b-grant`,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchImpl.mock.calls[1]!;
    expect((secondInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer org-b-token',
    });
  });

  it('drops late authorize responses after a session change', async () => {
    let resolveResponse: (r: Response) => void = () => {};
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const ctx = makeContext(fetchImpl, 'org-a-token');
    resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx);
    await vi.advanceTimersByTimeAsync(20);

    // Session switches while the authorize request is in flight.
    (ctx as unknown as { setToken: (t: string) => void }).setToken('org-b-token');
    resolveResponse(jsonOk(grantResponse(FILE_A)));
    await authorizedMediaIdle();

    // The org-A response was dropped: nothing is cached for the new session.
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx)).toBeUndefined();
  });

  it('refreshes a grant that is about to expire', async () => {
    const expiringSoon = new Date(Date.now() + 10_000).toISOString();
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(
      jsonOk({
        grants: [
          { filename: FILE_A, url: `/api/media/${FILE_A}?grant=old`, expiresAt: expiringSoon },
        ],
      }),
    );
    const ctx = makeContext(fetchImpl);
    resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx);
    await vi.advanceTimersByTimeAsync(20);
    await authorizedMediaIdle();

    // Inside the refresh margin: still served, but a refresh is scheduled.
    fetchImpl.mockResolvedValueOnce(
      jsonOk({
        grants: [
          { filename: FILE_A, url: `/api/media/${FILE_A}?grant=new`, expiresAt: new Date(Date.now() + 120_000).toISOString() },
        ],
      }),
    );
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx)).toBe(
      `http://test/api/media/${FILE_A}?grant=old`,
    );
    await vi.advanceTimersByTimeAsync(20);
    await authorizedMediaIdle();
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx)).toBe(
      `http://test/api/media/${FILE_A}?grant=new`,
    );
  });

  it('keeps failures silent: a failed authorize leaves the caller on placeholders', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('boom', { status: 500 }),
    );
    const ctx = makeContext(fetchImpl);
    resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx);
    await vi.advanceTimersByTimeAsync(20);
    await authorizedMediaIdle();
    expect(resolveAuthorizedMediaUrl(`/api/media/${FILE_A}`, ctx)).toBeUndefined();
  });
});
