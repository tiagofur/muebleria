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

describe('HardwareKitAccessoriesSection — orden y opción por defecto (#1627)', () => {
  const hardware = [
    { id: 'hw-gal', code: 'GAL', name: 'Galería', unit: 'piece', costPerUnit: 0, active: false },
    { id: 'hw-cap', code: 'CAP', name: 'Boxcap', unit: 'piece', costPerUnit: 0, active: true },
    { id: 'hw-cov', code: 'COV', name: 'Boxcover', unit: 'piece', costPerUnit: 0, active: true },
  ] as const;
  const group: OptionGroup = { ...optionGroupFixture, optionIds: ['hw-gal', 'hw-cap', 'hw-cov'] };

  it('marca «Por defecto» la primera opción ACTIVA (salta la inactiva)', () => {
    render(
      <HardwareKitAccessoriesSection kitId="kit-1" kitCode="MBOX-E" optionGroups={[group]} hardware={hardware as never} canMutate />,
    );
    expect(screen.queryByTestId('hardware-accessory-MBOX_E_GALERIA-default-GAL')).toBeNull();
    expect(screen.getByTestId('hardware-accessory-MBOX_E_GALERIA-default-CAP')).toBeTruthy();
    expect(screen.queryByTestId('hardware-accessory-MBOX_E_GALERIA-default-COV')).toBeNull();
  });

  it('las flechas guardan el orden nuevo; los extremos no se mueven', () => {
    const onUpdateGroup = vi.fn();
    render(
      <HardwareKitAccessoriesSection
        kitId="kit-1"
        kitCode="MBOX-E"
        optionGroups={[group]}
        hardware={hardware as never}
        canMutate
        onUpdateGroup={onUpdateGroup}
      />,
    );
    expect((screen.getByTestId('hardware-accessory-MBOX_E_GALERIA-up-GAL') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('hardware-accessory-MBOX_E_GALERIA-down-COV') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('hardware-accessory-MBOX_E_GALERIA-up-COV'));
    expect(onUpdateGroup).toHaveBeenCalledWith('og-galeria', expect.objectContaining({ optionIds: ['hw-gal', 'hw-cov', 'hw-cap'] }));
  });
});
