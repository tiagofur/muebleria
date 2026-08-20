/**
 * HardwareCatalog behavior tests (F117: replaced the old source-grep tests
 * with real render + interaction flows).
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hardware } from '@muebles/domain';

import { HardwareCatalog } from './HardwareCatalog';

afterEach(cleanup);

const sampleHardware: Hardware = {
  id: 'hw-1',
  code: 'HER-JAL-INOX',
  name: 'Jaladera Acero Inox',
  unit: 'piece',
  costPerUnit: 45,
  active: true,
  previewShape: 'bar-pull',
  previewColor: '#c8ccd0',
  previewMetalness: 0.9,
  previewRoughness: 0.18,
  previewSizeMm: 128,
  previewDiameterMm: 12,
  previewProjectionMm: 28,
};

function setup(hardware: readonly Hardware[] = [sampleHardware]) {
  const onCreate = vi.fn();
  const onUpdate = vi.fn();
  render(
    <HardwareCatalog
      hardware={hardware}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDeactivate={vi.fn()}
      onReactivate={vi.fn()}
    />,
  );
  return { onCreate, onUpdate };
}

describe('HardwareCatalog — create flow', () => {
  it('opens the create modal from the header button and submits the draft', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup();

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    const modal = screen.getByTestId('hardware-form-modal');
    expect(modal).toBeTruthy();

    await user.type(screen.getByLabelText('Código'), 'HER-NUEVA');
    await user.type(screen.getByLabelText('Nombre'), 'Jaladera nueva');
    fireEvent.submit(modal.querySelector('form')!);

    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(draft.code).toBe('HER-NUEVA');
    expect(draft.name).toBe('Jaladera nueva');
  });

  it('rejects a duplicate code with a visible error (activos + inactivos)', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup();

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.type(screen.getByLabelText('Código'), sampleHardware.code);
    await user.type(screen.getByLabelText('Nombre'), 'Dup');
    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/Ya existe un ítem con el código/)).toBeTruthy();
  });
});

describe('HardwareCatalog — Maquinado CNC (F127)', () => {
  const machinedHardware: Hardware = {
    ...sampleHardware,
    id: 'hw-bis',
    code: 'HER-BIS-CL',
    name: 'Bisagra Cierre Lento',
    machining: {
      parts: [
        {
          id: 'cup',
          role: 'cup',
          operations: [
            {
              id: 'cup-35',
              kind: 'blind_hole',
              diameterMm: 35,
              depthMm: 12.5,
              xMm: 0,
              yMm: 0,
              face: 'anchor',
              label: 'Taza 35 mm',
            },
          ],
        },
      ],
    },
  };

  async function openEdit(
    user: ReturnType<typeof userEvent.setup>,
    item: Hardware,
  ) {
    await user.click(screen.getByText(item.code));
    await user.click(screen.getByRole('button', { name: `Editar ${item.code}` }));
  }

  it('auto-abre el disclosure al editar un herraje con maquinado y muestra sus operaciones', async () => {
    const user = userEvent.setup();
    setup([machinedHardware]);
    await openEdit(user, machinedHardware);

    expect(screen.getByTestId('hardware-machining-body')).toBeTruthy();
    expect(
      (screen.getByTestId('hardware-machining-role-0') as HTMLInputElement).value,
    ).toBe('cup');
    expect(
      (screen.getByTestId('hardware-machining-diameter-0-0') as HTMLInputElement)
        .value,
    ).toBe('35');
  });

  it('agregar una parte desde cero la incluye en el draft al guardar', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup([sampleHardware]);
    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.type(screen.getByLabelText('Código'), 'HER-NUEVA-2');
    await user.type(screen.getByLabelText('Nombre'), 'Otra pieza');

    await user.click(screen.getByTestId('hardware-machining-toggle'));
    await user.click(screen.getByTestId('hardware-machining-add-part'));
    await user.type(
      screen.getByTestId('hardware-machining-role-0'),
      'dowel',
    );
    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);

    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0]![0] as { machining?: unknown };
    expect(draft.machining).toMatchObject({
      parts: [
        {
          role: 'dowel',
          operations: [
            expect.objectContaining({ kind: 'blind_hole', diameterMm: 8 }),
          ],
        },
      ],
    });
  });

  it('bloquea el guardado con diámetro inválido y muestra el error del dominio', async () => {
    const user = userEvent.setup();
    const { onUpdate } = setup([machinedHardware]);
    await openEdit(user, machinedHardware);

    await user.clear(screen.getByTestId('hardware-machining-diameter-0-0'));
    await user.type(screen.getByTestId('hardware-machining-diameter-0-0'), '0');
    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(/diámetro mayor a 0/)).toBeTruthy();
  });

  it('quitar la última parte deja el herraje sin maquinado', async () => {
    const user = userEvent.setup();
    const { onUpdate } = setup([machinedHardware]);
    await openEdit(user, machinedHardware);

    await user.click(screen.getByRole('button', { name: /Quitar parte cup/i }));
    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const draft = onUpdate.mock.calls[0]![1] as { machining?: unknown };
    expect(draft.machining).toBeNull();
  });

  it('el detalle expandido muestra el resumen de maquinado', async () => {
    const user = userEvent.setup();
    setup([machinedHardware]);
    await user.click(screen.getByText(machinedHardware.code));

    expect(screen.getByText('1 parte · 1 perforación')).toBeTruthy();
  });
});

describe('HardwareCatalog — Vista 3D (F069/F080)', () => {
  async function openEditWithShape(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByText(sampleHardware.code));
    await user.click(
      screen.getByRole('button', { name: `Editar ${sampleHardware.code}` }),
    );
    // Disclosure auto-opens when the edited item has a configured shape.
    expect(screen.getByTestId('hardware-preview-3d-body')).toBeTruthy();
  }

  it('auto-opens the Vista 3D disclosure when editing an item with a shape (F117 reset fix)', async () => {
    const user = userEvent.setup();
    setup();
    await openEditWithShape(user);
    expect(
      (screen.getByTestId('hardware-form-shape') as HTMLSelectElement).value,
    ).toBe('bar-pull');
  });

  it('finish preset select is bound to the item values (chrome shows the matching preset)', async () => {
    const user = userEvent.setup();
    setup();
    await openEditWithShape(user);
    const finish = screen.getByTestId('hardware-form-finish') as HTMLSelectElement;
    // The sample values (#c8ccd0 + M.0.9/R 0.18, no clearcoat) do not match
    // any preset exactly → matchHardwareFinish correctly shows
    // "— Personalizado —" instead of a stale preset id.
    expect(finish.value).toBe('');
  });

  it('picking a preset applies its PBR values to the draft', async () => {
    const user = userEvent.setup();
    setup();
    await openEditWithShape(user);

    const finish = screen.getByTestId('hardware-form-finish') as HTMLSelectElement;
    await user.selectOptions(finish, 'black-matte');
    expect((screen.getByTestId('hardware-form-color') as HTMLInputElement).value)
      .toBe('#1a1a1a');
  });

  it('shows per-part finish selectors only for multi-part shapes (F080)', async () => {
    const user = userEvent.setup();
    setup();
    await openEditWithShape(user);

    // bar-pull has [grip, base] → both selectors render.
    expect(screen.getByTestId('hardware-form-part-finishes')).toBeTruthy();
    expect(screen.getByTestId('hardware-form-finish-grip')).toBeTruthy();
    expect(screen.getByTestId('hardware-form-finish-base')).toBeTruthy();
    expect(screen.queryByTestId('hardware-form-finish-body')).toBeNull();

    // Single-part shape (rail → [body]) hides the section entirely.
    await user.selectOptions(
      screen.getByTestId('hardware-form-shape') as HTMLSelectElement,
      'rail',
    );
    expect(screen.queryByTestId('hardware-form-part-finishes')).toBeNull();
  });
});
