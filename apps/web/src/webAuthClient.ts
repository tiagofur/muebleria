/**
 * webAuthClient — boundary central de las requests Web autenticadas y del
 * ciclo cookie bootstrap → refresh → logout (#460 SEC-4B).
 *
 * Responsabilidades (una sola estrategia canónica, auditable):
 * 1. obtener el access vigente desde webAuthRuntime (memoria);
 * 2. adjuntar Authorization SÓLO a URLs bajo el origin+base exacto de la API
 *    Granete — una URL externa jamás recibe el bearer;
 * 3. capturar generación/scope antes de salir y compararlos después;
 * 4. ejecutar la request;
 * 5. ante 401 en modo web: coordinated refresh (singleflight in-tab,
 *    serializado cross-tab por webSessionLock), validar MISMO scope y
 *    reintentar exactamente UNA vez;
 * 6. si el refresh cambió el scope/sesión: NO reintentar (la operación se
 *    preparó para otro tenant);
 * 7. refresh terminal → fin de sesión local;
 * 8. nunca loopear: un reintento por request, sin re-refresh.
 *
 * Errores diferenciados (sin confundir 5xx con REFRESH_REVOKED):
 * - terminal: REFRESH_INVALID/EXPIRED/REVOKED/REUSED → sesión muerta;
 * - network: sin conexión/timeout → el access actual puede seguir vigente,
 *   NO se cierra la sesión, reintento acotado con backoff;
 * - csrf: 403 del boundary CSRF → fail closed con error explícito, sin loop.
 */

import type { LoginResponse } from '@granete/storage';
import {
  applyWebCredential,
  clearCredential,
  getCredential,
  getAccessToken,
  absoluteSessionExpiresAtMs,
  type CredentialSnapshot,
  type WebCredentialSnapshot,
} from './webAuthRuntime';
import { broadcastWebSessionEvent } from './webSessionChannel';
import { withWebSessionMutation } from './webSessionLock';

export interface WebAuthClientDeps {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

// --- Errores tipificados -------------------------------------------------------

/** Refresh terminal (o 401 sin credential): la sesión NO se puede renovar. */
export type WebRefreshTerminalCode =
  | 'REFRESH_INVALID'
  | 'REFRESH_EXPIRED'
  | 'REFRESH_REVOKED'
  | 'REFRESH_REUSED';

export class WebSessionEndedError extends Error {
  constructor(
    message: string,
    readonly terminalCode: WebRefreshTerminalCode | 'SESSION_ENDED' | 'CSRF_DENIED',
  ) {
    super(message);
    this.name = 'WebSessionEndedError';
  }
}

/**
 * La request NO puede repetirse bajo otra credential/scope (org switch o
 * session replacement durante la operación). El caller debe purgar y
 * transicionar — jamás reintentar la operación original.
 */
export class WebSessionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebSessionTransitionError';
  }
}

/** Fallo de red/5xx durante refresh: la sesión local sigue siendo válida. */
export class WebRefreshNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebRefreshNetworkError';
  }
}

// --- Config --------------------------------------------------------------------

let deps: WebAuthClientDeps = { baseUrl: '/api' };
/** Test-only dependency injection (ver webAuthClient.test.ts). */
export function configureWebAuthClient(next: WebAuthClientDeps): void {
  deps = next;
}

function fetchImpl(): typeof fetch {
  return deps.fetchImpl ?? globalThis.fetch;
}

function apiOrigin(): string {
  // Normaliza a un prefijo origin+path SIN slash final: la comparación de
  // "es API Granete" es por prefijo exacto de este string, nunca por
  // substring suelto de una URL arbitraria.
  return deps.baseUrl.replace(/\/+$/, '');
}

/**
 * True sólo si la URL cae bajo el origin+base exacto de la API. Relativas se
 * comparan contra el PATH del base (`/api`); absolutas exigen el MISMO origin
 * — nunca substring matching suelto.
 */
export function isGraneteApiUrl(url: string): boolean {
  try {
    const base = new URL(apiOrigin(), globalThis.location?.href ?? 'http://localhost');
    if (url.startsWith('/')) {
      const path = url.split('?')[0] ?? url;
      return path === base.pathname || path.startsWith(`${base.pathname}/`);
    }
    const parsed = new URL(url);
    return (
      parsed.origin === base.origin &&
      (parsed.pathname === base.pathname || parsed.pathname.startsWith(`${base.pathname}/`))
    );
  } catch {
    return false;
  }
}

