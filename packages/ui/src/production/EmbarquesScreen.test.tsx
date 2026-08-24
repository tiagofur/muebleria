/**
 * @vitest-environment jsdom
 * Embarques — project list + project detail (loading checklist).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
  it('keeps projects with packaged or loaded items', () => {
    const projects = [
      makeProject('p1', [
        makeItem('a', 'packaged'),
        makeItem('b', 'loaded'),
        makeItem('c', 'installed'), // done — still counts
        makeItem('d'), // manufacturing — not relevant
      ]),
      makeProject('p2', [makeItem('e', 'packaged')]),
      makeProject('p3', [makeItem('f', 'assembled')]), // nothing to load
      makeProject('p4', [makeItem('g', 'packaged')], 'draft'), // draft — out
    ];
    const cards = embarquesProjects(projects, () => 'Cliente X');
    expect(cards.map((c) => c.projectId)).toEqual(['p1', 'p2']);
    expect(cards[0]!.customerLabel).toBe('Cliente X');
  });

  it('computes loading progress per project', () => {
    const projects = [
      makeProject('p1', [
        makeItem('a', 'packaged'),
        makeItem('b', 'loaded'),
      ]),
    ];
    const cards = embarquesProjects(projects);
    expect(cards[0]!.totalBultos).toBe(2);
    expect(cards[0]!.loadedBultos).toBe(1);
    expect(cards[0]!.percentage).toBe(50);
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

  it('shows project cards with progress summary', () => {
    render(
      <EmbarquesScreen
        projects={projects}
        customerLabelFor={() => 'Cliente'}
      />,
    );
    expect(screen.getByTestId('embarques-card-p1')).not.toBeNull();
    expect(screen.getByTestId('embarques-card-p2')).not.toBeNull();
    expect(screen.getByTestId('embarques-to-load').textContent).toBe(
      '2 bultos por cargar',
    );
  });

  it('opens the loading detail from the card title trigger (mouse + keyboard)', async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();
    render(
      <EmbarquesScreen
        projects={projects}
        customerLabelFor={() => 'Cliente'}
        onOpenProject={onOpenProject}
      />,
    );
    const trigger = screen.getByTestId('embarques-open-p1');
    expect(trigger.getAttribute('aria-label')).toBe('Abrir carga Obra p1');
    fireEvent.click(trigger);
    expect(onOpenProject).toHaveBeenCalledWith('p1');
    onOpenProject.mockClear();
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(onOpenProject).toHaveBeenCalledWith('p1');
    // Sin botón dedicado: la apertura vive en el cuerpo de la card (stretched).
    expect(
      screen.queryByRole('button', { name: 'Ver detalle' }),
    ).toBeNull();
  });

  it('shows complete badge when 100% loaded', () => {
    const completeProjects = [
      makeProject('p1', [
        makeItem('a', 'loaded'),
        makeItem('b', 'loaded'),
      ]),
    ];
    render(
      <EmbarquesScreen
        projects={completeProjects}
        customerLabelFor={() => 'Cliente'}
      />,
    );
    expect(screen.getByText('✓ Lista para enviar')).not.toBeNull();
  });

  it('renders the empty state when nothing is packaged', () => {
    render(
      <EmbarquesScreen
        projects={[makeProject('p1', [makeItem('a', 'cut')])]}
        customerLabelFor={() => 'Cliente'}
      />,
    );
    expect(screen.getByText('Nada para cargar')).not.toBeNull();
  });
});
