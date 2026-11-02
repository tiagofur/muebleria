/**
 * @vitest-environment jsdom
 *
 * #1460 Fase 1 — el kit manda: los miembros derivados del juego comercial se
 * muestran en UNA tarjeta resumen de solo lectura (Herrajes) y como filas
 * read-only con badge (Receta); lo añadido a mano conserva su tarjeta editable.
 */

import type { Dispatch, SetStateAction } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgregadoRigidMember, Hardware } from '@granete/domain';
import { AgregadoCajonHardwareSection } from './AgregadoCajonHardwareSection';
import { AgregadoRecipeAuthoringPanel } from './AgregadoRecipeAuthoringPanel';
import { createEmptyAgregadoDraft, type AgregadoDraft } from '../agregadoDraft';

afterEach(() => {
  cleanup();
});

const catalog = [
  { id: 'kit-1', code: 'CORR-KIT', name: 'Corredera juego 500', active: true, unit: 'set' },
  { id: 'mov-i', code: 'CORR-MOV-I', name: 'Corredera móvil izq', active: true, unit: 'piece', kitHardwareId: 'kit-1' },
  { id: 'mov-d', code: 'CORR-MOV-D', name: 'Corredera móvil der', active: true, unit: 'piece', kitHardwareId: 'kit-1' },
  { id: 'tir-1', code: 'TIR-200', name: 'Tirador 200', active: true, unit: 'piece', dimensions: { widthMm: 450, heightMm: 45, depthMm: 13 } },
] as unknown as Hardware[];

const kitMember = (memberId: string, hardwareId: string): AgregadoRigidMember =>
  ({
    memberId,
    role: 'rail',
    source: { kind: 'fixed', fixed: { hardwareId } },
    placement: {
      x: { ref: 'min', offsetMm: 0 },
      y: { ref: 'min', offsetMm: 0 },
      z: { ref: 'min', offsetMm: 0 },
    },
    bomRole: 'included_in_kit',
  }) as AgregadoRigidMember;

const ownMember = (): AgregadoRigidMember =>
  ({
    memberId: 'miembro-propio',
    role: 'handle',
    source: { kind: 'fixed', fixed: { hardwareId: 'tir-1' } },
    placement: {
      x: { ref: 'center', offsetMm: 0 },
      y: { ref: 'min', offsetMm: 0 },
      z: { ref: 'min', offsetMm: 0 },
    },
    bomRole: 'separately_purchased',
  }) as AgregadoRigidMember;

const draftWith = (
  rigidMembers: AgregadoRigidMember[],
  kitId: string | null = 'kit-1',
): AgregadoDraft => ({
  ...createEmptyAgregadoDraft(),
  commercialKitHardwareId: kitId ?? undefined,
  rigidMembers,
});

function renderSection(
  draft: AgregadoDraft,
  onEditKit?: (id: string) => void,
): Dispatch<SetStateAction<AgregadoDraft>> {
  const setDraft = vi.fn() as unknown as Dispatch<SetStateAction<AgregadoDraft>>;
  render(
    <AgregadoCajonHardwareSection
      draft={draft}
      setDraft={setDraft}
      catalogHardware={catalog}
      onAddMember={() => {}}
      onEditKit={onEditKit}
      testId="sec"
    />,
  );
  return setDraft;
}

