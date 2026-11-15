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
// Flujos de varios pasos con muchas interacciones: bajo carga del runner
// completo el default de 5 s queda corto (review #1636).
vi.setConfig({ testTimeout: 20_000 });

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

type User = ReturnType<typeof userEvent.setup>;

async function fillIdentity(user: User, code = 'MBOX-SYS') {
  await user.type(screen.getByTestId('hardware-system-wizard-code'), code);
  await user.type(screen.getByTestId('hardware-system-wizard-name'), 'Merivobox Iridium');
}

/** Identidad → Alturas con la plantilla Blum reducida a M (+ E opcional), precio 420. */
async function fillBasics(user: User, code = 'MBOX-SYS', opts: { withE?: boolean } = {}) {
  await fillIdentity(user, code);
  await user.click(screen.getByTestId('family-wizard-next'));
  await user.click(screen.getByTestId('family-heights-template'));
  // Plantilla N/M/K/E: quitar N y K (y E si no se pide).
  await user.click(screen.getByTestId('family-height-2-remove')); // K
  await user.click(screen.getByTestId('family-height-0-remove')); // N → quedan M, E
  if (!opts.withE) await user.click(screen.getByTestId('family-height-1-remove'));
  await user.type(screen.getByTestId('family-height-0-price'), '420');
  if (opts.withE) {
    await user.click(screen.getByTestId('family-heights-apply-price'));
  }
}

async function goToSummary(user: User) {
  while (!screen.queryByTestId('hardware-system-wizard-submit')) {
    await user.click(screen.getByTestId('family-wizard-next'));
  }
}

