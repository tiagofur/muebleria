/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  Agregado,
  Hardware,
  RecipeChangeSimulationResponse,
} from '@granete/domain';
import {
  RecipeChangeSimulationModal,
  type RecipeApplyResult,
  type RecipeChangeSimulationModalProps,
  type RecipeSimRequest,
  type RecipeSimResult,
} from './RecipeChangeSimulationModal';

afterEach(() => {
  cleanup();
});

const saved: Agregado = {
  id: 'agr-1',
  code: 'AGR-CAJ-500',
  name: 'Cajón MERIVOBOX',
  active: true,
  commercialKitHardwareId: 'kit-1',
  variantSets: [
    {
      id: 'vs-depth',
      dimension: 'depth',
      variants: [
        { nominalDimensionMm: 450, hardwareId: 'runner-450' },
        { nominalDimensionMm: 500, hardwareId: 'runner-500' },
      ],
    },
  ],
  rigidMembers: [
    {
      memberId: 'runner-left',
      role: 'guide_left',
      source: { kind: 'variant', variant: { variantSetId: 'vs-depth' } },
      bomRole: 'included_in_kit',
    },
  ] as unknown as Agregado['rigidMembers'],
  compatibilityRules: [
    { variantSetId: 'vs-depth', clearanceMm: 20, selectionStrategy: 'max_fitting' },
  ],
};

const baseAgregado: Agregado = {
  id: 'agr-1',
  code: 'AGR-CAJ-500',
  name: 'Cajón MERIVOBOX',
  active: true,
  commercialKitHardwareId: 'kit-1',
};

const catalogHardware: readonly Hardware[] = [
  { id: 'kit-1', code: 'KIT-400', name: 'Kit cajón 400', unit: 'piece', costPerUnit: 40, active: true },
  { id: 'kit-2', code: 'KIT-500', name: 'Kit cajón 500', unit: 'piece', costPerUnit: 45, active: true },
];

const okDiff: RecipeChangeSimulationResponse = {
  agregadoId: 'agr-1',
  currentVersion: 3,
  diff: {
    state: 'valid',
    params: { widthMm: 600, depthMm: 550, heightMm: 200 },
    candidateResolved: true,
    members: [
      {
        memberId: 'runner-right',
        change: 'moved',
        role: 'guide_right',
        translationDeltaMm: [-10, 0, 0],
      },
    ],
    boards: [
      {
        componentId: 'comp-bottom',
        change: 'resized',
        before: { widthMm: 565, lengthMm: 484, quantity: 1 },
        after: { widthMm: 555, lengthMm: 484, quantity: 1 },
      },
    ],
    variants: [
      {
        variantSetId: 'vs-depth',
        change: 'unchanged',
        before: { variantSetId: 'vs-depth', hardwareId: 'runner-500', nominalDimensionMm: 500 },
        after: { variantSetId: 'vs-depth', hardwareId: 'runner-500', nominalDimensionMm: 500 },
      },
    ],
    consumption: [],
    summary: { added: 0, removed: 0, moved: 1, resized: 1, rejected: 0, totalChanges: 2 },
  },
};

const noChangesDiff: RecipeChangeSimulationResponse = {
  agregadoId: 'agr-1',
  currentVersion: 3,
  diff: {
    state: 'no_changes',
    params: { widthMm: 600, depthMm: 550, heightMm: 200 },
    candidateResolved: true,
    members: [],
    boards: [],
    variants: [],
    consumption: [],
    summary: { added: 0, removed: 0, moved: 0, resized: 0, rejected: 0, totalChanges: 0 },
  },
};

const rejectedDiff: RecipeChangeSimulationResponse = {
  agregadoId: 'agr-1',
  currentVersion: 3,
  diff: {
    state: 'partially_invalid',
    params: { widthMm: 600, depthMm: 430, heightMm: 200 },
    candidateResolved: false,
    members: [],
    boards: [],
    variants: [
      {
        variantSetId: 'vs-depth',
        change: 'rejected',
        before: { variantSetId: 'vs-depth', hardwareId: 'runner-500', nominalDimensionMm: 500 },
        rejection: {
          requestedSpaceMm: 430,
          requiredClearanceMm: 20,
          availableNominals: [450, 500],
          fittingNominals: [450],
        },
      },
    ],
    consumption: [],
    summary: { added: 0, removed: 0, moved: 0, resized: 0, rejected: 1, totalChanges: 1 },
  },
};

