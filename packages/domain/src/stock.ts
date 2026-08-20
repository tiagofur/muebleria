/**
 * Compras/Almacén stock (Fase 3b, diseño 06-stock-almacen.md): inventario real
 * por material con ledger de movimientos. Los saldos viven en el servidor
 * (material_stock + stock_movements); acá están el contrato y los helpers
 * puros que la UI usa para estados y unidades.
 */

/** Los tres tipos de material con stock (mismos valores que el picking). */
export const STOCK_MATERIAL_KINDS = ['herrajes', 'tableros', 'cintillas'] as const;
export type StockMaterialKind = (typeof STOCK_MATERIAL_KINDS)[number];

export const STOCK_MOVEMENT_TYPES = ['entrada', 'salida', 'ajuste', 'despacho'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** Estado derivado de alerta: quantity vs min_stock. */
export type StockStatus = 'ok' | 'bajo' | 'agotado';

export const STOCK_STATUS_LABELS_ES: Readonly<Record<StockStatus, string>> = {
  ok: 'OK',
  bajo: 'Bajo mínimo',
  agotado: 'Agotado',
};

export const STOCK_MOVEMENT_LABELS_ES: Readonly<Record<StockMovementType, string>> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  despacho: 'Despacho',
};

export const STOCK_KIND_LABELS_ES: Readonly<Record<StockMaterialKind, string>> = {
  herrajes: 'Herrajes',
  tableros: 'Tableros',
  cintillas: 'Cintillas',
};

/** Saldo vivo + mínimo de un material de catálogo. */
export type MaterialStock = {
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly quantity: number;
  readonly minStock: number;
  readonly updatedAt?: string;
};

/** Una fila del ledger inmutable (quién/cuándo/por qué + snapshot del saldo). */
export type StockMovement = {
  readonly id: string;
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly type: StockMovementType;
  readonly delta: number;
  readonly balanceAfter: number;
  readonly projectId?: string;
  readonly note?: string;
  readonly revertsId?: string;
  readonly byUserId: string;
  readonly byName?: string;
  readonly at: string;
};

/**
 * Estado derivado de alerta (06 §6.4): 0 → agotado; ≤ mínimo → bajo; resto ok.
 */
export function stockStatus(
  quantity: number,
  minStock: number,
): StockStatus {
  if (quantity <= 0) return 'agotado';
  if (quantity <= minStock) return 'bajo';
  return 'ok';
}

/** Unidad de stock por tipo (singular); la UI pluraliza con `stockUnitPlural`. */
export function stockUnitLabel(
  kind: StockMaterialKind,
  hardwareUnit?: string,
): string {
  if (kind === 'tableros') return 'plancha';
  if (kind === 'cintillas') return 'ml';
  switch (hardwareUnit) {
    case 'set':
      return 'juego';
    case 'meter':
      return 'metro';
    default:
      return 'pieza';
  }
}

/** Pluraliza una unidad singular (excepto ml). */
export function stockUnitPlural(unit: string, quantity: number): string {
  if (unit === 'ml' || quantity === 1) return unit;
  return `${unit}s`;
}

/**
 * Delta firmado para un movimiento (paridad con Go StockDeltaForType):
 * entrada suma; salida/despacho restan; ajuste va firmado por el llamador.
 */
export function stockMovementDelta(
  type: StockMovementType,
  quantity: number,
): number {
  if (type === 'entrada') {
    if (quantity <= 0) {
      throw new Error('la entrada debe ser mayor a cero');
    }
    return quantity;
  }
  if (type === 'salida' || type === 'despacho') {
    if (quantity <= 0) {
      throw new Error('la cantidad debe ser mayor a cero');
    }
    return -quantity;
  }
  if (type === 'ajuste') {
    if (quantity === 0) {
      throw new Error('el ajuste no puede ser cero');
    }
    return quantity; // ajuste
  }
  throw new Error(`tipo de movimiento inválido: ${String(type)}`);
}

/** Saldo tras aplicar un movimiento (el servidor nunca deja saldo negativo). */
export function applyStockMovement(balance: number, delta: number): number {
  return balance + delta;
}

/**
 * Valor de inventario de una fila de stock: cantidad × precio unitario del
 * catálogo. Fuente del precio por tipo:
 * - herrajes → `Hardware.costPerUnit` (por pieza/juego/metro según su unit)
 * - tableros → `MaterialBoard.boardPrice` (por plancha)
 * - cintillas → `EdgeBand.costPerMl` (por metro lineal)
 * Devuelve null cuando el material no tiene precio cargado en el catálogo.
 */
export function stockValue(
  quantity: number,
  pricePerUnit: number | undefined,
): number | null {
  if (typeof pricePerUnit !== 'number' || !Number.isFinite(pricePerUnit)) {
    return null;
  }
  return quantity * pricePerUnit;
}
