/**
 * @vitest-environment jsdom
 *
 * Optimization layers (PROD-2.3) — rendered by EngineeringWorkspace since
 * the Hub trim (2211e2c); this test covers the panel directly.
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

describe('ProductionOrderOptimizationPanel (PROD-2.3)', () => {
  it('shows L0/L1/L2 layers and points official exports to Documentos', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={null}
        cutRows={[]}
      />,
    );
    expect(screen.getByTestId('prod-hub-optimizacion')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-l0')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-l1')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-l2')).toBeTruthy();
    // Official exports moved to Documentos/Etiquetas — optimización only
    // points at them.
    expect(
      screen.getByTestId('prod-opt-official-hint').textContent,
    ).toContain('Documentos');
    expect(screen.queryByTestId('prod-opt-export-zpl')).toBeNull();
    expect(screen.queryByTestId('prod-opt-export-optimizer')).toBeNull();
  });
});
