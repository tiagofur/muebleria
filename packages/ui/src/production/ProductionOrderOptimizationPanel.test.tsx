/**
 * @vitest-environment jsdom
 *
 * Cut Plan & Optimization Panel (F115) — Native 2D Cut Plan, Warehouse Requisition & Exports.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Project } from '@muebles/domain';
import { ProductionOrderOptimizationPanel } from './ProductionOrderOptimizationPanel';

function project(): Project {
  return {
    id: 'p1',
    name: 'Cocina Ana',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [{ id: 'i1', moduleId: 'm1', quantity: 2, optionChoices: {} }],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

afterEach(() => cleanup());

describe('ProductionOrderOptimizationPanel (F115)', () => {
  it('renders cut plan parameters, warehouse requisition, workspace and exports area', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={null}
        cutRows={[]}
      />,
    );
    expect(screen.getByTestId('prod-hub-optimizacion')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-config')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-summary')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-workspace')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-exports')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-export-pdf-manual')).toBeTruthy();
  });
});
