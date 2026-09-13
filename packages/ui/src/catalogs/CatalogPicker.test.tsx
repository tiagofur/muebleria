/**
 * Searchable CatalogPicker (issue #27).
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { Modal } from '../common';
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

/** Controlled form mirroring ProjectAddItemModal: picker → Cantidad → submit. */
function FormHarness({
  initial = '',
  onChange,
  onSubmit,
  unmountOnSelect = false,
}: {
  initial?: string;
  onChange: (id: string) => void;
  onSubmit: () => void;
  unmountOnSelect?: boolean;
}): ReactNode {
  const [value, setValue] = useState(initial);
  const [mounted, setMounted] = useState(true);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {mounted ? (
        <CatalogPicker
          id="form-picker"
          label="Herraje"
          items={items}
          value={value}
          onChange={(id) => {
            setValue(id);
            onChange(id);
            if (unmountOnSelect) setMounted(false);
          }}
          placeholder="Seleccionar herraje…"
          searchPlaceholder="Buscar herraje…"
        />
      ) : (
        <p>Selector no disponible</p>
      )}
      <div>
        <label htmlFor="form-qty">Cantidad</label>
        <input id="form-qty" type="number" min={1} defaultValue={1} />
      </div>
      <button type="submit">Enviar</button>
    </form>
  );
}

function ModalHarness({ onClose }: { onClose: () => void }): ReactNode {
  const [value, setValue] = useState('');
  return (
    <Modal open onClose={onClose} title="Agregar mueble">
      <form onSubmit={(e) => e.preventDefault()}>
        <CatalogPicker
          id="modal-picker"
          label="Herraje"
          items={items}
          value={value}
          onChange={setValue}
          placeholder="Seleccionar herraje…"
          searchPlaceholder="Buscar herraje…"
        />
        <div>
          <label htmlFor="modal-qty">Cantidad</label>
          <input id="modal-qty" type="number" min={1} defaultValue={1} />
        </div>
      </form>
    </Modal>
  );
}

function TwoPickerHarness(): ReactNode {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <CatalogPicker
        id="picker-first"
        label="Herraje primero"
        items={items}
        value={first}
        onChange={setFirst}
        searchPlaceholder="Buscar primero…"
      />
      <CatalogPicker
        id="picker-second"
        label="Herraje segundo"
        items={items}
        value={second}
        onChange={setSecond}
        searchPlaceholder="Buscar segundo…"
      />
    </form>
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
    expect(screen.getByLabelText('Herraje').textContent).toBe(
      'HW-02 — Corredera',
    );
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

describe('CatalogPicker — foco y activación por teclado', () => {
  it('al seleccionar por teclado: ID exacto, onChange único, foco en el selector y Tab continúa a Cantidad', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<FormHarness onChange={onChange} onSubmit={onSubmit} />);

    await user.click(screen.getByLabelText('Herraje'));
    await user.type(
      screen.getByLabelText('Buscar herraje…'),
      '{ArrowDown}{Enter}',
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();

    const trigger = screen.getByLabelText('Herraje');
    expect(trigger).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText('Cantidad')).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('al seleccionar por ratón: onChange único y foco recuperado en el selector', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<FormHarness onChange={onChange} onSubmit={onSubmit} />);

    await user.click(screen.getByLabelText('Herraje'));
    await user.click(screen.getByRole('option', { name: /HW-02/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Herraje')).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Escape desde el buscador conserva el valor, no llama onChange y devuelve el foco', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <FormHarness initial="a" onChange={onChange} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByLabelText('Herraje'));
    await user.type(screen.getByLabelText('Buscar herraje…'), 'corr');
    await user.keyboard('{Escape}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Herraje').textContent).toContain('HW-01');
    expect(screen.getByLabelText('Herraje')).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('dentro del Modal real: el primer Escape cierra sólo la lista y el segundo cierra el modal', async () => {
    const user = userEvent.setup();
    const onModalClose = vi.fn();
    render(<ModalHarness onClose={onModalClose} />);

    await user.click(screen.getByLabelText('Herraje'));
    await user.type(screen.getByLabelText('Buscar herraje…'), 'bis');
    await user.keyboard('{Escape}');

    expect(onModalClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Herraje')).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Agregar mueble' })).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(onModalClose).toHaveBeenCalledTimes(1);
  });

  it('Quitar selección con Enter: una sola llamada a onChange vacío, sin submit', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <FormHarness initial="a" onChange={onChange} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByLabelText('Herraje'));
    await waitFor(() => {
      expect(screen.getByLabelText('Buscar herraje…')).toHaveFocus();
    });
    await user.tab();
    const clear = screen.getByRole('button', { name: /Quitar selección/i });
    expect(clear).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Herraje')).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Quitar selección con Espacio: una sola llamada a onChange vacío, sin submit', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <FormHarness initial="a" onChange={onChange} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByLabelText('Herraje'));
    await waitFor(() => {
      expect(screen.getByLabelText('Buscar herraje…')).toHaveFocus();
    });
    await user.tab();
    await user.keyboard(' ');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Herraje')).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Quitar selección con ratón: una sola llamada a onChange vacío y foco en el selector', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <FormHarness initial="a" onChange={onChange} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByLabelText('Herraje'));
    await user.click(
      screen.getByRole('button', { name: /Quitar selección/i }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Herraje')).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Escape con el foco en Quitar selección cierra la lista sin onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FormHarness initial="a" onChange={onChange} onSubmit={vi.fn()} />,
    );

    await user.click(screen.getByLabelText('Herraje'));
    await waitFor(() => {
      expect(screen.getByLabelText('Buscar herraje…')).toHaveFocus();
    });
    await user.tab();
    expect(
      screen.getByRole('button', { name: /Quitar selección/i }),
    ).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Herraje')).toHaveFocus();
  });

  it('clic exterior en otro campo cierra la lista sin robar el foco', async () => {
    const user = userEvent.setup();
    render(
      <FormHarness initial="a" onChange={vi.fn()} onSubmit={vi.fn()} />,
    );

    await user.click(screen.getByLabelText('Herraje'));
    const qty = screen.getByLabelText('Cantidad');
    await user.click(qty);

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(qty).toHaveFocus();
    expect(screen.getByLabelText('Herraje')).not.toHaveFocus();
  });

  it('al abrir un segundo selector, el primero no recupera el foco', async () => {
    const user = userEvent.setup();
    render(<TwoPickerHarness />);

    const firstTrigger = screen.getByRole('button', {
      name: 'Herraje primero',
    });
    const secondTrigger = screen.getByRole('button', {
      name: 'Herraje segundo',
    });

    await user.click(firstTrigger);
    expect(screen.getByLabelText('Buscar primero…')).toBeTruthy();

    await user.click(secondTrigger);

    expect(firstTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(secondTrigger.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => {
      expect(screen.getByLabelText('Buscar segundo…')).toHaveFocus();
    });
    expect(firstTrigger).not.toHaveFocus();
  });

  it('si onChange desmonta el selector, no hay refoco tardío ni robo de foco', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FormHarness
        onChange={onChange}
        onSubmit={vi.fn()}
        unmountOnSelect
      />,
    );

    await user.click(screen.getByLabelText('Herraje'));
    await user.type(
      screen.getByLabelText('Buscar herraje…'),
      '{ArrowDown}{Enter}',
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByLabelText('Herraje')).toBeNull();

    const qty = screen.getByLabelText('Cantidad');
    await user.click(qty);
    expect(qty).toHaveFocus();
    expect(screen.queryByLabelText('Herraje')).toBeNull();
  });
});
