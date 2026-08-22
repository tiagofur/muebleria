import { describe, expect, it } from 'vitest';
import {
  CUSTOM_DIMS_BOUNDS,
  moduleAcceptsCustomDims,
  resolveItemDims,
  validateItemCustomDims,
} from './itemDims';
import type { Module, ProjectItem } from './types';

function moduleOf(overrides: Partial<Module> = {}): Module {
  return {
    id: 'm1',
    code: 'BA600',
    name: 'Bajo 600',
    active: true,
    ...overrides,
  } as Module;
}

function itemOf(overrides: Partial<ProjectItem> = {}): ProjectItem {
  return { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {}, ...overrides };
}

describe('resolveItemDims', () => {
  it('customDims gana sobre preset y module', () => {
    const mod = moduleOf({
      structureId: 's1',
      presets: [{ id: 'p1', name: '600', width: 600, height: 720, depth: 560 }],
    });
    const dims = resolveItemDims(
      itemOf({
        measurePresetId: 'p1',
        customDims: { widthMm: 800, heightMm: 720, depthMm: 560 },
      }),
      mod,
    );
    expect(dims).toEqual({ width: 800, height: 720, depth: 560, source: 'custom' });
  });

  it('preset comercial cuando no hay customDims', () => {
    const mod = moduleOf({
      structureId: 's1',
      presets: [{ id: 'p1', name: '600', width: 600, height: 720, depth: 560 }],
    });
    const dims = resolveItemDims(itemOf({ measurePresetId: 'p1' }), mod);
    expect(dims).toEqual({ width: 600, height: 720, depth: 560, source: 'preset' });
  });

  it('module.externalDims cuando no hay presets', () => {
    const mod = moduleOf({ externalDims: { width: 500, height: 700, depth: 520 } });
    const dims = resolveItemDims(itemOf(), mod);
    expect(dims).toEqual({ width: 500, height: 700, depth: 520, source: 'module' });
  });

  it('preset stale cae a module dims sin lanzar', () => {
    const mod = moduleOf({
      structureId: 's1',
      presets: [{ id: 'p1', name: '600', width: 600, height: 720, depth: 560 }],
      externalDims: { width: 610, height: 730, depth: 570 },
    });
    const dims = resolveItemDims(itemOf({ measurePresetId: 'deleted' }), mod);
    expect(dims.source).toBe('module');
    expect(dims.width).toBe(610);
  });

  it('sin módulo → fallback', () => {
    expect(resolveItemDims(itemOf(), undefined).source).toBe('fallback');
  });
});

describe('validateItemCustomDims', () => {
  const parametric = moduleOf({ structureId: 's1' });

  it('acepta dims enteras dentro de bounds en módulo paramétrico', () => {
    expect(
      validateItemCustomDims(parametric, { widthMm: 800, heightMm: 900, depthMm: 450 }),
    ).toEqual([]);
  });

  it('rechaza módulo no paramétrico', () => {
    const fixed = moduleOf({});
    expect(moduleAcceptsCustomDims(fixed)).toBe(false);
    const issues = validateItemCustomDims(fixed, {
      widthMm: 800,
      heightMm: 900,
      depthMm: 450,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe('module');
    expect(issues[0]!.message).toContain('no es paramétrico');
  });

  it('rechaza fuera de bounds y no enteros', () => {
    expect(
      validateItemCustomDims(parametric, {
        widthMm: CUSTOM_DIMS_BOUNDS.min - 1,
        heightMm: 900,
        depthMm: 450,
      }).map((i) => i.field),
    ).toEqual(['widthMm']);
    expect(
      validateItemCustomDims(parametric, {
        widthMm: 800,
        heightMm: CUSTOM_DIMS_BOUNDS.max + 1,
        depthMm: 450,
      }).map((i) => i.field),
    ).toEqual(['heightMm']);
    expect(
      validateItemCustomDims(parametric, {
        widthMm: 800.5,
        heightMm: 900,
        depthMm: 450,
      }).map((i) => i.field),
    ).toEqual(['widthMm']);
  });
});
