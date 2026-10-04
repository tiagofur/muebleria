/**
 * componentDraft helpers — geometrySummary parametric labels (JD R3-S1).
 */
import { describe, expect, it } from 'vitest';
import type { Component } from '@granete/domain';
import { componentToDraft, geometrySummary } from './componentDraft';

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
