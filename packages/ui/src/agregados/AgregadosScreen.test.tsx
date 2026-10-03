/**
 * @vitest-environment jsdom
 *
 * S1 #1009 — the delete flow is gated by ConfirmDialog at screen level:
 * detail requests it («Más ▾» → Eliminar), the screen confirms with
 * code + name + consequence, and only then calls onDelete.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agregado } from '@granete/domain';
import { AgregadosScreen } from './AgregadosScreen';

const mockAgregado: Agregado = {
  id: 'agr-1',
  code: 'AGR-01',
  name: 'Puerta Batiente',
  externalDims: { width: 600, height: 2000, depth: 18 },
  components: [],
  hardwareLines: [],
};

function renderScreen(overrides: Partial<Parameters<typeof AgregadosScreen>[0]> = {}) {
  return render(
    <AgregadosScreen
      agregados={[mockAgregado]}
      catalogComponents={[]}
      catalogHardware={[]}
      onCreate={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      canMutate={true}
      openAgregadoId="agr-1"
      {...overrides}
    />,
  );
}

describe('AgregadosScreen — delete confirmation (S1 #1009)', () => {
  afterEach(() => {
    cleanup();
  });

  it('asks for confirmation with code + name and consequence before deleting', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderScreen({ onDelete });

    // Detail is open; delete lives behind «Más ▾».
    expect(screen.getByTestId('agregado-detail-chrome')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Más$/i }));
    await user.click(screen.getByRole('menuitem', { name: /Eliminar/i }));

    const dialog = screen.getByTestId('agregado-delete-confirm');
    expect(dialog.textContent).toContain('AGR-01 — Puerta Batiente');
    expect(dialog.textContent).toContain('no se puede deshacer');

    // Cancel keeps the agregado.
    await user.click(screen.getByRole('button', { name: /^Cancelar$/i }));
    expect(onDelete).not.toHaveBeenCalled();

    // Confirming calls onDelete exactly once with the id.
    await user.click(screen.getByRole('button', { name: /^Más$/i }));
    await user.click(screen.getByRole('menuitem', { name: /Eliminar/i }));
    await user.click(screen.getByTestId('agregado-delete-confirm-confirm'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('agr-1');
  });

  it('does not render the confirm dialog without a delete request', () => {
    renderScreen();
    expect(screen.queryByTestId('agregado-delete-confirm')).toBeNull();
  });
});

describe('AgregadosScreen — editor header identity (S2 #1009)', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows saved code + saved name in the editor header, stable while editing', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByTestId('agregado-detail-edit'));
    const page = await screen.findByTestId('agregado-editor-page');

    // Owner's idea (#1009 I2): the ID is followed by the item name, and the
    // header identity comes from the saved item, not the live draft.
    expect(within(page).getByText('Editar agregado — Puerta Batiente')).toBeTruthy();
    expect(within(page).getByText('AGR-01')).toBeTruthy();

    const codeInput = within(page).getByLabelText('Código') as HTMLInputElement;
    expect(codeInput.value).toBe('AGR-01');
    await user.clear(codeInput);
    await user.type(codeInput, 'AGR-09');

    // The header identity does not flicker while the fields are edited.
    expect(within(page).getByText('AGR-01')).toBeTruthy();
    expect(within(page).getByText('Editar agregado — Puerta Batiente')).toBeTruthy();
  });

  it('shows the plain create title without identity when creating', async () => {
    const user = userEvent.setup();
    renderScreen({ openAgregadoId: null });

    await user.click(screen.getByRole('button', { name: /Nuevo agregado/i }));
    const page = await screen.findByTestId('agregado-editor-page');
    expect(within(page).getByText('Nuevo agregado')).toBeTruthy();
    expect(within(page).getByText('NUEVO')).toBeTruthy();
  });
});
