/**
 * Domain calculation engine: BOM resolution, line costs, project quote breakdown.
 */

import { ResolutionError, ValidationError } from './errors';
import {
  resolveModuleMeasurePreset,
  validateModulePresets,
} from './measurePresets';
import { effectiveOptionChoices } from './optionChoices';
import { defaultPoseForPlacement } from './spatialPlacement';
import type {
  BoardPart,
  Catalog,
  Component,
  EdgeAssignment,
  EdgeBand,
  Grain,
  Hardware,
  HardwareLine,
  EdgeUsageRow,
  HardwarePurchaseRow,
  MaterialBoard,
  MaterialUsageRow,
  Module,
  ModuleComponentInstance,
  OptionChoices,
  OptionGroup,
  PieceLabel,
  ProductionCutRow,
  Project,
  ProjectMaterialSummary,
  ProjectStatus,
  QuoteBreakdown,
  QuotePriceSnapshot,
  ResolvedBoardPart,
  ResolvedBom,
  ResolvedHardwareLine,
  Structure,
} from './types';

const EDGE_OPTION_ROLE = 'EDGE';

export interface BoardLineCost {
  readonly areaM2: number;
  readonly edgeMl: number;
  readonly boardCost: number;
  readonly edgeCost: number;
  readonly hardwareCost: 0;
}

export interface HardwareLineCost {
  readonly areaM2: 0;
  readonly edgeMl: 0;
  readonly boardCost: 0;
  readonly edgeCost: 0;
  readonly hardwareCost: number;
}

export type LineCost = BoardLineCost | HardwareLineCost;

function findOptionGroup(
  catalog: Catalog,
  code: string,
): OptionGroup | undefined {
  return catalog.optionGroups.find((g) => g.code === code);
}

function findMaterial(catalog: Catalog, id: string): MaterialBoard | undefined {
  return catalog.materials.find((m) => m.id === id);
}

function findEdgeBand(catalog: Catalog, id: string): EdgeBand | undefined {
  return catalog.edges.find((e) => e.id === id);
}

function findHardware(catalog: Catalog, id: string): Hardware | undefined {
  return catalog.hardware.find((h) => h.id === id);
}

function findModule(catalog: Catalog, id: string): Module | undefined {
  return catalog.modules.find((m) => m.id === id);
}

function edgeFlags(edges: readonly EdgeAssignment[]): {
  L1: number;
  L2: number;
  W1: number;
  W2: number;
} {
  const bySide = Object.fromEntries(
    edges.map((e) => [e.side, e.enabled ? 1 : 0]),
  ) as Record<string, number>;
  return {
    L1: bySide.L1 ?? 0,
    L2: bySide.L2 ?? 0,
    W1: bySide.W1 ?? 0,
    W2: bySide.W2 ?? 0,
  };
}

function hasAnyEdgeEnabled(edges: readonly EdgeAssignment[]): boolean {
  return edges.some((e) => e.enabled);
}

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

/** VAL-01, VAL-04 (structure), basic part integrity at resolution time. */
export function validateBoardPart(
  part: BoardPart,
  moduleCode?: string,
): void {
  if (!(part.lengthMm > 0) || !(part.widthMm > 0)) {
    throw new ValidationError(
      `Board part dimensions must be > 0 (lengthMm=${part.lengthMm}, widthMm=${part.widthMm})`,
      {
        moduleCode,
        partId: part.id,
        partCode: part.code,
        field: 'lengthMm/widthMm',
        lengthMm: part.lengthMm,
        widthMm: part.widthMm,
      },
    );
  }

  if (!(part.quantity > 0)) {
    throw new ValidationError(
      `Board part quantity must be > 0 (got ${part.quantity})`,
      {
        moduleCode,
        partId: part.id,
        field: 'quantity',
        quantity: part.quantity,
      },
    );
  }

  if (part.edges.length !== 4) {
    throw new ValidationError(
      `Board part must define exactly 4 edge assignments (got ${part.edges.length})`,
      {
        moduleCode,
        partId: part.id,
        field: 'edges',
      },
    );
  }

  const sides = new Set(part.edges.map((e) => e.side));
  for (const side of ['L1', 'L2', 'W1', 'W2'] as const) {
    if (!sides.has(side)) {
      throw new ValidationError(
        `Board part missing edge side ${side}`,
        { moduleCode, partId: part.id, field: 'edges', side },
      );
    }
  }
}

/**
 * Validate a reusable component (F049 / H07).
 * Checks code, name, geometry dimensions, optionRoles, and edge assignments.
 */
