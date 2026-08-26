/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type {
  Component,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
  Project,
  Structure,
} from '@granete/domain';

const mocks = vi.hoisted(() => ({
  sceneRenders: [] as Array<{
    readonly modules: ReadonlyArray<{ readonly key: string }>;
    readonly walls: ReadonlyArray<{ readonly id: string }>;
  }>,
  planRenders: [] as Array<{ readonly selectedSpaceId?: string }>,
}));

vi.mock('../projects/components/PresentationKitchenPlanSlide', () => ({
  PresentationKitchenPlanSlide: (props: { selectedSpaceId?: string }) => {
    mocks.planRenders.push(props);
    return <div data-testid="kitchen-plan" />;
  },
}));
vi.mock('./ProductionElevationPreview', () => ({
  ProductionElevationPreview: () => <div data-testid="elevation-preview" />,
}));
vi.mock('../preview3d/FurnitureScene3D', () => ({
  FurnitureScene3D: (props: {
    readonly modules: ReadonlyArray<{ readonly key: string }>;
    readonly walls: ReadonlyArray<{ readonly id: string }>;
  }) => {
    mocks.sceneRenders.push(props);
    return <div data-testid="scene-3d" />;
  },
}));
vi.mock('../preview3d/webglSupport', () => ({
  canUseWebGL: () => true,
}));

import { ProductionOrderViewsPanel } from './ProductionOrderViewsPanel';

const project: Project = {
  id: 'p1', name: 'Cocina Ana', customerId: 'c1', currency: 'MXN',
  marginFactor: 1.35, laborFixedCost: 0, status: 'accepted', items: [],
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
};

const edge: EdgeBand = {
  id: 'edge-a', code: 'EDGE-A', name: 'Canto', thicknessMm: 1,
  costPerMl: 0.5, active: true,
};

const material: MaterialBoard = {
  id: 'mat-a', code: 'MAT-A', name: 'Blanco', widthMm: 1830, lengthMm: 2750,
  thicknessMm: 18, boardPrice: 100, wastePercent: 10, costPerM2: 50,
  grainDefault: false, active: true, defaultEdgeBandId: 'edge-a',
};

const optionGroups: OptionGroup[] = [
  {
    id: 'og-int', code: 'INTERIOR', name: 'Interior', kind: 'board',
    required: true, optionIds: ['mat-a'],
  },
];

const comp: Component = {
  id: 'c1', code: 'COM-1', name: 'Costado', placement: 'lateral_izquierdo',
  geometry: {
    kind: 'rectangular_board', lengthMm: 720, widthMm: 560, thicknessMm: 18,
    lengthFormula: 'PH', widthFormula: 'PD',
  },
  defaultEdges: [
    { side: 'L1', enabled: true }, { side: 'L2', enabled: true },
    { side: 'W1', enabled: true }, { side: 'W2', enabled: true },
  ],
  optionRoles: ['INTERIOR'], active: true,
  xFormula: 'i * (PW - T)', yFormula: '0', zFormula: '0', rotateY: 90,
};

const structure: Structure = {
  id: 'st1', code: 'EST-1', name: 'Cuerpo',
  externalDims: { width: 600, height: 720, depth: 560 },
  components: [{ componentId: 'c1', quantity: 2 }], active: true,
};

const modA: Module = {
  id: 'm-a', code: 'MOD-A', name: 'Bajo 600', structureId: 'st1',
  components: [], hardwareLines: [],
  externalDims: { width: 600, height: 720, depth: 560 },
  presets: [{ id: 'p600', name: '600', width: 600, height: 720, depth: 560 }],
};

const modB: Module = {
  id: 'm-b', code: 'MOD-B', name: 'Bajo 400', structureId: 'st1',
  components: [], hardwareLines: [],
  externalDims: { width: 400, height: 720, depth: 560 },
  presets: [{ id: 'p400', name: '400', width: 400, height: 720, depth: 560 }],
};

const catalog = {
  modules: [modA, modB],
  structures: [structure],
  components: [comp],
  materials: [material],
  edges: [edge],
  hardware: [] as readonly Hardware[],
  optionGroups,
};

const modules: readonly Module[] = [modA, modB];

