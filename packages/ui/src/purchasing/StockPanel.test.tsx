// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { StockPanel } from './StockPanel';
import type { MaterialStock, StockMovement } from '@granete/domain';

const stock: readonly MaterialStock[] = [
  { kind: 'herrajes', materialId: 'h1', quantity: 38, minStock: 50 },
  { kind: 'herrajes', materialId: 'h2', quantity: 0, minStock: 10 },
  { kind: 'tableros', materialId: 'm1', quantity: 14, minStock: 10 },
];

const movements: readonly StockMovement[] = [
  {
    id: 'sm-3',
    kind: 'herrajes',
    materialId: 'h1',
    type: 'entrada',
    delta: 50,
    balanceAfter: 50,
    byUserId: 'a1',
    at: '2026-08-17T10:00:00Z',
  },
];

const labels = {
  'herrajes:h1': 'Bisagra cazoleta 35mm',
  'herrajes:h2': 'Tirador 128mm',
  'tableros:m1': 'MDF 15mm',
};

const catalogOptions = [
  {
    kind: 'herrajes' as const,
    items: [
      { id: 'h1', label: 'Bisagra cazoleta 35mm' },
      { id: 'h2', label: 'Tirador 128mm' },
    ],
  },
  {
    kind: 'tableros' as const,
    items: [{ id: 'm1', label: 'MDF 15mm' }],
  },
  {
    kind: 'cintillas' as const,
    items: [{ id: 'e1', label: 'Canto melamina 1mm' }],
  },
];

