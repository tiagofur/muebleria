/**
 * BOM resolution: module template + option choices → concrete material/hardware IDs.
 *
 * Includes the composed-module path (Structure + Component instances), the
 * parametric component geometry expansion, and the legacy `resolveStructure`
 * gate (pure dim check; component parts are produced by `resolveComposedModule`).
 */

import { ResolutionError, ValidationError } from '../errors';
import {
  resolveModuleMeasurePreset,
} from '../measurePresets';
import { defaultPoseForPlacement } from '../spatialPlacement';
import { resolveStructureForPin } from '../structures/versioning';
import type {
  BoardPart,
  Catalog,
  Component,
  Grain,
  HardwareLine,
  MaterialBoard,
  Module,
  ModuleComponentInstance,
  OptionChoices,
  ResolvedBoardPart,
  ResolvedBom,
  ResolvedHardwareLine,
  Structure,
} from '../types';
import {
  EDGE_OPTION_ROLE,
  evaluatePartFormula,
  findEdgeBand,
  findHardware,
  findMaterial,
  findOptionGroup,
  hasAnyEdgeEnabled,
} from './shared';
import {
  validateBoardPart,
  validateHardwareLine,
  validateModule,
} from './validate';

/**
 * Edge band resolution (PRD §13.5):
 * 1. Explicit project choice under option role EDGE
 * 2. Material.defaultEdgeBandId (FK link — never by display name)
 */
function resolveEdgeBandId(
  part: BoardPart,
  material: MaterialBoard,
  optionChoices: OptionChoices,
  catalog: Catalog,
  moduleCode: string,
): string | undefined {
  if (!hasAnyEdgeEnabled(part.edges)) {
    return undefined;
  }

  const explicitId = optionChoices[EDGE_OPTION_ROLE];
  if (explicitId) {
    const edge = findEdgeBand(catalog, explicitId);
    if (!edge) {
      throw new ResolutionError(
        `Edge band not found for choice: ${explicitId}`,
        {
          moduleCode,
          partId: part.id,
          partCode: part.code,
          edgeBandId: explicitId,
          field: 'edgeBandId',
        },
      );
    }
    if (!edge.active) {
      throw new ValidationError(
        `Inactive edge band cannot be used: ${edge.code}`,
        {
          moduleCode,
          partId: part.id,
          edgeBandId: edge.id,
          field: 'active',
        },
      );
    }
    return edge.id;
  }

  const defaultId = material.defaultEdgeBandId;
  if (!defaultId) {
    throw new ResolutionError(
      `Missing edge band for part with edges enabled (no EDGE choice and material "${material.code}" has no defaultEdgeBandId)`,
      {
        moduleCode,
        partId: part.id,
        partCode: part.code,
        materialId: material.id,
        materialName: material.name,
        field: 'defaultEdgeBandId',
      },
    );
  }

  const linked = findEdgeBand(catalog, defaultId);
  if (!linked) {
    throw new ResolutionError(
      `Default edge band not found: ${defaultId} (material "${material.code}")`,
      {
        moduleCode,
        partId: part.id,
        partCode: part.code,
        materialId: material.id,
        edgeBandId: defaultId,
        field: 'defaultEdgeBandId',
      },
    );
  }
  if (!linked.active) {
    throw new ValidationError(
      `Inactive default edge band cannot be used: ${linked.code}`,
      {
        moduleCode,
        partId: part.id,
        materialId: material.id,
        edgeBandId: linked.id,
        field: 'active',
      },
    );
  }
  return linked.id;
}

function requireMaterialChoice(
  part: BoardPart,
  optionChoices: OptionChoices,
  catalog: Catalog,
  moduleCode: string,
): MaterialBoard {
  const group = findOptionGroup(catalog, part.optionRole);
  const choiceId = optionChoices[part.optionRole];

  if (!choiceId) {
    const required = group?.required !== false;
    if (required) {
      throw new ResolutionError(
        `Missing required option choice for role "${part.optionRole}" on part ${part.code ?? part.id}`,
        {
          moduleCode,
          partId: part.id,
          partCode: part.code,
          optionGroupCode: part.optionRole,
          field: 'optionChoices',
        },
      );
    }
    throw new ResolutionError(
      `Missing material choice for role "${part.optionRole}" on part ${part.code ?? part.id}`,
      {
        moduleCode,
        partId: part.id,
        optionGroupCode: part.optionRole,
        field: 'optionChoices',
      },
    );
  }

  const material = findMaterial(catalog, choiceId);
  if (!material) {
    throw new ResolutionError(
      `Material not found for choice: ${choiceId}`,
      {
        moduleCode,
        partId: part.id,
        materialId: choiceId,
        optionGroupCode: part.optionRole,
        field: 'materialId',
      },
    );
  }

  if (!material.active) {
    throw new ValidationError(
      `Inactive material cannot be used: ${material.code}`,
      {
        moduleCode,
        partId: part.id,
        materialId: material.id,
        field: 'active',
      },
    );
  }

  return material;
}

