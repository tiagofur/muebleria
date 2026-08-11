/**
 * Structure draft helpers — overrides round-trip (slice 3).
 */
import { describe, expect, it } from 'vitest';
import type { Structure } from '@muebles/domain';
import { emptyStructureDraft, structureToDraft } from './structureDraft';

describe('structureToDraft', () => {
  it('starts empty via emptyStructureDraft', () => {
    const d = emptyStructureDraft();
    expect(d.components).toEqual([]);
    expect(d.code).toBe('');
  });

  it('preserves per-instance spatial overrides', () => {
    const st: Structure = {
      id: 's1',
      code: 'EST-01',
      name: 'Cuerpo',
      externalDims: { width: 600, height: 720, depth: 560 },
      components: [
        {
          componentId: 'lat-1',
          quantity: 2,
          placementOverride: 'lateral_derecho',
          overrides: {
            xFormula: 'PW - T',
            rotateY: 180,
            lengthFormula: 'PH',
          },
        },
      ],
    };
    const draft = structureToDraft(st);
    expect(draft.components).toHaveLength(1);
    expect(draft.components[0]).toEqual({
      componentId: 'lat-1',
      quantity: 2,
      placementOverride: 'lateral_derecho',
      overrides: {
        xFormula: 'PW - T',
        rotateY: 180,
        lengthFormula: 'PH',
      },
    });
  });

  it('preserves agregados instances with position, dimensions, layoutDirection and gap', () => {
    const st: Structure = {
      id: 's1',
      code: 'EST-01',
      name: 'Cuerpo',
      agregados: [
        {
          id: 'inst-1',
          agregadoId: 'agr-cajon-1',
          name: 'Set de Cajones',
          quantity: 3,
          layoutDirection: 'vertical',
          gapMm: 3,
          position: { zFormula: '100' },
          dimensions: { widthFormula: 'W - 36', heightFormula: '600' },
          mirrored: false,
        },
      ],
    };
    const draft = structureToDraft(st);
    expect(draft.agregados).toHaveLength(1);
    expect(draft.agregados[0]).toEqual({
      id: 'inst-1',
      agregadoId: 'agr-cajon-1',
      name: 'Set de Cajones',
      quantity: 3,
      layoutDirection: 'vertical',
      gapMm: 3,
      position: { zFormula: '100' },
      dimensions: { widthFormula: 'W - 36', heightFormula: '600' },
      mirrored: false,
    });
  });
});
