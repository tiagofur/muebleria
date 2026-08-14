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
      ambientFloor?: { readonly id?: string } | null;
      ambientWall?: { readonly id?: string } | null;
      showCeiling?: boolean;
      onPaintDrop?: (drop: import('../../preview3d').PaintDrop | null) => void;
      onPaintHover?: (
        surface: import('../../preview3d').PaintSurface | null,
      ) => void;
      paintHoverSurface?: import('../../preview3d').PaintSurface | null;
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
        data-ambient-floor={props.ambientFloor?.id ?? ''}
        data-ambient-wall={props.ambientWall?.id ?? ''}
        data-show-ceiling={props.showCeiling ? 'true' : 'false'}
        data-paint-hover={
          props.paintHoverSurface
            ? `${props.paintHoverSurface.kind}${
                props.paintHoverSurface.kind === 'wall'
                  ? `:${props.paintHoverSurface.wallId}`
                  : ''
              }`
            : ''
        }
      >
        {props.onPaintDrop ? (
          <button
            type="button"
            data-testid="mock-paint-drop-floor"
            onClick={() =>
              props.onPaintDrop!({
                materialId: 'am-floor-1',
                surface: { kind: 'floor' },
              })
            }
          >
            mock drop floor
          </button>
        ) : null}
        {props.onPaintDrop ? (
          <button
            type="button"
            data-testid="mock-paint-drop-wall"
            onClick={() =>
              props.onPaintDrop!({
                materialId: 'am-wall-1',
                surface: { kind: 'wall', wallId: 'w1' },
              })
            }
          >
            mock drop wall
          </button>
        ) : null}
        {props.onPaintDrop ? (
          <button
            type="button"
            data-testid="mock-paint-drop-floor-to-wall"
            onClick={() =>
              props.onPaintDrop!({
                materialId: 'am-floor-1',
                surface: { kind: 'wall', wallId: 'w1' },
              })
            }
          >
            mock drop floor-to-wall mismatch
          </button>
        ) : null}
      </div>
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

  it('re-applies bootstrap filter when bootstrap prop changes while open', () => {
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
    const { rerender } = render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
        bootstrap={{ listFilter: 'all' }}
      />,
    );
    expect(screen.getByTestId('spatial-studio-filter-all').className).toMatch(
      /filter--on/,
    );

    rerender(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
        bootstrap={{ listFilter: 'unplaced', selectKey: null }}
      />,
    );
    expect(
      screen.getByTestId('spatial-studio-filter-unplaced').className,
    ).toMatch(/filter--on/);
  });

  it('seeds default L walls when open with empty kitchen layout', () => {
    const onChangeLayout = vi.fn();
    render(
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
    expect(onChangeLayout).toHaveBeenCalled();
    const seeded = onChangeLayout.mock.calls[0]![0] as {
      walls: { name?: string }[];
    };
    expect(seeded.walls).toHaveLength(2);
    expect(seeded.walls.map((w) => w.name)).toEqual(['Muro A', 'Muro B']);
    expect(screen.getByTestId('spatial-studio-default-walls-msg').textContent).toMatch(
      /Ambiente en L por defecto/,
    );
  });

  it('calls onRequestAddItem from sidebar Agregar button', () => {
    const onRequestAddItem = vi.fn();
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
        onRequestAddItem={onRequestAddItem}
      />,
    );
    fireEvent.click(screen.getByTestId('spatial-studio-add-item'));
    expect(onRequestAddItem).toHaveBeenCalledTimes(1);
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

  it('soft-locks plan when another user holds the session', () => {
    const onAcquire = vi.fn(() => false);
    const onChangeLayout = vi.fn();
    const held: Project = {
      ...project,
      planEditSession: {
        userId: 'u-other',
        userName: 'María',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
      },
    };
    render(
      <ProjectSpatialStudio
        open
        project={held}
        modules={[modA]}
        catalog={catalog}
        canEdit
        planActor={{ userId: 'u-me', userName: 'Yo' }}
        onAcquirePlanEdit={onAcquire}
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
      />,
    );
    expect(onAcquire).toHaveBeenCalled();
    const banner = screen.getByTestId('spatial-studio-plan-locked');
    expect(banner.textContent).toMatch(/María|editando/i);
    expect(screen.queryByTestId('spatial-studio-add-space')).toBeNull();
    fireEvent.doubleClick(screen.getByTestId('spatial-studio-unplaced-it-a-0'));
    expect(onChangeLayout).not.toHaveBeenCalled();
  });

  it('acquires soft lock when free and shows no lock banner', () => {
    const onAcquire = vi.fn(() => true);
    render(
      <ProjectSpatialStudio
        open
        project={{
          ...project,
          kitchenLayout: {
            walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
            placements: [],
          },
        }}
        modules={[modA]}
        catalog={catalog}
        canEdit
        planActor={{ userId: 'u-me', userName: 'Yo' }}
        onAcquirePlanEdit={onAcquire}
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    expect(onAcquire).toHaveBeenCalled();
    expect(screen.queryByTestId('spatial-studio-plan-locked')).toBeNull();
    expect(screen.getByTestId('spatial-studio-add-space')).toBeTruthy();
  });

  it('does not re-acquire soft lock when parent re-renders with new callbacks', () => {
    const onAcquire = vi.fn(() => true);
    const onRelease = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
      },
    };
    const { rerender } = render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        planActor={{ userId: 'u-me', userName: 'Yo' }}
        onAcquirePlanEdit={onAcquire}
        onReleasePlanEdit={onRelease}
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    expect(onAcquire).toHaveBeenCalledTimes(1);

    // Simulate parent re-render with brand-new callback identities (inline arrows).
    rerender(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        planActor={{ userId: 'u-me', userName: 'Yo' }}
        onAcquirePlanEdit={() => onAcquire()}
        onReleasePlanEdit={() => onRelease()}
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    expect(onAcquire).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
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

  it('imports DXF walls into the active space', async () => {
    const onChangeLayout = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [],
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
    fireEvent.click(screen.getByTestId('spatial-studio-tab-room'));
    const input = screen.getByTestId(
      'spatial-studio-import-input',
    ) as HTMLInputElement;
    const dxf = `0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
3000
21
0
0
ENDSEC
0
EOF
`;
    const file = new File([dxf], 'plano.dxf', { type: 'application/dxf' });
    fireEvent.change(input, { target: { files: [file] } });
    await vi.waitFor(() => {
      expect(onChangeLayout).toHaveBeenCalled();
      expect(screen.getByTestId('spatial-studio-import-msg').textContent).toMatch(
        /DXF/i,
      );
    });
    const next = onChangeLayout.mock.calls.at(-1)![0] as {
      walls: Array<{ lengthMm: number }>;
    };
    expect(next.walls.length).toBeGreaterThanOrEqual(1);
    expect(next.walls[0]!.lengthMm).toBe(3000);
  });

  it('shows PDF guidance without mutating layout', async () => {
    const onChangeLayout = vi.fn();
    // Pre-seeded walls so open-effect default L seed does not fire.
    render(
      <ProjectSpatialStudio
        open
        project={{
          ...project,
          kitchenLayout: {
            walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
            placements: [],
          },
        }}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
      />,
    );
    fireEvent.click(screen.getByTestId('spatial-studio-tab-room'));
    const input = screen.getByTestId(
      'spatial-studio-import-input',
    ) as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'plano.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(input, { target: { files: [file] } });
    await vi.waitFor(() => {
      expect(screen.getByTestId('spatial-studio-import-msg').textContent).toMatch(
        /PDF/i,
      );
    });
    // PDF is guidance only — never commits walls/underlay.
    expect(onChangeLayout).not.toHaveBeenCalled();
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

  it('exposes color and surface fill modes for 3D materials', () => {
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
    const colorSel = screen.getByTestId(
      'spatial-studio-color-mode',
    ) as HTMLSelectElement;
    expect(colorSel.value).toBe('material');
    const surfaceSel = screen.getByTestId(
      'spatial-studio-surface-mode',
    ) as HTMLSelectElement;
    expect(surfaceSel.value).toBeTruthy();
    fireEvent.change(surfaceSel, { target: { value: 'grain' } });
    expect(
      (screen.getByTestId('spatial-studio-surface-mode') as HTMLSelectElement)
        .value,
    ).toBe('grain');
    fireEvent.change(colorSel, { target: { value: 'role' } });
    // Surface fill only applies to material paint mode.
    expect(screen.queryByTestId('spatial-studio-surface-mode')).toBeNull();
  });

  it('exposes lighting mode selector for 3D scene', () => {
    render(
      <ProjectSpatialStudio
        open
        project={{
          ...project,
          kitchenLayout: {
            walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
            placements: [],
          },
        }}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    const sel = screen.getByTestId(
      'spatial-studio-lighting',
    ) as HTMLSelectElement;
    expect(sel.value).toBe('present');
    fireEvent.change(sel, { target: { value: 'workshop' } });
    expect(sel.value).toBe('workshop');
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
    fireEvent.click(screen.getByTestId('spatial-studio-placed-it-b-0'));
    fireEvent.click(screen.getByTestId('spatial-studio-tab-position'));
    fireEvent.click(screen.getByTestId('spatial-studio-nudge-right'));
    const undoBtn = screen.getByTestId(
      'spatial-studio-undo',
    ) as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(false);
    fireEvent.click(undoBtn);
    const afterUndo = onChangeLayout.mock.calls.at(-1)![0];
    expect(
      afterUndo.placements.find((p: { itemId: string }) => p.itemId === 'it-a')!
        .offsetMm,
    ).toBe(0);
    expect(
      afterUndo.placements.find((p: { itemId: string }) => p.itemId === 'it-b')!
        .offsetMm,
    ).toBe(620);
  });

  it('updates wall offset from input field when current offset is 0 without snapping back to 0', () => {
    const onChangeLayout = vi.fn();
    const projectWithZeroOffset: Project = {
      ...project,
      items: [
        {
          id: 'it-a',
          moduleId: 'm1',
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
        project={projectWithZeroOffset}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
      />,
    );
    fireEvent.click(screen.getByTestId('spatial-studio-placed-it-a-0'));
    fireEvent.click(screen.getByTestId('spatial-studio-tab-position'));
    const offsetInput = screen.getByTestId('spatial-studio-offset');
    fireEvent.change(offsetInput, { target: { value: '10' } });
    expect(onChangeLayout).toHaveBeenCalled();
    const updated = onChangeLayout.mock.calls.at(-1)![0];
    expect(updated.placements[0].offsetMm).toBe(10);
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
    fireEvent.click(screen.getByTestId('spatial-studio-tab-room'));
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

    fireEvent.click(screen.getByTestId('spatial-studio-tab-modules'));
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
    fireEvent.click(screen.getByTestId('spatial-studio-tab-room'));
    fireEvent.click(screen.getByTestId('spatial-studio-wall-z-1500'));
    expect(onChangeLayout).toHaveBeenCalledWith(
      expect.objectContaining({ wallCabinetZMm: 1500 }),
    );
    // Countertop toggle lives in the room tab (ambience settings, not materials).
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
    fireEvent.click(screen.getByTestId('spatial-studio-tab-room'));
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

  it('zoclo card writes the base mode on the item (F087)', () => {
    const onUpdateItem = vi.fn();
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
        onUpdateItem={onUpdateItem}
      />,
    );

    fireEvent.click(screen.getByTestId('spatial-studio-placed-it-a-0'));
    const modeSelect = screen.getByTestId('spatial-studio-base-mode');
    expect(modeSelect).toBeTruthy();
    fireEvent.change(modeSelect, { target: { value: 'plinth_strip' } });
    expect(onUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'it-a', baseMode: 'plinth_strip' }),
    );
  });

  it('zoclo card offers the purchased profiles from the user catalog (F087)', () => {
    const onUpdateItem = vi.fn();
    const projectStrip: Project = {
      ...project,
      items: [
        {
          id: 'it-a',
          moduleId: 'm-a',
          quantity: 1,
          optionChoices: {},
          measurePresetId: 'p600',
          baseMode: 'plinth_strip',
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
    const catalogWithProfiles = {
      ...catalog,
      hardware: [
        {
          id: 'hw-perfil-alu',
          code: 'ZOC-ALU',
          name: 'Perfil aluminio',
          unit: 'meter' as const,
          costPerUnit: 12,
          active: true,
        },
        {
          id: 'hw-perfil-bronce',
          code: 'ZOC-BRO',
          name: 'Perfil bronce',
          unit: 'meter' as const,
          costPerUnit: 15,
          active: true,
        },
      ],
      optionGroups: [
        {
          id: 'og-perfil',
          code: 'ZOCLO_PERFIL',
          name: 'Zoclo perfil',
          kind: 'hardware' as const,
          required: false,
          optionIds: ['hw-perfil-alu', 'hw-perfil-bronce'],
        },
      ],
    };

    render(
      <ProjectSpatialStudio
        open
        project={projectStrip}
        modules={[modA]}
        catalog={catalogWithProfiles}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
        onUpdateItem={onUpdateItem}
      />,
    );

    fireEvent.click(screen.getByTestId('spatial-studio-placed-it-a-0'));
    const finishSelect = screen.getByTestId(
      'spatial-studio-base-finish-ZOCLO_PERFIL',
    );
    expect(finishSelect).toBeTruthy();
    fireEvent.change(finishSelect, { target: { value: 'hw-perfil-bronce' } });
    expect(onUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'it-a',
        optionChoices: expect.objectContaining({
          ZOCLO_PERFIL: 'hw-perfil-bronce',
        }),
      }),
    );
  });
});

describe('ProjectSpatialStudio — ambient scene materials', () => {
  it('resolves floorMaterialId and passes ambientFloor to the scene', () => {
    const projectWithAmbient: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
        floorMaterialId: 'am-floor-1',
      },
    };
    const catalogWithAmbient = {
      ...catalog,
      ambientMaterials: [
        {
          id: 'am-floor-1',
          code: 'CERAMIC',
          name: 'Cerámica',
          active: true,
          surfaceType: 'floor' as const,
          previewColor: '#222222',
        },
      ],
    };
    render(
      <ProjectSpatialStudio
        open
        project={projectWithAmbient}
        modules={[modA]}
        catalog={catalogWithAmbient}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    const scene = screen.getByTestId('spatial-studio-scene');
    expect(scene.getAttribute('data-ambient-floor')).toBe('am-floor-1');
  });

  it('does not pass ambientFloor when floorMaterialId is undefined', () => {
    const projectNoAmbient: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
      },
    };
    render(
      <ProjectSpatialStudio
        open
        project={projectNoAmbient}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );
    const scene = screen.getByTestId('spatial-studio-scene');
    expect(scene.getAttribute('data-ambient-floor')).toBe('');
  });

  it('showCeiling toggle updates the layout ref', () => {
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
    // Ceiling toggle lives in the room tab (ambience settings, not materials).
    fireEvent.click(screen.getByTestId('spatial-studio-tab-room'));
    fireEvent.click(screen.getByTestId('spatial-studio-toggle-ceiling'));
    expect(onChangeLayout).toHaveBeenCalled();
    const next = onChangeLayout.mock.calls.at(-1)![0] as {
      showCeiling?: boolean;
    };
    expect(next.showCeiling).toBe(true);
  });

  it('paint drop floor material updates floorMaterialId (F067)', () => {
    const onChangeLayout = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
      },
    };
    const catalogWithAmbient = {
      ...catalog,
      ambientMaterials: [
        {
          id: 'am-floor-1',
          code: 'CERAMIC',
          name: 'Cerámica',
          active: true,
          surfaceType: 'floor' as const,
          previewColor: '#333333',
        },
        {
          id: 'am-wall-1',
          code: 'PINT',
          name: 'Pintura',
          active: true,
          surfaceType: 'wall' as const,
          previewColor: '#f5f5dc',
        },
      ],
    };
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalogWithAmbient}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
      />,
    );
    // Simulate the FurnitureScene3D reporting a floor paint drop (the real
    // canvas would raycast + read dataTransfer; here we invoke the callback
    // the wired Studio passes down).
    fireEvent.click(screen.getByTestId('mock-paint-drop-floor'));
    expect(onChangeLayout).toHaveBeenCalled();
    const next = onChangeLayout.mock.calls.at(-1)![0] as {
      floorMaterialId?: string;
      wallMaterialId?: string;
    };
    expect(next.floorMaterialId).toBe('am-floor-1');
    expect(next.wallMaterialId).toBeUndefined();
  });

  it('paint drop wall material updates wallMaterialId (F067)', () => {
    const onChangeLayout = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
      },
    };
    const catalogWithAmbient = {
      ...catalog,
      ambientMaterials: [
        {
          id: 'am-floor-1',
          code: 'CERAMIC',
          name: 'Cerámica',
          active: true,
          surfaceType: 'floor' as const,
          previewColor: '#333333',
        },
        {
          id: 'am-wall-1',
          code: 'PINT',
          name: 'Pintura',
          active: true,
          surfaceType: 'wall' as const,
          previewColor: '#f5f5dc',
        },
      ],
    };
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalogWithAmbient}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
      />,
    );
    fireEvent.click(screen.getByTestId('mock-paint-drop-wall'));
    const next = onChangeLayout.mock.calls.at(-1)![0] as {
      floorMaterialId?: string;
      wallMaterialId?: string;
      walls?: Array<{ id: string; wallMaterialId?: string }>;
    };
    expect(next.walls?.[0]?.wallMaterialId).toBe('am-wall-1');
    expect(next.floorMaterialId).toBeUndefined();
  });

  it('paint drop applies finish freely on wall (universal finish)', () => {
    const onChangeLayout = vi.fn();
    const projectWithWalls: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
        placements: [],
      },
    };
    const catalogWithAmbient = {
      ...catalog,
      ambientMaterials: [
        {
          id: 'am-floor-1',
          code: 'CERAMIC',
          name: 'Cerámica',
          active: true,
          previewColor: '#333333',
        },
      ],
    };
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalogWithAmbient}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
      />,
    );
    fireEvent.click(screen.getByTestId('mock-paint-drop-floor-to-wall'));
    expect(onChangeLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        walls: [expect.objectContaining({ id: 'w1', wallMaterialId: 'am-floor-1' })],
      }),
    );
  });

  it('switches sidebar tabs between Muebles, Materiales, and Ambiente', () => {
    render(
      <ProjectSpatialStudio
        open
        project={project}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
      />,
    );

    const btnModules = screen.getByTestId('spatial-studio-tab-modules');
    const btnMaterials = screen.getByTestId('spatial-studio-tab-materials');
    const btnRoom = screen.getByTestId('spatial-studio-tab-room');

    expect(btnModules.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('spatial-studio-filter-all')).toBeTruthy();

    fireEvent.click(btnMaterials);
    expect(btnMaterials.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('spatial-studio-material-palette')).toBeTruthy();

    fireEvent.click(btnRoom);
    expect(btnRoom.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('spatial-studio-space-name')).toBeTruthy();
  });
});
