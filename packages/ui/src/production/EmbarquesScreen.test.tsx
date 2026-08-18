/**
 * @vitest-environment jsdom
 * Embarques — carga board (packaged → loaded).
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
  it('keeps only packaged items; loaded/installed/draft are out', () => {
    const projects = [
      makeProject('p1', [
        makeItem('a', 'packaged'),
        makeItem('b', 'loaded'),      // → Instalaciones, not here
        makeItem('c', 'installed'),   // done
        makeItem('d'),                // manufacturing
      ]),
      makeProject('p2', [makeItem('e', 'packaged')]),
      makeProject('p3', [makeItem('f', 'assembled')]), // nothing to load
      makeProject('p4', [makeItem('g', 'packaged')], 'draft'),
    ];
    const cards = embarquesProjects(projects, () => 'Cliente X');
    expect(cards.map((c) => c.projectId)).toEqual(['p1', 'p2']);
    expect(cards[0]!.toLoad.map((r) => r.itemId)).toEqual(['a']);
    expect(cards[1]!.toLoad.map((r) => r.itemId)).toEqual(['e']);
    expect(cards[0]!.customerLabel).toBe('Cliente X');
  });
});

describe('EmbarquesScreen', () => {
  const projects = [
    makeProject('p1', [
      makeItem('a', 'packaged'),
      makeItem('b', 'loaded'), // lives in Instalaciones now
    ]),
    makeProject('p2', [makeItem('c', 'packaged')]),
  ];

  it('groups packaged items by project with the load total', () => {
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
    expect(screen.queryByTestId('embarques-load-b')).toBeNull();
    expect(screen.getByTestId('embarques-to-load').textContent).toBe(
      '2 para cargar',
    );
  });

  it('advances packaged → loaded via the callback', () => {
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
    expect(screen.getAllByText('Cargado').length).toBe(2);
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

  it('renders the empty state when nothing is packaged', () => {
    render(
      <EmbarquesScreen
        projects={[makeProject('p1', [makeItem('a', 'cut')])]}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    expect(screen.getByText('Nada para cargar')).not.toBeNull();
    expect(screen.getByTestId('embarques-to-load').textContent).toBe(
      '0 para cargar',
    );
  });
});
