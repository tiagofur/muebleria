/**
 * Resolve all (or one) project line items into a linear kitchen-run 3D layout.
 */

import type {
  Catalog,
  Module,
  OptionChoices,
  Project,
  ProjectItem,
  ResolvedBoardPart,
} from '@muebles/domain';
import {
  defaultMeasurePresetId,
  resolveBom,
  resolveModuleMeasurePreset,
} from '@muebles/domain';
import { defaultOptionChoicesForModule } from '../modules/moduleHelpers';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import {
  DEFAULT_MODULE_FOOTPRINT_MM,
  layoutProjectRun,
  type PlacedModuleFootprint,
} from './project3dLayout';

export type ProjectModule3DInstance = {
  readonly instanceKey: string;
  readonly itemId: string;
  readonly moduleId: string;
  readonly label: string;
  readonly parts: readonly ResolvedBoardPart[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  readonly error: string | null;
};

export type Project3DPreviewResult = {
  readonly modules: readonly ProjectModule3DInstance[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly totalDepth: number;
  readonly empty: boolean;
  readonly errors: readonly string[];
};

function dimsForModule(
  module: Module,
  measurePresetId: string | undefined,
  structures: Module3DCatalogInput['structures'],
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

function resolveItemBom(
  item: ProjectItem,
  module: Module,
  project: Project,
  catalogInput: Module3DCatalogInput,
): {
  parts: readonly ResolvedBoardPart[];
  width: number;
  height: number;
  depth: number;
  error: string | null;
} {
  const measurePresetId =
    item.measurePresetId?.trim() ||
    defaultMeasurePresetId(module) ||
    undefined;
  const dims = dimsForModule(
    module,
    measurePresetId,
    catalogInput.structures,
  );

  const defaults = defaultOptionChoicesForModule(
    module,
    catalogInput.optionGroups,
    catalogInput.components,
    catalogInput.structures,
  );
  const choices: OptionChoices = {
    ...defaults,
    ...(project.projectLevelChoices ?? {}),
    ...item.optionChoices,
  };

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
      ...dims,
      error:
        bom.boardParts.length === 0
          ? 'Sin piezas (faltan estructura/componentes).'
          : null,
    };
  } catch (e) {
    return {
      parts: [],
      ...dims,
      error: e instanceof Error ? e.message : 'Error al resolver el mueble.',
    };
  }
}

export type ResolveProject3DOptions = {
  /** If set, only this line item (and its quantity copies). */
  readonly itemId?: string;
};

/**
 * Build a linear run of cabinets from a project quote.
 */
export function resolveProject3DPreview(
  project: Project,
  catalogInput: Module3DCatalogInput,
  options: ResolveProject3DOptions = {},
): Project3DPreviewResult {
  const items = options.itemId
    ? project.items.filter((it) => it.id === options.itemId)
    : project.items;

  type ResolvedRow = {
    item: ProjectItem;
    module: Module | undefined;
    parts: readonly ResolvedBoardPart[];
    width: number;
    height: number;
    depth: number;
    error: string | null;
    label: string;
  };

  const rows: ResolvedRow[] = items.map((item) => {
    const module = catalogInput.modules.find((m) => m.id === item.moduleId);
    if (!module) {
      return {
        item,
        module: undefined,
        parts: [],
        width: 600,
        height: 720,
        depth: 560,
        error: `Mueble no encontrado (${item.moduleId}).`,
        label: item.moduleId,
      };
    }
    const resolved = resolveItemBom(item, module, project, catalogInput);
    return {
      item,
      module,
      parts: resolved.parts,
      width: resolved.width,
      height: resolved.height,
      depth: resolved.depth,
      error: resolved.error,
      label: `${module.code} — ${module.name}`,
    };
  });

  const footprints = rows.map((row) => ({
    id: row.item.id,
    width: row.width,
    height: row.height,
    depth: row.depth,
    quantity: row.item.quantity,
  }));

  const layout = layoutProjectRun(footprints);
  const byItemId = new Map(rows.map((r) => [r.item.id, r]));

  const modules: ProjectModule3DInstance[] = layout.placements.map(
    (place: PlacedModuleFootprint) => {
      const row = byItemId.get(place.id)!;
      return {
        instanceKey: place.instanceKey,
        itemId: place.id,
        moduleId: row.module?.id ?? row.item.moduleId,
        label: row.label,
        parts: row.parts,
        width: place.width,
        height: place.height,
        depth: place.depth,
        originX: place.originX,
        originY: place.originY,
        originZ: place.originZ,
        error: row.error,
      };
    },
  );

  const errors = [
    ...new Set(
      rows
        .map((r) => r.error)
        .filter((e): e is string => Boolean(e)),
    ),
  ];

  const hasAnyParts = modules.some((m) => m.parts.length > 0);

  return {
    modules,
    totalWidth: layout.totalWidth,
    totalHeight: layout.totalHeight,
    totalDepth: layout.totalDepth,
    empty: !hasAnyParts,
    errors,
  };
}