export function validateComponent(component: Component): void {
  if (!component.code?.trim()) {
    throw new ValidationError('Component code must not be empty', {
      componentId: component.id,
      field: 'code',
    });
  }
  if (!component.name?.trim()) {
    throw new ValidationError('Component name must not be empty', {
      componentId: component.id,
      componentCode: component.code,
      field: 'name',
    });
  }
  if (component.geometry.kind === 'rectangular_board') {
    if (!(component.geometry.lengthMm > 0)) {
      throw new ValidationError('Component lengthMm must be > 0', {
        componentId: component.id,
        componentCode: component.code,
        field: 'lengthMm',
        lengthMm: component.geometry.lengthMm,
      });
    }
    if (!(component.geometry.widthMm > 0)) {
      throw new ValidationError('Component widthMm must be > 0', {
        componentId: component.id,
        componentCode: component.code,
        field: 'widthMm',
        widthMm: component.geometry.widthMm,
      });
    }
    if (!(component.geometry.thicknessMm > 0)) {
      throw new ValidationError('Component thicknessMm must be > 0', {
        componentId: component.id,
        componentCode: component.code,
        field: 'thicknessMm',
        thicknessMm: component.geometry.thicknessMm,
      });
    }
  }
  if (!component.optionRoles || component.optionRoles.length === 0) {
    throw new ValidationError('Component optionRoles must be non-empty', {
      componentId: component.id,
      componentCode: component.code,
      field: 'optionRoles',
    });
  }
  if (component.defaultEdges.length !== 4) {
    throw new ValidationError(
      'Component defaultEdges must have exactly 4 assignments',
      {
        componentId: component.id,
        componentCode: component.code,
        field: 'edges',
        edges: component.defaultEdges.length,
      },
    );
  }
}

/** VAL-03 for hardware lines. */
export function validateHardwareLine(
  line: HardwareLine,
  moduleCode?: string,
): void {
  if (!(line.quantity > 0)) {
    throw new ValidationError(
      `Hardware line quantity must be > 0 (got ${line.quantity})`,
      {
        moduleCode,
        hardwareLineId: line.id,
        field: 'quantity',
        quantity: line.quantity,
      },
    );
  }
}

/** VAL-07 catalog/module empty names/codes + component instance integrity. */
export function validateModule(module: Module): void {
  if (!module.code?.trim()) {
    throw new ValidationError('Module code must not be empty', {
      moduleId: module.id,
      field: 'code',
    });
  }
  if (!module.name?.trim()) {
    throw new ValidationError('Module name must not be empty', {
      moduleId: module.id,
      moduleCode: module.code,
      field: 'name',
    });
  }

  // Module-level component instances (doors, shelves, …).
  for (const instance of module.components ?? []) {
    if (!instance.componentId?.trim()) {
      throw new ValidationError(
        'Module component instance must reference a componentId',
        {
          moduleCode: module.code,
          field: 'componentId',
        },
      );
    }
    if (!(instance.quantity > 0)) {
      throw new ValidationError(
        `Module component instance quantity must be > 0 (got ${instance.quantity})`,
        {
          moduleCode: module.code,
          componentId: instance.componentId,
          field: 'quantity',
        },
      );
    }
  }

  for (const line of module.hardwareLines) {
    validateHardwareLine(line, module.code);
    if (!line.optionRole?.trim() && !line.hardwareId) {
      throw new ValidationError(
        'Hardware line needs optionRole or fixed hardwareId',
        {
          moduleCode: module.code,
          hardwareLineId: line.id,
          field: 'optionRole',
        },
      );
    }
  }

  validateModulePresets(module);
}

/**
 * Validate engineering Structure (cuerpo) — F049 / #99.
 * A structure composes reusable Component instances (no board parts of its own).
 */
export function validateStructure(structure: Structure): void {
  if (!structure.code?.trim()) {
    throw new ValidationError('Structure code must not be empty', {
      structureId: structure.id,
      field: 'code',
    });
  }
  if (!structure.name?.trim()) {
    throw new ValidationError('Structure name must not be empty', {
      structureId: structure.id,
      structureCode: structure.code,
      field: 'name',
    });
  }
  if (!structure.components || structure.components.length === 0) {
    throw new ValidationError(
      'Structure must have at least one component instance',
      {
        structureId: structure.id,
        structureCode: structure.code,
        field: 'components',
      },
    );
  }

  if (structure.presets) {
    for (const preset of structure.presets) {
      if (preset.width <= 0 || preset.height <= 0 || preset.depth <= 0) {
        throw new ValidationError(
          'Las dimensiones del preset deben ser mayores a 0',
          {
            structureCode: structure.code,
            presetId: preset.id,
            field: 'presets',
          },
        );
      }
    }
  }

  for (const instance of structure.components) {
    if (!instance.componentId?.trim()) {
      throw new ValidationError(
        'Structure component instance must reference a componentId',
        {
          structureCode: structure.code,
          field: 'componentId',
        },
      );
    }
    if (!(instance.quantity > 0)) {
      throw new ValidationError(
        `Structure component instance quantity must be > 0 (got ${instance.quantity})`,
        {
          structureCode: structure.code,
          componentId: instance.componentId,
          field: 'quantity',
        },
      );
    }
  }
}

