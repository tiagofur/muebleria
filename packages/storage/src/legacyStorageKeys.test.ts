import { describe, it, expect } from 'vitest';
import { migrateLegacyStorageKeys } from './legacyStorageKeys';

/** Minimal Storage-compatible fake backed by a plain map. */
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, string) => {
      store.set(k, string);
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  } as Storage;
}

describe('migrateLegacyStorageKeys (#366 guest keys + #460 SEC-4B bearer discard)', () => {
  it('migra las claves guest y destruye los bearers legacy (never migrate, never send)', () => {
    const local = createStorage();
    const session = createStorage();
    local.setItem('muebles_token', 'legacy-jwt');
    local.setItem('granete_token', 'newer-legacy-jwt');
    local.setItem('muebles_user', '{"id":"u1"}');
    local.setItem('granete_user', '{"id":"u1"}');
    local.setItem('muebles_guest_workspace', '{"schemaVersion":2}');
    local.setItem('muebles_guest_po_counter', '7');
    session.setItem('muebles_session', 'auth');

    migrateLegacyStorageKeys(local, session);

    // Los datos guest legítimos migran.
    expect(local.getItem('granete_guest_workspace')).toBe('{"schemaVersion":2}');
    expect(local.getItem('granete_guest_po_counter')).toBe('7');
    expect(session.getItem('granete_session')).toBe('auth');
    expect(local.getItem('muebles_guest_workspace')).toBeNull();
    expect(local.getItem('muebles_guest_po_counter')).toBeNull();
    expect(session.getItem('muebles_session')).toBeNull();
    // Los bearers/metadata de auth se DESTRUYEN: ni migrados ni conservados.
    expect(local.getItem('granete_token')).toBeNull();
    expect(local.getItem('muebles_token')).toBeNull();
    expect(local.getItem('granete_user')).toBeNull();
    expect(local.getItem('muebles_user')).toBeNull();
  });

  it('es idempotente: correr dos veces no duplica ni revive nada', () => {
    const local = createStorage();
    local.setItem('muebles_guest_workspace', '{"schemaVersion":2}');
    migrateLegacyStorageKeys(local, createStorage());
    migrateLegacyStorageKeys(local, createStorage());
    expect(local.getItem('granete_guest_workspace')).toBe('{"schemaVersion":2}');
    expect(local.length).toBe(1);
  });

  it('si la clave nueva ya existe, gana la nueva (la vieja se descarta)', () => {
    const local = createStorage();
    local.setItem('muebles_guest_stock', '[{"old":true}]');
    local.setItem('granete_guest_stock', '[{"new":true}]');

    migrateLegacyStorageKeys(local, createStorage());

    expect(local.getItem('granete_guest_stock')).toBe('[{"new":true}]');
    expect(local.getItem('muebles_guest_stock')).toBeNull();
  });

  it('un bearer legacy solo (sin nada más) desaparece en el boot', () => {
    const local = createStorage();
    local.setItem('granete_token', 'valid-looking-old-jwt');
    migrateLegacyStorageKeys(local, createStorage());
    expect(local.getItem('granete_token')).toBeNull();
    expect(local.length).toBe(0);
  });

  it('tolera stores null (entorno sin storage) sin romper', () => {
    expect(() => migrateLegacyStorageKeys(null, null)).not.toThrow();
  });

  it('una clave que falla al escribir no bloquea las demás (best effort)', () => {
    const failing = createStorage();
    const originalSet = failing.setItem.bind(failing);
    failing.setItem = (k: string, v: string) => {
      if (k === 'granete_guest_picking') throw new Error('quota');
      originalSet(k, v);
    };
    failing.setItem('muebles_guest_picking', '{}');
    failing.setItem('muebles_guest_suppliers', '[]');

    expect(() => migrateLegacyStorageKeys(failing, createStorage())).not.toThrow();

    // La clave que no se pudo migrar conserva su valor viejo; el resto migra.
    expect(failing.getItem('muebles_guest_picking')).toBe('{}');
    expect(failing.getItem('granete_guest_suppliers')).toBe('[]');
    expect(failing.getItem('muebles_guest_suppliers')).toBeNull();
  });
});
