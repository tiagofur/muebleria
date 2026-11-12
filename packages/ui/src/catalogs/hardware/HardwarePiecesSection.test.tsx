/**
 * @vitest-environment jsdom
 *
 * #1518 F1 → rework #1596: sección de diseño del herraje — filas por ancla
 * con offsets x/y/z por lado; en modo genérico conserva el flujo #1518
 * (toggle, offsets sólo con pieza); «Quitar diseño» deja el lado con sus
 * offsets (mostrado = guardado) y el copy nombra el lado pendiente.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import type { HardwarePiece } from '@granete/domain';
import { HardwarePiecesSection } from './HardwarePiecesSection';
import type { HardwareDraft } from './hardwareDraft';

afterEach(() => {
  cleanup();
});

function SeededHarness({
  initialPieces,
  onDraft,
}: {
  initialPieces?: readonly HardwarePiece[];
  onDraft?: (d: readonly HardwarePiece[] | undefined) => void;
}): ReactNode {
  const [draft, setDraft] = useState<HardwareDraft>(
    () =>
      ({
        code: 'MBOX-IGM-M',
        name: 'Perfil MERIVOBOX M',
        visualAsset: { assetId: 'asset-global', assetRevisionId: 'rev-global' },
        ...(initialPieces ? { pieces: initialPieces } : {}),
      }) as unknown as HardwareDraft,
  );
  onDraft?.(draft.pieces);
  return (
    <>
      <HardwarePiecesSection
        draft={draft}
        setDraft={setDraft}
        canMutate
        assetService={{} as never}
      />
      <output data-testid="pieces-out">{JSON.stringify(draft.pieces ?? null)}</output>
    </>
  );
}

describe('HardwarePiecesSection (#1518 F1, rework #1596)', () => {
  it('sin piezas: fallback declarado, tres filas al abrir, nada que quitar', async () => {
    const user = userEvent.setup();
    render(<SeededHarness />);

    expect(screen.getByTestId('pieces-out').textContent).toBe('null');
    await user.click(screen.getByTestId('hardware-pieces-toggle'));
    for (const anchor of ['left', 'right', 'center']) {
      expect(screen.getByTestId(`hardware-piece-${anchor}`)).toBeDefined();
    }
    expect(screen.getAllByText(/Sin diseño/)).toHaveLength(3);
    expect(screen.queryByTestId('hardware-piece-left-clear')).toBeNull();
    expect(screen.queryByTestId('hardware-piece-left-offset-x')).toBeNull();
  });

  it('pieza sembrada: muestra revisión + offsets; quitar diseño conserva los offsets (#1596: mostrado = guardado)', async () => {
    const user = userEvent.setup();
    render(
      <SeededHarness
        initialPieces={[
          { anchor: 'left', asset: { assetId: 'a-l', assetRevisionId: 'r-l' }, offsetMm: { x: 10, y: 0, z: 120 } },
        ]}
      />,
    );
    // Sembrada, la sección abre desplegada.
    expect(screen.getByText(/Revisión r-l…/)).toBeDefined();
    const offX = screen.getByTestId('hardware-piece-left-offset-x') as HTMLInputElement;
    expect(offX.value).toBe('10');
    expect(screen.getByTestId('hardware-piece-left-clear')).toBeDefined();
    expect(screen.queryByTestId('hardware-piece-right-offset-x')).toBeNull();

    // #1596: quitar el diseño NO borra la fila — el lado queda pendiente
    // con sus offsets exactos (nada de defaults invisibles).
    await user.click(screen.getByTestId('hardware-piece-left-clear'));
    expect(screen.getAllByText(/Sin diseño \(queda pendiente\)/).length).toBeGreaterThan(0);
    const offXAfter = screen.getByTestId('hardware-piece-left-offset-x') as HTMLInputElement;
    expect(offXAfter.value).toBe('10');
    const persisted = JSON.parse(screen.getByTestId('pieces-out').textContent ?? 'null') as
      | { anchor: string; offsetMm?: { x: number } }[]
      | null;
    expect(persisted).toEqual([
      { anchor: 'left', offsetMm: { x: 10, y: 0, z: 120 } },
    ]);
  });
});
