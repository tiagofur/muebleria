/**
 * Spatial assembly resolution (S1).
 * Sibling of resolveBom — produces PlacedBoardPart[] for 3D viewers.
 * Does not affect cut-list costs.
 *
 * Workshop frame: X width (0 left), Y height (0 floor), Z depth (0 front → +Z back).
 */

import { ResolutionError, ValidationError } from './errors';
import {
  evaluatePartFormula,
  resolveFurnitureComponentParts,
  resolveStructure,
  type PartFormulaDims,
} from './engine';
import { resolveModuleMeasurePreset } from './measurePresets';
import {
  DEFAULT_DESIGN_THICKNESS_MM,
  defaultPoseForSlot,
  isBoardFace,
  isPlacementSlot,
} from './spatial';
import type {
  BoardFace,
  BoardPart,
  Catalog,
  Module,
  ModuleComponentRef,
  OptionChoices,
  PlacementSlot,
  PlacedBoardPart,
  ResolvedAssembly,
  Structure,
} from './types';

function findStructure(
  catalog: Catalog,
  structureId: string,
): Structure | undefined {
  return catalog.structures?.find((s) => s.id === structureId);
}

function resolveSelectedDims(
  module: Module,
  structure: Structure | undefined,
  preset: { width: number; height: number; depth: number } | undefined,
): { width: number; height: number; depth: number } | undefined {
  if (preset) {
    return {
      width: preset.width,
      height: preset.height,
      depth: preset.depth,
    };
  }
  if (module.externalDims) {
    return {
      width: module.externalDims.width,
      height: module.externalDims.height,
      depth: module.externalDims.depth,
    };
  }
  if (structure?.externalDims) {
    return {
      width: structure.externalDims.width,
      height: structure.externalDims.height,
      depth: structure.externalDims.depth,
    };
  }
  return undefined;
}

function stretchPartLocal(
  part: BoardPart,
  dims: PartFormulaDims,
  moduleCode: string,
): BoardPart {
  let lengthMm = part.lengthMm;
  let widthMm = part.widthMm;
  if (part.lengthFormula) {
    lengthMm = evaluatePartFormula(part.lengthFormula, dims, {
      moduleCode,
      partDescription: part.description,
      field: 'length',
    });
  }
  if (part.widthFormula) {
    widthMm = evaluatePartFormula(part.widthFormula, dims, {
      moduleCode,
      partDescription: part.description,
      field: 'width',
    });
  }
  return { ...part, lengthMm, widthMm };
}

function materialThickness(
  catalog: Catalog,
  materialId: string | undefined,
  fallbackT: number,
): number {
  if (!materialId) return fallbackT;
  const mat = catalog.materials.find((m) => m.id === materialId);
  if (mat && mat.thicknessMm > 0) return mat.thicknessMm;
  return fallbackT;
}

/**
 * Best-effort thickness for assembly when option choices are available.
 * Prefer material of optionRole; else designThicknessMm; else default 18.
 */
function resolveThicknessMm(
  part: BoardPart,
  optionChoices: OptionChoices,
  catalog: Catalog,
): number {
  const design = part.designThicknessMm ?? DEFAULT_DESIGN_THICKNESS_MM;
  const choiceId = optionChoices[part.optionRole];
  if (!choiceId) return design;
  return materialThickness(catalog, choiceId, design);
}

function tryResolveMaterialId(
  part: BoardPart,
  optionChoices: OptionChoices,
): string | undefined {
  const id = optionChoices[part.optionRole];
  return id || undefined;
}

type PoseInput = {
  face?: BoardFace;
  placement?: PlacementSlot;
  originXFormula?: string;
  originYFormula?: string;
  originZFormula?: string;
};

