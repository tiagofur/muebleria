import { describe, expect, it } from 'vitest';
import {
  computeWarehouseDashboardStats,
  pickingKey,
  type ProjectPickingState,
  type WarehouseProjectInput,
} from './purchasing';
import type { MaterialStock } from './stock';
import type { PurchaseOrder } from './purchasingOrders';

describe('computeWarehouseDashboardStats', () => {
  const mockProjects: WarehouseProjectInput[] = [
    {
      id: 'p1',
      name: 'Cocina Moderna',
      customerLabel: 'Juan Pérez',
      status: 'accepted',
      materialsRelease: false,
      createdAt: '2026-08-10T10:00:00.000Z',
      items: [{ quantity: 3 }, { quantity: 2 }],
      boardAreaM2: 14.5,
      edgeLengthMl: 65,
      hardwareCount: 20,
    },
    {
      id: 'p2',
      name: 'Vestidor Principal',
      customerLabel: 'Ana Gómez',
      status: 'accepted',
      materialsRelease: true,
      createdAt: '2026-08-15T12:00:00.000Z',
      items: [{ quantity: 4 }],
      boardAreaM2: 12.0,
      edgeLengthMl: 55,
      hardwareCount: 16,
    },
    {
      id: 'p3',
      name: 'Mueble TV (Borrador)',
      customerLabel: 'Carlos',
      status: 'draft', // Not in warehouse
      items: [{ quantity: 1 }],
    },
  ];

  const mockPicking: ProjectPickingState[] = [
    { projectId: 'p2', material: 'herrajes', status: 'despachado' },
    { projectId: 'p2', material: 'tableros', status: 'despachado' },
    { projectId: 'p2', material: 'cintillas', status: 'despachado' },
    { projectId: 'p1', material: 'herrajes', status: 'despachado' },
    { projectId: 'p1', material: 'tableros', status: 'pendiente' },
    { projectId: 'p1', material: 'cintillas', status: 'pendiente' },
  ];

  const mockStock: MaterialStock[] = [
    { kind: 'tableros', materialId: 'mat-1', quantity: 15, minStock: 5 }, // ok
    { kind: 'tableros', materialId: 'mat-2', quantity: 2, minStock: 10 }, // bajo
    { kind: 'herrajes', materialId: 'hw-1', quantity: 0, minStock: 50 }, // agotado
    { kind: 'cintillas', materialId: 'ed-1', quantity: 100, minStock: 20 }, // ok
  ];

  const mockPOs: PurchaseOrder[] = [
    {
      id: 'po-1',
      supplierId: 'sup-1',
      number: 'OC-001',
      status: 'emitida',
      items: [],
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    },
    {
      id: 'po-2',
      supplierId: 'sup-2',
      number: 'OC-002',
      status: 'borrador',
      items: [],
      createdAt: '2026-08-19T09:00:00.000Z',
      updatedAt: '2026-08-19T09:00:00.000Z',
    },
    {
      id: 'po-3',
      supplierId: 'sup-1',
      number: 'OC-003',
      status: 'recibida',
      items: [],
      createdAt: '2026-08-10T10:00:00.000Z',
      updatedAt: '2026-08-10T10:00:00.000Z',
    },
  ];

  it('computes project picking KPIs and totals correctly', () => {
    const stats = computeWarehouseDashboardStats(
      mockProjects,
      mockStock,
      mockPOs,
      mockPicking,
      '2026-08-19T12:00:00.000Z',
    );

    expect(stats.totalProjects).toBe(2);
    expect(stats.fullyPickedProjects).toBe(1); // p2
    expect(stats.pendingPickingProjects).toBe(1); // p1
    expect(stats.materialsReleasedProjects).toBe(1); // p2
    expect(stats.totalBoardAreaM2).toBe(26.5);
    expect(stats.totalEdgeLengthMl).toBe(120);
    expect(stats.totalHardwareLines).toBe(36);
  });

  it('computes stock health counts and alerts', () => {
    const stats = computeWarehouseDashboardStats(
      mockProjects,
      mockStock,
      mockPOs,
      mockPicking,
      '2026-08-19T12:00:00.000Z',
    );

    expect(stats.stockTotalItems).toBe(4);
    expect(stats.stockOkCount).toBe(2);
    expect(stats.stockLowCount).toBe(1);
    expect(stats.stockOutCount).toBe(1);
    expect(stats.stockAlerts).toHaveLength(2);

    const lowAlert = stats.stockAlerts.find((a) => a.materialId === 'mat-2');
    expect(lowAlert).toBeDefined();
    expect(lowAlert?.status).toBe('bajo');
    expect(lowAlert?.deficit).toBe(8);

    const outAlert = stats.stockAlerts.find((a) => a.materialId === 'hw-1');
    expect(outAlert).toBeDefined();
    expect(outAlert?.status).toBe('agotado');
    expect(outAlert?.deficit).toBe(50);
  });

  it('summarizes purchase orders by status', () => {
    const stats = computeWarehouseDashboardStats(
      mockProjects,
      mockStock,
      mockPOs,
      mockPicking,
    );

    expect(stats.poTotalCount).toBe(3);
    expect(stats.poDraftCount).toBe(1);
    expect(stats.poEmittedCount).toBe(1);
    expect(stats.poReceivedCount).toBe(1);
    expect(stats.poCancelledCount).toBe(0);
  });

  it('handles empty data gracefully', () => {
    const stats = computeWarehouseDashboardStats([]);
    expect(stats.totalProjects).toBe(0);
    expect(stats.fullyPickedProjects).toBe(0);
    expect(stats.stockTotalItems).toBe(0);
    expect(stats.poTotalCount).toBe(0);
    expect(stats.projects).toEqual([]);
  });

  it('generates deterministic pickingKey', () => {
    expect(pickingKey('proj-123', 'herrajes')).toBe('proj-123:herrajes');
    expect(pickingKey('proj-123', 'tableros')).toBe('proj-123:tableros');
  });
});
