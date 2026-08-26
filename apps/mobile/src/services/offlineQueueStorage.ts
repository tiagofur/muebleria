/**
 * Persistent offline storage for the floor-scan queue (F091 item 2).
 * AsyncStorage-backed (small bounded JSON); graceful no-op on web/test
 * environments where the module is unavailable.
 */

import type { ItemFloorStatus } from '@granete/domain';

const QUEUE_KEY = 'granete_floor_queue_v1';
const STATUSES_KEY = 'granete_floor_statuses_v1';
const ACTIVE_PROJECT_KEY = 'granete_floor_active_project_v1';

/** #366 — claves legacy muebles_* migradas a granete_* al inyectar el storage. */
const LEGACY_QUEUE_KEYS: Readonly<Record<string, string>> = {
  muebles_floor_queue_v1: QUEUE_KEY,
  muebles_floor_statuses_v1: STATUSES_KEY,
  muebles_floor_active_project_v1: ACTIVE_PROJECT_KEY,
};

export interface PersistedPendingScan {
  readonly rawText: string;
  readonly advance: boolean;
  readonly at: string;
  /** Target status for module-label scans that set one (Fase 3 target_status). */
  readonly targetStatus?: ItemFloorStatus;
}

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

let storage: AsyncStorageLike | null = null;

/** Leer-viejo → escribir-nuevo → borrar-viejo; idempotente y best-effort. */
async function migrateLegacyQueueKeys(): Promise<void> {
  if (!storage) return;
  for (const [oldKey, newKey] of Object.entries(LEGACY_QUEUE_KEYS)) {
    try {
      const raw = await storage.getItem(oldKey);
      if (raw === null) continue;
      if ((await storage.getItem(newKey)) === null) {
        await storage.setItem(newKey, raw);
      }
      await storage.removeItem(oldKey);
    } catch {
      // best effort por clave
    }
  }
}

/** Inject the storage implementation (App) or a mock (tests). */
export function setOfflineQueueStorage(instance: AsyncStorageLike | null): void {
  storage = instance;
  if (instance) void migrateLegacyQueueKeys();
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  if (!storage) return fallback;
  try {
    const raw = await storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  if (!storage) return;
  try {
    await storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full/unavailable — the in-memory queue still works this session.
  }
}

export function loadPendingScans(): Promise<PersistedPendingScan[]> {
  return readJson<PersistedPendingScan[]>(QUEUE_KEY, []).then((list) =>
    Array.isArray(list) ? list.filter((s) => s && typeof s.rawText === 'string') : [],
  );
}

export function savePendingScans(scans: readonly PersistedPendingScan[]): void {
  void writeJson(QUEUE_KEY, scans);
}

export function loadItemStatuses(): Promise<Record<string, ItemFloorStatus>> {
  return readJson<Record<string, ItemFloorStatus>>(STATUSES_KEY, {});
}

export function saveItemStatuses(statuses: Readonly<Record<string, ItemFloorStatus>>): void {
  void writeJson(STATUSES_KEY, statuses);
}

export function loadActiveProjectId(): Promise<string | null> {
  return readJson<string | null>(ACTIVE_PROJECT_KEY, null);
}

export function saveActiveProjectId(projectId: string | null): void {
  if (projectId === null) {
    if (storage) void storage.removeItem(ACTIVE_PROJECT_KEY).catch(() => undefined);
    return;
  }
  void writeJson(ACTIVE_PROJECT_KEY, projectId);
}
