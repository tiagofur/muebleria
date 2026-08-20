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

describe('LocalStorageWorkspaceRepository — proveedores + PO (Fase 3c)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  it('supplier CRUD: create, list, update, deactivate', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    await repo.createSupplier({ id: 's1', name: 'Maderera Norte', contactName: 'Juan' });

    const list = await repo.listSuppliers();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 's1', name: 'Maderera Norte', active: true });

    await repo.updateSupplier({ id: 's1', name: 'Maderera Norte SA', phone: '123' });
    expect((await repo.listSuppliers())[0]?.name).toBe('Maderera Norte SA');

    await repo.deactivateSupplier('s1');
    expect((await repo.listSuppliers())[0]?.active).toBe(false);
  });

  it('PO lifecycle: create borrador → emit → receive credits stock and advances', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    await repo.recordStockMovement({
      kind: 'herrajes',
      materialId: 'h1',
      type: 'entrada',
      quantity: 10,
      note: 'inicial',
    });

    const created = await repo.createPurchaseOrder({
      id: 'po1',
      supplierId: 's1',
      items: [{ kind: 'herrajes', materialId: 'h1', quantity: 50 }],
    });
    expect(created.status).toBe('borrador');
    expect(created.number).toBe('OC-0001');
    expect(created.items[0]?.receivedQuantity).toBe(0);

    // Editar solo en borrador.
    const edited = await repo.updatePurchaseOrder({
      id: 'po1',
      supplierId: 's2',
      items: [{ kind: 'herrajes', materialId: 'h1', quantity: 40 }],
    });
    expect(edited.supplierId).toBe('s2');
    expect(edited.items[0]?.quantity).toBe(40);

    const emitted = await repo.emitPurchaseOrder('po1');
    expect(emitted.status).toBe('emitida');

    // Recibir 30 → stock sube 10 → 40 y la PO queda a 30/40 (emitida).
    const received = await repo.receivePurchaseOrder('po1', [
      { kind: 'herrajes', materialId: 'h1', quantity: 30 },
    ]);
    expect(received.items[0]?.receivedQuantity).toBe(30);
    expect(received.status).toBe('emitida');
    const stock = await repo.getStock();
    expect(stock.find((s) => s.materialId === 'h1')?.quantity).toBe(40);

    // Recibir el resto → recibida (fully received).
    const done = await repo.receivePurchaseOrder('po1', [
      { kind: 'herrajes', materialId: 'h1', quantity: 10 },
    ]);
    expect(done.status).toBe('recibida');
    expect(done.receivedAt).toBeTruthy();
    const moves = await repo.listStockMovements({ kind: 'herrajes' });
    // inicial + 30 + 10 = 3 movimientos, todos entrada con nota OC-0001.
    expect(moves).toHaveLength(3);
    expect(moves.every((m) => m.note === 'OC-0001' || m.note === 'inicial')).toBe(true);
  });

  it('receive is rejected unless emitida, edit rejected unless borrador', async () => {
    const repo = new LocalStorageWorkspaceRepository();
    await repo.createPurchaseOrder({
      id: 'po1',
      supplierId: 's1',
      items: [{ kind: 'herrajes', materialId: 'h1', quantity: 10 }],
    });

    await expect(
      repo.receivePurchaseOrder('po1', [{ kind: 'herrajes', materialId: 'h1', quantity: 5 }]),
    ).rejects.toThrow('solo una orden emitida');

    await repo.emitPurchaseOrder('po1');

    await expect(
      repo.updatePurchaseOrder({ id: 'po1', supplierId: 's2', items: [] }),
    ).rejects.toThrow('solo se puede editar una orden en borrador');

    // Reject receiving non-member lines or over-remaining
    await expect(
      repo.receivePurchaseOrder('po1', [{ kind: 'herrajes', materialId: 'h_foreign', quantity: 5 }]),
    ).rejects.toThrow('no pertenece a esta orden');

    await expect(
      repo.receivePurchaseOrder('po1', [{ kind: 'herrajes', materialId: 'h1', quantity: 50 }]),
    ).rejects.toThrow('excede el restante');

    await expect(
      repo.receivePurchaseOrder('po1', [{ kind: 'herrajes', materialId: 'h1', quantity: 0 }]),
    ).rejects.toThrow('mayor a cero');

    // Cancelar una emitida es válido; cancelar una recibida no.
    await repo.receivePurchaseOrder('po1', [
      { kind: 'herrajes', materialId: 'h1', quantity: 10 },
    ]);
    await expect(repo.cancelPurchaseOrder('po1')).rejects.toThrow(/terminal/);
  });
});
