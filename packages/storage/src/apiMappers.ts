/**
 * Map between FE domain (camelCase) and Go API JSON (mixed snake_case).
 * Go handlers decode by json tags on domain structs — wrong shape → zeros → PG 500.
 */

import type {
  BoardPart,
  Catalog,
  Component,
  ComponentPlacement,
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
  WorkshopSettings,
} from '@muebles/domain';
import { resolveWorkshopSettings } from '@muebles/domain';

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
    image_url: m.imageUrl ?? '',
    waste_percent: m.wastePercent,
    cost_per_m2: m.costPerM2,
    default_edge_band_id: m.defaultEdgeBandId ?? '',
    preview_color: m.previewColor ?? '',
    preview_texture_url: m.previewTextureUrl ?? '',
    notes: m.notes ?? '',
    active: m.active,
  };
}

export function materialFromApi(raw: Record<string, unknown>): MaterialBoard {
  const defaultEdge =
    str(raw.default_edge_band_id ?? raw.defaultEdgeBandId) || undefined;
  const previewColor =
    str(raw.preview_color ?? raw.previewColor) || undefined;
  const previewTextureUrl =
    str(raw.preview_texture_url ?? raw.previewTextureUrl) || undefined;
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    widthMm: num(raw.width_mm ?? raw.widthMm),
    lengthMm: num(raw.length_mm ?? raw.lengthMm),
    thicknessMm: num(raw.thickness_mm ?? raw.thicknessMm),
    grainDefault: bool(raw.grain_default ?? raw.grainDefault),
    boardPrice: num(raw.board_price ?? raw.boardPrice),
    imageUrl: str(raw.image_url ?? raw.imageUrl) || undefined,
    wastePercent: num(raw.waste_percent ?? raw.wastePercent),
    costPerM2: num(raw.cost_per_m2 ?? raw.costPerM2),
    defaultEdgeBandId: defaultEdge,
    previewColor,
    previewTextureUrl,
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
    image_url: h.imageUrl ?? '',
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
    imageUrl: str(raw.image_url ?? raw.imageUrl) || undefined,
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
    structure_id: m.structureId ?? '',
    components: (m.components ?? []).map(componentInstanceToApi),
    presets: (m.presets ?? []).map(presetToApi),
    image_url: m.imageUrl ?? '',
    notes: m.notes ?? '',
    hardware_lines: m.hardwareLines.map(hardwareLineToApi),
  };
}

export function moduleFromApi(raw: Record<string, unknown>): Module {
  const lines = raw.hardware_lines ?? raw.hardwareLines;
  const w = num(raw.width_mm ?? raw.widthMm);
  const h = num(raw.height_mm ?? raw.heightMm);
  const d = num(raw.depth_mm ?? raw.depthMm);
  const hasDims = w > 0 || h > 0 || d > 0;
  const categoryId = str(raw.categoryId ?? raw.category_id);
  const structureId = str(raw.structure_id ?? raw.structureId);
  const labor = num(raw.base_labor_cost ?? raw.baseLaborCost);
  const imageUrl = str(raw.image_url ?? raw.imageUrl) || undefined;
  const componentsRaw = raw.components;
  const presetsRaw = raw.presets;
  const presets = Array.isArray(presetsRaw)
    ? (presetsRaw as Record<string, unknown>[]).map(presetFromApi)
    : undefined;
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    categoryId: categoryId || undefined,
    structureId: structureId || undefined,
    components: Array.isArray(componentsRaw)
      ? (componentsRaw as Record<string, unknown>[]).map(componentInstanceFromApi)
      : undefined,
    presets: presets && presets.length > 0 ? presets : undefined,
    baseLaborCost: labor > 0 ? labor : undefined,
    imageUrl,
    notes: str(raw.notes) || undefined,
    externalDims: hasDims ? { width: w, height: h, depth: d } : undefined,
    hardwareLines: Array.isArray(lines)
      ? lines.map((l) => hardwareLineFromApi(l as Record<string, unknown>))
      : [],
  };
}

// --- Structures (F049 / #99) ---