describe('HardwareKitSystemWizardModal — pasos de la familia (#1633 s2b)', () => {
  it('arranca en Identidad sin error; Siguiente explica qué falta y no avanza; pasos posteriores cerrados', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByTestId('family-wizard-step-0')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('family-wizard-step-1')).toBeDisabled();
    expect(screen.queryByTestId('hardware-system-wizard-plan-error')).toBeNull();
    await user.click(screen.getByTestId('family-wizard-next'));
    const problem = screen.getByTestId('hardware-system-wizard-plan-error');
    expect(problem.textContent).toContain('código');
    await waitFor(() => expect(problem).toHaveFocus());
    expect(screen.getByTestId('family-wizard-step-0')).toHaveAttribute('aria-current', 'step');
    await fillIdentity(user);
    expect(screen.queryByTestId('hardware-system-wizard-plan-error')).toBeNull();
    await user.click(screen.getByTestId('family-wizard-next'));
    expect(screen.getByTestId('family-wizard-step-1')).toHaveAttribute('aria-current', 'step');
    // El foco va al título del paso nuevo.
    expect(screen.getByTestId('family-wizard-title')).toHaveFocus();
    expect(screen.getByTestId('family-wizard-title').textContent).toBe('Alturas');
  });

  it('Alturas vacías enseñan la plantilla; precargarla deja filas editables N/M/K/E', async () => {
    const user = userEvent.setup();
    setup();
    await fillIdentity(user);
    await user.click(screen.getByTestId('family-wizard-next'));
    expect(screen.getByTestId('family-heights-empty')).toBeInTheDocument();
    await user.click(screen.getByTestId('family-heights-template'));
    expect(screen.getByTestId('family-height-0-label')).toHaveValue('N');
    expect(screen.getByTestId('family-height-3-label')).toHaveValue('E');
    expect(screen.getByTestId('family-height-1-kh')).toHaveValue(108);
    // Sin precio no se avanza: el mensaje enseña que puede ser 0.
    await user.click(screen.getByTestId('family-wizard-next'));
    expect(screen.getByTestId('hardware-system-wizard-plan-error').textContent).toContain('puede ser 0');
    await waitFor(() => expect(screen.getByTestId('hardware-system-wizard-plan-error')).toHaveFocus());
    expect(screen.getByTestId('family-wizard-title').textContent).toBe('Alturas');
    await user.type(screen.getByTestId('family-height-0-price'), '400');
    await user.click(screen.getByTestId('family-heights-apply-price'));
    expect(screen.getByTestId('family-height-3-price')).toHaveValue(400);
    expect(screen.queryByTestId('hardware-system-wizard-plan-error')).toBeNull();
  });

  it('etiquetas libres de otra marca: crea juegos por etiqueta con precio por altura', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.type(screen.getByTestId('hardware-system-wizard-code'), 'LGX');
    await user.type(screen.getByTestId('hardware-system-wizard-name'), 'Legrabox');
    await user.type(screen.getByTestId('hardware-system-wizard-brand'), 'Blum');
    await user.click(screen.getByTestId('family-wizard-next'));
    await user.click(screen.getByTestId('family-heights-add'));
    await user.type(screen.getByTestId('family-height-0-label'), 'Baja');
    await user.type(screen.getByTestId('family-height-0-kh'), '70');
    await user.type(screen.getByTestId('family-height-0-price'), '450');
    await user.click(screen.getByTestId('family-heights-add'));
    await user.type(screen.getByTestId('family-height-1-label'), 'Alta 186');
    await user.type(screen.getByTestId('family-height-1-kh'), '186');
    await user.type(screen.getByTestId('family-height-1-price'), '610');
    await goToSummary(user);
    expect(screen.getByTestId('hardware-system-wizard-preview').textContent).toContain('LGX-ALTA-186');
    await user.click(screen.getByTestId('hardware-system-wizard-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0]![0].input;
    expect(input.brand).toBe('Blum');
    expect(input.heights.map((h) => [h.code, h.khMinMm, h.kitCostPerUnit])).toEqual([
      ['Baja', 70, 450],
      ['Alta 186', 186, 610],
    ]);
  });

  it('subir/bajar reordena y devuelve el foco al mismo control de la fila movida', async () => {
    const user = userEvent.setup();
    setup();
    await fillIdentity(user);
    await user.click(screen.getByTestId('family-wizard-next'));
    await user.click(screen.getByTestId('family-heights-template'));
    await user.click(screen.getByTestId('family-height-1-up'));
    expect(screen.getByTestId('family-height-0-label')).toHaveValue('M');
    await waitFor(() => expect(screen.getByTestId('family-height-0-up')).toBeDisabled());
  });

  it('insertos con «Aplica en»: uno por altura marcada, con su precio', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await fillBasics(user, 'MBOX-SYS', { withE: true });
    await user.click(screen.getByTestId('family-wizard-next'));
    await user.click(screen.getByTestId('hardware-system-accessory-add'));
    await user.type(screen.getByTestId('hardware-system-accessory-0-name'), 'Galería');
    // Preselecciona la altura más alta (E); se suma la M.
    expect(screen.getByTestId('hardware-system-accessory-0-height-E')).toBeChecked();
    await user.click(screen.getByTestId('hardware-system-accessory-0-height-M'));
    await user.type(screen.getByTestId('hardware-system-accessory-0-price'), '120');
    await goToSummary(user);
    const preview = screen.getByTestId('hardware-system-wizard-preview').textContent ?? '';
    expect(preview).toContain('MBOX-SYS-E-GALERIA');
    expect(preview).toContain('MBOX-SYS-M-GALERIA');
    await user.click(screen.getByTestId('hardware-system-wizard-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const acc = onSubmit.mock.calls[0]![0].input.accessories![0]!;
    expect(acc.heights).toEqual(['E', 'M']);
    expect(acc.costPerUnit).toBe(120);
  });
});