function requireHardwareId(
  line: HardwareLine,
  optionChoices: OptionChoices,
  catalog: Catalog,
  moduleCode: string,
): string {
  const hardwareId = line.hardwareId ?? optionChoices[line.optionRole];
  if (!hardwareId) {
    const group = findOptionGroup(catalog, line.optionRole);
    if (group?.required !== false) {
      throw new ResolutionError(
        `Missing required hardware choice for role "${line.optionRole}" on line ${line.id}`,
        {
          moduleCode,
          hardwareLineId: line.id,
          optionGroupCode: line.optionRole,
          field: 'optionChoices',
        },
      );
    }
    throw new ResolutionError(
      `Missing hardware for line ${line.id} (no fixed hardwareId and no choice for "${line.optionRole}")`,
      {
        moduleCode,
        hardwareLineId: line.id,
        optionGroupCode: line.optionRole,
        field: 'hardwareId',
      },
    );
  }

  const hardware = findHardware(catalog, hardwareId);
  if (!hardware) {
    throw new ResolutionError(`Hardware not found: ${hardwareId}`, {
      moduleCode,
      hardwareLineId: line.id,
      hardwareId,
      field: 'hardwareId',
    });
  }

  if (!hardware.active) {
    throw new ValidationError(
      `Inactive hardware cannot be used: ${hardware.code}`,
      {
        moduleCode,
        hardwareLineId: line.id,
        hardwareId: hardware.id,
        field: 'active',
      },
    );
  }

  return hardware.id;
}

/**
 * Resolve board parts + hardware lines into material/hardware IDs.
 * Extracted for reuse by both legacy and composed module paths.
 */
function resolveBoardPartsAndHardware(
  boardParts: readonly BoardPart[],
  hardwareLines: readonly HardwareLine[],
  optionChoices: OptionChoices,
  catalog: Catalog,
  moduleCode: string,
): ResolvedBom {
  const resolvedBoardParts: ResolvedBoardPart[] = boardParts.map((part) => {
    const material = requireMaterialChoice(
      part,
      optionChoices,
      catalog,
      moduleCode,
    );
    const edgeBandId = resolveEdgeBandId(
      part,
      material,
      optionChoices,
      catalog,
      moduleCode,
    );

    return {
      id: part.id,
      code: part.code,
      description: part.description,
      quantity: part.quantity,
      lengthMm: part.lengthMm,
      widthMm: part.widthMm,
      // Grain (veta) is inherited from the resolved material, never set per piece.
      grain: (material.grainDefault ? 1 : 0) as Grain,
      edges: part.edges,
      optionRole: part.optionRole,
      materialId: material.id,
      edgeBandId,
      x: part.x,
      y: part.y,
      z: part.z,
      rotateX: part.rotateX,
      rotateY: part.rotateY,
      rotateZ: part.rotateZ,
      thicknessMm: material.thicknessMm,
    };
  });

  const resolvedHardwareLines: ResolvedHardwareLine[] = hardwareLines.map(
    (line) => {
      const hardwareId = requireHardwareId(
        line,
        optionChoices,
        catalog,
        moduleCode,
      );
      return {
        id: line.id,
        quantity: line.quantity,
        descriptionOverride: line.descriptionOverride,
        optionRole: line.optionRole,
        hardwareId,
      };
    },
  );

  return { boardParts: resolvedBoardParts, hardwareLines: resolvedHardwareLines };
}

/**
 * Resolve a composed module (structure + component instances) into board parts.
 *
 * Since F053 a Structure no longer carries its own board parts; instead it
 * composes reusable Component instances. So the composed board parts come from
 * BOTH the structure's component instances and the module's own component
 * instances, each expanded per quantity.
 */
function getComponentThickness(
  component: Component,
  optionChoices: OptionChoices,
  catalog: Catalog,
): number {
  const role = component.optionRoles[0];
  if (role) {
    const choiceId = optionChoices[role];
    if (choiceId) {
      const material = catalog.materials.find((m) => m.id === choiceId);
      if (material) {
        return material.thicknessMm;
      }
    }
  }
  return component.geometry.kind === 'rectangular_board'
    ? component.geometry.thicknessMm
    : 18;
}

