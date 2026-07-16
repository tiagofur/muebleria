/**
 * Map between FE domain (camelCase) and Go API JSON (mixed snake_case).
 * Go handlers decode by json tags on domain structs — wrong shape → zeros → PG 500.
 */

import type {
  BoardPart,
  Catalog,
  Customer,
  EdgeBand,
  EdgeAssignment,
  Hardware,
  HardwareLine,
  MaterialBoard,
  Module,
  ModuleCategory,
  OptionGroup,
  Project,
  ProjectItem,
  ProjectStatus,
  QuoteBreakdown,
} from '@muebles/domain';

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

// --- Materials ---

export function materialToApi(m: MaterialBoard): Record<string, unknown> {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    width_mm: m.widthMm,
    length_mm: m.lengthMm,
    thickness_mm: m.thicknessMm,
    grain_default: m.grainDefault,
    board_price: m.boardPrice,
    waste_percent: m.wastePercent,
    cost_per_m2: m.costPerM2,
    default_edge_band_id: m.defaultEdgeBandId ?? '',
    notes: m.notes ?? '',
    active: m.active,
  };
}

export function materialFromApi(raw: Record<string, unknown>): MaterialBoard {
  const defaultEdge =
    str(raw.default_edge_band_id ?? raw.defaultEdgeBandId) || undefined;
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    widthMm: num(raw.width_mm ?? raw.widthMm),
    lengthMm: num(raw.length_mm ?? raw.lengthMm),
    thicknessMm: num(raw.thickness_mm ?? raw.thicknessMm),
    grainDefault: bool(raw.grain_default ?? raw.grainDefault),
    boardPrice: num(raw.board_price ?? raw.boardPrice),
    wastePercent: num(raw.waste_percent ?? raw.wastePercent),
    costPerM2: num(raw.cost_per_m2 ?? raw.costPerM2),
    defaultEdgeBandId: defaultEdge,
    notes: str(raw.notes) || undefined,
    active: bool(raw.active, true),
  };
}

// --- Edges ---

export function edgeToApi(e: EdgeBand): Record<string, unknown> {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    thickness_mm: e.thicknessMm,
    cost_per_ml: e.costPerMl,
    notes: e.notes ?? '',
    active: e.active,
  };
}

export function edgeFromApi(raw: Record<string, unknown>): EdgeBand {
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    thicknessMm: num(raw.thickness_mm ?? raw.thicknessMm),
    costPerMl: num(raw.cost_per_ml ?? raw.costPerMl),
    notes: str(raw.notes) || undefined,
    active: bool(raw.active, true),
  };
}

// --- Hardware ---

export function hardwareToApi(h: Hardware): Record<string, unknown> {
  return {
    id: h.id,
    code: h.code,
    name: h.name,
    unit: h.unit,
    cost_per_unit: h.costPerUnit,
    notes: h.notes ?? '',
    active: h.active,
  };
}

export function hardwareFromApi(raw: Record<string, unknown>): Hardware {
  const unit = str(raw.unit, 'piece');
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    unit: (unit === 'set' || unit === 'meter' ? unit : 'piece') as Hardware['unit'],
    costPerUnit: num(raw.cost_per_unit ?? raw.costPerUnit),
    notes: str(raw.notes) || undefined,
    active: bool(raw.active, true),
  };
}

// --- Option groups ---

export function optionGroupToApi(g: OptionGroup): Record<string, unknown> {
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    kind: g.kind,
    required: g.required,
    option_ids: [...g.optionIds],
  };
}

export function optionGroupFromApi(raw: Record<string, unknown>): OptionGroup {
  const ids = raw.option_ids ?? raw.optionIds;
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    kind: (str(raw.kind, 'board') as OptionGroup['kind']),
    required: bool(raw.required, true),
    optionIds: Array.isArray(ids) ? ids.map(String) : [],
  };
}

// --- Categories (already mostly camelCase on Go) ---

export function categoryToApi(c: ModuleCategory): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    parentId: c.parentId ?? '',
    sortOrder: c.sortOrder,
  };
}

export function categoryFromApi(raw: Record<string, unknown>): ModuleCategory {
  const parent = str(raw.parentId ?? raw.parent_id);
  return {
    id: str(raw.id),
    name: str(raw.name),
    parentId: parent || undefined,
    sortOrder: num(raw.sortOrder ?? raw.sort_order),
  };
}

// --- Modules ---

