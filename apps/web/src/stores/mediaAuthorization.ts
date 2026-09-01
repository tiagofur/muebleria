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
 * - the cache AND the batching state are scoped to the auth token + origin,
 *   so an organization/session switch can never reuse another tenant's URLs
 *   nor send another tenant's resource ids under the previous token;
 * - late authorize responses are dropped when the token changed meanwhile;
 * - requests are batched (≤100 files, the server's per-request bound),
 *   deduplicated and chunked (no per-image request storm, no oversized
 *   batch that the server would reject);
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

/**
 * Everything pending belongs to exactly one session scope: the token plus the
 * API origin that scheduled it. A token switch abandons the previous scope
 * (timer cancelled, queue discarded) instead of flushing it under the wrong
 * Authorization — the race where tenant B's files rode tenant A's batching
 * window cannot happen.
 */
interface MediaScope {
  readonly token: string;
  readonly baseUrl: string;
  queuedFiles: Set<string>;
  inflightFiles: Set<string>;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

// Canonical catalog media path (server-generated upload names).
const MEDIA_PATH_RE = /^\/api\/media\/([0-9a-f]{32}\.(?:jpg|png|webp))$/;
// Refresh a grant before it expires so a render never races the TTL.
const REFRESH_MARGIN_MS = 30_000;
// Window that coalesces one render's images into authorize batches.
const BATCH_FLUSH_MS = 15;
// Server bound: POST /media:authorize accepts at most 100 resources.
const MAX_AUTHORIZE_BATCH = 100;

const cache = new Map<string, MediaCacheEntry>();
const inflightBatches = new Set<Promise<void>>();
const listeners = new Set<() => void>();
let activeScope: MediaScope | null = null;

export function subscribeToAuthorizedMedia(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops every cached grant and abandons any pending batch (logout, tests). */
export function invalidateAuthorizedMedia(): void {
  cache.clear();
  abandonActiveScope();
}

function abandonActiveScope(): void {
  if (activeScope !== null && activeScope.flushTimer !== null) {
    clearTimeout(activeScope.flushTimer);
  }
  activeScope = null;
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
    cache.clear();
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
  const scope = scopeFor(ctx, token);
  if (scope.inflightFiles.has(filename) || scope.queuedFiles.has(filename)) return;
  scope.queuedFiles.add(filename);
  if (scope.flushTimer === null) {
    scope.flushTimer = setTimeout(() => {
      scope.flushTimer = null;
      flushScope(scope, ctx);
    }, BATCH_FLUSH_MS);
  }
}

// The batching scope belongs to one token+origin. Resolving under a different
// session abandons the previous scope entirely — its queue is never flushed
// with the new (or the old) token, which is what makes the batching window
// tenant-safe.
function scopeFor(ctx: MediaAuthorizationContext, token: string): MediaScope {
  if (activeScope !== null && activeScope.token === token && activeScope.baseUrl === ctx.baseUrl) {
    return activeScope;
  }
  abandonActiveScope();
  activeScope = {
    token,
    baseUrl: ctx.baseUrl,
    queuedFiles: new Set(),
    inflightFiles: new Set(),
    flushTimer: null,
  };
  return activeScope;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function flushScope(scope: MediaScope, ctx: MediaAuthorizationContext): void {
  const resources = [...scope.queuedFiles];
  scope.queuedFiles.clear();
  if (resources.length === 0) return;

  // The server rejects >100 resources per request: split into chunks so a
  // large catalog page authorizes completely instead of failing as a whole.
  for (const batch of chunk(resources, MAX_AUTHORIZE_BATCH)) {
    const run = requestGrants(scope, ctx, batch);
    inflightBatches.add(run);
    void run.finally(() => {
      inflightBatches.delete(run);
    });
  }
}

async function requestGrants(
  scope: MediaScope,
  ctx: MediaAuthorizationContext,
  resources: readonly string[],
): Promise<void> {
  for (const filename of resources) scope.inflightFiles.add(filename);
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
  try {
    const res = await fetchImpl(`${ctx.baseUrl}/media:authorize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${scope.token}`,
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
    if (ctx.getAuthToken() !== scope.token) return;
    const origin = mediaOrigin(ctx.baseUrl);
    let applied = false;
    for (const grant of data.grants ?? []) {
      const expiresAtMs = Date.parse(grant.expiresAt);
      if (!Number.isFinite(expiresAtMs)) continue;
      cache.set(grant.filename, {
        url: `${origin}${grant.url}`,
        expiresAtMs,
        token: scope.token,
      });
      applied = true;
    }
    if (applied) notifyResolved();
  } catch {
    // network failure: consumers keep placeholders; retried on next render
  } finally {
    for (const filename of resources) scope.inflightFiles.delete(filename);
  }
}

/** Test/verification hook: resolves when every in-flight batch settles. */
export async function authorizedMediaIdle(): Promise<void> {
  while (inflightBatches.size > 0 || (activeScope !== null && activeScope.flushTimer !== null)) {
    const pending = [...inflightBatches];
    if (activeScope !== null && activeScope.flushTimer !== null) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_FLUSH_MS + 5));
    }
    await Promise.all(pending);
  }
}
