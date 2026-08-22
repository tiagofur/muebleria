/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      onUnplacedDrop?: (drop: {
        readonly wallId: string | null;
        readonly offsetMm: number;
        readonly planXMm: number;
        readonly planYMm: number;
      }) => void;
      onBoardPaintDrop?: (drop: {
        readonly moduleKey: string | null;
        readonly materialId: string;
      }) => void;
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
        {props.onUnplacedDrop ? (
          <button
            type="button"
            data-testid="mock-unplaced-drop-wall"
            onClick={() =>
              props.onUnplacedDrop!({
                wallId: 'w1',
                offsetMm: 100,
                planXMm: 0,
                planYMm: 0,
              })
            }
          >
            mock unplaced drop wall
          </button>
        ) : null}
        {props.onBoardPaintDrop ? (
          <button
            type="button"
            data-testid="mock-board-drop-hit"
            onClick={() =>
              props.onBoardPaintDrop!({
                moduleKey: 'it-a#0',
                materialId: 'mat-1',
              })
            }
          >
            mock board drop hit
          </button>
        ) : null}
        {props.onBoardPaintDrop ? (
          <button
            type="button"
            data-testid="mock-board-drop-miss"
            onClick={() =>
              props.onBoardPaintDrop!({ moduleKey: null, materialId: 'mat-1' })
            }
          >
            mock board drop miss
          </button>
        ) : null}
        {props.onUnplacedDrop ? (
          <button
            type="button"
            data-testid="mock-unplaced-drop-floor"
            onClick={() =>
              props.onUnplacedDrop!({
                wallId: null,
                offsetMm: 0,
                planXMm: 800,
                planYMm: 600,
              })
            }
          >
            mock unplaced drop floor
          </button>
        ) : null}
      </div>
    ),
  };
});

import { ProjectSpatialStudio } from './ProjectSpatialStudio';

beforeEach(() => {
  globalThis.localStorage?.clear();
});

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

