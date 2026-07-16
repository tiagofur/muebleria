/**
 * F021 — Modules cards + detail + Modal LG.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComponentProps } from 'react';
import type {
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

const modules: Module[] = [
  {
    id: 'mod-1',
    code: 'MOD-GAB-01',
    name: 'Bajo mesada 600',
    categoryId: 'cat-child',
    boardParts: [
      {
        id: 'p1',
        code: 'MOD-GAB-01-P01',
        description: 'Lateral izquierdo',
        quantity: 1,
        lengthMm: 720,
        widthMm: 560,
        edges: [
          { side: 'L1', enabled: true },
          { side: 'L2', enabled: false },
          { side: 'W1', enabled: false },
          { side: 'W2', enabled: false },
        ],
        optionRole: 'INTERIOR',
      },
      {
        id: 'p2',
        code: 'MOD-GAB-01-P02',
        description: 'Fondo',
        quantity: 1,
        lengthMm: 568,
        widthMm: 560,
        edges: [
          { side: 'L1', enabled: false },
          { side: 'L2', enabled: false },
          { side: 'W1', enabled: false },
          { side: 'W2', enabled: false },
        ],
        optionRole: 'INTERIOR',
      },
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
    boardParts: [
      {
        id: 'p3',
        code: 'MOD-CAJ-01-P01',
        description: 'Frente cajón',
        quantity: 1,
        lengthMm: 400,
        widthMm: 150,
        edges: [
          { side: 'L1', enabled: true },
          { side: 'L2', enabled: true },
          { side: 'W1', enabled: true },
          { side: 'W2', enabled: true },
        ],
        optionRole: 'INTERIOR',
      },
    ],
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
    const src = read('ModulesScreen.tsx');
    expect(src).not.toMatch(/CatalogTable/);
    expect(src).toMatch(/module-card-grid/);
    expect(src).toMatch(/size="lg"/);
    expect(src).toMatch(/EmptyState/);
  });

  it('renders a card per module with code, name, counts, and estimate', () => {
    renderScreen();
    const card = screen.getByTestId('module-card-mod-1');
    expect(within(card).getByText('MOD-GAB-01')).toBeTruthy();
    expect(within(card).getByText('Bajo mesada 600')).toBeTruthy();
    expect(within(card).getByText(/2 piezas/)).toBeTruthy();
    expect(within(card).getByText(/1 herraje/)).toBeTruthy();
    expect(within(card).getByText('202.50')).toBeTruthy();

    const card2 = screen.getByTestId('module-card-mod-2');
    expect(within(card2).getByText('Sin estimado')).toBeTruthy();
  });

  it('shows EmptyState when there are no modules', () => {
    renderScreen({ modules: [] });
    expect(screen.getByText('No hay módulos')).toBeTruthy();
    expect(
      screen.getByText(
        /Creá el primer mueble plantilla o cargá la semilla/,
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: /Nuevo mueble/i }).length,
    ).toBeGreaterThanOrEqual(1);
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
    expect(within(dialog).getByText(/Precio de venta: 202.50/)).toBeTruthy();
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

  it('opens create modal from requestCreateKey prop (Dashboard handoff)', () => {
    renderScreen({ requestCreateKey: 1 });
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/ui-modal--lg/);
    expect(within(dialog).getByText('Nuevo mueble')).toBeTruthy();
  });

  it('returns to list from detail back control', async () => {
    const user = userEvent.setup();
    const { onEditingChange } = renderScreen();

    await user.click(screen.getByTestId('module-card-mod-1'));
    expect(screen.getByTestId('module-detail')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Volver a la lista/i }));
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

    await user.click(screen.getByTestId('category-filter-uncategorized'));
    expect(screen.queryByTestId('module-card-mod-1')).toBeNull();
    expect(screen.getByTestId('module-card-mod-2')).toBeTruthy();

    await user.click(screen.getByTestId('category-filter-cat-root'));
    expect(screen.getByTestId('module-card-mod-1')).toBeTruthy();
    expect(screen.queryByTestId('module-card-mod-2')).toBeNull();
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
