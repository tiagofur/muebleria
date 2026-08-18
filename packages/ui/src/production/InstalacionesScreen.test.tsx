/**
 * @vitest-environment jsdom
 * Instalaciones — installation board (loaded → installed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Project, ProjectItem } from '@muebles/domain';

import { InstalacionesScreen, instalacionesProjects } from './InstalacionesScreen';

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

describe('instalacionesProjects (pure derivation)', () => {
  it('keeps loaded items and counts installed; other statuses are out', () => {
    const projects = [
      makeProject('p1', [
        makeItem('a', 'loaded'),
        makeItem('b', 'installed'),
        makeItem('c', 'packaged'), // still in Embarques
        makeItem('d'),
      ]),
      makeProject('p2', [makeItem('e', 'loaded')]),
      makeProject('p3', [makeItem('f', 'installed')]), // nothing pending → out
      makeProject('p4', [makeItem('g', 'loaded')], 'draft'),
    ];
    const cards = instalacionesProjects(projects, () => 'Cliente X');
    expect(cards.map((c) => c.projectId)).toEqual(['p1', 'p2']);
    expect(cards[0]!.toInstall.map((r) => r.itemId)).toEqual(['a']);
    expect(cards[0]!.installedCount).toBe(1);
    expect(cards[0]!.customerLabel).toBe('Cliente X');
  });
});

describe('InstalacionesScreen', () => {
  const projects = [
    makeProject('p1', [
      makeItem('a', 'loaded'),
      makeItem('b', 'installed'),
    ]),
    makeProject('p2', [makeItem('c', 'loaded')]),
  ];

  it('groups loaded items by project with install totals', () => {
    render(
      <InstalacionesScreen
        projects={projects}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    expect(screen.getByTestId('instalaciones-card-p1')).not.toBeNull();
    expect(screen.getByTestId('instalaciones-card-p2')).not.toBeNull();
    expect(screen.getByTestId('instalaciones-install-a')).not.toBeNull();
    expect(screen.getByTestId('instalaciones-to-install').textContent).toBe(
      '2 para instalar',
    );
    expect(screen.getByTestId('instalaciones-installed').textContent).toBe(
      '1 instalados',
    );
  });

  it('advances loaded → installed via the callback', () => {
    const onAdvance = vi.fn();
    render(
      <InstalacionesScreen
        projects={projects}
        canAdvance
        onAdvance={onAdvance}
      />,
    );
    fireEvent.click(screen.getByTestId('instalaciones-advance-a'));
    expect(onAdvance).toHaveBeenCalledWith('p1', 'a', 'installed');
  });

  it('hides advance buttons read-only and shows the target label', () => {
    render(
      <InstalacionesScreen
        projects={projects}
        canAdvance={false}
        onAdvance={() => undefined}
      />,
    );
    expect(screen.queryByTestId('instalaciones-advance-a')).toBeNull();
    expect(screen.getAllByText('Instalado').length).toBe(2);
  });

  it('renders the empty state when nothing is loaded', () => {
    render(
      <InstalacionesScreen
        projects={[makeProject('p1', [makeItem('a', 'packaged')])]}
        canAdvance
        onAdvance={() => undefined}
      />,
    );
    expect(screen.getByText('Nada para instalar')).not.toBeNull();
    expect(screen.getByTestId('instalaciones-to-install').textContent).toBe(
      '0 para instalar',
    );
  });
});