function boardPartToApi(p: BoardPart): Record<string, unknown> {
  return {
    id: p.id,
    code: p.code ?? p.id.slice(0, 8),
    description: p.description,
    quantity: p.quantity,
    length_mm: p.lengthMm,
    width_mm: p.widthMm,
    edges: p.edges.map((e: EdgeAssignment) => ({
      side: e.side,
      enabled: e.enabled,
    })),
    option_role: p.optionRole,
  };
}

function boardPartFromApi(raw: Record<string, unknown>): BoardPart {
  const edgesRaw = Array.isArray(raw.edges) ? raw.edges : [];
  return {
    id: str(raw.id),
    code: str(raw.code) || undefined,
    description: str(raw.description),
    quantity: num(raw.quantity, 1),
    lengthMm: num(raw.length_mm ?? raw.lengthMm),
    widthMm: num(raw.width_mm ?? raw.widthMm),
    edges: edgesRaw.map((e: Record<string, unknown>) => ({
      side: str(e.side, 'L1') as EdgeAssignment['side'],
      enabled: bool(e.enabled),
    })),
    optionRole: str(raw.option_role ?? raw.optionRole),
  };
}

function hardwareLineToApi(l: HardwareLine): Record<string, unknown> {
  return {
    id: l.id,
    quantity: l.quantity,
    description_override: l.descriptionOverride ?? '',
    option_role: l.optionRole,
    hardware_id: l.hardwareId ?? '',
  };
}

function hardwareLineFromApi(raw: Record<string, unknown>): HardwareLine {
  const hw = str(raw.hardware_id ?? raw.hardwareId);
  const desc = str(raw.description_override ?? raw.descriptionOverride);
  return {
    id: str(raw.id),
    quantity: num(raw.quantity, 1),
    descriptionOverride: desc || undefined,
    optionRole: str(raw.option_role ?? raw.optionRole),
    hardwareId: hw || undefined,
  };
}

export function moduleToApi(m: Module): Record<string, unknown> {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    base_labor_cost: m.baseLaborCost ?? 0,
    width_mm: m.externalDims?.width ?? 0,
    height_mm: m.externalDims?.height ?? 0,
    depth_mm: m.externalDims?.depth ?? 0,
    categoryId: m.categoryId ?? '',
    notes: m.notes ?? '',
    board_parts: m.boardParts.map(boardPartToApi),
    hardware_lines: m.hardwareLines.map(hardwareLineToApi),
  };
}

export function moduleFromApi(raw: Record<string, unknown>): Module {
  const parts = raw.board_parts ?? raw.boardParts;
  const lines = raw.hardware_lines ?? raw.hardwareLines;
  const w = num(raw.width_mm ?? raw.widthMm);
  const h = num(raw.height_mm ?? raw.heightMm);
  const d = num(raw.depth_mm ?? raw.depthMm);
  const hasDims = w > 0 || h > 0 || d > 0;
  const categoryId = str(raw.categoryId ?? raw.category_id);
  const labor = num(raw.base_labor_cost ?? raw.baseLaborCost);
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    categoryId: categoryId || undefined,
    baseLaborCost: labor > 0 ? labor : undefined,
    notes: str(raw.notes) || undefined,
    externalDims: hasDims ? { width: w, height: h, depth: d } : undefined,
    boardParts: Array.isArray(parts)
      ? parts.map((p) => boardPartFromApi(p as Record<string, unknown>))
      : [],
    hardwareLines: Array.isArray(lines)
      ? lines.map((l) => hardwareLineFromApi(l as Record<string, unknown>))
      : [],
  };
}

// --- Customers ---

export function customerToApi(c: Customer): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    email: c.email ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    notes: c.notes ?? '',
    active: c.active,
    owner_user_id: c.ownerUserId ?? '',
  };
}

export function customerFromApi(raw: Record<string, unknown>): Customer {
  const owner = str(raw.owner_user_id ?? raw.ownerUserId);
  return {
    id: str(raw.id),
    name: str(raw.name),
    email: str(raw.email) || undefined,
    phone: str(raw.phone) || undefined,
    address: str(raw.address) || undefined,
    notes: str(raw.notes) || undefined,
    active: bool(raw.active, true),
    ownerUserId: owner || undefined,
  };
}

// --- Projects ---

