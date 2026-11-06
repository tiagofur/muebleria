/**
 * @vitest-environment jsdom
 *
 * #1512 M3 S2: sección Manos (par D/I) del editor de herrajes — filas por
 * mano, labels honestos (sin asset propio = usa el global) y setHand
 * inmutable (vincular una mano no pisa la otra). El flujo del selector de
 * recursos tiene su propio suite (HardwareAssetSelectorModal).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import type { HardwareHands } from '@granete/domain';
import { HardwareHandsSection } from './HardwareHandsSection';
import type { HardwareDraft } from './hardwareDraft';

afterEach(() => {
  cleanup();
});

function SeededHarness({
  initialHands,
  onDraft,
}: {
  initialHands?: HardwareHands;
  onDraft?: (d: HardwareHands | undefined) => void;
}): ReactNode {
  const [draft, setDraft] = useState<HardwareDraft>(
    () =>
      ({
        code: 'MBOX-IGM-M',
        name: 'Perfil MERIVOBOX M',
        visualAsset: { assetId: 'asset-global', assetRevisionId: 'rev-global' },
        ...(initialHands ? { hands: initialHands } : {}),
      }) as unknown as HardwareDraft,
  );
  onDraft?.(draft.hands);
  return (
    <>
      <HardwareHandsSection
        draft={draft}
        setDraft={setDraft}
        canMutate
        assetService={{} as never}
      />
      <output data-testid="hands-out">{JSON.stringify(draft.hands ?? null)}</output>
    </>
  );
}

describe('HardwareHandsSection (#1512 S2)', () => {
  it('declara el fallback honesto y muestra ambas filas al abrir', async () => {
    const user = userEvent.setup();
    render(<SeededHarness />);

    const out = screen.getByTestId('hands-out');
    expect(out.textContent).toBe('null');

    await user.click(screen.getByTestId('hardware-hands-toggle'));
    expect(screen.getByTestId('hardware-hand-left')).toBeDefined();
    expect(screen.getByTestId('hardware-hand-right')).toBeDefined();
    // Sin asset propio, la UI lo declara (nunca lo oculta):
    expect(screen.getAllByText('Sin asset propio (usa el global)')).toHaveLength(2);
    // Sin asset no hay botón Quitar (nada que quitar).
    expect(screen.queryByTestId('hardware-hand-left-clear')).toBeNull();
  });

  it('una mano sembrada muestra su revisión y la otra sigue en fallback', async () => {
    let liveHands: HardwareHands | undefined;
    render(
      <SeededHarness
        initialHands={{ left: { asset: { assetId: 'a-l', assetRevisionId: 'r-l' } } }}
        onDraft={(h) => (liveHands = h)}
      />,
    );
    // Sembrada con manos, la sección abre desplegada (initial = Boolean(hands)).
    expect(screen.getByText('Revisión r-l…')).toBeDefined();
    expect(liveHands?.left?.asset?.assetId).toBe('a-l');
    // La derecha sin asset: fallback declarado + botón quitar sólo en la izquierda.
    expect(screen.getByText('Sin asset propio (usa el global)')).toBeDefined();
    expect(screen.getByTestId('hardware-hand-left-clear')).toBeDefined();
    expect(screen.queryByTestId('hardware-hand-right-clear')).toBeNull();
  });
});
