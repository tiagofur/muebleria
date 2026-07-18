import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import {
  defaultMeasurePresetId,
  moduleHasMeasurePresets,
  pickPresetByMeasureDefaults,
  resolveModuleMeasurePreset,
  validateModulePresets,
} from './measurePresets';
import type { Module, Project } from './types';

function baseModule(over: Partial<Module> = {}): Module {
  return {
    id: 'mod-1',
    code: 'MOD-BASE',
    name: 'Base paramétrica',
    hardwareLines: [],
    ...over,
  };
}

const presets = [
  { id: 'p300', name: 'Ancho 300', width: 300, height: 720, depth: 560 },
  { id: 'p600', name: 'Ancho 600', width: 600, height: 720, depth: 560 },
] as const;

describe('measurePresets (H09 / #104)', () => {
  it('detects modules with commercial presets', () => {
    expect(moduleHasMeasurePresets(baseModule())).toBe(false);
    expect(moduleHasMeasurePresets(baseModule({ presets: [...presets] }))).toBe(
      true,
    );
  });

  it('defaults to the first commercial preset', () => {
    expect(defaultMeasurePresetId(baseModule({ presets: [...presets] }))).toBe(
      'p300',
    );
    expect(defaultMeasurePresetId(baseModule())).toBeUndefined();
  });

  it('resolves a valid measurePresetId', () => {
    const mod = baseModule({ presets: [...presets] });
    expect(resolveModuleMeasurePreset(mod, 'p600')).toEqual(presets[1]);
  });

  it('requires measurePresetId when the module has presets', () => {
    const mod = baseModule({ presets: [...presets] });
    expect(() => resolveModuleMeasurePreset(mod, undefined)).toThrow(
      ValidationError,
    );
    expect(() => resolveModuleMeasurePreset(mod, undefined)).toThrow(
      /Elegí un preset de medida/i,
    );
  });

  it('rejects an invalid measurePresetId', () => {
    const mod = baseModule({ presets: [...presets] });
    expect(() => resolveModuleMeasurePreset(mod, 'no-existe')).toThrow(
      /no es válido/i,
    );
  });

  it('rejects measurePresetId when the module has no presets', () => {
    expect(() =>
      resolveModuleMeasurePreset(baseModule(), 'p300'),
    ).toThrow(/no define presets/i);
  });

  it('returns undefined when fixed module has no presets and no id', () => {
    expect(resolveModuleMeasurePreset(baseModule(), undefined)).toBeUndefined();
  });

  it('validates commercial preset dimensions and unique ids', () => {
    expect(() =>
      validateModulePresets(
        baseModule({
          presets: [{ id: 'bad', width: 0, height: 720, depth: 560 }],
        }),
      ),
    ).toThrow(/mayores a 0/i);

    expect(() =>
      validateModulePresets(
        baseModule({
          presets: [
            { id: 'p1', width: 300, height: 720, depth: 560 },
            { id: 'p1', width: 400, height: 720, depth: 560 },
          ],
        }),
      ),
    ).toThrow(/duplicado/i);
  });
});

describe('pickPresetByMeasureDefaults (#109 / H14)', () => {
  // Module with presets varying in depth (560 vs 590 vs 600) — represents an
  // "inferior" type cabinet family.
  const inferiorMod = baseModule({
    furnitureType: 'inferior',
    presets: [
      { id: 'd560', name: 'Fondo 560', width: 600, height: 720, depth: 560 },
      { id: 'd590', name: 'Fondo 590', width: 600, height: 720, depth: 590 },
      { id: 'd600', name: 'Fondo 600', width: 600, height: 720, depth: 600 },
    ],
  });
  const superiorMod = baseModule({
    id: 'mod-sup',
    code: 'MOD-SUP',
    furnitureType: 'superior',
    presets: [
      { id: 's320', name: 'Fondo 320', width: 600, height: 720, depth: 320 },
      { id: 's350', name: 'Fondo 350', width: 600, height: 720, depth: 350 },
    ],
  });

  it('returns first preset when no project defaults', () => {
    expect(pickPresetByMeasureDefaults(inferiorMod, undefined)).toBe('d560');
    expect(pickPresetByMeasureDefaults(inferiorMod, null)).toBe('d560');
  });

  it('returns undefined when module has no presets', () => {
    expect(pickPresetByMeasureDefaults(baseModule(), undefined)).toBeUndefined();
  });

  it('respects the module furnitureType: superior default does not touch inferior module', () => {
    const defaults: Project['measureDefaults'] = {
      superior: { depth: 320 },
    };
    // inferior module → no entry for its type → first preset.
    expect(pickPresetByMeasureDefaults(inferiorMod, defaults)).toBe('d560');
    // superior module → matches its entry.
    expect(pickPresetByMeasureDefaults(superiorMod, defaults)).toBe('s320');
  });

  it('falls back to first preset when the type entry has no depth/height', () => {
    const defaults: Project['measureDefaults'] = {
      inferior: {},
    };
    expect(pickPresetByMeasureDefaults(inferiorMod, defaults)).toBe('d560');
  });

  it('picks the exact depth match when present', () => {
    const defaults: Project['measureDefaults'] = {
      inferior: { depth: 590 },
    };
    expect(pickPresetByMeasureDefaults(inferiorMod, defaults)).toBe('d590');
  });

  it('picks the closest depth when no exact match', () => {
    // default 580 → distance to 560=20, 590=10, 600=20 → picks 590.
    const defaults: Project['measureDefaults'] = {
      inferior: { depth: 580 },
    };
    expect(pickPresetByMeasureDefaults(inferiorMod, defaults)).toBe('d590');
  });

  it('combines depth + height distance', () => {
    const mod = baseModule({
      furnitureType: 'inferior',
      presets: [
        { id: 'a', width: 600, height: 720, depth: 560 },
        { id: 'b', width: 600, height: 900, depth: 560 },
        { id: 'c', width: 600, height: 900, depth: 600 },
      ],
    });
    // target depth 580 + height 900:
    //   a: |560-580| + |720-900| = 20 + 180 = 200
    //   b: 20 + 0 = 20  ← winner
    //   c: 20 + 0 = 20  (tie → first in order, b)
    const defaults: Project['measureDefaults'] = {
      inferior: { depth: 580, height: 900 },
    };
    expect(pickPresetByMeasureDefaults(mod, defaults)).toBe('b');
  });

  it('uses height only when depth not set', () => {
    const mod = baseModule({
      furnitureType: 'alto',
      presets: [
        { id: 'h2100', width: 600, height: 2100, depth: 600 },
        { id: 'h1800', width: 600, height: 1800, depth: 600 },
      ],
    });
    const defaults: Project['measureDefaults'] = {
      alto: { height: 2000 },
    };
    // distance: 2100→100, 1800→200 → picks h2100.
    expect(pickPresetByMeasureDefaults(mod, defaults)).toBe('h2100');
  });

  it('treats module without furnitureType as inferior', () => {
    const mod = baseModule({
      // no furnitureType → defaults to 'inferior'
      presets: [
        { id: 'x560', width: 600, height: 720, depth: 560 },
        { id: 'x600', width: 600, height: 720, depth: 600 },
      ],
    });
    const defaults: Project['measureDefaults'] = {
      inferior: { depth: 600 },
    };
    expect(pickPresetByMeasureDefaults(mod, defaults)).toBe('x600');
  });
});
