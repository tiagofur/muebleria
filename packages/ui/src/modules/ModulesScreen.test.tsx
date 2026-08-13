/**
 * F021 — Modules cards + detail + Modal LG.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComponentProps } from 'react';
import type {
  Component,
  Hardware,
  Module,
  ModuleCategory,
  OptionGroup,
  QuoteBreakdown,
} from '@muebles/domain';
import { resetRequestCreateKeyConsumers } from '../common/consumeRequestCreateKey';
import { ModulesScreen } from './ModulesScreen';

const here = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

const optionGroups: OptionGroup[] = [
  {
    id: 'g1',
    code: 'INTERIOR',
    name: 'Interior',
    kind: 'board',
    required: true,
    optionIds: ['mat-a'],
  },
  {
    id: 'g2',
    code: 'BISAGRA',
    name: 'Bisagra',
    kind: 'hardware',
    required: true,
    optionIds: ['hw-1'],
  },
];

const hardware: Hardware[] = [
  {
    id: 'hw-1',
    code: 'HW-01',
    name: 'Bisagra 35',
    unit: 'piece',
    costPerUnit: 10,
    active: true,
  },
];

const categories: ModuleCategory[] = [
  { id: 'cat-root', name: 'Cocina', sortOrder: 0 },
  { id: 'cat-child', name: 'Alacenas', parentId: 'cat-root', sortOrder: 0 },
];

const catalogComponents: Component[] = [
  {
    id: 'comp-lat',
    code: 'COM-LAT',
    name: 'Lateral izquierdo',
    placement: 'lateral_izquierdo',
    geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 560, thicknessMm: 18 },
    defaultEdges: [
      { side: 'L1', enabled: false },
      { side: 'L2', enabled: false },
      { side: 'W1', enabled: false },
      { side: 'W2', enabled: false },
    ],
    optionRoles: ['INTERIOR'],
    active: true,
  },
  {
    id: 'comp-fondo',
    code: 'COM-FON',
    name: 'Fondo',
    placement: 'trasera',
    geometry: { kind: 'rectangular_board', lengthMm: 689, widthMm: 560, thicknessMm: 3 },
    defaultEdges: [
      { side: 'L1', enabled: false },
      { side: 'L2', enabled: false },
      { side: 'W1', enabled: false },
      { side: 'W2', enabled: false },
    ],
    optionRoles: ['INTERIOR'],
    active: true,
  },
];

const modules: Module[] = [
  {
    id: 'mod-1',
    code: 'MOD-GAB-01',
    name: 'Bajo mesada 600',
    categoryId: 'cat-child',
    components: [
      { componentId: 'comp-lat', quantity: 1 },
      { componentId: 'comp-fondo', quantity: 1 },
    ],
    hardwareLines: [
      {
        id: 'hl1',
        quantity: 2,
        optionRole: 'BISAGRA',
      },
    ],
  },
  {
    id: 'mod-2',
    code: 'MOD-CAJ-01',
    name: 'Cajón standard',
    components: [],
    hardwareLines: [],
  },
];

const sampleBreakdown: QuoteBreakdown = {
  materialsCost: 100,
  edgeTotal: 20,
  hardwareTotal: 30,
  laborModular: 0,
  laborFixedCost: 0,
  directCost: 150,
  salePrice: 202.5,
  marginFactor: 1.35,
  discountPercent: 0,
  discountAmount: 0,
};

function renderScreen(
  props: Partial<ComponentProps<typeof ModulesScreen>> = {},
) {
  const onCreate = vi.fn();
  const onUpdate = vi.fn();
  const onDelete = vi.fn();
  const onDuplicate = vi.fn();
  const onEditingChange = vi.fn();
  const result = render(
    <ModulesScreen
      modules={modules}
      optionGroups={optionGroups}
      hardware={hardware}
      categories={categories}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onEditingChange={onEditingChange}
      moduleEstimates={{
        'mod-1': 202.5,
        'mod-2': null,
      }}
      catalogComponents={catalogComponents}
      {...props}
    />,
  );
  return { ...result, onCreate, onUpdate, onDelete, onDuplicate, onEditingChange };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  resetRequestCreateKeyConsumers();
});

describe('ModulesScreen structure (F021)', () => {
  it('uses cards, not CatalogTable', () => {
    const screenSrc = read('ModulesScreen.tsx');
    const listSrc = read('components/ModuleListView.tsx');
    expect(screenSrc).not.toMatch(/CatalogTable/);
    expect(listSrc).not.toMatch(/CatalogTable/);
    expect(listSrc).toMatch(/module-card-grid/);
    expect(listSrc).toMatch(/EmptyState/);
    // Fase 4: full-page editor (inlineEditMode when modalOpen).
    expect(screenSrc).toMatch(/inlineEditMode = modalOpen/);
  });

  it('renders a card per module with code, name, counts, and estimate', () => {
    renderScreen();
    const card = screen.getByTestId('module-card-mod-1');
    expect(within(card).getByText('MOD-GAB-01')).toBeTruthy();
    expect(within(card).getByText('Bajo mesada 600')).toBeTruthy();
    expect(within(card).getByText(/2 componentes/)).toBeTruthy();
    expect(within(card).getByText(/1 herraje/)).toBeTruthy();
    expect(within(card).getByText('$202.50 MXN')).toBeTruthy();

    const card2 = screen.getByTestId('module-card-mod-2');
    expect(within(card2).getByText('Sin estimado')).toBeTruthy();
  });

  it('shows photo thumbnail or Sin foto placeholder on each card', () => {
    renderScreen({
      modules: [
        { ...modules[0]!, imageUrl: '/api/media/mod1.png' },
        modules[1]!,
      ],
      resolveImageUrl: (u) => (u ? `https://cdn${u}` : undefined),
    });
    const media1 = screen.getByTestId('module-card-media-mod-1');
    const img = within(media1).getByTestId('catalog-image');
    expect(img.getAttribute('src')).toBe('https://cdn/api/media/mod1.png');

    const media2 = screen.getByTestId('module-card-media-mod-2');
    expect(within(media2).getByTestId('catalog-image-placeholder')).toBeTruthy();
    expect(within(media2).getByText(/Sin foto/i)).toBeTruthy();
  });

  it('shows detail thumbnail with photo or Sin foto', async () => {
    const user = userEvent.setup();
    renderScreen({
      modules: [{ ...modules[0]!, imageUrl: '/api/media/mod1.png' }],
      resolveImageUrl: (u) => (u ? `https://cdn${u}` : undefined),
    });
    await user.click(screen.getByTestId('module-card-mod-1'));
    const thumb = screen.getByTestId('module-detail-thumb');
    expect(within(thumb).getByTestId('catalog-image').getAttribute('src')).toBe(
      'https://cdn/api/media/mod1.png',
    );
  });

  it('shows EmptyState when there are no modules', () => {
    renderScreen({ modules: [] });
    expect(screen.getByText('No hay muebles')).toBeTruthy();
    expect(
      screen.getByText(
        /Creá el primer mueble del catálogo o cargá la semilla/,
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: /Nuevo mueble/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('shows no-results EmptyState and clears search + category filter', async () => {
    const user = userEvent.setup();
    renderScreen({ onCreateCategory: vi.fn() });

    await user.type(screen.getByLabelText(/Buscar muebles/i), 'zzzz-no-match');
    await waitFor(() => {
      expect(screen.getByTestId('empty-state-no-results')).toBeTruthy();
    });
    expect(screen.getByText('Sin resultados')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Limpiar filtros/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('empty-state-no-results')).toBeNull();
    });
    expect(screen.getByTestId('module-card-mod-1')).toBeTruthy();
    expect(screen.getByTestId('module-card-mod-2')).toBeTruthy();
    expect(
      (screen.getByLabelText(/Buscar muebles/i) as HTMLInputElement).value,
    ).toBe('');
  });
});

describe('ModulesScreen navigation + modals (F021)', () => {
  it('opens read-only detail from a card click', async () => {
    const user = userEvent.setup();
    const { onEditingChange } = renderScreen();

    await user.click(screen.getByTestId('module-card-mod-1'));

    const detail = screen.getByTestId('module-detail');
    expect(within(detail).getByText('Bajo mesada 600')).toBeTruthy();
    expect(within(detail).getByText('Lateral izquierdo')).toBeTruthy();
    expect(within(detail).getByText('Fondo')).toBeTruthy();
    expect(within(detail).getByText(/Por opción \(BISAGRA\)/)).toBeTruthy();
    // Read-only: no part description inputs
    expect(screen.queryByLabelText('Descripción')).toBeNull();
    expect(onEditingChange).toHaveBeenCalledWith('mod-1');
  });

  it('opens full-page editor from detail Editar', async () => {
    const user = userEvent.setup();
    renderScreen({
      costPreview: sampleBreakdown,
      previewBlocked: false,
    });

    await user.click(screen.getByTestId('module-card-mod-1'));
    await user.click(screen.getByRole('button', { name: /^Editar$/ }));

    const page = await screen.findByTestId('module-editor-page');
    expect(within(page).getByText('Editar mueble')).toBeTruthy();
    expect(within(page).getByLabelText('Código')).toHaveProperty(
      'value',
      'MOD-GAB-01',
    );
    // Sticky cost aside (Fase 4 workspace) — may also appear in Costo tab.
    expect(
      within(page).getAllByText(/Precio de venta: \$202\.50 MXN/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens full-page empty form from + Nuevo mueble', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /Nuevo mueble/i }));

    const page = await screen.findByTestId('module-editor-page');
    expect(within(page).getByText('Nuevo mueble')).toBeTruthy();
    expect(within(page).getByLabelText('Código')).toHaveProperty('value', '');
    expect(within(page).getByLabelText('Nombre')).toHaveProperty('value', '');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows flat tabs (General/Estructura/Componentes/Agregados/Medidas/Herrajes; Costo is aside)', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /Nuevo mueble/i }));
    expect(screen.getByTestId('module-editor-page')).toBeTruthy();
    expect(screen.getByTestId('module-editor-tabs')).toBeTruthy();
    expect(screen.getByTestId('module-editor-tab-general')).toBeTruthy();
    expect(screen.getByTestId('module-editor-tab-structure')).toBeTruthy();
    expect(screen.getByTestId('module-editor-tab-components')).toBeTruthy();
    // Full-page: Costo lives in sticky aside, not as a tab.
    expect(screen.queryByTestId('module-editor-tab-cost')).toBeNull();
    expect(screen.getByTestId('module-editor-cost-aside')).toBeTruthy();
    expect(screen.getByTestId('module-editor-panel-general').hidden).toBe(false);

    // No structure yet → badge on structure tab.
    expect(screen.getByTestId('module-editor-structure-badge')).toBeTruthy();
    await user.click(screen.getByTestId('module-editor-tab-structure'));
    expect(screen.getByTestId('module-editor-panel-structure').hidden).toBe(
      false,
    );
    expect(screen.getByTestId('structure-picker')).toBeTruthy();

    await user.click(screen.getByTestId('module-editor-tab-components'));
    expect(screen.getByTestId('module-editor-panel-components').hidden).toBe(
      false,
    );

    await user.click(screen.getByTestId('module-editor-tab-measures'));
    expect(screen.getByTestId('module-editor-panel-measures').hidden).toBe(
      false,
    );

    await user.click(screen.getByTestId('module-editor-tab-hardware'));
    expect(screen.getByTestId('module-editor-panel-hardware').hidden).toBe(
      false,
    );

    // No board-parts editor — modules compose structure + components only.
    expect(screen.queryByTestId('module-editor-tab-parts')).toBeNull();
    expect(screen.queryByTestId('module-editor-panel-parts')).toBeNull();
  });

  it('hybrid Components tab: keeps Agregar componente when boardEditorSlot is set', async () => {
    const user = userEvent.setup();
    renderScreen({
      boardEditorSlot: (
        <div data-testid="fake-board-editor">Board canvas</div>
      ),
    });

    await user.click(screen.getByTestId('module-card-mod-1'));
    await user.click(screen.getByRole('button', { name: /^Editar$/ }));
    await screen.findByTestId('module-editor-page');

    await user.click(screen.getByTestId('module-editor-tab-components'));

    const componentsPanel = screen.getByTestId(
      'module-editor-panel-components',
    );
    expect(componentsPanel.hidden).toBe(false);
    // BoardEditor must not replace the instance chrome (P0 hybrid).
    expect(screen.getByTestId('add-component-btn')).toBeTruthy();
    expect(
      within(componentsPanel).getByText(/Puertas, entrepaños/i),
    ).toBeTruthy();
    expect(screen.getByTestId('module-editor-board-slot')).toBeTruthy();
    expect(screen.getByTestId('fake-board-editor')).toBeTruthy();

    // Leaving the tab unmounts the board slot (avoids idle WebGL).
    await user.click(screen.getByTestId('module-editor-tab-general'));
    expect(screen.queryByTestId('module-editor-board-slot')).toBeNull();
  });

  it('renderBoardEditor receives a live Module from the current draft', async () => {
    const user = userEvent.setup();
    const seen: Module[] = [];
    const compositionKeys: string[] = [];
    renderScreen({
      structures: [
        {
          id: 'struct-1',
          code: 'STR-1',
          name: 'Cuerpo base',
          components: [{ componentId: 'comp-lat', quantity: 2 }],
        },
      ],
      renderBoardEditor: ({ module: mod, compositionKey }) => {
        seen.push(mod);
        compositionKeys.push(compositionKey);
        return (
          <div data-testid="live-board-editor" data-structure={mod.structureId ?? ''}>
            live:{mod.structureId}:{mod.components?.length ?? 0}
          </div>
        );
      },
    });

    await user.click(screen.getByTestId('module-card-mod-1'));
    await user.click(screen.getByRole('button', { name: /^Editar$/ }));
    await screen.findByTestId('module-editor-page');

    // Pick a structure so composed mode is enabled, then open Components.
    await user.click(screen.getByTestId('module-editor-tab-structure'));
    const structurePicker = screen.getByTestId('structure-picker') as HTMLSelectElement;
    await user.selectOptions(structurePicker, 'struct-1');

    await user.click(screen.getByTestId('module-editor-tab-components'));
    expect(screen.getByTestId('live-board-editor')).toBeTruthy();
    expect(screen.getByTestId('add-component-btn')).toBeTruthy();

    const last = seen[seen.length - 1];
    expect(last).toBeTruthy();
    expect(last!.id).toBe('mod-1');
    expect(last!.structureId).toBe('struct-1');
    // Fixture module has 2 catalog components in draft after open-from-edit.
    expect(last!.components?.length).toBe(2);
    expect(compositionKeys[compositionKeys.length - 1]).toContain('struct-1');
  });

  it('general panel exposes furnitureType select (default inferior) and persists on save (#109)', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderScreen();

    await user.click(screen.getByRole('button', { name: /Nuevo mueble/i }));
    await screen.findByTestId('module-editor-page');

    const select = screen.getByTestId('module-furniture-type') as HTMLSelectElement;
    expect(select.value).toBe('inferior');

    // Fill required identity fields so save is enabled.
    await user.type(screen.getByLabelText('Código'), 'MOD-TEST-1');
    await user.type(screen.getByLabelText('Nombre'), 'Test Alacena');
    await user.selectOptions(select, 'superior');
    expect(select.value).toBe('superior');

    // Save (Guardar button in the editor chrome).
    await user.click(screen.getByRole('button', { name: /^Guardar/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    const draft = onCreate.mock.calls[0]![0];
    expect(draft.furnitureType).toBe('superior');
  });

  it('general panel exposes baseMode + B and persists on save', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderScreen();

    await user.click(screen.getByRole('button', { name: /Nuevo mueble/i }));
    await screen.findByTestId('module-editor-page');

    await user.type(screen.getByLabelText('Código'), 'MOD-ZOCLO-1');
    await user.type(screen.getByLabelText('Nombre'), 'Bajo con zoclo');

    const baseSelect = screen.getByTestId(
      'module-base-mode',
    ) as HTMLSelectElement;
    expect(baseSelect.value).toBe('none');
    await user.selectOptions(baseSelect, 'plinth_board');
    expect(baseSelect.value).toBe('plinth_board');

    const bInput = screen.getByTestId(
      'module-base-clearance',
    ) as HTMLInputElement;
    await user.clear(bInput);
    await user.type(bInput, '120');

    await user.click(screen.getByRole('button', { name: /^Guardar/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    const saved = onCreate.mock.calls[0]![0];
    expect(saved.baseMode).toBe('plinth_board');
    // Draft form keeps B as string; catalogStore maps via draftToModule → number.
    expect(saved.baseClearanceMm).toBe('120');
  });

  it('opens full-page create from requestCreateKey prop (Dashboard handoff)', () => {
    renderScreen({ requestCreateKey: 1 });
    const page = screen.getByTestId('module-editor-page');
    expect(within(page).getByText('Nuevo mueble')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not re-open create on remount with same requestCreateKey (R4-W)', () => {
    const baseProps: ComponentProps<typeof ModulesScreen> = {
      modules,
      optionGroups,
      hardware,
      categories,
      onCreate: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
      catalogComponents,
      requestCreateKey: 1,
    };
    const { unmount } = render(<ModulesScreen {...baseProps} />);
    expect(screen.getByTestId('module-editor-page')).toBeTruthy();

    // Leave Modules (unmount) and return with the same sticky shell key.
    unmount();
    render(<ModulesScreen {...baseProps} />);
    expect(screen.queryByTestId('module-editor-page')).toBeNull();
  });

  it('resets editor tab to general on requestCreateKey (R3-C2)', async () => {
    const user = userEvent.setup();
    const baseProps: ComponentProps<typeof ModulesScreen> = {
      modules,
      optionGroups,
      hardware,
      categories,
      onCreate: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
      catalogComponents,
      requestCreateKey: 1,
    };
    const { rerender } = render(<ModulesScreen {...baseProps} />);

    // Leave general via Estructura tab.
    await user.click(screen.getByTestId('module-editor-tab-structure'));
    expect(
      screen
        .getByTestId('module-editor-tab-structure')
        .getAttribute('aria-selected'),
    ).toBe('true');

    // Bump requestCreateKey — must reopen create on general tab.
    rerender(<ModulesScreen {...baseProps} requestCreateKey={2} />);

    expect(
      screen
        .getByTestId('module-editor-tab-general')
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('returns to list from sticky chrome and shows total', async () => {
    const user = userEvent.setup();
    const { onEditingChange } = renderScreen();

    await user.click(screen.getByTestId('module-card-mod-1'));
    expect(screen.getByTestId('module-detail')).toBeTruthy();
    expect(screen.getByTestId('module-detail-chrome')).toBeTruthy();
    expect(screen.getByTestId('module-detail-total')).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: /Volver a la lista|^Lista$/i }),
    );
    expect(screen.queryByTestId('module-detail')).toBeNull();
    expect(screen.getByTestId('module-card-mod-1')).toBeTruthy();
    expect(onEditingChange).toHaveBeenLastCalledWith(null);
  });

  it('detail workspace shows cost, structure panel and Más overflow', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByTestId('module-card-mod-1'));
    expect(screen.getByTestId('module-detail-cost')).toBeTruthy();
    expect(screen.getByTestId('module-detail-components')).toBeTruthy();
    expect(screen.getByTestId('module-detail-structure')).toBeTruthy();
    expect(screen.getByTestId('module-detail-hardware')).toBeTruthy();
    expect(screen.getByTestId('module-detail-presets')).toBeTruthy();
    expect(screen.getByTestId('module-detail-edit')).toBeTruthy();
    // Duplicar / Eliminar live behind Más (not always-visible primary noise)
    expect(screen.getByRole('button', { name: /^Más$/i })).toBeTruthy();
  });
});

describe('ModulesScreen categories (F025)', () => {
  it('renders category filter panel and filters cards by tree node', async () => {
    const user = userEvent.setup();
    renderScreen({
      onCreateCategory: vi.fn(),
    });

    expect(screen.getByTestId('category-filter-panel')).toBeTruthy();
    expect(screen.getByTestId('module-card-mod-1')).toBeTruthy();
    expect(screen.getByTestId('module-card-mod-2')).toBeTruthy();
    // Filter panel is filter-only: no inline edit/delete admin list
    expect(screen.queryByTestId('manage-categories-list')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Editar Cocina/i }),
    ).toBeNull();

    await user.click(screen.getByTestId('category-filter-uncategorized'));
    expect(screen.queryByTestId('module-card-mod-1')).toBeNull();
    expect(screen.getByTestId('module-card-mod-2')).toBeTruthy();

    await user.click(screen.getByTestId('category-filter-cat-root'));
    expect(screen.getByTestId('module-card-mod-1')).toBeTruthy();
    expect(screen.queryByTestId('module-card-mod-2')).toBeNull();
  });

  it('shows subtree counts on each filter option over the full catalog', async () => {
    const user = userEvent.setup();
    renderScreen({
      onCreateCategory: vi.fn(),
    });

    // Fixture: mod-1 under cat-child (Cocina subtree), mod-2 uncategorized
    expect(screen.getByTestId('category-filter-count-all').textContent).toBe(
      '2',
    );
    expect(
      screen.getByTestId('category-filter-count-uncategorized').textContent,
    ).toBe('1');
    expect(
      screen.getByTestId('category-filter-count-cat-root').textContent,
    ).toBe('1');
    expect(
      screen.getByTestId('category-filter-count-cat-child').textContent,
    ).toBe('1');

    // Search filters cards only — tree counts stay on full catalog
    await user.type(screen.getByLabelText(/Buscar muebles/i), 'zzzz-no-match');
    expect(screen.getByTestId('category-filter-count-all').textContent).toBe(
      '2',
    );
    expect(
      screen.getByTestId('category-filter-count-uncategorized').textContent,
    ).toBe('1');
  });

  it('opens manage-categories modal for create/edit/delete, not inline admin', async () => {
    const user = userEvent.setup();
    const onCreateCategory = vi.fn();
    const onUpdateCategory = vi.fn();
    const onDeleteCategory = vi.fn();
    renderScreen({
      onCreateCategory,
      onUpdateCategory,
      onDeleteCategory,
    });

    await user.click(screen.getByTestId('manage-categories'));
    expect(screen.getByTestId('manage-categories-modal')).toBeTruthy();
    expect(screen.getByTestId('manage-categories-list')).toBeTruthy();
    expect(screen.getByTestId('manage-category-edit-cat-root')).toBeTruthy();
    expect(screen.getByTestId('manage-category-delete-cat-root')).toBeTruthy();

    await user.click(screen.getByTestId('manage-categories-new'));
    expect(screen.getByLabelText(/Nombre/i)).toBeTruthy();
    await user.type(screen.getByLabelText(/Nombre/i), 'Baño');
    await user.click(screen.getByRole('button', { name: /^Guardar$/i }));
    expect(onCreateCategory).toHaveBeenCalled();

    await user.click(screen.getByTestId('manage-category-edit-cat-root'));
    const nameInput = screen.getByLabelText(/Nombre/i) as HTMLInputElement;
    expect(nameInput.value).toMatch(/Cocina/);
    await user.clear(nameInput);
    await user.type(nameInput, 'Cocina XL');
    await user.click(screen.getByRole('button', { name: /^Guardar$/i }));
    expect(onUpdateCategory).toHaveBeenCalledWith(
      'cat-root',
      expect.objectContaining({ name: 'Cocina XL' }),
    );

    await user.click(screen.getByTestId('manage-category-delete-cat-child'));
    await user.click(screen.getByRole('button', { name: /^Eliminar$/i }));
    expect(onDeleteCategory).toHaveBeenCalledWith('cat-child');
  });

  it('shows cascade category selector in module editor', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /Nuevo mueble/i }));
    expect(screen.getByTestId('module-category-cascade')).toBeTruthy();
    expect(screen.getByLabelText(/Categoría \(nivel 1\)/)).toBeTruthy();
  });

  it('shows category path on module detail', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByTestId('module-card-mod-1'));
    expect(screen.getByTestId('module-category-path').textContent).toMatch(
      /Cocina/,
    );
  });
});
