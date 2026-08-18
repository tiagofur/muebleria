/**
 * @vitest-environment jsdom
 *
 * Modules inventory (PROD-0.4) — rendered by EngineeringWorkspace since the
 * Hub trim (2211e2c); this test covers the panel directly.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Module, Project } from '@muebles/domain';
import { ProductionOrderModulesPanel } from './ProductionOrderModulesPanel';

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

describe('ProductionOrderModulesPanel (PROD-0.4)', () => {
  it('renders the modules inventory table', () => {
    render(
      <ProductionOrderModulesPanel
        project={project()}
        modules={[
          {
            id: 'm1',
            code: 'GAB-01',
            name: 'Gabinete',
            active: true,
            externalDims: { width: 600, height: 720, depth: 560 },
            boardParts: [],
            hardwareLines: [],
          } as Module,
        ]}
        cutRows={null}
      />,
    );
    expect(screen.getByTestId('prod-hub-modulos')).toBeTruthy();
    expect(screen.getByTestId('prod-modulos-table')).toBeTruthy();
    expect(screen.getByTestId('prod-modulo-row-i1')).toBeTruthy();
    expect(screen.getByText('Gabinete')).toBeTruthy();
  });
});
