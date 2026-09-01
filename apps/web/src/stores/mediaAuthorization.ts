/**
 * mediaAuthorization — resource-scoped signed media URLs (#460 SEC-3).
 *
 * Replaces the retired `?token=<session JWT>` query credential: consumers ask
 * the backend to authorize canonical media filenames and receive short-lived
 * signed GET URLs (media_read grants) that `<img>` tags can use directly.
 *
 * Contract kept synchronous on purpose: `resolveAuthorizedMediaUrl` returns a
 * usable URL from the in-memory cache or `undefined` while the (batched,
 * deduplicated) authorize request runs; listeners are notified when grants
 * land so subscribed trees re-render and resolve again.
 *
 * Security rules (#460):
 * - grants live in memory only — never persisted, never in localStorage;
 * - the cache is scoped to the auth token that minted the grants, so an
 *   organization/session switch can never reuse another tenant's URLs;
 * - late authorize responses are dropped when the token changed meanwhile;
 * - requests are batched and deduplicated (no per-image request storm);
 * - entries refresh just before expiry and are simply re-requested after it.
 */

export interface MediaAuthorizationContext {
  readonly baseUrl: string;
  readonly getAuthToken: () => string | null;
  readonly fetchImpl?: typeof globalThis.fetch;
}

interface MediaCacheEntry {
  readonly url: string;
  readonly expiresAtMs: number;
  readonly token: string;
}

// Canonical catalog media path (server-generated upload names).
const MEDIA_PATH_RE = /^\/api\/media\/([0-9a-f]{32}\.(?:jpg|png|webp))$/;
// Refresh a grant before it expires so a render never races the TTL.
const REFRESH_MARGIN_MS = 30_000;
// Window that coalesces one render's images into a single authorize batch.
const BATCH_FLUSH_MS = 15;

const cache = new Map<string, MediaCacheEntry>();
const queuedFiles = new Set<string>();
const inflightBatches = new Set<Promise<void>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export function subscribeToAuthorizedMedia(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops every cached grant (logout, tests). In-memory only by design. */
export function invalidateAuthorizedMedia(): void {
  cache.clear();
  queuedFiles.clear();
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function mediaOrigin(baseUrl: string): string {
  return baseUrl.replace(/\/api\/?$/, '');
}

function notifyResolved(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Synchronous resolution for `<img src>` consumers.
 *
 * - absolute/blob/data URLs pass through untouched (same as before);
 * - non-media paths pass through unchanged (kept for any legacy relative URL);
 * - canonical `/api/media/<file>` paths resolve from the token-scoped grant
 *   cache, scheduling a batched authorize request on miss or near-expiry;
 * - without an authenticated session there is nothing to serve: `undefined`
 *   lets consumers render their placeholder instead of a guaranteed-401 URL.
 */
export function resolveAuthorizedMediaUrl(
  raw: string | undefined,
  ctx: MediaAuthorizationContext,
): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('http') || raw.startsWith('blob:') || raw.startsWith('data:')) return raw;
  const path = raw.split('?')[0] ?? raw;
  const match = MEDIA_PATH_RE.exec(path);
  if (!match?.[1]) return raw;
  const token = ctx.getAuthToken();
  if (!token) return undefined;

  const filename: string = match[1];
  const entry = cache.get(filename);
  if (entry && entry.token !== token) {
    // Session/tenant switched: previous grants are dead weight, never reused.
    invalidateAuthorizedMedia();
  } else if (entry) {
    const remaining = entry.expiresAtMs - Date.now();
    if (remaining > REFRESH_MARGIN_MS) return entry.url;
    // Still valid but close to expiry: keep serving while a refresh runs.
    scheduleAuthorize(filename, ctx, token);
    if (remaining > 0) return entry.url;
  }
  scheduleAuthorize(filename, ctx, token);
  return undefined;
}

function scheduleAuthorize(
  filename: string,
  ctx: MediaAuthorizationContext,
  token: string,
): void {
  queuedFiles.add(filename);
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushQueue(ctx, token);
    }, BATCH_FLUSH_MS);
  }
}

async function flushQueue(ctx: MediaAuthorizationContext, token: string): Promise<void> {
  const resources = [...queuedFiles];
  queuedFiles.clear();
  if (resources.length === 0) return;

  const run = (async () => {
    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
    try {
      const res = await fetchImpl(`${ctx.baseUrl}/media:authorize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resources }),
      });
      if (!res.ok) return; // placeholders stay; next render retries
      const data = (await res.json()) as {
        readonly grants?: ReadonlyArray<{
          readonly filename: string;
          readonly url: string;
          readonly expiresAt: string;
        }>;
      };
      // Late-response rule: a token change (logout/org switch) means the
      // response belongs to another session scope and must not be applied.
      if (ctx.getAuthToken() !== token) return;
      const origin = mediaOrigin(ctx.baseUrl);
      let applied = false;
      for (const grant of data.grants ?? []) {
        const expiresAtMs = Date.parse(grant.expiresAt);
        if (!Number.isFinite(expiresAtMs)) continue;
        cache.set(grant.filename, {
          url: `${origin}${grant.url}`,
          expiresAtMs,
          token,
        });
        applied = true;
      }
      if (applied) notifyResolved();
    } catch {
      // network failure: consumers keep placeholders; retried on next render
    }
  })();
  inflightBatches.add(run);
  try {
    await run;
  } finally {
    inflightBatches.delete(run);
  }
}

/** Test/verification hook: resolves when every in-flight batch settles. */
export async function authorizedMediaIdle(): Promise<void> {
  while (inflightBatches.size > 0 || flushTimer !== null) {
    const pending = [...inflightBatches];
    if (flushTimer !== null) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_FLUSH_MS + 5));
    }
    await Promise.all(pending);
  }
}