const modA: Module = {
  id: 'm-a',
  code: 'MOD-A',
  name: 'Bajo 600',
  structureId: 'st1',
  components: [],
  hardwareLines: [{ id: 'h-frente', quantity: 1, optionRole: 'FRENTE' }],
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

const matBoard = {
  id: 'mat-1',
  code: 'TAB-ARA-BLA',
  name: 'Arauco Blanco',
  manufacturer: 'Arauco',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 15,
  grainDefault: false,
  boardPrice: 714,
  wastePercent: 0,
  costPerM2: 160,
  active: true,
};

const catalog = {
  modules: [modA],
  structures: [],
  components: [],
  materials: [matBoard],
  edges: [],
  hardware: [],
  optionGroups: [
    {
      id: 'g-frente',
      code: 'FRENTE',
      name: 'Frentes',
      kind: 'board' as const,
      required: true,
      optionIds: ['mat-1'],
    },
  ],
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

  it('F141v2: bootstrap unplaced switchea de Biblioteca a De la obra cuando la biblioteca existe', () => {
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
        onInsertFromCatalog={vi.fn(() => 'new-item-1')}
        bootstrap={{ listFilter: 'unplaced' }}
      />,
    );
    // El cue post-agregar aterriza en la sub-pestaña de ítems, no en Biblioteca.
    expect(screen.getByTestId('spatial-studio-filter-unplaced').className).toMatch(
      /filter--on/,
    );
    expect(screen.queryByTestId('module-library')).toBeNull();
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

  it('F141v2: sub-tabs Biblioteca/De la obra reemplazan el botón Agregar', () => {
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
        onInsertFromCatalog={vi.fn(() => 'new-item-1')}
      />,
    );
    // El botón Agregar (modal) ya no existe: la biblioteca lo reemplaza.
    expect(screen.queryByTestId('spatial-studio-add-item')).toBeNull();
    // Default: Biblioteca activa; los ítems viven en su propia sub-pestaña.
    expect(screen.getByTestId('module-library')).toBeTruthy();
    expect(screen.queryByTestId('spatial-studio-filter-all')).toBeNull();

    fireEvent.click(screen.getByTestId('spatial-studio-modules-tab-items'));
    expect(screen.getByTestId('spatial-studio-filter-all')).toBeTruthy();
    expect(screen.queryByTestId('module-library')).toBeNull();
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
    expect(screen.getByTestId('spatial-studio-space-tablist')).toBeTruthy();
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
    fireEvent.click(screen.getByTestId('spatial-studio-inspector-tab-position'));
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
    fireEvent.click(screen.getByTestId('spatial-studio-inspector-tab-position'));
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
    fireEvent.click(screen.getByTestId('spatial-studio-inspector-tab-position'));
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
    fireEvent.click(screen.getByTestId('spatial-studio-inspector-tab-position'));
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

  it('switches sidebar tabs between Muebles and Materiales (Ambiente vive en el inspector)', () => {
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

    expect(btnModules.getAttribute('aria-selected')).toBe('true');
    // Sin selección: el inspector derecho muestra las propiedades del ambiente.
    expect(screen.getByTestId('spatial-studio-space-name')).toBeTruthy();
    expect(screen.queryByTestId('spatial-studio-tab-room')).toBeNull();

    fireEvent.click(btnMaterials);
    expect(btnMaterials.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('spatial-studio-material-palette')).toBeTruthy();
    // El ambiente sigue accesible en el inspector con la pestaña Materiales activa.
    expect(screen.getByTestId('spatial-studio-space-name')).toBeTruthy();
  });

  it('sidebar tabs follow the shared tablist contract (roles, linkage, roving arrows)', () => {
    const onClose = vi.fn();
    render(
      <ProjectSpatialStudio
        open
        project={project}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={onClose}
        onChangeLayout={vi.fn()}
      />,
    );

    const tablist = screen.getByTestId('spatial-studio-tablist');
    expect(tablist.getAttribute('role')).toBe('tablist');
    expect(tablist.getAttribute('aria-label')).toBe(
      'Navegación del menú lateral',
    );

    const modulesTab = screen.getByTestId('spatial-studio-tab-modules');
    expect(modulesTab.getAttribute('role')).toBe('tab');
    expect(modulesTab.getAttribute('aria-selected')).toBe('true');
    expect(modulesTab.getAttribute('tabIndex')).toBe('0');
    expect(modulesTab.getAttribute('aria-controls')).toBe(
      'spatial-studio-sidebar-panel-modules',
    );
    const panel = document.getElementById(
      'spatial-studio-sidebar-panel-modules',
    );
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe(
      'spatial-studio-sidebar-tab-modules',
    );

    // Roving arrows move selection with focus (modules → materials)
    const materialsTab = screen.getByTestId('spatial-studio-tab-materials');
    expect(materialsTab.getAttribute('tabIndex')).toBe('-1');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(materialsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(materialsTab);
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(modulesTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(modulesTab.getAttribute('aria-selected')).toBe('true');

    // Esc still closes the studio with the shared tabs mounted
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('spaces switcher links tabs to the viewport panel', () => {
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

    const spacesTablist = screen.getByTestId('spatial-studio-space-tablist');
    expect(spacesTablist.getAttribute('role')).toBe('tablist');
    expect(spacesTablist.getAttribute('aria-label')).toBe(
      'Ambientes del plano',
    );

    const viewport = screen.getByTestId('spatial-studio-viewport');
    expect(viewport.getAttribute('role')).toBe('tabpanel');
    const labelledBy = viewport.getAttribute('aria-labelledby');
    expect(labelledBy).toMatch(/^spatial-studio-spaces-tab-/);
    expect(viewport.getAttribute('id')).toBe(
      labelledBy!.replace('-tab-', '-panel-'),
    );
    const firstTab = spacesTablist.querySelector('[role="tab"]');
    expect(firstTab?.getAttribute('aria-controls')).toBe(
      viewport.getAttribute('id'),
    );
  });
});

// ─── F141 Biblioteca lateral (#309) ──────────────────────────────────────────

describe('ProjectSpatialStudio — biblioteca (F141)', () => {
  const projectWithWalls: Project = {
    ...project,
    kitchenLayout: {
      walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
      placements: [],
    },
  };

  it('renderiza la biblioteca en el tab Muebles con búsqueda y tarjetas', () => {
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
        onInsertFromCatalog={vi.fn(() => 'new-item-1')}
      />,
    );
    expect(screen.getByTestId('module-library')).toBeTruthy();
    expect(screen.getByTestId('module-library-card-m-a')).toBeTruthy();
    expect(screen.getByText('Catálogo')).toBeTruthy();
    expect(screen.getByTestId('module-library-result-count').textContent).toBe('1 de 1');
  });

  it('no renderiza la biblioteca sin onInsertFromCatalog', () => {
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
    expect(screen.queryByTestId('module-library')).toBeNull();
  });

  it('click en tarjeta inserta y coloca en el muro activo (target predecible)', () => {
    const onInsertFromCatalog = vi.fn(() => 'new-item-1');
    const onChangeLayout = vi.fn();
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
        onInsertFromCatalog={onInsertFromCatalog}
      />,
    );
    fireEvent.click(screen.getByTestId('module-library-card-m-a'));
    expect(onInsertFromCatalog).toHaveBeenCalledWith('m-a');
    expect(onChangeLayout).toHaveBeenCalled();
    const layout = onChangeLayout.mock.calls
      .map((c) => c[0] as { placements: { itemId: string }[] })
      .find((l) => l.placements.some((p) => p.itemId === 'new-item-1'));
    expect(layout).toBeTruthy();
    expect(layout!.placements).toEqual([
      expect.objectContaining({
        itemId: 'new-item-1',
        instanceIndex: 0,
        wallId: 'w1',
      }),
    ]);
  });

  it('click con creación fallida (null) no coloca nada', () => {
    const onInsertFromCatalog = vi.fn(() => null);
    const onChangeLayout = vi.fn();
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
        onInsertFromCatalog={onInsertFromCatalog}
      />,
    );
    fireEvent.click(screen.getByTestId('module-library-card-m-a'));
    expect(onInsertFromCatalog).toHaveBeenCalledWith('m-a');
    // El proyecto ya tiene walls (sin seeding): cero commits de layout.
    expect(onChangeLayout).not.toHaveBeenCalled();
  });

  it('drag de tarjeta + drop en muro crea el ítem y lo coloca atómicamente', () => {
    const onInsertFromCatalog = vi.fn(() => 'new-item-2');
    const onChangeLayout = vi.fn();
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
        onInsertFromCatalog={onInsertFromCatalog}
      />,
    );
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    };
    fireEvent.dragStart(screen.getByTestId('module-library-card-m-a'), {
      dataTransfer,
    });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-muebles-library',
      expect.any(String),
    );
    fireEvent.click(screen.getByTestId('mock-unplaced-drop-wall'));
    expect(onInsertFromCatalog).toHaveBeenCalledWith('m-a');
    const layout = onChangeLayout.mock.calls
      .map((c) => c[0] as { placements: { itemId: string }[] })
      .find((l) => l.placements.some((p) => p.itemId === 'new-item-2'));
    expect(layout).toBeTruthy();
    expect(layout!.placements[0]).toEqual(
      expect.objectContaining({
        itemId: 'new-item-2',
        wallId: 'w1',
      }),
    );
  });

  it('drop de biblioteca en piso crea el ítem como isla', () => {
    const onInsertFromCatalog = vi.fn(() => 'new-item-3');
    const onChangeLayout = vi.fn();
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={onChangeLayout}
        onInsertFromCatalog={onInsertFromCatalog}
      />,
    );
    fireEvent.dragStart(screen.getByTestId('module-library-card-m-a'), {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent.click(screen.getByTestId('mock-unplaced-drop-floor'));
    expect(onInsertFromCatalog).toHaveBeenCalledWith('m-a');
    const layout = onChangeLayout.mock.calls
      .map((c) => c[0] as { placements: { itemId: string }[] })
      .find((l) => l.placements.some((p) => p.itemId === 'new-item-3'));
    expect(layout).toBeTruthy();
    expect(layout!.placements[0]).toEqual(
      expect.objectContaining({ itemId: 'new-item-3', mode: 'free' }),
    );
  });

  it('drop inválido (muro sin espacio) no crea el ítem', () => {
    const onInsertFromCatalog = vi.fn(() => 'new-item-4');
    // Muro de 700 mm ya ocupado por un módulo de 600: no queda espacio.
    const tightProject: Project = {
      ...project,
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 700, angleDeg: 0 }],
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
        project={tightProject}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
        onInsertFromCatalog={onInsertFromCatalog}
      />,
    );
    fireEvent.dragStart(screen.getByTestId('module-library-card-m-a'), {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent.click(screen.getByTestId('mock-unplaced-drop-wall'));
    expect(onInsertFromCatalog).not.toHaveBeenCalled();
  });

  it('ESC durante drag de biblioteca cancela sin crear el ítem', () => {
    const onInsertFromCatalog = vi.fn(() => 'new-item-5');
    const { container } = render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
        onInsertFromCatalog={onInsertFromCatalog}
      />,
    );
    expect(container).toBeTruthy();
    fireEvent.dragStart(screen.getByTestId('module-library-card-m-a'), {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    // Tras ESC el ghost se limpia: un drop posterior no crea nada.
    fireEvent.click(screen.getByTestId('mock-unplaced-drop-wall'));
    expect(onInsertFromCatalog).not.toHaveBeenCalled();
  });
});

// ─── F142 Dock de tableros (#309) ────────────────────────────────────────────

describe('ProjectSpatialStudio — dock de tableros (F142)', () => {
  const projectWithWalls: Project = {
    ...project,
    kitchenLayout: {
      walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
      placements: [],
    },
  };

  function openBoardsTab(): void {
    fireEvent.click(screen.getByTestId('spatial-studio-tab-materials'));
    fireEvent.click(screen.getByTestId('spatial-studio-materials-tab-boards'));
  }

  it('sub-tabs Ambiente|Tableros: default ambiental, Tableros muestra el dock', () => {
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
    fireEvent.click(screen.getByTestId('spatial-studio-tab-materials'));
    expect(screen.getByTestId('spatial-studio-material-palette')).toBeTruthy();
    expect(screen.queryByTestId('board-material-palette')).toBeNull();

    fireEvent.click(screen.getByTestId('spatial-studio-materials-tab-boards'));
    expect(screen.getByTestId('board-material-palette')).toBeTruthy();
    expect(screen.queryByTestId('spatial-studio-material-palette')).toBeNull();
  });

  it('click en tablero con mueble seleccionado aplica FRENTE al ítem', () => {
    const onUpdateItem = vi.fn();
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
    // Seleccionar el ítem sin colocar y aplicar desde Tableros.
    fireEvent.click(screen.getByTestId('spatial-studio-unplaced-it-a-0'));
    openBoardsTab();
    fireEvent.click(screen.getByTestId('board-palette-card-mat-1'));
    expect(onUpdateItem).toHaveBeenCalledTimes(1);
    const updated = onUpdateItem.mock.calls[0]![0] as {
      optionChoices: Record<string, string>;
    };
    expect(updated.optionChoices.FRENTE).toBe('mat-1');
    expect(screen.getByTestId('board-palette-status').textContent).toMatch(
      /Arauco Blanco aplicado a frentes del mueble/,
    );
  });

  it('click sin selección enseña en vez de fallar', () => {
    const onUpdateItem = vi.fn();
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
    openBoardsTab();
    fireEvent.click(screen.getByTestId('board-palette-card-mat-1'));
    expect(onUpdateItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('board-palette-status').textContent).toMatch(
      /Seleccioná un mueble/,
    );
  });

  it('drag + drop sobre un mueble aplica aunque no haya selección previa', () => {
    const onUpdateItem = vi.fn();
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
    openBoardsTab();
    fireEvent.dragStart(screen.getByTestId('board-palette-card-mat-1'), {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent.click(screen.getByTestId('mock-board-drop-hit'));
    expect(onUpdateItem).toHaveBeenCalledTimes(1);
    const updated = onUpdateItem.mock.calls[0]![0] as {
      optionChoices: Record<string, string>;
    };
    expect(updated.optionChoices.FRENTE).toBe('mat-1');
  });

  it('drop fuera de un mueble se rechaza con mensaje que enseña (anti-leak)', () => {
    const onUpdateItem = vi.fn();
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
    openBoardsTab();
    fireEvent.dragStart(screen.getByTestId('board-palette-card-mat-1'), {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent.click(screen.getByTestId('mock-board-drop-miss'));
    expect(onUpdateItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('board-palette-status').textContent).toMatch(
      /Los tableros se aplican a los muebles/,
    );
  });

  it('scope obra aplica a nivel proyecto (projectLevelChoices)', () => {
    const onUpdateProjectLevelChoice = vi.fn();
    render(
      <ProjectSpatialStudio
        open
        project={projectWithWalls}
        modules={[modA]}
        catalog={catalog}
        canEdit
        onClose={vi.fn()}
        onChangeLayout={vi.fn()}
        onUpdateProjectLevelChoice={onUpdateProjectLevelChoice}
      />,
    );
    openBoardsTab();
    fireEvent.change(screen.getByTestId('board-palette-scope'), {
      target: { value: 'project' },
    });
    fireEvent.click(screen.getByTestId('board-palette-card-mat-1'));
    expect(onUpdateProjectLevelChoice).toHaveBeenCalledWith('FRENTE', 'mat-1');
  });
});
