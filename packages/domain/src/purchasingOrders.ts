/**
 * Compras/Almacén — proveedores y órdenes de compra (Fase 3c, doc 06 §7).
 * El directorio de proveedores y las PO viven en el servidor; acá están el
 * contrato y los helpers puros (estados del ciclo de vida, saldo pendiente).
 */

import type { StockMaterialKind } from './stock';

/** Un proveedor del directorio de Compras/Almacén. */
export type Supplier = {
  readonly id: string;
  readonly name: string;
  readonly contactName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly notes?: string;
  readonly active: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

/** Ciclo de vida de una orden de compra (paridad con Go PurchaseOrderStatus). */
export const PO_STATUSES = ['borrador', 'emitida', 'recibida', 'cancelada'] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_LABELS_ES: Readonly<Record<PurchaseOrderStatus, string>> = {
  borrador: 'Borrador',
  emitida: 'Emitida',
  recibida: 'Recibida',
  cancelada: 'Cancelada',
};

/** Una línea de material de una PO; receivedQuantity avanza con cada recepción. */
export type PurchaseOrderItem = {
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly quantity: number;
  readonly receivedQuantity: number;
  /** Costo unitario congelado a la emisión (OC-053, snapshot para job costing). */
  readonly unitCost?: number;
  /** Obra a la que se allocata la línea (OC-052: compras desde necesidad real). */
  readonly allocatedProjectId?: string;
};

/** Orden de compra a un proveedor; CreatedBy es el actor JWT (email). */
export type PurchaseOrder = {
  readonly id: string;
  readonly number: string;
  readonly supplierId: string;
  readonly status: PurchaseOrderStatus;
  readonly items: readonly PurchaseOrderItem[];
  readonly notes?: string;
  /** Fecha en la que la obra necesita el material (YYYY-MM-DD, OC-053). */
  readonly requiredBy?: string;
  /** Fecha de entrega comprometida por el proveedor (YYYY-MM-DD, OC-053). */
  readonly expectedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly receivedAt?: string;
  readonly createdBy?: string;
};

export function isValidPoStatus(
  s: string | null | undefined,
): s is PurchaseOrderStatus {
  return (
    s === 'borrador' ||
    s === 'emitida' ||
    s === 'recibida' ||
    s === 'cancelada'
  );
}

/** borrador → emitida (los ítems se congelan). */
export function poCanEmit(status: PurchaseOrderStatus): boolean {
  return status === 'borrador';
}

/** borrador o emitida → cancelada. */
export function poCanCancel(status: PurchaseOrderStatus): boolean {
  return status === 'borrador' || status === 'emitida';
}

/** Solo las órdenes emitidas reciben mercadería. */
export function poCanReceive(status: PurchaseOrderStatus): boolean {
  return status === 'emitida';
}

/** Todas las líneas alcanzaron su cantidad (la PO pasa a recibida). */
export function poFullyReceived(
  items: readonly PurchaseOrderItem[],
): boolean {
  return items.length > 0 && items.every((it) => it.receivedQuantity >= it.quantity);
}

/** Cantidad pendiente de recibir para una línea (nunca negativa). */
export function poRemaining(line: PurchaseOrderItem): number {
  return Math.max(0, line.quantity - line.receivedQuantity);
}

/** Costo total de una línea al snapshot unitCost; null si no hay costo cargado. */
export function poLineCost(line: PurchaseOrderItem): number | null {
  if (typeof line.unitCost !== 'number' || !Number.isFinite(line.unitCost)) return null;
  return Math.round(line.quantity * line.unitCost * 100) / 100;
}

/** Costo total de la PO al snapshot; null cuando ninguna línea tiene costo. */
export function poTotalCost(po: PurchaseOrder): number | null {
  let total = 0;
  let any = false;
  for (const line of po.items) {
    const lineCost = poLineCost(line);
    if (lineCost === null) continue;
    total += lineCost;
    any = true;
  }
  return any ? Math.round(total * 100) / 100 : null;
}
