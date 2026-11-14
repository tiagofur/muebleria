/**
 * #1625 — «Añadir altura»: al elegir la E aparecen sus insertos (misma forma
 * que el asistente) y viajan en el envío; otras alturas no los ofrecen; dos
 * insertos con el mismo código bloquean el envío con un aviso.
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agregado } from '@granete/domain';

import { HardwareSystemHeightAddModal } from './HardwareSystemHeightAddModal';

afterEach(cleanup);

const agregado = {
  id: 'agr-sys',
  code: 'SYS-CAJON',
  name: 'Cajón Sistema',
  active: true,
  externalDims: { width: 570, height: 108, depth: 530 },
  variantSets: [{ id: 'vs-h', dimension: 'height', variants: [{ nominalDimensionMm: 108, hardwareId: 'kit-m' }] }],
} as unknown as Agregado;

function setup() {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <HardwareSystemHeightAddModal open onClose={vi.fn()} agregado={agregado} hasEligibilityGroup onSubmit={onSubmit} />,
  );
  return { onSubmit };
}

describe('HardwareSystemHeightAddModal (#1625)', () => {
  it('la altura E ofrece insertos y los manda con el envío', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    expect(screen.queryByTestId('hardware-system-height-inserto-add')).toBeNull();

    await user.selectOptions(screen.getByTestId('hardware-system-height-select'), 'E');
    await user.click(screen.getByTestId('hardware-system-height-inserto-add'));
    await user.type(screen.getByTestId('hardware-system-height-inserto-0-name'), 'Galería');
    await user.type(screen.getByTestId('hardware-system-height-inserto-0-left-x'), '5');
    expect(screen.getByTestId('hardware-system-height-file-SYS-E-GALERIA:left')).toBeInTheDocument();

    await user.click(screen.getByTestId('hardware-system-height-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const req = (onSubmit.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(req).toMatchObject({ agregadoId: 'agr-sys', heightCode: 'E' });
    expect(req.insertos).toEqual([
      {
        suffix: 'GALERIA',
        name: 'Galería',
        anchors: ['left', 'right'],
        pieceOffsets: { left: { x: 5, y: 0, z: 0 }, right: { x: 0, y: 0, z: 0 } },
        actorMembership: 'actor:drawer',
      },
    ]);
  });

  it('otras alturas no ofrecen insertos y no los mandan', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.selectOptions(screen.getByTestId('hardware-system-height-select'), 'K');
    expect(screen.queryByTestId('hardware-system-height-inserto-add')).toBeNull();
    await user.click(screen.getByTestId('hardware-system-height-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect((onSubmit.mock.calls[0] as unknown as [Record<string, unknown>])[0].insertos).toBeUndefined();
  });

  it('dos insertos con el mismo código bloquean el envío con aviso', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.selectOptions(screen.getByTestId('hardware-system-height-select'), 'E');
    await user.click(screen.getByTestId('hardware-system-height-inserto-add'));
    await user.type(screen.getByTestId('hardware-system-height-inserto-0-name'), 'Galería');
    await user.click(screen.getByTestId('hardware-system-height-inserto-add'));
    await user.type(screen.getByTestId('hardware-system-height-inserto-1-name'), 'galeria');
    expect(screen.getByTestId('hardware-system-height-inserto-duplicated')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('hardware-system-height-submit')).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