function optionalRotate(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function componentInstanceToApi(
  c: import('@muebles/domain').ModuleComponentInstance,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  if (c.overrides?.edges) {
    overrides.edges = c.overrides.edges;
  }
  if (c.overrides?.notes) {
    overrides.notes = c.overrides.notes;
  }
  if (c.overrides?.lengthFormula) {
    overrides.lengthFormula = c.overrides.lengthFormula;
  }
  if (c.overrides?.widthFormula) {
    overrides.widthFormula = c.overrides.widthFormula;
  }
  if (c.overrides?.xFormula) overrides.xFormula = c.overrides.xFormula;
  if (c.overrides?.yFormula) overrides.yFormula = c.overrides.yFormula;
  if (c.overrides?.zFormula) overrides.zFormula = c.overrides.zFormula;
  if (c.overrides?.rotateX !== undefined) overrides.rotateX = c.overrides.rotateX;
  if (c.overrides?.rotateY !== undefined) overrides.rotateY = c.overrides.rotateY;
  if (c.overrides?.rotateZ !== undefined) overrides.rotateZ = c.overrides.rotateZ;
  return {
    componentId: c.componentId,
    quantity: c.quantity,
    placementOverride: c.placementOverride ?? null,
    length_formula: c.overrides?.lengthFormula ?? '',
    width_formula: c.overrides?.widthFormula ?? '',
    x_formula: c.overrides?.xFormula ?? '',
    y_formula: c.overrides?.yFormula ?? '',
    z_formula: c.overrides?.zFormula ?? '',
    rotate_x: c.overrides?.rotateX ?? null,
    rotate_y: c.overrides?.rotateY ?? null,
    rotate_z: c.overrides?.rotateZ ?? null,
    overrides: Object.keys(overrides).length > 0 ? overrides : null,
  };
}

function componentInstanceFromApi(
  raw: Record<string, unknown>,
): import('@muebles/domain').ModuleComponentInstance {
  const placement = str(raw.placementOverride ?? raw.placement_override);
  const overridesRaw =
    raw.overrides && typeof raw.overrides === 'object'
      ? (raw.overrides as Record<string, unknown>)
      : undefined;
  const edgesRaw = overridesRaw?.edges;
  const lengthFormula =
    str(
      raw.length_formula ??
        raw.lengthFormula ??
        overridesRaw?.lengthFormula ??
        overridesRaw?.length_formula,
    ) || undefined;
  const widthFormula =
    str(
      raw.width_formula ??
        raw.widthFormula ??
        overridesRaw?.widthFormula ??
        overridesRaw?.width_formula,
    ) || undefined;
  const xFormula =
    str(
      raw.x_formula ??
        raw.xFormula ??
        overridesRaw?.xFormula ??
        overridesRaw?.x_formula,
    ) || undefined;
  const yFormula =
    str(
      raw.y_formula ??
        raw.yFormula ??
        overridesRaw?.yFormula ??
        overridesRaw?.y_formula,
    ) || undefined;
  const zFormula =
    str(
      raw.z_formula ??
        raw.zFormula ??
        overridesRaw?.zFormula ??
        overridesRaw?.z_formula,
    ) || undefined;
  const rotateX = optionalRotate(
    raw.rotate_x ?? raw.rotateX ?? overridesRaw?.rotateX ?? overridesRaw?.rotate_x,
  );
  const rotateY = optionalRotate(
    raw.rotate_y ?? raw.rotateY ?? overridesRaw?.rotateY ?? overridesRaw?.rotate_y,
  );
  const rotateZ = optionalRotate(
    raw.rotate_z ?? raw.rotateZ ?? overridesRaw?.rotateZ ?? overridesRaw?.rotate_z,
  );
  const notes =
    str(overridesRaw?.notes) || undefined;
  const hasOverrides =
    Array.isArray(edgesRaw) ||
    Boolean(lengthFormula) ||
    Boolean(widthFormula) ||
    Boolean(xFormula) ||
    Boolean(yFormula) ||
    Boolean(zFormula) ||
    rotateX !== undefined ||
    rotateY !== undefined ||
    rotateZ !== undefined ||
    Boolean(notes);
  return {
    componentId: str(raw.componentId ?? raw.component_id),
    quantity: num(raw.quantity, 1),
    placementOverride: placement
      ? (placement as import('@muebles/domain').ComponentPlacement)
      : undefined,
    overrides: hasOverrides
      ? {
          edges: Array.isArray(edgesRaw)
            ? (edgesRaw as Record<string, unknown>[]).map((e) => ({
                side: str(e.side, 'L1') as EdgeAssignment['side'],
                enabled: bool(e.enabled),
              }))
            : undefined,
          notes,
          lengthFormula,
          widthFormula,
          xFormula,
          yFormula,
          zFormula,
          rotateX,
          rotateY,
          rotateZ,
        }
      : undefined,
  };
}

function presetToApi(p: import('@muebles/domain').DimensionPreset): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name ?? '',
    width_mm: p.width,
    height_mm: p.height,
    depth_mm: p.depth,
  };
}

