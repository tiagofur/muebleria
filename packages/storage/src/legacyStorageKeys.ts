/**
 * #366 — rename de marca Muebles → Granete: las claves de storage pasaron de
 * `muebles_*` a `granete_*`. Migración one-shot leer-viejo → escribir-nuevo →
 * borrar-viejo, para que nadie se desloguee ni pierda el workspace invitado.
 *
 * Idempotente: si la clave nueva ya existe, gana la nueva y la vieja se borra.
 * Best-effort: storage deshabilitado o con quota llena no debe romper el boot.
 */

const LEGACY_LOCAL_STORAGE_KEYS: Readonly<Record<string, string>> = {
  muebles_token: 'granete_token',
  muebles_user: 'granete_user',
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

/**
 * Migra las claves legacy `muebles_*` a `granete_*` en localStorage y
 * sessionStorage. Debe correr una vez al arrancar la app, antes de que nada
 * lea storage. Acepta stores inyectables para tests.
 */
export function migrateLegacyStorageKeys(
  localStore: Storage | null | undefined = defaultLocalStorage(),
  sessionStore: Storage | null | undefined = defaultSessionStorage(),
): void {
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
