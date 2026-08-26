/**
 * Pure helper: resolve an Agregado (sub-assembly) draft into 3D board parts for
 * Furniture3DViewer. Used by the live preview embedded in the Agregado editor.
 *
 * Reuses the canonical engine pipeline (`resolveComposedModule`) by wrapping the
 * draft in a synthetic `Structure` whose dims equal the agregado's external
 * dims. The agregado's own pieces are passed as `componentInstances` (NOT
 * `structure.components`) so the user's per-piece formula overrides
 * (length/width/x/y/z/rotation) — edited via InstanceOverridesEditor — are
 * honored and the preview updates live as the draft changes.
 *
 * Fase 3 of `docs/agregados-subassemblies-plan.md`. V1: pieces only (board
 * parts). Hardware 3D meshes and real textures are follow-ups, mirroring how
 * `resolveStructure3DPreview` / StructureEditorComponentsPanel behave.
 */

import type {
  Catalog,
  DimensionPreset,
  OptionChoices,
  ResolvedBoardPart,
  Structure,
} from '@granete/domain';
import { resolveComposedModule } from '@granete/domain';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import { defaultOptionChoicesForModule } from '../modules/moduleHelpers';
import { DEFAULT_MODULE_FOOTPRINT_MM } from '../preview3d/project3dLayout';
import type { AgregadoDraft } from './agregadoDraft';

export type Agregado3DPreviewResult = {
  readonly parts: readonly ResolvedBoardPart[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly optionChoices: OptionChoices;
  readonly error: string | null;
  readonly empty: boolean;
};

function dimsFromDraft(draft: AgregadoDraft): {
  width: number;
  height: number;
  depth: number;
} {
  if (draft.widthMm > 0 && draft.heightMm > 0 && draft.depthMm > 0) {
    return {
      width: draft.widthMm,
      height: draft.heightMm,
      depth: draft.depthMm,
    };
  }
  return { ...DEFAULT_MODULE_FOOTPRINT_MM };
}

/**
 * Resolve 3D preview for an agregado draft.
 * @param optionChoicesOverride partial board finishes merged over defaults
 */
export function resolveAgregado3DPreview(
  draft: AgregadoDraft,
  catalogInput: Module3DCatalogInput,
  optionChoicesOverride?: OptionChoices | null,
): Agregado3DPreviewResult {
  const dims = dimsFromDraft(draft);

  // Synthetic structure: empty components (pieces come in as componentInstances
  // so user overrides apply). A single synthetic preset mirrors dims so the
  // `resolveStructure` validation gate passes.
  const syntheticPreset: DimensionPreset = {
    id: 'single',
    name: 'Único',
    width: dims.width,
    height: dims.height,
    depth: dims.depth,
  };
  const tempStructure: Structure = {
    id: 'temp-agregado-structure',
    code: draft.code || 'AGR',
    name: draft.name || 'Agregado',
    externalDims: {
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
    },
    presets: [syntheticPreset],
    components: [],
    agregados: [],
  };

  const defaults = defaultOptionChoicesForModule(
    {
      components: draft.components,
      hardwareLines: draft.hardwareLines,
    },
    catalogInput.optionGroups,
    catalogInput.components,
    catalogInput.structures,
    catalogInput.agregados,
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
    agregados: catalogInput.agregados,
  };

  try {
    const composed = resolveComposedModule({
      structure: tempStructure,
      // draft.components carry the user's per-piece overrides (formulas + pose),
      // so the preview reflects edits live.
      componentInstances: draft.components,
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
      optionChoices,
      error: null,
      empty: resolvedBoardParts.length === 0,
    };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : 'No se pudo resolver el armado 3D del agregado.';
    return {
      parts: [],
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
      optionChoices,
      error: message,
      empty: true,
    };
  }
}