function isAuthEndpoint(url: string): boolean {
  return url.includes('/auth/');
}

// --- LoginResponse → credential -------------------------------------------------

export interface WebAccessCredentialDraft {
  readonly accessToken: string;
  readonly accessExpiresAt: string;
  readonly absoluteSessionExpiresAt: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly organizationId: string | null;
}

/**
 * Extrae el credential del auth response del server. Requiere la metadata de
 * expiridad server-clock (SEC-4A): el scheduling NUNCA decodifica el JWT.
 */
export function credentialFromLoginResponse(response: LoginResponse): WebAccessCredentialDraft {
  if (
    !response.token ||
    !response.access_expires_at ||
    !response.absolute_session_expires_at ||
    !response.session_id
  ) {
    throw new Error('Respuesta de autenticación sin metadata de sesión completa');
  }
  return {
    accessToken: response.token,
    accessExpiresAt: response.access_expires_at,
    absoluteSessionExpiresAt: response.absolute_session_expires_at,
    sessionId: response.session_id,
    userId: response.user.id,
    organizationId: response.organization?.id ?? null,
  };
}

export function applyLoginResponse(response: LoginResponse): WebCredentialSnapshot {
  return applyWebCredential(credentialFromLoginResponse(response));
}

// --- Cookie bootstrap / coordinated refresh -------------------------------------

export type WebRefreshOutcome =
  | { readonly status: 'refreshed'; readonly credential: WebCredentialSnapshot; readonly response: LoginResponse }
  /** La cookie ahora pertenece a OTRA sesión (nuevo login en otra pestaña). */
  | { readonly status: 'replaced'; readonly credential: WebCredentialSnapshot; readonly response: LoginResponse }
  | { readonly status: 'terminal'; readonly code: WebRefreshTerminalCode | 'SESSION_ENDED' | 'CSRF_DENIED' }
  | { readonly status: 'network' };

interface RefreshRun {
  readonly startedGeneration: number;
  readonly promise: Promise<WebRefreshOutcome>;
}

let inFlightRefresh: RefreshRun | null = null;

/**
 * Rotación de la cookie HttpOnly bajo el lock cross-tab (dos pestañas rotando
 * la misma cookie = replay = familia revocada; SEC-2A no se relaja). La
 * rotación viaja bodyless + credentials + CSRF header; el access NUEVO llega
 * en el JSON y vive sólo en memoria.
 *
 * Singleflight in-tab: 20 callers concurrentes comparten UNA rotación.
 */
export function coordinatedWebRefresh(): Promise<WebRefreshOutcome> {
  const run = inFlightRefresh;
  if (run !== null && run.startedGeneration === currentGeneration()) {
    return run.promise;
  }
  const promise = withWebSessionMutation(rotateCookie).then(
    (outcome) => outcome,
    (error) => outcomeFromError(error),
  );
  inFlightRefresh = { startedGeneration: currentGeneration(), promise };
  void promise.finally(() => {
    if (inFlightRefresh?.promise === promise) inFlightRefresh = null;
  });
  return promise;
}

function currentGeneration(): number {
  return getCredential()?.generation ?? 0;
}

function outcomeFromError(error: unknown): WebRefreshOutcome {
  if (error instanceof WebSessionEndedError) {
    return { status: 'terminal', code: error.terminalCode };
  }
  return { status: 'network' };
}

async function rotateCookie(): Promise<WebRefreshOutcome> {
  const previous = getCredential();
  const response = await postCookieAuth('/auth/refresh');
  if (!response.ok) {
    throw refreshErrorFromStatus(response.status);
  }
  const body = (await response.json()) as LoginResponse;
  const credential = applyLoginResponse(body);
  if (previous !== null && previous.kind === 'web' && credential.sessionId !== previous.sessionId) {
    // Session identity mismatch (#460 §38): la cookie fue reemplazada por un
    // nuevo login. El credential NUEVO ya quedó aplicado (con purge previo a
    // cargo del caller); el outcome 'replaced' fuerza la transición.
    return { status: 'replaced', credential, response: body };
  }
  return { status: 'refreshed', credential, response: body };
}

