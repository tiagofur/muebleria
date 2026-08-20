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
import {
  calculateAgregadoSubspaceUnits,
  resolveAgregadoInstance,
} from '../agregados';
import {
  applyBaseTreatment,
  filterComponentInstancesForBaseMode,
  resolveBaseClearanceWithContext,
  resolveBaseModeWithContext,
  resolveBoardOptionChoiceId,
  type BaseResolutionContext,
  ZOCLO_BOARD_FALLBACK_ROLE,
  ZOCLO_BOARD_ROLE,
} from '../plinth';
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
  const choiceId = resolveBoardOptionChoiceId(part.optionRole, optionChoices);

  if (!choiceId) {
    const required = group?.required !== false;
    // ZOCLO without choice is not required if FRENTE can supply — already tried.
    const zocloHint =
      part.optionRole === ZOCLO_BOARD_ROLE
        ? ` (ni fallback ${ZOCLO_BOARD_FALLBACK_ROLE})`
        : '';
    if (required && part.optionRole !== ZOCLO_BOARD_ROLE) {
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
      `Missing material choice for role "${part.optionRole}" on part ${part.code ?? part.id}${zocloHint}`,
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
  const rawHwId = line.hardwareId?.trim();
  const hardwareId = rawHwId || optionChoices[line.optionRole];
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
    const choiceId = resolveBoardOptionChoiceId(role, optionChoices);
    if (choiceId) {
      const materials = catalog.materials ?? [];
      const material = materials.find((m) => m.id === choiceId);
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
  /** Plinth height B (mm) for formulas. */
  baseClearanceMm = 0,
): BoardPart[] {
  const PW = dims.width;
  const PD = dims.depth;
  const PH = dims.height;
  const B = Math.max(0, baseClearanceMm);

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

    // Context for geometry evaluation (parent dims + T + B zoclo)
    const geomDims = { W: PW, H: PH, D: PD, PW, PH, PD, T, B };

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
      const spatialDims = { W: widthMm, H, D: lengthMm, PW, PH, PD, T, B, i };
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
        (placement === 'custom' || (component.rotateX && component.rotateX !== 0)
          ? component.rotateX
          : placementPose.rotateX);
      const rotateY =
        instance.overrides?.rotateY ??
        (placement === 'custom' || (component.rotateY && component.rotateY !== 0)
          ? component.rotateY
          : placementPose.rotateY);
      const rotateZ =
        instance.overrides?.rotateZ ??
        (placement === 'custom' || (component.rotateZ && component.rotateZ !== 0)
          ? component.rotateZ
          : placementPose.rotateZ);

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
  /** When set, filters zoclo components and supplies B to formulas. */
  readonly module?: Pick<
    Module,
    'baseMode' | 'baseClearanceMm' | 'furnitureType' | 'agregados'
  >;
  /** Quote-line base context (F087): item baseMode + plan height B. */
  readonly baseContext?: BaseResolutionContext;
}

export interface ComposedModuleResult {
  readonly boardParts: readonly BoardPart[];
  readonly hardwareLines: readonly HardwareLine[];
}

export function resolveComposedModule(
  input: ComposedModuleInput,
): ComposedModuleResult {
  const {
    structure,
    componentInstances,
    catalog,
    dims,
    optionChoices,
    module,
    baseContext,
  } = input;

  // Validate the selected dims against presets/externalDims (throws on mismatch).
  resolveStructure(structure, dims);

  const baseMode = module
    ? resolveBaseModeWithContext(module, baseContext)
    : 'none';
  const B = module ? resolveBaseClearanceWithContext(module, baseContext) : 0;

  const structureInstances = filterComponentInstancesForBaseMode(
    structure.components ?? [],
    catalog.components,
    baseMode,
  );
  const moduleInstances = filterComponentInstancesForBaseMode(
    componentInstances ?? [],
    catalog.components,
    baseMode,
  );

  // Structure component instances + module component instances, expanded.
  const structureParts = expandComponentInstances(
    structureInstances,
    catalog,
    '',
    dims,
    optionChoices,
    B,
  );
  const moduleParts = expandComponentInstances(
    moduleInstances,
    catalog,
    '',
    dims,
    optionChoices,
    B,
  );

  // Expand sub-assemblies (agregados) attached to structure or module.
  let agregadosParts: BoardPart[] = [];
  let agregadosHardware: HardwareLine[] = [];
  const catalogAgregados = catalog.agregados ?? [];
  const allAgregadoInstances = [
    ...(structure.agregados ?? []),
    ...(module?.agregados ?? []),
  ];

  const PW = dims.width;
  const PH = dims.height;
  const PD = dims.depth;

  for (const agrInst of allAgregadoInstances) {
    const agregado = catalogAgregados.find((a) => a.id === agrInst.agregadoId);
    // R-5: throw loudly when an agregadoId references nothing in the catalog.
    // A silent `continue` here would produce an incomplete BOM without any
    // warning — the worst kind of data-integrity bug (typo → missing pieces).
    if (!agregado) {
      throw new ResolutionError(
        `Agregado not found: ${agrInst.agregadoId}`,
        {
          agregadoId: agrInst.agregadoId,
          field: 'agregadoId',
        },
      );
    }

    // Evaluate sub-assembly space bounding box and origin position in parent furniture space
    const parentDims = { W: PW, H: PH, D: PD, PW, PH, PD, T: 18, B };
    const rawW = agrInst.dimensions?.widthFormula?.trim()
      ? evaluatePartFormula(agrInst.dimensions.widthFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'width',
        })
      : agregado.externalDims?.width && agregado.externalDims.width > 0
        ? agregado.externalDims.width
        : PW;
    const spaceW = rawW > 0 ? rawW : PW;

    const rawH = agrInst.dimensions?.heightFormula?.trim()
      ? evaluatePartFormula(agrInst.dimensions.heightFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'length',
        })
      : agregado.externalDims?.height && agregado.externalDims.height > 0
        ? agregado.externalDims.height
        : PH;
    const spaceH = rawH > 0 ? rawH : PH;

    const rawD = agrInst.dimensions?.depthFormula?.trim()
      ? evaluatePartFormula(agrInst.dimensions.depthFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'length',
        })
      : PD;
    const spaceD = rawD > 0 ? rawD : PD;

    const spaceX = agrInst.position?.xFormula
      ? evaluatePartFormula(agrInst.position.xFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'x',
        })
      : 0;

    const spaceY = agrInst.position?.yFormula
      ? evaluatePartFormula(agrInst.position.yFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'y',
        })
      : 0;

    const spaceZ = agrInst.position?.zFormula
      ? evaluatePartFormula(agrInst.position.zFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'z',
        })
      : 0;

    const units = calculateAgregadoSubspaceUnits(
      agrInst.quantity,
      { width: spaceW, height: spaceH, depth: spaceD },
      { x: spaceX, y: spaceY, z: spaceZ },
      agrInst.layoutDirection ?? 'none',
      agrInst.gapMm ?? 0,
    );

    for (const unit of units) {
      const unitInst = { ...agrInst, quantity: 1 };
      const res = resolveAgregadoInstance(unitInst, catalogAgregados, unit.unitIndex);
      agregadosHardware.push(...res.hardwareLines);

      const filteredComponents = filterComponentInstancesForBaseMode(
        res.components ?? [],
        catalog.components ?? [],
        baseMode,
      );

      const unitParts = expandComponentInstances(
        filteredComponents,
        catalog,
        `agr-${agrInst.agregadoId}-u${unit.unitIndex}`,
        { width: unit.width, height: unit.height, depth: unit.depth },
        optionChoices,
        B,
      );

      // Apply unit origin offset (spaceX + unit.x, spaceY + unit.y, spaceZ + unit.z)
      const offsetParts = unitParts.map((p) => ({
        ...p,
        x: (p.x ?? 0) + unit.x,
        y: (p.y ?? 0) + unit.y,
        z: (p.z ?? 0) + unit.z,
      }));

      agregadosParts.push(...offsetParts);
    }
  }

  const allParts = [...structureParts, ...moduleParts, ...agregadosParts];

  return {
    boardParts: allParts,
    hardwareLines: agregadosHardware,
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
  /**
   * Quote-line base treatment context (F087): item baseMode override and the
   * plinth height B resolved from the plan. Omit to use module defaults.
   */
  baseContext?: BaseResolutionContext,
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
      module,
      baseContext,
    });
    allParts = [...composed.boardParts];
    composedHardware = [...composed.hardwareLines];

    // Synthesize the base parts the mode needs, then apply mode rules
    // (zoclo strip ml, legs qty) over composed + module hardware.
    const treatment = applyBaseTreatment(
      module.code,
      allParts,
      [...composedHardware, ...(module.hardwareLines ?? [])],
      resolveBaseModeWithContext(module, baseContext),
      resolveBaseClearanceWithContext(module, baseContext),
      dims.width,
      dims.depth,
      baseContext?.plinthSides,
      optionChoices,
      baseContext?.plinthRun,
    );
    allParts = treatment.parts;
    composedHardware = treatment.hardwareLines;

    for (const part of allParts) validateBoardPart(part, module.code);
    for (const line of composedHardware) validateHardwareLine(line, module.code);

    return resolveBoardPartsAndHardware(
      allParts,
      composedHardware,
      optionChoices,
      catalog,
      module.code,
    );
  }

  // Fixed / non-composed path: still validate measurePresetId if presets exist.
  resolveModuleMeasurePreset(module, measurePresetId);

  const dimsFallback = module.externalDims
    ? {
        width: module.externalDims.width,
        height: module.externalDims.height,
        depth: module.externalDims.depth,
      }
    : { width: 600, height: 720, depth: 560 };

  // R-4: expand agregados even when the module has no structureId. A synthetic
  // empty structure lets resolveComposedModule handle the agregado expansion
  // (subspace, offsets, hardware) — same logic as the composed path. Without
  // this, a non-composed module's agregados were silently dropped from the BOM.
  const hasAgregados = module.agregados && module.agregados.length > 0;
  if (hasAgregados) {
    const syntheticStructure: Structure = {
      id: `synthetic-${module.id}`,
      code: module.code,
      name: module.name,
      externalDims: dimsFallback,
      components: [],
      agregados: module.agregados,
      active: true,
    };
    const composed = resolveComposedModule({
      structure: syntheticStructure,
      componentInstances: [],
      catalog,
      dims: dimsFallback,
      optionChoices,
      module,
      baseContext,
    });
    allParts = [...composed.boardParts];
    composedHardware = [...composed.hardwareLines];
  }

  const treatment = applyBaseTreatment(
    module.code,
    allParts,
    [...composedHardware, ...(module.hardwareLines ?? [])],
    resolveBaseModeWithContext(module, baseContext),
    resolveBaseClearanceWithContext(module, baseContext),
    dimsFallback.width,
    dimsFallback.depth,
    baseContext?.plinthSides,
    optionChoices,
    baseContext?.plinthRun,
  );
  allParts = treatment.parts;
  const allHardware = treatment.hardwareLines;

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
