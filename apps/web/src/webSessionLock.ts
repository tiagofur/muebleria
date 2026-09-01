/**
 * webSessionLock — exclusión mutua REAL cross-tab para TODA mutación de la
 * sesión Web compartida (#460 SEC-4B): refresh (rotación de cookie), logout y
 * select-org.
 *
 * SEC-2A mantiene strict single-use rotation server-side: dos pestañas
 * rotando la MISMA cookie concurrentemente son un replay y revocan la familia
 * entera. La serialización es un prerequisito del cutover — nunca una
 * relajación server-side (ADR-0007 §9).
 *
 * Backends de coordinación (en orden; sólo metadata NO-secreta):
 *
 * 1. Web Locks API (`navigator.locks`): el primitivo real del browser, lock
 *    exclusivo `granete:web-session-mutation`.
 * 2. IndexedDB: adquisición por TRANSACCIÓN `readwrite` sobre un único
 *    registro (`get` + `put` dentro de la misma transacción). IndexedDB
 *    serializa las transacciones readwrite con scope solapado, por lo que el
 *    par check+write es atómico respecto de cualquier otra pestaña: es
 *    exclusión mutua genuina, no un lease read/write/verify (que DOS pestañas
 *    pueden ganar en interleaving). El registro guarda `{holder, expiresAt}`
 *    (tab id random + expiry) — jamás tokens ni datos de usuario. Un lease
 *    vencido se toma over dentro de la MISMA transacción (crash-safety), y un
 *    lock activo se renueva mientras la mutación corre.
 * 3. Sin Web Locks NI IndexedDB: FAIL CLOSED — la mutación NO se ejecuta y se
 *    lanza WebSessionLockUnavailableError. Nunca se corre una rotación de
 *    cookie sin exclusión mutua real.
 *
 * Además del boundary cross-tab, cada pestaña serializa sus propias
 * mutaciones con una cola in-tab (promise chain).
 */

const LOCK_NAME = 'granete:web-session-mutation';
const IDB_NAME = 'granete-session-coordination';
const IDB_STORE = 'mutation_lock';
const IDB_KEY = 'web-session-mutation';
const LEASE_TTL_MS = 15_000;
const RETRY_BASE_MS = 25;
const RETRY_JITTER_MS = 25;

/** La primitiva de coordinación no está disponible: mutación rechazada. */
export class WebSessionLockUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebSessionLockUnavailableError';
  }
}

type Release = () => Promise<void>;

/**
 * Contrato de un backend de coordinación: `acquire` resuelve sólo cuando esta
 * pestaña posee la exclusión mutua (o rechaza si la primitiva no existe); el
 * `release` devuelto la libera. La garantía requerida es exactamente
 * "at most un holder cross-tab a la vez".
 */
export interface WebSessionLockBackend {
  acquire(holder: string): Promise<Release>;
}

export interface WebSessionMutationLock {
  withWebSessionMutation<T>(mutation: () => Promise<T>): Promise<T>;
}

function randomTabId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Backend 1: Web Locks API ----------------------------------------------------

interface WebLocksLike {
  request(name: string, options: { mode: 'exclusive' }, callback: () => Promise<void>): Promise<void>;
}

function webLocksBackend(): WebSessionLockBackend | null {
  const candidate = (globalThis as { navigator?: { locks?: unknown } }).navigator?.locks;
  if (
    candidate != null &&
    typeof candidate === 'object' &&
    typeof (candidate as WebLocksLike).request === 'function'
  ) {
    const locks = candidate as WebLocksLike;
    return {
      // Promisificación del hold-based API: el callback bloquea hasta el
      // release, modelando acquire()/release().
      acquire: () =>
        new Promise<Release>((resolveAcquire, rejectAcquire) => {
          void locks
            .request(LOCK_NAME, { mode: 'exclusive' }, () => new Promise<void>((releaseHold) => {
              resolveAcquire(async () => {
                releaseHold();
              });
            }))
            .catch(rejectAcquire);
        }),
    };
  }
  return null;
}

// --- Backend 2: IndexedDB transactional lock --------------------------------------

interface CoordinationRecord {
  readonly holder: string;
  readonly expiresAt: number;
}

interface IDBDatabaseLike {
  transaction(storeNames: string, mode: 'readonly' | 'readwrite'): IDBTransactionLike;
}

