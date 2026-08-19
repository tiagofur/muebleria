/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Module, Project } from '@muebles/domain';
import { ITEM_FLOOR_STATUSES, pieceLabelQrPayload } from '@muebles/domain';
import {
  matchModuleFromScan,
  ProductionOrderPaperlessPanel,
} from './ProductionOrderPaperlessPanel';
import { buildProductionModuleRows } from './productionModuleRows';

afterEach(() => cleanup());

const modules: Module[] = [
  {
    id: 'm1',
    code: 'GAB-01',
    name: 'Gabinete base',
    active: true,
    externalDims: { width: 600, height: 720, depth: 560 },
    boardParts: [],
    hardwareLines: [],
  } as Module,
];

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Obra',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
      { id: 'i2', moduleId: 'm1', quantity: 1, optionChoices: {}, floorStatus: 'cut' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

/** Scanner-gun burst on window (nothing focused — global listener path). */
function fireHidScan(code: string): void {
  for (const ch of code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ch }));
  }
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
  );
}

describe('matchModuleFromScan (F089)', () => {
  const rows = buildProductionModuleRows(project(), modules);

  it('matches by payload v2 module code', () => {
    const payload = pieceLabelQrPayload({
      projectId: 'p1',
      moduleCode: 'GAB-01',
      description: 'Costado',
      materialCode: 'TAB-1',
      lengthMm: 720,
      widthMm: 560,
    });
    expect(matchModuleFromScan(payload, rows)?.itemId).toBe('i1');
  });

  it('matches by legacy v1 payload', () => {
    const legacy = JSON.stringify({
      v: 1,
      projectId: 'p1',
      module: 'GAB-01',
      desc: 'Costado',
      material: 'TAB-1',
      L: 720,
      W: 560,
    });
    expect(matchModuleFromScan(legacy, rows)?.itemId).toBe('i1');
  });

  it('matches by exact factory code before module code', () => {
    expect(matchModuleFromScan('GAB-01-L2', rows)?.itemId).toBe('i2');
    expect(matchModuleFromScan('gab-01', rows)?.itemId).toBe('i1');
  });

  it('returns null for unknown or blank scans', () => {
    expect(matchModuleFromScan('NOPE-99', rows)).toBeNull();
    expect(matchModuleFromScan('   ', rows)).toBeNull();
  });
});

