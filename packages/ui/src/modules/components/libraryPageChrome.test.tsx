/**
 * F104 — Page chrome composition: engineering library list views (Muebles,
 * Estructuras, Componentes, Agregados) render through the shared
 * PageHeader/PageToolbar skeleton (docs/design.md §4.1a).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ModuleListView } from './ModuleListView';
import { StructureListView } from '../../structures/components/StructureListView';
import { ComponentListView } from '../../components/editor/ComponentListView';
import { AgregadoListView } from '../../agregados/editor/AgregadoListView';

afterEach(cleanup);

function expectSharedHeader(title: string, primaryLabel?: string): void {
  const header = screen.getByTestId('page-header');
  expect(
    within(header).getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
  ).toEqual([title]);
  expect(header.querySelector('.page-header__icon svg')).not.toBeNull();
  const primaries = header.querySelectorAll('.btn--primary');
  if (primaryLabel) {
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain(primaryLabel);
  } else {
    expect(primaries).toHaveLength(0);
  }
}

describe('F104 page chrome — library list views', () => {
  it('Muebles renders header with categories as secondary and one primary', () => {
    render(
      <ModuleListView
        filtered={[]}
        categories={[]}
        categoryFilter="all"
        setCategoryFilter={vi.fn()}
        categoryFilterCounts={{ all: 0, uncategorized: 0, byCategoryId: new Map() }}
        search=""
        setSearch={vi.fn()}
        isTrulyEmpty
        isFilterEmpty={false}
        canMutate
        moduleEstimates={{}}
        onManageCategories={vi.fn()}
        onStartCreate={vi.fn()}
        onOpenDetail={vi.fn()}
        onCreateCategory={vi.fn()}
      />,
    );
    expectSharedHeader('Muebles', 'Nuevo mueble');
    expect(screen.getByTestId('manage-categories')).toBeDefined();
    // Toolbar hidden while the library is truly empty (same rule as catalogs).
    expect(screen.queryByTestId('page-toolbar')).toBeNull();
  });

  it('Estructuras renders header and unconditional toolbar with search', () => {
    render(
      <StructureListView
        rows={[]}
        search=""
        setSearch={vi.fn()}
        status="active"
        setStatus={vi.fn()}
        canMutate
        onCreate={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    );
    expectSharedHeader('Estructuras', 'Nueva estructura');
    const toolbar = screen.getByTestId('page-toolbar');
    expect(within(toolbar).getByRole('searchbox')).toBeDefined();
  });

  it('Componentes renders header and toolbar with placement filter', () => {
    render(
      <ComponentListView
        rows={[]}
        search=""
        setSearch={vi.fn()}
        status="active"
        setStatus={vi.fn()}
        placementFilter="all"
        setPlacementFilter={vi.fn()}
        canMutate
        onCreate={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    );
    expectSharedHeader('Componentes', 'Nuevo componente');
    const toolbar = screen.getByTestId('page-toolbar');
    expect(within(toolbar).getByRole('searchbox')).toBeDefined();
    expect(
      within(toolbar).getByTestId('component-placement-filter'),
    ).toBeDefined();
  });

  it('Agregados renders header and toolbar with sentence-case copy', () => {
    render(
      <AgregadoListView
        rows={[]}
        search=""
        setSearch={vi.fn()}
        canMutate
        onCreate={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    );
    expectSharedHeader('Agregados', 'Nuevo agregado');
    expect(
      within(screen.getByTestId('page-toolbar')).getByRole('searchbox'),
    ).toBeDefined();
  });

  it('read-only library (canMutate=false) keeps the header without primary', () => {
    render(
      <AgregadoListView
        rows={[]}
        search=""
        setSearch={vi.fn()}
        canMutate={false}
        onCreate={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    );
    expectSharedHeader('Agregados');
  });
});
