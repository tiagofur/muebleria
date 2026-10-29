/**
 * @vitest-environment jsdom
 *
 * #1412 — pestaña Receta como AUTORÍA del borrador: miembros rígidos, sets de
 * variantes con su regla 1:1, kit comercial y membresía fijo/móvil (#1376).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import type { Hardware } from '@granete/domain';
import {
  AgregadoRecipeAuthoringPanel,
} from './AgregadoRecipeAuthoringPanel';
import { createEmptyAgregadoDraft, type AgregadoDraft } from '../agregadoDraft';

afterEach(() => {
  cleanup();
});

const catalogHardware: readonly Hardware[] = [
  { id: 'hw-corr', code: 'HER-CORR-TEL-50', name: 'Corredera Telescópica 500', unit: 'set', costPerUnit: 90, active: true },
  { id: 'hw-kit', code: 'KIT-CAJ', name: 'Kit cajón', unit: 'set', costPerUnit: 120, active: true },
];

function Harness({ onChange, initial }: { onChange?: (d: AgregadoDraft) => void; initial?: Partial<AgregadoDraft> }): ReactNode {
  const [draft, setDraft] = useState<AgregadoDraft>({
    ...createEmptyAgregadoDraft(),
    ...initial,
  });
  // Ref con el ÚLTIMO estado aplicado: los updaters funcionales del panel
  // deben encadenar contra el estado vigente, no contra el closure del render
  // (bajo batching de React un closure viejo reproduce el bug que S2 arregla).
  const latestRef = useRef<AgregadoDraft>({ ...createEmptyAgregadoDraft(), ...initial });
  const notify = (next: AgregadoDraft) => {
    latestRef.current = next;
    setDraft(next);
    onChange?.(next);
  };
  return (
    <AgregadoRecipeAuthoringPanel
      draft={draft}
      setDraft={(action) => {
        notify(
          typeof action === 'function'
            ? (action as (p: AgregadoDraft) => AgregadoDraft)(latestRef.current)
            : action,
        );
      }}
      catalogHardware={catalogHardware}
      saved={null}
    />
  );
}

const value = (id: string): string => {
  const el = screen.getByTestId(id) as HTMLInputElement | HTMLSelectElement;
  return el.value;
};

describe('AgregadoRecipeAuthoringPanel (#1412 autoría de receta)', () => {
  it('añade un miembro con defaults válidos y permite nombrarlo', async () => {
    const user = userEvent.setup();
    let latest: AgregadoDraft | undefined;
    render(<Harness onChange={(d) => (latest = d)} />);

    await user.click(screen.getByTestId('agregado-tab-recipe-authoring-add-member'));
    expect(latest?.rigidMembers).toHaveLength(1);
    expect(value('agregado-tab-recipe-authoring-member-0-id')).toBe('miembro-1');
    expect(latest?.rigidMembers[0]?.source.kind).toBe('fixed');
    expect(latest?.rigidMembers[0]?.bomRole).toBe('separately_purchased');

    const idInput = screen.getByTestId('agregado-tab-recipe-authoring-member-0-id');
    await user.clear(idInput);
    await user.type(idInput, 'guia-izq');
    expect(latest?.rigidMembers[0]?.memberId).toBe('guia-izq');
  });

  it('membresía fijo/móvil (#1376): body y actor:<id> se componen sobre el miembro', async () => {
    const user = userEvent.setup();
    let latest: AgregadoDraft | undefined;
    render(
      <Harness
        onChange={(d) => (latest = d)}
        initial={{
          rigidMembers: [
            {
              memberId: 'guia-izq',
              role: 'side_left',
              source: { kind: 'fixed', fixed: { hardwareId: 'hw-corr' } },
              placement: {
                x: { ref: 'min', offsetMm: 0 },
                y: { ref: 'min', offsetMm: 0 },
                z: { ref: 'min', offsetMm: 0 },
              },
              bomRole: 'included_in_kit',
            },
          ],
          commercialKitHardwareId: 'hw-kit',
        }}
      />,
    );

    await act(async () => {
      const select = screen.getByTestId('agregado-tab-recipe-authoring-member-0-membership');
      await user.selectOptions(select, 'body');
    });
    expect(latest?.rigidMembers[0]?.actorMembership).toBe('body');

    await act(async () => {
      await user.selectOptions(
        screen.getByTestId('agregado-tab-recipe-authoring-member-0-membership'),
        'actor',
      );
    });
    expect(latest?.rigidMembers[0]?.actorMembership).toBe('actor:drawer');

    const actorInput = screen.getByTestId('agregado-tab-recipe-authoring-member-0-membership-actor');
    await user.clear(actorInput);
    await user.type(actorInput, 'cajon-1');
    expect(latest?.rigidMembers[0]?.actorMembership).toBe('actor:cajon-1');
  });

  it('añadir un set crea su regla de compatibilidad 1:1 y eliminarlo la quita', async () => {
    const user = userEvent.setup();
    let latest: AgregadoDraft | undefined;
    render(<Harness onChange={(d) => (latest = d)} />);

    await user.click(screen.getByTestId('agregado-tab-recipe-authoring-add-set'));
    expect(latest?.variantSets).toHaveLength(1);
    expect(latest?.variantSets[0]?.id).toBe('set-fondo-1');
    expect(latest?.compatibilityRules).toEqual([
      { variantSetId: 'set-fondo-1', clearanceMm: 0, selectionStrategy: 'max_fitting' },
    ]);

    await user.click(screen.getByTestId('agregado-tab-recipe-authoring-set-0-remove'));
    expect(latest?.variantSets).toHaveLength(0);
    expect(latest?.compatibilityRules).toHaveLength(0);
  });

  it('un miembro con origen variante apunta al set existente', async () => {
    const user = userEvent.setup();
    let latest: AgregadoDraft | undefined;
    render(
      <Harness
        onChange={(d) => (latest = d)}
        initial={{
          variantSets: [
            {
              id: 'set-fondo-1',
              dimension: 'depth',
              variants: [{ nominalDimensionMm: 500, hardwareId: 'hw-corr' }],
            },
          ],
          compatibilityRules: [
            { variantSetId: 'set-fondo-1', clearanceMm: 0, selectionStrategy: 'max_fitting' },
          ],
        }}
      />,
    );

    await user.click(screen.getByTestId('agregado-tab-recipe-authoring-add-member'));
    await act(async () => {
      await user.selectOptions(
        screen.getByTestId('agregado-tab-recipe-authoring-member-0-source-kind'),
        'variant',
      );
    });
    expect(latest?.rigidMembers[0]?.source).toEqual({
      kind: 'variant',
      variant: { variantSetId: 'set-fondo-1' },
    });
  });

  it('renombrar el id de un set arrastra su regla y a los miembros variante (S2, sin huérfanos)', async () => {
    const user = userEvent.setup();
    let latest: AgregadoDraft | undefined;
    render(
      <Harness
        onChange={(d) => (latest = d)}
        initial={{
          rigidMembers: [
            {
              memberId: 'guia-izq',
              role: 'side_left',
              source: { kind: 'variant', variant: { variantSetId: 'viejo' } },
              placement: {
                x: { ref: 'min', offsetMm: 0 },
                y: { ref: 'min', offsetMm: 0 },
                z: { ref: 'min', offsetMm: 0 },
              },
              bomRole: 'included_in_kit',
            },
          ],
          variantSets: [
            {
              id: 'viejo',
              dimension: 'depth',
              variants: [{ nominalDimensionMm: 500, hardwareId: 'hw-corr' }],
            },
          ],
          compatibilityRules: [
            { variantSetId: 'viejo', clearanceMm: 20, selectionStrategy: 'max_fitting' },
          ],
        }}
      />,
    );

    const idInput = screen.getByTestId('agregado-tab-recipe-authoring-set-0-id');
    await user.click(idInput);
    await user.clear(idInput);
    await user.type(idInput, 'nuevo');

    expect(latest?.variantSets?.[0]?.id).toBe('nuevo');
    expect(latest?.compatibilityRules).toEqual([
      { variantSetId: 'nuevo', clearanceMm: 20, selectionStrategy: 'max_fitting' },
    ]);
    expect(latest?.rigidMembers?.[0]?.source).toEqual({
      kind: 'variant',
      variant: { variantSetId: 'nuevo' },
    });
  });
});