interface IDBTransactionLike {
  objectStore(name: string): {
    get(key: string): IDBRequestLike<unknown>;
    put(value: unknown, key: string): IDBRequestLike<unknown>;
    delete(key: string): IDBRequestLike<unknown>;
  };
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

interface IDBRequestLike<T> {
  result: T;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

function openCoordinationDatabase(): Promise<IDBDatabaseLike> {
  return new Promise((resolve, reject) => {
    let factory: { open(name: string, version: number): unknown } | null = null;
    try {
      factory = (globalThis as { indexedDB?: { open(name: string, version: number): unknown } }).indexedDB ?? null;
    } catch {
      factory = null;
    }
    if (factory == null) {
      reject(new WebSessionLockUnavailableError('IndexedDB no disponible'));
      return;
    }
    let request: { onsuccess: (() => void) | null; onerror: (() => void) | null; onupgradeneeded: (() => void) | null; result: unknown; error: unknown; transaction: unknown };
    try {
      request = factory.open(IDB_NAME, 1) as typeof request;
    } catch (error) {
      reject(new WebSessionLockUnavailableError(`IndexedDB open rechazado: ${String(error)}`));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result as { createObjectStore(name: string): unknown };
      try {
        (db.createObjectStore(IDB_STORE) as { createIndex: unknown });
      } catch {
        // ya existía (upgrade concurrente de otra pestaña)
      }
    };
    request.onsuccess = () => resolve(request.result as IDBDatabaseLike);
    request.onerror = () =>
      reject(new WebSessionLockUnavailableError('IndexedDB no accesible (denegado/quota)'));
  });
}

/** Una transacción readwrite: check + write atómicos respecto de otras tabs. */
function tryAcquireRecord(db: IDBDatabaseLike, holder: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const get = store.get(IDB_KEY);
    let acquired = false;
    get.onsuccess = () => {
      const record = get.result as CoordinationRecord | undefined;
      const now = Date.now();
      // Held por OTRA pestaña y vivo (TTL) → esperar. Libre, propio o vencido
      // (crash de la holder) → reclamar. Ambos pasos dentro de la misma
      // transacción serializada: nadie más puede interponer un claim.
      acquired = !(record && record.holder !== holder && record.expiresAt > now);
      if (acquired) {
        store.put({ holder, expiresAt: now + LEASE_TTL_MS }, IDB_KEY);
      }
    };
    get.onerror = () => reject(new WebSessionLockUnavailableError('lock get falló'));
    tx.oncomplete = () => resolve(acquired);
    tx.onerror = () => reject(new WebSessionLockUnavailableError('lock txn falló'));
    tx.onabort = () => reject(new WebSessionLockUnavailableError('lock txn abortada'));
  });
}

function renewRecord(db: IDBDatabaseLike, holder: string): void {
  // Best-effort dentro de su propia transacción serializada; sólo extiende si
  // el lock sigue siendo de esta pestaña (no pisar un takeover post-TTL).
  const tx = db.transaction(IDB_STORE, 'readwrite');
  const store = tx.objectStore(IDB_STORE);
  const get = store.get(IDB_KEY);
  get.onsuccess = () => {
    const record = get.result as CoordinationRecord | undefined;
    if (record && record.holder === holder) {
      store.put({ holder, expiresAt: Date.now() + LEASE_TTL_MS }, IDB_KEY);
    }
  };
}