/** #256: obra accepted con 2 ambientes + isla free + 1 ítem sin colocar. */
const multiSpaceProject: Project = {
  id: 'p-multi', name: 'Obra 2 ambientes', customerId: 'c1', currency: 'MXN',
  marginFactor: 1.35, laborFixedCost: 0, status: 'accepted',
  items: [
    { id: 'it-a', moduleId: 'm-a', quantity: 1, optionChoices: {}, measurePresetId: 'p600' },
    { id: 'it-b', moduleId: 'm-b', quantity: 1, optionChoices: {}, measurePresetId: 'p400' },
    { id: 'it-c', moduleId: 'm-a', quantity: 1, optionChoices: {}, measurePresetId: 'p600' },
    { id: 'it-d', moduleId: 'm-b', quantity: 1, optionChoices: {}, measurePresetId: 'p400' },
  ],
  kitchenLayout: {
    // El top-level espeja el espacio activo (cocina), como flattenActiveSpace
    // persiste: es la precondición exacta del bug #256.
    walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0, originXMm: 0, originYMm: 0 }],
    placements: [
      { itemId: 'it-a', instanceIndex: 0, wallId: 'w1', offsetMm: 0, elevation: 'floor' },
      {
        itemId: 'it-d', instanceIndex: 0, wallId: '', offsetMm: 0,
        elevation: 'floor', mode: 'free', freeXMm: 1200, freeYMm: 800, freeYawDeg: 90,
      },
    ],
    spaces: [
      {
        id: 'cocina', name: 'Cocina',
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0, originXMm: 0, originYMm: 0 }],
        placements: [
          { itemId: 'it-a', instanceIndex: 0, wallId: 'w1', offsetMm: 0, elevation: 'floor' },
          {
            itemId: 'it-d', instanceIndex: 0, wallId: '', offsetMm: 0,
            elevation: 'floor', mode: 'free', freeXMm: 1200, freeYMm: 800, freeYawDeg: 90,
          },
        ],
      },
      {
        id: 'bano', name: 'Baño',
        walls: [{ id: 'w2', lengthMm: 2000, angleDeg: 0, originXMm: 0, originYMm: 0 }],
        placements: [
          { itemId: 'it-b', instanceIndex: 0, wallId: 'w2', offsetMm: 0, elevation: 'floor' },
        ],
      },
    ],
    activeSpaceId: 'cocina',
  },
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
};

const monoSpaceProject: Project = {
  ...multiSpaceProject,
  id: 'p-mono',
  items: [
    { id: 'it-a', moduleId: 'm-a', quantity: 1, optionChoices: {}, measurePresetId: 'p600' },
  ],
  kitchenLayout: {
    walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0, originXMm: 0, originYMm: 0 }],
    placements: [
      { itemId: 'it-a', instanceIndex: 0, wallId: 'w1', offsetMm: 0, elevation: 'floor' },
    ],
  },
};

beforeEach(() => {
  mocks.sceneRenders.length = 0;
  mocks.planRenders.length = 0;
});

afterEach(cleanup);

describe('ProductionOrderViewsPanel F101 page chrome migration', () => {
  it('owns the only visible panel primary action in the shared header', () => {
    const onExportElevations = vi.fn();
    render(
      <ProductionOrderViewsPanel
        project={project}
        modules={[]}
        catalog={{ modules: [], structures: [], components: [], materials: [], edges: [], hardware: [], optionGroups: [] }}
        onExportElevations={onExportElevations}
      />,
    );
    const header = screen.getByTestId('page-header');
    expect(within(header).getByRole('heading', { level: 3, name: 'Vistas de producción' })).toBeTruthy();
    const secondarySlot = header.querySelector('.page-header__secondary-actions');
    expect(secondarySlot).not.toBeNull();
    const action = within(secondarySlot as HTMLElement).getByRole('button', { name: 'Descargar PDF elevaciones' });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(action.getAttribute('title')).toBe('Sin muros ni islas en el layout');
    expect(screen.queryAllByRole('button', { name: 'Descargar PDF elevaciones' })).toHaveLength(1);
    expect(action.className).toBe('btn');
    expect(header.querySelector('.page-header__primary-action')).toBeNull();
  });
});

