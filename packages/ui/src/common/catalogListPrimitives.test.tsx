/**
 * F020 — SearchInput, StatusChips, EmptyState, debounce.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmptyState } from './EmptyState';
import { SearchInput } from './SearchInput';
import { StatusChips } from './StatusChips';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from './useDebouncedValue';
import type { CatalogStatusFilter } from '../catalogs/catalogHelpers';

const here = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

function SearchHarness({
  onDebounced,
}: {
  onDebounced?: (v: string) => void;
}): ReactNode {
  const [value, setValue] = useState('');
  return (
    <SearchInput
      value={value}
      onChange={setValue}
      onDebouncedChange={onDebounced}
      placeholder="Buscar materiales…"
      aria-label="Buscar materiales"
    />
  );
}

function DebounceProbe({ value }: { value: string }): ReactNode {
  const debounced = useDebouncedValue(value);
  return <span data-testid="debounced">{debounced}</span>;
}

function ChipsHarness(): ReactNode {
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  return (
    <div>
      <StatusChips value={status} onChange={setStatus} />
      <span data-testid="status">{status}</span>
    </div>
  );
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SEARCH_DEBOUNCE_MS', () => {
  it('is 150ms per design.md §4.6', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(150);
  });
});

describe('useDebouncedValue', () => {
  it('updates after debounce delay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender } = render(<DebounceProbe value="a" />);
    expect(screen.getByTestId('debounced').textContent).toBe('a');

    rerender(<DebounceProbe value="ab" />);
    expect(screen.getByTestId('debounced').textContent).toBe('a');

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 1);
    });
    expect(screen.getByTestId('debounced').textContent).toBe('ab');
  });
});

describe('SearchInput', () => {
  it('renders placeholder and Lucide search affordance', () => {
    render(<SearchHarness />);
    expect(screen.getByPlaceholderText('Buscar materiales…')).toBeTruthy();
    expect(screen.getByLabelText('Buscar materiales')).toBeTruthy();
  });

  it('calls onDebouncedChange after ~150ms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDebounced = vi.fn();
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
    render(<SearchHarness onDebounced={onDebounced} />);

    await user.type(screen.getByLabelText('Buscar materiales'), 'ara');

    // Intermediate keystrokes should not yet settle on full query
    // until debounce fires after last char.
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 1);
    });
    expect(onDebounced).toHaveBeenLastCalledWith('ara');
  });

  it('clear button resets value', async () => {
    const user = userEvent.setup();
    render(<SearchHarness />);
    const input = screen.getByLabelText('Buscar materiales') as HTMLInputElement;
    await user.type(input, 'x');
    expect(input.value).toBe('x');
    await user.click(screen.getByLabelText('Limpiar búsqueda'));
    expect(input.value).toBe('');
  });
});

describe('StatusChips', () => {
  it('exposes Todos / Activos / Inactivos and toggles value', async () => {
    const user = userEvent.setup();
    render(<ChipsHarness />);
    expect(screen.getByRole('button', { name: 'Todos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inactivos' })).toBeTruthy();
    expect(screen.getByTestId('status').textContent).toBe('active');

    await user.click(screen.getByRole('button', { name: 'Inactivos' }));
    expect(screen.getByTestId('status').textContent).toBe('inactive');
    expect(
      screen.getByRole('button', { name: 'Inactivos' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('EmptyState', () => {
  it('shows Lucide icon, title, and CTA', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        icon={Layers}
        title="No hay materiales"
        description="Agregá el primero."
        actionLabel="Agregar material"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('No hay materiales')).toBeTruthy();
    expect(screen.getByText('Agregá el primero.')).toBeTruthy();
    expect(screen.getByTestId('empty-state').getAttribute('data-variant')).toBe(
      'empty',
    );
    await user.click(screen.getByRole('button', { name: /Agregar material/ }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('no-results variant clears filters without a plus icon', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        variant="no-results"
        title="Sin resultados"
        description="No hay ítems que coincidan."
        actionLabel="Limpiar filtros"
        onAction={onAction}
      />,
    );
    expect(screen.getByTestId('empty-state-no-results')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /^Limpiar filtros$/ });
    expect(btn.className).not.toMatch(/btn--primary/);
    await user.click(btn);
    expect(onAction).toHaveBeenCalledOnce();
  });
});

describe('catalog list CSS guards (F020)', () => {
  it('hover-reveals row actions without permanent Acciones header text', () => {
    const css = read('../catalogs/catalogs.css');
    expect(css).toMatch(/catalog-table__row:hover \.catalog-table__actions/);
    expect(css).toMatch(/opacity:\s*0/);
  });

  it('sticky column headers on catalog table scrollport (issue #56)', () => {
    const css = read('../catalogs/catalogs.css');
    expect(css).toMatch(/\.catalog-table-wrap\s*\{[^}]*overflow:\s*auto/s);
    expect(css).toMatch(/\.catalog-table-wrap\s*\{[^}]*max-height:/s);
    expect(css).toMatch(
      /\.catalog-table th\s*\{[^}]*position:\s*sticky/s,
    );
    expect(css).toMatch(/\.catalog-table th\s*\{[^}]*top:\s*0/s);
    expect(css).toMatch(/border-collapse:\s*separate/);
  });

  it('catalog layout is single-column (no permanent side form grid)', () => {
    const css = read('../catalogs/catalogs.css');
    expect(css).not.toMatch(
      /catalog-layout\s*\{[^}]*grid-template-columns:\s*minmax/,
    );
  });

  it('materials catalog uses Modal size sm and StatusChips', () => {
    const src = read('../catalogs/MaterialsCatalog.tsx');
    expect(src).toMatch(/size="sm"/);
    expect(src).toMatch(/StatusChips/);
    expect(src).toMatch(/EmptyState/);
    expect(src).toMatch(/useDebouncedValue/);
    expect(src).not.toMatch(/Mostrar inactivos/);
  });

  it('#14: materials catalog does not import domain cost formula', () => {
    const src = read('../catalogs/MaterialsCatalog.tsx');
    expect(src).not.toMatch(/calcMaterialCostPerM2/);
    expect(src).toMatch(/getCostPerM2/);
    expect(src).toMatch(/catalog-form__calculated-value/);
    expect(src).not.toMatch(/style=\{\{/);
  });
});

describe('SearchInput debounce constant alignment', () => {
  it('SearchInput defaults debounce to SEARCH_DEBOUNCE_MS', async () => {
    const src = read('./SearchInput.tsx');
    expect(src).toMatch(/SEARCH_DEBOUNCE_MS/);
    await waitFor(() => {
      expect(SEARCH_DEBOUNCE_MS).toBe(150);
    });
  });
});
