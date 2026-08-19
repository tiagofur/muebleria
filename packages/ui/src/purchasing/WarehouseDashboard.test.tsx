/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WarehouseDashboard } from './WarehouseDashboard';
import type { WarehouseProjectInput, MaterialStock, PurchaseOrder, ProjectPickingState } from '@muebles/domain';

describe('WarehouseDashboard', () => {
  afterEach(cleanup);
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
  ];

  const mockMaterialLabels: Record<string, string> = {
    'mat-1': 'MDF Blanco 18mm',
    'mat-2': 'Roble Natural 18mm',
    'hw-1': 'Bisagra Cierre Suave',
    'ed-1': 'Canto PVC Blanco 2mm',
  };

  it('renders header, stat cards, panels, and project rows', () => {
    const onOpenQueue = vi.fn();
    render(
      <WarehouseDashboard
        projects={mockProjects}
        stock={mockStock}
        purchaseOrders={mockPOs}
        initialPicking={mockPicking}
        onOpenQueue={onOpenQueue}
        materialLabels={mockMaterialLabels}
      />,
    );

    expect(screen.getByTestId('warehouse-dashboard')).not.toBeNull();
    expect(screen.getByText('Dashboard de Almacén y Compras')).not.toBeNull();

    // 4 Stat cards
    expect(screen.getByTestId('wh-stat-projects')).not.toBeNull();
    expect(screen.getByTestId('wh-stat-boards')).not.toBeNull();
    expect(screen.getByTestId('wh-stat-edges')).not.toBeNull();
    expect(screen.getByTestId('wh-stat-stock')).not.toBeNull();

    // Critical stock alerts
    expect(screen.getByTestId('wh-stock-alerts')).not.toBeNull();
    expect(screen.getByText('Roble Natural 18mm')).not.toBeNull();
    expect(screen.getByText('Bisagra Cierre Suave')).not.toBeNull();

    // Projects table
    expect(screen.getByTestId('wh-projects-table')).not.toBeNull();
    expect(screen.getByTestId('wh-project-row-p1')).not.toBeNull();
    expect(screen.getByTestId('wh-project-row-p2')).not.toBeNull();

    // Header action button
    const queueBtn = screen.getByTestId('wh-dash-goto-queue');
    fireEvent.click(queueBtn);
    expect(onOpenQueue).toHaveBeenCalledTimes(1);
  });

  it('filters project list by search query', () => {
    render(
      <WarehouseDashboard
        projects={mockProjects}
        stock={mockStock}
        purchaseOrders={mockPOs}
        initialPicking={mockPicking}
        materialLabels={mockMaterialLabels}
      />,
    );

    const searchInput = screen.getByPlaceholderText('Buscar por obra o cliente...');
    fireEvent.change(searchInput, { target: { value: 'Vestidor' } });

    expect(screen.queryByTestId('wh-project-row-p1')).toBeNull();
    expect(screen.getByTestId('wh-project-row-p2')).not.toBeNull();
  });

  it('clicking project table action calls onOpenProject', () => {
    const onOpenProject = vi.fn();
    render(
      <WarehouseDashboard
        projects={mockProjects}
        stock={mockStock}
        purchaseOrders={mockPOs}
        initialPicking={mockPicking}
        onOpenProject={onOpenProject}
        materialLabels={mockMaterialLabels}
      />,
    );

    const openBtn = screen.getByTestId('wh-open-project-p1');
    fireEvent.click(openBtn);
    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });
});
