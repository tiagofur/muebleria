/**
 * componentDraft helpers — geometrySummary parametric labels (JD R3-S1).
 */
import { describe, expect, it } from 'vitest';
import type { Component } from '@granete/domain';
import { componentToDraft, draftToComponent, geometrySummary, type ComponentDraft } from './componentDraft';

const base: Component = {
  id: 'c1',
  code: 'COM-1',
  name: 'Test',
  placement: 'interno',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 500,
    widthMm: 300,
    thicknessMm: 18,
  },
  defaultEdges: [],
  optionRoles: ['INTERIOR'],
  active: true,
};

describe('geometrySummary', () => {
  it('shows base mm when no formulas', () => {
    expect(geometrySummary(base)).toBe('500×300×18 mm');
  });

  it('shows formula text instead of 0×0 base when formulas are set (R3-S1)', () => {
    const parametric: Component = {
      ...base,
      geometry: {
        kind: 'rectangular_board',
        lengthMm: 0,
        widthMm: 0,
        thicknessMm: 18,
        lengthFormula: 'PH - 31',
        widthFormula: 'PW - 31',
      },
    };
    expect(geometrySummary(parametric)).toBe('PH - 31×PW - 31×18 mm');
  });

  it('mixes formula and base when only one axis is parametric', () => {
    const mixed: Component = {
      ...base,
      geometry: {
        kind: 'rectangular_board',
        lengthMm: 0,
        widthMm: 120,
        thicknessMm: 18,
        lengthFormula: 'PW',
      },
    };
    expect(geometrySummary(mixed)).toBe('PW×120×18 mm');
  });
});

describe('componentToDraft construction seeding (#1052 slice 1)', () => {
  it('seeds the editor override from the persisted construction block', () => {
    const item = {
      id: 'c-piso',
      code: 'PISO',
      name: 'Piso',
      placement: 'interno',
      geometry: { kind: 'rectangular_board', lengthMm: 568, widthMm: 560, thicknessMm: 18 },
      defaultEdges: [],
      optionRoles: ['INTERIOR'],
      construction: {
        constructiveRole: 'horizontal',
        connectionFaces: ['left', 'right'],
        joinerySystemId: 'screw-only',
      },
      active: true,
    } as unknown as Component;
    const draft = componentToDraft(item);
    expect(draft.constructionOverride).toMatchObject({
      componentId: 'c-piso',
      constructiveRole: 'horizontal',
      connectionFaces: ['left', 'right'],
      joinerySystemId: 'screw-only',
    });
  });

  it('leaves the override empty when the entity has no block', () => {
    const item = {
      id: 'c-plain',
      code: 'LATERAL',
      name: 'Lateral',
      placement: 'lateral_izquierdo',
      geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 560, thicknessMm: 18 },
      defaultEdges: [],
      optionRoles: ['LATERAL'],
      active: true,
    } as unknown as Component;
    expect(componentToDraft(item).constructionOverride).toBeUndefined();
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
