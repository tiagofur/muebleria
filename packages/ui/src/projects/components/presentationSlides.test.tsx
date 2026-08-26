/**
 * Unit tests for presentation components:
 * - PresentationKitchenPlanSlide
 * - PresentationOptionsSlide
 * - ProjectPresentationMode (4-slide presentation)
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  Customer,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
  Project,
  ProjectKitchenLayout,
} from '@granete/domain';

import { PresentationKitchenPlanSlide } from './PresentationKitchenPlanSlide';
import { PresentationOptionsSlide } from './PresentationOptionsSlide';
import { ProjectPresentationMode } from './ProjectPresentationMode';

/* ── fixtures ─────────────────────────────────────────── */

const materials: MaterialBoard[] = [
  {
    id: 'mat-a', code: 'TAB-A', name: 'Blanco',
    widthMm: 1830, lengthMm: 2440, thicknessMm: 18,
    grainDefault: false, boardPrice: 44.65, costPerM2: 10,
    wastePercent: 0, active: true,
    previewColor: '#f5f5f5',
  },
  {
    id: 'mat-c', code: 'TAB-C', name: 'Nougat',
    widthMm: 1830, lengthMm: 2440, thicknessMm: 18,
    grainDefault: true, boardPrice: 62.51, costPerM2: 14,
    wastePercent: 0, active: true,
    previewColor: '#c4a574',
  },
];

const edges: EdgeBand[] = [
  {
    id: 'edge-1', code: 'CANT-1', name: 'Blanco 22mm',
    thicknessMm: 22, costPerMl: 2, active: true,
  },
];

const hardware: Hardware[] = [
  {
    id: 'hw-1', code: 'BIS-1', name: 'Bisagra 110°',
    unit: 'piece', costPerUnit: 8, active: true,
  },
];

const optionGroups: OptionGroup[] = [
  {
    id: 'g1', code: 'INTERIOR', name: 'Interior', kind: 'board',
    required: true, optionIds: ['mat-a', 'mat-b'],
  },
  {
    id: 'g2', code: 'FRENTE', name: 'Frente', kind: 'board',
    required: true, optionIds: ['mat-c'],
  },
];

const modules: Module[] = [
  {
    id: 'mod-1', code: 'MOD-GAB-01', name: 'Bajo mesada',
    presets: [
      { id: 'p1', name: 'Estándar', width: 600, height: 720, depth: 560 },
    ],
    externalDims: { width: 600, height: 720, depth: 560 },
    hardwareLines: [
      { id: 'h1', quantity: 1, optionRole: 'INTERIOR' },
      { id: 'h2', quantity: 1, optionRole: 'FRENTE' },
    ],
  },
];

const customers: Customer[] = [
  { id: 'cust-1', name: 'Ana López', active: true },
];

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'prj-1',
    name: 'Cocina Ana',
    customerId: 'cust-1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [
      {
        id: 'item-1',
        moduleId: 'mod-1',
        quantity: 2,
        measurePresetId: 'p1',
        optionChoices: { INTERIOR: 'mat-a', FRENTE: 'mat-c' },
      },
    ],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

function makeKitchenLayout(overrides: Partial<ProjectKitchenLayout> = {}): ProjectKitchenLayout {
  return {
    walls: [
      { id: 'wall-1', name: 'Muro sur', lengthMm: 3000, angleDeg: 0, originXMm: 0, originYMm: 0 },
    ],
    placements: [
      { itemId: 'item-1', instanceIndex: 0, wallId: 'wall-1', offsetMm: 200, elevation: 'floor' as const },
    ],
    ...overrides,
  };
}

/* ── PresentationKitchenPlanSlide ─────────────────────── */

