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

  it('maps canOpen and maxOpeningAngleDeg from draft to component entity (#529)', () => {
    const draft: ComponentDraft = {
      code: 'COM-DOOR',
      name: 'Puerta Derecha',
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
      canOpen: true,
      maxOpeningAngleDeg: '95',
    };
    const entity = draftToComponent('c-door', draft);
    expect(entity.canOpen).toBe(true);
    expect(entity.maxOpeningAngleDeg).toBe(95);
  });
});

describe('draftToComponent construction block (#1052 slice 1)', () => {
  const baseDraft = (): ComponentDraft => ({
    code: 'PISO',
    name: 'Piso',
    placement: 'interno',
    lengthMm: 568,
    widthMm: 560,
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
  });

  it('persists role, faces and joinery system from the draft override', () => {
    const draft = baseDraft();
    draft.constructionOverride = {
      componentId: 'c1',
      constructiveRole: 'horizontal',
      connectionFaces: ['left', 'right'],
      joinerySystemId: 'screw-only',
      stationsCount: 4,
      provenance: 'component',
    };
    const entity = draftToComponent('c1', draft);
    expect(entity.construction).toEqual({
      constructiveRole: 'horizontal',
      connectionFaces: ['left', 'right'],
      joinerySystemId: 'screw-only',
    });
  });

  it('omits the block when the override carries no persistable field', () => {
    const draft = baseDraft();
    // Station scalars alone are overlay-only (#875): the entity stays clean.
    draft.constructionOverride = {
      componentId: 'c1',
      stationsCount: 4,
      startMarginMm: 50,
      endMarginMm: 50,
      provenance: 'component',
    };
    expect(draftToComponent('c1', draft).construction).toBeUndefined();
    expect(draftToComponent('c1', baseDraft()).construction).toBeUndefined();
  });
});