describe('StockPanel (Fase 3b)', () => {
  afterEach(cleanup);

  it('renders the alert banner and the table with derived states', () => {
    render(
      <StockPanel
        stock={stock}
        movements={movements}
        labels={labels}
        catalogOptions={catalogOptions}
        canEdit
        onRecordMovement={vi.fn()}
        onSetMin={vi.fn()}
      />,
    );
    // 38 ≤ 50 → bajo · 0 → agotado · 14 > 10 → ok
    expect(screen.getByTestId('purch-stock-alert').textContent).toContain('1 material bajo mínimo');
    expect(screen.getByTestId('purch-stock-alert').textContent).toContain('1 agotado');
    expect(screen.getByTestId('purch-stock-status-herrajes-h1').textContent).toContain('Bajo mínimo');
    expect(screen.getByTestId('purch-stock-status-herrajes-h2').textContent).toContain('Agotado');
    expect(screen.getByTestId('purch-stock-status-tableros-m1').textContent).toContain('OK');
  });

  it('filters by estado and search', () => {
    render(
      <StockPanel
        stock={stock}
        labels={labels}
        catalogOptions={catalogOptions}
        canEdit
        onRecordMovement={vi.fn()}
        onSetMin={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('purch-stock-tab-agotado'));
    expect(screen.getByTestId('purch-stock-row-herrajes-h2')).not.toBeNull();
    expect(screen.queryByTestId('purch-stock-row-herrajes-h1')).toBeNull();

    fireEvent.click(screen.getByTestId('purch-stock-tab-todos'));
    fireEvent.change(screen.getByTestId('purch-stock-search'), {
      target: { value: 'MDF' },
    });
    expect(screen.getByTestId('purch-stock-row-tableros-m1')).not.toBeNull();
    expect(screen.queryByTestId('purch-stock-row-herrajes-h1')).toBeNull();
  });

  it('receives stock through the modal and calls onRecordMovement', async () => {
    const onRecordMovement = vi.fn().mockResolvedValue(undefined);
    render(
      <StockPanel
        stock={stock}
        labels={labels}
        catalogOptions={catalogOptions}
        canEdit
        onRecordMovement={onRecordMovement}
        onSetMin={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('purch-stock-action-entrada-h1'));
    fireEvent.change(screen.getByTestId('purch-stock-quantity'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByTestId('purch-stock-note'), {
      target: { value: 'OC-1001' },
    });
    fireEvent.click(screen.getByTestId('purch-stock-modal-submit'));

    await waitFor(() => expect(onRecordMovement).toHaveBeenCalled());
    expect(onRecordMovement).toHaveBeenCalledWith({
      kind: 'herrajes',
      materialId: 'h1',
      type: 'entrada',
      quantity: 25,
      note: 'OC-1001',
    });
  });

  it('requires a note for ajuste and shows the error', async () => {
    const onRecordMovement = vi.fn();
    render(
      <StockPanel
        stock={stock}
        labels={labels}
        catalogOptions={catalogOptions}
        canEdit
        onRecordMovement={onRecordMovement}
        onSetMin={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('purch-stock-action-ajuste-h1'));
    fireEvent.change(screen.getByTestId('purch-stock-quantity'), {
      target: { value: '-3' },
    });
    fireEvent.click(screen.getByTestId('purch-stock-modal-submit'));
    expect(screen.getByTestId('purch-stock-modal-error').textContent).toContain('nota');
    expect(onRecordMovement).not.toHaveBeenCalled();
  });

  it('commits the minimum on blur via onSetMin', () => {
    const onSetMin = vi.fn().mockResolvedValue(undefined);
    render(
      <StockPanel
        stock={stock}
        labels={labels}
        catalogOptions={catalogOptions}
        canEdit
        onRecordMovement={vi.fn()}
        onSetMin={onSetMin}
      />,
    );
    const input = screen.getByTestId('purch-stock-min-herrajes-h1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.blur(input);
    expect(onSetMin).toHaveBeenCalledWith({
      kind: 'herrajes',
      materialId: 'h1',
      minStock: 60,
    });
  });

  it('read-only mode (gerente) hides actions and the min editor', () => {
    render(
      <StockPanel
        stock={stock}
        labels={labels}
        catalogOptions={catalogOptions}
        canEdit={false}
        onRecordMovement={vi.fn()}
        onSetMin={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('purch-stock-receive')).toBeNull();
    expect(screen.queryByTestId('purch-stock-action-entrada-h1')).toBeNull();
    expect(screen.queryByTestId('purch-stock-min-herrajes-h1')).toBeNull();
    // Status still visible.
    expect(screen.getByTestId('purch-stock-status-herrajes-h1')).not.toBeNull();
  });

  it('empty state offers to receive when editable', () => {
    render(
      <StockPanel
        stock={[]}
        labels={labels}
        catalogOptions={catalogOptions}
        canEdit
        onRecordMovement={vi.fn()}
        onSetMin={vi.fn()}
      />,
    );
    expect(screen.getByText('Sin stock cargado')).not.toBeNull();
    expect(screen.getByTestId('purch-stock-receive-first')).not.toBeNull();
  });

  it('filter tabs follow the shared tablist contract (roles, aria-controls, arrows)', () => {
    render(
      <StockPanel
        stock={stock}
        labels={labels}
        catalogOptions={catalogOptions}
        canEdit={false}
        onRecordMovement={vi.fn()}
        onSetMin={vi.fn()}
      />,
    );
    const tablist = screen.getByRole('tablist', { name: 'Filtros de stock' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('data-testid'))).toEqual([
      'purch-stock-tab-todos',
      'purch-stock-tab-bajo',
      'purch-stock-tab-agotado',
    ]);
    // Single shared panel: it re-identifies with the selected filter.
    const todos = within(tablist).getByTestId('purch-stock-tab-todos');
    expect(todos.getAttribute('aria-selected')).toBe('true');
    let panel = document.getElementById('purch-stock-panel-todos')!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('purch-stock-tab-todos');
    const bajo = within(tablist).getByTestId('purch-stock-tab-bajo');
    expect(bajo.getAttribute('aria-controls')).toBe('purch-stock-panel-bajo');
    // Roving tabindex: ArrowRight moves focus (and selection) to the next tab.
    todos.focus();
    fireEvent.keyDown(todos, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(bajo);
    panel = document.getElementById('purch-stock-panel-bajo')!;
    expect(panel.getAttribute('aria-labelledby')).toBe('purch-stock-tab-bajo');
  });

  it('hides cost columns and total by default (COST-01)', () => {
    render(
      <StockPanel
        stock={stock}
        labels={labels}
        catalogOptions={catalogOptions}
        canEdit
        onRecordMovement={vi.fn()}
        onSetMin={vi.fn()}
        prices={{ 'herrajes:h1': 35, 'herrajes:h2': 10, 'tableros:m1': 714.43 }}
      />,
    );
    expect(screen.queryByTestId('purch-stock-total')).toBeNull();
    expect(screen.queryByTestId('purch-stock-value-h1')).toBeNull();
    expect(screen.queryByText('Valor total del inventario')).toBeNull();
  });

  it('shows unit cost, per-row value and the inventory total when showCosts', () => {
    render(
      <StockPanel
        stock={stock}
        labels={labels}
        catalogOptions={catalogOptions}
        canEdit
        onRecordMovement={vi.fn()}
        onSetMin={vi.fn()}
        prices={{ 'herrajes:h1': 35, 'tableros:m1': 714.43 }}
        showCosts
        currency="MXN"
      />,
    );
    // h1: 38 × 35 = 1330 · h2: sin precio en catálogo → '—' · m1: 14 × 714.43 ≈ 10002.02
    expect(screen.getByTestId('purch-stock-cost-h1').textContent).toContain('$35.00');
    expect(screen.getByTestId('purch-stock-value-h1').textContent).toContain('$1,330.00');
    expect(screen.getByTestId('purch-stock-cost-h2').textContent).toBe('—');
    expect(screen.getByTestId('purch-stock-value-h2').textContent).toBe('—');
    const total = screen.getByTestId('purch-stock-total');
    expect(total.textContent).toContain('Valor total del inventario');
    expect(total.textContent).toContain('$11,332.02');
    expect(total.textContent).toContain('MXN');
  });
});
