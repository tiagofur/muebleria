import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/agregadoOffsetFormula.contract.json';
import { resolveAgregadoAssembly } from './agregadoAssembly';

describe('agregado offset formula Go/TS parity (#1418)', () => {
  it('resuelve la fórmula del ancla contra PW con redondeo a mm entero', () => {
    for (const c of fixture.cases as readonly { widthMm: number; expectedX: number }[]) {
      const resolved = resolveAgregadoAssembly(
        fixture.agregado as unknown as Parameters<typeof resolveAgregadoAssembly>[0],
        { widthMm: c.widthMm, depthMm: 500, heightMm: 150 },
      );
      expect(resolved.rigidMembers[0]?.localTransform.translationMm[0], `width ${c.widthMm}`).toBe(
        c.expectedX,
      );
    }
  });
});