export function validateCatalogEntityCodes(catalog: Catalog): void {
  for (const m of catalog.materials) {
    if (!m.code?.trim() || !m.name?.trim()) {
      throw new ValidationError(
        'Material code and name must not be empty',
        { materialId: m.id, field: 'code/name' },
      );
    }
  }
  for (const e of catalog.edges) {
    if (!e.code?.trim() || !e.name?.trim()) {
      throw new ValidationError(
        'Edge band code and name must not be empty',
        { edgeBandId: e.id, field: 'code/name' },
      );
    }
  }
  for (const h of catalog.hardware) {
    if (!h.code?.trim() || !h.name?.trim()) {
      throw new ValidationError(
        'Hardware code and name must not be empty',
        { hardwareId: h.id, field: 'code/name' },
      );
    }
  }
  for (const g of catalog.optionGroups) {
    if (!g.code?.trim() || !g.name?.trim()) {
      throw new ValidationError(
        'Option group code and name must not be empty',
        { optionGroupId: g.id, field: 'code/name' },
      );
    }
  }
  for (const mod of catalog.modules) {
    validateModule(mod);
  }
  for (const st of catalog.structures ?? []) {
    validateStructure(st);
  }
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
): ResolvedBom {
  validateModule(module);

  // Resolve the composed body (structure components) + module components.
  let allParts: BoardPart[] = [];
  let composedHardware: HardwareLine[] = [];
  if (module.structureId) {
    const structure = catalog.structures?.find(
      (s) => s.id === module.structureId,
    );
    if (!structure) {
      throw new ResolutionError(
        `Structure not found: ${module.structureId}`,
        {
          moduleCode: module.code,
          structureId: module.structureId,
          field: 'structureId',
        },
      );
    }

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

export function calcMaterialCostPerM2(
  widthMm: number,
  lengthMm: number,
  boardPrice: number,
  wastePercent: number,
): number {
  if (widthMm <= 0 || lengthMm <= 0) return 0;
  const areaM2 = (widthMm * lengthMm) / 1_000_000;
  const baseCost = boardPrice / areaM2;
  return baseCost * (1 + wastePercent / 100);
}

export function calcBoardLineMetrics(
  part: Pick<
    ResolvedBoardPart,
    'quantity' | 'lengthMm' | 'widthMm' | 'edges'
  >,
): { areaM2: number; edgeMl: number } {
  const qty = part.quantity;
  const { L1, L2, W1, W2 } = edgeFlags(part.edges);
  const areaM2 = (qty * part.lengthMm * part.widthMm) / 1_000_000;
  const edgeMl =
    (qty * ((L1 + L2) * part.lengthMm + (W1 + W2) * part.widthMm)) / 1000;
  return { areaM2, edgeMl };
}

export function calcBoardLineCost(
  part: ResolvedBoardPart,
  catalog: Catalog,
  quantityMultiplier = 1,
): BoardLineCost {
  if (!(part.lengthMm > 0) || !(part.widthMm > 0)) {
    throw new ValidationError(
      `Board part dimensions must be > 0 (lengthMm=${part.lengthMm}, widthMm=${part.widthMm})`,
      {
        partId: part.id,
        field: 'lengthMm/widthMm',
      },
    );
  }

  const material = findMaterial(catalog, part.materialId);
  if (!material) {
    throw new ResolutionError(
      `Material not found: ${part.materialId}`,
      { partId: part.id, materialId: part.materialId, field: 'materialId' },
    );
  }
  if (!material.active) {
    throw new ValidationError(
      `Inactive material cannot be used: ${material.code}`,
      { partId: part.id, materialId: material.id, field: 'active' },
    );
  }

  const scaled: ResolvedBoardPart = {
    ...part,
    quantity: part.quantity * quantityMultiplier,
  };
  const { areaM2, edgeMl } = calcBoardLineMetrics(scaled);
  const boardCost = areaM2 * material.costPerM2;

  let edgeCost = 0;
  if (hasAnyEdgeEnabled(part.edges)) {
    if (!part.edgeBandId) {
      throw new ResolutionError(
        `Missing edgeBandId for part with edges enabled: ${part.code ?? part.id}`,
        { partId: part.id, field: 'edgeBandId' },
      );
    }
    const edgeBand = findEdgeBand(catalog, part.edgeBandId);
    if (!edgeBand) {
      throw new ResolutionError(
        `Edge band not found: ${part.edgeBandId}`,
        { partId: part.id, edgeBandId: part.edgeBandId, field: 'edgeBandId' },
      );
    }
    if (!edgeBand.active) {
      throw new ValidationError(
        `Inactive edge band cannot be used: ${edgeBand.code}`,
        { partId: part.id, edgeBandId: edgeBand.id, field: 'active' },
      );
    }
    edgeCost = edgeMl * edgeBand.costPerMl;
  }

  return {
    areaM2,
    edgeMl,
    boardCost,
    edgeCost,
    hardwareCost: 0,
  };
}

export function calcHardwareLineCost(
  line: ResolvedHardwareLine,
  catalog: Catalog,
  quantityMultiplier = 1,
): HardwareLineCost {
  if (!(line.quantity > 0)) {
    throw new ValidationError(
      `Hardware line quantity must be > 0 (got ${line.quantity})`,
      { hardwareLineId: line.id, field: 'quantity' },
    );
  }

  const hardware = findHardware(catalog, line.hardwareId);
  if (!hardware) {
    throw new ResolutionError(`Hardware not found: ${line.hardwareId}`, {
      hardwareLineId: line.id,
      hardwareId: line.hardwareId,
      field: 'hardwareId',
    });
  }
  if (!hardware.active) {
    throw new ValidationError(
      `Inactive hardware cannot be used: ${hardware.code}`,
      {
        hardwareLineId: line.id,
        hardwareId: hardware.id,
        field: 'active',
      },
    );
  }

  const hardwareCost =
    line.quantity * quantityMultiplier * hardware.costPerUnit;

  return {
    areaM2: 0,
    edgeMl: 0,
    boardCost: 0,
    edgeCost: 0,
    hardwareCost,
  };
}

/** Line cost for a resolved board part or hardware line (PRD §13.2). */
export function calcLineCost(
  line: ResolvedBoardPart | ResolvedHardwareLine,
  catalog: Catalog,
  quantityMultiplier = 1,
): LineCost {
  if ('materialId' in line) {
    return calcBoardLineCost(line, catalog, quantityMultiplier);
  }
  return calcHardwareLineCost(line, catalog, quantityMultiplier);
}

/** PRD §7.4 — quoted/accepted freeze catalog unit prices. */
export function isProjectClosed(status: ProjectStatus): boolean {
  return status === 'quoted' || status === 'accepted' || status === 'produced';
}

/**
 * Live breakdown from current catalog (PRD §13.3).
 * Multiplies module part quantities by each ProjectItem.quantity.
 * Ignores any priceSnapshot on the project.
 */
function calcLiveProjectBreakdown(
  project: Project,
  catalog: Catalog,
): QuoteBreakdown {
  if (!(project.marginFactor > 0)) {
    throw new ValidationError(
      `marginFactor must be > 0 (got ${project.marginFactor})`,
      { projectId: project.id, field: 'marginFactor' },
    );
  }
  if (project.laborFixedCost < 0) {
    throw new ValidationError(
      `laborFixedCost must be >= 0 (got ${project.laborFixedCost})`,
      { projectId: project.id, field: 'laborFixedCost' },
    );
  }

  let materialsCost = 0;
  let edgeTotal = 0;
  let hardwareTotal = 0;
  let laborModular = 0;

  for (const item of project.items) {
    if (!(item.quantity > 0)) {
      throw new ValidationError(
        `Project item quantity must be > 0 (got ${item.quantity})`,
        {
          projectId: project.id,
          projectItemId: item.id,
          field: 'quantity',
        },
      );
    }

    const module = findModule(catalog, item.moduleId);
    if (!module) {
      throw new ResolutionError(
        `Module not found for project item: ${item.moduleId}`,
        {
          projectId: project.id,
          projectItemId: item.id,
          moduleId: item.moduleId,
          field: 'moduleId',
        },
      );
    }

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
    );

    for (const part of bom.boardParts) {
      const line = calcBoardLineCost(part, catalog, item.quantity);
      materialsCost += line.boardCost;
      edgeTotal += line.edgeCost;
    }

    for (const hw of bom.hardwareLines) {
      const line = calcHardwareLineCost(hw, catalog, item.quantity);
      hardwareTotal += line.hardwareCost;
    }

    laborModular += item.quantity * (module.baseLaborCost ?? 0);
  }

  const directCost = materialsCost + edgeTotal + hardwareTotal;
  const salePrice =
    directCost * project.marginFactor +
    laborModular +
    project.laborFixedCost;

  return {
    materialsCost,
    edgeTotal,
    hardwareTotal,
    directCost,
    laborModular,
    laborFixedCost: project.laborFixedCost,
    marginFactor: project.marginFactor,
    salePrice,
  };
}

/**
 * Collect unit prices for materials/edges/hardware used by the project's resolved BOM.
 */
function collectUsedUnitPrices(
  project: Project,
  catalog: Catalog,
): Pick<
  QuotePriceSnapshot,
  'materialCostPerM2' | 'edgeCostPerMl' | 'hardwareCostPerUnit'
> {
  const materialCostPerM2: Record<string, number> = {};
  const edgeCostPerMl: Record<string, number> = {};
  const hardwareCostPerUnit: Record<string, number> = {};

  for (const item of project.items) {
    const module = findModule(catalog, item.moduleId);
    if (!module) continue;

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
    );

    for (const part of bom.boardParts) {
      const material = findMaterial(catalog, part.materialId);
      if (material) {
        materialCostPerM2[material.id] = material.costPerM2;
      }
      if (part.edgeBandId) {
        const edge = findEdgeBand(catalog, part.edgeBandId);
        if (edge) {
          edgeCostPerMl[edge.id] = edge.costPerMl;
        }
      }
    }

    for (const hw of bom.hardwareLines) {
      const hardware = findHardware(catalog, hw.hardwareId);
      if (hardware) {
        hardwareCostPerUnit[hardware.id] = hardware.costPerUnit;
      }
    }
  }

  return {
    materialCostPerM2,
    edgeCostPerMl,
    hardwareCostPerUnit,
  };
}

