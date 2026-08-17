/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { Project, ProjectItem } from '@muebles/domain';

import {
  ProjectFloorProgressStrip,
  ProjectFloorStageChip,
} from './ProjectFloorProgressStrip';
import { PlantBoardScreen } from './PlantBoardScreen';

afterEach(cleanup);

function makeItem(id: string, floorStatus?: ProjectItem['floorStatus']): ProjectItem {
  return { id, moduleId: 'mod-1', quantity: 1, optionChoices: {}, floorStatus };
}

function makeProject(items: ProjectItem[], status: Project['status'] = 'accepted'): Project {
  return {
    id: 'p1',
    name: 'Cocina Nellly',
    customerId: 'c1',
    status,
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    items,
  } as unknown as Project;
}

describe('ProjectFloorProgressStrip', () => {
  it('shows per-sector progress with the bottleneck active', () => {
    const project = makeProject([
      makeItem('a', 'cut'),
      makeItem('b', 'installed'),
    ]);
    render(<ProjectFloorProgressStrip project={project} />);

    const strip = screen.getByTestId('project-floor-strip');
    expect(strip).not.toBeNull();
    // Corte reached by both items → done with check.
    expect(screen.getAllByText('Corte').length).toBeGreaterThan(0);
    screen.getByText('✓');
    // Encintado is the first unfinished sector → active with count 1/2;
    // every later sector shows the same count — assert at least one.
    expect(screen.getAllByText('1/2').length).toBeGreaterThan(0);
    expect(strip.getAttribute('role')).toBe('img');
    expect(strip.getAttribute('aria-label')).toContain('Encintado');
  });

  it('renders nothing without items', () => {
    const { container } = render(
      <ProjectFloorProgressStrip project={makeProject([])} />,
    );
    expect(container.querySelector('.floor-strip')).toBeNull();
  });
});

describe('ProjectFloorStageChip', () => {
  it('labels the bottleneck sector and percentage', () => {
    const project = makeProject([
      makeItem('a'),
      makeItem('b', 'assembled'),
    ]);
    render(<ProjectFloorStageChip project={project} />);
    screen.getByText('Corte');
    screen.getByText('25%');
  });

  it('says Instalado when everything is installed', () => {
    const project = makeProject([makeItem('a', 'installed')]);
    render(<ProjectFloorStageChip project={project} />);
    screen.getByText('Instalado');
    screen.getByText('100%');
  });
});

describe('PlantBoardScreen', () => {
  it('renders accepted projects as rows with sector columns', () => {
    const projects = [
      makeProject([makeItem('a'), makeItem('b', 'edged')], 'accepted'),
      // Draft/quoted works are not in the factory yet — excluded.
      makeProject([makeItem('a')], 'draft'),
    ];
    render(
      <PlantBoardScreen
        projects={projects}
        customerLabelFor={() => 'Nélida Pérez'}
      />,
    );

    screen.getByText('Estado de Planta');
    const headers = screen.getAllByText('Corte');
    expect(headers.length).toBeGreaterThan(0);
    screen.getByText('Nélida Pérez');
    expect(screen.getByTestId('plant-board-row-p1')).not.toBeNull();
  });

  it('shows the empty state when nothing is in the factory', () => {
    render(<PlantBoardScreen projects={[makeProject([makeItem('a')], 'quoted')]} />);
    screen.getByText('Sin obras en fábrica');
    expect(screen.queryByTestId('plant-board-table')).toBeNull();
  });

  it('links to the order for plant roles and to the project otherwise', () => {
    const projects = [makeProject([makeItem('a')])];
    const onOpenOrder = vi.fn();
    const onOpenProject = vi.fn();
    render(
      <PlantBoardScreen
        projects={projects}
        onOpenOrder={onOpenOrder}
        onOpenProject={onOpenProject}
      />,
    );
    screen.getByTestId('plant-board-open-order-p1').click();
    expect(onOpenOrder).toHaveBeenCalledWith('p1');
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('falls back to the project link when the hub is not allowed', () => {
    const projects = [makeProject([makeItem('a')])];
    const onOpenProject = vi.fn();
    render(
      <PlantBoardScreen projects={projects} onOpenProject={onOpenProject} />,
    );
    expect(screen.queryByTestId('plant-board-open-order-p1')).toBeNull();
    screen.getByTestId('plant-board-open-project-p1').click();
    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });
});
