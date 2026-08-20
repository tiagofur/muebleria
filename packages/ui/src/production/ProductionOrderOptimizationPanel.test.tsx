/**
 * @vitest-environment jsdom
 *
 * Cut Plan & Optimization Panel (F115) — Native 2D Cut Plan, Warehouse Requisition & Exports.
 * F126: estrategia de corte (sierra vs CNC nesting) y despacho exclusivo de export.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CutPlan, Project } from '@muebles/domain';
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

function cutPlanFixture(strategy: 'saw-guillotine' | 'cnc-nesting'): CutPlan {
  return {
    id: 'cutplan-1',
    projectId: 'p1',
    projectName: 'Cocina Ana',
    generatedAt: '2026-08-20T00:00:00.000Z',
    version: 1,
    isFrozen: false,
    config: {
      sawKerfMm: 4,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: true,
      allowRotationNoGrain: true,
      minRemnantWidthMm: 400,
      minRemnantLengthMm: 600,
      preferLongitudinalRips: true,
      cutStrategy: strategy,
      ...(strategy === 'cnc-nesting' ? { toolSpacingMm: 8 } : {}),
    },
    sheets: [
      {
        sheetIndex: 0,
        strategy,
        materialCode: 'MDF18',
        materialName: 'MDF Blanco 18mm',
        sheetWidthMm: 1830,
        sheetLengthMm: 2440,
        thicknessMm: 18,
        pieces: [
          {
            id: 'LAT-01-1-s0',
            partCode: 'LAT-01',
            partName: 'Lateral',
            moduleCode: 'M01',
            labelRef: 'A1',
            materialName: 'MDF Blanco 18mm',
            materialCode: 'MDF18',
            xMm: 10,
            yMm: 10,
            lengthMm: 800,
            widthMm: 500,
            originalLengthMm: 800,
            originalWidthMm: 500,
            grain: 1,
            rotated: false,
            L1: 1,
            L2: 0,
            W1: 0,
            W2: 0,
            thicknessMm: 18,
            sheetIndex: 0,
            stripIndex: 0,
            cutSequenceNumber: 1,
            status: 'pending',
          },
        ],
        remnants: [],
        instructions:
          strategy === 'saw-guillotine'
            ? [
                {
                  step: 1,
                  phase: 1,
                  cutType: 'trim',
                  description: 'Refilar bordes perimetrales',
                  positionMm: 0,
                  lengthMm: 4270,
                },
              ]
            : [],
        netPiecesAreaM2: 0.4,
        grossSheetAreaM2: 4.47,
        usableRemnantAreaM2: 0,
        wasteAreaM2: 4.07,
        wastePercent: 91,
        yieldPercent: 9,
      },
    ],
    stats: {
      totalSheets: 1,
      totalPieces: 1,
      totalGrossAreaM2: 4.47,
      totalNetPiecesAreaM2: 0.4,
      totalUsefulRemnantsAreaM2: 0,
      totalWasteAreaM2: 4.07,
      globalWastePercent: 91,
      globalYieldPercent: 9,
      byMaterial: [],
    },
    usefulRemnants: [],
  };
}

function cutRowsFixture() {
  return [
    {
      quantity: 1,
      lengthMm: 800,
      widthMm: 500,
      description: 'Lateral · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 1 as const,
      L1: 1 as const,
      L2: 0 as const,
      W1: 0 as const,
      W2: 0 as const,
      partCode: 'LAT-01',
      partName: 'Lateral',
      moduleCode: 'M01',
      thicknessMm: 18,
    },
  ];
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

describe('ProductionOrderOptimizationPanel — estrategia de corte (F126)', () => {
  it('el selector cambia la config: nesting muestra espaciado de fresa y oculta el kerf', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={null}
        cutRows={[]}
      />,
    );

    expect(screen.getByText('Disco / Kerf (mm)')).toBeTruthy();
    expect(screen.queryByText('Espaciado fresa (mm)')).toBeNull();

    fireEvent.click(screen.getByTestId('prod-opt-strategy-nesting'));

    expect(screen.getByText('Espaciado fresa (mm)')).toBeTruthy();
    expect(screen.queryByText('Disco / Kerf (mm)')).toBeNull();
    expect(screen.getByTestId('prod-opt-strategy-nesting').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('prod-opt-strategy-saw').getAttribute('aria-pressed')).toBe('false');
  });

  it('plan sierra: exporta PDF, Optimizer XLSX y PTX, y no ofrece DXF', () => {
    const onExportCutPlanPtx = vi.fn();
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
        catalog={null}
        cutRows={[]}
        onExportOptimizer={() => {}}
        onExportCutPlanDxf={() => {}}
        onExportCutPlanPtx={onExportCutPlanPtx}
      />,
    );

    expect(screen.getByTestId('prod-opt-export-pdf-manual')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-export-optimizer-xlsx')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-export-ptx')).toBeTruthy();
    expect(screen.queryByTestId('prod-opt-export-dxf-sheets')).toBeNull();
    expect(screen.queryByTestId('prod-opt-export-dxf-pieces')).toBeNull();

    fireEvent.click(screen.getByTestId('prod-opt-export-ptx'));
    expect(onExportCutPlanPtx).toHaveBeenCalledTimes(1);
  });

  it('plan nesting: exporta DXF (tableros y piezas) y oculta PDF/Optimizer', () => {
    const onExportCutPlanDxf = vi.fn();
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('cnc-nesting') }}
        catalog={null}
        cutRows={[]}
        onExportOptimizer={() => {}}
        onExportCutPlanDxf={onExportCutPlanDxf}
      />,
    );

    expect(screen.getByTestId('prod-opt-export-dxf-sheets')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-export-dxf-pieces')).toBeTruthy();
    expect(screen.queryByTestId('prod-opt-export-pdf-manual')).toBeNull();
    expect(screen.queryByTestId('prod-opt-export-optimizer-xlsx')).toBeNull();

    fireEvent.click(screen.getByTestId('prod-opt-export-dxf-sheets'));
    expect(onExportCutPlanDxf).toHaveBeenCalledWith(expect.anything(), 'sheets');

    fireEvent.click(screen.getByTestId('prod-opt-export-dxf-pieces'));
    expect(onExportCutPlanDxf).toHaveBeenCalledWith(expect.anything(), 'pieces');
  });

  it('plan nesting sin secuencia: no renderiza el panel de secuencia de corte', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('cnc-nesting') }}
        catalog={null}
        cutRows={cutRowsFixture()}
      />,
    );

    expect(screen.queryByText('Refilar bordes perimetrales')).toBeNull();
  });

  it('plan sierra: muestra la secuencia de corte del tablero activo', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
        catalog={null}
        cutRows={cutRowsFixture()}
      />,
    );

    expect(screen.getByText('Refilar bordes perimetrales')).toBeTruthy();
  });
});