function releaseRecord(db: IDBDatabaseLike, holder: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const get = store.get(IDB_KEY);
      get.onsuccess = () => {
        const record = get.result as CoordinationRecord | undefined;
        if (record && record.holder === holder) {
          store.delete(IDB_KEY);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // best-effort: el TTL vence el registro solo
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Backend IndexedDB: siempre construible; la disponibilidad REAL (open puede
 * estar denegado) se descubre en acquire → WebSessionLockUnavailableError.
 */
function indexedDbBackend(): WebSessionLockBackend {
  let opened: Promise<IDBDatabaseLike> | null = null;
  const database = () => {
    if (opened === null) {
      opened = openCoordinationDatabase();
      opened.catch(() => {
        opened = null; // permite reintentar si el contexto cambia
      });
    }
    return opened;
  };
  return {
    acquire: async (holder: string) => {
      const db = await database();
      for (;;) {
        if (await tryAcquireRecord(db, holder)) break;
        await sleep(RETRY_BASE_MS + Math.random() * RETRY_JITTER_MS);
      }
      // Renovación mientras la mutación corre: mantiene la exclusión sin
      // depender de que termine antes del TTL.
      const renewTimer = setInterval(() => {
        try {
          renewRecord(db, holder);
        } catch {
          // best-effort
        }
      }, Math.floor(LEASE_TTL_MS / 3));
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        clearInterval(renewTimer);
        await releaseRecord(db, holder);
      };
    },
  };
}

// --- Instancias por pestaña + backend global --------------------------------------

let injectedBackend: WebSessionLockBackend | null = null;

/** Test-only: fuerza un backend compartido (o null para resolución real). */
export function __setWebSessionLockBackendForTests(backend: WebSessionLockBackend | null): void {
  injectedBackend = backend;
}

function resolveBackend(): WebSessionLockBackend {
  if (injectedBackend !== null) return injectedBackend;
  const locks = webLocksBackend();
  if (locks !== null) return locks;
  // El backend IndexedDB difiere la disponibilidad real al acquire (open puede
  // estar denegado): ahí FAIL CLOSED con WebSessionLockUnavailableError.
  return indexedDbBackend();
}

/**
 * Crea un runtime de lock por pestaña (tab identity + cola in-tab propios).
 * Los runtimes sólo comparten el backend de coordinación.
 */
export function createWebSessionMutationLock(options: {
  readonly backend?: WebSessionLockBackend;
  readonly tabId?: string;
} = {}): WebSessionMutationLock {
  const tabId = options.tabId ?? randomTabId();
  const backend = options.backend;
  let inTabQueue: Promise<unknown> = Promise.resolve();

  return {
    withWebSessionMutation<T>(mutation: () => Promise<T>): Promise<T> {
      const run = inTabQueue.then(
        () => runUnderBackend(mutation),
        () => runUnderBackend(mutation),
      );
      inTabQueue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };

  async function runUnderBackend<T>(mutation: () => Promise<T>): Promise<T> {
    const coordination = backend ?? resolveBackend();
    const release = await coordination.acquire(tabId);
    try {
      return await mutation();
    } finally {
      await release();
    }
  }
}

/** Singleton de producción (una identidad por pestaña). */
export const webSessionMutationLock: WebSessionMutationLock = createWebSessionMutationLock();

/** Delegado al singleton — wiring existente (webAuthClient). */
export function withWebSessionMutation<T>(mutation: () => Promise<T>): Promise<T> {
  return webSessionMutationLock.withWebSessionMutation(mutation);
}

// --- Backend in-memory para tests --------------------------------------------------

/**
 * Test-only: backend in-memory que modela la garantía de los reales — cada
 * intento de adquisición ejecuta check+write atómicamente y las adquisiciones
 * se serializan (como transacciones readwrite solapadas). Guarda un registro
 * de observabilidad (`peakConcurrentHolders`) para los proofs de exclusión.
 */
export function createInMemoryWebSessionLockBackendForTests(options: {
  readonly ttlMs?: number;
} = {}): WebSessionLockBackend & {
  peakConcurrentHolders(): number;
} {
  const ttlMs = options.ttlMs ?? LEASE_TTL_MS;
  let record: CoordinationRecord | null = null;
  let holders = 0;
  let peak = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const acquireOnce = (holder: string): Promise<boolean> =>
    new Promise((resolve) => {
      // Serializa cada intento completo (check+write): la unidad de
      // atomicidad que IndexedDB garantizan por transacción.
      queue = queue.then(() => {
        const now = Date.now();
        if (record && record.holder !== holder && record.expiresAt > now) {
          return false;
        }
        record = { holder, expiresAt: now + ttlMs };
        return true;
      });
      void queue.then(
        (acquired) => resolve(acquired === true),
        () => resolve(false),
      );
    });
  return {
    acquire: async (holder: string) => {
      for (;;) {
        if (await acquireOnce(holder)) break;
        await sleep(RETRY_BASE_MS + Math.random() * RETRY_JITTER_MS);
      }
      holders += 1;
      peak = Math.max(peak, holders);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        holders -= 1;
        await new Promise<void>((resolve) => {
          queue = queue.then(() => {
            if (record && record.holder === holder) record = null;
            resolve();
          });
        });
      };
    },
    peakConcurrentHolders: () => peak,
  };
}
