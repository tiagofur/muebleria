/**
 * webAuthRuntime — la ÚNICA autoridad client-side del credential state Web
 * (#460 SEC-4B).
 *
 * El access token Web vive exclusivamente en la memoria de este módulo (una
 * pestaña): nunca en localStorage/sessionStorage/IndexedDB, nunca en Zustand
 * persist, nunca por BroadcastChannel, nunca en URLs ni logs. La rotating
 * refresh credential viaja sólo en la cookie HttpOnly `granete_web_refresh`
 * que el navegador transporta y este código jamás lee.
 *
 * Support es una credential class distinta: token en memoria, tab-local, sin
 * refresh family y sin cookie — la cookie sigue representando la sesión
 * platform original (ver webAuthClient para entry/exit).
 *
 * Reglas de carrera:
 * - `generation` es monótono y bump-ea en CADA cambio (apply/clear): una
 *   response tardía de una sesión cerrada no puede revivirla porque nadie
 *   aplica resultados con generación obsoleta;
 * - support y web nunca se confunden: hay un solo slot activo y su kind es
 *   parte de cada comparación de scope;
 * - ningún secret sale de este módulo excepto `accessToken` para el boundary
 *   de fetch autenticado.
 */

export interface WebCredentialInput {
  readonly accessToken: string;
  /** Server-clock RFC3339 (`access_expires_at`); nunca decodificar el JWT. */
  readonly accessExpiresAt: string;
  /** T0 + 18h (`absolute_session_expires_at`); deadline no deslizable. */
  readonly absoluteSessionExpiresAt: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly organizationId: string | null;
}

export interface SupportCredentialInput {
  readonly accessToken: string;
  readonly accessExpiresAt: string;
  readonly sessionId: string;
  readonly organizationId: string;
}

export interface WebCredentialSnapshot {
  readonly kind: 'web';
  readonly accessToken: string;
  readonly accessExpiresAt: string;
  readonly absoluteSessionExpiresAt: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly organizationId: string | null;
  readonly generation: number;
}

export interface SupportCredentialSnapshot {
  readonly kind: 'support';
  readonly accessToken: string;
  readonly accessExpiresAt: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly generation: number;
}

export type CredentialSnapshot = WebCredentialSnapshot | SupportCredentialSnapshot;

let generationCounter = 0;
let active: CredentialSnapshot | null = null;

function nextGeneration(): number {
  generationCounter += 1;
  return generationCounter;
}

/** Snapshot inmutable del credential activo (null = anónimo). */
export function getCredential(): CredentialSnapshot | null {
  return active;
}

/** Access bearer activo en memoria, o null. Único lector: el fetch boundary. */
export function getAccessToken(): string | null {
  return active?.accessToken ?? null;
}

/** Generación actual del credential slot (para late-response guards). */
export function credentialGeneration(): number {
  return active?.generation ?? generationCounter;
}

export function applyWebCredential(input: WebCredentialInput): WebCredentialSnapshot {
  const snapshot: WebCredentialSnapshot = {
    kind: 'web',
    ...input,
    generation: nextGeneration(),
  };
  active = snapshot;
  return snapshot;
}

export function applySupportCredential(input: SupportCredentialInput): SupportCredentialSnapshot {
  const snapshot: SupportCredentialSnapshot = {
    kind: 'support',
    ...input,
    generation: nextGeneration(),
  };
  active = snapshot;
  return snapshot;
}

/** Purga el credential (logout, expiración, transición). Bump-ea generación. */
export function clearCredential(): void {
  if (active === null) return;
  active = null;
  generationCounter += 1;
}

/**
 * True si el credential activo sigue siendo exactamente el mismo scope que
 * capturó el caller antes de una operación async (misma generación). Una
 * response tardía de logout/org-switch/session-replacement devuelve false y el
 * caller debe descartarla.
 */
export function isSameCredentialScope(scope: CredentialSnapshot): boolean {
  return active !== null && active.generation === scope.generation;
}

/** Expiridad del access en ms desde ahora (negativa = ya expirado); null sin credential. */
export function accessExpiresInMs(now: number = Date.now()): number | null {
  if (active === null) return null;
  const expiresAtMs = Date.parse(active.accessExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return null;
  return expiresAtMs - now;
}

/**
 * Deadline absoluto de la sesión web (T0+18h). Alcanzarlo significa
 * re-login: el refresh no puede deslizar este límite.
 */
export function absoluteSessionExpiresAtMs(): number | null {
  if (active?.kind !== 'web') return null;
  const ms = Date.parse(active.absoluteSessionExpiresAt);
  return Number.isFinite(ms) ? ms : null;
}

/** Test-only: resetea el estado del módulo entre casos. */
export function __resetWebAuthRuntimeForTests(): void {
  active = null;
  generationCounter = 0;
}