function refreshErrorFromStatus(status: number): Error {
  if (status === 403) {
    return new WebSessionEndedError('Boundary CSRF rechazó la renovación', 'CSRF_DENIED');
  }
  if (status === 401) {
    // La rotación devuelve 401 para todo estado público terminal; el código
    // exacto llega en el body y refineWebRefreshError lo extrae.
    return new WebSessionEndedError('La sesión no se puede renovar', 'REFRESH_INVALID');
  }
  if (status >= 500) {
    return new WebRefreshNetworkError('El servidor no pudo renovar la sesión');
  }
  return new WebRefreshNetworkError(`Renovación falló (${status})`);
}

async function postCookieAuth(path: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl()(`${apiOrigin()}${path}`, {
      method: 'POST',
      // Bodyless + cookie HttpOnly + CSRF header exacto (SEC-4A). Sin
      // Authorization: el bootstrap jamás presenta un bearer.
      credentials: 'include',
      headers: { 'X-Granete-CSRF': '1' },
    });
  } catch (error) {
    throw new WebRefreshNetworkError(error instanceof Error ? error.message : 'network');
  }
  if (response.status === 401) {
    return refineWebRefreshError(response);
  }
  return response;
}

const TERMINAL_CODES: readonly WebRefreshTerminalCode[] = [
  'REFRESH_INVALID',
  'REFRESH_EXPIRED',
  'REFRESH_REVOKED',
  'REFRESH_REUSED',
];

async function refineWebRefreshError(response: Response): Promise<Response> {
  try {
    const body = (await response.clone().json()) as { code?: string };
    const code = body.code as WebRefreshTerminalCode;
    if (code && TERMINAL_CODES.includes(code)) {
      throw new WebSessionEndedError('La sesión no se puede renovar', code);
    }
  } catch (error) {
    if (error instanceof WebSessionEndedError) throw error;
    // body no-JSON: 401 genérico ya cubierto por refreshErrorFromStatus
  }
  return response;
}

// --- Logout ---------------------------------------------------------------------

export type WebLogoutOutcome =
  | { readonly status: 'revoked' }
  | { readonly status: 'pending-retry' };

/**
 * Web logout: POST /auth/logout con la cookie + CSRF, bajo el MISMO lock
 * cross-tab que el refresh (evita Tab A refresh || Tab B logout). Sólo tras
 * el commit server-side se purga el estado local; un 5xx preserva la cookie y
 * el resultado 'pending-retry' impide declarar el cierre completado.
 */
export async function webLogout(): Promise<WebLogoutOutcome> {
  try {
    const outcome = await withWebSessionMutation(async () => {
      const response = await postCookieAuth('/auth/logout');
      if (response.status === 401) {
        // Cookie muerta/desconocida: el server responde logout idempotente
        // 200 para logout sin credencial; un 401 aquí sólo aparece con cookie
        // corrupta — tratar como terminal-retry no aporta. La sesión server
        // no existe ⇒ cierre efectivo.
        return 'revoked' as const;
      }
      if (!response.ok) {
        return 'pending-retry' as const;
      }
      return 'revoked' as const;
    });
    if (outcome === 'revoked') {
      clearCredential();
      broadcastWebSessionEvent({ type: 'session-ended' });
    }
    return { status: outcome };
  } catch (error) {
    if (error instanceof WebSessionEndedError && error.terminalCode === 'CSRF_DENIED') {
      return { status: 'pending-retry' };
    }
    return { status: 'pending-retry' };
  }
}

// --- Refresh scheduler -----------------------------------------------------------

const REFRESH_LEAD_MS = 2 * 60 * 1000; // renueva ~2 min antes del vencimiento.
const REFRESH_MIN_DELAY_MS = 5_000;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let wakeListenersInstalled = false;

/**
 * Programa la renovación a partir del expiry REAL del server
 * (access_expires_at), nunca un setInterval fijo. Idempotente: cada apply
 * reprograma un único timer.
 */
export function scheduleWebAccessRefresh(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  const expiresIn = credentialExpiresIn();
  if (expiresIn === null) return; // anónimo/support: nada que renovar por cookie.
  const delay = Math.max(expiresIn - REFRESH_LEAD_MS, REFRESH_MIN_DELAY_MS);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void maybeRefreshAfterWake();
  }, delay);
  installWakeListeners();
}