export function projectToApi(p: Project): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    customer_id: p.customerId,
    created_by: p.createdBy ?? '',
    owner_user_id: p.ownerUserId ?? '',
    currency: p.currency,
    margin_factor: p.marginFactor,
    labor_fixed_cost: p.laborFixedCost,
    status: p.status,
    notes: p.notes ?? '',
    project_level_choices: { ...(p.projectLevelChoices ?? {}) },
    items: p.items.map((item) => ({
      id: item.id,
      module_id: item.moduleId,
      quantity: item.quantity,
      option_choices: { ...item.optionChoices },
    })),
  };
}

export function projectFromApi(raw: Record<string, unknown>): Project {
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const status = str(raw.status, 'draft') as ProjectStatus;
  const levelRaw =
    raw.project_level_choices ?? raw.projectLevelChoices;
  const projectLevelChoices =
    levelRaw && typeof levelRaw === 'object' && !Array.isArray(levelRaw)
      ? (levelRaw as Project['projectLevelChoices'])
      : undefined;
  const ownerUserId =
    str(raw.owner_user_id ?? raw.ownerUserId) || undefined;
  return {
    id: str(raw.id),
    name: str(raw.name),
    customerId: str(raw.customer_id ?? raw.customerId),
    createdBy: str(raw.created_by ?? raw.createdBy) || undefined,
    ownerUserId,
    currency: str(raw.currency, 'MXN'),
    marginFactor: num(raw.margin_factor ?? raw.marginFactor, 1.35),
    laborFixedCost: num(raw.labor_fixed_cost ?? raw.laborFixedCost),
    status: (['draft', 'quoted', 'accepted'].includes(status)
      ? status
      : 'draft') as ProjectStatus,
    notes: str(raw.notes) || undefined,
    projectLevelChoices:
      projectLevelChoices && Object.keys(projectLevelChoices).length > 0
        ? projectLevelChoices
        : undefined,
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
    updatedAt: str(raw.updated_at ?? raw.updatedAt, new Date().toISOString()),
    items: itemsRaw.map((it): ProjectItem => {
      const row = it as Record<string, unknown>;
      const choices = row.option_choices ?? row.optionChoices;
      return {
        id: str(row.id),
        moduleId: str(row.module_id ?? row.moduleId),
        quantity: num(row.quantity, 1),
        optionChoices:
          choices && typeof choices === 'object' && !Array.isArray(choices)
            ? (choices as ProjectItem['optionChoices'])
            : {},
      };
    }),
  };
}

// --- Quote breakdown (calculate endpoint) ---

/**
 * Map the Go backend's /projects/{id}/calculate response to the domain
 * QuoteBreakdown. The backend emits snake_case (`materials_cost`...); the FE
 * domain expects camelCase (`materialsCost`...). Both shapes are accepted so a
 * future backend switch to camelCase won't break this.
 */
export function breakdownFromApi(raw: Record<string, unknown>): QuoteBreakdown {
  return {
    materialsCost: num(raw.materials_cost ?? raw.materialsCost),
    edgeTotal: num(raw.edge_total ?? raw.edgeTotal),
    hardwareTotal: num(raw.hardware_total ?? raw.hardwareTotal),
    directCost: num(raw.direct_cost ?? raw.directCost),
    laborModular: num(raw.labor_modular ?? raw.laborModular),
    laborFixedCost: num(raw.labor_fixed_cost ?? raw.laborFixedCost),
    marginFactor: num(raw.margin_factor ?? raw.marginFactor, 1),
    salePrice: num(raw.sale_price ?? raw.salePrice),
  };
}

export function catalogFromApi(parts: {
  materials: unknown;
  edges: unknown;
  hardware: unknown;
  optionGroups: unknown;
  modules: unknown;
  categories: unknown;
  customers: unknown;
}): Catalog {
  const asRows = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

  return {
    materials: asRows(parts.materials).map(materialFromApi),
    edges: asRows(parts.edges).map(edgeFromApi),
    hardware: asRows(parts.hardware).map(hardwareFromApi),
    optionGroups: asRows(parts.optionGroups).map(optionGroupFromApi),
    modules: asRows(parts.modules).map(moduleFromApi),
    categories: asRows(parts.categories).map(categoryFromApi),
    customers: asRows(parts.customers).map(customerFromApi),
  };
}

/** Parents before children so POST of new trees satisfies FK/placement. */
export function sortCategoriesForSave(
  categories: readonly ModuleCategory[],
): ModuleCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const c = byId.get(id);
    if (!c?.parentId) return 0;
    return 1 + depth(c.parentId, seen);
  };
  return [...categories].sort((a, b) => depth(a.id) - depth(b.id));
}
