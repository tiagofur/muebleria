// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FabricScreen } from './FabricScreen';
import { fabricProjectCards, type FabricProjectCard } from './fabricProjectCards';
import type { Project } from '@granete/domain';

vi.mock('./useHidScanner', () => ({
  useHidScanner: ({ onScan }: { onScan: (code: string) => void }) => {
    (globalThis as unknown as { __hidScan?: (code: string) => void }).__hidScan = onScan;
  },
}));

const baseProject: Project = {
  id: 'prj-1',
  name: 'Cocina Gate',
  status: 'produced',
  currency: 'MXN',
  marginFactor: 1.35,
  laborFixedCost: 0,
  items: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  customerId: 'cust-1',
};

function makeCard(): FabricProjectCard {
  return {
    projectId: 'prj-1',
    projectName: 'Cocina Gate',
    customerLabel: 'Cliente Gate',
    activeClaims: [],
    executionBlocker: null,
    releaseLabel: 'Liberación #1 · Diseño R2',
    needsPhysicalGeneration: false,
    items: [
      {
        itemId: 'item-1',
        moduleName: 'Gabinete',
        quantity: 1,
        currentStatus: 'cutting',
        part: {
          id: 'part-1',
          partCode: 'P1-01',
          unitIndex: 1,
          lengthMm: 600,
          widthMm: 720,
          thicknessMm: 18,
          operationType: 'cutting',
          operationStatus: 'pending',
        },
      },
      {
        itemId: 'item-2',
        moduleName: 'Gabinete',
        quantity: 1,
        currentStatus: 'cutting',
        part: {
          id: 'part-2',
          partCode: 'P1-02',
          unitIndex: 1,
          lengthMm: 500,
          widthMm: 700,
          thicknessMm: 18,
          operationType: 'cutting',
          operationStatus: 'pending',
        },
      },
    ],
  } as unknown as FabricProjectCard;
}

// #1145: la pantalla computa sus cards con la función pura — mockeamos el
// módulo para controlar las filas de pieza del test.
vi.mock('./fabricProjectCards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fabricProjectCards')>();
  return {
    ...actual,
    fabricProjectCards: () => [
      {
        projectId: 'prj-1',
        projectName: 'Cocina Gate',
        customerLabel: 'Cliente Gate',
        activeClaims: [],
        executionBlocker: null,
        materials: [],
        releaseLabel: 'Liberación #1 · Diseño R2',
        needsPhysicalGeneration: false,
        items: [
          {
            itemId: 'item-1',
            moduleName: 'Gabinete',
            quantity: 1,
            currentStatus: 'cutting',
            part: {
              id: 'part-1',
              partCode: 'P1-01',
              unitIndex: 1,
              lengthMm: 600,
              widthMm: 720,
              thicknessMm: 18,
              operationType: 'cutting',
              operationStatus: 'pending',
            },
          },
          {
            itemId: 'item-2',
            moduleName: 'Gabinete',
            quantity: 1,
            currentStatus: 'cutting',
            part: {
              id: 'part-2',
              partCode: 'P1-02',
              unitIndex: 1,
              lengthMm: 500,
              widthMm: 700,
              thicknessMm: 18,
              operationType: 'cutting',
              operationStatus: 'pending',
            },
          },
        ],
      } as unknown as FabricProjectCard,
    ],
  };
});

const baseProps = {
  projects: [baseProject],
  assignedSectors: null,
  canAdvance: true,
  onAdvance: vi.fn(),
  onAdvancePart: vi.fn(),
  onAdvanceUnit: vi.fn(),
  onAdvanceBatch: vi.fn(),
  onClaim: vi.fn(),
  onFinish: vi.fn(),
};

describe('FabricScreen S7 (#1145)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('P0: escanear un partCode de la estación avanza la pieza con announce', () => {
    render(<FabricScreen {...baseProps} />);
    const scan = (globalThis as unknown as { __hidScan?: (code: string) => void }).__hidScan!;
    expect(typeof scan).toBe('function');
    act(() => scan('P1-01'));
    expect(screen.getByTestId('fabric-scan-status').textContent).toContain('P1-01');
    expect(screen.getByTestId('fabric-scan-status').textContent).toContain('P1-01');
    expect(screen.getByTestId('fabric-session-scans').textContent).toContain('1');
  });

  it('P0: código desconocido suena miss con mensaje inline sin navegar', () => {
    render(<FabricScreen {...baseProps} />);
    const scan = (globalThis as unknown as { __hidScan?: (code: string) => void }).__hidScan!;
    act(() => scan('ZZZ-99'));
    expect(screen.getByTestId('fabric-scan-status').textContent).toContain('no está en la cola');
    expect(baseProps.onAdvancePart).not.toHaveBeenCalled();
  });

  it('P1: el doble tap no duplica el avance (single-flight por fila)', async () => {
    const user = userEvent.setup();
    render(<FabricScreen {...baseProps} />);
    const btn = screen.getByTestId('fabric-advance-part-part-1');
    expect(btn.getAttribute('disabled')).toBeNull();
    await user.click(btn);
    expect(btn.getAttribute('disabled')).not.toBeNull();
    fireEvent.click(btn);
    expect(baseProps.onAdvancePart).toHaveBeenCalledTimes(1);
  });

  it('P1: los avances por botón también alimentan announce y conteo', async () => {
    const user = userEvent.setup();
    render(<FabricScreen {...baseProps} />);
    await user.click(screen.getByTestId('fabric-advance-part-part-1'));
    expect(screen.getByTestId('fabric-scan-status').textContent).toContain('P1-01');
    expect(screen.getByTestId('fabric-session-scans').textContent).toContain('1');
  });
});