function expandComponentInstances(
  instances: readonly ModuleComponentInstance[],
  catalog: Catalog,
  idPrefix: string,
  dims: { width: number; height: number; depth: number },
  optionChoices?: OptionChoices,
): BoardPart[] {
  const PW = dims.width;
  const PD = dims.depth;
  const PH = dims.height;

  const parts: BoardPart[] = [];
  for (const instance of instances) {
    const component = catalog.components?.find(
      (c) => c.id === instance.componentId,
    );
    if (!component) {
      throw new ResolutionError(
        `Component not found: ${instance.componentId}`,
        {
          componentId: instance.componentId,
          field: 'componentId',
        },
      );
    }

    const edges = instance.overrides?.edges ?? component.defaultEdges;
    const optionRole = component.optionRoles[0]!;

    // Resolve component material thickness
    const T = getComponentThickness(component, optionChoices ?? {}, catalog);

    // Context for geometry evaluation (only parent dims + T are available)
    const geomDims = { W: PW, H: PH, D: PD, PW, PH, PD, T };

    // Resolve dimensions (W and D of component)
    let lengthMm = 0; // component depth (D)
    let widthMm = 0;  // component width (W)
    if (component.geometry.kind === 'rectangular_board') {
      const lengthFormula =
        instance.overrides?.lengthFormula ?? component.geometry.lengthFormula;
      const widthFormula =
        instance.overrides?.widthFormula ?? component.geometry.widthFormula;
      lengthMm = lengthFormula
        ? evaluatePartFormula(lengthFormula, geomDims, {
            structureCode: component.code,
            partDescription: component.name,
            field: 'length',
          })
        : component.geometry.lengthMm;
      widthMm = widthFormula
        ? evaluatePartFormula(widthFormula, geomDims, {
            structureCode: component.code,
            partDescription: component.name,
            field: 'width',
          })
        : component.geometry.widthMm;
    }

    // Spatial coords: per-axis formula when set; empty axes keep placement pose.
    const H = T; // part thickness available as H in spatial formulas (use PH for parent height)
    const xFormula = instance.overrides?.xFormula ?? component.xFormula;
    const yFormula = instance.overrides?.yFormula ?? component.yFormula;
    const zFormula = instance.overrides?.zFormula ?? component.zFormula;

    const placement =
      instance.placementOverride?.trim() || component.placement || 'custom';

    for (let i = 0; i < instance.quantity; i++) {
      const spatialDims = { W: widthMm, H, D: lengthMm, PW, PH, PD, T, i };
      const placementPose = defaultPoseForPlacement(
        placement,
        { PW, PH, PD, T },
        i,
        instance.quantity,
      );

      const x = xFormula?.trim()
        ? evaluatePartFormula(xFormula, spatialDims, {
            structureCode: component.code,
            partDescription: component.name,
            field: 'x',
          })
        : placementPose.x;
      const y = yFormula?.trim()
        ? evaluatePartFormula(yFormula, spatialDims, {
            structureCode: component.code,
            partDescription: component.name,
            field: 'y',
          })
        : placementPose.y;
      const z = zFormula?.trim()
        ? evaluatePartFormula(zFormula, spatialDims, {
            structureCode: component.code,
            partDescription: component.name,
            field: 'z',
          })
        : placementPose.z;
      // Explicit rotate on component/override wins over placement default.
      const rotateX =
        instance.overrides?.rotateX ??
        component.rotateX ??
        placementPose.rotateX;
      const rotateY =
        instance.overrides?.rotateY ??
        component.rotateY ??
        placementPose.rotateY;
      const rotateZ =
        instance.overrides?.rotateZ ??
        component.rotateZ ??
        placementPose.rotateZ;

      parts.push({
        id: `${idPrefix}${component.id}-copy-${i}`,
        description: component.name,
        quantity: 1,
        lengthMm,
        widthMm,
        edges,
        optionRole,
        x,
        y,
        z,
        rotateX,
        rotateY,
        rotateZ,
      });
    }
  }
  return parts;
}

export interface ComposedModuleInput {
  readonly structure: Structure;
  readonly componentInstances: readonly ModuleComponentInstance[];
  readonly catalog: Catalog;
  readonly dims: { width: number; height: number; depth: number };
  readonly optionChoices?: OptionChoices;
}

export interface ComposedModuleResult {
  readonly boardParts: readonly BoardPart[];
  readonly hardwareLines: readonly HardwareLine[];
}

