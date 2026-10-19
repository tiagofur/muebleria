/**
 * Pure helper: resolve composed module BOM for the 3D viewer (Furniture3DViewer / R3F).
 * Picks default measure preset when the module has commercial presets.
 */

import type {
  Agregado,
  Catalog,
  DimensionPreset,
  Module,
  OptionChoices,
  OptionGroup,
  ProjectedAssembly,
  ResolvedBoardPart,
  Structure,
  Component,
  MaterialBoard,
  EdgeBand,
  Hardware,
  AmbientMaterial,
  AmbientCategory,
} from '@granete/domain';
import {
  defaultMeasurePresetId,
  resolveBom,
  resolveModuleMeasurePreset,
} from '@granete/domain';
import { resolveModuleAssemblies } from '../preview3d/project3dPreview';
import { DEFAULT_MODULE_FOOTPRINT_MM } from '../preview3d/project3dLayout';
import { defaultOptionChoicesForModule } from './moduleHelpers';

export type Module3DPreviewResult = {
  readonly parts: readonly ResolvedBoardPart[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly measurePresetId: string | undefined;
  readonly presets: readonly DimensionPreset[];
  /** Effective option choices used for this resolve (defaults + overrides). */
  readonly optionChoices: OptionChoices;
  /**
   * Projected rigid-member assemblies of the module's (and its structure's)
   * agregados (#669) — same canonical path Proyectar uses. Empty when there
   * are none or when the recipe fails (diagnostic in `error`, parts kept).
   */
  readonly assemblies: readonly ProjectedAssembly[];
  readonly error: string | null;
  readonly empty: boolean;
};

export type Module3DCatalogInput = {
  readonly modules: readonly Module[];
  readonly structures: readonly Structure[];
  readonly components: readonly Component[];
  readonly agregados?: readonly Agregado[];
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
  readonly optionGroups: readonly OptionGroup[];
  /** Presentation-only ambient materials (floor/wall) for the 3D scene. */
  readonly ambientMaterials?: readonly AmbientMaterial[];
  /** Presentation-only ambient categories for hierarchical finishes. */
  readonly ambientCategories?: readonly AmbientCategory[];
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
 * @param optionChoicesOverride partial finish choices (merged over defaults)
 */
export function resolveModule3DPreview(
  module: Module,
  catalogInput: Module3DCatalogInput,
  measurePresetIdOverride?: string | null,
  optionChoicesOverride?: OptionChoices | null,
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

  const defaults = defaultOptionChoicesForModule(
    module,
    catalogInput.optionGroups,
    catalogInput.components,
    catalogInput.structures,
    catalogInput.agregados,
  );
  const choices: OptionChoices = {
    ...defaults,
    ...(optionChoicesOverride ?? {}),
  };

  const catalog: Catalog = {
    materials: catalogInput.materials,
    edges: catalogInput.edges,
    hardware: catalogInput.hardware,
    optionGroups: catalogInput.optionGroups,
    modules: catalogInput.modules,
    structures: catalogInput.structures,
    components: catalogInput.components,
    // Thread agregados so resolveBom -> resolveComposedModule can expand
    // module.agregados / structure.agregados into board parts. Without this,
    // agregado components never reach the editor preview BOM (#4181 — the
    // engine reads `catalog.agregados ?? []`). Mirrors resolveItemBom.
    agregados: catalogInput.agregados,
  };

  try {
    const bom = resolveBom(module, choices, catalog, measurePresetId);

    // #669: project the module's (and its structure's) agregado assemblies
    // through the same canonical path Proyectar uses. A recipe failure is an
    // honest diagnostic that keeps the resolved pieces — never an empty scene.
    let assemblies: readonly ProjectedAssembly[] = [];
    let assemblyError: string | null = null;
    try {
      assemblies = resolveModuleAssemblies(module, dims, catalogInput, {
        optionChoices: choices,
      });
    } catch (e) {
      assemblyError =
        e instanceof Error
          ? `No se pudo proyectar el ensamble del agregado: ${e.message}`
          : 'No se pudo proyectar el ensamble del agregado.';
    }

    return {
      parts: bom.boardParts,
      assemblies,
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
      measurePresetId,
      presets,
      optionChoices: choices,
      error: assemblyError,
      empty: bom.boardParts.length === 0 && assemblies.length === 0,
    };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'No se pudo resolver el armado 3D.';
    return {
      parts: [],
      assemblies: [],
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
      measurePresetId,
      presets,
      optionChoices: choices,
      error: message,
      empty: true,
    };
  }
}
