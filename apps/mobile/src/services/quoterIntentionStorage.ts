/**
 * Persistent save intention for the express quoter (#715): the uncommitted
 * "quote + new customer" intention (payload digest + project id) survives
 * app restart/crash after an ambiguous outcome (lost response post-commit),
 * so the retry reuses the same project id (409 ⇒ authoritative read-back)
 * instead of minting a duplicate Customer + Project pair.
 *
 * Same mechanism as offlineQueueStorage: AsyncStorage-backed tiny JSON,
 * injected from App (or a mock in tests); graceful no-op when unavailable.
 * Only the technical evidence is persisted — no tokens, no customer/project
 * payload.
 *
 * FAIL-CLOSED semantics (#715 review): the durable write must CONFIRM
 * before POST /projects is sent — a persistence failure yields 0 requests,
 * 0 customers, 0 projects, never a best-effort continue. A load failure,
 * invalid JSON or corrupt persisted row is an error, NOT a legitimate
 * "no intention": there may be an unrecoverable prior commit behind it, so
 * the caller must not mint a fresh project id silently.
 */

const INTENTION_KEY = 'granete_quoter_intention_v1';

export interface PersistedSaveIntention {
  readonly fingerprint: string;
  readonly projectId: string;
}

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

let storage: AsyncStorageLike | null = null;

/** Inject the storage implementation (App) or a mock (tests). */
export function setQuoterIntentionStorage(instance: AsyncStorageLike | null): void {
  storage = instance;
}

function isValidProjectId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * Resolve the persisted intention. `null` means the key is legitimately
 * ABSENT. Any other outcome — unavailable backend, read failure, invalid
 * JSON, corrupt row — REJECTS: the caller must fail closed instead of
 * minting a new id that could duplicate an unrecoverable prior commit.
 */
export async function loadPersistedIntention(): Promise<PersistedSaveIntention | null> {
  if (!storage) {
    throw new Error('Persistencia local de la intención no disponible');
  }
  let raw: string | null;
  try {
    raw = await storage.getItem(INTENTION_KEY);
  } catch {
    throw new Error('No se pudo leer la intención de guardado persistida');
  }
  if (raw === null) return null;
  let parsed: Partial<PersistedSaveIntention>;
  try {
    parsed = JSON.parse(raw) as Partial<PersistedSaveIntention>;
  } catch {
    throw new Error('La intención de guardado persistida está corrupta');
  }
  if (
    typeof parsed?.fingerprint === 'string' &&
    parsed.fingerprint.length > 0 &&
    isValidProjectId(parsed.projectId)
  ) {
    return { fingerprint: parsed.fingerprint, projectId: parsed.projectId };
  }
  throw new Error('La intención de guardado persistida es inválida');
}

/**
 * Durable write — FAIL-CLOSED: rejects (no swallowed catch) when the backend
 * is unavailable or the write fails. The caller may only POST /projects
 * after this resolves.
 */
export function savePersistedIntention(
  intention: PersistedSaveIntention,
): Promise<void> {
  if (!storage) {
    return Promise.reject(
      new Error('Persistencia local de la intención no disponible'),
    );
  }
  return storage.setItem(INTENTION_KEY, JSON.stringify(intention));
}

/**
 * Tolerant BY DESIGN after a CONFIRMED success only: the committed pair is
 * server-owned and a stale row cannot duplicate it — a later same-payload
 * save reuses the id, gets 409 and reconciles to that SAME pair via the
 * validated read-back, while a changed payload overwrites the row.
 */
export function clearPersistedIntention(): Promise<void> {
  if (!storage) return Promise.resolve();
  return storage.removeItem(INTENTION_KEY).catch(() => undefined);
}
