/**
 * @vitest-environment jsdom
 * Embarques — despacho + instalación board (menu reorg).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Project, ProjectItem } from '@muebles/domain';

import { EmbarquesScreen, embarquesProjects } from './EmbarquesScreen';

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

describe('embarquesProjects (pure derivation)', () => {
  it('splits packaged/loaded per project and skips quiet projects', () => {
    const projects = [
      makeProject('p1', [
        makeItem('a', 'packaged'),
        makeItem('b', 'loaded'),
        makeItem('c', 'installed'), // done — not shown
        makeItem('d'),               // pending — manufacturing, not here
      ]),
      makeProject('p2', [makeItem('e', 'packaged')]),
      makeProject('p3', [makeItem('f', 'assembled')]), // nothing to ship
      makeProject('p4', [makeItem('g', 'packaged')], 'draft'), // not in factory
    ];
    const cards = embarquesProjects(projects, () => 'Cliente X');
    expect(cards.map((c) => c.projectId)).toEqual(['p1', 'p2']);
    expect(cards[0]!.toLoad.map((r) => r.itemId)).toEqual(['a']);
    expect(cards[0]!.onRoad.map((r) => r.itemId)).toEqual(['b']);
    expect(cards[1]!.toLoad.map((r) => r.itemId)).toEqual(['e']);
    expect(cards[0]!.customerLabel).toBe('Cliente X');
  });
});

describe('EmbarquesScreen', () => {
  const projects = [
    makeProject('p1', [
      makeItem('a', 'packaged'),
      makeItem('b', 'loaded'),
    ]),
    makeProject('p2', [makeItem('c', 'packaged')]),
  ];

  it('groups by project with Para cargar / En camino sections and totals', () => {
    render(
      <EmbarquesScreen
        projects={projects}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    expect(screen.getByTestId('embarques-card-p1')).not.toBeNull();
    expect(screen.getByTestId('embarques-card-p2')).not.toBeNull();
    expect(screen.getByTestId('embarques-load-a')).not.toBeNull();
    expect(screen.getByTestId('embarques-road-b')).not.toBeNull();
    expect(screen.getByTestId('embarques-to-load').textContent).toBe(
      '2 para cargar',
    );
    expect(screen.getByTestId('embarques-on-road').textContent).toBe(
      '1 en camino',
    );
  });

  it('advances packaged → loaded and loaded → installed via the callback', () => {
    const onAdvance = vi.fn();
    render(
      <EmbarquesScreen
        projects={projects}
        canAdvance
        onAdvance={onAdvance}
      />,
    );
    fireEvent.click(screen.getByTestId('embarques-advance-a'));
    expect(onAdvance).toHaveBeenCalledWith('p1', 'a', 'loaded');
    fireEvent.click(screen.getByTestId('embarques-advance-b'));
    expect(onAdvance).toHaveBeenCalledWith('p1', 'b', 'installed');
  });

  it('hides advance buttons read-only and shows the target label', () => {
    render(
      <EmbarquesScreen
        projects={projects}
        canAdvance={false}
        onAdvance={() => undefined}
      />,
    );
    expect(screen.queryByTestId('embarques-advance-a')).toBeNull();
    // Read-only rows show the target status label (Cargado for packaged,
    // Instalado for loaded) instead of buttons.
    expect(screen.getAllByText('Cargado').length).toBe(2);
    expect(screen.getByText('Instalado')).not.toBeNull();
  });

  it('links to the per-project control de carga when provided', () => {
    const onOpenDispatch = vi.fn();
    render(
      <EmbarquesScreen
        projects={projects}
        canAdvance
        onAdvance={() => undefined}
        onOpenDispatch={onOpenDispatch}
      />,
    );
    fireEvent.click(screen.getByTestId('embarques-dispatch-p1'));
    expect(onOpenDispatch).toHaveBeenCalledWith('p1');
  });

  it('renders the empty state when nothing is packaged or loaded', () => {
    render(
      <EmbarquesScreen
        projects={[makeProject('p1', [makeItem('a', 'cut')])]}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    expect(screen.getByText('Nada para despachar')).not.toBeNull();
    expect(screen.getByTestId('embarques-to-load').textContent).toBe(
      '0 para cargar',
    );
  });
});
