import type { MaterialStock, StockMaterialKind, StockMovement, StockStatus } from './stock';
import { stockStatus } from './stock';
import type { PurchaseOrder } from './purchasingOrders';
import type { Project } from './types';
import type { DataTruthOrigin } from './dataTruth';

/** Material types with a picking list per project. */
export const PICKING_MATERIALS = ['herrajes', 'tableros', 'cintillas'] as const;

export type PickingMaterial = (typeof PICKING_MATERIALS)[number];

/** Picking status of a project's material list. */
export type PickingStatus = 'pendiente' | 'despachado';

export const PICKING_STATUS_LABELS_ES: Readonly<Record<PickingStatus, string>> = {
  pendiente: 'Pendiente',
  despachado: 'Despachado',
};

/**
 * One project × material picking state. Not persisted yet — this is the
 * contract for the future storage phase (markedBy = user email).
 */
export type ProjectPickingState = {
  readonly projectId: string;
  readonly material: PickingMaterial;
  readonly status: PickingStatus;
  /** ISO timestamp when marked despachado. */
  readonly markedAt?: string;
  /** User email that marked the pick. */
  readonly markedBy?: string;
};

/** Local-state key: `${projectId}:${material}` (MVP — no persistence). */
export function pickingKey(
  projectId: string,
  material: PickingMaterial,
): string {
  return `${projectId}:${material}`;
}

/**
 * Filtra los movimientos de tipo despacho de un proyecto y tipo de material
 * que aún se encuentran activos (es decir, que no han sido revertidos por
 * otro movimiento con `revertsId`).
 */
export function activeDespachosFor(
  projectId: string,
  material: PickingMaterial,
  movements: readonly StockMovement[],
): StockMovement[] {
  const revertedIds = new Set<string>();
  for (const m of movements) {
    if (m.revertsId) {
      revertedIds.add(m.revertsId);
    }
  }
  return movements.filter(
    (m) =>
      m.type === 'despacho' &&
      m.kind === material &&
      m.projectId === projectId &&
      !m.revertsId &&
      !revertedIds.has(m.id),
  );
}

export type WarehouseProjectMetrics = {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerLabel?: string;
  readonly materialsRelease: boolean;
  readonly hardwareStatus: PickingStatus;
  readonly tablerosStatus: PickingStatus;
  readonly cintillasStatus: PickingStatus;
  readonly isFullyPicked: boolean;
  readonly hardwareCount: number;
  readonly hardwareCountOrigin: DataTruthOrigin;
  readonly boardAreaM2: number;
  readonly boardAreaOrigin: DataTruthOrigin;
  readonly edgeLengthMl: number;
  readonly edgeLengthOrigin: DataTruthOrigin;
  readonly daysInWarehouse?: number;
  readonly daysInWarehouseOrigin?: DataTruthOrigin;
};

export type WarehouseStockAlert = {
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly currentQuantity: number;
  readonly minStock: number;
  readonly status: 'bajo' | 'agotado';
  readonly deficit: number;
};

export type WarehouseDashboardStats = {
  readonly totalProjects: number;
  readonly fullyPickedProjects: number;
  readonly pendingPickingProjects: number;
  readonly materialsReleasedProjects: number;
  readonly totalBoardAreaM2: number;
  readonly boardAreaOrigin: DataTruthOrigin;
  readonly totalEdgeLengthMl: number;
  readonly edgeLengthOrigin: DataTruthOrigin;
  readonly totalHardwareLines: number;
  readonly hardwareLinesOrigin: DataTruthOrigin;
  // Stock health
  readonly stockTotalItems: number;
  readonly stockOkCount: number;
  readonly stockLowCount: number;
  readonly stockOutCount: number;
  readonly stockAlerts: readonly WarehouseStockAlert[];
  // Purchase orders summary
  readonly poTotalCount: number;
  readonly poDraftCount: number;
  readonly poEmittedCount: number;
  readonly poReceivedCount: number;
  readonly poCancelledCount: number;
  // Project list
  readonly projects: readonly WarehouseProjectMetrics[];
};

export type WarehouseProjectInput = (Project | {
  readonly id: string;
  readonly name: string;
  readonly customerLabel?: string;
  readonly status: string;
  readonly materialsRelease?: boolean;
  readonly createdAt?: string;
  readonly items?: readonly { readonly quantity?: number }[];
}) & {
  readonly customerLabel?: string;
  readonly hardwareCount?: number;
  readonly boardAreaM2?: number;
  readonly edgeLengthMl?: number;
};

/**
 * Pure calculation of Warehouse & Purchasing Dashboard KPIs, stock health,
 * material demand and per-project picking progress.
 */
