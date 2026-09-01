/**
 * Global 401 safety net (pre-demo audit P0-1, #460 SEC-4B rewrite).
 *
 * Con el access corto (15 min) el refresh coordinado vive en
 * webAuthClient.authenticatedApiFetch (retry-once con validación de scope).
 * Este interceptor es la RED para las requests que no pasan por ese boundary:
 * ante un 401 de negocio dispara UN refresh coordinado — si es terminal,
 * cierra la sesión local; si renueva, no hace nada (el caller supera el error
 * y la siguiente request ya sale con el token nuevo). Se dispara una vez por
 * access token: el fan-out de saves del catálogo no genera refresh storms.
 *
 * Auth endpoints (/auth/*) gestionan su propio 401 UX y quedan excluidos.
 */

type OnSessionEnded = () => void;

let installed = false;
let lastFiredForToken: string | null = null;
let restoreFetch: (() => void) | null = null;

function requestUrl(init: RequestInfo | URL): string {
  if (typeof init === 'string') return init;
  if (init instanceof URL) return init.toString();
  return init.url ?? '';
}

export function installAuth401Interceptor(
  onEnded: OnSessionEnded,
  opts: {
    readToken?: () => string | null;
    /** Refresh coordinado singleflight (default: webAuthClient). */
    refresh?: () => Promise<{ status: string }>;
  } = {},
): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const readToken = opts.readToken ?? (() => null);
  const refresh = opts.refresh ?? (async () => ({ status: 'terminal' as const }));
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
    void refresh().then((outcome) => {
      if (outcome.status === 'terminal') onEnded();
    });
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