/**
 * Capture live breakdown + unit prices used (for close / audit).
 * Always uses live catalog prices — never reads an existing snapshot.
 */
export function captureQuoteSnapshot(
  project: Project,
  catalog: Catalog,
  capturedAt: string = new Date().toISOString(),
): QuotePriceSnapshot {
  const breakdown = calcLiveProjectBreakdown(project, catalog);
  const unitPrices = collectUsedUnitPrices(project, catalog);
  return {
    capturedAt,
    breakdown,
    ...unitPrices,
  };
}

/**
 * Status transition helper (PRD §7.4):
 * - draft → quoted/accepted/produced: attach fresh priceSnapshot
 * - closed → draft: remove priceSnapshot (reopen)
 * - closed → closed (quoted ↔ accepted → produced): keep existing snapshot
 */
export function transitionProjectStatus(
  project: Project,
  newStatus: ProjectStatus,
  catalog: Catalog,
  capturedAt?: string,
): Project {
  const wasClosed = isProjectClosed(project.status);
  const willClose = isProjectClosed(newStatus);

  if (!wasClosed && willClose) {
    return {
      ...project,
      status: newStatus,
      priceSnapshot: captureQuoteSnapshot(project, catalog, capturedAt),
    };
  }

  if (wasClosed && !willClose) {
    const { priceSnapshot: _removed, ...rest } = project;
    return {
      ...rest,
      status: newStatus,
    };
  }

  if (wasClosed && willClose) {
    if (project.priceSnapshot) {
      return { ...project, status: newStatus };
    }
    return {
      ...project,
      status: newStatus,
      priceSnapshot: captureQuoteSnapshot(project, catalog, capturedAt),
    };
  }

  // draft → draft (or same status)
  if (project.priceSnapshot) {
    const { priceSnapshot: _stale, ...rest } = project;
    return { ...rest, status: newStatus };
  }
  return { ...project, status: newStatus };
}

