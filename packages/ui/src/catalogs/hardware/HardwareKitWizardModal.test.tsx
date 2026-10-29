/**
 * HardwareKitWizardModal behavior tests (#1416): live plan preview, reuse
 * badges, fail-closed agregado collision, submit wiring (uploads + store
 * call), and honest error reporting without losing form state.
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hardware, HardwareKitCreateRequest, HardwareKitResult } from '@granete/domain';

import { HardwareKitWizardModal } from './HardwareKitWizardModal';

vi.mock('@granete/storage', () => ({
  uploadHardwareAssetBinding: vi.fn(),
}));

afterEach(cleanup);

const existingKit: Hardware = {
  id: 'kit-1',
  code: 'HER-CORR-TEL-50',
  name: 'Corredera Telescópica 500',
  unit: 'set',
  costPerUnit: 420,
  active: true,
};

const okResult: HardwareKitResult = {
  createdCodes: ['HER-NEW-1', 'HER-NEW-1-FIJ-I'],
  reusedCodes: [],
  agregadoCode: 'HER-NEW-1-CAJON',
  agregadoId: 'agr-1',
};

type CreateKitMock = ReturnType<
  typeof vi.fn<(req: HardwareKitCreateRequest) => Promise<HardwareKitResult>>
>;

function setup(opts?: {
  readonly hardware?: readonly Hardware[];
  readonly agregadoCodes?: readonly string[];
  readonly onCreateKit?: CreateKitMock;
}) {
  const onCreateKit: CreateKitMock = opts?.onCreateKit ?? vi.fn(async () => okResult);
  render(
    <HardwareKitWizardModal
      open
      onClose={vi.fn()}
      hardware={opts?.hardware ?? []}
      agregadoCodes={opts?.agregadoCodes ?? []}
      onCreateKit={onCreateKit}
    />,
  );
  return { onCreateKit };
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('hardware-kit-wizard-code'), 'HER-NEW-1');
  await user.type(screen.getByTestId('hardware-kit-wizard-name'), 'Corredera nueva');
  await user.type(screen.getByTestId('hardware-kit-wizard-price'), '380');
}

describe('HardwareKitWizardModal (#1416)', () => {
  it('previsualiza el plan completo con códigos derivados', async () => {
    const user = userEvent.setup();
    setup();
    await fillBasics(user);

    const preview = screen.getByTestId('hardware-kit-wizard-preview');
    expect(preview.textContent).toContain('HER-NEW-1');
    expect(preview.textContent).toContain('HER-NEW-1-CAJON');
    expect(preview.textContent).toContain('HER-NEW-1-FIJ-I');
    expect(preview.textContent).toContain('HER-NEW-1-MOV-D');
  });

  it('marca herrajes existentes como reutilizados en la vista previa', async () => {
    const user = userEvent.setup();
    setup({ hardware: [existingKit] });
    await fillBasics(user);
    // Kit con el mismo código que uno existente → reutiliza.
    await user.clear(screen.getByTestId('hardware-kit-wizard-code'));
    await user.type(screen.getByTestId('hardware-kit-wizard-code'), 'HER-CORR-TEL-50');

    const preview = screen.getByTestId('hardware-kit-wizard-preview');
    expect(preview.textContent).toContain('ya existe, se reutiliza');
    expect(screen.getByTestId('hardware-kit-wizard-file-fixed-left').getAttribute('disabled')).toBe(
      null,
    );
  });

  it('bloquea fail-closed si el código del cajón ya existe', async () => {
    const user = userEvent.setup();
    setup({ agregadoCodes: ['HER-NEW-1-CAJON'] });
    await fillBasics(user);

    expect(screen.getByTestId('hardware-kit-wizard-submit')).toBeDisabled();
    expect(screen.getByTestId('hardware-kit-wizard-preview').textContent).toContain(
      'HER-NEW-1-CAJON» ya existe',
    );
  });

  it('submit feliz: llama al store con el input del plan y muestra el resumen', async () => {
    const user = userEvent.setup();
    const onCreateKit = vi.fn(async (_req: HardwareKitCreateRequest) => okResult);
    setup({ onCreateKit });
    await fillBasics(user);

    await user.click(screen.getByTestId('hardware-kit-wizard-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('hardware-kit-wizard-result')).toBeTruthy();
    });
    expect(onCreateKit).toHaveBeenCalledTimes(1);
    const req = onCreateKit.mock.calls[0]?.[0];
    expect(req).toBeDefined();
    if (!req) return;
    expect(req.input).toMatchObject({
      code: 'HER-NEW-1',
      kitCostPerUnit: 380,
      widthMm: 400,
      heightMm: 150,
      depthMm: 500,
    });
    expect(Object.keys(req.designs ?? {})).toHaveLength(0);
    expect(screen.getByTestId('hardware-kit-wizard-result').textContent).toContain(
      'HER-NEW-1-CAJON',
    );
    expect(screen.getByTestId('hardware-kit-wizard-result').textContent).toContain('Creados');
  });

  it('input inválido: error visible y SIN llamada al store', async () => {
    const user = userEvent.setup();
    const onCreateKit = vi.fn(async (_req: HardwareKitCreateRequest) => okResult);
    setup({ onCreateKit });
    await user.type(screen.getByTestId('hardware-kit-wizard-code'), 'HER-X');
    await user.type(screen.getByTestId('hardware-kit-wizard-name'), 'X');
    // Precio negativo: pasa el `required` nativo y llega al validador estricto
    // del planner, que lo rechaza (server authority se mantiene intacta).
    await user.type(screen.getByTestId('hardware-kit-wizard-price'), '-5');
    await user.click(screen.getByTestId('hardware-kit-wizard-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('hardware-kit-wizard-error').textContent).toContain('precio');
    });
    expect(onCreateKit).not.toHaveBeenCalled();
    // El formulario conserva lo tecleado (no hay pérdida silenciosa).
    expect(screen.getByTestId('hardware-kit-wizard-code')).toHaveValue('HER-X');
  });

  it('fallo del store: error visible, fase form y sin resumen', async () => {
    const user = userEvent.setup();
    const onCreateKit = vi.fn(async (_req: HardwareKitCreateRequest) => {
      throw new Error('Ya existe un agregado con el código «X».');
    });
    setup({ onCreateKit });
    await fillBasics(user);
    await user.click(screen.getByTestId('hardware-kit-wizard-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('hardware-kit-wizard-error').textContent).toContain(
        'Ya existe un agregado',
      );
    });
    expect(screen.queryByTestId('hardware-kit-wizard-result')).toBeNull();
    expect(screen.getByTestId('hardware-kit-wizard-submit')).toHaveTextContent('Crear juego');
  });
});
