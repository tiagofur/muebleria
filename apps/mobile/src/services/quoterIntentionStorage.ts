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

export async function loadPersistedIntention(): Promise<PersistedSaveIntention | null> {
  if (!storage) return null;
  try {
    const raw = await storage.getItem(INTENTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSaveIntention>;
    if (
      typeof parsed?.fingerprint === 'string' &&
      parsed.fingerprint.length > 0 &&
      isValidProjectId(parsed.projectId)
    ) {
      return { fingerprint: parsed.fingerprint, projectId: parsed.projectId };
    }
    return null;
  } catch {
    return null;
  }
}

/** Best-effort write; storage failures never block the save flow. */
export function savePersistedIntention(
  intention: PersistedSaveIntention,
): Promise<void> {
  if (!storage) return Promise.resolve();
  return storage
    .setItem(INTENTION_KEY, JSON.stringify(intention))
    .catch(() => undefined);
}

/** Best-effort remove; a stale row self-heals via 409 read-back validation. */
export function clearPersistedIntention(): Promise<void> {
  if (!storage) return Promise.resolve();
  return storage.removeItem(INTENTION_KEY).catch(() => undefined);
}
