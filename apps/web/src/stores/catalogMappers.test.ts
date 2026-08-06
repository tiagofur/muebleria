import { describe, expect, it } from 'vitest';
import type { StructureDraft } from '@muebles/ui';
import { draftToStructure } from './catalogMappers';

describe('draftToStructure', () => {
  it('maps per-instance overrides onto Structure components', () => {
    const draft: StructureDraft = {
      code: 'EST-01',
      name: 'Cuerpo',
      widthMm: 600,
      heightMm: 720,
      depthMm: 560,
      notes: '',
      active: true,
      presets: [],
      components: [
        {
          componentId: 'lat-1',
          quantity: 1,
          placementOverride: 'lateral_izquierdo',
          overrides: {
            xFormula: '0',
            lengthFormula: 'PH',
            rotateX: 90,
          },
        },
      ],
    };
    const st = draftToStructure('s1', draft);
    expect(st.components?.[0]).toEqual({
      componentId: 'lat-1',
      quantity: 1,
      placementOverride: 'lateral_izquierdo',
      overrides: {
        xFormula: '0',
        lengthFormula: 'PH',
        rotateX: 90,
      },
    });
  });
});
