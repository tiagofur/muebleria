/**
 * Commercial measure presets on Module (H09 / #104).
 * Structure is parametric; the furniture owns the sellable size list.
 */

import { ValidationError } from './errors';
import type { DimensionPreset, Module } from './types';

export function moduleHasMeasurePresets(module: Module): boolean {
  return (module.presets?.length ?? 0) > 0;
}

/**
 * Resolve the commercial measure preset for a quote line.
 * When the module has presets, measurePresetId is required and must match.
 * When no presets, returns undefined (fixed / default dims path).
 */
export function resolveModuleMeasurePreset(
  module: Module,
  measurePresetId: string | undefined,
): DimensionPreset | undefined {
  const presets = module.presets ?? [];
  if (presets.length === 0) {
    if (measurePresetId?.trim()) {
      throw new ValidationError(
        `El mueble "${module.name}" (${module.code}) no define presets de medida; no se puede elegir una medida.`,
        {
          moduleCode: module.code,
          measurePresetId,
          field: 'measurePresetId',
        },
      );
    }
    return undefined;
  }

  if (!measurePresetId?.trim()) {
    throw new ValidationError(
      `Elegí un preset de medida para el mueble "${module.name}" (${module.code}).`,
      {
        moduleCode: module.code,
        field: 'measurePresetId',
      },
    );
  }

  const matched = presets.find((p) => p.id === measurePresetId);
  if (!matched) {
    throw new ValidationError(
      `El preset de medida no es válido para el mueble "${module.name}" (${module.code}).`,
      {
        moduleCode: module.code,
        measurePresetId,
        field: 'measurePresetId',
      },
    );
  }

  if (matched.width <= 0 || matched.height <= 0 || matched.depth <= 0) {
    throw new ValidationError(
      'Las dimensiones del preset deben ser mayores a 0',
      {
        moduleCode: module.code,
        measurePresetId: matched.id,
        field: 'presets',
      },
    );
  }

  return matched;
}

/** Default preset id when adding a line (first commercial option). */
export function defaultMeasurePresetId(module: Module): string | undefined {
  return module.presets?.[0]?.id;
}

export function validateModulePresets(module: Module): void {
  if (!module.presets) return;
  for (const preset of module.presets) {
    if (!preset.id?.trim()) {
      throw new ValidationError('Cada preset de medida necesita un id', {
        moduleCode: module.code,
        field: 'presets',
      });
    }
    if (preset.width <= 0 || preset.height <= 0 || preset.depth <= 0) {
      throw new ValidationError(
        'Las dimensiones del preset deben ser mayores a 0',
        {
          moduleCode: module.code,
          presetId: preset.id,
          field: 'presets',
        },
      );
    }
  }
  const ids = new Set<string>();
  for (const preset of module.presets) {
    if (ids.has(preset.id)) {
      throw new ValidationError(
        `Preset de medida duplicado: ${preset.id}`,
        {
          moduleCode: module.code,
          presetId: preset.id,
          field: 'presets',
        },
      );
    }
    ids.add(preset.id);
  }
}
