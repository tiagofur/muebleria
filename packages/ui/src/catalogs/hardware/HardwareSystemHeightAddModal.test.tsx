/**
 * #1625 → #1633 — «Añadir altura»: etiqueta libre + altura interior mínima
 * (atajos con las alturas Blum que faltan), insertos con precio en cualquier
 * altura, repetidos contra las alturas efectivas de la familia bloqueados.
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

function setup(opts: { existingHardwareCodes?: string[]; existingGroupCodes?: string[] } = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <HardwareSystemHeightAddModal
      open
      onClose={vi.fn()}
      agregado={agregado}
      hasEligibilityGroup
      onSubmit={onSubmit}
      existingHardwareCodes={new Set(opts.existingHardwareCodes ?? [])}
      existingGroupCodes={new Set(opts.existingGroupCodes ?? [])}
    />,
  );
  return { onSubmit };
}

describe('HardwareSystemHeightAddModal (#1625 → #1633)', () => {
  it('atajo Blum llena etiqueta y mínimo; insertos con precio viajan en el envío', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    expect(screen.queryByTestId('hardware-system-height-inserto-add')).toBeNull();
    // La M ya existe (108 sin etiqueta = «M»): no se ofrece como atajo.
    expect(screen.queryByTestId('hardware-system-height-preset-M')).toBeNull();

    await user.click(screen.getByTestId('hardware-system-height-preset-E'));
    expect(screen.getByTestId('hardware-system-height-label')).toHaveValue('E');
    expect(screen.getByTestId('hardware-system-height-kh')).toHaveValue(209);
    await user.click(screen.getByTestId('hardware-system-height-inserto-add'));
    await user.type(screen.getByTestId('hardware-system-height-inserto-0-name'), 'Galería');
    await user.type(screen.getByTestId('hardware-system-height-inserto-0-left-x'), '5');
    await user.type(screen.getByTestId('hardware-system-height-inserto-0-price'), '120');
    expect(screen.getByTestId('hardware-system-height-file-SYS-E-GALERIA:left')).toBeInTheDocument();

    await user.click(screen.getByTestId('hardware-system-height-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const req = (onSubmit.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(req).toMatchObject({ agregadoId: 'agr-sys', heightCode: 'E', khMinMm: 209 });
    expect(req.insertos).toEqual([
      {
        suffix: 'GALERIA',
        name: 'Galería',
        anchors: ['left', 'right'],
        pieceOffsets: { left: { x: 5, y: 0, z: 0 }, right: { x: 0, y: 0, z: 0 } },
        actorMembership: 'actor:drawer',
        costPerUnit: 120,
      },
    ]);
  });

  it('etiqueta libre en cualquier altura: código normalizado e insertos disponibles', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.type(screen.getByTestId('hardware-system-height-label'), 'Alta 186');
    await user.type(screen.getByTestId('hardware-system-height-kh'), '186');
    await user.click(screen.getByTestId('hardware-system-height-inserto-add'));
    await user.type(screen.getByTestId('hardware-system-height-inserto-0-name'), 'Boxcap');
    expect(screen.getByTestId('hardware-system-height-file-SYS-ALTA-186-BOXCAP:left')).toBeInTheDocument();
    await user.click(screen.getByTestId('hardware-system-height-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect((onSubmit.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({
      heightCode: 'Alta 186',
      khMinMm: 186,
    });
  });

  it('etiqueta o medida que ya tiene la familia: aviso y envío bloqueado', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.type(screen.getByTestId('hardware-system-height-label'), 'm');
    expect(screen.getByTestId('hardware-system-height-problem').textContent).toContain('ya tiene una altura «m»');
    expect(screen.getByTestId('hardware-system-height-submit')).toBeDisabled();
    await user.clear(screen.getByTestId('hardware-system-height-label'));
    await user.type(screen.getByTestId('hardware-system-height-label'), 'X');
    await user.type(screen.getByTestId('hardware-system-height-kh'), '108');
    expect(screen.getByTestId('hardware-system-height-problem').textContent).toContain('108 mm');
    expect(screen.getByTestId('hardware-system-height-submit')).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('dos insertos con el mismo código bloquean el envío con aviso', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.click(screen.getByTestId('hardware-system-height-preset-E'));
    await user.click(screen.getByTestId('hardware-system-height-inserto-add'));
    await user.type(screen.getByTestId('hardware-system-height-inserto-0-name'), 'Galería');
    await user.click(screen.getByTestId('hardware-system-height-inserto-add'));
    await user.type(screen.getByTestId('hardware-system-height-inserto-1-name'), 'galeria');
    expect(screen.getByTestId('hardware-system-height-inserto-duplicated')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('hardware-system-height-submit')).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('review #1637: código demasiado largo o ya existente se avisa antes de subir nada', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ existingHardwareCodes: ['SYS-C'] });
    await user.type(screen.getByTestId('hardware-system-height-label'), 'C');
    await user.type(screen.getByTestId('hardware-system-height-kh'), '177');
    expect(screen.getByTestId('hardware-system-height-problem').textContent).toContain('SYS-C');
    expect(screen.getByTestId('hardware-system-height-submit')).toBeDisabled();
    await user.clear(screen.getByTestId('hardware-system-height-label'));
    await user.type(screen.getByTestId('hardware-system-height-label'), 'Alta para ollas grandes');
    await user.click(screen.getByTestId('hardware-system-height-inserto-add'));
    await user.type(screen.getByTestId('hardware-system-height-inserto-0-name'), 'Boxcover alto reforzado');
    expect(screen.getByTestId('hardware-system-height-problem').textContent).toContain('supera 50');
    expect(screen.getByTestId('hardware-system-height-submit')).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('review #1637: un inserto que pisa un perfil del juego se avisa', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId('hardware-system-height-preset-E'));
    await user.click(screen.getByTestId('hardware-system-height-inserto-add'));
    await user.type(screen.getByTestId('hardware-system-height-inserto-0-name'), 'Fij');
    // El perfil fijo del juego es SYS-E-FIJ: el inserto «Fij» generaría el mismo código.
    expect(screen.getByTestId('hardware-system-height-problem').textContent).toContain('se repite');
    expect(screen.getByTestId('hardware-system-height-submit')).toBeDisabled();
  });

  it('review #1637: medida repetida sin etiqueta se avisa; un precio inválido no desmonta los insertos', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByTestId('hardware-system-height-kh'), '108');
    expect(screen.getByTestId('hardware-system-height-problem').textContent).toContain('108 mm');
    await user.clear(screen.getByTestId('hardware-system-height-kh'));
    await user.click(screen.getByTestId('hardware-system-height-preset-E'));
    await user.click(screen.getByTestId('hardware-system-height-inserto-add'));
    await user.clear(screen.getByTestId('hardware-system-height-cost'));
    await user.type(screen.getByTestId('hardware-system-height-cost'), '-5');
    expect(screen.getByTestId('hardware-system-height-inserto-0-name')).toBeInTheDocument();
    expect(screen.getByTestId('hardware-system-height-problem').textContent).toContain('precio');
    expect(screen.getByTestId('hardware-system-height-submit')).toBeDisabled();
  });
});