function presetFromApi(raw: Record<string, unknown>): import('@muebles/domain').DimensionPreset {
  const name = str(raw.name);
  return {
    id: str(raw.id),
    name: name || undefined,
    width: num(raw.width_mm ?? raw.widthMm),
    height: num(raw.height_mm ?? raw.heightMm),
    depth: num(raw.depth_mm ?? raw.depthMm),
  };
}

export function structureToApi(st: import('@muebles/domain').Structure): Record<string, unknown> {
  return {
    id: st.id,
    code: st.code,
    name: st.name,
    width_mm: st.externalDims?.width ?? 0,
    height_mm: st.externalDims?.height ?? 0,
    depth_mm: st.externalDims?.depth ?? 0,
    notes: st.notes ?? '',
    active: st.active !== false,
    components: (st.components ?? []).map(componentInstanceToApi),
    presets: (st.presets ?? []).map(presetToApi),
  };
}

export function structureFromApi(raw: Record<string, unknown>): import('@muebles/domain').Structure {
  const w = num(raw.width_mm ?? raw.widthMm);
  const h = num(raw.height_mm ?? raw.heightMm);
  const d = num(raw.depth_mm ?? raw.depthMm);
  const hasDims = w > 0 || h > 0 || d > 0;
  const activeRaw = raw.active;
  const componentsRaw = raw.components;
  const presetsRaw = raw.presets;
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    notes: str(raw.notes) || undefined,
    externalDims: hasDims ? { width: w, height: h, depth: d } : undefined,
    active: activeRaw === false ? false : true,
    components: Array.isArray(componentsRaw)
      ? (componentsRaw as Record<string, unknown>[]).map(componentInstanceFromApi)
      : undefined,
    presets: Array.isArray(presetsRaw)
      ? (presetsRaw as Record<string, unknown>[]).map(presetFromApi)
      : undefined,
  };
}

// --- Components (F050 / #101) ---

export function componentToApi(c: Component): Record<string, unknown> {
  const lengthFormula =
    c.geometry.kind === 'rectangular_board' ? c.geometry.lengthFormula : undefined;
  const widthFormula =
    c.geometry.kind === 'rectangular_board' ? c.geometry.widthFormula : undefined;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    placement: c.placement,
    geometry_kind: c.geometry.kind,
    length_mm: c.geometry.lengthMm,
    width_mm: c.geometry.widthMm,
    thickness_mm: c.geometry.thicknessMm,
    length_formula: lengthFormula ?? '',
    width_formula: widthFormula ?? '',
    x_formula: c.xFormula ?? '',
    y_formula: c.yFormula ?? '',
    z_formula: c.zFormula ?? '',
    // null = unset (placement heuristics); 0 is a valid explicit rotation
    rotate_x: c.rotateX !== undefined ? c.rotateX : null,
    rotate_y: c.rotateY !== undefined ? c.rotateY : null,
    rotate_z: c.rotateZ !== undefined ? c.rotateZ : null,
    default_edges: c.defaultEdges.map((e) => ({ side: e.side, enabled: e.enabled })),
    option_roles: [...c.optionRoles],
    notes: c.notes ?? '',
    active: c.active,
  };
}