/** patchDraft usa actualizadores funcionales: aplica el último al draft base. */
function lastDraftPatch(
  setDraft: Dispatch<SetStateAction<AgregadoDraft>>,
  base: AgregadoDraft,
): AgregadoDraft {
  const last = (setDraft as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
  return typeof last === 'function' ? last(base) : (last as AgregadoDraft);
}

describe('Herrajes — tarjeta única del kit (#1460 F1)', () => {
  it('los subitems del kit se resumen en UNA tarjeta; lo propio sigue editable', () => {
    renderSection(
      draftWith([kitMember('moving_rail_left', 'mov-i'), kitMember('moving_rail_right', 'mov-d'), ownMember()]),
    );

    const card = screen.getByTestId('sec-kit-card');
    expect(card.textContent).toContain('CORR-KIT');
    expect(card.textContent).toContain('2 herraje(s) incluido(s)');
    expect(screen.getByTestId('sec-kit-member-0').textContent).toContain(
      'moving_rail_left',
    );
    expect(screen.getByTestId('sec-kit-member-1').textContent).toContain(
      'CORR-MOV-D',
    );

    // Los derivados NO renderizan tarjeta editable (índices 0 y 1); el propio
    // conserva la suya con su índice original (2).
    expect(screen.queryByTestId('sec-member-0')).toBeNull();
    expect(screen.queryByTestId('sec-member-1')).toBeNull();
    expect(screen.getByTestId('sec-member-2')).toBeTruthy();
    expect(screen.getByTestId('sec-member-2-hardware')).toBeTruthy();
  });

  it('el CTA abre el juego en Catálogos con el id del kit', async () => {
    const user = userEvent.setup();
    const onEditKit = vi.fn();
    renderSection(draftWith([kitMember('moving_rail_left', 'mov-i')]), onEditKit);

    await user.click(screen.getByTestId('sec-kit-card-edit'));
    expect(onEditKit).toHaveBeenCalledWith('kit-1');
  });

  it('kit colgante (ya no existe en el catálogo) muestra alerta, no silencio', () => {
    renderSection(draftWith([kitMember('moving_rail_left', 'mov-i')], 'kit-fantasma'));
    expect(screen.getByTestId('sec-kit-card-missing')).toBeTruthy();
  });

  it('con kit y sin herrajes propios el vacío apunta a añadir, no a crear el par', () => {
    renderSection(draftWith([kitMember('moving_rail_left', 'mov-i')]));
    expect(screen.getByTestId('sec-empty').textContent).toContain(
      'juego comercial cubre',
    );
  });

  it('sin kit el estado vacío mantiene el texto histórico', () => {
    renderSection(draftWith([], null));
    expect(screen.getByTestId('sec-empty').textContent).toContain(
      'Sin herrajes del agregado',
    );
  });
});

describe('Receta — miembros del kit read-only (#1460 F1)', () => {
  it('el miembro derivado se muestra con badge y sin controles; el propio sigue editable', () => {
    const setDraft = vi.fn() as unknown as Dispatch<SetStateAction<AgregadoDraft>>;
    render(
      <AgregadoRecipeAuthoringPanel
        draft={draftWith([kitMember('moving_rail_left', 'mov-i'), ownMember()])}
        setDraft={setDraft}
        catalogHardware={catalog}
        saved={null}
        testId="rec"
      />,
    );

    const readOnly = screen.getByTestId('rec-member-0-kit');
    expect(readOnly.textContent).toContain('incluido en el juego');
    expect(readOnly.textContent).toContain('CORR-MOV-I');
    expect(readOnly.textContent).toContain('Catálogos');

    // El miembro propio conserva su tarjeta editable completa.
    expect(screen.queryByTestId('rec-member-0')).toBeNull();
    expect(screen.getByTestId('rec-member-1')).toBeTruthy();
    expect(screen.getByTestId('rec-member-1-id')).toBeTruthy();
  });
});

describe('Herrajes — posición visible y dimensiones del herraje propio (#1460 F2)', () => {
  it('X/Y/Z desde + desplazamiento están visibles sin expandir nada', () => {
    renderSection(draftWith([ownMember()], null));
    expect(screen.getByTestId('sec-member-0-anchor-x-ref')).toBeTruthy();
    expect(screen.getByTestId('sec-member-0-anchor-y-ref')).toBeTruthy();
    expect(screen.getByTestId('sec-member-0-anchor-z-ref')).toBeTruthy();
    expect(screen.getByTestId('sec-member-0-anchor-x-offset')).toBeTruthy();
  });

  it('«Centrar» fija X: mínimo + PW/2 (acompaña el ancho, igual que Receta)', () => {
    const setDraft = renderSection(draftWith([ownMember()], null));
    fireEvent.click(screen.getByTestId('sec-member-0-center-x'));

    const next = lastDraftPatch(setDraft, draftWith([ownMember()], null));
    expect(next.rigidMembers?.[0]?.placement.x).toEqual({
      ref: 'min',
      offsetMm: 0,
      offsetFormula: 'PW/2',
    });
  });

  it('las dimensiones aceptan mm y fórmula por eje; vacío vuelve al catálogo', () => {
    const base = draftWith([ownMember()], null);
    const setDraft = renderSection(base);

    fireEvent.change(screen.getByTestId('sec-member-0-dim-width'), {
      target: { value: '500' },
    });
    const conMm = lastDraftPatch(setDraft, base);
    expect(conMm.rigidMembers?.[0]?.dimensionOverrides).toEqual({
      width: { mm: 500 },
    });

    // La fórmula en otro eje se acumula sobre el override existente (el form
    // re-renderiza entre ediciones; el prop ya trae el width).
    cleanup();
    const conWidth = draftWith(
      [{ ...ownMember(), dimensionOverrides: { width: { mm: 500 } } } as AgregadoRigidMember],
      null,
    );
    const setDraft2 = renderSection(conWidth);
    fireEvent.change(screen.getByTestId('sec-member-0-dim-depth'), {
      target: { value: 'PD/10' },
    });
    const conFormula = lastDraftPatch(setDraft2, conWidth);
    expect(conFormula.rigidMembers?.[0]?.dimensionOverrides).toEqual({
      width: { mm: 500 },
      depth: { formula: 'PD/10' },
    });

    // Vaciar el único eje activo elimina el override completo (catálogo).
    cleanup();
    const setDraft3 = renderSection(conWidth);
    fireEvent.change(screen.getByTestId('sec-member-0-dim-width'), {
      target: { value: '' },
    });
    const limpio = lastDraftPatch(setDraft3, conWidth);
    expect(limpio.rigidMembers?.[0]?.dimensionOverrides).toBeUndefined();
  });

  it('muestra las medidas del catálogo como placeholder y el efectivo con override', () => {
    renderSection(
      draftWith([
        {
          ...ownMember(),
          dimensionOverrides: { width: { mm: 500 } },
        } as AgregadoRigidMember,
      ], null),
    );

    const width = screen.getByTestId(
      'sec-member-0-dim-width',
    ) as HTMLInputElement;
    expect(width.placeholder).toContain('450');
    expect(screen.getByTestId('sec-member-0-dims-effective').textContent).toContain(
      '500×45×13',
    );
  });

  it('fórmula que evalúa negativo muestra error en la tarjeta', () => {
    renderSection(
      draftWith([
        {
          ...ownMember(),
          dimensionOverrides: { width: { formula: 'PW - 99999' } },
        } as AgregadoRigidMember,
      ], null),
    );
    // draft vacío ⇒ PW=0 ⇒ 0 - 99999 = -99999 < 0.
    expect(screen.getByTestId('sec-member-0-dim-width-error')).toBeTruthy();
  });
});
