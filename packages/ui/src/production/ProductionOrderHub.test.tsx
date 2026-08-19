/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductionCutRow, Project } from '@muebles/domain';
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
    const cutRow: ProductionCutRow = {
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
    };


    const readiness = buildProductionOrderReadiness({
      project: project(),
      cutRows: [cutRow],
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
        cutRows={[cutRow]}
      />,
    );

    expect(screen.getByTestId('prod-order-hub')).toBeTruthy();
    expect(screen.getByTestId('prod-hub-title').textContent).toContain(
      'Cocina Ana',
    );
    expect(screen.getByTestId('prod-hub-modules').textContent).toBe('2');
    expect(screen.getByTestId('prod-hub-pieces').textContent).toBe('1');
    expect(screen.getByTestId('prod-hub-board-m2').textContent).toBe('0.81');
    expect(screen.getByTestId('prod-hub-edge-ml').textContent).toBe('1.44');
    expect(screen.getByTestId('prod-hub-ready')).toBeTruthy();
    expect(screen.getByTestId('prod-hub-checklist')).toBeTruthy();
    // Factory totals: board m² + edge ml from the resolved cut rows.
    const totals = screen.getByTestId('prod-hub-factory-totals');
    expect(totals.textContent).toContain('Tablero');
    expect(totals.textContent).toContain('m²');
    expect(totals.textContent).toContain('ml');

    await user.click(screen.getByTestId('prod-hub-export-pack'));
    expect(onPack).toHaveBeenCalled();

    // Hub tabs (HUB_TABS): resumen / piso / etiquetas / herrajes /
    // documentos — technical tabs (modulos/despiece/optimizacion) live in
    // Engineering now (2211e2c Hub trim).
    await user.click(screen.getByTestId('prod-hub-tab-documentos'));
    expect(onTab).toHaveBeenCalledWith('documentos');
  });

  it('shows etiquetas tab with the labels panel', () => {
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
        activeTab="etiquetas"
        onTabChange={vi.fn()}
        onBackToQueue={vi.fn()}
        onOpenDesign={vi.fn()}
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
        pieceLabels={[
          {
            moduleCode: 'GAB-01',
            moduleName: 'Gabinete',
            partCode: 'LAT',
            description: 'Lateral',
            quantity: 2,
            lengthMm: 720,
            widthMm: 560,
            materialCode: 'MAT-BLA',
            materialName: 'Blanco',
            L1: true,
            L2: false,
            W1: false,
            W2: false,
            edgeBandingInstruction: 'Encintar L1 con ABS Blanco 1 mm',
          },
        ]}
      />,
    );
    expect(screen.getByTestId('prod-hub-etiquetas')).toBeTruthy();
    expect(screen.getByTestId('prod-labels-download-zpl')).toBeTruthy();
  });

  it('documentos button is honest: ZPL configures the etiquetas tab', async () => {
    const user = userEvent.setup();
    const onTab = vi.fn();
    const readiness = buildProductionOrderReadiness({
      project: project(),
      cutRows: [
        {
          quantity: 1,
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
        salePrice={null}
        readiness={readiness}
        activeTab="documentos"
        onTabChange={onTab}
        onBackToQueue={vi.fn()}
        onOpenDesign={vi.fn()}
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
        pieceLabels={[
          {
            moduleCode: 'GAB-01',
            moduleName: 'Gabinete',
            description: 'Lateral',
            quantity: 1,
            lengthMm: 720,
            widthMm: 560,
            materialCode: 'MAT-BLA',
            materialName: 'Blanco',
            L1: false,
            L2: false,
            W1: false,
            W2: false,
            edgeBandingInstruction: 'Sin encintar',
          },
        ]}
      />,
    );
    expect(
      screen.getByTestId('prod-doc-labels-zpl').textContent,
    ).toContain('Configurar');

    await user.click(screen.getByTestId('prod-doc-labels-zpl'));
    expect(onTab).toHaveBeenCalledWith('etiquetas');
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
