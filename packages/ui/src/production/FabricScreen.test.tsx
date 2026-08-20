/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Project, ProjectItem } from '@muebles/domain';

import { FabricScreen, summarizeFabricMetrics } from './FabricScreen';

afterEach(cleanup);

function makeItem(
  id: string,
  floorStatus?: ProjectItem['floorStatus'],
): ProjectItem {
  return { id, moduleId: 'mod-1', quantity: 1, optionChoices: {}, floorStatus };
}

function makeProject(
  id: string,
  items: ProjectItem[],
  status: Project['status'] = 'accepted',
): Project {
  return {
    id,
    name: `Obra ${id}`,
    customerId: 'c1',
    status,
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    items,
    materialsRelease: { releasedBy: 'alm1', releasedAt: '2026-08-17T08:00:00.000Z' },
  } as unknown as Project;
}

function clickTab(testId: string) {
  fireEvent.click(screen.getByTestId(testId));
}

describe('FabricScreen — Producción (manufacturing stations)', () => {
  const projects = [
    makeProject('p1', [makeItem('a'), makeItem('b', 'cut')]),
    makeProject('p2', [makeItem('c', 'edged')]),
    // Draft works are not in the factory.
    makeProject('p3', [makeItem('d')], 'draft'),
  ];

  it('uses the workflow underline tab contract with linked panels', () => {
    render(
      <FabricScreen projects={projects} assignedSectors={['cutting', 'edge_banding']} canAdvance onAdvance={() => undefined} />,
    );
    const tablist = screen.getByTestId('fabric-tablist');
    const cutting = screen.getByTestId('fabric-tab-cutting');
    expect(tablist.className).toContain('tabs--workflow');
    expect(cutting.getAttribute('aria-controls')).toBe('fabric-panel-cutting');
    expect(cutting.getAttribute('tabindex')).toBe('0');
    for (const tab of screen.getAllByRole('tab')) {
      expect(document.getElementById(tab.getAttribute('aria-controls') ?? '')).toBeTruthy();
    }
  });

  it('shows the first assigned station tab as active by default', () => {
    render(
      <FabricScreen
        projects={projects}
        assignedSectors={['cutting', 'edge_banding']}
        canAdvance
        onAdvance={() => undefined}
      />,
    );

    // Tab bar shows only assigned stations (manufacturing only).
    expect(screen.getByTestId('fabric-tab-cutting')).not.toBeNull();
    expect(screen.getByTestId('fabric-tab-edge_banding')).not.toBeNull();
    expect(screen.queryByTestId('fabric-tab-assembly')).toBeNull();

    // First tab is active.
    const cuttingTab = screen.getByTestId('fabric-tab-cutting');
    expect(cuttingTab.getAttribute('aria-selected')).toBe('true');

    // Panel shows cutting items.
    expect(screen.getByTestId('fabric-panel-cutting')).not.toBeNull();
    expect(screen.getByTestId('fabric-row-a')).not.toBeNull();
  });

  it('switches tabs when clicked', () => {
    render(
      <FabricScreen
        projects={projects}
        assignedSectors={['cutting', 'edge_banding']}
        canAdvance
        onAdvance={() => undefined}
      />,
    );

    // Click edge_banding tab.
    clickTab('fabric-tab-edge_banding');

    const edgeTab = screen.getByTestId('fabric-tab-edge_banding');
    expect(edgeTab.getAttribute('aria-selected')).toBe('true');
    expect(
      screen.getByTestId('fabric-tab-cutting').getAttribute('aria-selected'),
    ).toBe('false');

    // Panel shows edge_banding items (item 'b' which is 'cut' waits for edge_banding).
    expect(screen.getByTestId('fabric-panel-edge_banding')).not.toBeNull();
    expect(screen.getByTestId('fabric-row-b')).not.toBeNull();
    expect(screen.queryByTestId('fabric-row-a')).toBeNull();
  });

  it('shows the manufacturing stations only when unrestricted (no Despacho/Instalación)', () => {
    render(
      <FabricScreen
        projects={projects}
        assignedSectors={null}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    expect(screen.getByTestId('fabric-tab-cutting')).not.toBeNull();
    expect(screen.getByTestId('fabric-tab-edge_banding')).not.toBeNull();
    expect(screen.getByTestId('fabric-tab-assembly')).not.toBeNull();
    expect(screen.getByTestId('fabric-tab-packaging')).not.toBeNull();
    // Despacho/Instalación moved to Embarques (menu reorg).
    expect(screen.queryByTestId('fabric-tab-shipping')).toBeNull();
    expect(screen.queryByTestId('fabric-tab-installation')).toBeNull();

    // Default tab is cutting — item 'a' (pending) waits here.
    expect(screen.getByTestId('fabric-row-a')).not.toBeNull();

    // Switch to assembly to see item 'c' (edged → waiting for assembly).
    clickTab('fabric-tab-assembly');
    expect(screen.getByTestId('fabric-row-c')).not.toBeNull();
  });

  it('advances via the callback with the station target status', () => {
    const onAdvance = vi.fn();
    render(
      <FabricScreen
        projects={projects}
        assignedSectors={['cutting']}
        canAdvance
        onAdvance={onAdvance}
      />,
    );
    fireEvent.click(screen.getByTestId('fabric-advance-a'));
    expect(onAdvance).toHaveBeenCalledWith('p1', 'a', 'cut');
  });

  it('hides advance buttons without permission (read-only peek)', () => {
    render(
      <FabricScreen
        projects={projects}
        assignedSectors={['cutting']}
        canAdvance={false}
        onAdvance={() => undefined}
      />,
    );
    expect(screen.queryByTestId('fabric-advance-a')).toBeNull();
  });

  it('renders the empty state when nothing waits', () => {
    render(
      <FabricScreen
        projects={[makeProject('p1', [makeItem('a', 'installed')])]}
        assignedSectors={['cutting']}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    expect(screen.getByText('Nada esperándote')).not.toBeNull();
    expect(screen.getByTestId('fabric-total-waiting').textContent).toBe(
      '0 por hacer',
    );
  });

  it('switches to a different tab and shows its items', () => {
    render(
      <FabricScreen
        projects={[makeProject('p1', [makeItem('a', 'edged')])]}
        assignedSectors={['cutting', 'assembly']}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    // Active tab is 'cutting' but item 'a' is edged — not waiting.
    // Switch to assembly to see the item.
    clickTab('fabric-tab-assembly');
    expect(screen.getByTestId('fabric-row-a')).not.toBeNull();
  });

  it('operator assigned only to logistics sectors gets the Embarques hint', () => {
    render(
      <FabricScreen
        projects={projects}
        assignedSectors={['shipping', 'installation']}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    expect(screen.getByText('Tus sectores viven en Embarques o Instalaciones')).not.toBeNull();
    expect(screen.queryByTestId('fabric-tab-cutting')).toBeNull();
  });

  it('total waiting badge sums across all visible tabs', () => {
    const multiProjects = [
      makeProject('p1', [
        makeItem('a'),           // pending → waiting for cutting
        makeItem('b', 'cut'),    // cut → waiting for edge_banding
      ]),
    ];
    render(
      <FabricScreen
        projects={multiProjects}
        assignedSectors={['cutting', 'edge_banding']}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    // cutting: 1 (item a), edge_banding: 1 (item b) = 2 total
    expect(screen.getByTestId('fabric-total-waiting').textContent).toBe(
      '2 por hacer',
    );
  });
});

describe('FabricScreen — metrics toggle (Fase 4.1)', () => {
  const metrics = {
    totalProjects: 2,
    totalItems: 3,
    totalInstalled: 0,
    avgProgress: 10,
    todayCompleted: 5,
    todayDamages: 0,
    sectors: [
      {
        sector: 'cutting',
        label: 'Corte',
        activeOperators: 2,
        queueLength: 8,
        itemsInProgress: 1,
        itemsCompletedToday: 4,
        avgTimeMinutes: 45,
        activeJobs: [],
      },
      {
        sector: 'edge_banding',
        label: 'Encintado',
        activeOperators: 1,
        queueLength: 5,
        itemsInProgress: 0,
        itemsCompletedToday: 1,
        avgTimeMinutes: 30,
        activeJobs: [],
      },
    ],
  };

  it('hides the toggle when no metrics are provided (operators)', () => {
    render(
      <FabricScreen
        projects={[makeProject('p1', [makeItem('a')])]}
        assignedSectors={['cutting']}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    expect(screen.queryByTestId('fabric-view-metrics')).toBeNull();
    expect(screen.queryByTestId('fabric-metrics')).toBeNull();
  });

  it('toggles between queue and metrics views', () => {
    render(
      <FabricScreen
        projects={[makeProject('p1', [makeItem('a')])]}
        assignedSectors={null}
        canAdvance
        onAdvance={() => undefined}
        metrics={metrics}
      />,
    );
    // Queue view is the default; the toggle is visible.
    expect(screen.getByTestId('fabric-panel-cutting')).not.toBeNull();
    expect(screen.queryByTestId('fabric-metrics')).toBeNull();
    expect(screen.getByTestId('fabric-view-queue').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('fabric-view-metrics'));
    expect(screen.getByTestId('fabric-view-metrics').getAttribute('aria-pressed')).toBe('true');
    // Tabs and queue panel are replaced by the metrics table.
    expect(screen.queryByTestId('fabric-tab-cutting')).toBeNull();
    expect(screen.queryByTestId('fabric-panel-cutting')).toBeNull();

    const table = screen.getByTestId('fabric-metrics');
    expect(table.textContent).toContain('Corte');
    expect(table.textContent).toContain('Encintado');
    // Totals row: queue 8 + 5, operators 2 + 1, completed 4 + 1.
    expect(table.textContent).toContain('Total');
    expect(table.textContent).toContain('13');
    expect(table.textContent).toContain('3');
    expect(table.textContent).toContain('5');
    // Weighted average: (45×4 + 30×1) / 5 = 42 min.
    expect(table.textContent).toContain('42 min');

    // Back to the queue.
    fireEvent.click(screen.getByTestId('fabric-view-queue'));
    expect(screen.getByTestId('fabric-panel-cutting')).not.toBeNull();
    expect(screen.queryByTestId('fabric-metrics')).toBeNull();
  });

  it('metrics fetch failed (null) keeps the pure queue view', () => {
    render(
      <FabricScreen
        projects={[makeProject('p1', [makeItem('a')])]}
        assignedSectors={null}
        canAdvance
        onAdvance={() => undefined}
        metrics={null}
      />,
    );
    expect(screen.queryByTestId('fabric-view-metrics')).toBeNull();
    expect(screen.getByTestId('fabric-panel-cutting')).not.toBeNull();
  });

  it('summarizeFabricMetrics weights the average by completions', () => {
    const totals = summarizeFabricMetrics(metrics.sectors);
    expect(totals.queue).toBe(13);
    expect(totals.activeOperators).toBe(3);
    expect(totals.completedToday).toBe(5);
    expect(totals.avgTimeMinutes).toBeCloseTo(42, 5);
  });

  it('summarizeFabricMetrics returns null average without completions', () => {
    expect(
      summarizeFabricMetrics([
        {
          sector: 'cnc',
          label: 'CNC',
          activeOperators: 0,
          queueLength: 2,
          itemsInProgress: 0,
          itemsCompletedToday: 0,
          avgTimeMinutes: 0,
          activeJobs: [],
        },
      ]).avgTimeMinutes,
    ).toBeNull();
  });
});

describe('FabricScreen — tab keyboard navigation (Fase 5.2)', () => {
  it('ArrowRight/End/Home move selection with focus (roving tabindex)', () => {
    render(
      <FabricScreen
        projects={[makeProject('p1', [makeItem('a')])]}
        assignedSectors={null}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    const cutting = screen.getByTestId('fabric-tab-cutting');
    const edge = screen.getByTestId('fabric-tab-edge_banding');
    // Roving tabindex: only the active tab is tabbable.
    expect(cutting.tabIndex).toBe(0);
    expect(edge.tabIndex).toBe(-1);

    // ArrowRight selects + focuses the next sector.
    fireEvent.keyDown(cutting, { key: 'ArrowRight' });
    expect(edge.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(edge);

    // ArrowLeft wraps back to the last tab; Home returns to the first.
    fireEvent.keyDown(edge, { key: 'ArrowLeft' });
    expect(
      screen.getByTestId('fabric-tab-cutting').getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.keyDown(screen.getByTestId('fabric-tab-cutting'), {
      key: 'ArrowLeft',
    });
    expect(
      screen.getByTestId('fabric-tab-packaging').getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.keyDown(screen.getByTestId('fabric-tab-packaging'), {
      key: 'Home',
    });
    expect(cutting.getAttribute('aria-selected')).toBe('true');
  });
});

describe('FabricScreen — project board actions (F096)', () => {
  it('renders a project card, its cutting metrics, claim and explicit batch action', () => {
    const onClaim = vi.fn(async () => undefined);
    const onBatch = vi.fn();
    render(
      <FabricScreen
        projects={[makeProject('p1', [makeItem('a'), makeItem('b')])]}
        assignedSectors={['cutting']}
        canAdvance
        onAdvance={() => undefined}
        onClaim={onClaim}
        onAdvanceBatch={onBatch}
        metricsByProject={{
          p1: {
            materials: [{ key: 'M1', name: 'Melamina', pieces: 2, lines: 1, areaM2: 2.4 }],
            edges: [], sheetEstimates: [{ materialId: 'm1', code: 'M1', name: 'Melamina', areaM2: 2.4, sheetWidthMm: 1220, sheetLengthMm: 2440, sheetAreaM2: 2.97, wastePercent: 10, estimatedSheets: 1 }], edgeBandColors: {},
          },
        }}
        pickingStates={[{ projectId: 'p1', material: 'tableros', status: 'despachado' }]}
      />,
    );
    expect(screen.getByTestId('fabric-card-p1')).not.toBeNull();
    expect(screen.getByText(/2.4 m² netos/)).not.toBeNull();
    expect(screen.getByText('Surtido por almacén')).not.toBeNull();
    fireEvent.click(screen.getByTestId('fabric-claim-p1'));
    expect(onClaim).toHaveBeenCalledWith('p1', 'cutting');
    fireEvent.click(screen.getByTestId('fabric-batch-p1'));
    expect(onBatch).toHaveBeenCalledWith('p1', ['a', 'b'], 'cut');
  });

  it('shows the persisted pending picking state without claiming stock or an unrecorded dispatch', () => {
    render(
      <FabricScreen
        projects={[makeProject('p1', [makeItem('a')])]}
        assignedSectors={['cutting']}
        canAdvance={false}
        onAdvance={() => undefined}
        metricsByProject={{
          p1: {
            materials: [{ key: 'M1', name: 'Melamina', pieces: 1, lines: 1, areaM2: 1 }],
            edges: [], sheetEstimates: [], edgeBandColors: {},
          },
        }}
        pickingStates={[{ projectId: 'p1', material: 'tableros', status: 'pendiente' }]}
      />,
    );

    expect(screen.getByText('Almacén: Pendiente')).not.toBeNull();
    expect(screen.queryByText('Surtido por almacén')).toBeNull();
  });

  it('F120: confirms via modal before finishing the last claim, then advances its batch', async () => {
    const onFinish = vi.fn(async () => undefined);
    const onBatch = vi.fn();
    render(
      <FabricScreen
        projects={[makeProject('p1', [makeItem('a'), makeItem('b')])]}
        assignedSectors={['cutting']}
        canAdvance
        onAdvance={() => undefined}
        activeClaims={[{ activityId: 'claim-1', projectId: 'p1', sector: 'cutting', operatorName: 'Ana', startedAt: '2026-08-18T14:32:00.000Z' }]}
        onFinish={onFinish}
        onAdvanceBatch={onBatch}
        confirmBatchMessage={(count, target) => `¿Marcar ${count} módulos como ${target}?`}
      />,
    );

    expect(screen.getByText(/En curso · empezó/)).not.toBeNull();
    // First click opens the confirm modal — nothing runs yet.
    fireEvent.click(screen.getByTestId('fabric-finish-claim-1'));
    expect(screen.getByTestId('fabric-batch-confirm-modal')).not.toBeNull();
    expect(screen.getByTestId('fabric-batch-confirm-message').textContent).toBe(
      '¿Marcar 2 módulos como cut?',
    );
    expect(onFinish).not.toHaveBeenCalled();

    // Cancel keeps everything untouched.
    fireEvent.click(screen.getByTestId('fabric-batch-confirm-cancel'));
    expect(onFinish).not.toHaveBeenCalled();
    expect(onBatch).not.toHaveBeenCalled();

    // Confirm runs the finish + batch advance.
    fireEvent.click(screen.getByTestId('fabric-finish-claim-1'));
    fireEvent.click(screen.getByTestId('fabric-batch-confirm-ok'));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith('claim-1', 2));
    expect(onBatch).toHaveBeenCalledWith('p1', ['a', 'b'], 'cut');
  });

  it('does not batch-advance when another operator still has a claim', async () => {
    const onFinish = vi.fn(async () => undefined);
    const onBatch = vi.fn();
    render(
      <FabricScreen
        projects={[makeProject('p1', [makeItem('a')])]}
        assignedSectors={['cutting']}
        canAdvance
        onAdvance={() => undefined}
        onFinish={onFinish}
        onAdvanceBatch={onBatch}
        activeClaims={[
          { activityId: 'claim-1', projectId: 'p1', sector: 'cutting', operatorName: 'Ana', startedAt: '2026-08-18T14:32:00.000Z' },
          { activityId: 'claim-2', projectId: 'p1', sector: 'cutting', operatorName: 'Beto', startedAt: '2026-08-18T14:35:00.000Z' },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId('fabric-finish-claim-1'));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith('claim-1', 1));
    expect(onBatch).not.toHaveBeenCalled();
  });
});