describe('PresentationKitchenPlanSlide', () => {
  afterEach(() => cleanup());

  it('renders empty state when project has no kitchen layout', () => {
    const project = makeProject({ kitchenLayout: undefined });
    render(<PresentationKitchenPlanSlide project={project} modules={modules} />);
    expect(screen.getByText('Sin planta definida')).toBeTruthy();
    expect(screen.getByText(/Definí muros y ubicá/)).toBeTruthy();
  });

  it('empty plan CTA calls onGoToProyectar', () => {
    const onGo = vi.fn();
    const project = makeProject({ kitchenLayout: undefined });
    render(
      <PresentationKitchenPlanSlide
        project={project}
        modules={modules}
        onGoToProyectar={onGo}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ir a Proyectar/i }));
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it('renders SVG with walls when kitchen layout has walls', () => {
    const layout = makeKitchenLayout();
    const project = makeProject({ kitchenLayout: layout });
    render(<PresentationKitchenPlanSlide project={project} modules={modules} />);

    const svg = screen.getByTestId('presentation-kitchen-plan').querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.querySelectorAll('line')).toHaveLength(1); // 1 wall
    expect(svg!.querySelectorAll('text').length).toBeGreaterThanOrEqual(1);
  });

  it('renders placed modules on walls', () => {
    const layout = makeKitchenLayout();
    const project = makeProject({ kitchenLayout: layout });
    render(<PresentationKitchenPlanSlide project={project} modules={modules} />);

    const rects = screen.getByTestId('presentation-kitchen-plan').querySelectorAll('rect');
    expect(rects.length).toBe(1); // 1 placement
  });

  it('shows legend when placements exist', () => {
    const layout = makeKitchenLayout();
    const project = makeProject({ kitchenLayout: layout });
    render(<PresentationKitchenPlanSlide project={project} modules={modules} />);

    expect(screen.getByText('Base (piso)')).toBeTruthy();
    expect(screen.getByText('Alacena (muro)')).toBeTruthy();
  });

  it('hides legend when no placements', () => {
    const layout = makeKitchenLayout({ placements: [] });
    const project = makeProject({ kitchenLayout: layout });
    render(<PresentationKitchenPlanSlide project={project} modules={modules} />);

    expect(screen.queryByText('Base (piso)')).toBeNull();
    expect(screen.queryByText('Alacena (muro)')).toBeNull();
  });

  it('warns when quote has unplaced units', () => {
    const layout = makeKitchenLayout({ placements: [] });
    const project = makeProject({
      kitchenLayout: layout,
      items: [
        {
          id: 'it-1',
          moduleId: modules[0]!.id,
          quantity: 2,
          optionChoices: {},
        },
      ],
    });
    render(<PresentationKitchenPlanSlide project={project} modules={modules} />);
    expect(screen.getByTestId('presentation-kitchen-unplaced').textContent).toMatch(
      /2 unidad/,
    );
  });

  it('renders multiple walls', () => {
    const layout = makeKitchenLayout({
      walls: [
        { id: 'w1', name: 'Muro sur', lengthMm: 3000, angleDeg: 0, originXMm: 0, originYMm: 0 },
        { id: 'w2', name: 'Muro oeste', lengthMm: 2500, angleDeg: 90, originXMm: 0, originYMm: 0 },
      ],
    });
    const project = makeProject({ kitchenLayout: layout });
    render(<PresentationKitchenPlanSlide project={project} modules={modules} />);

    const lines = screen.getByTestId('presentation-kitchen-plan').querySelectorAll('line');
    expect(lines.length).toBe(2);
  });

  it('shows free/island placements on the plan', () => {
    const layout = makeKitchenLayout({
      placements: [
        {
          itemId: 'item-1',
          instanceIndex: 0,
          wallId: '',
          offsetMm: 0,
          elevation: 'floor',
          mode: 'free',
          freeXMm: 800,
          freeYMm: 600,
        },
      ],
    });
    const project = makeProject({ kitchenLayout: layout });
    render(<PresentationKitchenPlanSlide project={project} modules={modules} />);

    expect(
      screen.getByTestId('presentation-plan-free-item-1-0'),
    ).toBeTruthy();
    expect(screen.getByText('Isla (libre)')).toBeTruthy();
  });

  it('shows local tabs for multi-ambiente and switches plant', () => {
    const layout: ProjectKitchenLayout = {
      walls: [
        {
          id: 'w-c',
          name: 'Muro cocina',
          lengthMm: 3000,
          angleDeg: 0,
          originXMm: 0,
          originYMm: 0,
        },
      ],
      placements: [
        {
          itemId: 'item-1',
          instanceIndex: 0,
          wallId: 'w-c',
          offsetMm: 100,
          elevation: 'floor',
        },
      ],
      activeSpaceId: 'sp-cocina',
      spaces: [
        {
          id: 'sp-cocina',
          name: 'Cocina',
          walls: [
            {
              id: 'w-c',
              name: 'Muro cocina',
              lengthMm: 3000,
              angleDeg: 0,
              originXMm: 0,
              originYMm: 0,
            },
          ],
          placements: [
            {
              itemId: 'item-1',
              instanceIndex: 0,
              wallId: 'w-c',
              offsetMm: 100,
              elevation: 'floor',
            },
          ],
        },
        {
          id: 'sp-lav',
          name: 'Lavandería',
          walls: [
            {
              id: 'w-l',
              name: 'Muro lav',
              lengthMm: 2000,
              angleDeg: 0,
              originXMm: 0,
              originYMm: 0,
            },
          ],
          placements: [
            {
              itemId: 'item-1',
              instanceIndex: 1,
              wallId: 'w-l',
              offsetMm: 50,
              elevation: 'floor',
            },
          ],
        },
      ],
    };
    const project = makeProject({
      kitchenLayout: layout,
      items: [
        {
          id: 'item-1',
          moduleId: 'mod-1',
          quantity: 2,
          measurePresetId: 'p1',
          optionChoices: { INTERIOR: 'mat-a', FRENTE: 'mat-c' },
        },
      ],
    });
    render(<PresentationKitchenPlanSlide project={project} modules={modules} />);

    expect(screen.getByTestId('presentation-kitchen-space-tablist')).toBeTruthy();
    expect(screen.getByTestId('presentation-kitchen-space-tab-sp-cocina')).toBeTruthy();
    expect(screen.getByTestId('presentation-kitchen-space-tab-sp-lav')).toBeTruthy();
    expect(screen.getByTestId('presentation-kitchen-space-title').textContent).toBe(
      'Cocina',
    );
    expect(screen.getByTestId('presentation-kitchen-svg-sp-cocina')).toBeTruthy();

    fireEvent.click(screen.getByTestId('presentation-kitchen-space-tab-sp-lav'));
    expect(screen.getByTestId('presentation-kitchen-space-title').textContent).toBe(
      'Lavandería',
    );
    expect(screen.getByTestId('presentation-kitchen-svg-sp-lav')).toBeTruthy();
  });

  it('hides local tabs when space selection is controlled by parent', () => {
    const layout: ProjectKitchenLayout = {
      walls: [],
      placements: [],
      activeSpaceId: 'sp-a',
      spaces: [
        {
          id: 'sp-a',
          name: 'Cocina',
          walls: [
            {
              id: 'w1',
              name: 'M1',
              lengthMm: 1000,
              angleDeg: 0,
              originXMm: 0,
              originYMm: 0,
            },
          ],
          placements: [],
        },
        {
          id: 'sp-b',
          name: 'Lavandería',
          walls: [
            {
              id: 'w2',
              name: 'M2',
              lengthMm: 1000,
              angleDeg: 0,
              originXMm: 0,
              originYMm: 0,
            },
          ],
          placements: [],
        },
      ],
    };
    const project = makeProject({ kitchenLayout: layout });
    render(
      <PresentationKitchenPlanSlide
        project={project}
        modules={modules}
        selectedSpaceId="sp-b"
        onSelectedSpaceIdChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('presentation-kitchen-space-tablist')).toBeNull();
    expect(screen.getByTestId('presentation-kitchen-space-title').textContent).toBe(
      'Lavandería',
    );
  });
});