export function componentFromApi(raw: Record<string, unknown>): Component {
  const placement = str(raw.placement, 'base') as ComponentPlacement;
  const edgesRaw = raw.default_edges ?? raw.defaultEdges;
  const rolesRaw = raw.option_roles ?? raw.optionRoles;
  const lengthFormula = str(raw.length_formula ?? raw.lengthFormula) || undefined;
  const widthFormula = str(raw.width_formula ?? raw.widthFormula) || undefined;
  const xFormula = str(raw.x_formula ?? raw.xFormula) || undefined;
  const yFormula = str(raw.y_formula ?? raw.yFormula) || undefined;
  const zFormula = str(raw.z_formula ?? raw.zFormula) || undefined;
  const rotateX = optionalRotate(raw.rotate_x ?? raw.rotateX);
  const rotateY = optionalRotate(raw.rotate_y ?? raw.rotateY);
  const rotateZ = optionalRotate(raw.rotate_z ?? raw.rotateZ);
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    placement,
    geometry: {
      kind: (str(raw.geometry_kind ?? raw.geometryKind, 'rectangular_board') as Component['geometry']['kind']),
      lengthMm: num(raw.length_mm ?? raw.lengthMm),
      widthMm: num(raw.width_mm ?? raw.widthMm),
      thicknessMm: num(raw.thickness_mm ?? raw.thicknessMm),
      lengthFormula,
      widthFormula,
    },
    defaultEdges: Array.isArray(edgesRaw)
      ? (edgesRaw as Record<string, unknown>[]).map((e) => ({
          side: str(e.side, 'L1') as EdgeAssignment['side'],
          enabled: bool(e.enabled),
        }))
      : [],
    optionRoles: Array.isArray(rolesRaw)
      ? (rolesRaw as string[])
      : [],
    notes: str(raw.notes) || undefined,
    active: bool(raw.active, true),
    xFormula,
    yFormula,
    zFormula,
    rotateX,
    rotateY,
    rotateZ,
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

function kitchenLayoutToApi(
  layout: Project['kitchenLayout'],
): Record<string, unknown> | null {
  if (!layout) return null;
  return {
    walls: layout.walls.map((w) => ({
      id: w.id,
      name: w.name ?? '',
      length_mm: w.lengthMm,
      angle_deg: w.angleDeg,
      origin_x_mm: w.originXMm ?? null,
      origin_y_mm: w.originYMm ?? null,
    })),
    placements: layout.placements.map((p) => ({
      item_id: p.itemId,
      instance_index: p.instanceIndex,
      wall_id: p.wallId,
      offset_mm: p.offsetMm,
      elevation: p.elevation,
    })),
  };
}

function kitchenLayoutFromApi(
  raw: unknown,
): Project['kitchenLayout'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const wallsRaw = Array.isArray(row.walls) ? row.walls : [];
  const placementsRaw = Array.isArray(row.placements) ? row.placements : [];
  const walls = wallsRaw.map((w) => {
    const wr = w as Record<string, unknown>;
    const ox = wr.origin_x_mm ?? wr.originXMm;
    const oy = wr.origin_y_mm ?? wr.originYMm;
    return {
      id: str(wr.id),
      name: str(wr.name) || undefined,
      lengthMm: num(wr.length_mm ?? wr.lengthMm, 1),
      angleDeg: num(wr.angle_deg ?? wr.angleDeg),
      originXMm:
        ox === null || ox === undefined || ox === ''
          ? undefined
          : num(ox),
      originYMm:
        oy === null || oy === undefined || oy === ''
          ? undefined
          : num(oy),
    };
  });
  const placements = placementsRaw.map((p) => {
    const pr = p as Record<string, unknown>;
    const elev = str(pr.elevation, 'floor');
    return {
      itemId: str(pr.item_id ?? pr.itemId),
      instanceIndex: Math.max(0, Math.floor(num(pr.instance_index ?? pr.instanceIndex))),
      wallId: str(pr.wall_id ?? pr.wallId),
      offsetMm: num(pr.offset_mm ?? pr.offsetMm),
      elevation: (elev === 'wall' ? 'wall' : 'floor') as 'floor' | 'wall',
    };
  });
  if (walls.length === 0 && placements.length === 0) return undefined;
  return { walls, placements };
}

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
    kitchen_layout: kitchenLayoutToApi(p.kitchenLayout),
    nesting_import: p.nestingImport
      ? {
          imported_at: p.nestingImport.importedAt,
          source_name: p.nestingImport.sourceName ?? '',
          rows: p.nestingImport.rows.map((r) => ({
            material_code: r.materialCode,
            sheets_used: r.sheetsUsed,
            area_m2: r.areaM2 ?? null,
          })),
        }
      : null,
    installation_checklist: p.installationChecklist
      ? p.installationChecklist.map((c) => ({
          id: c.id,
          label: c.label,
          done: c.done,
        }))
      : null,
    items: p.items.map((item) => ({
      id: item.id,
      module_id: item.moduleId,
      quantity: item.quantity,
      option_choices: { ...item.optionChoices },
      measure_preset_id: item.measurePresetId ?? '',
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
    status: (['draft', 'quoted', 'accepted', 'produced'].includes(status)
      ? status
      : 'draft') as ProjectStatus,
    notes: str(raw.notes) || undefined,
    projectLevelChoices:
      projectLevelChoices && Object.keys(projectLevelChoices).length > 0
        ? projectLevelChoices
        : undefined,
    kitchenLayout: kitchenLayoutFromApi(
      raw.kitchen_layout ?? raw.kitchenLayout,
    ),
    nestingImport: (() => {
      const rawNest = raw.nesting_import ?? raw.nestingImport;
      if (!rawNest || typeof rawNest !== 'object' || Array.isArray(rawNest)) return undefined;
      const n = rawNest as Record<string, unknown>;
      const rowsRaw = Array.isArray(n.rows) ? n.rows : [];
      const rows = rowsRaw.map((row) => {
        const r = row as Record<string, unknown>;
        const area = r.area_m2 ?? r.areaM2;
        return {
          materialCode: str(r.material_code ?? r.materialCode),
          sheetsUsed: Math.max(0, Math.floor(num(r.sheets_used ?? r.sheetsUsed))),
          areaM2:
            area === null || area === undefined || area === ''
              ? undefined
              : num(area),
        };
      });
      if (rows.length === 0) return undefined;
      return {
        importedAt: str(n.imported_at ?? n.importedAt, new Date().toISOString()),
        sourceName: str(n.source_name ?? n.sourceName) || undefined,
        rows,
      };
    })(),
    installationChecklist: (() => {
      const rawList =
        raw.installation_checklist ?? raw.installationChecklist;
      if (!Array.isArray(rawList)) return undefined;
      const items = rawList.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: str(r.id),
          label: str(r.label),
          done: bool(r.done),
        };
      });
      return items.length > 0 ? items : undefined;
    })(),
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
    updatedAt: str(raw.updated_at ?? raw.updatedAt, new Date().toISOString()),
    items: itemsRaw.map((it): ProjectItem => {
      const row = it as Record<string, unknown>;
      const choices = row.option_choices ?? row.optionChoices;
      const measurePresetId =
        str(row.measure_preset_id ?? row.measurePresetId) || undefined;
      return {
        id: str(row.id),
        moduleId: str(row.module_id ?? row.moduleId),
        quantity: num(row.quantity, 1),
        optionChoices:
          choices && typeof choices === 'object' && !Array.isArray(choices)
            ? (choices as ProjectItem['optionChoices'])
            : {},
        measurePresetId,
      };
    }),
  };
}

