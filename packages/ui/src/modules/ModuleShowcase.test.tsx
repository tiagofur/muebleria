/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Module, ModuleCategory } from '@granete/domain';
import { ModuleShowcase } from './ModuleShowcase';

afterEach(() => cleanup());

const categories: ModuleCategory[] = [
  { id: 'cat-cocina', name: 'Cocina', sortOrder: 1 },
  { id: 'cat-living', name: 'Living', sortOrder: 2 },
];

const sample: Module = {
  id: 'm1',
  code: 'MOD-GAB-01',
  name: 'Gabinete',
  categoryId: 'cat-cocina',
  imageUrl: '/api/media/abc.webp',
  externalDims: { width: 600, height: 720, depth: 550 },
  hardwareLines: [],
};

const living: Module = {
  id: 'm2',
  code: 'MOD-X',
  name: 'Sin foto living',
  categoryId: 'cat-living',
  imageUrl: undefined,
  hardwareLines: [],
};

describe('ModuleShowcase (F040 / F043 redesign)', () => {
  it('renders photo-first cards: name dominant, image or placeholder', () => {
    render(<ModuleShowcase modules={[sample, living]} />);
    // F105: page title lives in ShowcaseScreen; tab content has no page-header.
    expect(screen.queryByTestId('page-header')).toBeNull();
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.getByTestId('showcase-card-m1')).toBeTruthy();
    expect(screen.getByTestId('catalog-image')).toBeTruthy();
    expect(screen.getByTestId('catalog-image-placeholder')).toBeTruthy();
    expect(screen.getByText('Gabinete')).toBeTruthy();
    expect(screen.getAllByText(/600/).length).toBeGreaterThan(0);
    // No primary CTA on cards — browse only
    expect(screen.queryByTestId('showcase-use-m1')).toBeNull();
  });

  it('filters by category chip (F043)', async () => {
    const user = userEvent.setup();
    render(
      <ModuleShowcase
        modules={[sample, living]}
        categories={categories}
      />,
    );
    expect(screen.getByTestId('showcase-category-filters')).toBeTruthy();
    expect(screen.getByTestId('showcase-card-m1')).toBeTruthy();
    expect(screen.getByTestId('showcase-card-m2')).toBeTruthy();

    await user.click(screen.getByTestId('showcase-filter-cat-cocina'));
    expect(screen.getByTestId('showcase-card-m1')).toBeTruthy();
    expect(screen.queryByTestId('showcase-card-m2')).toBeNull();
  });

  it('opens read-only detail and fires Usar en cotización only from detail', async () => {
    const user = userEvent.setup();
    const onUseInQuote = vi.fn();
    render(
      <ModuleShowcase
        modules={[sample]}
        categories={categories}
        onUseInQuote={onUseInQuote}
      />,
    );

    expect(screen.queryByTestId('showcase-use-m1')).toBeNull();

    await user.click(screen.getByTestId('showcase-card-open-m1'));
    const detail = screen.getByTestId('showcase-detail');
    expect(detail).toBeTruthy();
    expect(detail.textContent).toContain('MOD-GAB-01');
    expect(detail.textContent).toMatch(/solo lectura/i);

    await user.click(screen.getByTestId('showcase-detail-use'));
    expect(onUseInQuote).toHaveBeenCalledTimes(1);
    expect(onUseInQuote).toHaveBeenCalledWith('m1');
  });

  it('hides quote CTA in detail when onUseInQuote is omitted', async () => {
    const user = userEvent.setup();
    render(<ModuleShowcase modules={[sample]} categories={categories} />);
    await user.click(screen.getByTestId('showcase-card-open-m1'));
    expect(screen.getByTestId('showcase-detail')).toBeTruthy();
    expect(screen.queryByTestId('showcase-detail-use')).toBeNull();
  });
});

function makeModule(
  id: string,
  name: string,
  categoryId: string | undefined,
  code: string,
): Module {
  return { id, code, name, categoryId, imageUrl: undefined, hardwareLines: [] };
}

const cocinaGabinete = makeModule('c1', 'Gabinete', 'cat-cocina', 'MOD-GAB-01');
const cocinaBajo = makeModule('c2', 'Bajo mesada', 'cat-cocina', 'MOD-BM-02');
const cocinaAlacena = makeModule('c3', 'Alacena', 'cat-cocina', 'MOD-AL-03');
const livingBiblioteca = makeModule(
  'l1',
  'Biblioteca living',
  'cat-living',
  'MOD-LIV-04',
);
const catalogModules = [
  cocinaGabinete,
  cocinaBajo,
  cocinaAlacena,
  livingBiblioteca,
];

function summaryText(): string {
  return screen.getByTestId('showcase-results-summary').textContent ?? '';
}

function pressedState(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute('aria-pressed');
}

