import * as SecureStore from 'expo-secure-store';
import { DomainError } from '@granete/domain';
import { getApiBaseUrl } from './apiConfig';

export const REFRESH_KEY = 'granete_mobile_refresh';

export interface MobileCredentialInput {
  readonly accessToken: string;
  readonly accessExpiresAt: string;
  readonly absoluteSessionExpiresAt: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly organizationId: string | null;
}

export interface MobileCredentialSnapshot extends MobileCredentialInput {
  readonly generation: number;
}

let generationCounter = 0;
let active: MobileCredentialSnapshot | null = null;
let activeRefreshPromise: Promise<void> | null = null;

function nextGeneration(): number {
  generationCounter += 1;
  return generationCounter;
}

export function getCredential(): MobileCredentialSnapshot | null {
  return active;
}

export function getAccessToken(): string | null {
  return active?.accessToken ?? null;
}

export function credentialGeneration(): number {
  return active?.generation ?? generationCounter;
}

export function applyCredential(input: MobileCredentialInput): MobileCredentialSnapshot {
  if (!input.accessExpiresAt || !input.absoluteSessionExpiresAt || !input.sessionId) {
    throw new DomainError('Metadatos de sesión incompletos', { input });
  }
  const snapshot: MobileCredentialSnapshot = {
    ...input,
    generation: nextGeneration(),
  };
  active = snapshot;
  scheduleAuthRefresh(snapshot);
  return snapshot;
}

export function clearCredential(): void {
  if (active === null) return;
  active = null;
  generationCounter += 1;
  cancelAuthRefresh();
}

export function isSameCredentialScope(scope: MobileCredentialSnapshot): boolean {
  return active !== null && active.generation === scope.generation;
}

export function accessExpiresInMs(now: number = Date.now()): number | null {
  if (active === null) return null;
  const expiresAtMs = Date.parse(active.accessExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return null;
  return expiresAtMs - now;
}

export function absoluteSessionExpiresAtMs(): number | null {
  if (active === null) return null;
  const ms = Date.parse(active.absoluteSessionExpiresAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Executes a single-flight refresh rotation.
 * 1. Read R1 from SecureStore.
 * 2. POST /api/auth/refresh { refresh_token: R1 }.
 * 3. Atomic replace: write R2 to SecureStore.
 * 4. Apply A2 to memory.
 * If SecureStore fails, we clear R1 and A2 (fail closed) to avoid replay ambiguity.
 */
export async function refreshSession(): Promise<void> {
  if (activeRefreshPromise !== null) {
    return activeRefreshPromise;
  }
  activeRefreshPromise = doRefreshSession();
  try {
    await activeRefreshPromise;
  } finally {
    activeRefreshPromise = null;
  }
}

async function doRefreshSession(): Promise<void> {
  // Read current R1
  let currentRefresh: string | null = null;
  try {
    currentRefresh = await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    // Cannot read secure store, fail closed
    clearCredential();
    throw new Error('Almacenamiento seguro no disponible.');
  }

  if (!currentRefresh) {
    clearCredential();
    throw new Error('No hay sesión disponible para renovar.');
  }

  // If we already hit the absolute 18h limit
  const absExpiry = absoluteSessionExpiresAtMs();
  if (absExpiry !== null && Date.now() >= absExpiry) {
    await purgeSecureRefresh();
    clearCredential();
    throw new Error('La sesión ha alcanzado su tiempo máximo (18h).');
  }

  const url = `${getApiBaseUrl()}/api/auth/refresh`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ refresh_token: currentRefresh }),
    });
  } catch (err: any) {
    // Network failure: preserve R1, do not clear memory immediately unless expired
    throw new DomainError('Error de red al renovar sesión', { originalError: err });
  }

  if (!response.ok) {
    const isTerminal = response.status === 401 || response.status === 403 || response.status === 400;
    if (isTerminal) {
      await purgeSecureRefresh();
      clearCredential();
      throw new DomainError('Sesión revocada o inválida.', { status: response.status });
    }
    throw new DomainError('Error temporal al renovar sesión', { status: response.status });
  }

  const data = await response.json();
  const R2 = data.refresh_token;
  if (!R2) {
    // Broken contract
    await purgeSecureRefresh();
    clearCredential();
    throw new DomainError('Respuesta de renovación incompleta (sin refresh token).');
  }

  // Atomic replace: save R2
  try {
    await SecureStore.setItemAsync(REFRESH_KEY, R2);
  } catch (err) {
    // SEC-5 rule 9: If SecureStore R2 write fails, server has rotated R1 -> R2.
    // Client lost R2. We MUST fail closed and not publish A2.
    await purgeSecureRefresh(); // Attempt to clear R1 just in case it's still there
    clearCredential();
    throw new DomainError('Fallo de almacenamiento seguro al actualizar la sesión. Por favor, iniciá sesión de nuevo.');
  }

  // We are safe to apply A2
  applyCredential({
    accessToken: data.token,
    accessExpiresAt: data.access_expires_at,
    absoluteSessionExpiresAt: data.absolute_session_expires_at,
    sessionId: data.session_id,
    userId: data.user?.id ?? active?.userId ?? '',
    organizationId: data.organization?.id ?? null,
  });
}

// Proactive scheduler
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
type RefreshCallback = () => Promise<void>;
let registeredRefreshCallback: RefreshCallback | null = null;

export function installAuthScheduler(onRefresh: RefreshCallback) {
  registeredRefreshCallback = onRefresh;
  if (active) {
    scheduleAuthRefresh(active);
  }
}

function cancelAuthRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleAuthRefresh(snapshot: MobileCredentialSnapshot) {
  cancelAuthRefresh();
  
  const expiresInMs = accessExpiresInMs();
  if (expiresInMs === null) return;

  // Refresh 2 minutes before it expires, or immediately if < 2 mins left
  const timeoutMs = Math.max(0, expiresInMs - 120_000);
  
  // Cap at max 32-bit integer for setTimeout
  const safeTimeoutMs = Math.min(timeoutMs, 2147483647);

  refreshTimer = setTimeout(() => {
    if (registeredRefreshCallback && isSameCredentialScope(snapshot)) {
      registeredRefreshCallback().catch(() => {
        // We do not throw to global scope on proactive background refresh failures
      });
    }
  }, safeTimeoutMs);
}

export async function storeRefreshSecret(refreshToken: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
  } catch (err) {
    throw new DomainError('No se pudo proteger la sesión en este dispositivo.');
  }
}

export async function purgeSecureRefresh(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {
    // Best effort
  }
}

export function __resetMobileAuthRuntimeForTests(): void {
  cancelAuthRefresh();
  registeredRefreshCallback = null;
  active = null;
  generationCounter = 0;
  activeRefreshPromise = null;
}
