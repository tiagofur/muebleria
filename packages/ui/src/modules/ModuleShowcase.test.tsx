/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Module, ModuleCategory } from '@muebles/domain';
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
  boardParts: [],
  hardwareLines: [],
};

const living: Module = {
  id: 'm2',
  code: 'MOD-X',
  name: 'Sin foto living',
  categoryId: 'cat-living',
  imageUrl: undefined,
  boardParts: [],
  hardwareLines: [],
};

describe('ModuleShowcase (F040 / F043)', () => {
  it('renders card with image and placeholder for missing photo', () => {
    render(<ModuleShowcase modules={[sample, living]} />);
    expect(screen.getByText('Vitrina de muebles')).toBeTruthy();
    expect(screen.getByTestId('showcase-card-m1')).toBeTruthy();
    expect(screen.getByTestId('catalog-image')).toBeTruthy();
    expect(screen.getByTestId('catalog-image-placeholder')).toBeTruthy();
    expect(screen.getAllByText(/600/).length).toBeGreaterThan(0);
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

  it('opens read-only detail and fires Usar en cotización (F043)', async () => {
    const user = userEvent.setup();
    const onUseInQuote = vi.fn();
    render(
      <ModuleShowcase
        modules={[sample]}
        categories={categories}
        onUseInQuote={onUseInQuote}
      />,
    );

    expect(screen.getByTestId('showcase-use-m1').textContent).toMatch(
      /Usar en cotización/,
    );
    await user.click(screen.getByTestId('showcase-use-m1'));
    expect(onUseInQuote).toHaveBeenCalledWith('m1');

    await user.click(screen.getByTestId('showcase-card-open-m1'));
    const detail = screen.getByTestId('showcase-detail');
    expect(detail).toBeTruthy();
    expect(detail.textContent).toContain('MOD-GAB-01');
    expect(detail.textContent).toMatch(/solo lectura/i);

    await user.click(screen.getByTestId('showcase-detail-use'));
    expect(onUseInQuote).toHaveBeenCalledTimes(2);
  });
});
