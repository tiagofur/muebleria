// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  PurchasingScreen,
  type ActiveProjectMaterial,
} from './PurchasingScreen';
import type {
  BoardSheetEstimate,
  HardwarePurchaseRow,
  ProductionCutRow,
} from '@muebles/domain';

const hardwareRow = (
  id: string,
  code: string,
  description: string,
  quantity: number,
): HardwarePurchaseRow => ({
  hardwareId: id,
  code,
  description,
  unit: 'piece',
  quantity,
  purchaseQuantity: quantity,
  costPerUnit: 0,
  lineCost: 0,
});

const cutRow = (
  materialCode: string,
  materialName: string,
  thicknessMm: number,
  quantity: number,
): ProductionCutRow => ({
  quantity,
  lengthMm: 1800,
  widthMm: 600,
  description: `${materialName} 1800×600`,
  materialName,
  materialCode,
  thicknessMm,
  grain: 0,
  L1: 1,
  L2: 0,
  W1: 1,
  W2: 0,
  edgeBandCode: 'mel-1',
  edgeBandName: 'Canto melamina 1mm',
  edgeBandThicknessMm: 1,
});

const sheetEstimate = (
  materialId: string,
  code: string,
  name: string,
  estimatedSheets: number,
): BoardSheetEstimate => ({
  materialId,
  code,
  name,
  areaM2: 1.5,
  sheetWidthMm: 2800,
  sheetLengthMm: 2070,
  sheetAreaM2: 5.796,
  wastePercent: 10,
  estimatedSheets,
});

const projects: ActiveProjectMaterial[] = [
  {
    projectId: 'p1',
    projectName: 'Cocina López',
    hardware: [
      hardwareRow('h1', 'BIS-35', 'Bisagra cazoleta 35mm', 12),
      hardwareRow('h2', 'TIR-128', 'Tirador aluminio 128mm', 6),
    ],
    cutRows: [
      cutRow('MDF-15', 'MDF 15mm', 15, 4),
      cutRow('MDF-18', 'MDF 18mm', 18, 2),
    ],
    sheetEstimates: [
      sheetEstimate('mdf15', 'MDF-15', 'MDF 15mm', 4),
      sheetEstimate('mdf18', 'MDF-18', 'MDF 18mm', 2),
    ],
  },
  {
    projectId: 'p2',
    projectName: 'Placard Martínez',
    hardware: [hardwareRow('h3', 'TIR-128', 'Tirador aluminio 128mm', 6)],
    cutRows: [cutRow('MDF-18', 'MDF 18mm', 18, 3)],
    sheetEstimates: [sheetEstimate('mdf18', 'MDF-18', 'MDF 18mm', 2)],
  },
];

