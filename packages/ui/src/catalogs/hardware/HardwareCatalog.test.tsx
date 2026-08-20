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
