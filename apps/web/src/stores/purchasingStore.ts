/**
 * purchasingStore — Compras/Almacén (Fase 3/3b/3c): picking states, stock
 * balances + ledger, suppliers and purchase orders.
 *
 * F119: migrated verbatim from App.tsx (the ~450-line block that F057–F064
 * never moved). The store owns persistence via the per-session repository
 * from workspaceStore; RBAC gates stay at the call sites in the shell
 * (canManagePurchasing) and debit-line derivation (needs live projects +
 * catalog) is passed into togglePick by the caller.
 */

import { create } from 'zustand';

import {
  activeDespachosFor,
  pickingKey,
  type MaterialStock,
  type PickingMaterial,
  type PickingStatus,
  type ProjectPickingState,
  type PurchaseOrder,
  type StockMaterialKind,
  type StockMovement,
  type StockMovementType,
  type Supplier,
} from '@muebles/domain';
import type { WorkspaceRepository } from '@muebles/storage';
import type { PoLineInput } from '@muebles/ui';

import { getUiStoreState } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';
import type { ToastFn } from './catalogStore';

/** In-flight picking guards per project x material to serialize fast clicks */
const inFlightPicks = new Set<string>();

export interface PurchasingStoreDeps {
  /** Repository for the current session (from workspaceStore). */
  readonly getRepository: () => WorkspaceRepository;
  /** Generates client-minted ids for suppliers/POs. */
  readonly newId?: (prefix: string) => string;
}

export interface StockDebitLine {
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly quantity: number;
}

export type TogglePickInput = {
  readonly projectId: string;
  readonly material: PickingMaterial;
  readonly status: PickingStatus;
};

export interface PurchasingState {
  readonly pickingStates: ProjectPickingState[] | null;
  readonly stockRows: MaterialStock[] | null;
  readonly stockMovements: StockMovement[] | null;
  readonly suppliers: Supplier[] | null;
  readonly purchaseOrders: PurchaseOrder[] | null;

  /** Bulk load of everything (App calls this on session/workspace change). */
  readonly loadAll: () => Promise<void>;
  /** Clears back to null (App calls when RBAC denies purchasing). */
  readonly clear: () => void;
  readonly reloadPicking: () => Promise<void>;
  readonly refreshStock: () => Promise<void>;
  readonly refreshPurchasing: () => Promise<void>;

  readonly recordStockMovement: (payload: {
    kind: StockMaterialKind;
    materialId: string;
    type: StockMovementType;
    quantity: number;
    note?: string;
  }) => Promise<void>;
  readonly upsertStockMin: (payload: {
    kind: StockMaterialKind;
    materialId: string;
    minStock: number;
  }) => Promise<void>;

  readonly saveSupplier: (data: {
    id?: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
  }) => Promise<void>;
  readonly deactivateSupplier: (id: string) => Promise<void>;
  readonly savePurchaseOrder: (data: {
    id?: string;
    supplierId: string;
    notes?: string;
    items: readonly PoLineInput[];
  }) => Promise<void>;
  readonly emitPurchaseOrder: (id: string) => Promise<void>;
  readonly cancelPurchaseOrder: (id: string) => Promise<void>;
  readonly receivePurchaseOrder: (
    id: string,
    lines: readonly PoLineInput[],
  ) => Promise<void>;

  /**
   * Toggle de picking: persiste el estado y, cuando el material tiene stock,
   * el despacho descuenta por línea y el desmarcado revierte (reverts_id).
   * Si el stock no alcanza, el despacho se revierte y se muestra el faltante —
   * el picking queda pendiente (server truth).
   */
  readonly togglePick: (
    input: TogglePickInput,
    debitLinesFor: (projectId: string, material: PickingMaterial) => readonly StockDebitLine[],
  ) => void;
}

interface InternalOptions {
  readonly deps: PurchasingStoreDeps;
}