describe('PurchasingScreen (Fase 3)', () => {
  afterEach(cleanup);

  it('Herrajes tab renders the picking list per project', () => {
    render(<PurchasingScreen projects={projects} role="almacen" />);
    expect(screen.getByText('Cocina López')).not.toBeNull();
    expect(screen.getByText('Placard Martínez')).not.toBeNull();
    expect(screen.getByText('Bisagra cazoleta 35mm')).not.toBeNull();
    // Tirador appears in both projects.
    expect(screen.getAllByText('Tirador aluminio 128mm').length).toBe(2);
  });

  it('Tableros tab renders boards per project with planchas estimate', () => {
    render(<PurchasingScreen projects={projects} role="almacen" />);
    fireEvent.click(screen.getByTestId('purch-tab-tableros'));
    expect(screen.getByTestId('purch-panel-tableros')).not.toBeNull();
    expect(screen.getByText('MDF 15mm · 15 mm')).not.toBeNull();
    // MDF 18mm appears in both projects.
    expect(screen.getAllByText('MDF 18mm · 18 mm').length).toBe(2);
    expect(screen.getByText(/~4 planchas/)).not.toBeNull();
    // ~2 planchas appears in both projects.
    expect(screen.getAllByText(/~2 planchas/).length).toBe(2);
    // Pieces shown alongside m² (p1 MDF-15 has 4 pieces).
    expect(screen.getByText(/4 piezas/)).not.toBeNull();
  });

  it('Cintillas tab renders edge banding in metros lineales', () => {
    render(<PurchasingScreen projects={projects} role="almacen" />);
    fireEvent.click(screen.getByTestId('purch-tab-cintillas'));
    expect(screen.getByTestId('purch-panel-cintillas')).not.toBeNull();
    // Canto appears in both projects.
    expect(screen.getAllByText('Canto melamina 1mm · 1 mm').length).toBe(2);
    // Grouped by band: p1 = (1800+600)mm × (4+2) = 14.4 ml; p2 = 7.2 ml.
    expect(screen.getAllByText(/14,4 ml/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/7,2 ml/).length).toBeGreaterThanOrEqual(1);
  });

  it('"Marcar despachado" toggles local state to despachado and back', () => {
    render(<PurchasingScreen projects={projects} role="almacen" />);
    fireEvent.click(screen.getByTestId('purch-mark-p1-herrajes'));
    expect(
      screen.getByTestId('purch-status-p1-herrajes').textContent,
    ).toContain('Despachado');
    // Unmark toggles back to pendiente.
    fireEvent.click(screen.getByTestId('purch-unmark-p1-herrajes'));
    expect(
      screen.getByTestId('purch-status-p1-herrajes').textContent,
    ).toContain('Pendiente');
  });

  it('gerente_produccion sees everything read-only (no dispatch buttons)', () => {
    render(<PurchasingScreen projects={projects} role="gerente_produccion" />);
    expect(screen.queryAllByText('Marcar despachado')).toHaveLength(0);
    expect(screen.queryAllByText('Desmarcar')).toHaveLength(0);
    // Status is still visible.
    expect(screen.getAllByTestId(/purch-status-/).length).toBeGreaterThan(0);
  });

  it('admin can mark despachado', () => {
    render(<PurchasingScreen projects={projects} role="admin" />);
    fireEvent.click(screen.getByTestId('purch-tab-cintillas'));
    fireEvent.click(screen.getByTestId('purch-mark-p2-cintillas'));
    expect(
      screen.getByTestId('purch-status-p2-cintillas').textContent,
    ).toContain('Despachado');
  });

  it('almacen with assigned sector herrajes only sees that material tab', () => {
    render(
      <PurchasingScreen
        projects={projects}
        role="almacen"
        assignedSectors={['herrajes']}
      />,
    );
    expect(screen.getByTestId('purch-tab-herrajes')).not.toBeNull();
    expect(screen.queryByTestId('purch-tab-tableros')).toBeNull();
    expect(screen.queryByTestId('purch-tab-cintillas')).toBeNull();
    // Compras placeholder remains a workspace tab.
    expect(screen.getByTestId('purch-tab-compras')).not.toBeNull();
  });

  it('Compras tab shows the stock panel (empty state without stock)', () => {
    render(
      <PurchasingScreen
        projects={projects}
        role="almacen"
        onRecordStockMovement={vi.fn()}
        onUpsertStockMin={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('purch-tab-compras'));
    expect(screen.getByText('Sin stock cargado')).not.toBeNull();
    // almacen can start receiving.
    expect(screen.getByTestId('purch-stock-receive-first')).not.toBeNull();
  });

  it('renders stock chips on picking rows from the stock prop', () => {
    render(
      <PurchasingScreen
        projects={projects}
        role="almacen"
        stock={[
          { kind: 'herrajes', materialId: 'h1', quantity: 38, minStock: 50 },
          { kind: 'tableros', materialId: 'mdf15', quantity: 4, minStock: 10 },
          { kind: 'cintillas', materialId: 'e1', quantity: 320.5, minStock: 500 },
        ]}
        edgeIdByCode={{ 'mel-1': 'e1' }}
      />,
    );
    // Herrajes: h1 tracked → chip with stock 38 piezas.
    expect(screen.getByTestId('purch-stock-chip-herrajes-h1').textContent).toContain('38');
    // h3 (p2) untracked → chip "sin stock".
    expect(screen.getAllByText('sin stock').length).toBeGreaterThan(0);
    // Tableros: planchas block chip by materialId.
    fireEvent.click(screen.getByTestId('purch-tab-tableros'));
    expect(screen.getByTestId('purch-stock-chip-tableros-mdf15').textContent).toContain('4 planchas');
    // Cintillas: edge row chip (resolved via edgeIdByCode). The band appears
    // in both projects, so the chip renders once per project.
    fireEvent.click(screen.getByTestId('purch-tab-cintillas'));
    const cintillaChips = screen.getAllByTestId('purch-stock-chip-cintillas-e1');
    expect(cintillaChips.length).toBe(2);
    expect(cintillaChips[0]!.textContent).toContain('320');
  });

  it('Compras tab renders the stock table with alert states', () => {
    render(
      <PurchasingScreen
        projects={projects}
        role="gerente_produccion"
        stock={[
          { kind: 'herrajes', materialId: 'h1', quantity: 0, minStock: 10 },
          { kind: 'tableros', materialId: 'mdf15', quantity: 4, minStock: 10 },
        ]}
        stockLabels={{
          'herrajes:h1': 'Bisagra cazoleta 35mm',
          'tableros:mdf15': 'MDF 15mm',
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('purch-tab-compras'));
    // Alert banner: 1 agotado + 1 bajo mínimo.
    expect(screen.getByTestId('purch-stock-alert').textContent).toContain('1 material bajo mínimo');
    expect(screen.getByTestId('purch-stock-alert').textContent).toContain('1 agotado');
    expect(screen.getByTestId('purch-stock-table')).not.toBeNull();
    // gerente_produccion is read-only: no receive button.
    expect(screen.queryByTestId('purch-stock-receive')).toBeNull();
    expect(screen.queryByTestId('purch-stock-action-entrada-h1')).toBeNull();
  });

  it('hydrates persisted despachos from initialPicking', () => {
    render(
      <PurchasingScreen
        projects={projects}
        role="almacen"
        initialPicking={[
          {
            projectId: 'p1',
            material: 'herrajes',
            status: 'despachado',
            markedAt: '2026-08-17T10:00:00Z',
            markedBy: 'admin@taller.com',
          },
        ]}
      />,
    );
    expect(
      screen.getByTestId('purch-status-p1-herrajes').textContent,
    ).toContain('Despachado');
    // Absent states stay pendiente.
    expect(
      screen.getByTestId('purch-status-p2-herrajes').textContent,
    ).toContain('Pendiente');
    // Despachado renders the unmark action, not the mark button.
    expect(screen.queryByTestId('purch-mark-p1-herrajes')).toBeNull();
    expect(screen.getByTestId('purch-unmark-p1-herrajes')).not.toBeNull();
  });

  it('reports toggles through onTogglePick (persistence callback)', () => {
    const onTogglePick = vi.fn();
    render(
      <PurchasingScreen
        projects={projects}
        role="almacen"
        onTogglePick={onTogglePick}
      />,
    );
    fireEvent.click(screen.getByTestId('purch-mark-p1-herrajes'));
    expect(onTogglePick).toHaveBeenCalledWith({
      projectId: 'p1',
      material: 'herrajes',
      status: 'despachado',
    });
    // Unmark reports pendiente.
    fireEvent.click(screen.getByTestId('purch-unmark-p1-herrajes'));
    expect(onTogglePick).toHaveBeenLastCalledWith({
      projectId: 'p1',
      material: 'herrajes',
      status: 'pendiente',
    });
  });

  it('rehydrates when initialPicking arrives after mount', () => {
    const { rerender } = render(
      <PurchasingScreen projects={projects} role="almacen" />,
    );
    expect(
      screen.getByTestId('purch-status-p1-herrajes').textContent,
    ).toContain('Pendiente');

    rerender(
      <PurchasingScreen
        projects={projects}
        role="almacen"
        initialPicking={[
          {
            projectId: 'p1',
            material: 'herrajes',
            status: 'despachado',
          },
        ]}
      />,
    );
    expect(
      screen.getByTestId('purch-status-p1-herrajes').textContent,
    ).toContain('Despachado');
  });
});