/**
 * Full project quote breakdown (PRD §13.3 + §7.4).
 * Closed projects with a snapshot return the frozen breakdown.
 * Draft always recalculates from the current catalog.
 */
export function calcProjectBreakdown(
  project: Project,
  catalog: Catalog,
): QuoteBreakdown {
  if (isProjectClosed(project.status) && project.priceSnapshot) {
    return project.priceSnapshot.breakdown;
  }
  return calcLiveProjectBreakdown(project, catalog);
}

function edgeBinaryFlags(
  edges: readonly EdgeAssignment[],
): Pick<ProductionCutRow, 'L1' | 'L2' | 'W1' | 'W2'> {
  const flags = edgeFlags(edges);
  const bit = (n: number): 0 | 1 => (n ? 1 : 0);
  return {
    L1: bit(flags.L1),
    L2: bit(flags.L2),
    W1: bit(flags.W1),
    W2: bit(flags.W2),
  };
}

interface SortableCutRow {
  readonly moduleCode: string;
  readonly partCode: string;
  readonly partId: string;
  readonly description: string;
  readonly row: ProductionCutRow;
}

/**
 * Optimizer column D text with stable codes (F048 / #98).
 * `{partCode} · {partName} · {moduleCode}` or `{partName} · {moduleCode}`.
 */
export function formatOptimizerPartDescription(
  moduleCode: string,
  partName: string,
  partCode?: string,
): string {
  const name = partName.trim();
  const mod = moduleCode.trim();
  const code = partCode?.trim();
  if (code) {
    return `${code} · ${name} · ${mod}`;
  }
  return `${name} · ${mod}`;
}

/**
 * Expand project board parts into Optimizer cut-list rows (PRD §14).
 * Board parts only (EXP-05). Quantity = part.quantity × item.quantity (EXP-02).
 * Sorted by module code, then part code (EXP-04). Never includes hardware.
 * Description includes part/module codes for workshop ID (F048) without new columns.
 */
export function generateCutRows(
  project: Project,
  catalog: Catalog,
): ProductionCutRow[] {
  const sortable: SortableCutRow[] = [];

  for (const item of project.items) {
    if (!(item.quantity > 0)) {
      throw new ValidationError(
        `Project item quantity must be > 0 (got ${item.quantity})`,
        {
          projectId: project.id,
          projectItemId: item.id,
          field: 'quantity',
        },
      );
    }

    const module = findModule(catalog, item.moduleId);
    if (!module) {
      throw new ResolutionError(
        `Module not found for project item: ${item.moduleId}`,
        {
          projectId: project.id,
          projectItemId: item.id,
          moduleId: item.moduleId,
          field: 'moduleId',
        },
      );
    }

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
    );

    for (const part of bom.boardParts) {
      const material = findMaterial(catalog, part.materialId);
      if (!material) {
        throw new ResolutionError(
          `Material not found: ${part.materialId}`,
          {
            projectId: project.id,
            partId: part.id,
            materialId: part.materialId,
            field: 'materialId',
          },
        );
      }

      const edgeBits = edgeBinaryFlags(part.edges);
      const partCode = part.code;
      const labelRef = partCode?.trim() || `${module.code}/${part.id}`;
      const description = formatOptimizerPartDescription(
        module.code,
        part.description,
        partCode,
      );
      sortable.push({
        moduleCode: module.code,
        partCode: partCode ?? '',
        partId: part.id,
        description: part.description,
        row: {
          quantity: part.quantity * item.quantity,
          lengthMm: part.lengthMm,
          widthMm: part.widthMm,
          description,
          materialName: material.name,
          grain: part.grain,
          ...edgeBits,
          partName: part.description,
          partCode,
          moduleCode: module.code,
          labelRef,
        },
      });
    }
  }

  // VAL-05
  if (sortable.length === 0) {
    throw new ValidationError('no hay piezas de tablero para exportar', {
      projectId: project.id,
      field: 'boardParts',
    });
  }

  sortable.sort((a, b) => {
    const byModule = a.moduleCode.localeCompare(b.moduleCode);
    if (byModule !== 0) return byModule;
    const byPartCode = a.partCode.localeCompare(b.partCode);
    if (byPartCode !== 0) return byPartCode;
    const byDescription = a.description.localeCompare(b.description);
    if (byDescription !== 0) return byDescription;
    return a.partId.localeCompare(b.partId);
  });

  return sortable.map((entry) => entry.row);
}

