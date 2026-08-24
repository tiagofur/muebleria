/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@muebles/domain';
import { ProductionQueue } from './ProductionQueue';

function project(
  id: string,
  status: Project['status'],
  name: string,
): Project {
  return {
    id,
    name,
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status,
    items: [{ id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} }],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  };
}

afterEach(() => cleanup());

describe('ProductionQueue (F038)', () => {
  it('shows pack/nesting signals on the card when they exist', () => {
    const withSignals: Project = {
      ...project('p9', 'accepted', 'Obra con señales'),
      production: {
        revision: 2,
        revisionAt: '2026-08-14T00:00:00.000Z',
        lastExportAt: '2026-08-15T00:00:00.000Z',
      },
      nestingImport: {
        rows: [{ materialCode: 'MAT', sheetsUsed: 3 }],
        importedAt: '2026-08-15T01:00:00.000Z',
        sourceName: 'nesting.csv',
      },
    } as Project;
    render(
      <ProductionQueue
        projects={[withSignals, project('p10', 'accepted', 'Obra nueva')]}
        customerLabelFor={() => 'Ana'}
        salePriceFor={() => null}
        onOpenOrder={vi.fn()}
        onMarkProduced={vi.fn()}
      />,
    );
    expect(screen.getByTestId('prod-signal-pack-p9').textContent).toContain(
      'Pack generado',
    );
    expect(screen.getByTestId('prod-signal-nesting-p9').textContent).toContain(
      'Nesting',
    );
    // Fresh order shows no signals.
    expect(screen.queryByTestId('prod-signal-pack-p10')).toBeNull();
  });

  it('shows accepted date when priceSnapshot exists', () => {
    const acceptedProj: Project = {
      ...project('p11', 'accepted', 'Obra Aceptada'),
      priceSnapshot: {
        capturedAt: '2026-08-10T14:30:00.000Z',
        breakdown: {
          materialsCost: 100,
          edgeTotal: 20,
          hardwareTotal: 30,
          directCost: 150,
          laborModular: 50,
          laborFixedCost: 0,
          marginFactor: 1.35,
          discountPercent: 0,
          discountAmount: 0,
          salePrice: 270,
        },
      },
    };
    render(
      <ProductionQueue
        projects={[acceptedProj]}
        customerLabelFor={() => 'Ana'}
        salePriceFor={() => 270}
        onOpenOrder={vi.fn()}
        onMarkProduced={vi.fn()}
      />,
    );
    expect(screen.getByText(/Aceptado 10 ago 2026/)).toBeTruthy();
  });

  it('lists accepted jobs and marks produced', async () => {
    const user = userEvent.setup();
    const onMark = vi.fn();
    const onOpen = vi.fn();
    render(
      <ProductionQueue
        projects={[
          project('p1', 'accepted', 'Cocina Ana'),
          project('p2', 'draft', 'Borrador'),
          project('p3', 'accepted', 'Living hecho'),
        ]}
        customerLabelFor={() => 'Ana'}
        salePriceFor={() => 1000}
        onOpenOrder={onOpen}
        onMarkProduced={onMark}
      />,
    );
    expect(screen.getByText('Cocina Ana')).toBeTruthy();
    expect(screen.queryByText('Borrador')).toBeNull();
    expect(screen.queryByText('Living hecho')).toBeTruthy();

    await user.click(screen.getByTestId('prod-open-order-p1'));
    expect(onOpen).toHaveBeenCalledWith('p1');
    // Hub wired: factory exports leave the queue card.
    expect(screen.queryByTestId('prod-export-opt-p1')).toBeNull();
    expect(screen.queryByTestId('prod-export-hw-p1')).toBeNull();
    await user.click(screen.getByTestId('prod-mark-p1'));
    expect(onMark).toHaveBeenCalledWith('p1');
  });

  it('F150: opens the order from the card title trigger by keyboard; Pack stays independent', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onPack = vi.fn();
    render(
      <ProductionQueue
        projects={[project('p1', 'accepted', 'Cocina Ana')]}
        customerLabelFor={() => 'Ana'}
        salePriceFor={() => 1000}
        onOpenOrder={onOpen}
        onMarkProduced={vi.fn()}
        onExportProductionPack={onPack}
      />,
    );
    const trigger = screen.getByTestId('prod-open-order-p1');
    expect(trigger.getAttribute('aria-label')).toBe('Abrir orden Cocina Ana');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith('p1');
    // Sin botón dedicado: la apertura vive en el cuerpo de la card (stretched).
    expect(
      screen.queryByRole('button', { name: 'Abrir orden' }),
    ).toBeNull();
    // Pack es una acción de proceso independiente: no abre la orden.
    await user.click(screen.getByTestId('prod-export-pack-p1'));
    expect(onPack).toHaveBeenCalledWith('p1');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('produced tab shows jobs with active claims, no mark button', async () => {
    const user = userEvent.setup();
    render(
      <ProductionQueue
        projects={[
          project('p1', 'accepted', 'Cocina'),
          project('p3', 'accepted', 'Living'),
        ]}
        customerLabelFor={() => 'Cliente'}
        salePriceFor={() => null}
        onOpenOrder={vi.fn()}
        onMarkProduced={vi.fn()}
        activeClaims={[
          {
            activityId: 'a1',
            projectId: 'p3',
            sector: 'cutting',
            operatorName: 'Ana',
            startedAt: '2026-08-18T09:00:00.000Z',
          },
        ]}
      />,
    );
    expect(screen.getByTestId('prod-queue-title').textContent).toBe(
      'Órdenes',
    );
    await user.click(screen.getByTestId('prod-tab-produced'));
    expect(screen.getByTestId('prod-queue-title').textContent).toBe(
      'Órdenes',
    );
    expect(screen.getByText('Living')).toBeTruthy();
    expect(screen.queryByTestId('prod-mark-p3')).toBeNull();
    expect(screen.getByTestId('prod-open-order-p3')).toBeTruthy();
  });

  it('legacy queue (no hub) keeps Optimizer and board preview', async () => {
    const user = userEvent.setup();
    const onOpt = vi.fn();
    const cutRowsFor = vi.fn(
      () =>
        [
          {
            quantity: 2,
            lengthMm: 720,
            widthMm: 560,
            description: 'Lateral',
            materialName: 'Blanco',
            grain: 0,
            L1: 1,
            L2: 0,
            W1: 0,
            W2: 0,
            partName: 'Lateral',
            partCode: 'LAT',
            moduleCode: 'MOD-1',
            labelRef: 'LAT',
          },
        ] as const,
    );
    render(
      <ProductionQueue
        projects={[project('p1', 'accepted', 'Cocina Ana')]}
        customerLabelFor={() => 'Ana'}
        salePriceFor={() => 1000}
        onExportOptimizer={onOpt}
        onMarkProduced={vi.fn()}
        cutRowsFor={cutRowsFor}
      />,
    );
    await user.click(screen.getByTestId('prod-export-opt-p1'));
    expect(onOpt).toHaveBeenCalledWith('p1');
    const toggle = screen.getByTestId('prod-board-toggle-p1');
    expect(toggle.textContent).toContain('Ver tablero');
    await user.click(toggle);
    expect(cutRowsFor).toHaveBeenCalledWith('p1');
    expect(screen.getByTestId('production-board-view')).toBeTruthy();
  });

  it('hides board toggle when hub is wired even if cutRowsFor exists', () => {
    render(
      <ProductionQueue
        projects={[project('p1', 'accepted', 'Cocina Ana')]}
        customerLabelFor={() => 'Ana'}
        salePriceFor={() => 1000}
        onOpenOrder={vi.fn()}
        onMarkProduced={vi.fn()}
        cutRowsFor={() => []}
      />,
    );
    expect(screen.queryByTestId('prod-board-toggle-p1')).toBeNull();
  });
});

describe('ProductionQueue tablist contract (F109)', () => {
  it('exposes workspace tablist with panel linkage and arrow-key roving', async () => {
    const user = userEvent.setup();
    render(
      <ProductionQueue
        projects={[project('pq1', 'accepted', 'Obra tabs')]}
        customerLabelFor={() => 'Ana'}
        salePriceFor={() => null}
        onMarkProduced={vi.fn()}
      />,
    );
    const tablist = screen.getByTestId('prod-tablist');
    expect(tablist.getAttribute('role')).toBe('tablist');
    expect(tablist.className).toContain('tabs--workspace');

    const accepted = screen.getByTestId('prod-tab-accepted');
    const produced = screen.getByTestId('prod-tab-produced');
    expect(accepted.getAttribute('aria-controls')).toBe('prod-queue-panel-accepted');
    expect(produced.getAttribute('aria-controls')).toBe('prod-queue-panel-produced');
    expect(
      document.getElementById('prod-queue-panel-accepted')?.getAttribute('role'),
    ).toBe('tabpanel');
    expect(accepted.getAttribute('aria-selected')).toBe('true');

    accepted.focus();
    await user.keyboard('{ArrowRight}');
    expect(produced.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(produced);
    expect(
      document.getElementById('prod-queue-panel-produced'),
    ).toBeTruthy();
  });
});