export function computeWarehouseDashboardStats(
  projects: readonly WarehouseProjectInput[],
  stock?: readonly MaterialStock[] | null,
  purchaseOrders?: readonly PurchaseOrder[] | null,
  pickingInput?: readonly ProjectPickingState[] | Record<string, PickingStatus> | null,
  nowIso?: string,
): WarehouseDashboardStats {
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();

  // Normalize picking state map
  const pickingMap: Record<string, PickingStatus> = {};
  if (pickingInput) {
    if (Array.isArray(pickingInput)) {
      for (const p of pickingInput) {
        pickingMap[pickingKey(p.projectId, p.material)] = p.status;
      }
    } else {
      Object.assign(pickingMap, pickingInput);
    }
  }

  // Active projects in warehouse: status accepted or produced
  const activeProjects = projects.filter(
    (p) => p.status === 'accepted' || p.status === 'produced',
  );

  let totalBoardAreaM2 = 0;
  let totalEdgeLengthMl = 0;
  let totalHardwareLines = 0;
  let fullyPickedProjects = 0;
  let materialsReleasedProjects = 0;

  const projectMetricsList: WarehouseProjectMetrics[] = [];

  for (const p of activeProjects) {
    const hwStatus = pickingMap[pickingKey(p.id, 'herrajes')] ?? 'pendiente';
    const tbStatus = pickingMap[pickingKey(p.id, 'tableros')] ?? 'pendiente';
    const ctStatus = pickingMap[pickingKey(p.id, 'cintillas')] ?? 'pendiente';

    const isFullyPicked = hwStatus === 'despachado' && tbStatus === 'despachado' && ctStatus === 'despachado';
    if (isFullyPicked) {
      fullyPickedProjects++;
    }
    if (p.materialsRelease) {
      materialsReleasedProjects++;
    }

    // Material totals or fallback estimates
    let moduleCount = 0;
    if (p.items && p.items.length > 0) {
      for (const item of p.items) {
        moduleCount += item.quantity || 1;
      }
    }

    const hasDirectBoard = p.boardAreaM2 !== undefined;
    const hasDirectEdge = p.edgeLengthMl !== undefined;
    const hasDirectHw = p.hardwareCount !== undefined;

    const boardAreaM2 = p.boardAreaM2 ?? Math.round(moduleCount * 2.8 * 10) / 10;
    const edgeLengthMl = p.edgeLengthMl ?? Math.round(moduleCount * 14 * 10) / 10;
    const hardwareCount = p.hardwareCount ?? moduleCount * 4;

    totalBoardAreaM2 += boardAreaM2;
    totalEdgeLengthMl += edgeLengthMl;
    totalHardwareLines += hardwareCount;

    const createdAtMs = p.createdAt ? new Date(p.createdAt).getTime() : now;
    const daysInWarehouse = Math.max(0, Math.round((now - createdAtMs) / (1000 * 3600 * 24)));

    projectMetricsList.push({
      projectId: p.id,
      projectName: p.name,
      customerLabel: p.customerLabel,
      materialsRelease: Boolean(p.materialsRelease),
      hardwareStatus: hwStatus,
      tablerosStatus: tbStatus,
      cintillasStatus: ctStatus,
      isFullyPicked,
      hardwareCount,
      hardwareCountOrigin: hasDirectHw ? 'actual' : 'proxy',
      boardAreaM2,
      boardAreaOrigin: hasDirectBoard ? 'actual' : 'proxy',
      edgeLengthMl,
      edgeLengthOrigin: hasDirectEdge ? 'actual' : 'proxy',
      daysInWarehouse,
      daysInWarehouseOrigin: p.createdAt ? 'proxy' : 'missing',
    });
  }

  // Determine overall truth origin for aggregate sums
  const hasProxyBoard = projectMetricsList.some((m) => m.boardAreaOrigin === 'proxy');
  const hasProxyEdge = projectMetricsList.some((m) => m.edgeLengthOrigin === 'proxy');
  const hasProxyHw = projectMetricsList.some((m) => m.hardwareCountOrigin === 'proxy');

  // Stock health
  const stockList = stock ?? [];
  let stockOkCount = 0;
  let stockLowCount = 0;
  let stockOutCount = 0;
  const stockAlerts: WarehouseStockAlert[] = [];

  for (const s of stockList) {
    const status = stockStatus(s.quantity, s.minStock);
    if (status === 'ok') {
      stockOkCount++;
    } else if (status === 'bajo') {
      stockLowCount++;
      stockAlerts.push({
        kind: s.kind,
        materialId: s.materialId,
        currentQuantity: s.quantity,
        minStock: s.minStock,
        status: 'bajo',
        deficit: Math.max(0, s.minStock - s.quantity),
      });
    } else if (status === 'agotado') {
      stockOutCount++;
      stockAlerts.push({
        kind: s.kind,
        materialId: s.materialId,
        currentQuantity: s.quantity,
        minStock: s.minStock,
        status: 'agotado',
        deficit: s.minStock,
      });
    }
  }

  // Purchase Orders summary
  const poList = purchaseOrders ?? [];
  let poDraftCount = 0;
  let poEmittedCount = 0;
  let poReceivedCount = 0;
  let poCancelledCount = 0;

  for (const po of poList) {
    if (po.status === 'borrador') poDraftCount++;
    else if (po.status === 'emitida') poEmittedCount++;
    else if (po.status === 'recibida') poReceivedCount++;
    else if (po.status === 'cancelada') poCancelledCount++;
  }

  return {
    totalProjects: activeProjects.length,
    fullyPickedProjects,
    pendingPickingProjects: activeProjects.length - fullyPickedProjects,
    materialsReleasedProjects,
    totalBoardAreaM2: Math.round(totalBoardAreaM2 * 100) / 100,
    boardAreaOrigin: activeProjects.length === 0 ? 'missing' : (hasProxyBoard ? 'proxy' : 'actual'),
    totalEdgeLengthMl: Math.round(totalEdgeLengthMl * 10) / 10,
    edgeLengthOrigin: activeProjects.length === 0 ? 'missing' : (hasProxyEdge ? 'proxy' : 'actual'),
    totalHardwareLines,
    hardwareLinesOrigin: activeProjects.length === 0 ? 'missing' : (hasProxyHw ? 'proxy' : 'actual'),
    stockTotalItems: stockList.length,
    stockOkCount,
    stockLowCount,
    stockOutCount,
    stockAlerts,
    poTotalCount: poList.length,
    poDraftCount,
    poEmittedCount,
    poReceivedCount,
    poCancelledCount,
    projects: projectMetricsList,
  };
}
