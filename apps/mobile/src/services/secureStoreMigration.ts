import * as SecureStore from 'expo-secure-store';

/**
 * #366 — rename de marca Muebles → Granete: claves de SecureStore pasaron de
 * `muebles_*` a `granete_*`. Migración one-shot leer-viejo → escribir-nuevo →
 * borrar-viejo, memoizada; si la clave nueva ya existe, gana la nueva.
 * Best-effort: entornos sin SecureStore (tests/web) no fallan.
 */
const LEGACY_SECURE_STORE_KEYS: Readonly<Record<string, string>> = {
  muebles_auth_token: 'granete_auth_token',
  muebles_auth_user: 'granete_auth_user',
};

let migrated: Promise<void> | null = null;

export function ensureSecureStoreMigrated(): Promise<void> {
  migrated ??= (async () => {
    for (const [oldKey, newKey] of Object.entries(LEGACY_SECURE_STORE_KEYS)) {
      try {
        const raw = await SecureStore.getItemAsync(oldKey);
        if (raw === null) continue;
        const current = await SecureStore.getItemAsync(newKey);
        if (current === null) {
          await SecureStore.setItemAsync(newKey, raw);
        }
        await SecureStore.deleteItemAsync(oldKey);
      } catch {
        // SecureStore unavailable — best effort por clave
      }
    }
  })();
  return migrated;
}