// --- Workshop settings (GET/PUT /api/settings) ---

export function workshopSettingsFromApi(raw: unknown): WorkshopSettings {
  const row =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return resolveWorkshopSettings({
    defaultMarginFactor: num(
      row.default_margin_factor ?? row.defaultMarginFactor,
      1.35,
    ),
    defaultLaborFixedCost: num(
      row.default_labor_fixed_cost ?? row.defaultLaborFixedCost,
    ),
    defaultCurrency: str(
      row.default_currency ?? row.defaultCurrency,
      'MXN',
    ),
    vendedorCanViewCosts: bool(
      row.vendedor_can_view_costs ?? row.vendedorCanViewCosts,
    ),
  });
}

export function workshopSettingsToApi(
  settings: WorkshopSettings,
): Record<string, unknown> {
  const s = resolveWorkshopSettings(settings);
  return {
    default_margin_factor: s.defaultMarginFactor,
    default_labor_fixed_cost: s.defaultLaborFixedCost,
    default_currency: s.defaultCurrency,
    vendedor_can_view_costs: s.vendedorCanViewCosts,
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
  structures?: unknown;
  categories: unknown;
  customers: unknown;
  components?: unknown;
}): Catalog {
  const asRows = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

  return {
    materials: asRows(parts.materials).map(materialFromApi),
    edges: asRows(parts.edges).map(edgeFromApi),
    hardware: asRows(parts.hardware).map(hardwareFromApi),
    optionGroups: asRows(parts.optionGroups).map(optionGroupFromApi),
    modules: asRows(parts.modules).map(moduleFromApi),
    structures: asRows(parts.structures).map(structureFromApi),
    categories: asRows(parts.categories).map(categoryFromApi),
    customers: asRows(parts.customers).map(customerFromApi),
    components: asRows(parts.components).map(componentFromApi),
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
