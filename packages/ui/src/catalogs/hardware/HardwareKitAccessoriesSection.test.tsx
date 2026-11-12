/**
 * @vitest-environment jsdom
 *
 * #1606: eliminación de selector de accesorio del juego — onDeleteGroup con
 * estado de carga ("Eliminando…") y botón deshabilitado mientras viaja el DELETE.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OptionGroup } from '@granete/domain';

import { HardwareKitAccessoriesSection } from './HardwareKitAccessoriesSection';

afterEach(cleanup);

const optionGroupFixture: OptionGroup = {
  id: 'og-galeria',
  code: 'MBOX_E_GALERIA',
  name: 'Galeria',
  kind: 'hardware',
  required: true,
  optionIds: [],
  kitHardwareId: 'kit-1',
};

describe('HardwareKitAccessoriesSection — eliminar selector (#1606)', () => {
  it('clic en Eliminar selector llama onDeleteGroup y muestra estado de carga', async () => {
    let resolveDelete!: () => void;
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    const onDeleteGroup = vi.fn().mockImplementation(() => deletePromise);

    render(
      <HardwareKitAccessoriesSection
        kitId="kit-1"
        kitCode="MBOX-E"
        optionGroups={[optionGroupFixture]}
        hardware={[]}
        canMutate={true}
        onDeleteGroup={onDeleteGroup}
      />,
    );

    const deleteBtn = screen.getByTestId('hardware-accessory-MBOX_E_GALERIA-delete');
    expect(deleteBtn.textContent).toBe('Eliminar selector');

    fireEvent.click(deleteBtn);

    expect(onDeleteGroup).toHaveBeenCalledWith('og-galeria');
    expect(deleteBtn.textContent).toBe('Eliminando…');
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);

    resolveDelete();
    await deletePromise;
    await waitFor(() => {
      expect((deleteBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('si onDeleteGroup falla, el botón se rehabilita y permite reintentar', async () => {
    let rejectDelete!: (err: Error) => void;
    const deletePromise = new Promise<void>((_, reject) => {
      rejectDelete = reject;
    });
    deletePromise.catch(() => undefined);
    const onDeleteGroup = vi.fn().mockImplementation(() => deletePromise);

    render(
      <HardwareKitAccessoriesSection
        kitId="kit-1"
        kitCode="MBOX-E"
        optionGroups={[optionGroupFixture]}
        hardware={[]}
        canMutate={true}
        onDeleteGroup={onDeleteGroup}
      />,
    );

    const deleteBtn = screen.getByTestId('hardware-accessory-MBOX_E_GALERIA-delete');
    fireEvent.click(deleteBtn);

    expect(deleteBtn.textContent).toBe('Eliminando…');
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);

    rejectDelete(new Error('server error'));

    await waitFor(() => {
      expect(deleteBtn.textContent).toBe('Eliminar selector');
      expect((deleteBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