describe('HardwareKitSystemWizardModal — review #1636', () => {
  it('P1: renombrar una altura suelta la etiqueta vieja de los insertos (sin quedar trabado)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await fillBasics(user, 'MBOX-SYS', { withE: true });
    await user.click(screen.getByTestId('family-wizard-next'));
    await user.click(screen.getByTestId('hardware-system-accessory-add'));
    await user.type(screen.getByTestId('hardware-system-accessory-0-name'), 'Galería');
    expect(screen.getByTestId('hardware-system-accessory-0-height-E')).toBeChecked();
    // Volver a Alturas y renombrar E → Alta.
    await user.click(screen.getByTestId('family-wizard-step-1'));
    await user.clear(screen.getByTestId('family-height-1-label'));
    await user.type(screen.getByTestId('family-height-1-label'), 'Alta');
    await user.click(screen.getByTestId('family-wizard-next'));
    // La E ya no existe: el inserto quedó sin altura y lo dice; marcar Alta resuelve.
    await user.click(screen.getByTestId('family-wizard-next'));
    expect(screen.getByTestId('hardware-system-wizard-plan-error').textContent).toContain('ninguna altura');
    await user.click(screen.getByTestId('hardware-system-accessory-0-height-Alta'));
    await goToSummary(user);
    expect(screen.getByTestId('hardware-system-wizard-submit')).toBeEnabled();
    await user.click(screen.getByTestId('hardware-system-wizard-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].input.accessories![0]!.heights).toEqual(['Alta']);
  });

  it('P1: un rechazo del plan frena «Siguiente» y no marca los pasos como completos', async () => {
    const user = userEvent.setup();
    setup();
    await fillIdentity(user);
    await user.click(screen.getByTestId('family-wizard-next'));
    await user.click(screen.getByTestId('family-heights-add'));
    await user.type(screen.getByTestId('family-height-0-label'), 'Alta-1');
    await user.type(screen.getByTestId('family-height-0-kh'), '100');
    await user.type(screen.getByTestId('family-height-0-price'), '0');
    await user.click(screen.getByTestId('family-heights-add'));
    await user.type(screen.getByTestId('family-height-1-label'), 'Alta 1');
    await user.type(screen.getByTestId('family-height-1-kh'), '120');
    await user.type(screen.getByTestId('family-height-1-price'), '0');
    expect(screen.getByTestId('hardware-system-wizard-plan-error').textContent).toContain('mismo código de juego');
    await user.click(screen.getByTestId('family-wizard-next'));
    expect(screen.getByTestId('family-wizard-title').textContent).toBe('Alturas');
    expect(screen.getByTestId('family-wizard-step-2')).toBeDisabled();
  });

  it('P2: el archivo elegido sigue visible al volver a Diseños 3D y se puede quitar', async () => {
    const user = userEvent.setup();
    setup();
    await fillBasics(user);
    await user.click(screen.getByTestId('family-wizard-next')); // Insertos
    await user.click(screen.getByTestId('family-wizard-next')); // Diseños 3D
    const input = screen.getAllByTestId(/^hardware-system-wizard-file-/)[0] as HTMLInputElement;
    const key = input.dataset.testid!.replace('hardware-system-wizard-file-', '');
    await user.upload(input, new File(['skp'], 'fijo.skp', { type: 'application/octet-stream' }));
    await user.click(screen.getByTestId('family-wizard-next')); // Resumen
    await user.click(screen.getByTestId('family-wizard-back')); // Diseños 3D
    const chosen = screen.getByTestId(`hardware-system-wizard-chosen-${key}`);
    expect(chosen.textContent).toContain('fijo.skp');
    await user.click(screen.getByRole('button', { name: /Quitar el archivo fijo\.skp/ }));
    expect(screen.queryByTestId(`hardware-system-wizard-chosen-${key}`)).toBeNull();
  });

  it('la plantilla no pisa alturas escritas sin confirmar', async () => {
    const user = userEvent.setup();
    setup();
    await fillIdentity(user);
    await user.click(screen.getByTestId('family-wizard-next'));
    await user.click(screen.getByTestId('family-heights-add'));
    await user.type(screen.getByTestId('family-height-0-label'), 'Mía');
    await user.click(screen.getByTestId('family-heights-template'));
    expect(screen.getByTestId('family-heights-template-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('family-height-0-label')).toHaveValue('Mía');
    await user.click(screen.getByTestId('family-heights-template-replace'));
    expect(screen.getByTestId('family-height-0-label')).toHaveValue('N');
  });

  it('el orden de los insertos se cambia con Subir/Bajar y llega así al plan', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await fillBasics(user, 'MBOX-SYS', { withE: true });
    await user.click(screen.getByTestId('family-wizard-next'));
    await user.click(screen.getByTestId('hardware-system-accessory-add'));
    await user.type(screen.getByTestId('hardware-system-accessory-0-name'), 'Galería');
    await user.click(screen.getByTestId('hardware-system-accessory-add'));
    await user.type(screen.getByTestId('hardware-system-accessory-1-name'), 'Boxcap');
    await user.click(screen.getByTestId('hardware-system-accessory-1-up'));
    await goToSummary(user);
    await user.click(screen.getByTestId('hardware-system-wizard-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].input.accessories!.map((a) => a.name)).toEqual(['Boxcap', 'Galería']);
  });
});

describe('HardwareKitSystemWizardModal — problemas visibles (#1552)', () => {
  it('etiqueta repetida en Alturas: mensaje con role=alert y Siguiente bloqueado', async () => {
    const user = userEvent.setup();
    setup();
    await fillBasics(user, 'MBOX-SYS', { withE: true });
    await user.clear(screen.getByTestId('family-height-1-label'));
    await user.type(screen.getByTestId('family-height-1-label'), 'm');
    await user.click(screen.getByTestId('family-wizard-next'));
    const problem = screen.getByTestId('hardware-system-wizard-plan-error');
    expect(problem).toHaveAttribute('role', 'alert');
    expect(problem.textContent).toContain('repetida');
    expect(screen.getByTestId('family-wizard-title').textContent).toBe('Alturas');
  });

  it('precio negativo: mensaje visible y sin llamada al store', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_req: HardwareKitSystemCreateRequest) => okResult);
    setup({ onSubmit });
    await fillBasics(user);
    await user.clear(screen.getByTestId('family-height-0-price'));
    await user.type(screen.getByTestId('family-height-0-price'), '-420');
    await user.click(screen.getByTestId('family-wizard-next'));
    const problem = screen.getByTestId('hardware-system-wizard-plan-error');
    expect(problem.textContent).toContain('precio');
    expect(screen.getByTestId('family-wizard-title').textContent).toBe('Alturas');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('código bloqueado: aviso en el Resumen con role=alert y envío bloqueado', async () => {
    const user = userEvent.setup();
    setup({ existingAgregadoCodes: ['MBOX-SYS-CAJON'] });
    await fillBasics(user);
    await goToSummary(user);
    const blocked = screen.getByTestId('hardware-system-wizard-blocked');
    expect(blocked).toHaveAttribute('role', 'alert');
    expect(blocked.textContent).toContain('MBOX-SYS-CAJON');
    expect(screen.getByTestId('hardware-system-wizard-submit')).toBeDisabled();
  });

  it('insertos duplicados o sin altura: aviso amable antes de avanzar', async () => {
    const user = userEvent.setup();
    setup();
    await fillBasics(user, 'MBOX-SYS', { withE: true });
    await user.click(screen.getByTestId('family-wizard-next'));
    await user.click(screen.getByTestId('hardware-system-accessory-add'));
    await user.type(screen.getByTestId('hardware-system-accessory-0-name'), 'Galería');
    await user.click(screen.getByTestId('hardware-system-accessory-add'));
    await user.type(screen.getByTestId('hardware-system-accessory-1-name'), 'galeria');
    await user.click(screen.getByTestId('family-wizard-next'));
    expect(screen.getByTestId('hardware-system-wizard-plan-error').textContent).toContain('mismo código');
    expect(screen.getByTestId('family-wizard-title').textContent).toBe('Insertos');
    await user.clear(screen.getByTestId('hardware-system-accessory-1-name'));
    await user.type(screen.getByTestId('hardware-system-accessory-1-name'), 'Boxcap');
    // Desmarcar la E preseleccionada deja al segundo inserto sin altura.
    await user.click(screen.getByTestId('hardware-system-accessory-1-height-E'));
    expect(screen.getByTestId('hardware-system-wizard-plan-error').textContent).toContain('ninguna altura');
  });
});

describe('HardwareKitSystemWizardModal — guard de subidas y cierre (#1552)', () => {
  it('archivo elegido sin servicio de recursos: error visible y sin llamada', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_req: HardwareKitSystemCreateRequest) => okResult);
    setup({ onSubmit });
    await fillBasics(user);
    await user.click(screen.getByTestId('family-wizard-next')); // Insertos
    await user.click(screen.getByTestId('family-wizard-next')); // Diseños 3D

    const fileInput = screen
      .getAllByTestId(/^hardware-system-wizard-file-/)
      .find((el) => !(el as HTMLInputElement).disabled) as HTMLInputElement;
    expect(fileInput).toBeDefined();
    await user.upload(fileInput, new File(['skp'], 'lateral.skp', { type: 'application/octet-stream' }));

    await goToSummary(user);
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
    await goToSummary(user);
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
    await goToSummary(user);
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
    // Vuelve al primer paso, sin alturas cargadas.
    expect(screen.getByTestId('family-wizard-step-0')).toHaveAttribute('aria-current', 'step');
  });

  it('un segundo sistema distinto se puede crear en la misma sesión', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_req: HardwareKitSystemCreateRequest) => okResult);
    const { view } = setup({ onSubmit });
    await fillBasics(user, 'MBOX-SYS');
    await goToSummary(user);
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

    await fillBasics(user, 'MBOX-OTRO');
    await goToSummary(user);
    await user.click(screen.getByTestId('hardware-system-wizard-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('hardware-system-wizard-result')).toBeTruthy();
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]?.[0]?.input.code).toBe('MBOX-OTRO');
  });
});
