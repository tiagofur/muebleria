/**
 * Pure helper: resolve structure draft components into 3D board parts for Furniture3DViewer.
 */

import type {
  Catalog,
  ComponentPlacement,
  DimensionPreset,
  OptionChoices,
  ResolvedBoardPart,
  Structure,
} from '@muebles/domain';
import { resolveComposedModule } from '@muebles/domain';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import { defaultOptionChoicesForModule } from '../modules/moduleHelpers';
import { DEFAULT_MODULE_FOOTPRINT_MM } from '../preview3d/project3dLayout';
import type { StructureDraft } from './structureDraft';

export type Structure3DPreviewResult = {
  readonly parts: readonly ResolvedBoardPart[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly presetId: string | undefined;
  readonly presets: readonly DimensionPreset[];
  readonly optionChoices: OptionChoices;
  readonly error: string | null;
  readonly empty: boolean;
};

function dimsFromStructure(
  draft: StructureDraft,
  presetId: string | undefined,
): { width: number; height: number; depth: number } {
  if (presetId) {
    const found = draft.presets.find((p) => p.id === presetId);
    if (found && found.width > 0 && found.height > 0 && found.depth > 0) {
      return {
        width: found.width,
        height: found.height,
        depth: found.depth,
      };
    }
  }

  if (draft.widthMm > 0 && draft.heightMm > 0 && draft.depthMm > 0) {
    return {
      width: draft.widthMm,
      height: draft.heightMm,
      depth: draft.depthMm,
    };
  }

  if (draft.presets.length > 0) {
    const first = draft.presets[0]!;
    if (first.width > 0 && first.height > 0 && first.depth > 0) {
      return {
        width: first.width,
        height: first.height,
        depth: first.depth,
      };
    }
  }

  return { ...DEFAULT_MODULE_FOOTPRINT_MM };
}

/**
 * Resolve 3D preview for a structure draft.
 * @param optionChoicesOverride partial board finishes merged over defaults
 */
export function resolveStructure3DPreview(
  draft: StructureDraft,
  catalogInput: Module3DCatalogInput,
  presetIdOverride?: string | null,
  optionChoicesOverride?: OptionChoices | null,
): Structure3DPreviewResult {
  const presets = draft.presets ?? [];
  const presetId =
    presetIdOverride?.trim() ||
    (presets.length > 0 ? presets[0]!.id : undefined);

  const dims = dimsFromStructure(draft, presetId);

  const tempStructure: Structure = {
    id: 'temp-structure',
    code: draft.code || 'STR',
    name: draft.name || 'Estructura',
    externalDims: {
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
    },
    presets,
    components: draft.components.map((c) => ({
      componentId: c.componentId,
      quantity: c.quantity,
      placementOverride: c.placementOverride
        ? (c.placementOverride as ComponentPlacement)
        : undefined,
    })),
  };

  const defaults = defaultOptionChoicesForModule(
    {
      components: draft.components,
      hardwareLines: [],
    },
    catalogInput.optionGroups,
    catalogInput.components,
  );
  const optionChoices: OptionChoices = {
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
  };

  try {
    const composed = resolveComposedModule({
      structure: tempStructure,
      componentInstances: [],
      catalog,
      dims,
      optionChoices,
    });

    const resolvedBoardParts: ResolvedBoardPart[] = composed.boardParts.map(
      (part) => {
        const optionRole = part.optionRole;
        const choiceId = optionChoices[optionRole];
        const material =
          catalogInput.materials.find((m) => m.id === choiceId) ??
          catalogInput.materials[0];

        const thicknessMm = material?.thicknessMm ?? 18;
        const grain = material?.grainDefault ? 1 : 0;

        return {
          id: part.id,
          code: part.code,
          description: part.description,
          quantity: part.quantity,
          lengthMm: part.lengthMm,
          widthMm: part.widthMm,
          grain,
          edges: part.edges,
          optionRole: part.optionRole,
          materialId: material?.id ?? '',
          edgeBandId: material?.defaultEdgeBandId,
          x: part.x,
          y: part.y,
          z: part.z,
          rotateX: part.rotateX,
          rotateY: part.rotateY,
          rotateZ: part.rotateZ,
          thicknessMm,
        };
      },
    );

    return {
      parts: resolvedBoardParts,
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
      presetId,
      presets,
      optionChoices,
      error: null,
      empty: resolvedBoardParts.length === 0,
    };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : 'No se pudo resolver el armado 3D de la estructura.';
    return {
      parts: [],
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
      presetId,
      presets,
      optionChoices,
      error: message,
      empty: true,
    };
  }
}
