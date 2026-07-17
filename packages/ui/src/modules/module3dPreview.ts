/**
 * Pure helper: resolve composed module BOM for Part3DViewer.
 * Picks default measure preset when the module has commercial presets.
 */

import type {
  Catalog,
  DimensionPreset,
  Module,
  OptionGroup,
  ResolvedBoardPart,
  Structure,
  Component,
  MaterialBoard,
  EdgeBand,
  Hardware,
} from '@muebles/domain';
import {
  defaultMeasurePresetId,
  resolveBom,
  resolveModuleMeasurePreset,
} from '@muebles/domain';
import { DEFAULT_MODULE_FOOTPRINT_MM } from '../preview3d/project3dLayout';
import { defaultOptionChoicesForModule } from './moduleHelpers';

export type Module3DPreviewResult = {
  readonly parts: readonly ResolvedBoardPart[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly measurePresetId: string | undefined;
  readonly presets: readonly DimensionPreset[];
  readonly error: string | null;
  readonly empty: boolean;
};

export type Module3DCatalogInput = {
  readonly modules: readonly Module[];
  readonly structures: readonly Structure[];
  readonly components: readonly Component[];
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
  readonly optionGroups: readonly OptionGroup[];
};

function dimsFromModule(
  module: Module,
  measurePresetId: string | undefined,
  structures: readonly Structure[],
): { width: number; height: number; depth: number } {
  try {
    const preset = resolveModuleMeasurePreset(module, measurePresetId);
    if (preset) {
      return {
        width: preset.width,
        height: preset.height,
        depth: preset.depth,
      };
    }
  } catch {
    /* fall through */
  }

  if (module.externalDims) {
    return {
      width: module.externalDims.width,
      height: module.externalDims.height,
      depth: module.externalDims.depth,
    };
  }

  if (module.structureId) {
    const st = structures.find((s) => s.id === module.structureId);
    if (st?.externalDims) {
      return {
        width: st.externalDims.width,
        height: st.externalDims.height,
        depth: st.externalDims.depth,
      };
    }
  }

  return { ...DEFAULT_MODULE_FOOTPRINT_MM };
}

/**
 * Resolve 3D preview for a module template.
 * @param measurePresetIdOverride when user picks a commercial size in the modal
 */
export function resolveModule3DPreview(
  module: Module,
  catalogInput: Module3DCatalogInput,
  measurePresetIdOverride?: string | null,
): Module3DPreviewResult {
  const presets = module.presets ?? [];
  const measurePresetId =
    measurePresetIdOverride?.trim() ||
    defaultMeasurePresetId(module) ||
    undefined;

  const dims = dimsFromModule(
    module,
    measurePresetId,
    catalogInput.structures,
  );

  const choices = defaultOptionChoicesForModule(
    module,
    catalogInput.optionGroups,
    catalogInput.components,
    catalogInput.structures,
  );

  const catalog: Catalog = {
    materials: catalogInput.materials,
    edges: catalogInput.edges,
    hardware: catalogInput.hardware,
    optionGroups: catalogInput.optionGroups,
    modules: catalogInput.modules,
    structures: catalogInput.structures,
    components: catalogInput.components,
  };

  try {
    const bom = resolveBom(module, choices, catalog, measurePresetId);
    return {
      parts: bom.boardParts,
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
      measurePresetId,
      presets,
      error: null,
      empty: bom.boardParts.length === 0,
    };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'No se pudo resolver el armado 3D.';
    return {
      parts: [],
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
      measurePresetId,
      presets,
      error: message,
      empty: true,
    };
  }
}
