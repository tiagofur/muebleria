/**
 * @vitest-environment jsdom
 *
 * #1460 — el kit comercial se elige en UNA superficie compartida por Herrajes
 * y Receta: sólo juegos reales (unit === 'set') y con feedback de sus partes.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hardware } from '@granete/domain';
import { KitCommercialPicker } from './KitCommercialPicker';

afterEach(() => {
  cleanup();
});

const PICKER_LABEL = 'Kit comercial (el juego que se vende junto)';

const hwFixture = [
  { id: 'hw-kit', code: 'CORR-KIT', name: 'Corredera Telescópica (juego)', active: true, unit: 'set' },
  { id: 'hw-pieza', code: 'CORR-MOV', name: 'Corredera móvil (parte)', active: true, unit: 'piece', kitHardwareId: 'hw-kit' },
  { id: 'hw-sueldo', code: 'TIR-200', name: 'Tirador 200mm', active: true, unit: 'piece' },
] as unknown as Hardware[];

function renderPicker(overrides?: { value?: string }) {
  const onChange = vi.fn();
  render(
    <KitCommercialPicker
      catalogHardware={hwFixture}
      value={overrides?.value ?? ''}
      onChange={onChange}
      label={PICKER_LABEL}
      id="kit-picker"
      testId="kit-picker"
    />,
  );
  return onChange;
}

async function openList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText(PICKER_LABEL));
  return screen.getByRole('listbox');
}

describe('KitCommercialPicker (#1460)', () => {
  it('sólo lista herrajes con unit === set (un tirador no es un juego)', async () => {
    const user = userEvent.setup();
    renderPicker();
    const list = await openList(user);
    expect(list.textContent).toContain('CORR-KIT');
    expect(list.textContent).not.toContain('TIR-200');
    expect(list.textContent).not.toContain('CORR-MOV');
  });

  it('con kit sin partes explica que se crean en Catálogos', () => {
    const solo = [{ id: 'hw-kit', code: 'CORR-KIT', name: 'Juego', active: true, unit: 'set' }] as unknown as Hardware[];
    render(
      <KitCommercialPicker
        catalogHardware={solo}
        value="hw-kit"
        onChange={vi.fn()}
        label="Kit"
        id="kit-picker"
        testId="kit-picker"
      />,
    );
    expect(screen.getByTestId('kit-picker-parts').textContent).toContain(
      'no tiene partes todavía',
    );
  });

  it('con kit y partes muestra cuántas agrupa y que se administran en Catálogos', () => {
    renderPicker({ value: 'hw-kit' });
    expect(screen.getByTestId('kit-picker-parts').textContent).toContain(
      'agrupa 1 herraje(s)',
    );
    expect(screen.getByTestId('kit-picker-parts').textContent).toContain(
      'Catálogos',
    );
  });

  it('sin kit mantiene la nota de que el kit cotiza una vez', () => {
    renderPicker();
    expect(screen.getByText(/cotiza una vez/)).toBeTruthy();
  });

  it('elegir un juego notifica el id', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    const list = await openList(user);
    await user.click(within(list).getByRole('option', { name: /CORR-KIT/ }));
    expect(onChange).toHaveBeenLastCalledWith('hw-kit');
  });

  it('quitar la selección notifica undefined', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker({ value: 'hw-kit' });

    const list = await openList(user);
    expect(list.textContent).toContain('CORR-KIT');
    await user.click(screen.getByRole('button', { name: 'Quitar selección' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
