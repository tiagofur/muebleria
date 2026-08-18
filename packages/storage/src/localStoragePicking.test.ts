import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalStorageWorkspaceRepository } from './localStorageWorkspaceRepository';

/** Minimal Storage-compatible fake backed by a plain map. */
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  } as Storage;
}

describe('LocalStorageWorkspaceRepository — picking (Fase 3)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  it('starts with no picking states', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    expect(await repo.listPickingStates()).toEqual([]);
  });

  it('persists despachado and stamps markedAt in guest mode', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    await repo.setProjectPickingState({
      projectId: 'p1',
      material: 'herrajes',
      status: 'despachado',
    });

    const states = await repo.listPickingStates();
    expect(states).toHaveLength(1);
    expect(states[0]?.projectId).toBe('p1');
    expect(states[0]?.material).toBe('herrajes');
    expect(states[0]?.status).toBe('despachado');
    expect(states[0]?.markedAt).toBeTruthy();
  });

  it('survives across repository instances (same localStorage)', async () => {
    const first = new LocalStorageWorkspaceRepository();
    await first.setProjectPickingState({
      projectId: 'p1',
      material: 'tableros',
      status: 'despachado',
    });

    const second = new LocalStorageWorkspaceRepository();
    const states = await second.listPickingStates();
    expect(states).toHaveLength(1);
    expect(states[0]?.projectId).toBe('p1');
    expect(states[0]?.material).toBe('tableros');
    expect(states[0]?.status).toBe('despachado');
  });

  it('upserts by project × material key (no duplicates)', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    await repo.setProjectPickingState({
      projectId: 'p1',
      material: 'herrajes',
      status: 'despachado',
    });
    await repo.setProjectPickingState({
      projectId: 'p1',
      material: 'herrajes',
      status: 'pendiente',
    });
    await repo.setProjectPickingState({
      projectId: 'p1',
      material: 'cintillas',
      status: 'despachado',
    });

    const states = await repo.listPickingStates();
    expect(states).toHaveLength(2);
    const herrajes = states.find((s) => s.material === 'herrajes');
    expect(herrajes?.status).toBe('pendiente');
    // pendiente clears the despacho stamp (server parity)
    expect(herrajes?.markedAt).toBeUndefined();
    expect(herrajes?.markedBy).toBeUndefined();
    const cintillas = states.find((s) => s.material === 'cintillas');
    expect(cintillas?.status).toBe('despachado');
    expect(cintillas?.markedAt).toBeTruthy();
  });
});
