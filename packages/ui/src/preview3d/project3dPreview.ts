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
  layoutKitchenPlacements,
  resolveBom,
  resolveModuleMeasurePreset,
  type ResolvedWallFrame,
} from '@muebles/domain';
import { defaultOptionChoicesForModule } from '../modules/moduleHelpers';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import {
  DEFAULT_MODULE_FOOTPRINT_MM,
  layoutProjectRun,
  PROJECT_RUN_GAP_MM,
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
  /** Workshop plan yaw (degrees). Width follows wall; 0 = straight run. */
  readonly yawDeg: number;
  /** Plinth/legs clearance under floor units (mm); 0 if none / wall-hung. */
  readonly baseClearanceMm: number;
  readonly error: string | null;
};

export type Project3DPreviewResult = {
  readonly modules: readonly ProjectModule3DInstance[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly totalDepth: number;
  readonly empty: boolean;
  readonly errors: readonly string[];
  /** How modules were positioned. */
  readonly layoutMode: 'linear' | 'kitchen';
  /** Count of instances anchored on walls (kitchen mode only). */
  readonly placedCount: number;
  /** Count of quote instances not on the plan (shown as linear tail when kitchen). */
  readonly unplacedCount: number;
  /** Resolved wall frames when layoutMode is kitchen (shifted to +X/+Y). */
  readonly walls: readonly ResolvedWallFrame[];
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
  /**
   * When kitchen plan is active: `tail` appends unplaced units as a linear run
   * (quote preview). `hide` only shows wall placements (spatial studio).
   */
  readonly unplacedPolicy?: 'tail' | 'hide';
  /**
   * Use kitchen framing when walls exist even if no placements yet
   * (empty room for spatial studio).
   */
  readonly kitchenWallsOnly?: boolean;
};

/**
 * Build a linear run of cabinets from a project quote.
 */
export function resolveProject3DPreview(
  project: Project,
  catalogInput: Module3DCatalogInput,
  options: ResolveProject3DOptions = {},
): Project3DPreviewResult {
  const unplacedPolicy = options.unplacedPolicy ?? 'tail';
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

  const byItemId = new Map(rows.map((r) => [r.item.id, r]));
  const kitchen = project.kitchenLayout;
  const useKitchen =
    !options.itemId &&
    kitchen &&
    kitchen.walls.length > 0 &&
    (kitchen.placements.length > 0 || Boolean(options.kitchenWallsOnly));

  let modules: ProjectModule3DInstance[];
  let totalWidth: number;
  let totalHeight: number;
  let totalDepth: number;
  let layoutMode: 'linear' | 'kitchen' = 'linear';
  let placedCount = 0;
  let unplacedCount = 0;
  let walls: readonly ResolvedWallFrame[] = [];
  const layoutWarnings: string[] = [];

  if (useKitchen && kitchen) {
    layoutMode = 'kitchen';
    const fps = kitchen.placements.map((p) => {
      const row = byItemId.get(p.itemId);
      return {
        itemId: p.itemId,
        instanceIndex: p.instanceIndex,
        width: row?.width ?? DEFAULT_MODULE_FOOTPRINT_MM.width,
        height: row?.height ?? DEFAULT_MODULE_FOOTPRINT_MM.height,
        depth: row?.depth ?? DEFAULT_MODULE_FOOTPRINT_MM.depth,
      };
    });
    const layout = layoutKitchenPlacements(kitchen, fps);
    walls = layout.walls;
    layoutWarnings.push(...layout.warnings);
    const placedModules: ProjectModule3DInstance[] = layout.placements.map(
      (place) => {
        const row = byItemId.get(place.itemId);
        return {
          instanceKey: place.instanceKey,
          itemId: place.itemId,
          moduleId: row?.module?.id ?? row?.item.moduleId ?? place.itemId,
          label: row?.label ?? place.itemId,
          parts: row?.parts ?? [],
          width: place.width,
          height: place.height,
          depth: place.depth,
          originX: place.originX,
          originY: place.originY,
          originZ: place.originZ,
          yawDeg: place.yawDeg,
          baseClearanceMm: place.baseClearanceMm,
          error: row?.error ?? null,
        };
      },
    );
    placedCount = placedModules.length;

    // Count unplaced instances (always); optionally append as linear tail.
    const placedKeys = new Set(placedModules.map((m) => m.instanceKey));
    const unplacedFootprints: {
      id: string;
      width: number;
      height: number;
      depth: number;
      quantity: number;
      instanceIndex: number;
    }[] = [];
    for (const row of rows) {
      const qty = Math.max(1, Math.floor(row.item.quantity) || 1);
      for (let i = 0; i < qty; i++) {
        const key = `${row.item.id}#${i}`;
        if (placedKeys.has(key)) continue;
        unplacedFootprints.push({
          id: row.item.id,
          width: row.width,
          height: row.height,
          depth: row.depth,
          quantity: 1,
          instanceIndex: i,
        });
      }
    }
    unplacedCount = unplacedFootprints.length;
    if (unplacedCount > 0 && unplacedPolicy === 'tail') {
      layoutWarnings.push(
        `${unplacedCount} unidad${unplacedCount === 1 ? '' : 'es'} sin colocar en el plano (se muestran al final de la vista).`,
      );
    } else if (unplacedCount > 0 && unplacedPolicy === 'hide') {
      layoutWarnings.push(
        `${unplacedCount} unidad${unplacedCount === 1 ? '' : 'es'} sin colocar — elegilas en la lista.`,
      );
    }

    let tailModules: ProjectModule3DInstance[] = [];
    if (unplacedPolicy === 'tail' && unplacedFootprints.length > 0) {
      const tailLayout = layoutProjectRun(
        unplacedFootprints.map((f) => ({
          id: `${f.id}#${f.instanceIndex}`,
          width: f.width,
          height: f.height,
          depth: f.depth,
          quantity: 1,
        })),
      );
      const tailStartX = layout.totalWidth + PROJECT_RUN_GAP_MM;
      tailModules = tailLayout.placements.map((place: PlacedModuleFootprint) => {
        // place.id is itemId#instanceIndex from synthetic footprints
        const hash = place.id.lastIndexOf('#');
        const itemId = hash >= 0 ? place.id.slice(0, hash) : place.id;
        const instanceIndex =
          hash >= 0 ? Number(place.id.slice(hash + 1)) || 0 : 0;
        const row = byItemId.get(itemId)!;
        return {
          instanceKey: `${itemId}#${instanceIndex}`,
          itemId,
          moduleId: row.module?.id ?? row.item.moduleId,
          label: row.label,
          parts: row.parts,
          width: place.width,
          height: place.height,
          depth: place.depth,
          originX: place.originX + tailStartX,
          originY: place.originY,
          originZ: place.originZ,
          yawDeg: 0,
          baseClearanceMm: 0,
          error: row.error,
        };
      });
      totalWidth =
        tailStartX +
        (tailLayout.placements.length > 0 ? tailLayout.totalWidth : 0);
      totalHeight = Math.max(layout.totalHeight, tailLayout.totalHeight);
      totalDepth = Math.max(layout.totalDepth, tailLayout.totalDepth);
    } else {
      totalWidth = layout.totalWidth;
      totalHeight = Math.max(layout.totalHeight, 2400);
      totalDepth = layout.totalDepth;
    }

    modules = [...placedModules, ...tailModules];
  } else {
    const footprints = rows.map((row) => ({
      id: row.item.id,
      width: row.width,
      height: row.height,
      depth: row.depth,
      quantity: row.item.quantity,
    }));
    const layout = layoutProjectRun(footprints);
    modules = layout.placements.map((place: PlacedModuleFootprint) => {
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
        yawDeg: 0,
        baseClearanceMm: 0,
        error: row.error,
      };
    });
    totalWidth = layout.totalWidth;
    totalHeight = layout.totalHeight;
    totalDepth = layout.totalDepth;
    placedCount = 0;
    unplacedCount = modules.length;
    walls = [];
  }

  const errors = [
    ...new Set(
      [
        ...rows.map((r) => r.error).filter((e): e is string => Boolean(e)),
        ...layoutWarnings,
      ],
    ),
  ];

  const hasAnyParts = modules.some((m) => m.parts.length > 0);
  const empty =
    layoutMode === 'kitchen'
      ? modules.length === 0 && walls.length === 0
      : !hasAnyParts;

  return {
    modules,
    totalWidth,
    totalHeight,
    totalDepth,
    layoutMode,
    placedCount,
    unplacedCount,
    walls,
    empty,
    errors,
  };
}
