/**
 * Searchable CatalogPicker (issue #27).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import {
  CatalogPicker,
  formatCatalogPickerLabel,
  type CatalogPickerOption,
} from './CatalogPicker';

const items: CatalogPickerOption[] = [
  { id: 'a', code: 'HW-01', name: 'Bisagra', active: true },
  { id: 'b', code: 'HW-02', name: 'Corredera', active: true },
  { id: 'c', code: 'HW-03', name: 'Tirador', active: false },
  {
    id: 'd',
    code: 'HW-04',
    name: 'Pata',
    active: true,
    subtitle: 'Acero 100mm',
  },
];

function Harness({
  initial = '',
  includeInactive,
}: {
  initial?: string;
  includeInactive?: boolean;
}): ReactNode {
  const [value, setValue] = useState(initial);
  return (
    <CatalogPicker
      id="hw-picker"
      label="Herraje"
      items={items}
      value={value}
      onChange={setValue}
      includeInactive={includeInactive}
      placeholder="Seleccionar herraje…"
      searchPlaceholder="Buscar herraje…"
    />
  );
}

afterEach(() => {
  cleanup();
});

describe('formatCatalogPickerLabel', () => {
  it('formats code — name and inactive suffix', () => {
    expect(
      formatCatalogPickerLabel({
        id: 'x',
        code: 'A',
        name: 'Uno',
        active: true,
      }),
    ).toBe('A — Uno');
    expect(
      formatCatalogPickerLabel({
        id: 'y',
        code: '',
        name: 'Cliente',
        active: false,
      }),
    ).toBe('Cliente (inactivo)');
  });
});

describe('CatalogPicker', () => {
  it('hides inactive by default and filters by code/name', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Herraje'));
    const list = screen.getByRole('listbox');
    expect(within(list).getByRole('option', { name: /HW-01/i })).toBeTruthy();
    expect(within(list).queryByRole('option', { name: /HW-03/i })).toBeNull();

    await user.type(screen.getByLabelText('Buscar herraje…'), 'corr');
    expect(within(list).getByRole('option', { name: /Corredera/i })).toBeTruthy();
    expect(within(list).queryByRole('option', { name: /Bisagra/i })).toBeNull();
  });

  it('selects option and shows label on trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Herraje'));
    await user.click(screen.getByRole('option', { name: /HW-02/i }));
    expect(screen.getByLabelText('Herraje').textContent).toMatch(/HW-02/);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps current inactive value visible when selected', async () => {
    const user = userEvent.setup();
    render(<Harness initial="c" />);

    expect(screen.getByLabelText('Herraje').textContent).toMatch(/inactivo/);
    await user.click(screen.getByLabelText('Herraje'));
    expect(screen.getByRole('option', { name: /HW-03/i })).toBeTruthy();
  });

  it('supports keyboard navigation Enter to select', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Herraje'));
    const search = screen.getByLabelText('Buscar herraje…');
    await user.type(search, '{ArrowDown}{Enter}');
    expect(screen.getByLabelText('Herraje').textContent).toMatch(/HW-02|HW-01/);
  });

  it('filters by subtitle', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Herraje'));
    await user.type(screen.getByLabelText('Buscar herraje…'), '100mm');
    expect(screen.getByRole('option', { name: /Pata/i })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Bisagra/i })).toBeNull();
  });

  it('calls onChange empty via Quitar selección', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CatalogPicker
        label="X"
        items={items}
        value="a"
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText('X'));
    await user.click(screen.getByRole('button', { name: /Quitar selección/i }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