function defaultNewId(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID().slice(0, 8)}`
    : `${prefix}-${Date.now().toString(36)}`;
}

function wrapError(err: unknown, message: string): Error {
  return err instanceof Error ? err : new Error(message);
}

export function createPurchasingStore(options: InternalOptions) {
  const getRepository = options.deps.getRepository;
  const newId = options.deps.newId ?? defaultNewId;
  const toast: ToastFn = (input) => getUiStoreState().toast(input);

  return create<PurchasingState>()((set, get) => ({
    pickingStates: null,
    stockRows: null,
    stockMovements: null,
    suppliers: null,
    purchaseOrders: null,

    loadAll: async () => {
      const repo = getRepository();
      if (!repo.listPickingStates && !repo.getStock && !repo.listSuppliers) {
        set({ pickingStates: null, stockRows: null, suppliers: null });
        return;
      }
      try {
        const [states, rows, moves, sps, pos] = await Promise.all([
          repo.listPickingStates
            ? repo.listPickingStates()
            : Promise.resolve([] as readonly ProjectPickingState[]),
          repo.getStock
            ? repo.getStock()
            : Promise.resolve([] as readonly MaterialStock[]),
          repo.listStockMovements
            ? repo.listStockMovements({ limit: 50 })
            : Promise.resolve([] as readonly StockMovement[]),
          repo.listSuppliers
            ? repo.listSuppliers()
            : Promise.resolve([] as readonly Supplier[]),
          repo.listPurchaseOrders
            ? repo.listPurchaseOrders()
            : Promise.resolve([] as readonly PurchaseOrder[]),
        ]);
        set({
          pickingStates: [...states],
          stockRows: [...rows],
          stockMovements: [...moves],
          suppliers: [...sps],
          purchaseOrders: [...pos],
        });
      } catch (err) {
        // Si la sesión expiró (401), delegar a workspaceStore
        if (err instanceof Error && (err.message.includes('401') || err.message.includes('Unauthorized'))) {
          useWorkspaceStore.getState().markSessionExpired();
        }
        // Read failure → resetear a [] para no arrastrar arrays de la sesión previa
        set({
          pickingStates: [],
          stockRows: [],
          stockMovements: [],
          suppliers: [],
          purchaseOrders: [],
        });
      }
    },

    clear: () =>
      set({
        pickingStates: null,
        stockRows: null,
        stockMovements: null,
        suppliers: null,
        purchaseOrders: null,
      }),

    reloadPicking: async () => {
      const repo = getRepository();
      if (!repo.listPickingStates) return;
      try {
        set({ pickingStates: [...await repo.listPickingStates()] });
      } catch {
        // keep previous state
      }
    },

    refreshStock: async () => {
      const repo = getRepository();
      if (!repo.getStock) return;
      try {
        const [rows, moves] = await Promise.all([
          repo.getStock(),
          repo.listStockMovements
            ? repo.listStockMovements({ limit: 50 })
            : Promise.resolve([]),
        ]);
        set({ stockRows: [...rows], stockMovements: [...moves] });
      } catch {
        // keep previous state
      }
    },

    refreshPurchasing: async () => {
      const repo = getRepository();
      try {
        const [sps, pos] = await Promise.all([
          repo.listSuppliers
            ? repo.listSuppliers()
            : Promise.resolve([] as readonly Supplier[]),
          repo.listPurchaseOrders
            ? repo.listPurchaseOrders()
            : Promise.resolve([] as readonly PurchaseOrder[]),
        ]);
        set({ suppliers: [...sps], purchaseOrders: [...pos] });
      } catch {
        // keep previous state
      }
    },

    recordStockMovement: async (payload) => {
      const repo = getRepository();
      if (!repo.recordStockMovement) return;
      try {
        await repo.recordStockMovement(payload);
        await get().refreshStock();
      } catch (err) {
        // Rethrow so the modal keeps the form open and shows the message.
        throw wrapError(err, 'No se pudo registrar el movimiento');
      }
    },

    upsertStockMin: async (payload) => {
      const repo = getRepository();
      if (!repo.upsertStockMin) return;
      try {
        await repo.upsertStockMin(payload);
        await get().refreshStock();
      } catch (err) {
        throw wrapError(err, 'No se pudo guardar el mínimo');
      }
    },

    saveSupplier: async (data) => {
      const repo = getRepository();
      try {
        if (data.id && repo.updateSupplier) {
          await repo.updateSupplier({ id: data.id, ...data });
        } else if (repo.createSupplier) {
          await repo.createSupplier({ id: data.id ?? newId('sp'), ...data });
        }
        await get().refreshPurchasing();
      } catch (err) {
        throw wrapError(err, 'No se pudo guardar el proveedor');
      }
    },

    deactivateSupplier: async (id) => {
      const repo = getRepository();
      if (!repo.deactivateSupplier) return;
      try {
        await repo.deactivateSupplier(id);
        await get().refreshPurchasing();
      } catch (err) {
        throw wrapError(err, 'No se pudo desactivar el proveedor');
      }
    },

    savePurchaseOrder: async (data) => {
      const repo = getRepository();
      try {
        if (data.id && repo.updatePurchaseOrder) {
          await repo.updatePurchaseOrder({ id: data.id, ...data });
        } else if (repo.createPurchaseOrder) {
          await repo.createPurchaseOrder({ id: data.id ?? newId('po'), ...data });
        }
        await get().refreshPurchasing();
      } catch (err) {
        throw wrapError(err, 'No se pudo guardar la orden de compra');
      }
    },

    emitPurchaseOrder: async (id) => {
      const repo = getRepository();
      if (!repo.emitPurchaseOrder) return;
      try {
        await repo.emitPurchaseOrder(id);
        await get().refreshPurchasing();
      } catch (err) {
        throw wrapError(err, 'No se pudo emitir la orden');
      }
    },

    cancelPurchaseOrder: async (id) => {
      const repo = getRepository();
      if (!repo.cancelPurchaseOrder) return;
      try {
        await repo.cancelPurchaseOrder(id);
        await get().refreshPurchasing();
      } catch (err) {
        throw wrapError(err, 'No se pudo cancelar la orden');
      }
    },

    receivePurchaseOrder: async (id, lines) => {
      const repo = getRepository();
      if (!repo.receivePurchaseOrder) return;
      try {
        await repo.receivePurchaseOrder(id, lines);
        // La recepción registra entradas de stock → refrescar ambos.
        await Promise.all([get().refreshPurchasing(), get().refreshStock()]);
      } catch (err) {
        throw wrapError(err, 'No se pudo registrar la recepción');
      }
    },

    togglePick: (
      { projectId, material, status },
      debitLinesFor,
    ) => {
      const lockKey = pickingKey(projectId, material);
      if (inFlightPicks.has(lockKey)) {
        return;
      }
      inFlightPicks.add(lockKey);

      const repo = getRepository();

      const persistPicking = async (nextStatus: PickingStatus): Promise<void> => {
        if (repo.setProjectPickingState) {
          await repo.setProjectPickingState({ projectId, material, status: nextStatus });
        }
        set((prev) => {
          const next = (prev.pickingStates ?? []).filter(
            (p) => !(p.projectId === projectId && p.material === material),
          );
          next.push({ projectId, material, status: nextStatus });
          return { pickingStates: next };
        });
      };

      const fail = (err: unknown): void => {
        // Revierte el estado optimista y refresca stock: la pantalla re-hidrata
        // desde pickingStates (pendiente) y los chips muestran el saldo real.
        void get().reloadPicking();
        void get().refreshStock();
        const msg =
          err instanceof Error ? err.message : 'No se pudo completar el despacho';
        toast({ type: 'error', message: msg });
      };

      void (async () => {
        try {
          if (status === 'despachado') {
            const lines = debitLinesFor(projectId, material);
            if (lines.length > 0 && repo.recordStockMovement) {
              // 1) Descuenta stock (todos los materiales con fila). Si uno
              // falla, acredita los ya debitados y aborta antes de persistir.
              const created: StockMovement[] = [];
              try {
                for (const line of lines) {
                  created.push(
                    await repo.recordStockMovement!({
                      ...line,
                      type: 'despacho',
                      projectId,
                    }),
                  );
                }
              } catch (err) {
                for (const c of created) {
                  try {
                    await repo.recordStockMovement!({
                      kind: c.kind,
                      materialId: c.materialId,
                      type: 'despacho',
                      quantity: Math.abs(c.delta),
                      projectId,
                      revertsId: c.id,
                    });
                  } catch {
                    // best effort
                  }
                }
                fail(err);
                return;
              }
            }
            // 2) Recién ahora persiste el picking despachado.
            await persistPicking('despachado');
            await get().refreshStock();
          } else {
            // Desmarcar: revierte los despachos activos de esta obra/tipo
            // (ledger, sobrevive a recargas) y persiste pendiente.
            if (repo.listStockMovements && repo.recordStockMovement) {
              const moves = await repo.listStockMovements({ kind: material, projectId, limit: 200 });
              const actives = activeDespachosFor(projectId, material, moves);
              for (const m of actives) {
                await repo.recordStockMovement({
                  kind: m.kind,
                  materialId: m.materialId,
                  type: 'despacho',
                  quantity: Math.abs(m.delta),
                  projectId,
                  revertsId: m.id,
                });
              }
            }
            await persistPicking('pendiente');
            await get().refreshStock();
          }
        } catch (err) {
          fail(err);
        } finally {
          inFlightPicks.delete(lockKey);
        }
      })();
    },
  }));
}

/**
 * Default singleton — production wiring. Idempotent per getRepository
 * identity (the workspaceStore action is stable).
 */
let _singleton: ReturnType<typeof createPurchasingStore> | null = null;

export function ensurePurchasingStore(options: {
  readonly deps: PurchasingStoreDeps;
}): void {
  if (_singleton && options.deps.getRepository === _lastGetRepository) return;
  _singleton = createPurchasingStore({ deps: options.deps });
  _lastGetRepository = options.deps.getRepository;
}

let _lastGetRepository: (() => WorkspaceRepository) | null = null;

export function usePurchasingStore<T = PurchasingState>(
  selector: (s: PurchasingState) => T = identitySelector as (s: PurchasingState) => T,
): T {
  if (!_singleton) {
    throw new Error(
      'purchasingStore not initialized — call ensurePurchasingStore(deps) first',
    );
  }
  return _singleton(selector);
}

function identitySelector<T>(s: T): T {
  return s;
}

/** Direct access (non-React code paths). */
export function getPurchasingStoreState(): PurchasingState {
  if (!_singleton) {
    throw new Error(
      'purchasingStore not initialized — call ensurePurchasingStore(deps) first',
    );
  }
  return _singleton.getState();
}

/** F118 S2 pattern: clear purchasing data when the session ends. */
export function resetPurchasingStore(): void {
  if (!_singleton) return;
  _singleton.getState().clear();
}
