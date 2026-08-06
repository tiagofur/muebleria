/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@muebles/domain';
import { ProductionOrderHub } from './ProductionOrderHub';
import { buildProductionOrderReadiness } from './productionOrderModel';

function project(status: Project['status'] = 'accepted'): Project {
  return {
    id: 'p1',
    name: 'Cocina Ana',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status,
    items: [{ id: 'i1', moduleId: 'm1', quantity: 2, optionChoices: {} }],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

afterEach(() => cleanup());

describe('ProductionOrderHub (PROD-0.3)', () => {
  it('shows checklist, totals, and opens pack when ready', async () => {
    const user = userEvent.setup();
    const onPack = vi.fn();
    const onTab = vi.fn();
    const readiness = buildProductionOrderReadiness({
      project: project(),
      cutRows: [
        {
          quantity: 2,
          lengthMm: 720,
          widthMm: 560,
          description: 'Lateral',
          materialName: 'Blanco',
          grain: 0,
          L1: 0,
          L2: 0,
          W1: 0,
          W2: 0,
        },
      ],
    });

    render(
      <ProductionOrderHub
        project={project()}
        customerLabel="Ana"
        salePrice={1200}
        readiness={readiness}
        activeTab="resumen"
        onTabChange={onTab}
        onBackToQueue={vi.fn()}
        onOpenDesign={vi.fn()}
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
        onExportProductionPack={onPack}
      />,
    );

    expect(screen.getByTestId('prod-order-hub')).toBeTruthy();
    expect(screen.getByTestId('prod-hub-title').textContent).toContain(
      'Cocina Ana',
    );
    expect(screen.getByTestId('prod-hub-modules').textContent).toBe('2');
    expect(screen.getByTestId('prod-hub-pieces').textContent).toBe('1');
    expect(screen.getByTestId('prod-hub-ready')).toBeTruthy();
    expect(screen.getByTestId('prod-hub-checklist')).toBeTruthy();

    await user.click(screen.getByTestId('prod-hub-export-pack'));
    expect(onPack).toHaveBeenCalled();

    await user.click(screen.getByTestId('prod-hub-tab-modulos'));
    expect(onTab).toHaveBeenCalledWith('modulos');
  });

  it('renders modules inventory on modulos tab (PROD-0.4)', () => {
    const readiness = buildProductionOrderReadiness({
      project: project(),
      cutRows: [],
    });
    render(
      <ProductionOrderHub
        project={project()}
        customerLabel="Ana"
        salePrice={null}
        readiness={readiness}
        activeTab="modulos"
        onTabChange={vi.fn()}
        onBackToQueue={vi.fn()}
        onOpenDesign={vi.fn()}
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
        modules={[
          {
            id: 'm1',
            code: 'GAB-01',
            name: 'Gabinete',
            active: true,
            externalDims: { width: 600, height: 720, depth: 560 },
            boardParts: [],
            hardwareLines: [],
          } as import('@muebles/domain').Module,
        ]}
      />,
    );
    expect(screen.getByTestId('prod-hub-modulos')).toBeTruthy();
    expect(screen.getByTestId('prod-modulos-table')).toBeTruthy();
    expect(screen.getByTestId('prod-modulo-row-i1')).toBeTruthy();
    expect(screen.getByText('Gabinete')).toBeTruthy();
  });

  it('shows despiece panel when tab is despiece (PROD-1.3)', () => {
    const readiness = buildProductionOrderReadiness({
      project: project(),
      cutRows: [],
    });
    render(
      <ProductionOrderHub
        project={project()}
        customerLabel="Ana"
        salePrice={null}
        readiness={readiness}
        activeTab="despiece"
        onTabChange={vi.fn()}
        onBackToQueue={vi.fn()}
        onOpenDesign={vi.fn()}
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
        cutRows={[]}
      />,
    );
    expect(screen.getByTestId('prod-hub-despiece')).toBeTruthy();
    expect(screen.queryByTestId('prod-hub-resumen')).toBeNull();
  });

  it('shows optimizacion panel with L0/L1/L2 layers (PROD-2.3)', () => {
    const readiness = buildProductionOrderReadiness({
      project: project(),
      cutRows: [],
    });
    render(
      <ProductionOrderHub
        project={project()}
        customerLabel="Ana"
        salePrice={null}
        readiness={readiness}
        activeTab="optimizacion"
        onTabChange={vi.fn()}
        onBackToQueue={vi.fn()}
        onOpenDesign={vi.fn()}
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
        cutRows={[]}
      />,
    );
    expect(screen.getByTestId('prod-hub-optimizacion')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-l0')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-l1')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-l2')).toBeTruthy();
  });

  it('shows not-ready banner on resumen when cut list empty', () => {
    const readiness = buildProductionOrderReadiness({
      project: project(),
      cutRows: [],
    });
    render(
      <ProductionOrderHub
        project={project()}
        customerLabel="Ana"
        salePrice={null}
        readiness={readiness}
        activeTab="resumen"
        onTabChange={vi.fn()}
        onBackToQueue={vi.fn()}
        onOpenDesign={vi.fn()}
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
      />,
    );
    expect(screen.getByTestId('prod-hub-not-ready')).toBeTruthy();
  });
});