function mergePose(
  part: BoardPart,
  instanceOverride?: PoseInput,
): PoseInput | undefined {
  const placement =
    instanceOverride?.placement ?? part.placement;
  const face = instanceOverride?.face ?? part.face;
  const originXFormula =
    instanceOverride?.originXFormula ?? part.originXFormula;
  const originYFormula =
    instanceOverride?.originYFormula ?? part.originYFormula;
  const originZFormula =
    instanceOverride?.originZFormula ?? part.originZFormula;

  if (
    !placement &&
    !face &&
    !originXFormula &&
    !originYFormula &&
    !originZFormula
  ) {
    return undefined;
  }

  return {
    face,
    placement,
    originXFormula,
    originYFormula,
    originZFormula,
  };
}

function resolvePoseOrigins(
  pose: PoseInput,
  dims: PartFormulaDims,
  context: { partDescription: string; moduleCode?: string },
): { face: BoardFace; origin: { x: number; y: number; z: number }; placement?: PlacementSlot } | null {
  let face = pose.face;
  let ox = pose.originXFormula;
  let oy = pose.originYFormula;
  let oz = pose.originZFormula;
  const placement = pose.placement;

  if (placement && isPlacementSlot(placement)) {
    const defaults = defaultPoseForSlot(placement);
    face = face ?? defaults.face;
    ox = ox ?? defaults.originXFormula;
    oy = oy ?? defaults.originYFormula;
    oz = oz ?? defaults.originZFormula;
  }

  if (!face || !isBoardFace(face)) {
    return null;
  }
  if (ox === undefined || oy === undefined || oz === undefined) {
    // face alone without origins is incomplete
    if (ox === undefined && oy === undefined && oz === undefined) {
      // use zero origin as last resort when face is explicit
      return {
        face,
        placement,
        origin: { x: 0, y: 0, z: 0 },
      };
    }
    return null;
  }

  const x = evaluatePartFormula(ox, dims, {
    ...context,
    field: 'originX',
  });
  const y = evaluatePartFormula(oy, dims, {
    ...context,
    field: 'originY',
  });
  const z = evaluatePartFormula(oz, dims, {
    ...context,
    field: 'originZ',
  });

  return { face, placement, origin: { x, y, z } };
}

function placePart(
  part: BoardPart,
  dims: PartFormulaDims,
  optionChoices: OptionChoices,
  catalog: Catalog,
  source: PlacedBoardPart['source'],
  moduleCode: string,
  instanceOverride?: PoseInput,
): PlacedBoardPart | null {
  const pose = mergePose(part, instanceOverride);
  if (!pose) return null;

  const resolved = resolvePoseOrigins(pose, dims, {
    partDescription: part.description,
    moduleCode,
  });
  if (!resolved) return null;

  const thicknessMm = resolveThicknessMm(part, optionChoices, catalog);

  return {
    partId: part.id,
    code: part.code,
    description: part.description,
    optionRole: part.optionRole,
    materialId: tryResolveMaterialId(part, optionChoices),
    lengthMm: part.lengthMm,
    widthMm: part.widthMm,
    thicknessMm,
    face: resolved.face,
    originMm: resolved.origin,
    placement: resolved.placement,
    source,
  };
}

/**
 * Resolve spatial assembly for a module template at a commercial measure.
 * Never throws for missing spatial metadata — returns outer_only / partial.
 * Throws only on hard resolution errors (missing structure/component ids, bad formulas when used).
 */
