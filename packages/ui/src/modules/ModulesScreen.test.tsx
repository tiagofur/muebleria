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
});

describe('ModulesScreen structure (F021)', () => {
  it('uses cards, not CatalogTable', () => {
    const screenSrc = read('ModulesScreen.tsx');
    const listSrc = read('components/ModuleListView.tsx');
    expect(screenSrc).not.toMatch(/CatalogTable/);
    expect(listSrc).not.toMatch(/CatalogTable/);
    expect(listSrc).toMatch(/module-card-grid/);
    expect(listSrc).toMatch(/EmptyState/);
    expect(screenSrc).toMatch(/size="lg"/);
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

  it('opens Modal LG editor from detail Editar', async () => {
    const user = userEvent.setup();
    renderScreen({
      costPreview: sampleBreakdown,
      previewBlocked: false,
    });

    await user.click(screen.getByTestId('module-card-mod-1'));
    await user.click(screen.getByRole('button', { name: /^Editar$/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toMatch(/ui-modal--lg/);
    expect(within(dialog).getByText('Editar mueble')).toBeTruthy();
    expect(within(dialog).getByLabelText('Código')).toHaveProperty(
      'value',
      'MOD-GAB-01',
    );
    expect(
      within(dialog).getByText(/Precio de venta: \$202\.50 MXN/),
    ).toBeTruthy();
  });

  it('opens Modal LG empty form from + Nuevo mueble', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /Nuevo mueble/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toMatch(/ui-modal--lg/);
    expect(within(dialog).getByText('Nuevo mueble')).toBeTruthy();
    expect(within(dialog).getByLabelText('Código')).toHaveProperty('value', '');
    expect(within(dialog).getByLabelText('Nombre')).toHaveProperty('value', '');
  });


  it('shows editor tabs General/Estructura/Componentes/Medidas/Herrajes/Costo', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /Nuevo mueble/i }));
    expect(screen.getByTestId('module-editor-tabs')).toBeTruthy();
    expect(screen.getByTestId('module-editor-panel-general').hidden).toBe(false);

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

    await user.click(screen.getByTestId('module-editor-tab-cost'));
    expect(screen.getByTestId('module-editor-panel-cost').hidden).toBe(false);

    // No board-parts editor — modules compose structure + components only.
    expect(screen.queryByTestId('module-editor-tab-parts')).toBeNull();
    expect(screen.queryByTestId('module-editor-panel-parts')).toBeNull();
    expect(screen.queryByTestId('module-editor-tab-composition')).toBeNull();
  });

  it('opens create modal from requestCreateKey prop (Dashboard handoff)', () => {
    renderScreen({ requestCreateKey: 1 });
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/ui-modal--lg/);
    expect(within(dialog).getByText('Nuevo mueble')).toBeTruthy();
  });

  it('returns to list from sticky chrome and shows total', async () => {
    const user = userEvent.setup();
    const { onEditingChange } = renderScreen();

    await user.click(screen.getByTestId('module-card-mod-1'));
    expect(screen.getByTestId('module-detail')).toBeTruthy();
    expect(screen.getByTestId('module-detail-chrome')).toBeTruthy();
    expect(screen.getByTestId('module-detail-total')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Lista$/i }));
    expect(screen.queryByTestId('module-detail')).toBeNull();
    expect(screen.getByTestId('module-card-mod-1')).toBeTruthy();
    expect(onEditingChange).toHaveBeenLastCalledWith(null);
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
