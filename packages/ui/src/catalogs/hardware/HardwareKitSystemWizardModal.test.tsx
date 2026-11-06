/**
 * HardwareKitSystemWizardModal behavior tests (#1546 + #1552): plan problems
 * surfaced with role="alert" (zero heights, negative price, duplicate
 * accessories, blocked code), uploadDesign guard, running-close guard, and
 * the reset-after-done fix (reopening shows a clean form, not the stale
 * result of the previous run).
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  HardwareKitResult,
  HardwareKitSystemCreateRequest,
} from '@granete/domain';

import { HardwareKitSystemWizardModal } from './HardwareKitSystemWizardModal';

afterEach(cleanup);

const okResult: HardwareKitResult = {
  createdCodes: ['MBOX-SYS-M', 'MBOX-SYS-CAJON'],
  reusedCodes: [],
  agregadoCode: 'MBOX-SYS-CAJON',
  agregadoId: 'agr-sys-1',
};

type SubmitMock = ReturnType<
  typeof vi.fn<(req: HardwareKitSystemCreateRequest) => Promise<HardwareKitResult>>
>;

function setup(opts?: {
  readonly onSubmit?: SubmitMock;
  readonly uploadDesign?: (file: File, displayName: string) => Promise<unknown>;
  readonly existingHardwareCodes?: readonly string[];
  readonly existingAgregadoCodes?: readonly string[];
}) {
  const onSubmit: SubmitMock =
    opts?.onSubmit ?? vi.fn(async (_req: HardwareKitSystemCreateRequest) => okResult);
  const onClose = vi.fn();
  const view = render(
    <HardwareKitSystemWizardModal
      open
      onClose={onClose}
      onSubmit={onSubmit}
      uploadDesign={
        opts?.uploadDesign as
          | ((file: File, displayName: string) => Promise<import('@granete/domain').HardwareVisualAssetBinding>)
          | undefined
      }
      existingHardwareCodes={new Set(opts?.existingHardwareCodes ?? [])}
      existingAgregadoCodes={new Set(opts?.existingAgregadoCodes ?? [])}
    />,
  );
  return { onSubmit, onClose, view };
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>, code = 'MBOX-SYS') {
  await user.type(screen.getByTestId('hardware-system-wizard-code'), code);
  await user.type(screen.getByTestId('hardware-system-wizard-name'), 'Merivobox Iridium');
  await user.type(screen.getByTestId('hardware-system-wizard-price'), '420');
}

describe('HardwareKitSystemWizardModal — problemas del planner visibles (#1552)', () => {
  it('cero alturas: mensaje visible con role=alert y submit bloqueado', async () => {
    const user = userEvent.setup();
    setup();
    await fillBasics(user);
    // Desmarcar la única altura incluida por defecto (M).
    await user.click(screen.getByTestId('hardware-system-height-M'));

    const problem = screen.getByTestId('hardware-system-wizard-plan-error');
    expect(problem).toHaveAttribute('role', 'alert');
    expect(problem.textContent).toContain('al menos una altura');
    expect(screen.getByTestId('hardware-system-wizard-submit')).toBeDisabled();
  });

  it('precio negativo: mensaje del planner visible y SIN llamada al store (no se persiste como 0)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_req: HardwareKitSystemCreateRequest) => okResult);
    setup({ onSubmit });
    await fillBasics(user);
    await user.clear(screen.getByTestId('hardware-system-wizard-price'));
    await user.type(screen.getByTestId('hardware-system-wizard-price'), '-420');

    const problem = screen.getByTestId('hardware-system-wizard-plan-error');
    expect(problem).toHaveAttribute('role', 'alert');
    expect(problem.textContent).toContain('precio');
    expect(screen.getByTestId('hardware-system-wizard-submit')).toBeDisabled();

    // El submit nativo del formulario no puede colarse: no hay llamada.
    await user.click(screen.getByTestId('hardware-system-wizard-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('código bloqueado: mensaje inline en la vista previa con role=alert', async () => {
    const user = userEvent.setup();
    setup({ existingAgregadoCodes: ['MBOX-SYS-CAJON'] });
    await fillBasics(user);

    const blocked = screen.getByTestId('hardware-system-wizard-blocked');
    expect(blocked).toHaveAttribute('role', 'alert');
    expect(blocked.textContent).toContain('MBOX-SYS-CAJON');
    expect(screen.getByTestId('hardware-system-wizard-submit')).toBeDisabled();
  });

  it('accesorios duplicados: aviso amable en vez de 409 crudo', async () => {
    const user = userEvent.setup();
    setup();
    await fillBasics(user);
    // El kit E no está incluido por defecto: activarlo para poder dar accesorios.
    await user.click(screen.getByTestId('hardware-system-height-E'));
    await user.click(screen.getByTestId('hardware-system-accessory-add'));
    await user.type(screen.getByTestId('hardware-system-accessory-0-name'), 'Galería');
    await user.click(screen.getByTestId('hardware-system-accessory-add'));
    await user.type(screen.getByTestId('hardware-system-accessory-1-name'), 'galeria');

    const problem = screen.getByTestId('hardware-system-wizard-plan-error');
    expect(problem).toHaveAttribute('role', 'alert');
    expect(problem.textContent).toContain('mismo código');
    expect(screen.getByTestId('hardware-system-wizard-submit')).toBeDisabled();
  });
});

describe('HardwareKitSystemWizardModal — guard de subidas y cierre (#1552)', () => {
  it('archivo elegido sin servicio de recursos: error visible y sin llamada', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_req: HardwareKitSystemCreateRequest) => okResult);
    setup({ onSubmit });
    await fillBasics(user);

    const fileInput = screen
      .getAllByTestId(/^hardware-system-wizard-file-/)
      .find((el) => !(el as HTMLInputElement).disabled) as HTMLInputElement;
    expect(fileInput).toBeDefined();
    await user.upload(fileInput, new File(['skp'], 'lateral.skp', { type: 'application/octet-stream' }));

    await user.click(screen.getByTestId('hardware-system-wizard-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('hardware-system-wizard-error').textContent).toContain(
        'servicio de recursos 3D',
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('cerrar durante running queda guardado: onClose no se llama y al terminar el flujo sigue', async () => {
    const user = userEvent.setup();
    let resolveSubmit: (r: HardwareKitResult) => void = () => {};
    const onSubmit = vi.fn(
      (_req: HardwareKitSystemCreateRequest) =>
        new Promise<HardwareKitResult>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const { onClose } = setup({ onSubmit });
    await fillBasics(user);
    await user.click(screen.getByTestId('hardware-system-wizard-submit'));

    expect(screen.getByTestId('hardware-system-wizard-submit')).toHaveTextContent('Creando');
    // Cancelar durante running: guardado, no cierra.
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).not.toHaveBeenCalled();

    resolveSubmit(okResult);
    await waitFor(() => {
      expect(screen.getByTestId('hardware-system-wizard-result')).toBeTruthy();
    });
    // «Listo» sí cierra (y resetea).
    await user.click(screen.getByRole('button', { name: 'Listo' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('HardwareKitSystemWizardModal — reset tras «Listo» (#1552, el P1)', () => {
  it('crear → cerrar → reabrir muestra el formulario limpio, no el resultado stale', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_req: HardwareKitSystemCreateRequest) => okResult);
    const { view } = setup({ onSubmit });
    await fillBasics(user);
    await user.click(screen.getByTestId('hardware-system-wizard-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('hardware-system-wizard-result')).toBeTruthy();
    });
    expect(screen.getByTestId('hardware-system-wizard-result').textContent).toContain(
      'MBOX-SYS-M',
    );

    // Cerrar y reabrir SIN desmontar (el catálogo lo mantiene montado).
    view.rerender(
      <HardwareKitSystemWizardModal
        open={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        existingHardwareCodes={new Set()}
        existingAgregadoCodes={new Set()}
      />,
    );
    view.rerender(
      <HardwareKitSystemWizardModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        existingHardwareCodes={new Set()}
        existingAgregadoCodes={new Set()}
      />,
    );

    expect(screen.queryByTestId('hardware-system-wizard-result')).toBeNull();
    expect(screen.getByTestId('hardware-system-wizard-code')).toHaveValue('');
    expect(screen.getByTestId('hardware-system-wizard-name')).toHaveValue('');
    // Input number vacío: value null en el DOM.
    expect(screen.getByTestId('hardware-system-wizard-price')).toHaveValue(null);
  });

  it('un segundo sistema distinto se puede crear en la misma sesión', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_req: HardwareKitSystemCreateRequest) => okResult);
    const { view } = setup({ onSubmit });
    await fillBasics(user, 'MBOX-SYS');
    await user.click(screen.getByTestId('hardware-system-wizard-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('hardware-system-wizard-result')).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: 'Listo' }));

    view.rerender(
      <HardwareKitSystemWizardModal
        open={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        existingHardwareCodes={new Set()}
        existingAgregadoCodes={new Set()}
      />,
    );
    view.rerender(
      <HardwareKitSystemWizardModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        existingHardwareCodes={new Set()}
        existingAgregadoCodes={new Set()}
      />,
    );

    await user.type(screen.getByTestId('hardware-system-wizard-code'), 'MBOX-OTRO');
    await user.type(screen.getByTestId('hardware-system-wizard-name'), 'Otro sistema');
    await user.click(screen.getByTestId('hardware-system-wizard-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('hardware-system-wizard-result')).toBeTruthy();
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]?.[0]?.input.code).toBe('MBOX-OTRO');
  });
});