const EDGE_SIDE_ORDER = ['L1', 'L2', 'W1', 'W2'] as const;

/**
 * Human-readable edge-banding instruction for workshop labels (F046 / #96).
 * Uses Optimizer side codes L1/L2/W1/W2.
 */
export function formatEdgeBandingInstruction(
  sides: Readonly<{
    L1: boolean;
    L2: boolean;
    W1: boolean;
    W2: boolean;
  }>,
  edge?: Readonly<{
    code: string;
    name: string;
    thicknessMm: number;
  }> | null,
): string {
  const enabled = EDGE_SIDE_ORDER.filter((s) => sides[s]);
  if (enabled.length === 0) {
    return 'Sin encintar';
  }

  let sidesText: string;
  if (enabled.length === 1) {
    sidesText = enabled[0]!;
  } else if (enabled.length === 2) {
    sidesText = `${enabled[0]} y ${enabled[1]}`;
  } else {
    sidesText = `${enabled.slice(0, -1).join(', ')} y ${enabled[enabled.length - 1]}`;
  }

  if (edge) {
    return `Encintar ${sidesText} con ${edge.name} ${edge.thicknessMm} mm (${edge.code})`;
  }
  return `Encintar ${sidesText} (definir canto)`;
}

interface SortablePieceLabel {
  readonly moduleCode: string;
  readonly partCode: string;
  readonly partId: string;
  readonly description: string;
  readonly label: PieceLabel;
}

/**
 * Build printable piece labels from resolved board parts (F046 / #96).
 * Never includes hardware. Quantity = part.quantity × item.quantity.
 * Sorted like cut rows (module code, part code, description).
 */
export function generatePieceLabels(
  project: Project,
  catalog: Catalog,
): PieceLabel[] {
  const sortable: SortablePieceLabel[] = [];

  for (const item of project.items) {
    if (!(item.quantity > 0)) {
      throw new ValidationError(
        `Project item quantity must be > 0 (got ${item.quantity})`,
        {
          projectId: project.id,
          projectItemId: item.id,
          field: 'quantity',
        },
      );
    }

    const module = findModule(catalog, item.moduleId);
    if (!module) {
      throw new ResolutionError(
        `Module not found for project item: ${item.moduleId}`,
        {
          projectId: project.id,
          projectItemId: item.id,
          moduleId: item.moduleId,
          field: 'moduleId',
        },
      );
    }

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
    );

    for (const part of bom.boardParts) {
      const material = findMaterial(catalog, part.materialId);
      if (!material) {
        throw new ResolutionError(
          `Material not found: ${part.materialId}`,
          {
            projectId: project.id,
            partId: part.id,
            materialId: part.materialId,
            field: 'materialId',
          },
        );
      }

      const flags = edgeBinaryFlags(part.edges);
      const sides = {
        L1: flags.L1 === 1,
        L2: flags.L2 === 1,
        W1: flags.W1 === 1,
        W2: flags.W2 === 1,
      };

      let edgeBandCode: string | undefined;
      let edgeBandName: string | undefined;
      let edgeForInstruction: {
        code: string;
        name: string;
        thicknessMm: number;
      } | null = null;

      if (part.edgeBandId) {
        const edge = findEdgeBand(catalog, part.edgeBandId);
        if (!edge) {
          throw new ResolutionError(
            `Edge band not found: ${part.edgeBandId}`,
            {
              projectId: project.id,
              partId: part.id,
              edgeBandId: part.edgeBandId,
              field: 'edgeBandId',
            },
          );
        }
        edgeBandCode = edge.code;
        edgeBandName = edge.name;
        edgeForInstruction = {
          code: edge.code,
          name: edge.name,
          thicknessMm: edge.thicknessMm,
        };
      }

      sortable.push({
        moduleCode: module.code,
        partCode: part.code ?? '',
        partId: part.id,
        description: part.description,
        label: {
          moduleCode: module.code,
          moduleName: module.name,
          partCode: part.code,
          description: part.description,
          quantity: part.quantity * item.quantity,
          lengthMm: part.lengthMm,
          widthMm: part.widthMm,
          materialCode: material.code,
          materialName: material.name,
          edgeBandCode,
          edgeBandName,
          L1: sides.L1,
          L2: sides.L2,
          W1: sides.W1,
          W2: sides.W2,
          edgeBandingInstruction: formatEdgeBandingInstruction(
            sides,
            edgeForInstruction,
          ),
        },
      });
    }
  }

  if (sortable.length === 0) {
    throw new ValidationError('no hay piezas de tablero para etiquetar', {
      projectId: project.id,
      field: 'boardParts',
    });
  }

  sortable.sort((a, b) => {
    const byModule = a.moduleCode.localeCompare(b.moduleCode);
    if (byModule !== 0) return byModule;
    const byPartCode = a.partCode.localeCompare(b.partCode);
    if (byPartCode !== 0) return byPartCode;
    const byDescription = a.description.localeCompare(b.description);
    if (byDescription !== 0) return byDescription;
    return a.partId.localeCompare(b.partId);
  });

  return sortable.map((entry) => entry.label);
}