describe('ProductionOrderViewsPanel #256 multi-ambiente scope', () => {
  it('multi-ambiente: tabs de ambiente controlan planta y 3D por espacio, sin cola lineal fantasma', () => {
    render(
      <ProductionOrderViewsPanel
        project={multiSpaceProject}
        modules={modules}
        catalog={catalog}
      />,
    );

    const tablist = screen.getByTestId('prod-vistas-space-tablist');
    const tabCocina = within(tablist).getByRole('tab', { name: 'Cocina' });
    const tabBano = within(tablist).getByRole('tab', { name: 'Baño' });
    // Default = espacio activo del layout.
    expect(tabCocina.getAttribute('aria-selected')).toBe('true');
    expect(tabBano.getAttribute('aria-selected')).toBe('false');

    // Tabpanel wired a la tab activa.
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('id')).toBe('prod-vistas-space-panel-cocina');
    expect(panel.getAttribute('aria-labelledby')).toBe('prod-vistas-space-tab-cocina');

    // Planta controlada por la tab (sin tabs locales propios).
    expect(mocks.planRenders.at(-1)!.selectedSpaceId).toBe('cocina');

    // 3D del ambiente seleccionado: muros y placements SÓLO de cocina
    // (incluye la isla free), nunca muros ni cola lineal de Baño.
    const sceneCocina = mocks.sceneRenders.at(-1)!;
    expect(sceneCocina.walls.map((w) => w.id)).toEqual(['w1']);
    expect(sceneCocina.modules).toHaveLength(2);
    expect(sceneCocina.modules.map((m) => m.key).sort()).toEqual(['it-a#0', 'it-d#0']);

    const hint = screen.getByTestId('prod-vistas-3d-hint').textContent ?? '';
    expect(hint).toContain('Según plano de Cocina (2 colocadas)');
    expect(hint).not.toContain('sin colocar al final');

    // Ítem sin colocar en NINGUNA planta: hint explícito, no cola fantasma.
    expect(screen.getByTestId('prod-vistas-3d-unplaced').textContent).toContain(
      '1 unidad de la cotización sin colocar en ninguna planta',
    );

    // Cambio de tab: planta y 3D pasan a Baño; cocina desaparece del 3D.
    fireEvent.click(tabBano);
    expect(tabBano.getAttribute('aria-selected')).toBe('true');
    expect(mocks.planRenders.at(-1)!.selectedSpaceId).toBe('bano');
    const sceneBano = mocks.sceneRenders.at(-1)!;
    expect(sceneBano.walls.map((w) => w.id)).toEqual(['w2']);
    expect(sceneBano.modules.map((m) => m.key)).toEqual(['it-b#0']);
    expect(screen.getByTestId('prod-vistas-3d-hint').textContent).toContain(
      'Según plano de Baño (1 colocada)',
    );
  });

  it('multi-ambiente: islas dibujadas en sección propia (#255), no nota de texto', () => {
    render(
      <ProductionOrderViewsPanel
        project={multiSpaceProject}
        modules={modules}
        catalog={catalog}
        onExportElevations={vi.fn()}
      />,
    );

    // La isla (it-d, free en cocina) tiene ficha dibujada con código y
    // medidas — reemplaza la vieja nota "Libre / isla…". En modo agrupado
    // (#254) el ambiente lo aporta el heading del grupo, no la ficha.
    const sheet = screen.getByTestId('prod-island-sheet-it-d-0');
    expect(sheet.textContent).toContain('Isla MOD-B');
    expect(sheet.textContent).toContain('400 × 720 × 560 mm');
    expect(sheet.textContent).toContain('X 1200');
    expect(sheet.textContent).toContain('rotación 90');
    const section = screen.getByTestId('prod-vistas-islands');
    expect(
      within(section).getByRole('heading', { name: /Islas \(libres\)/ }),
    ).toBeTruthy();
    expect(screen.queryByTestId('prod-elev-free')).toBeNull();

    // El botón de export queda habilitado (hay muros) y anuncia las fichas.
    const exportBtn = screen.getByRole('button', {
      name: 'Descargar PDF elevaciones',
    });
    expect((exportBtn as HTMLButtonElement).disabled).toBe(false);
    expect(exportBtn.getAttribute('title')).toContain('fichas de isla');
  });

  it('multi-ambiente: elevaciones e islas agrupadas por ambiente (#254)', () => {
    render(
      <ProductionOrderViewsPanel
        project={multiSpaceProject}
        modules={modules}
        catalog={catalog}
      />,
    );

    // Elevaciones: un grupo por ambiente con heading propio, no listado plano.
    const groups = screen.getByTestId('prod-elev-groups');
    const cocinaWalls = within(groups).getByTestId('prod-elev-group-cocina');
    expect(
      within(cocinaWalls).getByRole('heading', { name: 'Cocina' }),
    ).toBeTruthy();
    expect(cocinaWalls.querySelectorAll('.prod-vistas__elev-list')).toHaveLength(1);
    const banoWalls = within(groups).getByTestId('prod-elev-group-bano');
    expect(
      within(banoWalls).getByRole('heading', { name: 'Baño' }),
    ).toBeTruthy();

    // Islas: mismo agrupado; la ficha no repite el ambiente (lo da el heading).
    const islandGroups = screen.getByTestId('prod-island-groups');
    const cocinaIslands = within(islandGroups).getByTestId(
      'prod-island-group-cocina',
    );
    expect(
      within(cocinaIslands).getByRole('heading', { name: 'Cocina' }),
    ).toBeTruthy();
    const sheet = within(cocinaIslands).getByTestId('prod-island-sheet-it-d-0');
    expect(sheet.textContent).not.toContain('Cocina');
    expect(
      within(islandGroups).queryByTestId('prod-island-group-bano'),
    ).toBeNull();
  });

  it('mono-ambiente: sin headings de grupo ni contenedores agrupados (#254)', () => {
    render(
      <ProductionOrderViewsPanel
        project={monoSpaceProject}
        modules={modules}
        catalog={catalog}
      />,
    );

    expect(screen.queryByTestId('prod-elev-groups')).toBeNull();
    expect(screen.queryByTestId('prod-island-groups')).toBeNull();
    expect(screen.queryAllByRole('heading', { level: 5 })).toHaveLength(0);
  });
  it('obra sólo-islas: export habilitado y ficha dibujada (#255)', () => {
    const islandOnlyProject: Project = {
      ...monoSpaceProject,
      kitchenLayout: {
        walls: [],
        placements: [
          {
            itemId: 'it-a', instanceIndex: 0, wallId: '', offsetMm: 0,
            elevation: 'floor', mode: 'free', freeXMm: 0, freeYMm: 0,
          },
        ],
      },
    };
    render(
      <ProductionOrderViewsPanel
        project={islandOnlyProject}
        modules={modules}
        catalog={catalog}
        onExportElevations={vi.fn()}
      />,
    );

    const exportBtn = screen.getByRole('button', {
      name: 'Descargar PDF elevaciones',
    });
    expect((exportBtn as HTMLButtonElement).disabled).toBe(false);
    expect(exportBtn.getAttribute('title')).toBe(
      'PDF multi-página de elevaciones y fichas de isla',
    );
    // Ficha de la isla presente; el placeholder de "sin muros" sigue en
    // elevaciones pero la obra tiene su artefacto dibujado.
    expect(screen.getByTestId('prod-island-sheet-it-a-0')).toBeTruthy();
    expect(screen.getByTestId('prod-vistas-islands')).toBeTruthy();
  });

  it('mono-ambiente: sin tabs de ambiente, planta sin control y hint sin nombre de espacio', () => {
    render(
      <ProductionOrderViewsPanel
        project={monoSpaceProject}
        modules={modules}
        catalog={catalog}
      />,
    );

    expect(screen.queryByTestId('prod-vistas-space-tablist')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    // Planta no controlada (comportamiento previo).
    expect(mocks.planRenders.at(-1)!.selectedSpaceId).toBeUndefined();
    // 3D resuelto contra el proyecto tal cual (un solo espacio).
    const scene = mocks.sceneRenders.at(-1)!;
    expect(scene.walls.map((w) => w.id)).toEqual(['w1']);
    expect(scene.modules.map((m) => m.key)).toEqual(['it-a#0']);
    const hint = screen.getByTestId('prod-vistas-3d-hint').textContent ?? '';
    expect(hint).toContain('Según plano (1 colocada)');
    expect(hint).not.toContain(' de ');
    // Sin ítems fuera de planta → sin hint de unplaced.
    expect(screen.queryByTestId('prod-vistas-3d-unplaced')).toBeNull();
  });
});
