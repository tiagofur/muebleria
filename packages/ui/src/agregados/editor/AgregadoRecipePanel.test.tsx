/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Agregado, Hardware } from '@granete/domain';
import { AgregadoRecipePanel } from './AgregadoRecipePanel';

afterEach(() => {
  cleanup();
});

const saved: Agregado = {
  id: 'agr-1',
  code: 'AGR-CAJ',
  name: 'Cajón',
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

const catalogHardware: readonly Hardware[] = [
  { id: 'kit-1', code: 'KIT-400', name: 'Kit cajón', unit: 'piece', costPerUnit: 40, active: true },
];

const text = (id: string): string => screen.getByTestId(id).textContent ?? '';

describe('AgregadoRecipePanel (#1369 pestaña Receta read-only)', () => {
  it('muestra la receta guardada: miembros, sets, kit y compatibilidad', () => {
    render(
      <AgregadoRecipePanel saved={saved} catalogHardware={catalogHardware} testId="rp" />,
    );
    expect(text('rp-member-runner-left')).toContain('Incluido en el juego');
    expect(text('rp-set-vs-depth')).toContain('450 mm (runner-450)');
    expect(text('rp-kit')).toContain('KIT-400 — Kit cajón');
    expect(text('rp-rule-vs-depth')).toContain('holgura 20 mm');
    expect(text('rp')).toContain('dato versionado del catálogo');
  });

  it('ofrece «Simular cambio» y lo invoca', async () => {
    const onSimulateChange = vi.fn();
    render(
      <AgregadoRecipePanel
        saved={saved}
        catalogHardware={catalogHardware}
        onSimulateChange={onSimulateChange}
        testId="rp"
      />,
    );
    await userEvent.click(screen.getByTestId('agregado-editor-recipe-simulate'));
    expect(onSimulateChange).toHaveBeenCalledTimes(1);
  });

  it('sin agregado guardado muestra estado vacío y sin botón', () => {
    render(<AgregadoRecipePanel saved={null} catalogHardware={catalogHardware} testId="rp" />);
    expect(screen.getByText('Guardá el agregado para ver su receta.')).toBeTruthy();
    expect(screen.queryByTestId('agregado-editor-recipe-simulate')).toBeNull();
  });
});
