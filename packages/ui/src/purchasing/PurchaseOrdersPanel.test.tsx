// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchaseOrdersPanel } from './PurchaseOrdersPanel';
import type { PurchaseOrder, Supplier } from '@granete/domain';

const suppliers: Supplier[] = [
  {
    id: 's1',
    name: 'Maderera Norte',
    contactName: 'Juan',
    email: 'ventas@norte.com',
    active: true,
  },
  {
    id: 's2',
    name: 'Ferremax',
    active: true,
  },
];

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
    items: [{ id: 'e1', label: 'Canto mel 1mm' }],
  },
];

const emitida: PurchaseOrder = {
  id: 'po1',
  number: 'OC-PO1',
  supplierId: 's1',
  status: 'emitida',
  items: [{ kind: 'herrajes', materialId: 'h1', quantity: 50, receivedQuantity: 30 }],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeCallbacks() {
  return {
    onSaveSupplier: vi.fn().mockResolvedValue(undefined),
    onDeactivateSupplier: vi.fn().mockResolvedValue(undefined),
    onSavePurchaseOrder: vi.fn().mockResolvedValue(undefined),
    onEmitPurchaseOrder: vi.fn().mockResolvedValue(undefined),
    onCancelPurchaseOrder: vi.fn().mockResolvedValue(undefined),
    onReceivePurchaseOrder: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(cleanup);

function renderPanel(props?: Partial<Parameters<typeof PurchaseOrdersPanel>[0]>) {
  const callbacks = makeCallbacks();
  const utils = render(
    <PurchaseOrdersPanel
      suppliers={suppliers}
      orders={[emitida]}
      canEdit
      catalogOptions={catalogOptions}
      {...callbacks}
      {...props}
    />,
  );
  return { ...utils, callbacks };
}

describe('PurchaseOrdersPanel (Fase 3c)', () => {
  it('renders the order with status and line progress', () => {
    renderPanel();
    expect(screen.getByText('OC-PO1')).toBeTruthy();
    expect(screen.getByText('Maderera Norte')).toBeTruthy();
    expect(screen.getByText('Emitida')).toBeTruthy();
    expect(screen.getByText(/30\/50 recibido · quedan 20/)).toBeTruthy();
  });

  it('emits a borrador order', async () => {
    const user = userEvent.setup();
    const borrador: PurchaseOrder = { ...emitida, id: 'po2', number: 'OC-PO2', status: 'borrador' };
    const { callbacks } = renderPanel({ orders: [borrador] });

    await user.click(screen.getByTestId('purch-po-emit-po2'));
    expect(callbacks.onEmitPurchaseOrder).toHaveBeenCalledWith('po2');
  });

  it('cancels an emitida order', async () => {
    const user = userEvent.setup();
    const { callbacks } = renderPanel();
    await user.click(screen.getByTestId('purch-po-cancel-po1'));
    expect(callbacks.onCancelPurchaseOrder).toHaveBeenCalledWith('po1');
  });

  it('receive modal submits per-line quantities (defaults to remaining)', async () => {
    const user = userEvent.setup();
    const { callbacks } = renderPanel();

    await user.click(screen.getByTestId('purch-po-receive-po1'));
    const modal = await screen.findByTestId('purch-po-receive-modal');
    expect(within(modal).getByText(/quedan 20/)).toBeTruthy();

    await user.click(screen.getByTestId('purch-po-receive-save'));
    expect(callbacks.onReceivePurchaseOrder).toHaveBeenCalledWith(
      'po1',
      [{ kind: 'herrajes', materialId: 'h1', quantity: 20 }],
    );
  });

  it('creates a PO through the modal with lines', async () => {
    const user = userEvent.setup();
    const { callbacks } = renderPanel({ orders: [] });

    await user.click(screen.getByTestId('purch-po-create-first'));
    const modal = await screen.findByTestId('purch-po-modal');

    await user.selectOptions(within(modal).getByTestId('purch-po-form-supplier'), 's2');
    await user.selectOptions(within(modal).getByTestId('purch-po-form-material-0'), 'h2');
    const qty = within(modal).getByTestId('purch-po-form-qty-0');
    await user.clear(qty);
    await user.type(qty, '10');
    await user.click(within(modal).getByTestId('purch-po-form-save'));

    expect(callbacks.onSavePurchaseOrder).toHaveBeenCalledWith({
      id: undefined,
      supplierId: 's2',
      notes: '',
      items: [{ kind: 'herrajes', materialId: 'h2', quantity: 10 }],
    });
  });

  it('suppliers tab lists and edits suppliers', async () => {
    const user = userEvent.setup();
    const { callbacks } = renderPanel();

    await user.click(screen.getByTestId('purch-po-tab-proveedores'));
    expect(screen.getByText('Ferremax')).toBeTruthy();

    await user.click(screen.getByTestId('purch-supplier-edit-s1'));
    const modal = await screen.findByTestId('purch-supplier-modal');
    const name = within(modal).getByTestId('purch-supplier-form-name');
    await user.clear(name);
    await user.type(name, 'Maderera Norte SA');
    await user.click(within(modal).getByTestId('purch-supplier-form-save'));

    expect(callbacks.onSaveSupplier).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', name: 'Maderera Norte SA' }),
    );
  });

  it('sub-tabs follow the shared tablist contract (roles, aria-controls, arrows)', async () => {
    const user = userEvent.setup();
    renderPanel();

    const tablist = screen.getByRole('tablist', { name: 'Compras y proveedores' });
    const ordenes = within(tablist).getByTestId('purch-po-tab-ordenes');
    const proveedores = within(tablist).getByTestId('purch-po-tab-proveedores');
    expect(ordenes.getAttribute('aria-controls')).toBe('purch-po-panel-ordenes');
    expect(proveedores.getAttribute('aria-controls')).toBe('purch-po-panel-proveedores');
    const panel = document.getElementById('purch-po-panel-ordenes')!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('purch-po-tab-ordenes');

    // Roving tabindex: ArrowRight focuses (and selects) the next tab.
    ordenes.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(proveedores);
    expect(proveedores.getAttribute('aria-selected')).toBe('true');
  });

  it('read-only mode hides write actions (gerente_produccion)', () => {
    renderPanel({ canEdit: false });
    expect(screen.queryByTestId('purch-po-receive-po1')).toBeNull();
    expect(screen.queryByTestId('purch-po-cancel-po1')).toBeNull();
    expect(screen.queryByTestId('purch-po-new-ordenes')).toBeNull();
  });
});