describe('ProductionOrderPaperlessPanel scan-to-advance (F089)', () => {
  it('HID scan of a payload v2 label auto-advances the matched item', async () => {
    const onSetFloorStatus = vi.fn();
    render(
      <ProductionOrderPaperlessPanel
        project={project()}
        modules={modules}
        onSetFloorStatus={onSetFloorStatus}
        canSetFloorStatus
      />,
    );
    const payload = pieceLabelQrPayload({
      projectId: 'p1',
      moduleCode: 'GAB-01',
      description: 'Costado',
      materialCode: 'TAB-1',
      lengthMm: 720,
      widthMm: 560,
    });
    fireHidScan(payload);

    expect(onSetFloorStatus).toHaveBeenCalledTimes(1);
    expect(onSetFloorStatus).toHaveBeenCalledWith('i1', 'cut');
    await waitFor(() =>
      expect(screen.getByTestId('prod-piso-scan-result')).toBeTruthy(),
    );
    expect(screen.getByTestId('prod-piso-scan-advanced').textContent).toContain(
      'Cortado',
    );
  });

  it('debounces a double Enter from the scanner (one transition only)', () => {
    const onSetFloorStatus = vi.fn();
    render(
      <ProductionOrderPaperlessPanel
        project={project()}
        modules={modules}
        onSetFloorStatus={onSetFloorStatus}
        canSetFloorStatus
      />,
    );
    const payload = pieceLabelQrPayload({
      projectId: 'p1',
      moduleCode: 'GAB-01',
      description: 'Costado',
      materialCode: 'TAB-1',
      lengthMm: 720,
      widthMm: 560,
    });
    fireHidScan(payload);
    fireHidScan(payload);
    expect(onSetFloorStatus).toHaveBeenCalledTimes(1);
  });

  it('scanning a second, different line advances it independently', () => {
    const onSetFloorStatus = vi.fn();
    render(
      <ProductionOrderPaperlessPanel
        project={project()}
        modules={modules}
        onSetFloorStatus={onSetFloorStatus}
        canSetFloorStatus
      />,
    );
    fireHidScan('GAB-01');
    expect(onSetFloorStatus).toHaveBeenLastCalledWith('i1', 'cut');
    fireHidScan('GAB-01-L2');
    expect(onSetFloorStatus).toHaveBeenLastCalledWith('i2', 'edged');
    expect(onSetFloorStatus).toHaveBeenCalledTimes(2);
  });

  it('does not auto-advance when the toggle is off (match only)', async () => {
    const onSetFloorStatus = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductionOrderPaperlessPanel
        project={project()}
        modules={modules}
        onSetFloorStatus={onSetFloorStatus}
        canSetFloorStatus
      />,
    );
    await user.click(screen.getByTestId('prod-piso-autoadvance-toggle'));
    fireHidScan('GAB-01');

    expect(onSetFloorStatus).not.toHaveBeenCalled();
    // Manual advance button stays available on the scan result.
    await waitFor(() =>
      expect(screen.getByTestId('prod-piso-scan-advance')).toBeTruthy(),
    );
  });

  it('shows a visible miss for unknown codes and does not transition', async () => {
    const onSetFloorStatus = vi.fn();
    render(
      <ProductionOrderPaperlessPanel
        project={project()}
        modules={modules}
        onSetFloorStatus={onSetFloorStatus}
        canSetFloorStatus
      />,
    );
    fireHidScan('NOPE-99');
    await waitFor(() =>
      expect(screen.getByTestId('prod-piso-scan-miss')).toBeTruthy(),
    );
    expect(onSetFloorStatus).not.toHaveBeenCalled();
  });

  it('manual form submit advances once (HID ignores the focused input)', async () => {
    const onSetFloorStatus = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductionOrderPaperlessPanel
        project={project()}
        modules={modules}
        onSetFloorStatus={onSetFloorStatus}
        canSetFloorStatus
      />,
    );
    await user.type(screen.getByTestId('prod-piso-scan-input'), 'GAB-01{Enter}');
    expect(onSetFloorStatus).toHaveBeenCalledTimes(1);
    expect(onSetFloorStatus).toHaveBeenCalledWith('i1', 'cut');
  });

  it('camera fallback manual entry scans through the same path', async () => {
    const onSetFloorStatus = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductionOrderPaperlessPanel
        project={project()}
        modules={modules}
        onSetFloorStatus={onSetFloorStatus}
        canSetFloorStatus
      />,
    );
    await user.click(screen.getByTestId('prod-piso-camera-open'));
    await user.type(
      screen.getByTestId('prod-piso-camera-manual-input'),
      'GAB-01',
    );
    await user.click(screen.getByTestId('prod-piso-camera-manual-submit'));

    expect(onSetFloorStatus).toHaveBeenCalledTimes(1);
    expect(onSetFloorStatus).toHaveBeenCalledWith('i1', 'cut');
  });

  it('read-only scan (no canSetFloorStatus) matches without transitioning', async () => {
    const onSetFloorStatus = vi.fn();
    render(
      <ProductionOrderPaperlessPanel
        project={project()}
        modules={modules}
        onSetFloorStatus={onSetFloorStatus}
      />,
    );
    fireHidScan('GAB-01');
    await waitFor(() =>
      expect(screen.getByTestId('prod-piso-scan-result')).toBeTruthy(),
    );
    expect(onSetFloorStatus).not.toHaveBeenCalled();
  });
});

describe('ProductionOrderPaperlessPanel tablist contract (F109)', () => {
  it('exposes workflow tablist with counts, panel linkage and arrow-key roving', async () => {
    const user = userEvent.setup();
    render(
      <ProductionOrderPaperlessPanel project={project()} modules={modules} />,
    );
    const tablist = screen.getByTestId('prod-piso-tablist');
    expect(tablist.getAttribute('role')).toBe('tablist');
    expect(tablist.className).toContain('tabs--workflow');

    const all = screen.getByTestId('prod-piso-tab-all');
    const firstStatus = screen.getByTestId(`prod-piso-tab-${ITEM_FLOOR_STATUSES[0]}`);
    expect(all.getAttribute('aria-controls')).toBe('prod-piso-panel-all');
    expect(
      firstStatus.getAttribute('aria-controls'),
    ).toBe(`prod-piso-panel-${ITEM_FLOOR_STATUSES[0]}`);
    expect(
      document.getElementById('prod-piso-panel-all')?.getAttribute('role'),
    ).toBe('tabpanel');
    // Counts survive via the count badge (2 modules total).
    expect(all.textContent).toContain('2');

    all.focus();
    await user.keyboard('{ArrowRight}');
    expect(firstStatus.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(firstStatus);
    expect(
      document.getElementById(`prod-piso-panel-${ITEM_FLOOR_STATUSES[0]}`),
    ).toBeTruthy();
  });
});
