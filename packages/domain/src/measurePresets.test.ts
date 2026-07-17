import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import {
  defaultMeasurePresetId,
  moduleHasMeasurePresets,
  resolveModuleMeasurePreset,
  validateModulePresets,
} from './measurePresets';
import type { Module } from './types';

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
