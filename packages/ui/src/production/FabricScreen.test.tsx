/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Project, ProjectItem } from '@muebles/domain';

import { FabricScreen } from './FabricScreen';

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
  } as unknown as Project;
}

function clickTab(testId: string) {
  fireEvent.click(screen.getByTestId(testId));
}

describe('FabricScreen — Fábrica (Phase 1)', () => {
  const projects = [
    makeProject('p1', [makeItem('a'), makeItem('b', 'cut')]),
    makeProject('p2', [makeItem('c', 'edged')]),
    // Draft works are not in the factory.
    makeProject('p3', [makeItem('d')], 'draft'),
  ];

  it('shows the first assigned sector tab as active by default', () => {
    render(
      <FabricScreen
        projects={projects}
        assignedSectors={['cutting', 'edge_banding']}
        canAdvance
        onAdvance={() => undefined}
      />,
    );

    // Tab bar shows only assigned sectors.
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

  it('shows every tab when unrestricted (no assignments)', () => {
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
    expect(screen.getByTestId('fabric-tab-shipping')).not.toBeNull();
    expect(screen.getByTestId('fabric-tab-installation')).not.toBeNull();

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

  it('Despacho tab shows packaged items', () => {
    const packagedProjects = [
      makeProject('p1', [makeItem('a', 'packaged'), makeItem('b', 'loaded')]),
    ];
    render(
      <FabricScreen
        projects={packagedProjects}
        assignedSectors={null}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    clickTab('fabric-tab-shipping');
    // 'a' is packaged → waiting for shipping.
    expect(screen.getByTestId('fabric-row-a')).not.toBeNull();
    // 'b' is loaded → already past shipping.
    expect(screen.queryByTestId('fabric-row-b')).toBeNull();
  });

  it('Instalación tab shows loaded items', () => {
    const loadedProjects = [
      makeProject('p1', [makeItem('a', 'loaded'), makeItem('b', 'installed')]),
    ];
    render(
      <FabricScreen
        projects={loadedProjects}
        assignedSectors={null}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    clickTab('fabric-tab-installation');
    // 'a' is loaded → waiting for installation.
    expect(screen.getByTestId('fabric-row-a')).not.toBeNull();
    // 'b' is installed → already past installation.
    expect(screen.queryByTestId('fabric-row-b')).toBeNull();
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
