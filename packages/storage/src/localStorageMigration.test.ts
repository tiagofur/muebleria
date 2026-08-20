import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSeedWorkspace } from './seed';
import { migrateWorkspace } from './migrateWorkspace';
import { LocalStorageWorkspaceRepository } from './localStorageWorkspaceRepository';

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

const GUEST_KEY = 'muebles_guest_workspace';

describe('migrateWorkspace (F116 C6)', () => {
  it('drops stale per-part grain from a v1 workspace', () => {
    const seed = createSeedWorkspace();
    // Simulate a v1 payload: grain stored on board parts, no schemaVersion.
    // Modern seeds keep board parts inside components; a real v1 payload had
    // them directly on the module, so inject one synthetic v1 module.
    const v1Module = {
      id: 'mod-v1',
      code: 'MOD-V1',
      name: 'Modulo v1',
      optionRoles: [],
      boardParts: [{ id: 'p1', code: 'P1', qty: 1, lengthMm: 500, widthMm: 400, thicknessMm: 18, grain: true }],
    };
    const v1 = {
      ...seed,
      schemaVersion: undefined,
      catalog: {
        ...seed.catalog,
        modules: [...seed.catalog.modules, v1Module],
      },
    } as unknown as Parameters<typeof migrateWorkspace>[0];

    const migrated = migrateWorkspace(v1);
    expect(migrated.schemaVersion).toBeGreaterThanOrEqual(2);
    // Untyped on purpose: v1 payloads predate the current Module shape.
    const mods = migrated.catalog.modules as unknown as {
      boardParts?: { [k: string]: unknown }[];
    }[];
    for (const mod of mods) {
      for (const part of mod.boardParts ?? []) {
        expect('grain' in part).toBe(false);
      }
    }
  });

  it('backfills structure revision/history on a v2 workspace', () => {
    const seed = createSeedWorkspace();
    const v2 = {
      ...seed,
      schemaVersion: 2,
      catalog: {
        ...seed.catalog,
        structures: (seed.catalog.structures ?? []).map((s) => ({
          ...(s as unknown as Record<string, unknown>),
          revision: undefined,
          history: undefined,
        })),
      },
    } as unknown as Parameters<typeof migrateWorkspace>[0];

    const migrated = migrateWorkspace(v2);
    expect(migrated.schemaVersion).toBe(3);
    for (const s of migrated.catalog.structures ?? []) {
      expect((s as unknown as { revision?: number }).revision).toBe(1);
      expect((s as unknown as { history?: unknown[] }).history).toEqual([]);
    }
  });
});

describe('LocalStorageWorkspaceRepository — guest migration (F116 C6)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  it('migrates a stale guest workspace on load', async () => {
    const seed = createSeedWorkspace();
    const stale = {
      ...seed,
      schemaVersion: 1,
      catalog: {
        ...seed.catalog,
        modules: [
          ...seed.catalog.modules,
          {
            id: 'mod-v1',
            code: 'MOD-V1',
            name: 'Modulo v1',
            optionRoles: [],
            boardParts: [{ id: 'p1', code: 'P1', qty: 1, lengthMm: 500, widthMm: 400, thicknessMm: 18, grain: true }],
          },
        ],
      },
    };
    globalThis.localStorage.setItem(GUEST_KEY, JSON.stringify(stale));

    const repo = new LocalStorageWorkspaceRepository();
    const ws = await repo.load();

    expect(ws.schemaVersion).toBeGreaterThanOrEqual(3);
    const mods = ws.catalog.modules as unknown as {
      boardParts?: { [k: string]: unknown }[];
    }[];
    for (const mod of mods) {
      for (const part of mod.boardParts ?? []) {
        expect('grain' in part).toBe(false);
      }
    }
  });
});