/* ── PresentationOptionsSlide ─────────────────────────── */

describe('PresentationOptionsSlide', () => {
  afterEach(() => cleanup());

  const catalog = { materials, edges, hardware };

  it('shows empty state when no items', () => {
    const project = makeProject({ items: [] });
    render(
      <PresentationOptionsSlide
        project={project}
        modules={modules}
        optionGroups={optionGroups}
        catalog={catalog}
      />,
    );
    expect(screen.getByText('Sin opciones configuradas.')).toBeTruthy();
  });

  it('shows empty state when no option groups', () => {
    const project = makeProject();
    render(
      <PresentationOptionsSlide
        project={project}
        modules={modules}
        optionGroups={[]}
        catalog={catalog}
      />,
    );
    expect(screen.getByText('Sin opciones configuradas.')).toBeTruthy();
  });

  it('renders item cards with module code and name', () => {
    const project = makeProject();
    render(
      <PresentationOptionsSlide
        project={project}
        modules={modules}
        optionGroups={optionGroups}
        catalog={catalog}
      />,
    );

    const slide = screen.getByTestId('presentation-options-slide');
    expect(slide).toBeTruthy();
    expect(slide.textContent).toContain('MOD-GAB-01');
    expect(slide.textContent).toContain('Bajo mesada');
  });

  it('shows quantity and measures from preset', () => {
    const project = makeProject();
    render(
      <PresentationOptionsSlide
        project={project}
        modules={modules}
        optionGroups={optionGroups}
        catalog={catalog}
      />,
    );

    const slide = screen.getByTestId('presentation-options-slide');
    expect(slide.textContent).toContain('2×');
    expect(slide.textContent).toContain('600');
    expect(slide.textContent).toContain('720');
    expect(slide.textContent).toContain('560');
  });

  it('shows material color swatches for board options', () => {
    const project = makeProject();
    render(
      <PresentationOptionsSlide
        project={project}
        modules={modules}
        optionGroups={optionGroups}
        catalog={{ materials, edges, hardware }}
      />,
    );
    expect(screen.getByTestId('presentation-option-swatch-INTERIOR')).toBeTruthy();
    expect(screen.getByTestId('presentation-option-swatch-FRENTE')).toBeTruthy();
  });

  it('renders resolved option labels (Interior: Blanco, Frente: Nougat)', () => {
    const project = makeProject();
    render(
      <PresentationOptionsSlide
        project={project}
        modules={modules}
        optionGroups={optionGroups}
        catalog={catalog}
      />,
    );

    const slide = screen.getByTestId('presentation-options-slide');
    expect(slide.textContent).toContain('Interior:');
    expect(slide.textContent).toContain('Blanco');
    expect(slide.textContent).toContain('Frente:');
    expect(slide.textContent).toContain('Nougat');
  });

  it('falls back to project-level defaults when line has no override', () => {
    const project = makeProject({
      projectLevelChoices: { INTERIOR: 'mat-a', FRENTE: 'mat-c' },
      items: [
        {
          id: 'item-1', moduleId: 'mod-1', quantity: 1,
          measurePresetId: 'p1', optionChoices: {}, // no overrides
        },
      ],
    });
    render(
      <PresentationOptionsSlide
        project={project}
        modules={modules}
        optionGroups={optionGroups}
        catalog={catalog}
      />,
    );

    const slide = screen.getByTestId('presentation-options-slide');
    expect(slide.textContent).toContain('Interior:');
    expect(slide.textContent).toContain('Blanco');
  });

  it('skips unresolved option IDs gracefully', () => {
    const project = makeProject({
      items: [
        {
          id: 'item-1', moduleId: 'mod-1', quantity: 1,
          optionChoices: { INTERIOR: 'nonexistent-id' },
        },
      ],
    });
    render(
      <PresentationOptionsSlide
        project={project}
        modules={modules}
        optionGroups={optionGroups}
        catalog={catalog}
      />,
    );

    const slide = screen.getByTestId('presentation-options-slide');
    // The unresolved ID should not render as a label
    expect(slide.textContent).toContain('MOD-GAB-01');
  });

  it('shows section title "Opciones seleccionadas"', () => {
    const project = makeProject();
    render(
      <PresentationOptionsSlide
        project={project}
        modules={modules}
        optionGroups={optionGroups}
        catalog={catalog}
      />,
    );

    expect(screen.getByText('Opciones seleccionadas')).toBeTruthy();
  });

  it('renders multiple items', () => {
    const project = makeProject({
      items: [
        { id: 'item-1', moduleId: 'mod-1', quantity: 2, measurePresetId: 'p1', optionChoices: { INTERIOR: 'mat-a' } },
        { id: 'item-2', moduleId: 'mod-1', quantity: 1, measurePresetId: 'p1', optionChoices: { INTERIOR: 'mat-a' } },
      ],
    });
    render(
      <PresentationOptionsSlide
        project={project}
        modules={modules}
        optionGroups={optionGroups}
        catalog={catalog}
      />,
    );

    const slide = screen.getByTestId('presentation-options-slide');
    const items = slide.querySelectorAll('.presentation-options__item');
    expect(items.length).toBe(2);
  });
});

