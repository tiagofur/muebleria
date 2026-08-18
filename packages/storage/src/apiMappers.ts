/**
 * Map between FE domain (camelCase) and Go API JSON (mixed snake_case).
 * Go handlers decode by json tags on domain structs — wrong shape → zeros → PG 500.
 */

import type {
  AmbientCategory,
  AmbientMaterial,
  AmbientSurfaceType,
  BoardPart,
  Catalog,
  Component,
  ComponentPlacement,
  Customer,
  EdgeBand,
  EdgeAssignment,
  EngineeringLog,
  FloorStatusEvent,
  Hardware,
  HardwareLine,
  MaterialBoard,
  Module,
  ModuleCategory,
  OptionGroup,
  Project,
  ProjectInternalMessage,
  ProjectInternalMessageType,
  ProjectItem,
  ProjectPhoto,
  ProjectPhotoStage,
  ProjectPickingState,
  MaterialStock,
  StockMaterialKind,
  StockMovement,
  StockMovementType,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  Supplier,
  ProjectStatus,
  ProjectTechnicalStatus,
  ProjectTemplate,
  QuoteBreakdown,
  QuotePriceSnapshot,
  WarrantyRefabricationPiece,
  WarrantyTicket,
  WarrantyTicketCategory,
  WarrantyTicketPhoto,
  WarrantyPhotoKind,
  WarrantyTicketPriority,
  WarrantyTicketStatus,
  ShowcasePhotoItem,
  WorkshopSettings,

} from '@muebles/domain';


import { normalizeHardwarePartFinishes, resolveWorkshopSettings } from '@muebles/domain';



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
    preview_texture_tile_width_mm: m.previewTextureTileWidthMm ?? 0,
    preview_texture_tile_length_mm: m.previewTextureTileLengthMm ?? 0,
    preview_roughness: m.previewRoughness ?? null,
    preview_metalness: m.previewMetalness ?? null,
    preview_clearcoat: m.previewClearcoat ?? null,
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
  const tileW = num(
    raw.preview_texture_tile_width_mm ?? raw.previewTextureTileWidthMm,
    0,
  );
  const tileL = num(
    raw.preview_texture_tile_length_mm ?? raw.previewTextureTileLengthMm,
    0,
  );
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
    previewTextureTileWidthMm: tileW > 0 ? tileW : undefined,
    previewTextureTileLengthMm: tileL > 0 ? tileL : undefined,
    previewRoughness: optionalNum(raw.preview_roughness ?? raw.previewRoughness),
    previewMetalness: optionalNum(raw.preview_metalness ?? raw.previewMetalness),
    previewClearcoat: optionalNum(raw.preview_clearcoat ?? raw.previewClearcoat),
    notes: str(raw.notes) || undefined,
    active: bool(raw.active, true),
  };
}

// --- Ambient materials (#4150) ---

/**
 * Read an optional finite number; returns undefined for null/absent/non-finite.
 * Preserves 0 (valid PBR value) — unlike `num(..., 0)` which can't tell 0 from
 * "missing". Used for nullable REAL preview_* fields.
 */
function optionalNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  return typeof v === 'string' && Number.isFinite(Number(v))
    ? Number(v)
    : undefined;
}

export function ambientMaterialToApi(
  m: AmbientMaterial,
): Record<string, unknown> {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    active: m.active,
    surface_type: m.surfaceType,
    category_id: m.categoryId ?? null,
    preview_color: m.previewColor ?? null,
    preview_texture_url: m.previewTextureUrl ?? null,
    preview_texture_tile_width_mm: m.previewTextureTileWidthMm ?? null,
    preview_texture_tile_length_mm: m.previewTextureTileLengthMm ?? null,
    preview_roughness: m.previewRoughness ?? null,
    preview_metalness: m.previewMetalness ?? null,
    preview_clearcoat: m.previewClearcoat ?? null,
  };
}

export function ambientMaterialFromApi(
  raw: Record<string, unknown>,
): AmbientMaterial {
  // Defensively coalesce surfaceType (legacy/typo rows → floor), mirroring the
  // module mapper's furnitureType handling.
  const surfaceRaw = str(raw.surface_type ?? raw.surfaceType);
  const surfaceType: AmbientSurfaceType =
    surfaceRaw === 'wall'
      ? 'wall'
      : surfaceRaw === 'ceiling'
        ? 'ceiling'
        : 'floor';
  const tileW = num(
    raw.preview_texture_tile_width_mm ?? raw.previewTextureTileWidthMm,
    0,
  );
  const tileL = num(
    raw.preview_texture_tile_length_mm ?? raw.previewTextureTileLengthMm,
    0,
  );
  const catId = str(raw.category_id ?? raw.categoryId);
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    active: bool(raw.active, true),
    surfaceType,
    categoryId: catId || undefined,
    previewColor: str(raw.preview_color ?? raw.previewColor) || undefined,
    previewTextureUrl:
      str(raw.preview_texture_url ?? raw.previewTextureUrl) || undefined,
    previewTextureTileWidthMm: tileW > 0 ? tileW : undefined,
    previewTextureTileLengthMm: tileL > 0 ? tileL : undefined,
    previewRoughness: optionalNum(raw.preview_roughness ?? raw.previewRoughness),
    previewMetalness: optionalNum(raw.preview_metalness ?? raw.previewMetalness),
    previewClearcoat: optionalNum(raw.preview_clearcoat ?? raw.previewClearcoat),
  };
}

export function ambientCategoryToApi(
  c: AmbientCategory,
): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    parent_id: c.parentId ?? null,
    sort_order: c.sortOrder,
  };
}

export function ambientCategoryFromApi(
  raw: Record<string, unknown>,
): AmbientCategory {
  const parent = str(raw.parentId ?? raw.parent_id);
  return {
    id: str(raw.id),
    name: str(raw.name),
    parentId: parent || undefined,
    sortOrder: num(raw.sortOrder ?? raw.sort_order),
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
    package_size:
      h.packageSize === undefined ? null : h.packageSize,
    image_url: h.imageUrl ?? '',
    notes: h.notes ?? '',
    active: h.active,
    // Preview fields (F068/F069): geometry + PBR. Must round-trip or finishes
    // and shapes set in the UI vanish on reload.
    preview_shape: h.previewShape ?? null,
    preview_size_mm: h.previewSizeMm ?? null,
    preview_projection_mm: h.previewProjectionMm ?? null,
    preview_diameter_mm: h.previewDiameterMm ?? null,
    preview_color: h.previewColor ?? null,
    preview_roughness: h.previewRoughness ?? null,
    preview_metalness: h.previewMetalness ?? null,
    preview_clearcoat: h.previewClearcoat ?? null,
    // Per-part finishes (F080); null keeps the column empty for legacy rows.
    part_finishes: h.partFinishes ? { ...h.partFinishes } : null,
  };
}

export function hardwareFromApi(raw: Record<string, unknown>): Hardware {
  const unit = str(raw.unit, 'piece');
  const pkgRaw = raw.package_size ?? raw.packageSize;
  const packageSize =
    pkgRaw === null || pkgRaw === undefined || pkgRaw === ''
      ? undefined
      : Math.max(0, num(pkgRaw));
  const shapeRaw = str(raw.preview_shape ?? raw.previewShape);
  const validShapes = ['knob', 'bar-pull', 'cup-pull', 'hinge', 'slide', 'rail', 'leg'];
  const partFinishes = normalizeHardwarePartFinishes(
    raw.part_finishes ?? raw.partFinishes,
  );
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    unit: (unit === 'set' || unit === 'meter' ? unit : 'piece') as Hardware['unit'],
    costPerUnit: num(raw.cost_per_unit ?? raw.costPerUnit),
    ...(packageSize !== undefined && packageSize > 0
      ? { packageSize }
      : {}),
    imageUrl: str(raw.image_url ?? raw.imageUrl) || undefined,
    notes: str(raw.notes) || undefined,
    active: bool(raw.active, true),
    // Preview fields (F068/F069)
    ...(validShapes.includes(shapeRaw) ? { previewShape: shapeRaw as Hardware['previewShape'] } : {}),
    previewSizeMm: optionalNum(raw.preview_size_mm ?? raw.previewSizeMm),
    previewProjectionMm: optionalNum(raw.preview_projection_mm ?? raw.previewProjectionMm),
    previewDiameterMm: optionalNum(raw.preview_diameter_mm ?? raw.previewDiameterMm),
    previewColor: str(raw.preview_color ?? raw.previewColor) || undefined,
    previewRoughness: optionalNum(raw.preview_roughness ?? raw.previewRoughness),
    previewMetalness: optionalNum(raw.preview_metalness ?? raw.previewMetalness),
    previewClearcoat: optionalNum(raw.preview_clearcoat ?? raw.previewClearcoat),
    // Per-part finishes (F080) — validated, garbage never enters the catalog.
    ...(partFinishes ? { partFinishes } : {}),
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

const BASE_MODES = new Set(['none', 'plinth_board', 'plinth_strip', 'legs']);

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
    furniture_type: m.furnitureType ?? '',
    base_mode: m.baseMode ?? '',
    base_clearance_mm:
      m.baseClearanceMm === undefined ? null : m.baseClearanceMm,
    components: (m.components ?? []).map(componentInstanceToApi),
    agregados: (m.agregados ?? []).map(agregadoInstanceToApi),
    presets: (m.presets ?? []).map(presetToApi),
    image_url: m.imageUrl ?? '',
    notes: m.notes ?? '',
    hardware_lines: m.hardwareLines.map(hardwareLineToApi),
  };
}

