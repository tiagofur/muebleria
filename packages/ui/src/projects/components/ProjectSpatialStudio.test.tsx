/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Module, Project } from '@muebles/domain';
import { ProjectSpatialStudio } from './ProjectSpatialStudio';

const modA: Module = {
  id: 'm-a',
  code: 'MOD-A',
  name: 'Bajo 600',
  structureId: 'st1',
  components: [],
  hardwareLines: [],
  externalDims: { width: 600, height: 720, depth: 560 },
  furnitureType: 'inferior',
  presets: [
    { id: 'p600', name: '600', width: 600, height: 720, depth: 560 },
  ],
};

const project: Project = {
  id: 'prj-1',
  name: 'Cocina demo',
  customerId: 'c1',
  currency: 'UYU',
  marginFactor: 1.5,
  laborFixedCost: 0,
  status: 'draft',
  items: [
    {
      id: 'it-a',
      moduleId: 'm-a',
      quantity: 1,
      optionChoices: {},
      measurePresetId: 'p600',
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const catalog = {
  modules: [modA],
  structures: [],
  components: [],
  materials: [],
  edges: [],
  hardware: [],
  optionGroups: [],
};

describe('ProjectSpatialStudio', () => {
  it('does not render when closed', () => {
    render(
      <ProjectSpatialStudio
        open={false}
        project={project}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('project-spatial-studio')).toBeNull();
  });

  it('creates L walls and places unplaced unit on wall', () => {
    const onChangeLayout = vi.fn();
    const { rerender } = render(
      <ProjectSpatialStudio
        open
        project={project}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
      />,
    );

    expect(screen.getByTestId('project-spatial-studio')).toBeTruthy();
    fireEvent.click(screen.getByTestId('spatial-studio-create-l'));
    expect(onChangeLayout).toHaveBeenCalled();
    const withWalls = onChangeLayout.mock.calls[0]![0];
    expect(withWalls.walls).toHaveLength(2);

    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: withWalls.walls,
        placements: [],
      },
    };
    onChangeLayout.mockClear();
    rerender(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
      />,
    );

    fireEvent.click(screen.getByTestId('spatial-studio-place-it-a-0'));
    expect(onChangeLayout).toHaveBeenCalled();
    const next = onChangeLayout.mock.calls[0]![0];
    expect(next.placements).toHaveLength(1);
    expect(next.placements[0]!.itemId).toBe('it-a');
    expect(next.placements[0]!.elevation).toBe('floor');
  });
});
