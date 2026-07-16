/**
 * Domain calculation engine: BOM resolution, line costs, project quote breakdown.
 */

import { ResolutionError, ValidationError } from './errors';
import type {
  BoardPart,
  Catalog,
  EdgeAssignment,
  EdgeBand,
  Grain,
  Hardware,
  HardwareLine,
  HardwarePurchaseRow,
  MaterialBoard,
  Module,
  OptionChoices,
  OptionGroup,
  ProductionCutRow,
  Project,
  ProjectStatus,
  QuoteBreakdown,
  QuotePriceSnapshot,
  ResolvedBoardPart,
  ResolvedBom,
  ResolvedHardwareLine,
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

/** VAL-07 catalog/module empty names/codes. */
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

  for (const part of module.boardParts) {
    validateBoardPart(part, module.code);
    if (!part.description?.trim()) {
      throw new ValidationError('Board part description must not be empty', {
        moduleCode: module.code,
        partId: part.id,
        field: 'description',
      });
    }
    if (!part.optionRole?.trim()) {
      throw new ValidationError('Board part optionRole must not be empty', {
        moduleCode: module.code,
        partId: part.id,
        field: 'optionRole',
      });
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
}

/**
 * Resolve module template + option choices into concrete material/hardware IDs.
 * VAL-05 (empty cut list on export) is deferred to F004 / export path.
 */
export function resolveBom(
  module: Module,
  optionChoices: OptionChoices,
  catalog: Catalog,
): ResolvedBom {
  validateModule(module);

  const boardParts: ResolvedBoardPart[] = module.boardParts.map((part) => {
    const material = requireMaterialChoice(
      part,
      optionChoices,
      catalog,
      module.code,
    );
    const edgeBandId = resolveEdgeBandId(
      part,
      material,
      optionChoices,
      catalog,
      module.code,
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
    };
  });

  const hardwareLines: ResolvedHardwareLine[] = module.hardwareLines.map(
    (line) => {
      const hardwareId = requireHardwareId(
        line,
        optionChoices,
        catalog,
        module.code,
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

  return { boardParts, hardwareLines };
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
  return status === 'quoted' || status === 'accepted';
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

    const bom = resolveBom(module, item.optionChoices, catalog);

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

    const bom = resolveBom(module, item.optionChoices, catalog);

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
 * - draft → quoted/accepted: attach fresh priceSnapshot
 * - quoted/accepted → draft: remove priceSnapshot (reopen)
 * - quoted ↔ accepted: keep existing snapshot (re-freeze only if missing)
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
 * Expand project board parts into Optimizer cut-list rows (PRD §14).
 * Board parts only (EXP-05). Quantity = part.quantity × item.quantity (EXP-02).
 * Sorted by module code, then part code (EXP-04). Never includes hardware.
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

    const bom = resolveBom(module, item.optionChoices, catalog);

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
      sortable.push({
        moduleCode: module.code,
        partCode: part.code ?? '',
        partId: part.id,
        description: part.description,
        row: {
          quantity: part.quantity * item.quantity,
          lengthMm: part.lengthMm,
          widthMm: part.widthMm,
          description: part.description,
          materialName: material.name,
          grain: part.grain,
          ...edgeBits,
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

    const bom = resolveBom(module, item.optionChoices, catalog);

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
