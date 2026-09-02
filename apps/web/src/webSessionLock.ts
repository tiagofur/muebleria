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
 * Mecanismo (#460 segunda revisión): `navigator.locks` (Web Locks API) con el
 * lock exclusivo `granete:web-session-mutation` — el ÚNICO primitivo usado en
 * producción. El browser administra la vida del lock con la vida del
 * document: una pestaña congelada MANTIENE el lock (nadie más entra) y una
 * pestaña muerta lo libera solo. Ningún lease con TTL: un TTL no puede
 * distinguir "holder muerto" de "holder suspendido/throttled", y un takeover
 * bajo TTL re-crearían dos mutaciones coexistentes (falso REFRESH_REUSED).
 *
 * Sin Web Locks (browser viejo/incompatible): FAIL CLOSED — la mutación NO se
 * ejecuta y se lanza WebSessionLockUnavailableError. Mejor bloquear una
 * rotación en un browser no compatible que arriesgar la revocación de la
 * sesión completa por un replay falso. Jamás se corre una mutación de cookie
 * sin exclusión mutua real.
 *
 * Además del boundary cross-tab, cada pestaña serializa sus propias
 * mutaciones con una cola in-tab (promise chain).
 */

const LOCK_NAME = 'granete:web-session-mutation';

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
 * pestaña posee la exclusión mutua (el holder anterior la liberó — o rechaza
 * si la primitiva no existe); el `release` devuelto la libera. Sin TTL, sin
 * takeover: semántica exacta de Web Locks.
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

// --- Web Locks API (único backend de producción) ----------------------------------

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
      // release, modelando acquire()/release(). El browser mantiene el lock
      // mientras el callback esté pendiente (pestaña congelada incluida).
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

// --- Resolución + instancias por pestaña ------------------------------------------

let injectedBackend: WebSessionLockBackend | null = null;

/** Test-only: fuerza un backend compartido (o null para resolución real). */
export function __setWebSessionLockBackendForTests(backend: WebSessionLockBackend | null): void {
  injectedBackend = backend;
}

function resolveBackend(): WebSessionLockBackend {
  if (injectedBackend !== null) return injectedBackend;
  const locks = webLocksBackend();
  if (locks !== null) return locks;
  // FAIL CLOSED: sin Web Locks no existe (para nosotros) una primitiva de
  // exclusión mutua segura — los leases con TTL no distinguen un holder
  // muerto de uno suspendido y NO se usan para mutaciones de cookie.
  throw new WebSessionLockUnavailableError(
    'navigator.locks no disponible: la mutación de sesión se rechaza (fail closed)',
  );
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
    void tabId; // identidad para el backend; sin secrets
    const release = await (backend ?? resolveBackend()).acquire(tabId);
    try {
      return await mutation();
    } finally {
      await release();
    }
  }
}

/** Singleton de producción (una identidad por pestaña). */
export const webSessionMutationLock: WebSessionMutationLock = createWebSessionMutationLock();

/** Delegado al singleton — wiring existente (webAuthClient/workspaceStore). */
export function withWebSessionMutation<T>(mutation: () => Promise<T>): Promise<T> {
  return webSessionMutationLock.withWebSessionMutation(mutation);
}

// --- Backend in-memory para tests --------------------------------------------------

/**
 * Test-only: backend in-memory con la semántica EXACTA de Web Locks —
 * FIFO puro, sin TTL, sin takeover: el holder libera o nadie entra. Guarda
 * observabilidad (`peakConcurrentHolders`) para los proofs de exclusión.
 */
export function createInMemoryWebSessionLockBackendForTests(): WebSessionLockBackend & {
  peakConcurrentHolders(): number;
} {
  let held = false;
  const waiters: Array<() => void> = [];
  let holders = 0;
  let peak = 0;
  return {
    acquire: async () => {
      if (held) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      held = true;
      holders += 1;
      peak = Math.max(peak, holders);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        holders -= 1;
        const next = waiters.shift();
        if (next !== undefined) {
          // Pasa el lock directamente al siguiente waiter (sigue held).
          next();
        } else {
          held = false;
        }
      };
    },
    peakConcurrentHolders: () => peak,
  };
}
