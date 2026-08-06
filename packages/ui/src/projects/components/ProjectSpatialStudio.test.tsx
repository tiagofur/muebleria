/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { Module, Project } from '@muebles/domain';

vi.mock('../../preview3d', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../preview3d')>();
  return {
    ...actual,
    canUseWebGL: () => true,
    FurnitureScene3D: (props: {
      testId?: string;
      fillViewport?: boolean;
      className?: string;
    }) => (
      <div
        data-testid={props.testId ?? 'furniture-scene-3d'}
        className={[
          'module-scene-3d',
          props.fillViewport ? 'module-scene-3d--fill' : '',
          props.className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
      />
    ),
  };
});

import { ProjectSpatialStudio } from './ProjectSpatialStudio';

afterEach(() => {
  cleanup();
});

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
    { id: 'p800', name: '800', width: 800, height: 720, depth: 560 },
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
  it('applies bootstrap filter unplaced when opening after add-item', () => {
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
      },
    };
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
        bootstrap={{ listFilter: 'unplaced' }}
        quoteSalePrice={1500}
      />,
    );
    expect(screen.getByTestId('spatial-studio-filter-unplaced').className).toMatch(
      /filter--on/,
    );
    expect(screen.getByTestId('spatial-studio-quote-total').textContent).toMatch(
      /Total/,
    );
  });

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

  it('filters list and places on double-click', () => {
    const onChangeLayout = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
      },
    };
    render(
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
    fireEvent.click(screen.getByTestId('spatial-studio-filter-unplaced'));
    expect(screen.getByTestId('spatial-studio-unplaced-it-a-0')).toBeTruthy();
    fireEvent.doubleClick(screen.getByTestId('spatial-studio-unplaced-it-a-0'));
    expect(onChangeLayout).toHaveBeenCalled();
    const next = onChangeLayout.mock.calls.at(-1)![0];
    expect(next.placements).toHaveLength(1);
    expect(next.placements[0]!.itemId).toBe('it-a');
  });

  it('adds a second environment (multi-ambiente)', () => {
    const onChangeLayout = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [
          {
            itemId: 'it-a',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 0,
            elevation: 'floor',
          },
        ],
      },
    };
    render(
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
    expect(screen.getByTestId('spatial-studio-spaces')).toBeTruthy();
    fireEvent.click(screen.getByTestId('spatial-studio-add-space'));
    expect(onChangeLayout).toHaveBeenCalled();
    const next = onChangeLayout.mock.calls.at(-1)![0] as {
      spaces?: Array<{ name: string; walls: unknown[]; placements: unknown[] }>;
      activeSpaceId?: string;
      walls: unknown[];
    };
    expect(next.spaces?.length).toBeGreaterThanOrEqual(2);
    expect(next.walls).toHaveLength(0); // new empty space is active
  });

  it('places unplaced unit as free island', () => {
    const onChangeLayout = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [
          { id: 'w1', lengthMm: 3000, angleDeg: 0, originXMm: 0, originYMm: 0 },
        ],
        placements: [],
      },
    };
    render(
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
    fireEvent.click(screen.getByTestId('spatial-studio-filter-unplaced'));
    fireEvent.click(screen.getByTestId('spatial-studio-place-island-it-a-0'));
    expect(onChangeLayout).toHaveBeenCalled();
    const next = onChangeLayout.mock.calls.at(-1)![0] as {
      placements: Array<{
        mode?: string;
        freeXMm?: number;
        freeYMm?: number;
        itemId: string;
      }>;
    };
    expect(next.placements).toHaveLength(1);
    expect(next.placements[0]!.itemId).toBe('it-a');
    expect(next.placements[0]!.mode).toBe('free');
    expect(typeof next.placements[0]!.freeXMm).toBe('number');
    expect(typeof next.placements[0]!.freeYMm).toBe('number');
  });

  it('shows free-mode inspector for island placement', () => {
    const projectIsland: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [
          {
            itemId: 'it-a',
            instanceIndex: 0,
            wallId: '',
            offsetMm: 0,
            elevation: 'floor',
            mode: 'free',
            freeXMm: 1000,
            freeYMm: 800,
            freeYawDeg: 90,
          },
        ],
      },
    };
    render(
      <ProjectSpatialStudio
        open
        project={projectIsland}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('spatial-studio-placed-it-a-0'));
    fireEvent.click(screen.getByTestId('spatial-studio-tab-position'));
    expect(screen.getByTestId('spatial-studio-free-mode')).toBeTruthy();
    expect(screen.getByTestId('spatial-studio-free-x')).toBeTruthy();
    expect(
      (screen.getByTestId('spatial-studio-free-yaw') as HTMLSelectElement).value,
    ).toBe('90');
  });

  it('repacks wall and supports undo of plan edits', () => {
    const onChangeLayout = vi.fn();
    const projectWithTwo: Project = {
      ...project,
      items: [
        {
          id: 'it-a',
          moduleId: 'm-a',
          quantity: 1,
          optionChoices: {},
          measurePresetId: 'p600',
        },
        {
          id: 'it-b',
          moduleId: 'm-a',
          quantity: 1,
          optionChoices: {},
          measurePresetId: 'p600',
        },
      ],
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [
          {
            itemId: 'it-a',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 100,
            elevation: 'floor',
          },
          {
            itemId: 'it-b',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 900,
            elevation: 'floor',
          },
        ],
      },
    };
    const { rerender } = render(
      <ProjectSpatialStudio
        open
        project={projectWithTwo}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
      />,
    );
    fireEvent.click(screen.getByTestId('spatial-studio-placed-it-a-0'));
    fireEvent.click(screen.getByTestId('spatial-studio-tab-position'));
    fireEvent.click(screen.getByTestId('spatial-studio-repack-wall'));
    expect(onChangeLayout).toHaveBeenCalled();
    const packed = onChangeLayout.mock.calls.at(-1)![0];
    expect(packed.placements.find((p: { itemId: string }) => p.itemId === 'it-a')!.offsetMm).toBe(0);
    expect(packed.placements.find((p: { itemId: string }) => p.itemId === 'it-b')!.offsetMm).toBe(620);

    // Undo needs the studio to have recorded previous layout; re-render with packed state
    // and click undo after another edit that has history.
    rerender(
      <ProjectSpatialStudio
        open
        project={{ ...projectWithTwo, kitchenLayout: packed }}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
      />,
    );
    fireEvent.click(screen.getByTestId('spatial-studio-placed-it-a-0'));
    fireEvent.click(screen.getByTestId('spatial-studio-tab-position'));
    fireEvent.click(screen.getByTestId('spatial-studio-nudge-right'));
    const undoBtn = screen.getByTestId(
      'spatial-studio-undo',
    ) as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(false);
    fireEvent.click(undoBtn);
    const afterUndo = onChangeLayout.mock.calls.at(-1)![0];
    // Undo restores layout as of before the nudge (packed offsets).
    expect(
      afterUndo.placements.find((p: { itemId: string }) => p.itemId === 'it-a')!
        .offsetMm,
    ).toBe(0);
  });

  it('collapses list to rail with unplaced badge', () => {
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
      },
    };
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('spatial-studio-collapse-list'));
    expect(screen.getByTestId('spatial-studio-list-rail')).toBeTruthy();
    expect(screen.getByTestId('spatial-studio-rail-unplaced').textContent).toBe(
      '1',
    );
  });

  it('shows scene toolbar and can toggle plan mini', async () => {
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [
          { id: 'w1', lengthMm: 3000, angleDeg: 0, originXMm: 0, originYMm: 0 },
          {
            id: 'w2',
            lengthMm: 2500,
            angleDeg: 90,
            originXMm: 3000,
            originYMm: 0,
          },
        ],
        placements: [],
      },
    };
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    expect(
      await screen.findByTestId('spatial-studio-scene-toolbar'),
    ).toBeTruthy();
    expect(screen.getByTestId('spatial-studio-mode-pill')).toBeTruthy();
    fireEvent.click(screen.getByTestId('spatial-studio-toggle-plan2d'));
    expect(screen.getByTestId('spatial-studio-plan-mini')).toBeTruthy();
  });

  it('uses fillViewport studio layout class for hero 3D', async () => {
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [
          {
            itemId: 'it-a',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 0,
            elevation: 'floor',
          },
        ],
      },
    };
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    // Lazy FurnitureScene3D + useEffect(canUseWebGL)
    const scene = await screen.findByTestId('spatial-studio-scene');
    expect(scene.className).toContain('module-scene-3d--fill');
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

  it('toggles countertop and sets wall cabinet install height', () => {
    const onChangeLayout = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
        showCountertop: true,
      },
    };
    render(
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
    fireEvent.click(screen.getByTestId('spatial-studio-wall-z-1500'));
    expect(onChangeLayout).toHaveBeenCalledWith(
      expect.objectContaining({ wallCabinetZMm: 1500 }),
    );
    fireEvent.click(screen.getByTestId('spatial-studio-toggle-countertop'));
    expect(onChangeLayout).toHaveBeenCalledWith(
      expect.objectContaining({ showCountertop: false }),
    );
  });

  it('sets layout base clearance (zoclo) for floor cabinets', () => {
    const onChangeLayout = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
      },
    };
    render(
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
    fireEvent.click(screen.getByTestId('spatial-studio-layout-plinth-120'));
    expect(onChangeLayout).toHaveBeenCalledWith(
      expect.objectContaining({ baseClearanceMm: 120 }),
    );
  });

  it('changes measure preset from properties panel (Promob-like)', () => {
    const onUpdateItem = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      items: [
        {
          id: 'it-a',
          moduleId: 'm-a',
          quantity: 1,
          optionChoices: {},
          measurePresetId: 'p600',
        },
      ],
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [
          {
            itemId: 'it-a',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 0,
            elevation: 'floor',
          },
        ],
      },
    };

    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
        onUpdateItem={onUpdateItem}
      />,
    );

    fireEvent.click(screen.getByTestId('spatial-studio-placed-it-a-0'));
    expect(screen.getByTestId('spatial-studio-dims').textContent).toMatch(
      /600/,
    );
    fireEvent.click(screen.getByTestId('spatial-studio-preset-p800'));
    expect(onUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'it-a', measurePresetId: 'p800' }),
    );
  });
});
