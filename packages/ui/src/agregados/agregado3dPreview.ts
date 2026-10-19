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
 * Fase 3 of `docs/agregados-subassemblies-plan.md`. Renders pieces plus
 * parametric hardware placements (jaladeras/bisagras per piece, reused from
 * `resolveModuleHardwarePlacements`); real textures are follow-ups, mirroring
 * how `resolveStructure3DPreview` / StructureEditorComponentsPanel behave.
 *
 * #669: when the caller passes the catalog agregado id, the resolver also
 * projects the agregado's own rigid-member assembly recipe (same
 * resolveAgregadoAssembly → attachVisualPins → projectResolvedAssemblyFor3D
 * path the module previews use) at identity placement, so its GLB members
 * render through the shared AssemblyMesh path.
 */

import type {
  Catalog,
  DimensionPreset,
  OptionChoices,
  ProjectedAssembly,
  ResolvedBoardPart,
  ResolvedHardwarePlacement,
  Structure,
} from '@granete/domain';
import {
  attachVisualPins,
  createCatalogVisualAssetLookup,
  enrichFabricatedComponentsWithAuthority,
  projectResolvedAssemblyFor3D,
  resolveAgregadoAssembly,
  resolveComposedModule,
} from '@granete/domain';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import { defaultOptionChoicesForModule } from '../modules/moduleHelpers';
import { resolveModuleHardwarePlacements } from '../preview3d/project3dPreview';
import { DEFAULT_MODULE_FOOTPRINT_MM } from '../preview3d/project3dLayout';
import type { AgregadoDraft } from './agregadoDraft';

export type Agregado3DPreviewResult = {
  readonly parts: readonly ResolvedBoardPart[];
  /** Board-local hardware placements resolved against `parts` (empty = none renderable). */
  readonly resolvedHardwarePlacements: readonly ResolvedHardwarePlacement[];
  /**
   * Projected rigid-member assemblies of the catalog agregado itself (#669).
   * Empty when the caller passes no agregado id, the catalog entry has no
   * assembly recipe, or the recipe fails to resolve (diagnostic in `error`).
   */
  readonly assemblies: readonly ProjectedAssembly[];
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
 * @param agregadoId catalog agregado id whose assembly recipe to project as
 * `assemblies` (#669). The draft itself never carries a recipe, so the caller
 * passes the authoritative identity explicitly; unknown id or no recipe →
 * empty assemblies, never invented geometry.
 */
export function resolveAgregado3DPreview(
  draft: AgregadoDraft,
  catalogInput: Module3DCatalogInput,
  optionChoicesOverride?: OptionChoices | null,
  agregadoId?: string | null,
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

    // Draft components expand with the engine's `mod-` namespace (Go #736,
    // #995 K3-parity), and the placement resolver's synthetic-module path
    // mirrors it, so each placement links to its own board part by id.
    // VH-08: preview-only, never the cut path.
    const resolvedHardwarePlacements = resolveModuleHardwarePlacements(
      { components: draft.components },
      resolvedBoardParts,
      catalogInput.hardware,
      { optionChoices },
    );

    // #669: project the catalog agregado's own assembly recipe at identity
    // placement. Same canonical path as module previews
    // (resolveAgregadoAssembly → enrich R3 authority → attachVisualPins →
    // projectResolvedAssemblyFor3D); a recipe or authority failure is an honest
    // diagnostic that keeps the resolved pieces — never a render-time crash.
    let assemblies: readonly ProjectedAssembly[] = [];
    let assemblyError: string | null = null;
    const trimmedId = agregadoId?.trim() ?? '';
    if (trimmedId) {
      const recipe = (catalogInput.agregados ?? []).find((a) => a.id === trimmedId);
      if (recipe && recipe.rigidMembers && recipe.rigidMembers.length > 0) {
        try {
          const resolved = resolveAgregadoAssembly(
            {
              id: recipe.id,
              commercialKitHardwareId: recipe.commercialKitHardwareId,
              components: recipe.components,
              rigidMembers: recipe.rigidMembers,
              variantSets: recipe.variantSets,
              compatibilityRules: recipe.compatibilityRules,
            },
            { widthMm: dims.width, depthMm: dims.depth, heightMm: dims.height },
          );
          const enriched = {
            ...resolved,
            fabricatedComponents: enrichFabricatedComponentsWithAuthority(
              resolved.fabricatedComponents,
              { components: catalogInput.components, materials: catalogInput.materials },
              optionChoices,
            ),
          };
          const pinned = attachVisualPins(
            enriched,
            createCatalogVisualAssetLookup(catalogInput.hardware),
          );
          assemblies = [
            projectResolvedAssemblyFor3D({
              assembly: pinned,
              placement: { originMm: [0, 0, 0] },
              assemblyInstanceId: `agregado-preview:${trimmedId}`,
            }),
          ];
        } catch (e) {
          assemblyError =
            e instanceof Error
              ? `No se pudo proyectar el ensamble del agregado: ${e.message}`
              : 'No se pudo proyectar el ensamble del agregado.';
        }
      }
    }

    return {
      parts: resolvedBoardParts,
      resolvedHardwarePlacements,
      assemblies,
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
      optionChoices,
      error: assemblyError,
      // Assemblies count as content: a hardware-only recipe (rigid members,
      // no board pieces) still renders its members — review round-1 note.
      empty: resolvedBoardParts.length === 0 && assemblies.length === 0,
    };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : 'No se pudo resolver el armado 3D del agregado.';
    return {
      parts: [],
      resolvedHardwarePlacements: [],
      assemblies: [],
      width: dims.width,
      height: dims.height,
      depth: dims.depth,
      optionChoices,
      error: message,
      empty: true,
    };
  }
}
