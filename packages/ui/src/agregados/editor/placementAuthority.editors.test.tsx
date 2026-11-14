/**
 * @vitest-environment jsdom
 *
 * #1625 — la posición X/Y/Z que el motor reescribe desde el catálogo (pieza
 * por lado o etiqueta pos:) sale en solo lectura en los DOS editores de
 * receta; la rotación sigue editable. Las partes de los juegos por altura
 * cuentan como partes del juego.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import type { AgregadoRigidMember, Hardware } from '@granete/domain';
import { AgregadoRecipeAuthoringPanel } from './AgregadoRecipeAuthoringPanel';
import { AgregadoCajonHardwareSection } from './AgregadoCajonHardwareSection';
import { createEmptyAgregadoDraft, type AgregadoDraft } from '../agregadoDraft';

afterEach(() => cleanup());

const catalogHardware: readonly Hardware[] = [
  { id: 'hw-corr', code: 'HER-CORR', name: 'Corredera', unit: 'set', costPerUnit: 90, active: true },
  {
    id: 'hw-perfil', code: 'MBOX-PERFIL', name: 'Perfil MERIVOBOX', unit: 'piece', costPerUnit: 80, active: true,
    pieces: [
      { anchor: 'left', offsetMm: { x: 4, y: 136, z: 0 } },
      { anchor: 'right', offsetMm: { x: 4, y: 136, z: 0 } },
    ],
  },
  {
    id: 'hw-label', code: 'SUELTO-POS', name: 'Pieza con etiqueta', unit: 'piece', costPerUnit: 5, active: true,
    designParts: [{ componentName: 'x', actorMembership: 'body', label: 'pos:max:12:0:0' }],
  },
  { id: 'kit-e', code: 'MBOX-E', name: 'Juego E', unit: 'set', costPerUnit: 300, active: true },
  { id: 'hw-e-parte', code: 'MBOX-E-FIJ', name: 'Fijador E', unit: 'piece', costPerUnit: 0, active: true, kitHardwareId: 'kit-e' },
];

const member = (hardwareId: string, hand?: 'left' | 'right'): AgregadoRigidMember => ({
  memberId: `m-${hardwareId}`,
  role: 'part',
  source: { kind: 'fixed', fixed: { hardwareId } },
  placement: {
    x: { ref: 'min', offsetMm: 10 },
    y: { ref: 'min', offsetMm: 0 },
    z: { ref: 'min', offsetMm: 0 },
  },
  bomRole: 'separately_purchased',
  ...(hand ? { hand } : {}),
});

function Harness({
  initial,
  editor,
}: {
  initial: Partial<AgregadoDraft>;
  editor: 'recipe' | 'cajon';
}): ReactNode {
  const [draft, setDraft] = useState<AgregadoDraft>({ ...createEmptyAgregadoDraft(), ...initial });
  return editor === 'recipe' ? (
    <AgregadoRecipeAuthoringPanel draft={draft} setDraft={setDraft} catalogHardware={catalogHardware} saved={null} />
  ) : (
    <AgregadoCajonHardwareSection draft={draft} setDraft={setDraft} catalogHardware={catalogHardware} onAddMember={vi.fn()} />
  );
}

const editors = [
  { editor: 'recipe' as const, prefix: 'agregado-tab-recipe-authoring' },
  { editor: 'cajon' as const, prefix: 'agregado-cajon-hardware' },
];

describe.each(editors)('editor $editor (#1625)', ({ editor, prefix }) => {
  it('pieza por lado con mano: X/Y/Z en solo lectura y el aviso dice dónde se edita', () => {
    render(<Harness editor={editor} initial={{ rigidMembers: [member('hw-perfil', 'left')] }} />);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect((screen.getByTestId(`${prefix}-member-0-anchor-${axis}-offset`) as HTMLInputElement).readOnly).toBe(true);
      expect((screen.getByTestId(`${prefix}-member-0-anchor-${axis}-ref`) as HTMLSelectElement).disabled).toBe(true);
    }
    // Muestra la posición que usa el motor (la de la pieza), no la guardada (x=10).
    expect((screen.getByTestId(`${prefix}-member-0-anchor-x-offset`) as HTMLInputElement).value).toBe('4');
    expect((screen.getByTestId(`${prefix}-member-0-anchor-y-offset`) as HTMLInputElement).value).toBe('136');
    const note = screen.getByTestId(`${prefix}-member-0-placement-locked`);
    expect(note.textContent).toContain('MBOX-PERFIL');
    expect(note.textContent).toContain('lado izquierdo');
    expect(note.textContent).toContain('Diseño — un SKP por lado');
  });

  it('etiqueta pos: en herraje sin piezas: solo lectura con su propio aviso', () => {
    render(<Harness editor={editor} initial={{ rigidMembers: [member('hw-label')] }} />);
    expect((screen.getByTestId(`${prefix}-member-0-anchor-x-offset`) as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByTestId(`${prefix}-member-0-anchor-x-offset`) as HTMLInputElement).value).toBe('12');
    expect((screen.getByTestId(`${prefix}-member-0-anchor-x-ref`) as HTMLSelectElement).value).toBe('max');
    expect(screen.getByTestId(`${prefix}-member-0-placement-locked`).textContent).toContain('Partes del diseño');
  });

  it('herraje sin piezas ni etiqueta: la posición sigue editable y no hay aviso', () => {
    render(<Harness editor={editor} initial={{ rigidMembers: [member('hw-corr')] }} />);
    expect((screen.getByTestId(`${prefix}-member-0-anchor-x-offset`) as HTMLInputElement).readOnly).toBe(false);
    expect((screen.getByTestId(`${prefix}-member-0-anchor-x-offset`) as HTMLInputElement).value).toBe('10');
    expect((screen.getByTestId(`${prefix}-member-0-anchor-x-ref`) as HTMLSelectElement).disabled).toBe(false);
    expect(screen.queryByTestId(`${prefix}-member-0-placement-locked`)).toBeNull();
  });

  it('herraje con piezas pero miembro sin mano (legacy): editable, el motor no lo toca', () => {
    render(<Harness editor={editor} initial={{ rigidMembers: [member('hw-perfil')] }} />);
    expect((screen.getByTestId(`${prefix}-member-0-anchor-x-offset`) as HTMLInputElement).readOnly).toBe(false);
    expect(screen.queryByTestId(`${prefix}-member-0-placement-locked`)).toBeNull();
  });
});

describe('#1625 — partes de los juegos por altura', () => {
  const withVariantKit: Partial<AgregadoDraft> = {
    variantSets: [
      { id: 'vs-h', dimension: 'height', variants: [{ nominalDimensionMm: 209, hardwareId: 'kit-e', commercialKitHardwareId: 'kit-e' }] },
    ],
    rigidMembers: [member('hw-e-parte')],
  };

  it('Receta: la parte del juego E sale como «incluido en el juego», no como tarjeta editable', () => {
    render(<Harness editor="recipe" initial={withVariantKit} />);
    expect(screen.getByTestId('agregado-tab-recipe-authoring-member-0-kit')).toBeTruthy();
    expect(screen.queryByTestId('agregado-tab-recipe-authoring-member-0-anchor-x-offset')).toBeNull();
  });

  it('Herrajes del cajón: la parte del juego E no queda entre los herrajes propios editables', () => {
    render(<Harness editor="cajon" initial={withVariantKit} />);
    expect(screen.queryByTestId('agregado-cajon-hardware-member-0-anchor-x-offset')).toBeNull();
    // Sin juego principal, la parte sigue visible en solo lectura (nunca oculta).
    expect(screen.getByTestId('agregado-cajon-hardware-kit-member-0').textContent).toContain('MBOX-E-FIJ');
  });
});

describe('review #1626 — juego principal colgante', () => {
  it('Herrajes del cajón: con un juego principal que ya no existe, las partes por altura siguen visibles', () => {
    render(
      <Harness
        editor="cajon"
        initial={{
          commercialKitHardwareId: 'kit-borrado',
          variantSets: [
            { id: 'vs-h', dimension: 'height', variants: [{ nominalDimensionMm: 209, hardwareId: 'kit-e', commercialKitHardwareId: 'kit-e' }] },
          ],
          rigidMembers: [member('hw-e-parte')],
        }}
      />,
    );
    expect(screen.getByTestId('agregado-cajon-hardware-kit-member-0').textContent).toContain('MBOX-E-FIJ');
  });
});
