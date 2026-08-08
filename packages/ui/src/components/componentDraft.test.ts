/**
 * componentDraft helpers — geometrySummary parametric labels (JD R3-S1).
 */
import { describe, expect, it } from 'vitest';
import type { Component } from '@muebles/domain';
import { geometrySummary } from './componentDraft';

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
