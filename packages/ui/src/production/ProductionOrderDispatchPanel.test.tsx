/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Module, ModuleLabel, Project } from '@granete/domain';
import { moduleLabelQrPayload } from '@granete/domain';
import { ProductionOrderDispatchPanel } from './ProductionOrderDispatchPanel';

function projectFixture(): Project {
  return {
    id: 'p1',
    name: 'Cocina Ana',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      { id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {}, floorStatus: 'packaged' },
      { id: 'item-2', moduleId: 'mod-2', quantity: 1, optionChoices: {}, floorStatus: 'assembled' },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

const MODULES: readonly Module[] = [
  {
    id: 'mod-1',
    code: 'GAB-01',
    name: 'Bajo Fregadero',
    furnitureType: 'inferior',
    hardwareLines: [],
  },
  {
    id: 'mod-2',
    code: 'ALAC-01',
    name: 'Alacena Superior',
    furnitureType: 'superior',
    hardwareLines: [],
  },
];

const MODULE_LABELS: readonly ModuleLabel[] = [
  {
    itemId: 'item-1',
    factoryCode: 'GAB-01',
    moduleCode: 'GAB-01',
    moduleName: 'Bajo Fregadero',
    projectId: 'p1',
    projectName: 'Cocina Ana',
    customerName: 'Cliente Ana',
    packageIndex: 1,
    totalPackages: 2,
    unitIndex: 1,
    unitQuantity: 1,
    widthMm: 800,
    heightMm: 850,
    depthMm: 600,
    measuresLabel: '800×850×600 mm',
    spaceName: 'Cocina',
    wallName: 'Muro Norte',
    floorStatus: 'packaged',
    boardPartCount: 4,
    hardwareCount: 6,
    revision: '1',
  },
  {
    itemId: 'item-2',
    factoryCode: 'ALAC-01',
    moduleCode: 'ALAC-01',
    moduleName: 'Alacena Superior',
    projectId: 'p1',
    projectName: 'Cocina Ana',
    customerName: 'Cliente Ana',
    packageIndex: 2,
    totalPackages: 2,
    unitIndex: 1,
    unitQuantity: 1,
    widthMm: 600,
    heightMm: 720,
    depthMm: 350,
    measuresLabel: '600×720×350 mm',
    spaceName: 'Cocina',
    wallName: 'Muro Sur',
    floorStatus: 'assembled',
    boardPartCount: 2,
    hardwareCount: 4,
    revision: '1',
  },
];

afterEach(() => {
  cleanup();
});

describe('ProductionOrderDispatchPanel', () => {
  it('renders loading progress and blocked gate when modules are pending load', () => {
    render(
      <ProductionOrderDispatchPanel
        project={projectFixture()}
        modules={MODULES}
        moduleLabels={MODULE_LABELS}
      />,
    );

    expect(screen.getByTestId('prod-hub-despacho')).toBeTruthy();
    expect(screen.getByTestId('prod-dispatch-progress-text').textContent).toContain('0% cargado (0 de 2 bultos)');
    expect(screen.getByTestId('prod-dispatch-gate').textContent).toContain('Liberación Bloqueada');
    expect(screen.getByTestId('prod-dispatch-release-btn-disabled')).toBeTruthy();
  });

  it('renders ready gate and calls onReleaseToDelivery when 100% loaded', async () => {
    const user = userEvent.setup();
    const onReleaseToDelivery = vi.fn();
    const loadedProject: Project = {
      ...projectFixture(),
      items: [
        { id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {}, floorStatus: 'loaded' },
        { id: 'item-2', moduleId: 'mod-2', quantity: 1, optionChoices: {}, floorStatus: 'loaded' },
      ],
    };

    render(
      <ProductionOrderDispatchPanel
        project={loadedProject}
        modules={MODULES}
        moduleLabels={MODULE_LABELS}
        onReleaseToDelivery={onReleaseToDelivery}
      />,
    );

    expect(screen.getByTestId('prod-dispatch-progress-text').textContent).toContain('100% cargado (2 de 2 bultos)');
    expect(screen.getByTestId('prod-dispatch-gate').textContent).toContain('¡Carga 100% Completa y Verificada!');

    const releaseBtn = screen.getByTestId('prod-dispatch-release-btn');
    await user.click(releaseBtn);
    expect(onReleaseToDelivery).toHaveBeenCalledTimes(1);
  });

  it('filters by status and searches by module name/location', async () => {
    const user = userEvent.setup();
    render(
      <ProductionOrderDispatchPanel
        project={projectFixture()}
        modules={MODULES}
        moduleLabels={MODULE_LABELS}
      />,
    );

    // Initial state: 2 cards
    expect(screen.getByTestId('prod-dispatch-card-item-1')).toBeTruthy();
    expect(screen.getByTestId('prod-dispatch-card-item-2')).toBeTruthy();

    // Search filter
    await user.type(screen.getByTestId('prod-dispatch-search'), 'Fregadero');
    expect(screen.getByTestId('prod-dispatch-card-item-1')).toBeTruthy();
    expect(screen.queryByTestId('prod-dispatch-card-item-2')).toBeNull();

    await user.clear(screen.getByTestId('prod-dispatch-search'));
    expect(screen.getByTestId('prod-dispatch-card-item-2')).toBeTruthy();
  });

  it('handles 1-click status update buttons for loading and packaging', async () => {
    const user = userEvent.setup();
    const onSetFloorStatus = vi.fn();
    render(
      <ProductionOrderDispatchPanel
        project={projectFixture()}
        modules={MODULES}
        moduleLabels={MODULE_LABELS}
        onSetFloorStatus={onSetFloorStatus}
      />,
    );

    // Click "Marcar Cargado ✓" on item-1
    await user.click(screen.getByTestId('prod-dispatch-mark-loaded-item-1'));
    expect(onSetFloorStatus).toHaveBeenCalledWith('item-1', 'loaded');

    // Click "Embalado" on item-2 (which was assembled)
    await user.click(screen.getByTestId('prod-dispatch-mark-packaged-item-2'));
    expect(onSetFloorStatus).toHaveBeenCalledWith('item-2', 'packaged');
  });

  it('scans QR payload and marks item as loaded automatically', async () => {
    const user = userEvent.setup();
    const onSetFloorStatus = vi.fn();
    render(
      <ProductionOrderDispatchPanel
        project={projectFixture()}
        modules={MODULES}
        moduleLabels={MODULE_LABELS}
        onSetFloorStatus={onSetFloorStatus}
      />,
    );

    const qrJson = moduleLabelQrPayload(MODULE_LABELS[0]!);
    fireEvent.change(screen.getByTestId('prod-dispatch-scan-input'), {
      target: { value: qrJson },
    });
    await user.click(screen.getByTestId('prod-dispatch-scan-submit'));

    expect(onSetFloorStatus).toHaveBeenCalledWith('item-1', 'loaded');
    expect(screen.getByTestId('prod-dispatch-scan-feedback').textContent).toContain('GAB-01');
    expect(screen.getByTestId('prod-dispatch-scan-feedback').textContent).toContain('CARGADO');
  });
});
