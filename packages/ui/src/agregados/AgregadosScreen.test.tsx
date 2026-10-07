/**
 * @vitest-environment jsdom
 *
 * S1 #1009 — the delete flow is gated by ConfirmDialog at screen level:
 * detail requests it («Más ▾» → Eliminar), the screen confirms with
 * code + name + consequence, and only then calls onDelete.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
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

// The editor draft persists in sessionStorage keyed by entity id — clear it so
// tests don't inherit each other's drafts.
function cleanDraftStorage() {
  sessionStorage.clear();
  cleanup();
}

describe('AgregadosScreen — delete confirmation (S1 #1009)', () => {
  afterEach(cleanDraftStorage);

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

describe('AgregadosScreen — guardado con placement sin identidad (#1147)', () => {
  afterEach(cleanDraftStorage);

  const brokenAgregado: Agregado = {
    id: 'agr-broken',
    code: 'AGR-BROKEN',
    name: 'Puerta Rota',
    externalDims: { width: 600, height: 2000, depth: 18 },
    components: [
      {
        componentId: 'comp-1',
        quantity: 1,
        overrides: {
          hardwarePlacements: [
            { anchorFace: 'front', relativePosition: { xMm: 10, yMm: 20 } },
          ],
        },
      },
    ],
    hardwareLines: [],
  };

  it('blocks the save, names the piece and jumps to the Herrajes tab', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn(() => Promise.resolve());
    renderScreen({ agregados: [brokenAgregado], openAgregadoId: 'agr-broken', onUpdate, catalogComponents: [
      { id: 'comp-1', code: 'AGR-PUERTA', name: 'Puerta', placement: 'interno', geometry: { kind: 'rectangular_board', lengthMm: 100, widthMm: 100, thicknessMm: 18 }, defaultEdges: [], optionRoles: [], active: true },
    ] });

    await user.click(screen.getByTestId('agregado-detail-edit'));
    await screen.findByTestId('agregado-editor-page');
    await user.click(screen.getByTestId('agregado-save-btn'));

    // Blocked BEFORE any backend call, with the offending piece named and
    // the Herrajes tab surfaced (the invalid row is visible in its editor).
    expect(onUpdate).not.toHaveBeenCalled();
    const error = screen.getByTestId('form-error');
    expect(error.textContent).toContain('AGR-PUERTA — Puerta');
    expect(error.textContent).toContain('sin identidad');
    expect(screen.getByTestId('agregado-hardware-placements')).toBeTruthy();
    expect(screen.getByTestId('instance-hardware-placement-0-hw-pc-0-identity-error')).toBeTruthy();

    // The editor stays open: nothing was stored.
    expect(screen.getByTestId('agregado-editor-page')).toBeTruthy();
  });

  it('saves normally once every placement carries an identity', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn(() => Promise.resolve());
    const fixed: Agregado = {
      ...brokenAgregado,
      components: [
        {
          componentId: 'comp-1',
          quantity: 1,
          overrides: {
            hardwarePlacements: [
              { optionRole: 'BISAGRA', anchorFace: 'front', relativePosition: { xMm: 10, yMm: 20 } },
            ],
          },
        },
      ],
    };
    renderScreen({ agregados: [fixed], openAgregadoId: 'agr-broken', onUpdate, catalogComponents: [
      { id: 'comp-1', code: 'AGR-PUERTA', name: 'Puerta', placement: 'interno', geometry: { kind: 'rectangular_board', lengthMm: 100, widthMm: 100, thicknessMm: 18 }, defaultEdges: [], optionRoles: [], active: true },
    ] });

    await user.click(screen.getByTestId('agregado-detail-edit'));
    await screen.findByTestId('agregado-editor-page');
    await user.click(screen.getByTestId('agregado-save-btn'));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('agregado-editor-page')).toBeNull();
  });
});

describe('AgregadosScreen — editor header identity (S2 #1009)', () => {
  afterEach(cleanDraftStorage);

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

describe('AgregadosScreen — save contract (S3 #1009)', () => {
  afterEach(cleanDraftStorage);

  it('opens the editor for the selected item', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByTestId('agregado-detail-edit'));
    expect(await screen.findByTestId('agregado-editor-page')).toBeTruthy();
  });

  it('keeps the editor open with the draft and shows a banner when the save fails', async () => {
    const user = userEvent.setup();
    let rejectSave!: (err: Error) => void;
    const onUpdate = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    renderScreen({ onUpdate });

    await user.click(screen.getByTestId('agregado-detail-edit'));
    await screen.findByTestId('agregado-editor-page');

    await user.click(screen.getByTestId('agregado-save-btn'));

    // In flight: Guardar busy + disabled, Cancelar locked.
    const saveBtn = screen.getByTestId('agregado-save-btn') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    expect(saveBtn.textContent).toContain('Guardando');
    expect(
      (screen.getByTestId('agregado-editor-cancel') as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      rejectSave(new Error('network down'));
    });

    // Rejected: editor stays open, draft intact, banner visible, controls back.
    expect(screen.getByTestId('agregado-editor-page')).toBeTruthy();
    expect(screen.getByTestId('agregado-editor-save-error').textContent).toContain(
      'No se pudo guardar',
    );
    expect(
      (screen.getByLabelText('Código') as HTMLInputElement).value,
    ).toBe('AGR-01');
    expect((screen.getByTestId('agregado-save-btn') as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('closes the editor only after the save settles successfully', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn(() => Promise.resolve());
    renderScreen({ onUpdate });

    await user.click(screen.getByTestId('agregado-detail-edit'));
    await screen.findByTestId('agregado-editor-page');
    await user.click(screen.getByTestId('agregado-save-btn'));

    await waitFor(() =>
      expect(screen.queryByTestId('agregado-editor-page')).toBeNull(),
    );
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('agregado-editor-save-error')).toBeNull();
  });
});
