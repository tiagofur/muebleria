/**
 * @vitest-environment jsdom
 *
 * #1596 aceptación (vitest): alta de PAR con dos lados y offsets distintos;
 * «copiar al otro lado» sólo al pulsarlo (nunca espejo automático); los
 * offsets mostrados son los que se guardan; «Al abrir» viaja en la
 * declaración que el motor lee; el inserto creado desde un juego cae en su
 * selector en UNA mutación y un fallo del vínculo es visible y reintentable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Hardware, HardwarePiece } from '@granete/domain';
import { HardwareCatalog } from './HardwareCatalog';
import type { HardwareDraft } from './hardwareDraft';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const kitFixture: Hardware = {
  id: 'kit-e-1',
  code: 'MBOX-IRIDIUN-E',
  name: 'Merivobox Iridium E',
  unit: 'set',
  costPerUnit: 420,
  active: true,
};

function renderCatalog(opts: {
  onCreate?: ReturnType<typeof vi.fn>;
  onCreateInserto?: ReturnType<typeof vi.fn>;
}) {
  return render(
    <HardwareCatalog
      hardware={[kitFixture]}
      onCreate={opts.onCreate ?? vi.fn()}
      onUpdate={vi.fn()}
      onDeactivate={vi.fn()}
      onReactivate={vi.fn()}
      onCreateInserto={opts.onCreateInserto}
      onAddSystemHeight={vi.fn()}
      assetService={{} as never}
    />,
  );
}

/** userEvent trunca '-3' en inputs number de jsdom: cambio directo. */
const setOffsetValue = (testId: string, value: string) => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

async function openType(user: ReturnType<typeof userEvent.setup>, pick: string) {
  await user.click(screen.getByTestId('hardware-new-typed'));
  await user.click(screen.getByTestId(`hardware-type-pick-${pick}`));
}

describe('#1596 alta por tipo — par izquierda/derecha', () => {
  it('alta de par: dos lados con offsets distintos viajan al draft; «Al abrir» en designParts; unidad pieza', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue('id-1');
    renderCatalog({ onCreate });

    await openType(user, 'pair');
    const modal = screen.getByTestId('hardware-form-modal');
    expect(modal.textContent).toContain('Nuevo par izquierda/derecha');

    // Los dos lados existen desde ya con offsets explícitos (0 = lo que se
    // guardará si no se toca).
    const lx = screen.getByTestId('hardware-piece-left-offset-x') as HTMLInputElement;
    const rx = screen.getByTestId('hardware-piece-right-offset-x') as HTMLInputElement;
    expect(lx.value).toBe('0');
    expect(rx.value).toBe('0');

    await user.type(screen.getByLabelText('Código'), 'MBOX-IRIDIUN-E-GAL');
    await user.type(screen.getByLabelText('Nombre'), 'Par de galerías E');
    await user.clear(screen.getByLabelText('Precio del par'));
    await user.type(screen.getByLabelText('Precio del par'), '185');

    await user.clear(lx);
    await user.type(lx, '12.5');
    setOffsetValue('hardware-piece-right-offset-x', '-3');
    const lz = screen.getByTestId('hardware-piece-left-offset-z') as HTMLInputElement;
    await user.clear(lz);
    await user.type(lz, '91');

    // «Al abrir»: control visible, default fija; el inserto típico viaja con el cajón.
    const actor = screen.getByTestId('hardware-pieces-actor-select') as HTMLSelectElement;
    expect(actor.value).toBe('body');
    await user.selectOptions(actor, 'actor:drawer');

    fireEvent.submit(modal.querySelector('form')!);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

    const draft = onCreate.mock.calls[0]![0] as HardwareDraft;
    expect(draft.unit).toBe('piece');
    expect(draft.itemType).toBe('pair');
    expect(draft.costPerUnit).toBe(185);
    const left = draft.pieces?.find((p: HardwarePiece) => p.anchor === 'left');
    const right = draft.pieces?.find((p: HardwarePiece) => p.anchor === 'right');
    expect(left?.offsetMm).toEqual({ x: 12.5, y: 0, z: 91 });
    expect(right?.offsetMm).toEqual({ x: -3, y: 0, z: 0 });
    // La declaración que el motor ya lee (kitPieceMember → DesignParts[0]).
    expect(draft.designParts?.[0]?.actorMembership).toBe('actor:drawer');
    expect(draft.designParts?.[0]?.componentName).toBe('MBOX-IRIDIUN-E-GAL');
  });

  it('«copiar al otro lado» copia sólo al pulsarlo y nunca vuelve a espejar', async () => {
    const user = userEvent.setup();
    renderCatalog({ onCreate: vi.fn().mockResolvedValue('id-1') });

    await openType(user, 'pair');
    const lx = screen.getByTestId('hardware-piece-left-offset-x') as HTMLInputElement;
    const ly = screen.getByTestId('hardware-piece-left-offset-y') as HTMLInputElement;
    const rx = screen.getByTestId('hardware-piece-right-offset-x') as HTMLInputElement;

    await user.clear(lx);
    await user.type(lx, '20');
    await user.clear(ly);
    await user.type(ly, '5');
    expect((screen.getByTestId('hardware-piece-right-offset-x') as HTMLInputElement).value).toBe('0'); // sin espejo automático

    await user.click(screen.getByTestId('hardware-piece-left-copy'));
    expect((screen.getByTestId('hardware-piece-right-offset-x') as HTMLInputElement).value).toBe('20');
    expect((screen.getByTestId('hardware-piece-right-offset-y') as HTMLInputElement).value).toBe('5');

    // Editar el otro lado después NO toca el origen (sin espejo bidireccional).
    const rxAFTER = screen.getByTestId('hardware-piece-right-offset-x') as HTMLInputElement;
    await user.clear(rxAFTER);
    await user.type(rxAFTER, '99');
    expect((screen.getByTestId('hardware-piece-left-offset-x') as HTMLInputElement).value).toBe('20');
  });
});

