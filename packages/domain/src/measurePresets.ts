/**
 * Commercial measure presets on Module (H09 / #104).
 * Structure is parametric; the furniture owns the sellable size list.
 */

import { ValidationError } from './errors';
import type { DimensionPreset, FurnitureType, Module, Project } from './types';

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

/**
 * Pick the module preset whose depth/height best match the project defaults
 * for the module's furniture type (#109 / H14).
 *
 * - Resolves the module type (`module.furnitureType ?? 'inferior'`).
 * - Reads the matching entry from `defaults`. If none, or no depth/height set,
 *   falls back to the first preset (== `defaultMeasurePresetId`).
 * - Otherwise picks the preset with the smallest absolute-mm distance, summed
 *   over the dimensions present in the project default (depth and/or height).
 *   Ties keep the first preset in definition order (stable).
 * - Returns `undefined` when the module has no presets (fixed-dims path).
 */
export function pickPresetByMeasureDefaults(
  module: Module,
  defaults?: Project['measureDefaults'] | null,
): string | undefined {
  const presets = module.presets ?? [];
  const first = presets[0];
  if (!first) return undefined;

  const type: FurnitureType = module.furnitureType ?? 'inferior';
  const target = defaults?.[type];
  const wantDepth = typeof target?.depth === 'number';
  const wantHeight = typeof target?.height === 'number';
  if (!wantDepth && !wantHeight) {
    return first.id;
  }

  let best = first;
  let bestDist = distanceFor(best, target, wantDepth, wantHeight);
  for (let i = 1; i < presets.length; i++) {
    const candidate = presets[i];
    if (!candidate) continue;
    const d = distanceFor(candidate, target, wantDepth, wantHeight);
    if (d < bestDist) {
      best = candidate;
      bestDist = d;
    }
  }
  return best.id;
}

function distanceFor(
  preset: DimensionPreset,
  target: { readonly depth?: number; readonly height?: number },
  wantDepth: boolean,
  wantHeight: boolean,
): number {
  let dist = 0;
  if (wantDepth && typeof target.depth === 'number') {
    dist += Math.abs(preset.depth - target.depth);
  }
  if (wantHeight && typeof target.height === 'number') {
    dist += Math.abs(preset.height - target.height);
  }
  return dist;
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
