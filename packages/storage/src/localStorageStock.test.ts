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

describe('LocalStorageWorkspaceRepository — stock (Fase 3b)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  it('starts with no stock rows', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    expect(await repo.getStock()).toEqual([]);
  });

  it('entrada creates the row and records the ledger movement', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    const mov = await repo.recordStockMovement({
      kind: 'herrajes',
      materialId: 'h1',
      type: 'entrada',
      quantity: 50,
      note: 'OC-1001',
    });

    expect(mov.balanceAfter).toBe(50);
    expect(mov.delta).toBe(50);
    const stock = await repo.getStock();
    expect(stock).toHaveLength(1);
    expect(stock[0]).toMatchObject({ kind: 'herrajes', materialId: 'h1', quantity: 50 });

    const moves = await repo.listStockMovements();
    expect(moves).toHaveLength(1);
    expect(moves[0]?.note).toBe('OC-1001');
    expect(moves[0]?.balanceAfter).toBe(50);
  });

  it('salida debits and rejects negative balance with the shortfall', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    await repo.recordStockMovement({ kind: 'herrajes', materialId: 'h1', type: 'entrada', quantity: 10 });
    const salida = await repo.recordStockMovement({ kind: 'herrajes', materialId: 'h1', type: 'salida', quantity: 3 });
    expect(salida.balanceAfter).toBe(7);

    await expect(
      repo.recordStockMovement({ kind: 'herrajes', materialId: 'h1', type: 'salida', quantity: 20 }),
    ).rejects.toThrow(/faltan 13/);
    // failed movement must not hit the ledger
    expect((await repo.listStockMovements()).length).toBe(2);
  });

  it('rejects movements on untracked materials (except entrada)', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    await expect(
      repo.recordStockMovement({ kind: 'cintillas', materialId: 'e1', type: 'salida', quantity: 5 }),
    ).rejects.toThrow(/sin stock cargado/);
  });

  it('despacho debits and a reversión credits back (revertsId)', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    await repo.recordStockMovement({ kind: 'tableros', materialId: 'm1', type: 'entrada', quantity: 14 });
    const despacho = await repo.recordStockMovement({
      kind: 'tableros', materialId: 'm1', type: 'despacho', quantity: 4, projectId: 'p1',
    });
    expect(despacho.balanceAfter).toBe(10);

    const reversion = await repo.recordStockMovement({
      kind: 'tableros', materialId: 'm1', type: 'despacho', quantity: 4, revertsId: despacho.id,
    });
    expect(reversion.delta).toBe(4);
    expect(reversion.balanceAfter).toBe(14);
    expect(reversion.revertsId).toBe(despacho.id);
  });

  it('upsertStockMin sets the threshold and keeps the balance', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    await repo.recordStockMovement({ kind: 'herrajes', materialId: 'h1', type: 'entrada', quantity: 38 });
    const updated = await repo.upsertStockMin({ kind: 'herrajes', materialId: 'h1', minStock: 50 });
    expect(updated.quantity).toBe(38);
    expect(updated.minStock).toBe(50);
    // creates a row (quantity 0) when never tracked
    const created = await repo.upsertStockMin({ kind: 'cintillas', materialId: 'e1', minStock: 100 });
    expect(created.quantity).toBe(0);
    expect((await repo.getStock()).length).toBe(2);
  });

  it('listStockMovements filters by kind and limits', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    await repo.recordStockMovement({ kind: 'herrajes', materialId: 'h1', type: 'entrada', quantity: 1 });
    await repo.recordStockMovement({ kind: 'tableros', materialId: 'm1', type: 'entrada', quantity: 2 });
    await repo.recordStockMovement({ kind: 'herrajes', materialId: 'h2', type: 'entrada', quantity: 3 });

    const herrajes = await repo.listStockMovements({ kind: 'herrajes' });
    expect(herrajes).toHaveLength(2);
    const limited = await repo.listStockMovements({ limit: 2 });
    expect(limited).toHaveLength(2);
  });
});
