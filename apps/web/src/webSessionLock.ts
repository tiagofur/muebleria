/**
 * webSessionLock — serialización cross-tab de TODA mutación de la sesión Web
 * compartida (#460 SEC-4B): refresh (rotación de cookie), logout y select-org.
 *
 * SEC-2A mantiene strict single-use rotation server-side: dos pestañas
 * rotando la MISMA cookie concurrentemente son un replay y revocan la familia
 * entera. La serialización es, por tanto, un prerequisito del cutover — nunca
 * una relajación server-side (ADR-0007 §9).
 *
 * Estrategia:
 * 1. `navigator.locks` (Web Locks API) con un lock global exclusivo
 *    `granete:web-session-mutation` — el primitivo real del browser.
 * 2. Fallback sin Web Locks: lease NO SECRETO en localStorage (tab id random
 *    + expiry) con verify-after-write y takeover de leases vencidos (algoritmo
 *    tipo browser-tabs-lock). El lease nunca contiene tokens ni datos de
 *    usuario; sólo `{ holder, expiresAt }`.
 *
 * Además del boundary cross-tab, cada pestaña serializa sus propias
 * mutaciones con una cola in-tab (promise chain): dos actores del MISMO
 * runtime tampoco pueden rotar concurrentemente.
 */

const LOCK_NAME = 'granete:web-session-mutation';
const LEASE_KEY = 'granete:web-session-lock';
const LEASE_TTL_MS = 15_000;
const RETRY_BASE_MS = 25;
const RETRY_JITTER_MS = 25;

interface WebLocks {
  request(name: string, callback: () => Promise<void>): Promise<void>;
}

let forceLocalStorageLease = false;

function webLocks(): WebLocks | null {
  if (forceLocalStorageLease) return null;
  const candidate = (globalThis as { navigator?: { locks?: unknown } }).navigator?.locks;
  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof (candidate as WebLocks).request === 'function'
  ) {
    return candidate as WebLocks;
  }
  return null;
}

function randomTabId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const tabId = randomTabId();

// Cola in-tab: todas las mutaciones de esta pestaña pasan por acá, una por vez.
let inTabQueue: Promise<unknown> = Promise.resolve();

export function withWebSessionMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = inTabQueue.then(
    () => acquireCrossTabAndRun(mutation),
    () => acquireCrossTabAndRun(mutation),
  );
  // La cola sigue aunque una mutación previa haya fallado.
  inTabQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function acquireCrossTabAndRun<T>(mutation: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  if (locks === null) {
    return withLocalStorageLease(mutation);
  }
  // Web Locks: el browser encola el callback hasta tener el lock exclusivo.
  let carried: { value: T } | null = null;
  await locks.request(LOCK_NAME, async () => {
    const value = await mutation();
    carried = { value };
  });
  return (carried as { value: T } | null)!.value;
}

// --- Fallback: lease no secreto en localStorage --------------------------------

interface Lease {
  readonly holder: string;
  readonly expiresAt: number;
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      // El valor puede existir como undefined (jsdom lo declara sin
      // implementarlo): sin un Storage real no hay lease posible.
      const store = globalThis.localStorage;
      if (store != null && typeof store.getItem === 'function') {
        return store;
      }
    }
  } catch {
    // storage deshabilitado
  }
  return null;
}

function readLease(store: Storage): Lease | null {
  try {
    const raw = store.getItem(LEASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Lease>;
    if (typeof parsed.holder !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return { holder: parsed.holder, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function writeLease(store: Storage, lease: Lease): string | null {
  try {
    const serialized = JSON.stringify(lease);
    store.setItem(LEASE_KEY, serialized);
    return serialized;
  } catch {
    return null;
  }
}

/**
 * Intento de adquisición con verify-after-write: el claim sólo gana si el
 * read-back devuelve EXACTAMENTE lo escrito (localStorage serializa cada
 * operación por origin: el último writer se lleva el lease y los demás ven un
 * holder ajeno en su siguiente intento).
 */
function tryAcquireLease(store: Storage, now: number): boolean {
  const current = readLease(store);
  if (current !== null && current.holder !== tabId && current.expiresAt > now) {
    return false; // lease vivo de otra pestaña
  }
  const serialized = writeLease(store, { holder: tabId, expiresAt: now + LEASE_TTL_MS });
  if (serialized === null) return false;
  try {
    return store.getItem(LEASE_KEY) === serialized;
  } catch {
    return false;
  }
}

function releaseLease(store: Storage): void {
  try {
    const current = readLease(store);
    // Sólo libera si el lease sigue siendo nuestro (no pisar un takeover).
    if (current !== null && current.holder === tabId) {
      store.removeItem(LEASE_KEY);
    }
  } catch {
    // best-effort: el TTL vence el lease solo
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLocalStorageLease<T>(mutation: () => Promise<T>): Promise<T> {
  const store = safeLocalStorage();
  if (store === null) {
    // Sin storage no hay primitivo compartido: ejecutar igual (un contexto
    // sin localStorage no comparte la cookie de forma útil, y bloquear para
    // siempre sería peor).
    return mutation();
  }
  // Renovación del lease durante mutaciones largas: mantiene la exclusión sin
  // depender de que la mutación termine antes del TTL.
  let renewTimer: ReturnType<typeof setInterval> | null = null;
  try {
    for (;;) {
      if (tryAcquireLease(store, Date.now())) break;
      await sleep(RETRY_BASE_MS + Math.random() * RETRY_JITTER_MS);
    }
    renewTimer = setInterval(() => {
      try {
        const current = readLease(store);
        if (current !== null && current.holder === tabId) {
          writeLease(store, { holder: tabId, expiresAt: Date.now() + LEASE_TTL_MS });
        }
      } catch {
        // best-effort
      }
    }, Math.floor(LEASE_TTL_MS / 3));
    return await mutation();
  } finally {
    if (renewTimer !== null) clearInterval(renewTimer);
    releaseLease(store);
  }
}

/** Test-only: fuerza el path de fallback aunque exista navigator.locks. */
export function __forceLocalStorageLeaseForTests(force: boolean): void {
  forceLocalStorageLease = force;
}