export function resolveAssembly(
  module: Module,
  optionChoices: OptionChoices,
  catalog: Catalog,
  measurePresetId?: string,
): ResolvedAssembly {
  const structure = module.structureId
    ? findStructure(catalog, module.structureId)
    : undefined;

  if (module.structureId && !structure) {
    throw new ResolutionError(
      `Estructura no encontrada: ${module.structureId}`,
      {
        moduleCode: module.code,
        structureId: module.structureId,
        field: 'structureId',
      },
    );
  }

  const preset = resolveModuleMeasurePreset(module, measurePresetId);
  const selectedDims = resolveSelectedDims(module, structure, preset);

  if (!selectedDims) {
    return {
      outerMm: { width: 0, height: 0, depth: 0 },
      boards: [],
      completeness: 'outer_only',
    };
  }

  if (
    selectedDims.width <= 0 ||
    selectedDims.height <= 0 ||
    selectedDims.depth <= 0
  ) {
    throw new ValidationError(
      'Las medidas del ensamble deben ser mayores a 0',
      {
        moduleCode: module.code,
        selectedDims,
        field: 'selectedDims',
      },
    );
  }

  const outerMm = {
    width: selectedDims.width,
    height: selectedDims.height,
    depth: selectedDims.depth,
  };

  const boards: PlacedBoardPart[] = [];
  let candidateCount = 0;

  const baseDims = (T: number, i = 0, n = 1): PartFormulaDims => ({
    W: selectedDims.width,
    H: selectedDims.height,
    D: selectedDims.depth,
    T,
    i,
    n,
  });

  // Structure body parts
  if (structure) {
    const stretched = resolveStructure(structure, selectedDims);
    for (const part of stretched) {
      candidateCount += 1;
      const T = resolveThicknessMm(part, optionChoices, catalog);
      const placed = placePart(
        part,
        baseDims(T),
        optionChoices,
        catalog,
        {
          kind: 'structure',
          structureId: structure.id,
        },
        module.code,
      );
      if (placed) boards.push(placed);
    }
  }

  // Module-owned parts
  for (const raw of module.boardParts) {
    candidateCount += 1;
    const T = resolveThicknessMm(raw, optionChoices, catalog);
    const part = stretchPartLocal(raw, baseDims(T), module.code);
    const placed = placePart(
      part,
      baseDims(T),
      optionChoices,
      catalog,
      { kind: 'module' },
      module.code,
    );
    if (placed) boards.push(placed);
  }

  // Component instances
  for (const ref of module.components ?? []) {
    const component = catalog.components?.find((c) => c.id === ref.componentId);
    if (!component) {
      throw new ResolutionError(
        `Componente no encontrado: ${ref.componentId}`,
        {
          moduleCode: module.code,
          componentId: ref.componentId,
          field: 'components',
        },
      );
    }
    const n = ref.quantity;
    for (let i = 0; i < n; i += 1) {
      const parts = resolveFurnitureComponentParts(component, selectedDims, {
        i,
        n,
      });
      for (const part of parts) {
        candidateCount += 1;
        const T = resolveThicknessMm(part, optionChoices, catalog);
        const instanceOverride: PoseInput = {
          placement: ref.placement,
          originXFormula: ref.originXFormula,
          originYFormula: ref.originYFormula,
          originZFormula: ref.originZFormula,
        };
        // Kind-based default placement when neither part nor ref has spatial data
        const kindDefault = kindDefaultPlacement(component.kind);
        if (
          !mergePose(part, instanceOverride) &&
          kindDefault
        ) {
          instanceOverride.placement = kindDefault;
        }
        const placed = placePart(
          part,
          baseDims(T, i, n),
          optionChoices,
          catalog,
          {
            kind: 'component',
            componentId: component.id,
            instanceIndex: i,
          },
          module.code,
          instanceOverride,
        );
        if (placed) boards.push(placed);
      }
    }
  }

  let completeness: ResolvedAssembly['completeness'];
  if (boards.length === 0) {
    completeness = 'outer_only';
  } else if (boards.length < candidateCount) {
    completeness = 'partial';
  } else {
    completeness = 'full';
  }

  return { outerMm, boards, completeness };
}

function kindDefaultPlacement(
  kind: string,
): PlacementSlot | undefined {
  switch (kind) {
    case 'puerta':
      return 'door';
    case 'entrepaño':
      return 'shelf';
    case 'frente_cajon':
      return 'drawer_front';
    case 'lateral':
      return 'left';
    default:
      return undefined;
  }
}