const noop = (): void => undefined;

type SimFn = RecipeChangeSimulationModalProps['onSimulate'];
type ApplyFn = RecipeChangeSimulationModalProps['onApply'];

function renderModal(props: {
  readonly onSimulate: SimFn;
  readonly onApply?: ApplyFn;
  readonly onApplied?: (a: Agregado) => void;
}): ReturnType<typeof render> {
  return render(
    <RecipeChangeSimulationModal
      open
      agregado={saved}
      agregados={[baseAgregado]}
      catalogHardware={catalogHardware}
      onSimulate={props.onSimulate}
      onApply={props.onApply ?? (async () => ({ ok: true, applied: saved }))}
      onApplied={props.onApplied ?? noop}
      onClose={noop}
      testId="rcm"
    />,
  );
}

const text = (testId: string): string => screen.getByTestId(testId).textContent ?? '';

describe('RecipeChangeSimulationModal (#1369 slice 2)', () => {
  it('arranca en selección: subtítulo, selectores y primary «Simular»', async () => {
    renderModal({ onSimulate: async () => ({ ok: true, response: okDiff }) });
    expect(text('rcm-subtitle')).toBe('AGR-CAJ-500 — Cajón MERIVOBOX');
    expect(screen.getByTestId('rcm-base-select')).toBeTruthy();
    expect(screen.getByTestId('rcm-kit-select')).toBeTruthy();
    const primary = screen.getByTestId('rcm-primary');
    expect(primary.textContent).toBe('Simular');
    await userEvent.click(primary);
    await waitFor(() => expect(text('rcm-primary')).toBe('Confirmar y aplicar'));
    expect(text('rcm-live')).toBe('Simulación lista: 2 cambios');
    expect(text('rcm-diff')).toContain('runner-right');
    expect(text('rcm-diff')).toContain('-10 / 0 / 0 mm');
    expect(text('rcm-diff')).toContain('565 × 484 → 555 × 484 mm');
  });

  it('diff vacío: la primary pasa a «Cerrar» y nada se aplica', async () => {
    const onApplied = vi.fn();
    renderModal({ onSimulate: async () => ({ ok: true, response: noChangesDiff }), onApplied });
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(text('rcm-primary')).toBe('Cerrar'));
    await userEvent.click(screen.getByTestId('rcm-primary'));
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('variante rechazada: alternativas con radios, Confirmar deshabilitado y re-simulación al elegir', async () => {
    const onSimulate = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, response: rejectedDiff })
      .mockResolvedValueOnce({ ok: true, response: okDiff });
    renderModal({ onSimulate: onSimulate as unknown as RecipeChangeSimulationModalProps['onSimulate'] });

    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(screen.getByTestId('rcm-primary').textContent).toBe('Confirmar y aplicar'));
    const confirm = screen.getByTestId('rcm-primary') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(text('rcm-diff')).toContain('Elegí una alternativa válida:');

    const radio = screen.getByTestId('rcm-alternative-vs-depth-450') as HTMLInputElement;
    await userEvent.click(radio);

    // Re-simula con la selección explícita y habilita Confirmar.
    await waitFor(() => expect(onSimulate).toHaveBeenCalledTimes(2));
    const secondReq = onSimulate.mock.calls[1]![0] as unknown as {
      variantSelections?: Record<string, number>;
    };
    expect(secondReq.variantSelections).toEqual({ 'vs-depth': 450 });
    await waitFor(() => expect((screen.getByTestId('rcm-primary') as HTMLButtonElement).disabled).toBe(false));
  });

  it('sin alternativas que quepan: mensaje honesto y Confirmar bloqueado', async () => {
    const blocked: RecipeChangeSimulationResponse = {
      ...rejectedDiff,
      diff: {
        ...rejectedDiff.diff,
        variants: [
          {
            variantSetId: 'vs-depth',
            change: 'rejected',
            rejection: {
              requestedSpaceMm: 430,
              requiredClearanceMm: 20,
              availableNominals: [450, 500],
              fittingNominals: [],
            },
          },
        ],
      },
    };
    renderModal({ onSimulate: async () => ({ ok: true, response: blocked }) });
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(text('rcm-primary')).toBe('Confirmar y aplicar'));
    expect(text('rcm-diff')).toContain('Ninguna alternativa cabe con estas dimensiones.');
    expect((screen.getByTestId('rcm-primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('aplicar: éxito llama onApplied con la candidata y muestra «Receta actualizada»', async () => {
    const onApplied = vi.fn();
    renderModal({ onSimulate: async () => ({ ok: true, response: okDiff }), onApplied });
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(text('rcm-primary')).toBe('Confirmar y aplicar'));
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(screen.getByTestId('rcm-applied')).toBeTruthy());
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied.mock.calls[0]![0].id).toBe('agr-1');
  });

  it('el readback del store (nuevo objeto, mismo id) NO borra el estado aplicado', async () => {
    const onApplied = vi.fn();
    const { rerender } = renderModal({
      onSimulate: async () => ({ ok: true, response: okDiff }),
      onApplied,
    });
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(text('rcm-primary')).toBe('Confirmar y aplicar'));
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(screen.getByTestId('rcm-applied')).toBeTruthy());
    expect(onApplied).toHaveBeenCalledTimes(1);

    // El store actualizó el catálogo: el prop llega como un OBJETO NUEVO con
    // el mismo id (revisión aplicada). El estado de éxito debe sobrevivir.
    const updated: Agregado = { ...saved, commercialKitHardwareId: 'kit-2' };
    rerender(
      <RecipeChangeSimulationModal
        open
        agregado={updated}
        agregados={[updated]}
        catalogHardware={catalogHardware}
        onSimulate={async () => ({ ok: true, response: okDiff })}
        onApply={async () => ({ ok: true, applied: updated })}
        onApplied={onApplied}
        onClose={noop}
        testId="rcm"
      />,
    );
    expect(screen.getByTestId('rcm-applied')).toBeTruthy();
    expect(text('rcm-primary')).toBe('Listo');
  });

  it('412 en aplicar: banner de conflicto, diff intacto y «Volver a simular»', async () => {
    const onSimulate = vi
      .fn()
      .mockResolvedValue({ ok: true, response: okDiff });
    renderModal({
      onSimulate: onSimulate as unknown as SimFn,
      onApply: async () => ({
        ok: false,
        kind: 'conflict',
        message: 'Otra persona modificó esta receta mientras la revisabas. No se aplicó ningún cambio.',
      }),
    });
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(text('rcm-primary')).toBe('Confirmar y aplicar'));
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() =>
      expect(screen.getByText('Otra persona modificó esta receta mientras la revisabas. No se aplicó ningún cambio.')).toBeTruthy(),
    );
    expect(text('rcm-diff')).toContain('runner-right'); // diff intacto (atenuado)

    // «Volver a simular» es la primary del estado de conflicto.
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(onSimulate).toHaveBeenCalledTimes(2));
  });

  it('red cortada al aplicar: el diff queda y «Confirmar y aplicar» reintenta', async () => {
    let fail = true;
    renderModal({
      onSimulate: async () => ({ ok: true, response: okDiff }),
      onApply: async () =>
        fail
          ? { ok: false, kind: 'network', message: 'Se cortó la conexión al aplicar. El agregado quedó como estaba.' }
          : { ok: true, applied: saved },
    });
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(text('rcm-primary')).toBe('Confirmar y aplicar'));
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(text('rcm-banner')).toContain('Se cortó la conexión al aplicar'));
    expect(text('rcm-diff')).toContain('runner-right');
    fail = false;
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(screen.getByTestId('rcm-applied')).toBeTruthy());
  });

  it('red cortada al simular: mensaje y el modal queda en selección', async () => {
    renderModal({
      onSimulate: async () => ({ ok: false, kind: 'network', message: 'Sin conexión. Revisá tu conexión e intentá de nuevo.' }),
    });
    await userEvent.click(screen.getByTestId('rcm-primary'));
    await waitFor(() => expect(text('rcm-banner')).toContain('Sin conexión'));
    expect((screen.getByTestId('rcm-primary') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('rcm-diff')).toBeNull();
  });
});
