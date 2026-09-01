/**
 * #366 — rename de marca Muebles → Granete para las claves de storage, y
 * #460 SEC-4B para las credenciales legacy.
 *
 * Dos políticas distintas:
 * - Datos guest legítimos (workspace, picking, stock, suppliers, purchase
 *   orders, contadores): migración one-shot leer-viejo → escribir-nuevo →
 *   borrar-viejo. Nadie pierde su workspace invitado.
 * - Bearers/metadata de auth legacy (`muebles_token`, `granete_token`,
 *   `muebles_user`, `granete_user`): DISCARD. Nunca se migran ni se leen; el
 *   boot los destruye apenas arranca. La sesión Web vive en la cookie HttpOnly
 *   (`granete_web_refresh`) + memoria — un bearer viejo en localStorage es
 *   superficie de robo, no una credencial.
 */

const LEGACY_LOCAL_STORAGE_KEYS: Readonly<Record<string, string>> = {
  muebles_guest_workspace: 'granete_guest_workspace',
  muebles_guest_picking: 'granete_guest_picking',
  muebles_guest_stock: 'granete_guest_stock',
  muebles_guest_stock_movements: 'granete_guest_stock_movements',
  muebles_guest_suppliers: 'granete_guest_suppliers',
  muebles_guest_purchase_orders: 'granete_guest_purchase_orders',
  muebles_guest_po_counter: 'granete_guest_po_counter',
  muebles_seed_perf_reference: 'granete_seed_perf_reference',
};

const LEGACY_SESSION_STORAGE_KEYS: Readonly<Record<string, string>> = {
  muebles_session: 'granete_session',
};

/**
 * Claves de bearer/metadata legacy que se DESTRUYEN en el boot (#460
 * SEC-4B): `old localStorage bearer → DELETE → NEVER SEND`.
 */
export const DISCARDED_CREDENTIAL_STORAGE_KEYS: readonly string[] = [
  'muebles_token',
  'granete_token',
  'muebles_user',
  'granete_user',
];

function migrateStore(
  store: Storage | null | undefined,
  keys: Readonly<Record<string, string>>,
): void {
  if (!store) return;
  for (const [oldKey, newKey] of Object.entries(keys)) {
    try {
      const raw = store.getItem(oldKey);
      if (raw === null) continue;
      if (store.getItem(newKey) === null) {
        store.setItem(newKey, raw);
      }
      store.removeItem(oldKey);
    } catch {
      // storage disabled / quota — best effort por clave
    }
  }
}

function discardCredentialKeys(store: Storage | null | undefined): void {
  if (!store) return;
  for (const key of DISCARDED_CREDENTIAL_STORAGE_KEYS) {
    try {
      store.removeItem(key);
    } catch {
      // best-effort: nunca romper el boot
    }
  }
}

/**
 * Arranque de storage: destruye credenciales legacy (nunca migradas) y migra
 * las claves guest `muebles_*` a `granete_*`. Debe correr una vez al arrancar
 * la app, antes de que nada lea storage. Acepta stores inyectables para
 * tests.
 */
export function migrateLegacyStorageKeys(
  localStore: Storage | null | undefined = defaultLocalStorage(),
  sessionStore: Storage | null | undefined = defaultSessionStorage(),
): void {
  discardCredentialKeys(localStore);
  migrateStore(localStore, LEGACY_LOCAL_STORAGE_KEYS);
  migrateStore(sessionStore, LEGACY_SESSION_STORAGE_KEYS);
}

function defaultLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

function defaultSessionStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'sessionStorage' in globalThis) {
      return globalThis.sessionStorage;
    }
  } catch {
    // ignore
  }
  return null;
}
