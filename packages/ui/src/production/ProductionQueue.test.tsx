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
  it('lists accepted jobs and marks produced', async () => {
    const user = userEvent.setup();
    const onMark = vi.fn();
    const onOpt = vi.fn();
    const onHw = vi.fn();
    render(
      <ProductionQueue
        projects={[
          project('p1', 'accepted', 'Cocina Ana'),
          project('p2', 'draft', 'Borrador'),
          project('p3', 'produced', 'Living hecho'),
        ]}
        customerLabelFor={() => 'Ana'}
        salePriceFor={() => 1000}
        onExportOptimizer={onOpt}
        onExportHardware={onHw}
        onMarkProduced={onMark}
      />,
    );
    expect(screen.getByText('Cocina Ana')).toBeTruthy();
    expect(screen.queryByText('Borrador')).toBeNull();
    expect(screen.queryByText('Living hecho')).toBeNull();

    await user.click(screen.getByTestId('prod-export-opt-p1'));
    expect(onOpt).toHaveBeenCalledWith('p1');
    await user.click(screen.getByTestId('prod-mark-p1'));
    expect(onMark).toHaveBeenCalledWith('p1');
  });

  it('produced tab shows finished jobs without mark button', async () => {
    const user = userEvent.setup();
    render(
      <ProductionQueue
        projects={[
          project('p1', 'accepted', 'Cocina'),
          project('p3', 'produced', 'Living hecho'),
        ]}
        customerLabelFor={() => 'Cliente'}
        salePriceFor={() => null}
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
        onMarkProduced={vi.fn()}
      />,
    );
    expect(screen.getByTestId('prod-queue-title').textContent).toBe(
      'Para fabricar',
    );
    await user.click(screen.getByTestId('prod-tab-produced'));
    expect(screen.getByTestId('prod-queue-title').textContent).toBe(
      'Ya en planta',
    );
    expect(screen.getByText('Living hecho')).toBeTruthy();
    expect(screen.queryByTestId('prod-mark-p3')).toBeNull();
    expect(screen.getByTestId('prod-export-opt-p3')).toBeTruthy();
  });

  it('shows board view toggle when cutRowsFor is wired (gap #2)', async () => {
    const user = userEvent.setup();
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
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
        onMarkProduced={vi.fn()}
        cutRowsFor={cutRowsFor}
      />,
    );
    // Toggle is present because cutRowsFor is wired.
    const toggle = screen.getByTestId('prod-board-toggle-p1');
    expect(toggle.textContent).toContain('Ver tablero');
    // Board view not rendered yet.
    expect(screen.queryByTestId('production-board-view')).toBeNull();
    // Expand → board view renders and calls cutRowsFor with the project id.
    await user.click(toggle);
    expect(cutRowsFor).toHaveBeenCalledWith('p1');
    expect(screen.getByTestId('production-board-view')).toBeTruthy();
    expect(toggle.textContent).toContain('Ocultar tablero');
  });

  it('hides board toggle when cutRowsFor is not provided', () => {
    render(
      <ProductionQueue
        projects={[project('p1', 'accepted', 'Cocina Ana')]}
        customerLabelFor={() => 'Ana'}
        salePriceFor={() => 1000}
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
        onMarkProduced={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('prod-board-toggle-p1')).toBeNull();
  });
});
