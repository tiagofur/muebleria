/**
 * Global 401 safety net (pre-demo audit P0-1).
 *
 * Access tokens now cover a full workday (18 h) and the middleware keeps
 * re-validating user/membership/organization from the DB on every request,
 * so mid-session expiry is rare. But it is not impossible: a revoked
 * membership, a deactivated user, a token-version bump or simply leaving the
 * tab open past the TTL. In those cases every write used to fail with the
 * misleading "Error de conexión al sincronizar cambios" toast while the UI
 * kept showing phantom local-only state.
 *
 * This interceptor watches every fetch and, on a 401 from a business
 * endpoint, calls markSessionExpired() — which logs out synchronously and
 * surfaces the proper "Tu sesión expiró" login screen (SessionGate) instead.
 * Auth endpoints manage their own 401 UX (wrong password, boot detection)
 * and are excluded. Repeated 401s with the same token (catalog save fan-out
 * fires dozens) trigger the callback once; a fresh login re-arms it.
 */

type OnSessionExpired = () => void;

let installed = false;
let lastFiredForToken: string | null = null;
let restoreFetch: (() => void) | null = null;

function requestUrl(init: RequestInfo | URL): string {
  if (typeof init === 'string') return init;
  if (init instanceof URL) return init.toString();
  return init.url ?? '';
}

export function installAuth401Interceptor(
  onExpired: OnSessionExpired,
  opts: { readToken?: () => string | null } = {},
): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const readToken = opts.readToken ?? (() => window.localStorage.getItem('granete_token'));
  const original = window.fetch;
  const originalBound = original.bind(window);

  window.fetch = async (...args: Parameters<typeof window.fetch>): Promise<Response> => {
    const res = await originalBound(...args);
    if (res.status !== 401) return res;
    const url = requestUrl(args[0]);
    // /auth/* handles its own unauthorized UX (login errors, boot expiry).
    if (url.includes('/auth/')) return res;
    const token = readToken();
    if (!token || token === lastFiredForToken) return res;
    lastFiredForToken = token;
    onExpired();
    return res;
  };
  const installedFetch = window.fetch;
  restoreFetch = () => {
    if (window.fetch === installedFetch) window.fetch = original;
  };
}

/** Reset module singletons and restore fetch. Tests only. */
export function __resetAuth401InterceptorForTests(): void {
  restoreFetch?.();
  restoreFetch = null;
  installed = false;
  lastFiredForToken = null;
}