describe('#1596 review B1 — par legacy con movimiento por nombre', () => {
  // Un par legacy cuyo movimiento declara el NOMBRE (-MOV/móvil) no lleva
  // designParts: el motor lo infiere. Al abrirlo en el alta nueva la fila se
  // siembra y al guardar VIAJA — si se sembrara 'body', el herraje dejaría
  // de viajar con el cajón sin que nadie lo pidiera.
  const legacyMovingPar: Hardware = {
    id: 'hw-gal-mov',
    code: 'MBOX-E-GAL-MOV',
    name: 'Galería móvil Iridium E',
    unit: 'piece',
    costPerUnit: 95,
    active: true,
    pieces: [{ anchor: 'left' }, { anchor: 'right' }],
  };
  const legacyFixedPar: Hardware = {
    ...legacyMovingPar,
    id: 'hw-gal-fija',
    code: 'MBOX-E-GAL-FIJA',
    name: 'Galería Iridium E',
  };

  async function roundTrip(item: Hardware, onUpdate: ReturnType<typeof vi.fn>) {
    const user = userEvent.setup();
    render(
      <HardwareCatalog
        hardware={[item]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={{ } as never}
      />,
    );
    await user.click(screen.getByText(item.code));
    await user.click(screen.getByRole('button', { name: `Editar ${item.code}` }));
    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    return onUpdate.mock.calls[0]![1] as HardwareDraft;
  }

  it('abrir+guardar un par -MOV mantiene actor:drawer y NO le inventa desfase (el motor dibuja en 0)', async () => {
    const onUpdate = vi.fn();
    const draft = await roundTrip(legacyMovingPar, onUpdate);
    expect(draft.itemType).toBe('pair');
    expect(draft.designParts?.[0]?.actorMembership).toBe('actor:drawer');
    expect(draft.pieces?.find((p) => p.anchor === 'left')?.offsetMm).toEqual({ x: 0, y: 0, z: 0 });
    expect(draft.pieces?.find((p) => p.anchor === 'right')?.offsetMm).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('abrir+guardar un par sin nombre móvil sigue sembrando fija al cuerpo', async () => {
    const draft = await roundTrip(legacyFixedPar, vi.fn());
    expect(draft.designParts?.[0]?.actorMembership).toBe('body');
  });
});

describe('#1596 alta por tipo — inserto para un juego', () => {
  it('se crea DESDE el juego en una mutación y un fallo del vínculo es visible y reintentable', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    let attempts = 0;
    const onCreateInserto = vi.fn().mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new Error('el selector no se pudo vincular (simulado)'));
      }
      return Promise.resolve('inserto-id');
    });
    renderCatalog({ onCreate, onCreateInserto });

    await user.click(screen.getByTestId('hardware-new-typed'));
    await user.selectOptions(screen.getByTestId('hardware-type-inserto-kit'), kitFixture.id);
    await user.click(screen.getByTestId('hardware-type-inserto-go'));

    const modal = screen.getByTestId('hardware-form-modal');
    expect(modal.textContent).toContain('Nuevo inserto para un juego');
    expect(modal.textContent).toContain('MBOX-IRIDIUN-E');

    await user.type(screen.getByLabelText('Código'), 'MBOX-IRIDIUN-E-BOCOV');
    await user.type(screen.getByLabelText('Nombre'), 'Par de BOXCOVER E');
    fireEvent.submit(modal.querySelector('form')!);

    // Fallo del vínculo: visible, con el draft intacto y reintento posible.
    await waitFor(() => expect(attempts).toBe(1));
    expect(screen.getByRole('alert').textContent).toContain('el selector no se pudo vincular');
    expect(screen.getByTestId('hardware-form-modal')).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled(); // sin herraje huérfano a medias

    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(screen.queryByTestId('hardware-form-modal')).toBeNull());
    // Sin selector previo, el alta lo nombra por el juego (visible en la UI).
    expect(onCreateInserto.mock.calls[0]).toEqual([
      expect.objectContaining({ code: 'MBOX-IRIDIUN-E-BOCOV' }),
      kitFixture.id,
      'Insertos de Merivobox Iridium E',
    ]);
  });
});