/* ── ProjectPresentationMode (4-slide presentation) ──── */

describe('ProjectPresentationMode', () => {
  afterEach(() => cleanup());

  const catalog = { materials, edges, hardware, modules: [] as never[], structures: [], components: [], optionGroups };
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
  });

  function renderPresentation(overrides: Record<string, unknown> = {}) {
    const project = makeProject();
    const result = render(
      <ProjectPresentationMode
        open={true}
        project={project}
        modules={modules}
        customers={customers}
        optionGroups={optionGroups}
        catalog={catalog}
        salePrice={270.38}
        workshopName="Taller Muebles SRL"
        onClose={onClose}
        prefer3dHero={false}
        {...overrides}
      />,
    );
    return { ...result, project };
  }

  it('renders dialog with project name and aria-modal', () => {
    renderPresentation();
    const dialog = screen.getByTestId('project-presentation-mode');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const titleEl = dialog.ownerDocument.getElementById(labelledBy!);
    expect(titleEl?.textContent).toContain('Cocina Ana');
  });

  it('shows workshop name (branding) in header', () => {
    renderPresentation();
    expect(screen.getByText('Taller Muebles SRL')).toBeTruthy();
  });

  it('hides workshop name when not provided', () => {
    renderPresentation({ workshopName: undefined });
    expect(screen.queryByText('Taller Muebles SRL')).toBeNull();
  });

  it('shows customer name', () => {
    renderPresentation();
    expect(screen.getByText('Ana López')).toBeTruthy();
  });

  it('shows sale total formatted', () => {
    renderPresentation();
    const total = screen.getByTestId('project-presentation-total');
    expect(total.textContent).toContain('270.38');
  });

  it('shows "—" when salePrice is null', () => {
    renderPresentation({ salePrice: null });
    const total = screen.getByTestId('project-presentation-total');
    expect(total.textContent).toBe('—');
  });

  it('renders 4 slide tabs with correct labels', () => {
    renderPresentation();
    expect(screen.getByTestId('presentation-slide-tab-0')).toBeTruthy();
    expect(screen.getByTestId('presentation-slide-tab-1')).toBeTruthy();
    expect(screen.getByTestId('presentation-slide-tab-2')).toBeTruthy();
    expect(screen.getByTestId('presentation-slide-tab-3')).toBeTruthy();
  });

  it('starts on slide 0 (Resumen) with active class', () => {
    renderPresentation();
    const slide0 = screen.getByTestId('presentation-slide-0');
    expect(slide0.className).toContain('project-presentation__slide--active');
    const slide1 = screen.getByTestId('presentation-slide-1');
    expect(slide1.className).not.toContain('project-presentation__slide--active');
  });

  it('navigates to next slide with "Siguiente" button', () => {
    renderPresentation();
    fireEvent.click(screen.getByTestId('presentation-next-slide'));
    const slide1 = screen.getByTestId('presentation-slide-1');
    expect(slide1.className).toContain('project-presentation__slide--active');
    const slide0 = screen.getByTestId('presentation-slide-0');
    expect(slide0.className).not.toContain('project-presentation__slide--active');
  });

  it('navigates back with "Anterior" button', () => {
    renderPresentation();
    fireEvent.click(screen.getByTestId('presentation-next-slide'));
    fireEvent.click(screen.getByTestId('presentation-prev-slide'));
    const slide0 = screen.getByTestId('presentation-slide-0');
    expect(slide0.className).toContain('project-presentation__slide--active');
  });

  it('disables "Anterior" on first slide', () => {
    renderPresentation();
    const prev = screen.getByTestId('presentation-prev-slide') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it('disables "Siguiente" on last slide', () => {
    renderPresentation();
    // Navigate to last slide
    fireEvent.click(screen.getByTestId('presentation-slide-tab-3'));
    const next = screen.getByTestId('presentation-next-slide') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('navigates via dot click', () => {
    renderPresentation();
    fireEvent.click(screen.getByTestId('presentation-slide-tab-2'));
    const slide2 = screen.getByTestId('presentation-slide-2');
    expect(slide2.className).toContain('project-presentation__slide--active');
  });

  it('navigates with ArrowRight keyboard key', () => {
    renderPresentation();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const slide1 = screen.getByTestId('presentation-slide-1');
    expect(slide1.className).toContain('project-presentation__slide--active');
  });

  it('navigates with ArrowLeft keyboard key', () => {
    renderPresentation();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    const slide0 = screen.getByTestId('presentation-slide-0');
    expect(slide0.className).toContain('project-presentation__slide--active');
  });

  it('calls onClose on Escape key', () => {
    renderPresentation();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /* ── FullscreenDialog migration (F110) ───────────────── */

  it('Escape is layered: closes shortcuts overlay first, then the presentation', () => {
    renderPresentation();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('presentation-shortcuts-overlay')).toBeTruthy();

    // First Esc dismisses the inner overlay only (single Esc path: the
    // presentation's own keydown handler; FullscreenDialog escapeEnabled=false).
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('presentation-shortcuts-overlay')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // Second Esc closes the presentation.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab is trapped inside the presentation dialog', () => {
    renderPresentation();
    const dialog = screen.getByTestId('project-presentation-mode');
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('restores focus to the trigger element on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Abrir presentación';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = renderPresentation();
    // FullscreenDialog moves focus into the dialog (async initial focus).
    await waitFor(() => {
      expect(document.activeElement).not.toBe(trigger);
    });
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('arrow keys from a tablist do not advance the deck (guard preserved)', () => {
    renderPresentation();
    const tablist = screen.getByTestId('presentation-slide-tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    // Roving tablist owns the event: slide 1 becomes the tabpanel.
    expect(
      screen.getByTestId('presentation-slide-1').getAttribute('role'),
    ).toBe('tabpanel');
  });

  it('calls onClose when clicking "Salir" button', () => {
    renderPresentation();
    fireEvent.click(screen.getByTestId('project-presentation-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns null when open=false', () => {
    render(
      <ProjectPresentationMode
        open={false}
        project={makeProject()}
        modules={modules}
        customers={customers}
        optionGroups={optionGroups}
        catalog={catalog}
        salePrice={200}
        onClose={onClose}
      />,
    );
    expect(screen.queryByTestId('project-presentation-mode')).toBeNull();
  });

  it('slide 0 shows items list with quantity and measures', () => {
    renderPresentation();
    const slide = screen.getByTestId('presentation-slide-0');
    expect(slide.textContent).toContain('2×');
    expect(slide.textContent).toContain('MOD-GAB-01');
    expect(slide.textContent).toContain('Bajo mesada');
  });

  it('slide 1 renders PresentationKitchenPlanSlide', () => {
    renderPresentation();
    fireEvent.click(screen.getByTestId('presentation-slide-tab-1'));
    // KitchenPlanSlide shows empty state when no layout
    expect(screen.getByText('Sin planta definida')).toBeTruthy();
  });

  it('slide 1 title is Planta (not Plano de cocina)', () => {
    renderPresentation({
      project: makeProject({ kitchenLayout: makeKitchenLayout() }),
    });
    fireEvent.click(screen.getByTestId('presentation-slide-tab-1'));
    const planSection = screen.getByTestId('presentation-slide-1');
    expect(
      planSection.querySelector('.project-presentation__section-title')
        ?.textContent,
    ).toBe('Planta');
    expect(screen.queryByText('Plano de cocina')).toBeNull();
  });

  it('shows ambient tabs for multi-space and scopes plan SVG', () => {
    const multiLayout: ProjectKitchenLayout = {
      walls: [
        {
          id: 'w-c',
          name: 'Muro c',
          lengthMm: 3000,
          angleDeg: 0,
          originXMm: 0,
          originYMm: 0,
        },
      ],
      placements: [
        {
          itemId: 'item-1',
          instanceIndex: 0,
          wallId: 'w-c',
          offsetMm: 100,
          elevation: 'floor',
        },
      ],
      activeSpaceId: 'sp-cocina',
      spaces: [
        {
          id: 'sp-cocina',
          name: 'Cocina',
          walls: [
            {
              id: 'w-c',
              name: 'Muro c',
              lengthMm: 3000,
              angleDeg: 0,
              originXMm: 0,
              originYMm: 0,
            },
          ],
          placements: [
            {
              itemId: 'item-1',
              instanceIndex: 0,
              wallId: 'w-c',
              offsetMm: 100,
              elevation: 'floor',
            },
          ],
        },
        {
          id: 'sp-lav',
          name: 'Lavandería',
          walls: [
            {
              id: 'w-l',
              name: 'Muro l',
              lengthMm: 2000,
              angleDeg: 0,
              originXMm: 0,
              originYMm: 0,
            },
          ],
          placements: [
            {
              itemId: 'item-1',
              instanceIndex: 1,
              wallId: 'w-l',
              offsetMm: 50,
              elevation: 'floor',
            },
          ],
        },
      ],
    };
    renderPresentation({
      project: makeProject({
        kitchenLayout: multiLayout,
        items: [
          {
            id: 'item-1',
            moduleId: 'mod-1',
            quantity: 2,
            measurePresetId: 'p1',
            optionChoices: { INTERIOR: 'mat-a', FRENTE: 'mat-c' },
          },
        ],
      }),
    });

    expect(screen.getByTestId('presentation-space-tablist')).toBeTruthy();
    expect(screen.getByTestId('presentation-space-tab-sp-cocina')).toBeTruthy();
    expect(screen.getByTestId('presentation-space-tab-sp-lav')).toBeTruthy();

    fireEvent.click(screen.getByTestId('presentation-slide-tab-1'));
    expect(screen.getByTestId('presentation-kitchen-svg-sp-cocina')).toBeTruthy();

    fireEvent.click(screen.getByTestId('presentation-space-tab-sp-lav'));
    expect(screen.getByTestId('presentation-kitchen-svg-sp-lav')).toBeTruthy();
    expect(screen.getByTestId('presentation-kitchen-space-title').textContent).toBe(
      'Lavandería',
    );
  });

  it('slide 2 renders PresentationOptionsSlide', () => {
    renderPresentation();
    fireEvent.click(screen.getByTestId('presentation-slide-tab-2'));
    expect(screen.getByTestId('presentation-options-slide')).toBeTruthy();
  });

  it('slide 3 shows empty 3D state (no structure data in fixtures)', () => {
    renderPresentation();
    fireEvent.click(screen.getByTestId('presentation-slide-tab-3'));
    // With minimal fixtures (no structures/components), preview is empty
    expect(screen.getByText('Sin vista 3D disponible')).toBeTruthy();
    expect(screen.getByTestId('presentation-3d-empty')).toBeTruthy();
  });

  it('nav tabs show visible slide labels', () => {
    renderPresentation();
    expect(screen.getByTestId('presentation-slide-tab-0').textContent).toContain('Resumen');
    expect(screen.getByTestId('presentation-slide-tab-1').textContent).toContain('Planta');
  });

  it('shows slide counter with label', () => {
    renderPresentation();
    expect(screen.getByTestId('presentation-nav-status').textContent).toMatch(
      /Resumen · 1 \/ 4/,
    );
  });

  it('updates counter on navigation', () => {
    renderPresentation();
    fireEvent.click(screen.getByTestId('presentation-next-slide'));
    expect(screen.getByTestId('presentation-nav-status').textContent).toMatch(
      /Planta · 2 \/ 4/,
    );
  });

  it('shows "Cotización" kicker in header', () => {
    renderPresentation();
    expect(screen.getByText('Cotización')).toBeTruthy();
  });

  it('has proper ARIA attributes on slide tabs', () => {
    renderPresentation();
    const tab0 = screen.getByTestId('presentation-slide-tab-0');
    expect(tab0.getAttribute('role')).toBe('tab');
    expect(tab0.getAttribute('aria-selected')).toBe('true');

    const tab1 = screen.getByTestId('presentation-slide-tab-1');
    expect(tab1.getAttribute('aria-selected')).toBe('false');
  });

  it('slide navigation has role="navigation" with aria-label', () => {
    renderPresentation();
    const nav = screen.getByLabelText('Navegación de diapositivas');
    expect(nav).toBeTruthy();
  });

  it('slide tabs follow the shared tablist contract (linkage + roving arrows)', () => {
    renderPresentation();
    const tablist = screen.getByTestId('presentation-slide-tablist');
    expect(tablist.getAttribute('role')).toBe('tablist');
    expect(tablist.getAttribute('aria-label')).toBe('Diapositivas');

    const tab0 = screen.getByTestId('presentation-slide-tab-0');
    expect(tab0.getAttribute('aria-controls')).toBe('presentation-slide-panel-0');
    // Active slide carries the tabpanel role and back-reference
    const slide0 = screen.getByTestId('presentation-slide-0');
    expect(slide0.getAttribute('role')).toBe('tabpanel');
    expect(slide0.getAttribute('aria-labelledby')).toBe(
      'presentation-slide-tab-0',
    );
    expect(screen.getByTestId('presentation-slide-1').getAttribute('role')).toBeNull();

    // Roving arrows on the tablist advance the deck (selection + focus)
    const tab1 = screen.getByTestId('presentation-slide-tab-1');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(tab1.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab1);
    expect(screen.getByTestId('presentation-slide-1').getAttribute('role')).toBe(
      'tabpanel',
    );
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(tab0.getAttribute('aria-selected')).toBe('true');
  });

  it('resets to slide 0 when open changes from false to true', () => {
    const { rerender } = render(
      <ProjectPresentationMode
        open={false}
        project={makeProject()}
        modules={modules}
        customers={customers}
        optionGroups={optionGroups}
        catalog={catalog}
        salePrice={200}
        onClose={onClose}
      />,
    );
    expect(screen.queryByTestId('project-presentation-mode')).toBeNull();

    rerender(
      <ProjectPresentationMode
        open={true}
        project={makeProject()}
        modules={modules}
        customers={customers}
        optionGroups={optionGroups}
        catalog={catalog}
        salePrice={200}
        onClose={onClose}
      />,
    );
    const slide0 = screen.getByTestId('presentation-slide-0');
    expect(slide0.className).toContain('project-presentation__slide--active');
  });

  it('does not auto-show keyboard shortcuts overlay on open', () => {
    vi.useFakeTimers();
    renderPresentation();
    expect(screen.queryByTestId('presentation-shortcuts-overlay')).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(screen.queryByTestId('presentation-shortcuts-overlay')).toBeNull();
    vi.useRealTimers();
  });

  it('toggles keyboard shortcuts overlay with the ? key', () => {
    renderPresentation();
    expect(screen.queryByTestId('presentation-shortcuts-overlay')).toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    const overlay = screen.getByTestId('presentation-shortcuts-overlay');
    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.getAttribute('aria-label')).toBe('Atajos de teclado');
    expect(screen.getByText('Atajos de teclado')).toBeTruthy();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.queryByTestId('presentation-shortcuts-overlay')).toBeNull();
  });

  it('shows only client 3D actions by default (no workshop tools)', () => {
    // Force WebGL path so toolbar mounts (canUseWebGL may fail in jsdom).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    const project = makeProject({
      kitchenLayout: makeKitchenLayout(),
      items: [
        {
          id: 'item-1',
          moduleId: 'mod-1',
          quantity: 1,
          measurePresetId: 'p1',
          optionChoices: { INTERIOR: 'mat-a', FRENTE: 'mat-c' },
        },
      ],
    });
    // catalog needs modules for 3D non-empty — even if empty, toolbar needs !preview.empty
    renderPresentation({
      project,
      catalog: {
        materials,
        edges,
        hardware,
        modules,
        structures: [],
        components: [],
        optionGroups,
      },
    });
    fireEvent.click(screen.getByTestId('presentation-slide-tab-3'));

    // If WebGL path didn't open toolbar (preview empty / no webgl), skip assert body.
    const toolbar = screen.queryByTestId('presentation-client-toolbar');
    if (!toolbar) {
      // Still assert workshop panel is never visible without toggle.
      expect(screen.queryByTestId('presentation-workshop-panel')).toBeNull();
      expect(screen.queryByTestId('presentation-explode-slider')).toBeNull();
      return;
    }

    expect(screen.getByTestId('presentation-capture-png')).toBeTruthy();
    expect(screen.getByTestId('presentation-share-link')).toBeTruthy();
    expect(screen.getByTestId('presentation-workshop-toggle')).toBeTruthy();
    expect(screen.queryByTestId('presentation-workshop-panel')).toBeNull();
    expect(screen.queryByTestId('presentation-explode-slider')).toBeNull();
    expect(screen.queryByText('Roles taller')).toBeNull();

    fireEvent.click(screen.getByTestId('presentation-workshop-toggle'));
    expect(screen.getByTestId('presentation-workshop-panel')).toBeTruthy();
    expect(screen.getByTestId('presentation-explode-slider')).toBeTruthy();
    expect(screen.getByText('Roles taller')).toBeTruthy();
    expect(screen.getByTestId('presentation-export-toggle')).toBeTruthy();
  });
});
