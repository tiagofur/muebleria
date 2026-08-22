/**
 * F144/#310 — Dimensiones libres por ítem: resolución y validación únicas.
 *
 * Orden de resolución: customDims (a medida) → preset comercial →
 * externalDims del módulo → fallback. Todos los consumidores de dims por
 * ítem (BOM/corte/precio/preview/plano) pasan por acá para que una medida
 * cambiada en Proyectar llegue íntegra a producción (North Star §16).
 */

import { resolveModuleMeasurePreset } from './measurePresets';
import type {
  ItemCustomDims,
  Module,
  ProjectItem,
  Structure,
} from './types';

/** Sanity bounds per side (mm). Commercial presets stay the sellable shortcut. */
export const CUSTOM_DIMS_MIN_MM = 50;
export const CUSTOM_DIMS_MAX_MM = 3000;

export const CUSTOM_DIMS_BOUNDS = {
  min: CUSTOM_DIMS_MIN_MM,
  max: CUSTOM_DIMS_MAX_MM,
} as const;

/** A composed (parametric) module can honor free dims; fixed modules cannot. */
export function moduleAcceptsCustomDims(module: Module): boolean {
  return Boolean(module.structureId);
}

export type CustomDimsIssue = {
  readonly field: 'module' | 'widthMm' | 'heightMm' | 'depthMm';
  readonly message: string;
};

/**
 * Validate free dims for a module. Returns issues in Spanish (they surface
 * inline in the inspector); empty array = valid.
 */
export function validateItemCustomDims(
  module: Module,
  dims: ItemCustomDims,
): readonly CustomDimsIssue[] {
  const issues: CustomDimsIssue[] = [];
  if (!moduleAcceptsCustomDims(module)) {
    issues.push({
      field: 'module',
      message: `“${module.name}” no es paramétrico: usá sus medidas comerciales.`,
    });
    return issues;
  }
  const check = (field: 'widthMm' | 'heightMm' | 'depthMm', label: string) => {
    const v = dims[field];
    if (!Number.isFinite(v) || !Number.isInteger(v)) {
      issues.push({ field, message: `${label} debe ser un número entero de mm.` });
      return;
    }
    if (v < CUSTOM_DIMS_MIN_MM || v > CUSTOM_DIMS_MAX_MM) {
      issues.push({
        field,
        message: `${label} debe estar entre ${CUSTOM_DIMS_MIN_MM} y ${CUSTOM_DIMS_MAX_MM} mm.`,
      });
    }
  };
  check('widthMm', 'Ancho');
  check('heightMm', 'Alto');
  check('depthMm', 'Profundidad');
  return issues;
}

export type ItemDimsSource = 'custom' | 'preset' | 'module' | 'fallback';

export type ItemDims = {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly source: ItemDimsSource;
};

const FALLBACK_DIMS: ItemDims = { width: 600, height: 720, depth: 560, source: 'fallback' };

/**
 * Single source of truth for a quote line's W/H/D (mm): item customDims win
 * over the commercial preset, then module/structure externalDims. Preset
 * resolution errors (stale preset id) fall through to module dims instead of
 * throwing — callers render what the catalog can still resolve.
 */
export function resolveItemDims(
  item: Pick<ProjectItem, 'customDims' | 'measurePresetId'>,
  module: Module | undefined,
  structure?: Pick<Structure, 'externalDims'> | undefined,
): ItemDims {
  if (item.customDims) {
    return {
      width: item.customDims.widthMm,
      height: item.customDims.heightMm,
      depth: item.customDims.depthMm,
      source: 'custom',
    };
  }
  if (module) {
    try {
      const preset = resolveModuleMeasurePreset(
        module,
        item.measurePresetId?.trim() || undefined,
      );
      if (preset) {
        return {
          width: preset.width,
          height: preset.height,
          depth: preset.depth,
          source: 'preset',
        };
      }
    } catch {
      /* stale/missing preset id → fall through to module dims */
    }
    if (module.externalDims) {
      return {
        width: module.externalDims.width,
        height: module.externalDims.height,
        depth: module.externalDims.depth,
        source: 'module',
      };
    }
    if (structure?.externalDims) {
      return {
        width: structure.externalDims.width,
        height: structure.externalDims.height,
        depth: structure.externalDims.depth,
        source: 'module',
      };
    }
  }
  return FALLBACK_DIMS;
}
