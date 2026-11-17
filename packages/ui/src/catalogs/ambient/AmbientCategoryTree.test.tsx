/**
 * @vitest-environment jsdom
 *
 * #1643: árbol de categorías compartido — caret de colapso por nodo con
 * hijos (expandido por defecto, aria-expanded honesto) y categorías sin
 * ítems atenuadas (siguen clicables).
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AmbientCategory } from '@granete/domain';

import { CategoryTree } from './AmbientCategoryTree';

afterEach(cleanup);

const tree: AmbientCategory[] = [
  { id: 'corr', name: 'Correderas', sortOrder: 1 },
  { id: 'blum', name: 'Cajones Blum', parentId: 'corr', sortOrder: 1 },
  { id: 'acc', name: 'Accesorios', parentId: 'blum', sortOrder: 1 },
  { id: 'vac', name: 'Cocinas', sortOrder: 2 },
];

const counts = new Map<string, number>([
  ['corr', 7],
  ['blum', 5],
  ['acc', 3],
  ['vac', 0],
]);

describe('CategoryTree (#1643)', () => {
  it('nodo con hijos tiene caret aria-expanded y colapsa su subárbol al pulsarlo', async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    render(
      <CategoryTree
        categories={tree}
        parentId={undefined}
        depth={0}
        categoryFilter={null}
        setCategoryFilter={setFilter}
        counts={counts}
      />,
    );

    const caret = screen.getByTestId('category-caret-corr');
    expect(caret).toHaveAttribute('aria-expanded', 'true');
    // Expandido por defecto: los hijos están visibles.
    expect(screen.getByTestId('category-filter-blum')).toBeInTheDocument();

    await user.click(caret);
    expect(caret).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('category-filter-blum')).toBeNull();

    // Re-expandir restaura los hijos.
    await user.click(caret);
    expect(screen.getByTestId('category-filter-blum')).toBeInTheDocument();
  });

  it('nodo sin hijos no tiene caret; el filtro sigue funcionando con el árbol colapsado', async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    render(
      <CategoryTree
        categories={tree}
        parentId={undefined}
        depth={0}
        categoryFilter={null}
        setCategoryFilter={setFilter}
        counts={counts}
      />,
    );

    expect(screen.queryByTestId('category-caret-vac')).toBeNull();

    // Colapsar la raíz no rompe el clic en otro nodo raíz.
    await user.click(screen.getByTestId('category-caret-corr'));
    await user.click(screen.getByTestId('category-filter-vac'));
    expect(setFilter).toHaveBeenCalled();
  });

  it('categoría sin ítems lleva la clase de atenuación y sigue filtrando', async () => {
    const setFilter = vi.fn();
    render(
      <CategoryTree
        categories={tree}
        parentId={undefined}
        depth={0}
        categoryFilter={null}
        setCategoryFilter={setFilter}
        counts={counts}
      />,
    );

    const empty = screen.getByTestId('category-filter-vac');
    expect(empty.className).toContain('module-category-tree__item--empty');
    expect(screen.getByTestId('category-filter-corr').className).not.toContain(
      'module-category-tree__item--empty',
    );
  });
});
