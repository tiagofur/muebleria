/**
 * F144/#310 — Dimensiones libres por ítem: resolución y validación únicas.
 *
 * Orden de resolución: customDims (a medida) → preset comercial →
 * externalDims del módulo → fallback. Todos los consumidores de dims por
 * ítem (BOM/corte/precio/preview/plano) pasan por acá para que una medida
 * cambiada en Proyectar llegue íntegra a producción (North Star §16).
 */

import { resolveModuleMeasurePreset } from './measurePresets';
import { effectiveOptionChoices } from './optionChoices';
import { resolveBoardOptionChoiceId } from './plinth';
import type {
  Catalog,
  ItemCustomDims,
  Module,
  OptionChoices,
  PanelThicknessDim,
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

/**
 * #1496 — the panel's thickness axis, when declared on a `panel`-type module.
 * Undefined for every other module (or a panel without a declared axis).
 */
export function panelThicknessAxis(
  module: Pick<Module, 'furnitureType' | 'panelThicknessDim'>,
): PanelThicknessDim | undefined {
  return module.furnitureType === 'panel' ? module.panelThicknessDim : undefined;
}

/**
 * #1496 — replace the panel's thickness axis with the FRENTE material
 * thickness resolved from the item's option choices. Without a material
 * choice (or a missing material) the incoming dim is preserved — the
 * authored number is a display fallback, never an error. Plain modules
 * pass through untouched.
 *
 * Parity: backend-go internal/domain/engine resolveBomCommon applies the
 * same rule (contracts/panelThicknessParity.contract.json).
 */
export function applyPanelThicknessDim(
  module: Pick<Module, 'furnitureType' | 'panelThicknessDim'>,
  dims: { width: number; height: number; depth: number },
  optionChoices: OptionChoices | undefined,
  catalog: Pick<Catalog, 'materials'> | undefined,
): { width: number; height: number; depth: number } {
  const axis = panelThicknessAxis(module);
  if (!axis) return dims;
  const choiceId = optionChoices
    ? resolveBoardOptionChoiceId('FRENTE', optionChoices)
    : undefined;
  const material = choiceId
    ? catalog?.materials?.find((m) => m.id === choiceId)
    : undefined;
  const thickness = material?.thicknessMm;
  if (!thickness || thickness <= 0) return dims;
  return axis === 'width'
    ? { ...dims, width: thickness }
    : axis === 'height'
      ? { ...dims, height: thickness }
      : { ...dims, depth: thickness };
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
  // #1496: el eje del espesor de un panel no se valida acá — sale del material
  // de frentes y el resolver lo reemplaza después (customDims → dimsOverride →
  // applyPanelThicknessDim), así que el número autoreado de ese eje es
  // irrelevante. Los otros dos ejes se validan normalmente (UI y API no tienen
  // un guard dedicado para customDims de ítem: esta función es el control).
  const axis = panelThicknessAxis(module);
  const check = (field: 'widthMm' | 'heightMm' | 'depthMm', label: string) => {
    if (axis && field === `${axis}Mm`) return;
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
 * Material context to derive a panel's thickness dim (#1496). Optional:
 * without it the authored number stands (same degradation as the engine).
 */
export type PanelDimsContext = {
  readonly optionChoices?: OptionChoices;
  readonly projectLevelChoices?: OptionChoices;
  readonly materials?: readonly { readonly id: string; readonly thicknessMm: number }[];
};

/**
 * Single source of truth for a quote line's W/H/D (mm): item customDims win
 * over the commercial preset, then module/structure externalDims. Preset
 * resolution errors (stale preset id) fall through to module dims instead of
 * throwing — callers render what the catalog can still resolve.
 * When `panelCtx` is present and the module is a panel with a declared axis
 * (#1496), the axis dim is replaced by the FRENTE material thickness —
 * regardless of the source (a custom dims value on the axis is overridden,
 * never authored).
 */
export function resolveItemDims(
  item: Pick<ProjectItem, 'customDims' | 'measurePresetId'>,
  module: Module | undefined,
  structure?: Pick<Structure, 'externalDims'> | undefined,
  panelCtx?: PanelDimsContext,
): ItemDims {
  const derive = (dims: ItemDims): ItemDims => {
    if (!module || !panelCtx) return dims;
    // Per-key merge (F029/#35): project-level defaults + item overrides, the
    // same canonical merge pricing.ts feeds resolveBom — never a whole-object
    // fallback that drops inherited keys.
    const effectiveChoices = effectiveOptionChoices(
      panelCtx.optionChoices,
      panelCtx.projectLevelChoices,
    );
    const derived = applyPanelThicknessDim(
      module,
      dims,
      effectiveChoices,
      panelCtx.materials ? { materials: panelCtx.materials as Catalog['materials'] } : undefined,
    );
    return { ...dims, ...derived };
  };
  if (item.customDims) {
    return derive({
      width: item.customDims.widthMm,
      height: item.customDims.heightMm,
      depth: item.customDims.depthMm,
      source: 'custom',
    });
  }
  if (module) {
    try {
      const preset = resolveModuleMeasurePreset(
        module,
        item.measurePresetId?.trim() || undefined,
      );
      if (preset) {
        return derive({
          width: preset.width,
          height: preset.height,
          depth: preset.depth,
          source: 'preset',
        });
      }
    } catch {
      /* stale/missing preset id → fall through to module dims */
    }
    if (module.externalDims) {
      return derive({
        width: module.externalDims.width,
        height: module.externalDims.height,
        depth: module.externalDims.depth,
        source: 'module',
      });
    }
    if (structure?.externalDims) {
      return derive({
        width: structure.externalDims.width,
        height: structure.externalDims.height,
        depth: structure.externalDims.depth,
        source: 'module',
      });
    }
  }
  return derive(FALLBACK_DIMS);
}
