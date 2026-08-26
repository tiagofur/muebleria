import { describe, expect, it } from 'vitest';
import type { ComponentDraft, StructureDraft } from '@granete/ui';
import { draftToComponent, draftToStructure } from './catalogMappers';

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
      agregados: [],
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

describe('draftToComponent', () => {
  it('preserves perforations on the update path (C2)', () => {
    const draft: ComponentDraft = {
      code: 'COM-PUE-01',
      name: 'Puerta',
      placement: 'puerta',
      lengthMm: 717,
      widthMm: 296,
      thicknessMm: 18,
      lengthFormula: '',
      widthFormula: '',
      xFormula: '',
      yFormula: '',
      zFormula: '',
      rotateX: null,
      rotateY: null,
      rotateZ: null,
      edgeL1: true,
      edgeL2: true,
      edgeW1: true,
      edgeW2: true,
      optionRoles: 'FRENTE',
      notes: '',
      active: true,
      perforations: [
        {
          id: 'perf-1',
          type: 'hinge_cup',
          diameterMm: 35,
          depthMm: 13,
          relativePosition: { xPercent: 0.05, yPercent: 0.5 },
        },
      ],
    };
    const entity = draftToComponent('c1', draft);
    expect(entity.perforations).toEqual(draft.perforations);
  });

  it('omits perforations on create when draft has none', () => {
    const draft: ComponentDraft = {
      code: 'COM-NEW',
      name: 'Nuevo',
      placement: 'interno',
      lengthMm: 100,
      widthMm: 100,
      thicknessMm: 18,
      lengthFormula: '',
      widthFormula: '',
      xFormula: '',
      yFormula: '',
      zFormula: '',
      rotateX: null,
      rotateY: null,
      rotateZ: null,
      edgeL1: false,
      edgeL2: false,
      edgeW1: false,
      edgeW2: false,
      optionRoles: 'INTERIOR',
      notes: '',
      active: true,
    };
    const entity = draftToComponent('c-new', draft);
    expect(entity.perforations).toBeUndefined();
  });
});
