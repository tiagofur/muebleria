import { describe, expect, it } from 'vitest';
import {
  kitPlatePanelLocalX,
  kitPlateWorldTargetX,
} from './project3dPreview';
import parityFixture from '../../../../contracts/fixtures/kitPlateFaceParity.contract.json';

// #1592 — paridad TS↔Go de la placa fija (kit child body) de una bisagra de
// puerta: la placa se monta sobre la cara interior del costado del lado de
// la bisagra. El Go emite el absolute X (resolveHardwareOrKitToWorld); el TS
// compone el panel-local que la escena convierte al mismo world X a través
// del grupo volteado de la puerta (rotateY 180).
describe('kitPlateFaceParity (#1592)', () => {
  it.each(parityFixture.cases.map((c) => [c.id, c] as const))(
    '%s: la placa aterriza en la cara interior del costado',
    (_id, c) => {
      const world = kitPlateWorldTargetX(
        c.placementLocalXMm,
        c.board.widthMm,
        c.furnitureWidthMm,
        c.sideThicknessMm,
      );
      expect(world).toBeCloseTo(c.expectedWorldX, 6);

      const panelLocal = kitPlatePanelLocalX(c.board.x, c.board.widthMm, world);
      expect(panelLocal).toBeCloseTo(c.expectedPanelLocalX, 6);
    },
  );

  it('el branch de lado discrimina por la mitad del placement en el marco local', () => {
    // Mitad world-max (local pequeño) → cara interior del costado W − tSide.
    expect(kitPlateWorldTargetX(20.5, 397, 800, 15)).toBe(785);
    // Mitad world-min (local grande, receta PW−20.5 resuelta) → tSide.
    expect(kitPlateWorldTargetX(377, 397, 800, 15)).toBe(15);
    // Frontera exacta w/2 cae del lado world-max (determinístico, misma
    // dirección que el shift histórico).
    expect(kitPlateWorldTargetX(198.5, 397, 800, 15)).toBe(785);
  });
});