function credentialExpiresIn(): number | null {
  const credential = getCredential();
  if (credential === null || credential.kind !== 'web') return null;
  const expiresAtMs = Date.parse(credential.accessExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return null;
  return expiresAtMs - Date.now();
}

/**
 * Tabs en background/sleep pierden timers: al volver a ser visibles (o al
 * recuperar conexión), si el access está vencido o por vencer, se dispara el
 * refresh coordinado — el singleflight evita storms.
 */
function maybeRefreshAfterWake(): void {
  const credential = getCredential();
  if (credential === null || credential.kind !== 'web') return;
  const absolute = absoluteSessionExpiresAtMs();
  if (absolute !== null && Date.now() >= absolute) {
    // Deadline absoluto alcanzado: refresh no puede mantener la sesión.
    clearCredential();
    broadcastWebSessionEvent({ type: 'session-ended' });
    return;
  }
  const expiresIn = credentialExpiresIn();
  if (expiresIn !== null && expiresIn <= REFRESH_LEAD_MS) {
    void coordinatedWebRefresh().then((outcome) => {
      if (outcome.status === 'refreshed') {
        scheduleWebAccessRefresh();
      }
    });
  }
}

function installWakeListeners(): void {
  if (wakeListenersInstalled || typeof globalThis.document === 'undefined') return;
  wakeListenersInstalled = true;
  const wake = () => maybeRefreshAfterWake();
  globalThis.document.addEventListener('visibilitychange', () => {
    if (globalThis.document.visibilityState === 'visible') wake();
  });
  globalThis.addEventListener('focus', wake);
  globalThis.addEventListener('online', wake);
}

// --- Authenticated fetch boundary -------------------------------------------------

export interface AuthenticatedFetchRequest {
  readonly method?: string;
  readonly headers?: HeadersInit;
  readonly body?: BodyInit | null;
  readonly signal?: AbortSignal | null;
}

/**
 * fetch autenticado para la API Granete. Añade Authorization desde la
 * memoria SÓLO cuando la URL es API Granete (exact origin+base); ante 401 en
 * modo web coordina UN refresh, exige el MISMO scope y reintenta UNA vez.
 * Requests externas pasan intactas, sin bearer.
 */
export async function authenticatedApiFetch(
  url: string,
  request: AuthenticatedFetchRequest = {},
): Promise<Response> {
  const isApi = isGraneteApiUrl(url);
  const token = getAccessToken();
  const headers = new Headers(request.headers ?? {});
  if (isApi && token !== null && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const credentialBefore: CredentialSnapshot | null = getCredential();
  let response: Response;
  try {
    response = await fetchImpl()(url, {
      method: request.method,
      headers,
      body: request.body ?? undefined,
      signal: request.signal ?? undefined,
    });
  } catch (error) {
    if (error instanceof WebSessionEndedError || error instanceof WebSessionTransitionError) throw error;
    throw error;
  }
  if (response.status !== 401 || !isApi || isAuthEndpoint(url)) {
    return response;
  }
  // 401 en endpoint de negocio: credential web → refresh coordinado.
  const active = getCredential();
  if (active === null || active.kind !== 'web' || active.generation !== credentialBefore?.generation) {
    return response;
  }
  const outcome = await coordinatedWebRefresh();
  if (outcome.status === 'network') {
    return response; // el 401 original: la sesión local sigue siendo válida.
  }
  if (outcome.status === 'terminal') {
    clearCredential();
    broadcastWebSessionEvent({ type: 'session-ended' });
    throw new WebSessionEndedError('La sesión expiró', outcome.code);
  }
  const stillSame =
    credentialBefore !== null &&
    credentialBefore.kind === 'web' &&
    outcome.status !== 'replaced' &&
    outcome.credential.sessionId === credentialBefore.sessionId &&
    (outcome.credential.organizationId ?? null) === (credentialBefore.organizationId ?? null) &&
    getCredential()?.generation === outcome.credential.generation;
  if (!stillSame) {
    // El scope/sesión cambió (otra pestaña hizo select-org o un nuevo login):
    // la operación original se preparó para otro tenant — NO se reintenta.
    throw new WebSessionTransitionError('La sesión cambió durante la operación');
  }
  // Mismo scope con access nuevo: exactamente UN reintento.
  const retryHeaders = new Headers(request.headers ?? {});
  retryHeaders.set('Authorization', `Bearer ${outcome.credential.accessToken}`);
  return fetchImpl()(url, {
    method: request.method,
    headers: retryHeaders,
    body: request.body ?? undefined,
    signal: request.signal ?? undefined,
  });
}

/** Test-only: reset de singletons del módulo. */
export function __resetWebAuthClientForTests(): void {
  inFlightRefresh = null;
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}