describe('ModuleShowcase filter clarity (summary + clear + aria-pressed)', () => {
  it('shows the total count without filters and no Limpiar filtros action', () => {
    render(<ModuleShowcase modules={catalogModules} categories={categories} />);
    expect(summaryText()).toBe('4 muebles');
    expect(
      screen.queryAllByRole('button', { name: 'Limpiar filtros' }),
    ).toHaveLength(0);
  });

  it('respects singular/plural in the summary', async () => {
    const user = userEvent.setup();
    render(<ModuleShowcase modules={[sample]} categories={categories} />);
    expect(summaryText()).toBe('1 mueble');

    await user.click(screen.getByTestId('showcase-filter-cat-cocina'));
    await waitFor(() => expect(summaryText()).toBe('Mostrando 1 de 1 mueble'));
  });

  it('category filter updates rows, summary and aria-pressed coherently', async () => {
    const user = userEvent.setup();
    render(
      <ModuleShowcase modules={catalogModules} categories={categories} />,
    );

    await user.click(screen.getByTestId('showcase-filter-cat-cocina'));
    await waitFor(() => expect(summaryText()).toBe('Mostrando 3 de 4 muebles'));
    expect(screen.getByTestId('showcase-card-c1')).toBeTruthy();
    expect(screen.getByTestId('showcase-card-c2')).toBeTruthy();
    expect(screen.getByTestId('showcase-card-c3')).toBeTruthy();
    expect(screen.queryByTestId('showcase-card-l1')).toBeNull();

    expect(pressedState('showcase-filter-all')).toBe('false');
    expect(pressedState('showcase-filter-cat-cocina')).toBe('true');
    expect(pressedState('showcase-filter-cat-living')).toBe('false');

    // Recovery is available even with results on screen.
    expect(screen.getByTestId('showcase-clear-filters')).toBeTruthy();
  });

  it('exposes aria-pressed on Sin categoría when that chip is shown', async () => {
    const user = userEvent.setup();
    const uncategorized = makeModule(
      'u1',
      'Sueltos varios',
      undefined,
      'MOD-SUELTOS',
    );
    render(
      <ModuleShowcase
        modules={[sample, uncategorized]}
        categories={categories}
      />,
    );

    await user.click(screen.getByTestId('showcase-filter-uncategorized'));
    await waitFor(() => expect(summaryText()).toBe('Mostrando 1 de 2 muebles'));
    expect(screen.getByTestId('showcase-card-u1')).toBeTruthy();
    expect(screen.queryByTestId('showcase-card-m1')).toBeNull();
    expect(pressedState('showcase-filter-uncategorized')).toBe('true');
    expect(pressedState('showcase-filter-all')).toBe('false');
  });

  it('combines search with category and narrows the summary', async () => {
    const user = userEvent.setup();
    render(
      <ModuleShowcase modules={catalogModules} categories={categories} />,
    );

    await user.click(screen.getByTestId('showcase-filter-cat-cocina'));
    await waitFor(() => expect(summaryText()).toBe('Mostrando 3 de 4 muebles'));

    await user.type(screen.getByRole('searchbox'), 'gab');
    await waitFor(() => expect(summaryText()).toBe('Mostrando 1 de 4 muebles'));
    expect(screen.getByTestId('showcase-card-c1')).toBeTruthy();
    expect(screen.queryByTestId('showcase-card-c2')).toBeNull();
    expect(screen.queryByTestId('showcase-card-l1')).toBeNull();
  });

  it('Limpiar filtros restores search, category and full results', async () => {
    const user = userEvent.setup();
    render(
      <ModuleShowcase modules={catalogModules} categories={categories} />,
    );

    await user.click(screen.getByTestId('showcase-filter-cat-cocina'));
    await user.type(screen.getByRole('searchbox'), 'gab');
    await waitFor(() => expect(summaryText()).toBe('Mostrando 1 de 4 muebles'));

    await user.click(screen.getByTestId('showcase-clear-filters'));
    await waitFor(() => expect(summaryText()).toBe('4 muebles'));
    expect(
      (screen.getByRole('searchbox') as HTMLInputElement).value,
    ).toBe('');
    expect(pressedState('showcase-filter-all')).toBe('true');
    expect(pressedState('showcase-filter-cat-cocina')).toBe('false');
    for (const id of ['c1', 'c2', 'c3', 'l1']) {
      expect(screen.getByTestId(`showcase-card-${id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('showcase-clear-filters')).toBeNull();
  });

  it('zero matches keeps the explanation and exactly one Limpiar filtros', async () => {
    const user = userEvent.setup();
    render(
      <ModuleShowcase modules={catalogModules} categories={categories} />,
    );

    await user.type(screen.getByRole('searchbox'), 'zzzz-sin-coincidencia');
    await waitFor(() =>
      expect(screen.getByTestId('empty-state-no-results')).toBeTruthy(),
    );
    expect(screen.getByText('Sin resultados')).toBeTruthy();
    expect(summaryText()).toBe('Mostrando 0 de 4 muebles');
    // Only the EmptyState recovery action — no duplicate next to the summary.
    expect(screen.queryByTestId('showcase-clear-filters')).toBeNull();
    expect(
      screen.getAllByRole('button', { name: 'Limpiar filtros' }),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole('button', { name: 'Limpiar filtros' }),
    );
    await waitFor(() => expect(summaryText()).toBe('4 muebles'));
    expect(screen.queryByTestId('empty-state-no-results')).toBeNull();
  });

  it('empty catalog keeps its own state without a summary line', () => {
    render(<ModuleShowcase modules={[]} categories={categories} />);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No hay muebles en el catálogo')).toBeTruthy();
    expect(screen.queryByTestId('empty-state-no-results')).toBeNull();
    expect(screen.queryByTestId('showcase-results-summary')).toBeNull();
  });

  it('filtering and clearing never select a mueble nor start a quote', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onUseInQuote = vi.fn();
    render(
      <ModuleShowcase
        modules={catalogModules}
        categories={categories}
        onSelect={onSelect}
        onUseInQuote={onUseInQuote}
      />,
    );

    await user.click(screen.getByTestId('showcase-filter-cat-cocina'));
    await waitFor(() => expect(summaryText()).toBe('Mostrando 3 de 4 muebles'));
    await user.type(screen.getByRole('searchbox'), 'gab');
    await waitFor(() => expect(summaryText()).toBe('Mostrando 1 de 4 muebles'));
    await user.click(screen.getByTestId('showcase-clear-filters'));
    await waitFor(() => expect(summaryText()).toBe('4 muebles'));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onUseInQuote).not.toHaveBeenCalled();
  });
});