const FURNITURE_TYPES = new Set(['inferior', 'superior', 'alto']);

export function moduleFromApi(raw: Record<string, unknown>): Module {
  const lines = raw.hardware_lines ?? raw.hardwareLines;
  const w = num(raw.width_mm ?? raw.widthMm);
  const h = num(raw.height_mm ?? raw.heightMm);
  const d = num(raw.depth_mm ?? raw.depthMm);
  const hasDims = w > 0 || h > 0 || d > 0;
  const categoryId = str(raw.categoryId ?? raw.category_id);
  const structureId = str(raw.structure_id ?? raw.structureId);
  const furnitureTypeRaw = str(raw.furniture_type ?? raw.furnitureType);
  const furnitureType = FURNITURE_TYPES.has(furnitureTypeRaw)
    ? (furnitureTypeRaw as Module['furnitureType'])
    : undefined;
  const baseModeRaw = str(raw.base_mode ?? raw.baseMode);
  const baseMode = BASE_MODES.has(baseModeRaw)
    ? (baseModeRaw as Module['baseMode'])
    : undefined;
  const bcRaw = raw.base_clearance_mm ?? raw.baseClearanceMm;
  const baseClearanceMm =
    bcRaw === null || bcRaw === undefined || bcRaw === ''
      ? undefined
      : Math.max(0, Math.round(num(bcRaw)));
  const labor = num(raw.base_labor_cost ?? raw.baseLaborCost);
  const imageUrl = str(raw.image_url ?? raw.imageUrl) || undefined;
  const componentsRaw = raw.components;
  const agregadosRaw = raw.agregados;
  const agregados = Array.isArray(agregadosRaw)
    ? (agregadosRaw as Record<string, unknown>[]).map(agregadoInstanceFromApi)
    : undefined;
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
    furnitureType,
    baseMode,
    ...(baseClearanceMm === undefined ? {} : { baseClearanceMm }),
    components: Array.isArray(componentsRaw)
      ? (componentsRaw as Record<string, unknown>[]).map(componentInstanceFromApi)
      : undefined,
    agregados: agregados && agregados.length > 0 ? agregados : undefined,
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
  if (c.overrides?.hardwarePlacements && c.overrides.hardwarePlacements.length > 0) {
    overrides.hardwarePlacements = c.overrides.hardwarePlacements;
  }
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

function hardwarePlacementFromApi(
  raw: Record<string, unknown>,
): import('@muebles/domain').HardwarePlacement {
  const relRaw = (raw.relativePosition ?? raw.relative_position) as
    | Record<string, unknown>
    | undefined;
  const rotRaw = (raw.rotationDeg ?? raw.rotation_deg) as
    | Record<string, unknown>
    | undefined;

  const xFormula = str(relRaw?.xFormula ?? relRaw?.x_formula) || undefined;
  const yFormula = str(relRaw?.yFormula ?? relRaw?.y_formula) || undefined;
  const xMm = num(relRaw?.xMm ?? relRaw?.x_mm, 50);
  const yMm = num(relRaw?.yMm ?? relRaw?.y_mm, 50);

  return {
    hardwareId: str(raw.hardwareId ?? raw.hardware_id),
    anchorFace: (str(raw.anchorFace ?? raw.anchor_face, 'front') as any) || 'front',
    relativePosition: {
      xMm,
      yMm,
      ...(xFormula ? { xFormula } : {}),
      ...(yFormula ? { yFormula } : {}),
    },
    ...(rotRaw
      ? {
          rotationDeg: {
            x: num(rotRaw.x, 0),
            y: num(rotRaw.y, 0),
            z: num(rotRaw.z, 0),
          },
        }
      : {}),
    ...(typeof raw.scale === 'number' && Number.isFinite(raw.scale)
      ? { scale: raw.scale }
      : {}),
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
  const hardwarePlacementsRaw = Array.isArray(overridesRaw?.hardwarePlacements)
    ? (overridesRaw?.hardwarePlacements as readonly Record<string, unknown>[])
    : undefined;
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
    hardwarePlacementsRaw !== undefined ||
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
          hardwarePlacements: Array.isArray(hardwarePlacementsRaw)
            ? hardwarePlacementsRaw.map(hardwarePlacementFromApi)
            : undefined,
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

/**
 * Map an immutable `StructureRevision` snapshot (#108) to API JSON.
 * Mirrors the subset of `Structure` fields that affect BOM resolution
 * (no `notes`/`active` — irrelevant for re-resolution, see Slice 1).
 */
export function agregadoInstanceToApi(
  inst: import('@muebles/domain').ModuleAgregadoInstance,
): Record<string, unknown> {
  return {
    id: inst.id,
    agregado_id: inst.agregadoId,
    name: inst.name,
    quantity: inst.quantity,
    layout_direction: inst.layoutDirection,
    gap_mm: inst.gapMm,
    mirrored: inst.mirrored,
    position: inst.position
      ? {
          x_formula: inst.position.xFormula,
          y_formula: inst.position.yFormula,
          z_formula: inst.position.zFormula,
        }
      : undefined,
    dimensions: inst.dimensions
      ? {
          width_formula: inst.dimensions.widthFormula,
          height_formula: inst.dimensions.heightFormula,
          depth_formula: inst.dimensions.depthFormula,
        }
      : undefined,
    option_overrides: inst.optionOverrides,
  };
}

export function agregadoInstanceFromApi(
  raw: Record<string, unknown>,
): import('@muebles/domain').ModuleAgregadoInstance {
  const posRaw = raw.position as Record<string, unknown> | undefined;
  const dimsRaw = raw.dimensions as Record<string, unknown> | undefined;
  const overridesRaw = raw.option_overrides ?? raw.optionOverrides;

  return {
    id: str(raw.id),
    agregadoId: str(raw.agregado_id ?? raw.agregadoId),
    name: str(raw.name) || undefined,
    quantity: num(raw.quantity) || 1,
    layoutDirection: (str(raw.layout_direction ?? raw.layoutDirection) as any) || 'none',
    gapMm: num(raw.gap_mm ?? raw.gapMm) || 0,
    mirrored: Boolean(raw.mirrored),
    position: posRaw
      ? {
          xFormula: str(posRaw.x_formula ?? posRaw.xFormula) || undefined,
          yFormula: str(posRaw.y_formula ?? posRaw.yFormula) || undefined,
          zFormula: str(posRaw.z_formula ?? posRaw.zFormula) || undefined,
        }
      : undefined,
    dimensions: dimsRaw
      ? {
          widthFormula: str(dimsRaw.width_formula ?? dimsRaw.widthFormula) || undefined,
          heightFormula: str(dimsRaw.height_formula ?? dimsRaw.heightFormula) || undefined,
          depthFormula: str(dimsRaw.depth_formula ?? dimsRaw.depthFormula) || undefined,
        }
      : undefined,
    optionOverrides:
      overridesRaw && typeof overridesRaw === 'object'
        ? (overridesRaw as Record<string, string>)
        : undefined,
  };
}

function structureRevisionToApi(
  r: import('@muebles/domain').StructureRevision,
): Record<string, unknown> {
  return {
    revision: r.revision,
    code: r.code,
    name: r.name,
    width_mm: r.externalDims?.width ?? 0,
    height_mm: r.externalDims?.height ?? 0,
    depth_mm: r.externalDims?.depth ?? 0,
    components: (r.components ?? []).map(componentInstanceToApi),
    presets: (r.presets ?? []).map(presetToApi),
    agregados: (r.agregados ?? []).map(agregadoInstanceToApi),
  };
}

function structureRevisionFromApi(
  raw: Record<string, unknown>,
): import('@muebles/domain').StructureRevision {
  const w = num(raw.width_mm ?? raw.widthMm);
  const h = num(raw.height_mm ?? raw.heightMm);
  const d = num(raw.depth_mm ?? raw.depthMm);
  const hasDims = w > 0 || h > 0 || d > 0;
  const componentsRaw = raw.components;
  const presetsRaw = raw.presets;
  const agregadosRaw = raw.agregados;
  return {
    revision: num(raw.revision, 1),
    code: str(raw.code),
    name: str(raw.name),
    externalDims: hasDims ? { width: w, height: h, depth: d } : undefined,
    components: Array.isArray(componentsRaw)
      ? (componentsRaw as Record<string, unknown>[]).map(componentInstanceFromApi)
      : undefined,
    presets: Array.isArray(presetsRaw)
      ? (presetsRaw as Record<string, unknown>[]).map(presetFromApi)
      : undefined,
    agregados: Array.isArray(agregadosRaw)
      ? (agregadosRaw as Record<string, unknown>[]).map(agregadoInstanceFromApi)
      : undefined,
  };
}

export function structureToApi(st: import('@muebles/domain').Structure): Record<string, unknown> {
  // #108 — `revision` defaults to 1 when absent (domain normalizes the same way
  // via `structureRevision`). Always emit it so the Go side never sees a zero
  // revision from legacy FE payloads.
  const revision = st.revision ?? 1;
  return {
    id: st.id,
    code: st.code,
    name: st.name,
    width_mm: st.externalDims?.width ?? 0,
    height_mm: st.externalDims?.height ?? 0,
    depth_mm: st.externalDims?.depth ?? 0,
    notes: st.notes ?? '',
    active: st.active !== false,
    revision,
    history: (st.history ?? []).map(structureRevisionToApi),
    components: (st.components ?? []).map(componentInstanceToApi),
    presets: (st.presets ?? []).map(presetToApi),
    agregados: (st.agregados ?? []).map(agregadoInstanceToApi),
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
  const agregadosRaw = raw.agregados;
  const revisionRaw = raw.revision;
  const historyRaw = raw.history;
  const history = Array.isArray(historyRaw)
    ? (historyRaw as Record<string, unknown>[]).map(structureRevisionFromApi)
    : undefined;
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    notes: str(raw.notes) || undefined,
    externalDims: hasDims ? { width: w, height: h, depth: d } : undefined,
    active: activeRaw === false ? false : true,
    // #108 — default to 1 when the API payload omits `revision` (legacy rows).
    revision: typeof revisionRaw === 'number' && Number.isFinite(revisionRaw)
      ? revisionRaw
      : 1,
    // Keep `history` undefined when absent so empty arrays don't pollute JSON.
    history: history && history.length > 0 ? history : undefined,
    components: Array.isArray(componentsRaw)
      ? (componentsRaw as Record<string, unknown>[]).map(componentInstanceFromApi)
      : undefined,
    presets: Array.isArray(presetsRaw)
      ? (presetsRaw as Record<string, unknown>[]).map(presetFromApi)
      : undefined,
    agregados: Array.isArray(agregadosRaw)
      ? (agregadosRaw as Record<string, unknown>[]).map(agregadoInstanceFromApi)
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

function kitchenWallToApi(w: {
  id: string;
  name?: string;
  lengthMm: number;
  angleDeg: number;
  originXMm?: number;
  originYMm?: number;
  wallMaterialId?: string;
}): Record<string, unknown> {
  return {
    id: w.id,
    name: w.name ?? '',
    length_mm: w.lengthMm,
    angle_deg: w.angleDeg,
    origin_x_mm: w.originXMm ?? null,
    origin_y_mm: w.originYMm ?? null,
    wall_material_id: w.wallMaterialId ?? null,
  };
}

function kitchenPlacementToApi(p: {
  itemId: string;
  instanceIndex: number;
  wallId: string;
  offsetMm: number;
  elevation: string;
  baseClearanceMm?: number;
  mode?: string;
  freeXMm?: number;
  freeYMm?: number;
  freeYawDeg?: number;
}): Record<string, unknown> {
  return {
    item_id: p.itemId,
    instance_index: p.instanceIndex,
    wall_id: p.wallId,
    offset_mm: p.offsetMm,
    elevation: p.elevation,
    base_clearance_mm:
      p.baseClearanceMm === undefined ? null : p.baseClearanceMm,
    mode: p.mode ?? 'wall',
    free_x_mm: p.freeXMm === undefined ? null : p.freeXMm,
    free_y_mm: p.freeYMm === undefined ? null : p.freeYMm,
    free_yaw_deg: p.freeYawDeg === undefined ? null : p.freeYawDeg,
  };
}

function kitchenUnderlayToApi(
  u: NonNullable<Project['kitchenLayout']>['underlay'],
): Record<string, unknown> | null {
  if (!u) return null;
  return {
    image_url: u.imageUrl,
    width_mm: u.widthMm,
    height_mm: u.heightMm,
    origin_x_mm: u.originXMm ?? null,
    origin_y_mm: u.originYMm ?? null,
    opacity: u.opacity ?? null,
    file_name: u.fileName ?? null,
  };
}

function kitchenUnderlayFromApi(
  raw: unknown,
): NonNullable<Project['kitchenLayout']>['underlay'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const imageUrl = str(row.image_url ?? row.imageUrl);
  if (!imageUrl) return undefined;
  const widthMm = Math.max(1, Math.round(num(row.width_mm ?? row.widthMm, 5000)));
  const heightMm = Math.max(
    1,
    Math.round(num(row.height_mm ?? row.heightMm, 4000)),
  );
  const ox = row.origin_x_mm ?? row.originXMm;
  const oy = row.origin_y_mm ?? row.originYMm;
  const op = row.opacity;
  const fileName = str(row.file_name ?? row.fileName) || undefined;
  return {
    imageUrl,
    widthMm,
    heightMm,
    ...(ox === null || ox === undefined || ox === ''
      ? {}
      : { originXMm: num(ox) }),
    ...(oy === null || oy === undefined || oy === ''
      ? {}
      : { originYMm: num(oy) }),
    ...(op === null || op === undefined || op === ''
      ? {}
      : { opacity: Math.min(1, Math.max(0, num(op))) }),
    ...(fileName ? { fileName } : {}),
  };
}

function kitchenLayoutToApi(
  layout: Project['kitchenLayout'],
): Record<string, unknown> | null {
  if (!layout) return null;
  return {
    walls: layout.walls.map(kitchenWallToApi),
    placements: layout.placements.map(kitchenPlacementToApi),
    base_clearance_mm:
      layout.baseClearanceMm === undefined ? null : layout.baseClearanceMm,
    wall_cabinet_z_mm:
      layout.wallCabinetZMm === undefined ? null : layout.wallCabinetZMm,
    show_countertop:
      layout.showCountertop === undefined ? null : layout.showCountertop,
    countertop_material_id:
      layout.countertopMaterialId === undefined ? null : layout.countertopMaterialId,
    floor_material_id:
      layout.floorMaterialId === undefined ? null : layout.floorMaterialId,
    wall_material_id:
      layout.wallMaterialId === undefined ? null : layout.wallMaterialId,
    ceiling_material_id:
      layout.ceilingMaterialId === undefined ? null : layout.ceilingMaterialId,
    show_ceiling:
      layout.showCeiling === undefined ? null : layout.showCeiling,
    underlay: kitchenUnderlayToApi(layout.underlay),
    active_space_id: layout.activeSpaceId ?? null,
    spaces: layout.spaces?.length
      ? layout.spaces.map((s) => ({
          id: s.id,
          name: s.name,
          walls: s.walls.map(kitchenWallToApi),
          placements: s.placements.map(kitchenPlacementToApi),
          base_clearance_mm:
            s.baseClearanceMm === undefined ? null : s.baseClearanceMm,
          wall_cabinet_z_mm:
            s.wallCabinetZMm === undefined ? null : s.wallCabinetZMm,
          show_countertop:
            s.showCountertop === undefined ? null : s.showCountertop,
          countertop_material_id: s.countertopMaterialId ?? null,
          floor_material_id: s.floorMaterialId ?? null,
          wall_material_id: s.wallMaterialId ?? null,
          ceiling_material_id: s.ceilingMaterialId ?? null,
          show_ceiling: s.showCeiling === undefined ? null : s.showCeiling,
          underlay: kitchenUnderlayToApi(s.underlay),
        }))
      : null,
  };
}

function kitchenWallFromApi(w: unknown): {
  id: string;
  name?: string;
  lengthMm: number;
  angleDeg: number;
  originXMm?: number;
  originYMm?: number;
  wallMaterialId?: string;
} {
  const wr = w as Record<string, unknown>;
  const ox = wr.origin_x_mm ?? wr.originXMm;
  const oy = wr.origin_y_mm ?? wr.originYMm;
  const wMatId = str(wr.wall_material_id ?? wr.wallMaterialId);
  return {
    id: str(wr.id),
    name: str(wr.name) || undefined,
    lengthMm: num(wr.length_mm ?? wr.lengthMm, 1),
    angleDeg: num(wr.angle_deg ?? wr.angleDeg),
    originXMm:
      ox === null || ox === undefined || ox === '' ? undefined : num(ox),
    originYMm:
      oy === null || oy === undefined || oy === '' ? undefined : num(oy),
    ...(wMatId ? { wallMaterialId: wMatId } : {}),
  };
}

function kitchenPlacementFromApi(p: unknown): {
  itemId: string;
  instanceIndex: number;
  wallId: string;
  offsetMm: number;
  elevation: 'floor' | 'wall';
  baseClearanceMm?: number;
  mode?: 'free';
  freeXMm?: number;
  freeYMm?: number;
  freeYawDeg?: number;
} {
  const pr = p as Record<string, unknown>;
  const elev = str(pr.elevation, 'floor');
  const bcRaw = pr.base_clearance_mm ?? pr.baseClearanceMm;
  const baseClearanceMm =
    bcRaw === null || bcRaw === undefined || bcRaw === ''
      ? undefined
      : Math.max(0, Math.round(num(bcRaw)));
  const modeRaw = str(pr.mode, 'wall');
  const mode = modeRaw === 'free' ? ('free' as const) : ('wall' as const);
  const fx = pr.free_x_mm ?? pr.freeXMm;
  const fy = pr.free_y_mm ?? pr.freeYMm;
  const fyaw = pr.free_yaw_deg ?? pr.freeYawDeg;
  return {
    itemId: str(pr.item_id ?? pr.itemId),
    instanceIndex: Math.max(
      0,
      Math.floor(num(pr.instance_index ?? pr.instanceIndex)),
    ),
    wallId: str(pr.wall_id ?? pr.wallId),
    offsetMm: num(pr.offset_mm ?? pr.offsetMm),
    elevation: (elev === 'wall' ? 'wall' : 'floor') as 'floor' | 'wall',
    ...(baseClearanceMm === undefined ? {} : { baseClearanceMm }),
    ...(mode === 'free' ? { mode: 'free' as const } : {}),
    ...(fx === null || fx === undefined || fx === ''
      ? {}
      : { freeXMm: num(fx) }),
    ...(fy === null || fy === undefined || fy === ''
      ? {}
      : { freeYMm: num(fy) }),
    ...(fyaw === null || fyaw === undefined || fyaw === ''
      ? {}
      : { freeYawDeg: num(fyaw) }),
  };
}

function optionalPlanMm(
  raw: unknown,
): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  return Math.max(0, Math.round(num(raw)));
}

function kitchenLayoutFromApi(
  raw: unknown,
): Project['kitchenLayout'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const wallsRaw = Array.isArray(row.walls) ? row.walls : [];
  const placementsRaw = Array.isArray(row.placements) ? row.placements : [];
  const walls = wallsRaw.map(kitchenWallFromApi);
  const placements = placementsRaw.map(kitchenPlacementFromApi);

  const spacesRaw = Array.isArray(row.spaces) ? row.spaces : [];
  const spaces = spacesRaw.map((s) => {
    const sr = s as Record<string, unknown>;
    const sWalls = Array.isArray(sr.walls) ? sr.walls.map(kitchenWallFromApi) : [];
    const sPlacements = Array.isArray(sr.placements)
      ? sr.placements.map(kitchenPlacementFromApi)
      : [];
    const sBc = optionalPlanMm(sr.base_clearance_mm ?? sr.baseClearanceMm);
    const sWz = optionalPlanMm(sr.wall_cabinet_z_mm ?? sr.wallCabinetZMm);
    const sCt = sr.show_countertop ?? sr.showCountertop;
    const sCtM = str(sr.countertop_material_id ?? sr.countertopMaterialId);
    const sFloorM = str(sr.floor_material_id ?? sr.floorMaterialId);
    const sWallM = str(sr.wall_material_id ?? sr.wallMaterialId);
    const sCeilM = str(sr.ceiling_material_id ?? sr.ceilingMaterialId);
    const sCeil = sr.show_ceiling ?? sr.showCeiling;
    const sUnderlay = kitchenUnderlayFromApi(sr.underlay);
    return {
      id: str(sr.id),
      name: str(sr.name) || 'Espacio',
      walls: sWalls,
      placements: sPlacements,
      ...(sBc === undefined ? {} : { baseClearanceMm: sBc }),
      ...(sWz === undefined ? {} : { wallCabinetZMm: sWz }),
      ...(sCt === null || sCt === undefined || sCt === ''
        ? {}
        : { showCountertop: Boolean(sCt) }),
      ...(sCtM ? { countertopMaterialId: sCtM } : {}),
      ...(sFloorM ? { floorMaterialId: sFloorM } : {}),
      ...(sWallM ? { wallMaterialId: sWallM } : {}),
      ...(sCeilM ? { ceilingMaterialId: sCeilM } : {}),
      ...(sCeil === null || sCeil === undefined || sCeil === ''
        ? {}
        : { showCeiling: Boolean(sCeil) }),
      ...(sUnderlay ? { underlay: sUnderlay } : {}),
    };
  });

  const hasSpaces = spaces.length > 0;
  const hasTop = walls.length > 0 || placements.length > 0;
  if (!hasSpaces && !hasTop) return undefined;

  const layoutBc = optionalPlanMm(row.base_clearance_mm ?? row.baseClearanceMm);
  const wallCabinetZMm = optionalPlanMm(
    row.wall_cabinet_z_mm ?? row.wallCabinetZMm,
  );
  const ctRaw = row.show_countertop ?? row.showCountertop;
  const showCountertop =
    ctRaw === null || ctRaw === undefined || ctRaw === ''
      ? undefined
      : Boolean(ctRaw);
  const ctMatRaw = row.countertop_material_id ?? row.countertopMaterialId;
  const countertopMaterialId =
    ctMatRaw === null || ctMatRaw === undefined || ctMatRaw === ''
      ? undefined
      : str(ctMatRaw);
  const activeSpaceIdRaw = row.active_space_id ?? row.activeSpaceId;
  const activeSpaceId =
    activeSpaceIdRaw === null ||
    activeSpaceIdRaw === undefined ||
    activeSpaceIdRaw === ''
      ? undefined
      : str(activeSpaceIdRaw);

  const underlay = kitchenUnderlayFromApi(row.underlay);

  return {
    walls,
    placements,
    ...(layoutBc === undefined ? {} : { baseClearanceMm: layoutBc }),
    ...(wallCabinetZMm === undefined ? {} : { wallCabinetZMm }),
    ...(showCountertop === undefined ? {} : { showCountertop }),
    ...(countertopMaterialId ? { countertopMaterialId } : {}),
    ...(underlay ? { underlay } : {}),
    ...(hasSpaces ? { spaces } : {}),
    ...(activeSpaceId ? { activeSpaceId } : {}),
  };
}

const MEASURE_DEFAULT_TYPES = new Set(['inferior', 'superior', 'alto']);

/**
 * Serialize Project.measureDefaults to the API shape (#109). Drops types whose
 * dims are all empty; returns null when the whole map is empty.
 */
function measureDefaultsToApi(
  defaults: Project['measureDefaults'],
): Record<string, { depth?: number; height?: number }> | null {
  if (!defaults) return null;
  const out: Record<string, { depth?: number; height?: number }> = {};
  for (const [type, dims] of Object.entries(defaults)) {
    if (!MEASURE_DEFAULT_TYPES.has(type)) continue;
    if (!dims) continue;
    const entry: { depth?: number; height?: number } = {};
    if (typeof dims.depth === 'number' && Number.isFinite(dims.depth)) {
      entry.depth = dims.depth;
    }
    if (typeof dims.height === 'number' && Number.isFinite(dims.height)) {
      entry.height = dims.height;
    }
    if (entry.depth !== undefined || entry.height !== undefined) {
      out[type] = entry;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Parse Project.measureDefaults from the API shape (#109). Accepts snake or
 * camel key; returns undefined for empty/invalid input.
 */
function measureDefaultsFromApi(
  raw: unknown,
): Project['measureDefaults'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: {
    [type in 'inferior' | 'superior' | 'alto']?: {
      depth?: number;
      height?: number;
    };
  } = {};
  for (const type of MEASURE_DEFAULT_TYPES) {
    const entry = src[type] as
      | { depth?: unknown; height?: unknown }
      | undefined;
    if (!entry || typeof entry !== 'object') continue;
    const dims: { depth?: number; height?: number } = {};
    const depth = num(entry.depth);
    if (depth > 0) dims.depth = depth;
    const height = num(entry.height);
    if (height > 0) dims.height = height;
    if (dims.depth !== undefined || dims.height !== undefined) {
      (out as Record<string, { depth?: number; height?: number }>)[type] = dims;
    }
  }
  return Object.keys(out).length > 0
    ? (out as Project['measureDefaults'])
    : undefined;
}

function priceSnapshotToApi(
  snapshot: QuotePriceSnapshot | undefined,
): Record<string, unknown> | null {
  if (!snapshot) return null;
  return {
    captured_at: snapshot.capturedAt,
    breakdown: {
      materials_cost: snapshot.breakdown.materialsCost,
      edge_total: snapshot.breakdown.edgeTotal,
      hardware_total: snapshot.breakdown.hardwareTotal,
      direct_cost: snapshot.breakdown.directCost,
      labor_modular: snapshot.breakdown.laborModular,
      labor_fixed_cost: snapshot.breakdown.laborFixedCost,
      margin_factor: snapshot.breakdown.marginFactor,
      sale_price: snapshot.breakdown.salePrice,
    },
    material_cost_per_m2: snapshot.materialCostPerM2
      ? { ...snapshot.materialCostPerM2 }
      : undefined,
    edge_cost_per_ml: snapshot.edgeCostPerMl
      ? { ...snapshot.edgeCostPerMl }
      : undefined,
    hardware_cost_per_unit: snapshot.hardwareCostPerUnit
      ? { ...snapshot.hardwareCostPerUnit }
      : undefined,
  };
}

function priceSnapshotFromApi(
  raw: unknown,
): QuotePriceSnapshot | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  const rawBreakdown = (s.breakdown ?? {}) as Record<string, unknown>;
  return {
    capturedAt: str(s.captured_at ?? s.capturedAt, new Date().toISOString()),
    breakdown: {
      materialsCost: num(rawBreakdown.materials_cost ?? rawBreakdown.materialsCost),
      edgeTotal: num(rawBreakdown.edge_total ?? rawBreakdown.edgeTotal),
      hardwareTotal: num(rawBreakdown.hardware_total ?? rawBreakdown.hardwareTotal),
      directCost: num(rawBreakdown.direct_cost ?? rawBreakdown.directCost),
      laborModular: num(rawBreakdown.labor_modular ?? rawBreakdown.laborModular),
      laborFixedCost: num(rawBreakdown.labor_fixed_cost ?? rawBreakdown.laborFixedCost),
      marginFactor: num(rawBreakdown.margin_factor ?? rawBreakdown.marginFactor, 1.35),
      salePrice: num(rawBreakdown.sale_price ?? rawBreakdown.salePrice),
    },
    materialCostPerM2: s.material_cost_per_m2 as Record<string, number> | undefined,
    edgeCostPerMl: s.edge_cost_per_ml as Record<string, number> | undefined,
    hardwareCostPerUnit: s.hardware_cost_per_unit as Record<string, number> | undefined,
  };
}

export function projectToApi(p: Project): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    customer_id: p.customerId,
    created_by: p.createdBy ?? '',
    owner_user_id: p.ownerUserId ?? '',
    assigned_engineer_id: p.assignedEngineerId ?? '',
    technical_status: p.technicalStatus ?? 'pending_assignment',
    survey_completed_at: p.surveyCompletedAt ?? null,
    installation_scheduled_date: p.installationScheduledDate ?? null,
    currency: p.currency,
    margin_factor: p.marginFactor,
    labor_fixed_cost: p.laborFixedCost,
    status: p.status,
    notes: p.notes ?? '',
    project_level_choices: { ...(p.projectLevelChoices ?? {}) },
    measure_defaults: measureDefaultsToApi(p.measureDefaults),
    kitchen_layout: kitchenLayoutToApi(p.kitchenLayout),
    price_snapshot: priceSnapshotToApi(p.priceSnapshot),
    plan_edit_session: p.planEditSession
      ? {
          user_id: p.planEditSession.userId,
          user_name: p.planEditSession.userName,
          expires_at: p.planEditSession.expiresAt,
        }
      : null,
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
      // F087 — base treatment override; '' = module default.
      base_mode: item.baseMode ?? '',
      // #108 — null when unpinned (live revision). 0 is not a valid revision,
      // but we still emit it verbatim if someone sets it; the resolver rejects
      // unknown pins loudly rather than silently degrading.
      structure_revision_pin: item.structureRevisionPin ?? null,
      // PROD-3.1 — shop-floor status (omit when pending/undefined)
      floor_status: item.floorStatus ?? null,
    })),
    // PROD-3.2 — factory OP revision tracking
    production: p.production
      ? {
          revision: p.production.revision,
          revision_at: p.production.revisionAt,
          fingerprint: p.production.fingerprint ?? '',
          last_export_revision: p.production.lastExportRevision ?? null,
          last_export_at: p.production.lastExportAt ?? '',
          last_export_fingerprint: p.production.lastExportFingerprint ?? '',
        }
      : null,
    // F092 — shop-floor transition log (server upserts by id)
    floor_events: (p.floorEvents ?? []).map((e) => ({
      id: e.id,
      item_id: e.itemId,
      from_status: e.from,
      to_status: e.to,
      at: e.at,
      by_user_id: e.byUserId ?? null,
      by_name: e.byName ?? null,
      source: e.source,
      note: e.note ?? null,
    })),
    // Engineering lifecycle log (roadmap-screens 2a.4 — was never persisted,
    // the status died on reload).
    engineering_log: p.engineeringLog
      ? {
          started_by: p.engineeringLog.startedBy,
          started_at: p.engineeringLog.startedAt,
          generated_by: p.engineeringLog.generatedBy ?? null,
          generated_at: p.engineeringLog.generatedAt ?? null,
          sent_to_production_by: p.engineeringLog.sentToProductionBy ?? null,
          sent_to_production_at: p.engineeringLog.sentToProductionAt ?? null,
          revision: p.engineeringLog.revision,
        }
      : null,
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
  const assignedEngineerId =
    str(raw.assigned_engineer_id ?? raw.assignedEngineerId) || undefined;
  const technicalStatusRaw =
    str(raw.technical_status ?? raw.technicalStatus) || 'pending_assignment';
  const surveyCompletedAt =
    str(raw.survey_completed_at ?? raw.surveyCompletedAt) || undefined;
  const installationScheduledDate =
    str(raw.installation_scheduled_date ?? raw.installationScheduledDate) || undefined;
  return {
    id: str(raw.id),
    name: str(raw.name),
    customerId: str(raw.customer_id ?? raw.customerId),
    createdBy: str(raw.created_by ?? raw.createdBy) || undefined,
    ownerUserId,
    assignedEngineerId,
    technicalStatus: technicalStatusRaw as ProjectTechnicalStatus,
    surveyCompletedAt,
    installationScheduledDate,
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
    measureDefaults: measureDefaultsFromApi(
      raw.measure_defaults ?? raw.measureDefaults,
    ),
    kitchenLayout: kitchenLayoutFromApi(
      raw.kitchen_layout ?? raw.kitchenLayout,
    ),
    planEditSession: (() => {
      const rawSes = raw.plan_edit_session ?? raw.planEditSession;
      if (!rawSes || typeof rawSes !== 'object' || Array.isArray(rawSes)) {
        return undefined;
      }
      const s = rawSes as Record<string, unknown>;
      const userId = str(s.user_id ?? s.userId);
      const userName = str(s.user_name ?? s.userName);
      const expiresAt = str(s.expires_at ?? s.expiresAt);
      if (!userId || !expiresAt) return undefined;
      return {
        userId,
        userName: userName || 'Usuario',
        expiresAt,
      };
    })(),
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
    production: (() => {
      const rawProd = raw.production;
      if (!rawProd || typeof rawProd !== 'object' || Array.isArray(rawProd)) {
        return undefined;
      }
      const p = rawProd as Record<string, unknown>;
      const revision = Math.max(0, Math.floor(num(p.revision, 0)));
      if (revision < 1) return undefined;
      const lastExpRev = p.last_export_revision ?? p.lastExportRevision;
      return {
        revision,
        revisionAt: str(p.revision_at ?? p.revisionAt, new Date().toISOString()),
        fingerprint: str(p.fingerprint) || undefined,
        lastExportRevision:
          lastExpRev === null || lastExpRev === undefined || lastExpRev === ''
            ? undefined
            : Math.max(0, Math.floor(num(lastExpRev))),
        lastExportAt: str(p.last_export_at ?? p.lastExportAt) || undefined,
        lastExportFingerprint:
          str(p.last_export_fingerprint ?? p.lastExportFingerprint) || undefined,
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
    priceSnapshot: priceSnapshotFromApi(raw.price_snapshot ?? raw.priceSnapshot),
    items: itemsRaw.map((it): ProjectItem => {
      const row = it as Record<string, unknown>;
      const choices = row.option_choices ?? row.optionChoices;
      const measurePresetId =
        str(row.measure_preset_id ?? row.measurePresetId) || undefined;
      const pinRaw = row.structure_revision_pin ?? row.structureRevisionPin;
      const structureRevisionPin =
        typeof pinRaw === 'number' && Number.isFinite(pinRaw) ? pinRaw : undefined;
      const floorRaw = str(row.floor_status ?? row.floorStatus);
      const floorStatus =
        floorRaw === 'pending' ||
        floorRaw === 'cut' ||
        floorRaw === 'edged' ||
        floorRaw === 'assembled' ||
        floorRaw === 'packaged' ||
        floorRaw === 'loaded' ||
        floorRaw === 'installed'
          ? (floorRaw as ProjectItem['floorStatus'])
          : undefined;
      const baseModeRaw = str(row.base_mode ?? row.baseMode);
      const baseMode = (
        ['none', 'plinth_board', 'plinth_strip', 'legs'] as const
      ).includes(baseModeRaw as never)
        ? (baseModeRaw as ProjectItem['baseMode'])
        : undefined;
      return {
        id: str(row.id),
        moduleId: str(row.module_id ?? row.moduleId),
        quantity: num(row.quantity, 1),
        optionChoices:
          choices && typeof choices === 'object' && !Array.isArray(choices)
            ? (choices as ProjectItem['optionChoices'])
            : {},
        measurePresetId,
        ...(baseMode ? { baseMode } : {}),
        // #108 — undefined when null/absent (live revision). Only finite numbers
        // survive; that's what `resolveStructureRevision` expects.
        structureRevisionPin,
        floorStatus: floorStatus === 'pending' ? undefined : floorStatus,
      };
    }),
    // F092 — shop-floor transition log (server serves it embedded; optional)
    floorEvents: floorEventsFromApi(raw.floor_events ?? raw.floorEvents),
    // Engineering lifecycle log (roadmap-screens 2a.4)
    engineeringLog: engineeringLogFromApi(raw.engineering_log ?? raw.engineeringLog),
  };
}

function engineeringLogFromApi(raw: unknown): EngineeringLog | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const startedBy = str(r.started_by ?? r.startedBy);
  const revision = num(r.revision, 0);
  if (!startedBy || revision < 1) return undefined;
  return {
    startedBy,
    startedAt: str(r.started_at ?? r.startedAt),
    generatedBy: str(r.generated_by ?? r.generatedBy) || undefined,
    generatedAt: str(r.generated_at ?? r.generatedAt) || undefined,
    sentToProductionBy:
      str(r.sent_to_production_by ?? r.sentToProductionBy) || undefined,
    sentToProductionAt:
      str(r.sent_to_production_at ?? r.sentToProductionAt) || undefined,
    revision,
  };
}

function floorEventsFromApi(raw: unknown): FloorStatusEvent[] | undefined {  if (!Array.isArray(raw)) return undefined;
  const events: FloorStatusEvent[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const id = str(r.id);
    const itemId = str(r.item_id ?? r.itemId);
    const fromStatus = str(r.from_status ?? r.fromStatus) as FloorStatusEvent['from'];
    const toStatus = str(r.to_status ?? r.toStatus) as FloorStatusEvent['to'];
    if (!id || !itemId) continue;
    events.push({
      id,
      projectId: str(r.project_id ?? r.projectId),
      itemId,
      from: fromStatus,
      to: toStatus,
      at: str(r.at),
      byUserId: str(r.by_user_id ?? r.byUserId) || undefined,
      byName: str(r.by_name ?? r.byName) || undefined,
      source: (str(r.source) || 'api') as FloorStatusEvent['source'],
      note: str(r.note) || undefined,
    });
  }
  return events.length > 0 ? events : undefined;
}

// --- Project templates (#110 / H15) ---

export function projectTemplateToApi(
  t: ProjectTemplate,
): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    currency: t.currency,
    margin_factor: t.marginFactor,
    labor_fixed_cost: t.laborFixedCost,
    project_level_choices: { ...(t.projectLevelChoices ?? {}) },
    measure_defaults: measureDefaultsToApi(t.measureDefaults),
    kitchen_layout: kitchenLayoutToApi(t.kitchenLayout),
    installation_checklist: t.installationChecklist
      ? t.installationChecklist.map((c) => ({
          id: c.id,
          label: c.label,
          done: c.done,
        }))
      : null,
    notes: t.notes ?? '',
    // Templates never pin a structure revision; the field is omitted per item.
    items: t.items.map((item) => ({
      id: item.id,
      module_id: item.moduleId,
      quantity: item.quantity,
      option_choices: { ...item.optionChoices },
      measure_preset_id: item.measurePresetId ?? '',
      base_mode: item.baseMode ?? '',
    })),
  };
}

export function projectTemplateFromApi(
  raw: Record<string, unknown>,
): ProjectTemplate {
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const levelRaw = raw.project_level_choices ?? raw.projectLevelChoices;
  const projectLevelChoices =
    levelRaw && typeof levelRaw === 'object' && !Array.isArray(levelRaw)
      ? (levelRaw as ProjectTemplate['projectLevelChoices'])
      : undefined;
  return {
    id: str(raw.id),
    name: str(raw.name),
    currency: str(raw.currency, 'MXN'),
    marginFactor: num(raw.margin_factor ?? raw.marginFactor, 1.35),
    laborFixedCost: num(raw.labor_fixed_cost ?? raw.laborFixedCost),
    projectLevelChoices:
      projectLevelChoices && Object.keys(projectLevelChoices).length > 0
        ? projectLevelChoices
        : undefined,
    measureDefaults: measureDefaultsFromApi(
      raw.measure_defaults ?? raw.measureDefaults,
    ),
    kitchenLayout: kitchenLayoutFromApi(
      raw.kitchen_layout ?? raw.kitchenLayout,
    ),
    installationChecklist: (() => {
      const rawList = raw.installation_checklist ?? raw.installationChecklist;
      if (!Array.isArray(rawList)) return undefined;
      const items = rawList as Record<string, unknown>[];
      const mapped = items.map((r) => ({
        id: str(r.id),
        label: str(r.label),
        done: Boolean(r.done),
      }));
      return mapped.length > 0 ? mapped : undefined;
    })(),
    notes: str(raw.notes) || undefined,
    items: itemsRaw.map((item) => {
      const r = item as Record<string, unknown>;
      const choices = r.option_choices ?? r.optionChoices;
      const baseModeTplRaw = str(r.base_mode ?? r.baseMode);
      const baseModeTpl = (
        ['none', 'plinth_board', 'plinth_strip', 'legs'] as const
      ).includes(baseModeTplRaw as never)
        ? (baseModeTplRaw as ProjectItem['baseMode'])
        : undefined;
      return {
        id: str(r.id),
        moduleId: str(r.module_id ?? r.moduleId),
        quantity: Math.max(1, Math.floor(num(r.quantity, 1))),
        optionChoices:
          choices && typeof choices === 'object' && !Array.isArray(choices)
            ? (choices as ProjectItem['optionChoices'])
            : {},
        measurePresetId:
          str(r.measure_preset_id ?? r.measurePresetId) || undefined,
        ...(baseModeTpl ? { baseMode: baseModeTpl } : {}),
      };
    }),
    createdAt: str(raw.created_at ?? raw.createdAt, ''),
    updatedAt: str(raw.updated_at ?? raw.updatedAt, ''),
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

export function agregadoToApi(a: import('@muebles/domain').Agregado): Record<string, unknown> {
  const dims = a.externalDims;
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    description: a.description ?? '',
    notes: a.notes ?? '',
    width_mm: dims?.width ?? 0,
    height_mm: dims?.height ?? 0,
    depth_mm: dims?.depth ?? 0,
    components: (a.components ?? []).map(componentInstanceToApi),
    hardware_lines: (a.hardwareLines ?? []).map(hardwareLineToApi),
    active: a.active !== false,
  };
}

export function agregadoFromApi(raw: Record<string, unknown>): import('@muebles/domain').Agregado {
  const componentsRaw = raw.components;
  const hardwareLinesRaw = raw.hardware_lines ?? raw.hardwareLines;
  const w = num(raw.width_mm ?? raw.widthMm);
  const h = num(raw.height_mm ?? raw.heightMm);
  const d = num(raw.depth_mm ?? raw.depthMm);
  const hasDims = w > 0 || h > 0 || d > 0;
  return {
    id: str(raw.id),
    code: str(raw.code),
    name: str(raw.name),
    description: str(raw.description) || undefined,
    notes: str(raw.notes) || undefined,
    externalDims: hasDims ? { width: w, height: h, depth: d } : undefined,
    components: Array.isArray(componentsRaw)
      ? (componentsRaw as Record<string, unknown>[]).map(componentInstanceFromApi)
      : [],
    hardwareLines: Array.isArray(hardwareLinesRaw)
      ? (hardwareLinesRaw as Record<string, unknown>[]).map(hardwareLineFromApi)
      : [],
    active: raw.active !== false,
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
  agregados?: unknown;
  ambientMaterials?: unknown;
  ambient_materials?: unknown;
  ambientCategories?: unknown;
  ambient_categories?: unknown;
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
    agregados: asRows(parts.agregados).map(agregadoFromApi),
    ambientMaterials: asRows(parts.ambient_materials ?? parts.ambientMaterials).map(
      ambientMaterialFromApi,
    ),
    ambientCategories: asRows(parts.ambient_categories ?? parts.ambientCategories).map(
      ambientCategoryFromApi,
    ),
  };
}

/** Parents before children so POST of new trees satisfies FK/placement. */
export function sortCategoriesForSave<T extends { id: string; parentId?: string }>(
  categories: readonly T[],
): T[] {
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

// --- Project Photos (CRM Gallery) ---

export function projectPhotoFromApi(raw: unknown): ProjectPhoto {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const stageRaw = str(r.stage, 'installed');
  const validStages: ProjectPhotoStage[] = [
    'survey',
    'in_workshop',
    'installed',
    'delivery_receipt',
  ];
  const stage = validStages.includes(stageRaw as ProjectPhotoStage)
    ? (stageRaw as ProjectPhotoStage)
    : 'installed';

  return {
    id: str(r.id),
    projectId: str(r.project_id ?? r.projectId),
    stage,
    url: str(r.url),
    thumbnailUrl:
      r.thumbnail_url || r.thumbnailUrl
        ? str(r.thumbnail_url ?? r.thumbnailUrl)
        : undefined,
    caption: r.caption ? str(r.caption) : undefined,
    isShowcase: bool(r.is_showcase ?? r.isShowcase, false),
    createdBy:
      r.created_by || r.createdBy
        ? str(r.created_by ?? r.createdBy)
        : undefined,
    createdAt: str(r.created_at ?? r.createdAt, new Date().toISOString()),
    updatedAt:
      r.updated_at || r.updatedAt ? str(r.updated_at ?? r.updatedAt) : undefined,
  };
}

export function projectPhotoToApi(p: ProjectPhoto): Record<string, unknown> {
  return {
    id: p.id,
    project_id: p.projectId,
    stage: p.stage,
    url: p.url,
    thumbnail_url: p.thumbnailUrl,
    caption: p.caption,
    is_showcase: p.isShowcase,
    created_by: p.createdBy,
  };
}

export function projectInternalMessageToApi(
  m: ProjectInternalMessage,
): Record<string, unknown> {
  return {
    id: m.id,
    project_id: m.projectId,
    sender_id: m.senderId ?? null,
    sender_name: m.senderName,
    message_type: m.messageType,
    content: m.content,
    is_resolved: m.isResolved,
    attachments: m.attachments ? [...m.attachments] : [],
    created_at: m.createdAt,
  };
}

export function projectInternalMessageFromApi(
  raw: Record<string, unknown>,
): ProjectInternalMessage {
  const attachRaw = raw.attachments;
  const validTypes: ProjectInternalMessageType[] = [
    'comment',
    'technical_query',
    'query_response',
    'design_change',
    'production_alert',
    'gate_approval',
  ];
  const typeRaw = str(raw.message_type ?? raw.messageType);
  const messageType = validTypes.includes(typeRaw as ProjectInternalMessageType)
    ? (typeRaw as ProjectInternalMessageType)
    : 'comment';

  return {
    id: str(raw.id),
    projectId: str(raw.project_id ?? raw.projectId),
    senderId: str(raw.sender_id ?? raw.senderId) || undefined,
    senderName: str(raw.sender_name ?? raw.senderName) || 'Usuario',
    messageType,
    content: str(raw.content),
    isResolved: bool(raw.is_resolved ?? raw.isResolved, true),
    attachments: Array.isArray(attachRaw) ? attachRaw.map(String) : undefined,
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
  };
}

// ---------------------------------------------------------------------------
// Warranty Desk Mappers (CRM Phase 3)
// ---------------------------------------------------------------------------

function refabricationPieceToApi(
  p: WarrantyRefabricationPiece,
): Record<string, unknown> {
  return {
    piece_description: p.pieceDescription,
    material_name: p.materialName,
    length_mm: p.lengthMm,
    width_mm: p.widthMm,
    quantity: p.quantity,
    grain: p.grain,
    L1: p.L1,
    L2: p.L2,
    W1: p.W1,
    W2: p.W2,
    part_name: p.partName ?? '',
    part_code: p.partCode ?? '',
    module_code: p.moduleCode ?? '',
    notes: p.notes ?? '',
  };
}

function refabricationPieceFromApi(
  raw: Record<string, unknown>,
): WarrantyRefabricationPiece {
  return {
    pieceDescription: str(raw.piece_description ?? raw.pieceDescription),
    materialName: str(raw.material_name ?? raw.materialName),
    lengthMm: num(raw.length_mm ?? raw.lengthMm),
    widthMm: num(raw.width_mm ?? raw.widthMm),
    quantity: num(raw.quantity, 1),
    grain: (num(raw.grain, 1) === 0 ? 0 : 1) as 0 | 1,
    L1: (num(raw.L1, 0) === 1 ? 1 : 0) as 0 | 1,
    L2: (num(raw.L2, 0) === 1 ? 1 : 0) as 0 | 1,
    W1: (num(raw.W1, 0) === 1 ? 1 : 0) as 0 | 1,
    W2: (num(raw.W2, 0) === 1 ? 1 : 0) as 0 | 1,
    partName: str(raw.part_name ?? raw.partName) || undefined,
    partCode: str(raw.part_code ?? raw.partCode) || undefined,
    moduleCode: str(raw.module_code ?? raw.moduleCode) || undefined,
    notes: str(raw.notes) || undefined,
  };
}

export function warrantyTicketPhotoToApi(
  p: WarrantyTicketPhoto,
): Record<string, unknown> {
  return {
    id: p.id,
    ticket_id: p.ticketId,
    kind: p.kind,
    url: p.url,
    thumbnail_url: p.thumbnailUrl,
    caption: p.caption ?? '',
    created_at: p.createdAt,
  };
}

export function warrantyTicketPhotoFromApi(
  raw: Record<string, unknown>,
): WarrantyTicketPhoto {
  const validKinds: WarrantyPhotoKind[] = ['issue_report', 'resolution_proof'];
  const kindRaw = str(raw.kind);
  const kind = validKinds.includes(kindRaw as WarrantyPhotoKind)
    ? (kindRaw as WarrantyPhotoKind)
    : 'issue_report';

  return {
    id: str(raw.id),
    ticketId: str(raw.ticket_id ?? raw.ticketId),
    kind,
    url: str(raw.url),
    thumbnailUrl: str(raw.thumbnail_url ?? raw.thumbnailUrl, str(raw.url)),
    caption: str(raw.caption) || undefined,
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
  };
}

export function warrantyTicketToApi(
  t: WarrantyTicket,
): Record<string, unknown> {
  return {
    id: t.id,
    ticket_number: t.ticketNumber,
    project_id: t.projectId,
    customer_id: t.customerId ?? null,
    title: t.title,
    description: t.description,
    category: t.category,
    priority: t.priority,
    status: t.status,
    assigned_technician_id: t.assignedTechnicianId ?? null,
    scheduled_date: t.scheduledDate ?? null,
    resolved_at: t.resolvedAt ?? null,
    resolution_notes: t.resolutionNotes ?? '',
    refabrication_pieces: (t.refabricationPieces ?? []).map(
      refabricationPieceToApi,
    ),
    photos: (t.photos ?? []).map(warrantyTicketPhotoToApi),
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

export function warrantyTicketFromApi(
  raw: Record<string, unknown>,
): WarrantyTicket {
  const validCategories: WarrantyTicketCategory[] = [
    'hardware_adjustment',
    'damaged_part',
    'finishing_defect',
    'installation_issue',
    'other',
  ];
  const validPriorities: WarrantyTicketPriority[] = ['low', 'normal', 'urgent'];
  const validStatuses: WarrantyTicketStatus[] = [
    'open',
    'visit_scheduled',
    'in_progress',
    'resolved',
    'cancelled',
  ];

  const catRaw = str(raw.category);
  const prioRaw = str(raw.priority);
  const statusRaw = str(raw.status);

  const category = validCategories.includes(catRaw as WarrantyTicketCategory)
    ? (catRaw as WarrantyTicketCategory)
    : 'other';
  const priority = validPriorities.includes(prioRaw as WarrantyTicketPriority)
    ? (prioRaw as WarrantyTicketPriority)
    : 'normal';
  const status = validStatuses.includes(statusRaw as WarrantyTicketStatus)
    ? (statusRaw as WarrantyTicketStatus)
    : 'open';

  const piecesRaw = raw.refabrication_pieces ?? raw.refabricationPieces;
  const pieces = Array.isArray(piecesRaw)
    ? piecesRaw.map((p) => refabricationPieceFromApi(p as Record<string, unknown>))
    : [];

  const photosRaw = raw.photos;
  const photos = Array.isArray(photosRaw)
    ? photosRaw.map((p) => warrantyTicketPhotoFromApi(p as Record<string, unknown>))
    : [];

  return {
    id: str(raw.id),
    ticketNumber: str(raw.ticket_number ?? raw.ticketNumber),
    projectId: str(raw.project_id ?? raw.projectId),
    customerId: str(raw.customer_id ?? raw.customerId) || undefined,
    title: str(raw.title),
    description: str(raw.description),
    category,
    priority,
    status,
    assignedTechnicianId:
      str(raw.assigned_technician_id ?? raw.assignedTechnicianId) || undefined,
    scheduledDate:
      str(raw.scheduled_date ?? raw.scheduledDate) || undefined,
    resolvedAt: str(raw.resolved_at ?? raw.resolvedAt) || undefined,
    resolutionNotes:
      str(raw.resolution_notes ?? raw.resolutionNotes) || undefined,
    refabricationPieces: pieces,
    photos,
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
    updatedAt: str(raw.updated_at ?? raw.updatedAt, new Date().toISOString()),
  };
}

// --- Compras / Almacén picking (Fase 3) ---

/**
 * Snake_case project picking row from the Go API → domain shape. The server
 * stamps marked_at/marked_by on despacho; the display name (marked_by_name,
 * joined from users) is the best available human label for `markedBy`.
 */
export function pickingStateFromApi(
  raw: Record<string, unknown>,
): ProjectPickingState {
  const material = str(raw.material);
  const status = str(raw.status, 'pendiente');
  return {
    projectId: str(raw.project_id ?? raw.projectId),
    material:
      material === 'tableros' || material === 'cintillas'
        ? material
        : 'herrajes',
    status: status === 'despachado' ? 'despachado' : 'pendiente',
    markedAt: str(raw.marked_at ?? raw.markedAt) || undefined,
    markedBy:
      str(raw.marked_by_name ?? raw.markedBy) ||
      str(raw.marked_by) ||
      undefined,
  };
}

// --- Compras / Almacén stock (Fase 3b) ---

/** Snake_case stock row from the Go API → domain shape. */
export function stockFromApi(raw: Record<string, unknown>): MaterialStock {
  const kind = str(raw.kind);
  return {
    kind: (kind === 'tableros' || kind === 'cintillas' ? kind : 'herrajes') as StockMaterialKind,
    materialId: str(raw.material_id ?? raw.materialId),
    quantity: num(raw.quantity),
    minStock: num(raw.min_stock ?? raw.minStock),
    updatedAt: str(raw.updated_at ?? raw.updatedAt) || undefined,
  };
}

/** Snake_case ledger row from the Go API → domain shape. */
export function stockMovementFromApi(
  raw: Record<string, unknown>,
): StockMovement {
  const kind = str(raw.kind);
  const type = str(raw.type);
  return {
    id: str(raw.id),
    kind: (kind === 'tableros' || kind === 'cintillas' ? kind : 'herrajes') as StockMaterialKind,
    materialId: str(raw.material_id ?? raw.materialId),
    type: (type === 'entrada' || type === 'salida' || type === 'ajuste'
      ? type
      : 'despacho') as StockMovementType,
    delta: num(raw.delta),
    balanceAfter: num(raw.balance_after ?? raw.balanceAfter),
    projectId: str(raw.project_id ?? raw.projectId) || undefined,
    note: str(raw.note) || undefined,
    revertsId: str(raw.reverts_id ?? raw.revertsId) || undefined,
    byUserId: str(raw.by_user_id ?? raw.byUserId),
    byName: str(raw.by_name ?? raw.byName) || undefined,
    at: str(raw.at, new Date().toISOString()),
  };
}

export function showcasePhotoItemFromApi(
  raw: Record<string, unknown>,
): ShowcasePhotoItem {
  const stage = (raw.stage as ProjectPhotoStage) || 'installed';
  return {
    id: str(raw.id),
    projectId: str(raw.project_id ?? raw.projectId),
    projectName: str(raw.project_name ?? raw.projectName),
    customerName: str(raw.customer_name ?? raw.customerName) || undefined,
    stage,
    url: str(raw.url),
    thumbnailUrl: str(raw.thumbnail_url ?? raw.thumbnailUrl) || undefined,
    caption: str(raw.caption) || undefined,
    isShowcase: bool(raw.is_showcase ?? raw.isShowcase),
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
  };
}





/** Snake_case supplier from the Go API → domain shape. */
export function supplierFromApi(raw: Record<string, unknown>): Supplier {
  return {
    id: str(raw.id),
    name: str(raw.name),
    contactName: str(raw.contact_name ?? raw.contactName) || undefined,
    email: str(raw.email) || undefined,
    phone: str(raw.phone) || undefined,
    notes: str(raw.notes) || undefined,
    active: bool(raw.active),
    createdAt: str(raw.created_at ?? raw.createdAt) || undefined,
    updatedAt: str(raw.updated_at ?? raw.updatedAt) || undefined,
  };
}

/** Camel-case domain supplier → snake_case API body. */
export function supplierToApi(sp: {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  active?: boolean;
}): Record<string, unknown> {
  return {
    id: sp.id,
    name: sp.name,
    contact_name: sp.contactName ?? '',
    email: sp.email ?? '',
    phone: sp.phone ?? '',
    notes: sp.notes ?? '',
    active: sp.active ?? true,
  };
}

/** Snake_case PO item from the Go API → domain shape. */
function poItemFromApi(raw: Record<string, unknown>): PurchaseOrderItem {
  const kind = str(raw.kind);
  return {
    kind: (kind === 'tableros' || kind === 'cintillas' ? kind : 'herrajes') as StockMaterialKind,
    materialId: str(raw.material_id ?? raw.materialId),
    quantity: num(raw.quantity),
    receivedQuantity: num(raw.received_quantity ?? raw.receivedQuantity),
  };
}

/** Snake_case purchase order from the Go API → domain shape. */
export function purchaseOrderFromApi(raw: Record<string, unknown>): PurchaseOrder {
  const status = str(raw.status);
  const items = Array.isArray(raw.items)
    ? raw.items
        .map((it) => poItemFromApi(it as Record<string, unknown>))
        .filter((it) => it.materialId !== '')
    : [];
  return {
    id: str(raw.id),
    number: str(raw.number),
    supplierId: str(raw.supplier_id ?? raw.supplierId),
    status: (status === 'borrador' || status === 'emitida' || status === 'recibida' || status === 'cancelada'
      ? status
      : 'borrador') as PurchaseOrderStatus,
    items,
    notes: str(raw.notes) || undefined,
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
    updatedAt: str(raw.updated_at ?? raw.updatedAt, new Date().toISOString()),
    receivedAt: str(raw.received_at ?? raw.receivedAt) || undefined,
    createdBy: str(raw.created_by ?? raw.createdBy) || undefined,
  };
}

/** Domain PO line → snake_case API body. */
export function poItemToApi(it: {
  kind: StockMaterialKind;
  materialId: string;
  quantity: number;
}): Record<string, unknown> {
  return {
    kind: it.kind,
    material_id: it.materialId,
    quantity: it.quantity,
  };
}