/**
 * Consolidated m² / edge ML / hardware totals for planning (F047 / #97).
 * Board metrics use the same resolveBom + calcBoardLineCost path as quotes.
 * Hardware reuses generateHardwareList (EXP-08).
 */
export function generateProjectMaterialSummary(
  project: Project,
  catalog: Catalog,
): ProjectMaterialSummary {
  const materialMap = new Map<
    string,
    {
      material: MaterialBoard;
      areaM2: number;
      edgeMl: number;
      boardCost: number;
    }
  >();
  const edgeMap = new Map<
    string,
    {
      code: string;
      name: string;
      edgeMl: number;
      edgeCost: number;
    }
  >();

  for (const item of project.items) {
    if (!(item.quantity > 0)) {
      throw new ValidationError(
        `Project item quantity must be > 0 (got ${item.quantity})`,
        {
          projectId: project.id,
          projectItemId: item.id,
          field: 'quantity',
        },
      );
    }

    const module = findModule(catalog, item.moduleId);
    if (!module) {
      throw new ResolutionError(
        `Module not found for project item: ${item.moduleId}`,
        {
          projectId: project.id,
          projectItemId: item.id,
          moduleId: item.moduleId,
          field: 'moduleId',
        },
      );
    }

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
    );

    for (const part of bom.boardParts) {
      const line = calcBoardLineCost(part, catalog, item.quantity);
      const material = findMaterial(catalog, part.materialId);
      if (!material) {
        throw new ResolutionError(
          `Material not found: ${part.materialId}`,
          {
            projectId: project.id,
            partId: part.id,
            materialId: part.materialId,
            field: 'materialId',
          },
        );
      }

      const prev = materialMap.get(material.id);
      if (prev) {
        prev.areaM2 += line.areaM2;
        prev.edgeMl += line.edgeMl;
        prev.boardCost += line.boardCost;
      } else {
        materialMap.set(material.id, {
          material,
          areaM2: line.areaM2,
          edgeMl: line.edgeMl,
          boardCost: line.boardCost,
        });
      }

      if (part.edgeBandId && line.edgeMl > 0) {
        const edge = findEdgeBand(catalog, part.edgeBandId);
        if (!edge) {
          throw new ResolutionError(
            `Edge band not found: ${part.edgeBandId}`,
            {
              projectId: project.id,
              partId: part.id,
              edgeBandId: part.edgeBandId,
              field: 'edgeBandId',
            },
          );
        }
        const ePrev = edgeMap.get(edge.id);
        if (ePrev) {
          ePrev.edgeMl += line.edgeMl;
          ePrev.edgeCost += line.edgeCost;
        } else {
          edgeMap.set(edge.id, {
            code: edge.code,
            name: edge.name,
            edgeMl: line.edgeMl,
            edgeCost: line.edgeCost,
          });
        }
      }
    }
  }

  const materials: MaterialUsageRow[] = [...materialMap.entries()]
    .map(([materialId, row]) => ({
      materialId,
      code: row.material.code,
      name: row.material.name,
      areaM2: row.areaM2,
      edgeMl: row.edgeMl,
      boardCost: row.boardCost,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const edges: EdgeUsageRow[] = [...edgeMap.entries()]
    .map(([edgeBandId, row]) => ({
      edgeBandId,
      code: row.code,
      name: row.name,
      edgeMl: row.edgeMl,
      edgeCost: row.edgeCost,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  let hardware: HardwarePurchaseRow[] = [];
  try {
    hardware = generateHardwareList(project, catalog);
  } catch (err) {
    // No hardware lines is ok for a board-only project
    if (
      err instanceof ValidationError &&
      typeof err.message === 'string' &&
      err.message.includes('no hay herrajes')
    ) {
      hardware = [];
    } else {
      throw err;
    }
  }

  const totalAreaM2 = materials.reduce((s, m) => s + m.areaM2, 0);
  const totalEdgeMl = edges.reduce((s, e) => s + e.edgeMl, 0);
  const totalBoardCost = materials.reduce((s, m) => s + m.boardCost, 0);
  const totalEdgeCost = edges.reduce((s, e) => s + e.edgeCost, 0);
  const totalHardwareCost = hardware.reduce((s, h) => s + h.lineCost, 0);

  return {
    materials,
    edges,
    hardware,
    totalAreaM2,
    totalEdgeMl,
    totalBoardCost,
    totalEdgeCost,
    totalHardwareCost,
  };
}

/**
 * Aggregate project hardware into a purchase list (PRD EXP-08).
 * Quantity = hardwareLine.quantity × item.quantity, summed by hardwareId.
 * Board parts are never included. Sorted by code, then description.
 */
export function generateHardwareList(
  project: Project,
  catalog: Catalog,
): HardwarePurchaseRow[] {
  const totals = new Map<
    string,
    { quantity: number; hardware: Hardware }
  >();

  for (const item of project.items) {
    if (!(item.quantity > 0)) {
      throw new ValidationError(
        `Project item quantity must be > 0 (got ${item.quantity})`,
        {
          projectId: project.id,
          projectItemId: item.id,
          field: 'quantity',
        },
      );
    }

    const module = findModule(catalog, item.moduleId);
    if (!module) {
      throw new ResolutionError(
        `Module not found for project item: ${item.moduleId}`,
        {
          projectId: project.id,
          projectItemId: item.id,
          moduleId: item.moduleId,
          field: 'moduleId',
        },
      );
    }

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
    );

    for (const line of bom.hardwareLines) {
      const hardware = findHardware(catalog, line.hardwareId);
      if (!hardware) {
        throw new ResolutionError(
          `Hardware not found: ${line.hardwareId}`,
          {
            projectId: project.id,
            hardwareLineId: line.id,
            hardwareId: line.hardwareId,
            field: 'hardwareId',
          },
        );
      }
      if (!hardware.active) {
        throw new ValidationError(
          `Inactive hardware cannot be used: ${hardware.code}`,
          {
            projectId: project.id,
            hardwareLineId: line.id,
            hardwareId: hardware.id,
            field: 'active',
          },
        );
      }

      const qty = line.quantity * item.quantity;
      const existing = totals.get(hardware.id);
      if (existing) {
        existing.quantity += qty;
      } else {
        totals.set(hardware.id, { quantity: qty, hardware });
      }
    }
  }

  if (totals.size === 0) {
    throw new ValidationError('no hay herrajes para exportar', {
      projectId: project.id,
      field: 'hardwareLines',
    });
  }

  const rows: HardwarePurchaseRow[] = [...totals.values()].map(
    ({ quantity, hardware }) => ({
      hardwareId: hardware.id,
      code: hardware.code,
      description: hardware.name,
      unit: hardware.unit,
      quantity,
      costPerUnit: hardware.costPerUnit,
      lineCost: quantity * hardware.costPerUnit,
    }),
  );

  rows.sort((a, b) => {
    const byCode = a.code.localeCompare(b.code);
    if (byCode !== 0) return byCode;
    return a.description.localeCompare(b.description);
  });

  return rows;
}

/**
 * Safely evaluates simple math formulas involving W, H, D, T, PW, PH, PD variables and numbers.
 */
export function evaluatePartFormula(
  formula: string,
  dims: { W: number; H: number; D: number; PW?: number; PH?: number; PD?: number; T?: number; i?: number },
  contextInfo?: { structureCode: string; partDescription: string; field: 'length' | 'width' | 'x' | 'y' | 'z' }
): number {
  const trimmed = formula.trim();
  if (!trimmed) {
    throw new ValidationError('La fórmula no puede estar vacía', {
      ...contextInfo,
      field: contextInfo?.field,
    });
  }

  // Validate allowed characters: numbers, W, H, D, P, T, L, i, +, -, *, /, (, ), and whitespace.
  const clean = trimmed.replace(/\s+/g, '');
  if (!/^[0-9WHDTPLi+\-*/()]+$/.test(clean)) {
    throw new ValidationError(`La fórmula "${formula}" contiene caracteres no válidos. Solo se permiten números, W, H, D, P, T, L, i y operadores (+, -, *, /, paréntesis).`, {
      ...contextInfo,
      field: contextInfo?.field,
    });
  }

  // Determine parent vs component variables
  const pw = dims.PW !== undefined ? dims.PW : dims.W;
  const ph = dims.PH !== undefined ? dims.PH : dims.H;
  const pd = dims.PD !== undefined ? dims.PD : dims.D;
  const t = dims.T !== undefined ? dims.T : 0;

  // Substitute variables
  const expr = clean
    .replace(/PW/g, String(pw))
    .replace(/PH/g, String(ph))
    .replace(/PD/g, String(pd))
    .replace(/W/g, String(dims.W))
    .replace(/H/g, String(dims.H))
    .replace(/D/g, String(dims.D))
    .replace(/L/g, String(dims.D))
    .replace(/T/g, String(t))
    .replace(/i/g, String(dims.i ?? 0));

  try {
    // Safe evaluation using Function context
    const result = new Function(`return (${expr})`)();
    if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
      throw new Error('No es un número válido');
    }
    return Math.round(result);
  } catch (err) {
    throw new ValidationError(`La fórmula "${formula}" no se pudo evaluar correctamente.`, {
      ...contextInfo,
      field: contextInfo?.field,
    });
  }
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