export function resolveComposedModule(
  input: ComposedModuleInput,
): ComposedModuleResult {
  const { structure, componentInstances, catalog, dims, optionChoices } = input;

  // Validate the selected dims against presets/externalDims (throws on mismatch).
  resolveStructure(structure, dims);

  // Structure component instances + module component instances, expanded.
  const structureParts = expandComponentInstances(
    structure.components ?? [],
    catalog,
    '',
    dims,
    optionChoices,
  );
  const moduleParts = expandComponentInstances(
    componentInstances,
    catalog,
    '',
    dims,
    optionChoices,
  );
  const allParts = [...structureParts, ...moduleParts];

  // Hardware lines deferred from MVP.
  return {
    boardParts: allParts,
    hardwareLines: [],
  };
}

/**
 * Resolve module template + option choices into concrete material/hardware IDs.
 *
 * Since Fase 2 a Module no longer carries board parts of its own — it composes
 * a Structure body + component instances. A module without a structureId yields
 * no board parts (it may still carry hardware lines). VAL-05 (empty cut list
 * on export) is enforced by the export path.
 *
 * Optional measurePresetId selects commercial size from Module.presets (H09).
 * Falls back to Module.externalDims when no commercial presets are defined.
 */
export function resolveBom(
  module: Module,
  optionChoices: OptionChoices,
  catalog: Catalog,
  measurePresetId?: string,
  /**
   * Pinned structure revision (#108). When the caller has a closed project,
   * pass `item.structureRevisionPin` so the BOM resolves against the frozen
   * revision rather than the live catalog structure. Omit for draft/live use.
   */
  structureRevisionPin?: number,
): ResolvedBom {
  validateModule(module);

  // Resolve the composed body (structure components) + module components.
  let allParts: BoardPart[] = [];
  let composedHardware: HardwareLine[] = [];
  if (module.structureId) {
    const found = catalog.structures?.find(
      (s) => s.id === module.structureId,
    );
    if (!found) {
      throw new ResolutionError(
        `Structure not found: ${module.structureId}`,
        {
          moduleCode: module.code,
          structureId: module.structureId,
          field: 'structureId',
        },
      );
    }

    // #108 — honor a pinned revision when present. Falls back to live
    // structure when the pin is undefined. Throws ResolutionError for an
    // unknown pin (deleted structure without snapshot, etc.).
    const structure = resolveStructureForPin(found, structureRevisionPin);

    const preset = resolveModuleMeasurePreset(module, measurePresetId);
    const dims = preset
      ? {
          width: preset.width,
          height: preset.height,
          depth: preset.depth,
        }
      : module.externalDims
        ? {
            width: module.externalDims.width,
            height: module.externalDims.height,
            depth: module.externalDims.depth,
          }
        : structure.externalDims
          ? {
              width: structure.externalDims.width,
              height: structure.externalDims.height,
              depth: structure.externalDims.depth,
            }
          : undefined;

    if (!dims) {
      throw new ResolutionError(
        'Composed module requires a measure preset or externalDims',
        {
          moduleCode: module.code,
          field: measurePresetId ? 'measurePresetId' : 'externalDims',
        },
      );
    }

    const composed = resolveComposedModule({
      structure,
      componentInstances: module.components ?? [],
      catalog,
      dims,
      optionChoices,
    });
    allParts = [...composed.boardParts];
    composedHardware = [...composed.hardwareLines];
  } else {
    // Fixed / non-composed path: still validate measurePresetId if presets exist.
    resolveModuleMeasurePreset(module, measurePresetId);
  }

  // Merge composed parts/hardware with the module's own hardware lines.
  const allHardware = [...composedHardware, ...module.hardwareLines];

  for (const part of allParts) validateBoardPart(part, module.code);
  for (const line of allHardware) validateHardwareLine(line, module.code);

  return resolveBoardPartsAndHardware(
    allParts,
    allHardware,
    optionChoices,
    catalog,
    module.code,
  );
}

/**
 * Validates selected outer dimensions for a structure body.
 * Pure parametric gate (dims > 0) — commercial allowlists live on Module.presets.
 * Structure.presets are engineering preview only and are not enforced here.
 *
 * Since F053 a Structure no longer carries board parts — it composes reusable
 * Component instances (see resolveComposedModule). Returns an empty array;
 * component-derived parts are produced by resolveComposedModule.
 */
export function resolveStructure(
  structure: Structure,
  selectedDims: { width: number; height: number; depth: number },
): BoardPart[] {
  if (
    selectedDims.width <= 0 ||
    selectedDims.height <= 0 ||
    selectedDims.depth <= 0
  ) {
    throw new ValidationError(
      'Las medidas de la estructura deben ser mayores a 0',
      {
        structureCode: structure.code,
        selectedDims,
        field: 'selectedDims',
      },
    );
  }

  // Structures contribute no board parts of their own — component instances
  // are expanded by resolveComposedModule using the catalog Component geometry.
  return [];
}
