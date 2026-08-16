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
      cutRows: [
        {
          quantity: 2,
          lengthMm: 720,
          widthMm: 560,
          description: 'Lateral',
          materialName: 'Blanco',
          grain: 1,
          L1: 1,
          L2: 0,
          W1: 0,
          W2: 1,
        },
      ],
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
        cutRows={[
          {
            quantity: 2,
            lengthMm: 720,
            widthMm: 560,
            description: 'Lateral',
            materialName: 'Blanco',
            grain: 1,
            L1: 1,
            L2: 0,
            W1: 0,
            W2: 1,
          },
        ]}
      />,
    );
    expect(screen.getByTestId('prod-hub-despiece')).toBeTruthy();
    expect(screen.queryByTestId('prod-hub-resumen')).toBeNull();
    // D-lite: veta column, edge legend and per-group subtotals.
    expect(screen.getByText('Veta')).toBeTruthy();
    expect(screen.getByText('↗')).toBeTruthy();
    expect(screen.getByText(/Cantos: lados L1\/L2/)).toBeTruthy();
    const totals = screen.getByTestId(
      'prod-despiece-totals-Blanco',
    ).textContent;
    expect(totals).toContain('2 piezas');
    expect(totals).toContain('0.81 m²');
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
    // Official exports moved to Documentos/Etiquetas — optimización only
    // points at them.
    expect(
      screen.getByTestId('prod-opt-official-hint').textContent,
    ).toContain('Documentos');
    expect(
      screen.queryByTestId('prod-opt-export-zpl'),
    ).toBeNull();
    expect(
      screen.queryByTestId('prod-opt-export-optimizer'),
    ).toBeNull();
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

  it('documentos buttons are honest: ZPL configures, despiece views the tab', async () => {
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
    expect(screen.getByTestId('prod-doc-despiece').textContent).toContain(
      'Ver tab',
    );

    await user.click(screen.getByTestId('prod-doc-labels-zpl'));
    expect(onTab).toHaveBeenCalledWith('etiquetas');

    await user.click(screen.getByTestId('prod-doc-despiece'));
    expect(onTab).toHaveBeenCalledWith('despiece');
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

  it('renders dispatch panel when activeTab is despacho', () => {
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
        activeTab="despacho"
        onTabChange={vi.fn()}
        onBackToQueue={vi.fn()}
        onOpenDesign={vi.fn()}
        onExportOptimizer={vi.fn()}
        onExportHardware={vi.fn()}
      />,
    );
    expect(screen.getByTestId('prod-hub-despacho')).toBeTruthy();
  });
});
