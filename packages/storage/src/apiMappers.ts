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
  MaterialsRelease,
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
  CommercialStatus,
  ProjectEvent,
  ProjectEventSource,
  ProjectEventType,
  DesignRevision,
  Approval,
  ApprovalStatus,
  ApprovalType,
  ProductionRelease,
  ProductionReleaseCheck,
  ProductionReleaseCheckCode,
  ChangeOrder,
  ChangeOrderStatus,
  ChangeOrderImpact,
  PartInstance,
  PartOperation,
  PartOperationType,
  PartOperationStatus,
  PartInstanceStatus,
  ModuleUnitExecution,
  ModuleUnitStatus,
  SupervisorAssemblyOverride,
  InstallationJob,
  InstallationVisit,
  InstallationVisitStatus,
  InstallationVisitResult,
  FieldIssue,
  FieldIssueStatus,
  PunchItem,
  PunchItemStatus,
  PunchSeverity,
  ClientCloseout,
  MaterialPlanning,
  MaterialRequirementsSnapshot,
  MaterialRequirementLine,
  MaterialReservation,
  MaterialsReleaseEvidence,
  MaterialsReleaseCheck,
  MaterialsReleaseCheckCode,
  ProjectMaterialLineCoverage,
  MaterialAvailability,
  QualityJob,
  QualityIssue,
  QualityIssueStatus,
  QualityIssueCategory,
  ReworkAction,
  CostBaseline,
  CostTruth,
  JobCosting,
  JobCostSummary,
  MaterialCostValuation,
  MaterialValuationBasis,
  TimeEntry,
  OtherActualCost,
  SiteSurvey,
  SurveySpace,
  SurveyElement,
  SurveyGateBlocker,
  SpaceMeasures,
  UnitQcRecord,
  UnitQcChecklistItem,
  QcGateCheck,
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
import { TIME_ENTRY_CATEGORIES, OTHER_COST_KINDS } from '@muebles/domain';


import {
  normalizeHardwarePartFinishes,
  normalizeMachiningProfile,
  resolveWorkshopSettings,
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
/** Nullable string: empty/missing → undefined (camelCase optional fields). */
function optionalStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = typeof v === 'string' ? v : String(v);
  return s === '' ? undefined : s;
}

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
    preview_color: e.previewColor ?? '',
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
    previewColor: str(raw.preview_color ?? raw.previewColor) || undefined,
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
    // CNC machining footprint (F127); normalized so the payload always holds
    // a clean profile (null = cost-only hardware / legacy row).
    machining: normalizeMachiningProfile(h.machining) ?? null,
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
  const machining = normalizeMachiningProfile(raw.machining);
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
    // CNC machining footprint (F127) — sanitized on ingest.
    ...(machining ? { machining } : {}),
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
    // F129 joint drilling override; null = taller defaults.
    joint_drilling_rules: st.jointDrillingRules
      ? (JSON.parse(JSON.stringify(st.jointDrillingRules)) as Record<string, unknown>)
      : null,
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
  const jointRulesRaw = raw.joint_drilling_rules ?? raw.jointDrillingRules;
  const jointDrillingRules =
    jointRulesRaw && typeof jointRulesRaw === 'object' && !Array.isArray(jointRulesRaw)
      ? (jointRulesRaw as import('@muebles/domain').Structure['jointDrillingRules'])
      : undefined;
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
    jointDrillingRules,
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

function wallOpeningToApi(o: {
  id: string;
  kind: string;
  offsetMm: number;
  widthMm: number;
  heightMm?: number;
  sillMm?: number;
}): Record<string, unknown> {
  return {
    id: o.id,
    kind: o.kind,
    offset_mm: o.offsetMm,
    width_mm: o.widthMm,
    height_mm: o.heightMm === undefined ? null : o.heightMm,
    sill_mm: o.sillMm === undefined ? null : o.sillMm,
  };
}

function wallOpeningFromApi(o: unknown): {
  id: string;
  kind: 'window' | 'door' | 'pass';
  offsetMm: number;
  widthMm: number;
  heightMm?: number;
  sillMm?: number;
} | undefined {
  const or = o as Record<string, unknown>;
  const kind = str(or.kind);
  if (kind !== 'window' && kind !== 'door' && kind !== 'pass') return undefined;
  const height = or.height_mm ?? or.heightMm;
  const sill = or.sill_mm ?? or.sillMm;
  return {
    id: str(or.id),
    kind,
    offsetMm: num(or.offset_mm ?? or.offsetMm, 0),
    widthMm: num(or.width_mm ?? or.widthMm, 0),
    ...(height === null || height === undefined || height === ''
      ? {}
      : { heightMm: num(height) }),
    ...(sill === null || sill === undefined || sill === ''
      ? {}
      : { sillMm: num(sill) }),
  };
}

function kitchenWallToApi(w: {
  id: string;
  name?: string;
  lengthMm: number;
  angleDeg: number;
  originXMm?: number;
  originYMm?: number;
  wallMaterialId?: string;
  openings?: readonly {
    id: string;
    kind: string;
    offsetMm: number;
    widthMm: number;
    heightMm?: number;
    sillMm?: number;
  }[];
}): Record<string, unknown> {
  return {
    id: w.id,
    name: w.name ?? '',
    length_mm: w.lengthMm,
    angle_deg: w.angleDeg,
    origin_x_mm: w.originXMm ?? null,
    origin_y_mm: w.originYMm ?? null,
    wall_material_id: w.wallMaterialId ?? null,
    openings: (w.openings ?? []).map(wallOpeningToApi),
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
  openings?: readonly {
    id: string;
    kind: 'window' | 'door' | 'pass';
    offsetMm: number;
    widthMm: number;
    heightMm?: number;
    sillMm?: number;
  }[];
} {
  const wr = w as Record<string, unknown>;
  const ox = wr.origin_x_mm ?? wr.originXMm;
  const oy = wr.origin_y_mm ?? wr.originYMm;
  const wMatId = str(wr.wall_material_id ?? wr.wallMaterialId);
  const openings = (Array.isArray(wr.openings) ? wr.openings : [])
    .map(wallOpeningFromApi)
    .filter((o): o is NonNullable<typeof o> => o !== undefined);
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
    ...(openings.length > 0 ? { openings } : {}),
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
    // OC-011 — commercial status outcome
    commercial_status: p.commercialStatus ?? null,
    notes: p.notes ?? null,
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
    cut_plan: p.cutPlan ? JSON.parse(JSON.stringify(p.cutPlan)) : null,
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
    // Process stage gating — Almacén's explicit "materials complete" stamp.
    materials_release: p.materialsRelease
      ? {
          released_by: p.materialsRelease.releasedBy,
          released_at: p.materialsRelease.releasedAt,
        }
      : null,
    // OC-020 — design revisions
    design_revisions: p.designRevisions ? p.designRevisions.map(designRevisionToApi) : null,
    // OC-021 — multi-role approvals
    approvals: p.approvals ? p.approvals.map(approvalToApi) : null,
    // OC-022 — explicit production release record
    production_release: p.productionRelease ? productionReleaseToApi(p.productionRelease) : null,
    // OC-024 — change orders
    change_orders: p.changeOrders ? p.changeOrders.map(changeOrderToApi) : null,
    // OC-030 — physical part instances
    part_instances: p.partInstances ? p.partInstances.map(partInstanceToApi) : null,
    // OC-033 — physical module units
    module_units: p.moduleUnits ? p.moduleUnits.map(moduleUnitToApi) : null,
    // OC-070 — installation job (server ignores it on the aggregate PUT;
    // included so a GET roundtrip is lossless).
    installation: p.installation ? installationJobToApi(p.installation) : null,
    // OC-050..054 — material planning (server ignores it on the aggregate PUT;
    // the materials endpoints are the only writers).
    material_planning: p.materialPlanning ? materialPlanningToApi(p.materialPlanning) : null,
    // OC-060..062 — quality job (same: quality endpoints are the only writers).
    quality: p.quality ? qualityJobToApi(p.quality) : null,
    // OC-080..084 — job costing (same: costing endpoints are the only writers).
    costing: p.costing ? jobCostingToApi(p.costing) : null,
    // OC-040/041 — structured site survey (survey endpoints are the only writers).
    site_survey: p.siteSurvey ? siteSurveyToApi(p.siteSurvey) : null,
    // OC-010 — lifecycle append-only event stream
    events: (p.events ?? []).map((e) => projectEventToApi(e)),
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
    cutPlan: (() => {
      const rawCut = raw.cut_plan ?? raw.cutPlan;
      if (!rawCut || typeof rawCut !== 'object' || Array.isArray(rawCut)) return undefined;
      return rawCut as any;
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
    // Process stage gating — Almacén's materials release stamp.
    materialsRelease: materialsReleaseFromApi(
      raw.materials_release ?? raw.materialsRelease,
    ),
    // OC-020 — design revisions
    designRevisions: designRevisionsFromApi(raw.design_revisions ?? raw.designRevisions),
    // OC-021 — multi-role approvals
    approvals: approvalsFromApi(raw.approvals),
    // OC-022 — explicit production release record
    productionRelease: productionReleaseFromApi(raw.production_release ?? raw.productionRelease),
    // OC-024 — change orders
    changeOrders: changeOrdersFromApi(raw.change_orders ?? raw.changeOrders),
    // OC-030 — physical part instances
    partInstances: partInstancesFromApi(raw.part_instances ?? raw.partInstances),
    // OC-033 — physical module units
    moduleUnits: moduleUnitsFromApi(raw.module_units ?? raw.moduleUnits),
    // OC-070 — installation job (visits, field issues, punch, closeout)
    installation: installationJobFromApi(raw.installation),
    // OC-050..054 — material planning (requirements, reservations, release)
    materialPlanning: materialPlanningFromApi(raw.material_planning ?? raw.materialPlanning),
    // OC-060..062 — quality job (issues, rework actions, unit QC)
    quality: qualityJobFromApi(raw.quality),
    // OC-080..084 — job costing (baseline, time entries, other actuals)
    costing: jobCostingFromApi(raw.costing),
    // OC-040/041 — structured site survey (spaces, field measures, verification)
    siteSurvey: siteSurveyFromApi(raw.site_survey ?? raw.siteSurvey),
    // OC-011 — commercial status outcome
    commercialStatus: commercialStatusFromApi(
      raw.commercial_status ?? raw.commercialStatus,
    ),
    // OC-010 — lifecycle append-only event stream
    events: projectEventsFromApi(raw.events),
  };
}

export function designRevisionToApi(r: DesignRevision): Record<string, unknown> {
  return {
    id: r.id,
    project_id: r.projectId,
    revision: r.revision,
    name: r.name ?? null,
    description: r.description ?? null,
    bom_fingerprint: r.bomFingerprint,
    layout_snapshot: r.layoutSnapshot ?? null,
    created_by: r.createdBy,
    created_at: r.createdAt,
  };
}

export function designRevisionFromApi(raw: Record<string, unknown>): DesignRevision {
  return {
    id: str(raw.id),
    projectId: str(raw.project_id ?? raw.projectId),
    revision: Math.max(1, Math.floor(num(raw.revision, 1))),
    name: str(raw.name) || undefined,
    description: str(raw.description) || undefined,
    bomFingerprint: str(raw.bom_fingerprint ?? raw.bomFingerprint),
    layoutSnapshot: (raw.layout_snapshot ?? raw.layoutSnapshot) as DesignRevision['layoutSnapshot'],
    createdBy: str(raw.created_by ?? raw.createdBy),
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
  };
}

export function designRevisionsFromApi(raw: unknown): readonly DesignRevision[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((r) => r && typeof r === 'object')
    .map((r) => designRevisionFromApi(r as Record<string, unknown>));
}

export function approvalToApi(a: Approval): Record<string, unknown> {
  return {
    id: a.id,
    project_id: a.projectId,
    design_revision_id: a.designRevisionId ?? null,
    type: a.type,
    status: a.status,
    notes: a.notes ?? null,
    decided_by: a.decidedBy ?? null,
    decided_at: a.decidedAt ?? null,
    created_at: a.createdAt,
  };
}

export function approvalFromApi(raw: Record<string, unknown>): Approval {
  return {
    id: str(raw.id),
    projectId: str(raw.project_id ?? raw.projectId),
    designRevisionId: str(raw.design_revision_id ?? raw.designRevisionId) || undefined,
    type: str(raw.type, 'customer') as ApprovalType,
    status: str(raw.status, 'pending') as ApprovalStatus,
    notes: str(raw.notes) || undefined,
    decidedBy: str(raw.decided_by ?? raw.decidedBy) || undefined,
    decidedAt: str(raw.decided_at ?? raw.decidedAt) || undefined,
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
  };
}

export function approvalsFromApi(raw: unknown): readonly Approval[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((a) => a && typeof a === 'object')
    .map((a) => approvalFromApi(a as Record<string, unknown>));
}

export function productionReleaseToApi(pr: ProductionRelease): Record<string, unknown> {
  return {
    id: pr.id,
    project_id: pr.projectId,
    project_version: pr.projectVersion,
    design_revision_id: pr.designRevisionId,
    bom_fingerprint: pr.bomFingerprint,
    released_by: pr.releasedBy,
    released_at: pr.releasedAt,
    checks: pr.checks.map((c) => ({
      code: c.code,
      label: c.label,
      passed: c.passed,
      required: c.required,
      details: c.details ?? null,
    })),
    note: pr.note ?? null,
  };
}

export function productionReleaseFromApi(raw: unknown): ProductionRelease | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return undefined;
  const checksRaw = Array.isArray(r.checks) ? r.checks : [];
  const checks: ProductionReleaseCheck[] = checksRaw.map((check) => {
    const c = (check && typeof check === 'object' ? check : {}) as Record<string, unknown>;
    return {
      code: str(c.code) as ProductionReleaseCheckCode,
      label: str(c.label),
      passed: Boolean(c.passed),
      required: Boolean(c.required),
      details: str(c.details) || undefined,
    };
  });
  return {
    id,
    projectId: str(r.project_id ?? r.projectId),
    projectVersion: Math.max(1, Math.floor(num(r.project_version ?? r.projectVersion, 1))),
    designRevisionId: str(r.design_revision_id ?? r.designRevisionId),
    bomFingerprint: str(r.bom_fingerprint ?? r.bomFingerprint),
    releasedBy: str(r.released_by ?? r.releasedBy),
    releasedAt: str(r.released_at ?? r.releasedAt, new Date().toISOString()),
    checks,
    note: str(r.note) || undefined,
  };
}

export function changeOrderToApi(co: ChangeOrder): Record<string, unknown> {
  return {
    id: co.id,
    project_id: co.projectId,
    number: co.number,
    status: co.status,
    reason: co.reason,
    description: co.description ?? null,
    impact: co.impact
      ? {
          cost_delta: co.impact.costDelta ?? null,
          price_delta: co.impact.priceDelta ?? null,
          lead_time_days_delta: co.impact.leadTimeDaysDelta ?? null,
          scope_description: co.impact.scopeDescription ?? null,
        }
      : null,
    previous_bom_fingerprint: co.previousBomFingerprint,
    new_bom_fingerprint: co.newBomFingerprint ?? null,
    previous_design_revision_id: co.previousDesignRevisionId ?? null,
    new_design_revision_id: co.newDesignRevisionId ?? null,
    requested_by: co.requestedBy,
    requested_at: co.requestedAt,
    decided_by: co.decidedBy ?? null,
    decided_at: co.decidedAt ?? null,
    decision_notes: co.decisionNotes ?? null,
    created_at: co.createdAt,
  };
}

export function changeOrderFromApi(raw: Record<string, unknown>): ChangeOrder {
  const impactRaw = raw.impact as Record<string, unknown> | undefined;
  const costDelta = impactRaw?.cost_delta ?? impactRaw?.costDelta;
  const priceDelta = impactRaw?.price_delta ?? impactRaw?.priceDelta;
  const leadTimeDelta = impactRaw?.lead_time_days_delta ?? impactRaw?.leadTimeDaysDelta;
  const scopeDesc = str(impactRaw?.scope_description ?? impactRaw?.scopeDescription);

  const impact: ChangeOrderImpact | undefined =
    impactRaw && typeof impactRaw === 'object'
      ? {
          costDelta: costDelta === null || costDelta === undefined || costDelta === '' ? undefined : num(costDelta),
          priceDelta: priceDelta === null || priceDelta === undefined || priceDelta === '' ? undefined : num(priceDelta),
          leadTimeDaysDelta:
            leadTimeDelta === null || leadTimeDelta === undefined || leadTimeDelta === ''
              ? undefined
              : Math.floor(num(leadTimeDelta)),
          scopeDescription: scopeDesc || undefined,
        }
      : undefined;

  return {
    id: str(raw.id),
    projectId: str(raw.project_id ?? raw.projectId),
    number: Math.max(1, Math.floor(num(raw.number, 1))),
    status: str(raw.status, 'draft') as ChangeOrderStatus,
    reason: str(raw.reason),
    description: str(raw.description) || undefined,
    impact,
    previousBomFingerprint: str(raw.previous_bom_fingerprint ?? raw.previousBomFingerprint),
    newBomFingerprint: str(raw.new_bom_fingerprint ?? raw.newBomFingerprint) || undefined,
    previousDesignRevisionId:
      str(raw.previous_design_revision_id ?? raw.previousDesignRevisionId) || undefined,
    newDesignRevisionId: str(raw.new_design_revision_id ?? raw.newDesignRevisionId) || undefined,
    requestedBy: str(raw.requested_by ?? raw.requestedBy),
    requestedAt: str(raw.requested_at ?? raw.requestedAt, new Date().toISOString()),
    decidedBy: str(raw.decided_by ?? raw.decidedBy) || undefined,
    decidedAt: str(raw.decided_at ?? raw.decidedAt) || undefined,
    decisionNotes: str(raw.decision_notes ?? raw.decisionNotes) || undefined,
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
  };
}

export function changeOrdersFromApi(raw: unknown): readonly ChangeOrder[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((r) => r && typeof r === 'object')
    .map((r) => changeOrderFromApi(r as Record<string, unknown>));
}

// ─── PartInstance & PartOperation (OC-030..OC-031) ──────────────────────────

export function partOperationToApi(op: PartOperation): Record<string, unknown> {
  return {
    id: op.id,
    type: op.type,
    sequence: op.sequence,
    status: op.status,
    started_at: op.startedAt ?? null,
    completed_at: op.completedAt ?? null,
    operator_id: op.operatorId ?? null,
    operator_name: op.operatorName ?? null,
    machine_id: op.machineId ?? null,
    notes: op.notes ?? null,
  };
}

export function partOperationFromApi(raw: Record<string, unknown>): PartOperation {
  return {
    id: str(raw.id),
    type: str(raw.type, 'cut') as PartOperationType,
    sequence: Math.max(1, Math.floor(num(raw.sequence, 1))),
    status: str(raw.status, 'queued') as PartOperationStatus,
    startedAt: str(raw.started_at ?? raw.startedAt) || undefined,
    completedAt: str(raw.completed_at ?? raw.completedAt) || undefined,
    operatorId: str(raw.operator_id ?? raw.operatorId) || undefined,
    operatorName: str(raw.operator_name ?? raw.operatorName) || undefined,
    machineId: str(raw.machine_id ?? raw.machineId) || undefined,
    notes: str(raw.notes) || undefined,
  };
}

export function partInstanceToApi(p: PartInstance): Record<string, unknown> {
  return {
    id: p.id,
    project_id: p.projectId,
    production_revision: p.productionRevision,
    project_item_id: p.projectItemId,
    unit_index: p.unitIndex,
    part_code: p.partCode,
    part_definition_id: p.partDefinitionId ?? null,
    description: p.description,
    material_id: p.materialId,
    length_mm: p.lengthMm,
    width_mm: p.widthMm,
    thickness_mm: p.thicknessMm,
    grain: p.grain,
    edges: p.edges.map((e) => ({ side: e.side, enabled: e.enabled })),
    required_operations: p.requiredOperations.map(partOperationToApi),
    current_operation_index: p.currentOperationIndex,
    status: p.status,
  };
}

export function partInstanceFromApi(raw: Record<string, unknown>): PartInstance {
  const edgesRaw = Array.isArray(raw.edges) ? raw.edges : [];
  const opsRaw = Array.isArray(raw.required_operations ?? raw.requiredOperations)
    ? (raw.required_operations ?? raw.requiredOperations)
    : [];

  return {
    id: str(raw.id),
    projectId: str(raw.project_id ?? raw.projectId),
    productionRevision: str(raw.production_revision ?? raw.productionRevision, 'rev-1'),
    projectItemId: str(raw.project_item_id ?? raw.projectItemId),
    unitIndex: Math.max(1, Math.floor(num(raw.unit_index ?? raw.unitIndex, 1))),
    partCode: str(raw.part_code ?? raw.partCode),
    partDefinitionId: str(raw.part_definition_id ?? raw.partDefinitionId) || undefined,
    description: str(raw.description),
    materialId: str(raw.material_id ?? raw.materialId),
    lengthMm: num(raw.length_mm ?? raw.lengthMm),
    widthMm: num(raw.width_mm ?? raw.widthMm),
    thicknessMm: num(raw.thickness_mm ?? raw.thicknessMm, 18),
    grain: (num(raw.grain) === 1 ? 1 : 0) as 0 | 1,
    edges: edgesRaw.map((e: any) => ({ side: str(e.side, 'L1') as any, enabled: bool(e.enabled) })),
    requiredOperations: (opsRaw as Record<string, unknown>[]).map(partOperationFromApi),
    currentOperationIndex: Math.max(0, Math.floor(num(raw.current_operation_index ?? raw.currentOperationIndex))),
    status: str(raw.status, 'pending') as PartInstanceStatus,
  };
}

export function partInstancesFromApi(raw: unknown): readonly PartInstance[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((r) => r && typeof r === 'object')
    .map((r) => partInstanceFromApi(r as Record<string, unknown>));
}

// ─── ModuleUnitExecution (OC-033) ───────────────────────────────────────────

export function moduleUnitToApi(u: ModuleUnitExecution): Record<string, unknown> {
  return {
    id: u.id,
    project_id: u.projectId,
    project_item_id: u.projectItemId,
    unit_index: u.unitIndex,
    production_revision: u.productionRevision,
    status: u.status,
    package_count: u.packageCount ?? null,
    supervisor_override: u.supervisorOverride
      ? {
          overridden_by: u.supervisorOverride.overriddenBy,
          overridden_at: u.supervisorOverride.overriddenAt,
          reason: u.supervisorOverride.reason,
          missing_parts_count: u.supervisorOverride.missingPartsCount,
        }
      : null,
    assembled_at: u.assembledAt ?? null,
    qc_passed_at: u.qcPassedAt ?? null,
    packaged_at: u.packagedAt ?? null,
    loaded_at: u.loadedAt ?? null,
    installed_at: u.installedAt ?? null,
    notes: u.notes ?? null,
  };
}

export function moduleUnitFromApi(raw: Record<string, unknown>): ModuleUnitExecution {
  const pkgCount = raw.package_count ?? raw.packageCount;
  const overrideRaw =
    (raw.supervisor_override ?? raw.supervisorOverride) as Record<string, unknown> | null | undefined;
  return {
    id: str(raw.id),
    projectId: str(raw.project_id ?? raw.projectId),
    projectItemId: str(raw.project_item_id ?? raw.projectItemId),
    unitIndex: Math.max(1, Math.floor(num(raw.unit_index ?? raw.unitIndex, 1))),
    productionRevision: str(raw.production_revision ?? raw.productionRevision, 'rev-1'),
    status: str(raw.status, 'awaiting_parts') as ModuleUnitStatus,
    packageCount: pkgCount === null || pkgCount === undefined || pkgCount === '' ? undefined : num(pkgCount),
    supervisorOverride:
      overrideRaw && typeof overrideRaw === 'object'
        ? {
            overriddenBy: str(overrideRaw.overridden_by ?? overrideRaw.overriddenBy),
            overriddenAt: str(overrideRaw.overridden_at ?? overrideRaw.overriddenAt),
            reason: str(overrideRaw.reason),
            missingPartsCount: Math.max(0, Math.floor(num(overrideRaw.missing_parts_count ?? overrideRaw.missingPartsCount, 0))),
          }
        : undefined,
    assembledAt: str(raw.assembled_at ?? raw.assembledAt) || undefined,
    qcPassedAt: str(raw.qc_passed_at ?? raw.qcPassedAt) || undefined,
    packagedAt: str(raw.packaged_at ?? raw.packagedAt) || undefined,
    loadedAt: str(raw.loaded_at ?? raw.loadedAt) || undefined,
    installedAt: str(raw.installed_at ?? raw.installedAt) || undefined,
    notes: str(raw.notes) || undefined,
  };
}

export function moduleUnitsFromApi(raw: unknown): readonly ModuleUnitExecution[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((r) => r && typeof r === 'object')
    .map((r) => moduleUnitFromApi(r as Record<string, unknown>));
}

// ─── InstallationJob (OC-070..OC-074) ───────────────────────────────────────

export function installationVisitToApi(v: InstallationVisit): Record<string, unknown> {
  return {
    id: v.id,
    date: v.date,
    crew: v.crew,
    arrival_at: v.arrivalAt ?? null,
    start_at: v.startAt ?? null,
    end_at: v.endAt ?? null,
    notes: v.notes ?? null,
    photo_ids: v.photoIds ?? null,
    unit_ids: v.unitIds ?? null,
    status: v.status,
    result: v.result ?? null,
    result_notes: v.resultNotes ?? null,
    created_at: v.createdAt,
  };
}

export function installationVisitFromApi(raw: Record<string, unknown>): InstallationVisit {
  const crewRaw = Array.isArray(raw.crew) ? raw.crew : [];
  const photoIds = raw.photo_ids ?? raw.photoIds;
  const unitIds = raw.unit_ids ?? raw.unitIds;
  return {
    id: str(raw.id),
    date: str(raw.date),
    crew: crewRaw.map((c) => str(c)).filter(Boolean),
    arrivalAt: str(raw.arrival_at ?? raw.arrivalAt) || undefined,
    startAt: str(raw.start_at ?? raw.startAt) || undefined,
    endAt: str(raw.end_at ?? raw.endAt) || undefined,
    notes: str(raw.notes) || undefined,
    photoIds: Array.isArray(photoIds) ? photoIds.map((p) => str(p)) : undefined,
    unitIds: Array.isArray(unitIds) ? unitIds.map((u) => str(u)) : undefined,
    status: str(raw.status, 'scheduled') as InstallationVisitStatus,
    result: (str(raw.result) || undefined) as InstallationVisitResult | undefined,
    resultNotes: str(raw.result_notes ?? raw.resultNotes) || undefined,
    createdAt: str(raw.created_at ?? raw.createdAt),
  };
}

export function fieldIssueToApi(i: FieldIssue): Record<string, unknown> {
  return {
    id: i.id,
    description: i.description,
    status: i.status,
    project_item_id: i.projectItemId ?? null,
    part_instance_id: i.partInstanceId ?? null,
    photo_ids: i.photoIds ?? null,
    notes: i.notes ?? null,
    reported_by: i.reportedBy ?? null,
    reported_at: i.reportedAt,
    resolved_at: i.resolvedAt ?? null,
    resolved_by: i.resolvedBy ?? null,
    resolution_notes: i.resolutionNotes ?? null,
    verified_at: i.verifiedAt ?? null,
    verified_by: i.verifiedBy ?? null,
  };
}

export function fieldIssueFromApi(raw: Record<string, unknown>): FieldIssue {
  const photoIds = raw.photo_ids ?? raw.photoIds;
  return {
    id: str(raw.id),
    description: str(raw.description),
    status: str(raw.status, 'open') as FieldIssueStatus,
    projectItemId: str(raw.project_item_id ?? raw.projectItemId) || undefined,
    partInstanceId: str(raw.part_instance_id ?? raw.partInstanceId) || undefined,
    photoIds: Array.isArray(photoIds) ? photoIds.map((p) => str(p)) : undefined,
    notes: str(raw.notes) || undefined,
    reportedBy: str(raw.reported_by ?? raw.reportedBy) || undefined,
    reportedAt: str(raw.reported_at ?? raw.reportedAt),
    resolvedAt: str(raw.resolved_at ?? raw.resolvedAt) || undefined,
    resolvedBy: str(raw.resolved_by ?? raw.resolvedBy) || undefined,
    resolutionNotes: str(raw.resolution_notes ?? raw.resolutionNotes) || undefined,
    verifiedAt: str(raw.verified_at ?? raw.verifiedAt) || undefined,
    verifiedBy: str(raw.verified_by ?? raw.verifiedBy) || undefined,
  };
}

export function punchItemToApi(p: PunchItem): Record<string, unknown> {
  return {
    id: p.id,
    description: p.description,
    owner: p.owner,
    due_date: p.dueDate ?? null,
    severity: p.severity,
    is_blocker: p.isBlocker,
    status: p.status,
    photo_ids: p.photoIds ?? null,
    opened_by: p.openedBy ?? null,
    opened_at: p.openedAt,
    closed_at: p.closedAt ?? null,
    closed_by: p.closedBy ?? null,
    resolution_notes: p.resolutionNotes ?? null,
    resolution_photo_ids: p.resolutionPhotoIds ?? null,
  };
}

export function punchItemFromApi(raw: Record<string, unknown>): PunchItem {
  const photoIds = raw.photo_ids ?? raw.photoIds;
  const resolutionPhotoIds = raw.resolution_photo_ids ?? raw.resolutionPhotoIds;
  return {
    id: str(raw.id),
    description: str(raw.description),
    owner: str(raw.owner),
    dueDate: str(raw.due_date ?? raw.dueDate) || undefined,
    severity: str(raw.severity, 'minor') as PunchSeverity,
    isBlocker: Boolean(raw.is_blocker ?? raw.isBlocker),
    status: str(raw.status, 'open') as PunchItemStatus,
    photoIds: Array.isArray(photoIds) ? photoIds.map((p) => str(p)) : undefined,
    openedBy: str(raw.opened_by ?? raw.openedBy) || undefined,
    openedAt: str(raw.opened_at ?? raw.openedAt),
    closedAt: str(raw.closed_at ?? raw.closedAt) || undefined,
    closedBy: str(raw.closed_by ?? raw.closedBy) || undefined,
    resolutionNotes: str(raw.resolution_notes ?? raw.resolutionNotes) || undefined,
    resolutionPhotoIds: Array.isArray(resolutionPhotoIds)
      ? resolutionPhotoIds.map((p) => str(p))
      : undefined,
  };
}

export function clientCloseoutToApi(c: ClientCloseout): Record<string, unknown> {
  return {
    signed_off_by: c.signedOffBy,
    signed_off_at: c.signedOffAt,
    signed_off_by_user_id: c.signedOffByUserId ?? null,
    signed_off_notes: c.signedOffNotes ?? null,
    signed_off_photo_ids: c.signedOffPhotoIds ?? null,
    closed_at: c.closedAt ?? null,
    closed_by_user_id: c.closedByUserId ?? null,
  };
}

export function clientCloseoutFromApi(raw: Record<string, unknown> | null | undefined): ClientCloseout | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const photoIds = raw.signed_off_photo_ids ?? raw.signedOffPhotoIds;
  return {
    signedOffBy: str(raw.signed_off_by ?? raw.signedOffBy),
    signedOffAt: str(raw.signed_off_at ?? raw.signedOffAt),
    signedOffByUserId: str(raw.signed_off_by_user_id ?? raw.signedOffByUserId) || undefined,
    signedOffNotes: str(raw.signed_off_notes ?? raw.signedOffNotes) || undefined,
    signedOffPhotoIds: Array.isArray(photoIds) ? photoIds.map((p) => str(p)) : undefined,
    closedAt: str(raw.closed_at ?? raw.closedAt) || undefined,
    closedByUserId: str(raw.closed_by_user_id ?? raw.closedByUserId) || undefined,
  };
}

export function installationJobToApi(j: InstallationJob): Record<string, unknown> {
  return {
    id: j.id,
    project_id: j.projectId,
    visits: j.visits.map(installationVisitToApi),
    field_issues: j.fieldIssues.map(fieldIssueToApi),
    punch_items: j.punchItems.map(punchItemToApi),
    closeout: j.closeout ? clientCloseoutToApi(j.closeout) : null,
    created_at: j.createdAt,
  };
}

export function installationJobFromApi(raw: unknown): InstallationJob | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const visits: readonly unknown[] = Array.isArray(rec.visits) ? rec.visits : [];
  const issues: readonly unknown[] = Array.isArray(rec.field_issues ?? rec.fieldIssues)
    ? ((rec.field_issues ?? rec.fieldIssues) as readonly unknown[])
    : [];
  const punches: readonly unknown[] = Array.isArray(rec.punch_items ?? rec.punchItems)
    ? ((rec.punch_items ?? rec.punchItems) as readonly unknown[])
    : [];
  return {
    id: str(rec.id),
    projectId: str(rec.project_id ?? rec.projectId),
    visits: visits.map((v) => installationVisitFromApi(v as Record<string, unknown>)),
    fieldIssues: issues.map((i) => fieldIssueFromApi(i as Record<string, unknown>)),
    punchItems: punches.map((p) => punchItemFromApi(p as Record<string, unknown>)),
    closeout: clientCloseoutFromApi(rec.closeout as Record<string, unknown> | null | undefined),
    createdAt: str(rec.created_at ?? rec.createdAt),
  };
}

// ─── Material planning (OC-050..OC-054) ──────────────────────────────────────

function requirementLineFromApi(raw: Record<string, unknown>): MaterialRequirementLine {
  const kind = str(raw.kind);
  return {
    kind: (kind === 'tableros' || kind === 'cintillas' ? kind : 'herrajes') as MaterialRequirementLine['kind'],
    materialId: str(raw.material_id ?? raw.materialId),
    quantity: num(raw.quantity),
  };
}

function materialReservationFromApi(raw: Record<string, unknown>): MaterialReservation {
  const status = str(raw.status);
  return {
    id: str(raw.id),
    kind: (str(raw.kind) === 'tableros' || str(raw.kind) === 'cintillas' ? str(raw.kind) : 'herrajes') as MaterialReservation['kind'],
    materialId: str(raw.material_id ?? raw.materialId),
    quantity: num(raw.quantity),
    status: (['active', 'released', 'consumed'].includes(status) ? status : 'active') as MaterialReservation['status'],
    reservedBy: str(raw.reserved_by ?? raw.reservedBy) || undefined,
    reservedAt: str(raw.reserved_at ?? raw.reservedAt),
    releasedAt: str(raw.released_at ?? raw.releasedAt) || undefined,
    consumedAt: str(raw.consumed_at ?? raw.consumedAt) || undefined,
  };
}

export function materialPlanningFromApi(raw: unknown): MaterialPlanning | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const requirementsRaw = rec.requirements as Record<string, unknown> | null | undefined;
  const lines: readonly unknown[] = Array.isArray(requirementsRaw?.lines) ? requirementsRaw.lines : [];
  const reservations: readonly unknown[] = Array.isArray(rec.reservations) ? rec.reservations : [];
  const releaseRaw = rec.release as Record<string, unknown> | null | undefined;
  const overrideRaw = releaseRaw?.override as Record<string, unknown> | null | undefined;
  const requirements: MaterialRequirementsSnapshot | undefined = requirementsRaw
    ? {
        releaseId: str(requirementsRaw.release_id ?? requirementsRaw.releaseId) || undefined,
        bomFingerprint: str(requirementsRaw.bom_fingerprint ?? requirementsRaw.bomFingerprint) || undefined,
        derivedAt: str(requirementsRaw.derived_at ?? requirementsRaw.derivedAt),
        derivedBy: str(requirementsRaw.derived_by ?? requirementsRaw.derivedBy) || undefined,
        lines: lines.map((l) => requirementLineFromApi(l as Record<string, unknown>)),
      }
    : undefined;
  const overrideFailing = Array.isArray(overrideRaw?.failing_checks ?? overrideRaw?.failingChecks)
    ? (((overrideRaw?.failing_checks ?? overrideRaw?.failingChecks) as readonly string[]).filter(
        (c): c is MaterialsReleaseCheckCode =>
          c === 'requirements_derived' || c === 'lines_reserved' || c === 'reservations_backed',
      ) as readonly MaterialsReleaseCheckCode[])
    : [];
  const release: MaterialsReleaseEvidence | undefined = releaseRaw
    ? {
        releasedBy: str(releaseRaw.released_by ?? releaseRaw.releasedBy) || undefined,
        releasedAt: str(releaseRaw.released_at ?? releaseRaw.releasedAt),
        override: overrideRaw
          ? {
              reason: str(overrideRaw.reason),
              byUserId: str(overrideRaw.by_user_id ?? overrideRaw.byUserId) || undefined,
              at: str(overrideRaw.at),
              failingChecks: overrideFailing,
            }
          : undefined,
      }
    : undefined;
  return {
    id: str(rec.id),
    projectId: str(rec.project_id ?? rec.projectId),
    requirements,
    reservations: reservations.map((r) => materialReservationFromApi(r as Record<string, unknown>)),
    release,
    createdAt: str(rec.created_at ?? rec.createdAt),
  };
}

export function materialPlanningToApi(p: MaterialPlanning): Record<string, unknown> {
  return {
    id: p.id,
    project_id: p.projectId,
    requirements: p.requirements
      ? {
          release_id: p.requirements.releaseId,
          bom_fingerprint: p.requirements.bomFingerprint,
          derived_at: p.requirements.derivedAt,
          derived_by: p.requirements.derivedBy,
          lines: p.requirements.lines.map((l) => ({ kind: l.kind, material_id: l.materialId, quantity: l.quantity })),
        }
      : null,
    reservations: p.reservations.map((r) => ({
      id: r.id,
      kind: r.kind,
      material_id: r.materialId,
      quantity: r.quantity,
      status: r.status,
      reserved_by: r.reservedBy,
      reserved_at: r.reservedAt,
      released_at: r.releasedAt,
      consumed_at: r.consumedAt,
    })),
    release: p.release
      ? {
          released_by: p.release.releasedBy,
          released_at: p.release.releasedAt,
          override: p.release.override
            ? {
                reason: p.release.override.reason,
                by_user_id: p.release.override.byUserId,
                at: p.release.override.at,
                failing_checks: p.release.override.failingChecks,
              }
            : null,
        }
      : null,
    created_at: p.createdAt,
  };
}

export function releaseChecksFromApi(raw: unknown): readonly MaterialsReleaseCheck[] {
  if (!Array.isArray(raw)) return [];
  return (raw as readonly Record<string, unknown>[]).map((c) => ({
    code: str(c.code) as MaterialsReleaseCheckCode,
    label: str(c.label),
    passed: Boolean(c.passed),
    required: Boolean(c.required),
    details: str(c.details),
  }));
}

export function materialCoverageFromApi(raw: unknown): readonly ProjectMaterialLineCoverage[] {
  if (!Array.isArray(raw)) return [];
  return (raw as readonly Record<string, unknown>[]).map((l) => {
    const kind = str(l.kind);
    return {
      kind: (kind === 'tableros' || kind === 'cintillas' ? kind : 'herrajes') as ProjectMaterialLineCoverage['kind'],
      materialId: str(l.material_id ?? l.materialId),
      required: num(l.required),
      reserved: num(l.reserved),
      pendingReserve: num(l.pending_reserve ?? l.pendingReserve),
      available: num(l.available),
      incomingAllocated: num(l.incoming_allocated ?? l.incomingAllocated),
      shortage: num(l.shortage),
      covered: Boolean(l.covered),
    };
  });
}

export function materialAvailabilityFromApi(raw: unknown): readonly MaterialAvailability[] {
  if (!Array.isArray(raw)) return [];
  return (raw as readonly Record<string, unknown>[]).map((l) => {
    const kind = str(l.kind);
    return {
      kind: (kind === 'tableros' || kind === 'cintillas' ? kind : 'herrajes') as MaterialAvailability['kind'],
      materialId: str(l.material_id ?? l.materialId),
      onHand: num(l.on_hand ?? l.onHand),
      reserved: num(l.reserved),
      available: num(l.available),
      incoming: num(l.incoming),
      required: num(l.required),
      shortage: num(l.shortage),
    };
  });
}

// ─── Quality job (OC-060..OC-062) ─────────────────────────────────────────────

function qualityIssueFromApi(raw: Record<string, unknown>): QualityIssue {
  return {
    id: str(raw.id),
    description: str(raw.description),
    category: str(raw.category) as QualityIssueCategory,
    status: str(raw.status) as QualityIssueStatus,
    projectItemId: str(raw.project_item_id ?? raw.projectItemId) || undefined,
    partInstanceId: str(raw.part_instance_id ?? raw.partInstanceId) || undefined,
    moduleUnitId: str(raw.module_unit_id ?? raw.moduleUnitId) || undefined,
    station: (str(raw.station) || undefined) as QualityIssue['station'],
    photoIds: Array.isArray(raw.photo_ids ?? raw.photoIds) ? ((raw.photo_ids ?? raw.photoIds) as readonly string[]) : undefined,
    notes: str(raw.notes) || undefined,
    reportedBy: str(raw.reported_by ?? raw.reportedBy) || undefined,
    reportedAt: str(raw.reported_at ?? raw.reportedAt),
    resolvedAt: str(raw.resolved_at ?? raw.resolvedAt) || undefined,
    resolvedBy: str(raw.resolved_by ?? raw.resolvedBy) || undefined,
    resolutionNotes: str(raw.resolution_notes ?? raw.resolutionNotes) || undefined,
    verifiedAt: str(raw.verified_at ?? raw.verifiedAt) || undefined,
    verifiedBy: str(raw.verified_by ?? raw.verifiedBy) || undefined,
  };
}

function reworkActionFromApi(raw: Record<string, unknown>): ReworkAction {
  return {
    id: str(raw.id),
    issueId: str(raw.issue_id ?? raw.issueId),
    action: str(raw.action) as ReworkAction['action'],
    reason: str(raw.reason) || undefined,
    materialCost: num(raw.material_cost ?? raw.materialCost),
    laborMinutes: num(raw.labor_minutes ?? raw.laborMinutes),
    partInstanceId: str(raw.part_instance_id ?? raw.partInstanceId) || undefined,
    byUserId: str(raw.by_user_id ?? raw.byUserId) || undefined,
    at: str(raw.at),
  };
}

function unitQcRecordFromApi(raw: Record<string, unknown>): UnitQcRecord {
  const overrideRaw = raw.override as Record<string, unknown> | null | undefined;
  const checklist: readonly unknown[] = Array.isArray(raw.checklist) ? raw.checklist : [];
  return {
    unitId: str(raw.unit_id ?? raw.unitId),
    checklist: checklist.map((c) => {
      const item = c as Record<string, unknown>;
      return { code: str(item.code) as UnitQcChecklistItem['code'], passed: Boolean(item.passed) };
    }),
    passedAt: str(raw.passed_at ?? raw.passedAt) || undefined,
    passedBy: str(raw.passed_by ?? raw.passedBy) || undefined,
    notes: str(raw.notes) || undefined,
    photoIds: Array.isArray(raw.photo_ids ?? raw.photoIds) ? ((raw.photo_ids ?? raw.photoIds) as readonly string[]) : undefined,
    override: overrideRaw
      ? {
          reason: str(overrideRaw.reason),
          byUserId: str(overrideRaw.by_user_id ?? overrideRaw.byUserId) || undefined,
          at: str(overrideRaw.at),
        }
      : undefined,
  };
}

export function qualityJobFromApi(raw: unknown): QualityJob | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const issues: readonly unknown[] = Array.isArray(rec.issues) ? rec.issues : [];
  const actions: readonly unknown[] = Array.isArray(rec.rework_actions ?? rec.reworkActions)
    ? ((rec.rework_actions ?? rec.reworkActions) as readonly unknown[])
    : [];
  const unitQc: readonly unknown[] = Array.isArray(rec.unit_qc ?? rec.unitQc)
    ? ((rec.unit_qc ?? rec.unitQc) as readonly unknown[])
    : [];
  return {
    id: str(rec.id),
    projectId: str(rec.project_id ?? rec.projectId),
    issues: issues.map((i) => qualityIssueFromApi(i as Record<string, unknown>)),
    reworkActions: actions.map((a) => reworkActionFromApi(a as Record<string, unknown>)),
    unitQc: unitQc.map((u) => unitQcRecordFromApi(u as Record<string, unknown>)),
    createdAt: str(rec.created_at ?? rec.createdAt),
  };
}

export function qualityJobToApi(j: QualityJob): Record<string, unknown> {
  return {
    id: j.id,
    project_id: j.projectId,
    issues: j.issues.map((i) => ({
      id: i.id,
      description: i.description,
      category: i.category,
      status: i.status,
      project_item_id: i.projectItemId,
      part_instance_id: i.partInstanceId,
      module_unit_id: i.moduleUnitId,
      station: i.station,
      photo_ids: i.photoIds,
      notes: i.notes,
      reported_by: i.reportedBy,
      reported_at: i.reportedAt,
      resolved_at: i.resolvedAt,
      resolved_by: i.resolvedBy,
      resolution_notes: i.resolutionNotes,
      verified_at: i.verifiedAt,
      verified_by: i.verifiedBy,
    })),
    rework_actions: j.reworkActions.map((a) => ({
      id: a.id,
      issue_id: a.issueId,
      action: a.action,
      reason: a.reason,
      material_cost: a.materialCost,
      labor_minutes: a.laborMinutes,
      part_instance_id: a.partInstanceId,
      by_user_id: a.byUserId,
      at: a.at,
    })),
    unit_qc: j.unitQc.map((u) => ({
      unit_id: u.unitId,
      checklist: u.checklist.map((c) => ({ code: c.code, passed: c.passed })),
      passed_at: u.passedAt,
      passed_by: u.passedBy,
      notes: u.notes,
      photo_ids: u.photoIds,
      override: u.override
        ? { reason: u.override.reason, by_user_id: u.override.byUserId, at: u.override.at }
        : null,
    })),
    created_at: j.createdAt,
  };
}

export function qcGateChecksFromApi(raw: unknown): readonly QcGateCheck[] {
  if (!Array.isArray(raw)) return [];
  return (raw as readonly Record<string, unknown>[]).map((c) => ({
    code: str(c.code) as QcGateCheck['code'],
    label: str(c.label),
    passed: Boolean(c.passed),
    required: Boolean(c.required),
    details: str(c.details),
  }));
}

// ─── Closeout view (derived, read-only over the wire) ──────────────────────

export interface InstallationCloseoutCheckApi {
  readonly code: string;
  readonly label: string;
  readonly passed: boolean;
  readonly required: boolean;
  readonly details: string;
}

export function closeoutChecksFromApi(raw: unknown): readonly InstallationCloseoutCheckApi[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        code: str(rec.code),
        label: str(rec.label),
        passed: Boolean(rec.passed),
        required: Boolean(rec.required),
        details: str(rec.details),
      };
    });
}

export function projectEventToApi(e: ProjectEvent): Record<string, unknown> {
  return {
    id: e.id,
    project_id: e.projectId,
    type: e.type,
    at: e.at,
    by_user_id: e.byUserId ?? null,
    source: e.source ?? 'web',
    note: e.note ?? null,
    payload: e.payload ?? null,
  };
}

export function projectEventFromApi(raw: Record<string, unknown>): ProjectEvent {
  return {
    id: str(raw.id),
    projectId: str(raw.project_id ?? raw.projectId),
    type: str(raw.type) as ProjectEventType,
    at: str(raw.at),
    byUserId: str(raw.by_user_id ?? raw.byUserId) || undefined,
    source: (str(raw.source) || 'web') as ProjectEventSource,
    note: str(raw.note) || undefined,
    payload:
      raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload)
        ? (raw.payload as Record<string, unknown>)
        : undefined,
  };
}

function projectEventsFromApi(raw: unknown): ProjectEvent[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const events: ProjectEvent[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    events.push(projectEventFromApi(entry as Record<string, unknown>));
  }
  return events.length > 0 ? events : undefined;
}

function commercialStatusFromApi(raw: unknown): CommercialStatus | undefined {
  const s = str(raw);
  if (['draft', 'sent', 'won', 'lost', 'expired', 'cancelled'].includes(s)) {
    return s as CommercialStatus;
  }
  return undefined;
}

function materialsReleaseFromApi(raw: unknown): MaterialsRelease | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const releasedBy = str(r.released_by ?? r.releasedBy);
  const releasedAt = str(r.released_at ?? r.releasedAt);
  if (!releasedBy || !releasedAt) return undefined;
  return { releasedBy, releasedAt };
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
  const rawTrim =
    row.default_trim_margins && typeof row.default_trim_margins === 'object'
      ? (row.default_trim_margins as Record<string, unknown>)
      : row.defaultTrimMargins && typeof row.defaultTrimMargins === 'object'
        ? (row.defaultTrimMargins as Record<string, unknown>)
        : undefined;

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
    workshopName: str(
      row.workshop_name ?? row.workshopName,
    ),
    ptxExportMode: (row.ptx_export_mode ?? row.ptxExportMode) as 'unified' | 'by-material' | undefined,
    defaultSawKerfMm: num(
      row.default_saw_kerf_mm ?? row.defaultSawKerfMm,
      4.4,
    ),
    defaultTrimMargins: rawTrim
      ? {
          topMm: num(rawTrim.top_mm ?? rawTrim.topMm, 10),
          bottomMm: num(rawTrim.bottom_mm ?? rawTrim.bottomMm, 10),
          leftMm: num(rawTrim.left_mm ?? rawTrim.leftMm, 10),
          rightMm: num(rawTrim.right_mm ?? rawTrim.rightMm, 10),
        }
      : undefined,
    defaultDeductEdgeBand: bool(
      row.default_deduct_edge_band ?? row.defaultDeductEdgeBand,
      true,
    ),
    defaultCutStrategy: (row.default_cut_strategy ??
      row.defaultCutStrategy) as WorkshopSettings['defaultCutStrategy'],
    navMode: (row.nav_mode ?? row.navMode) as WorkshopSettings['navMode'],
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
    workshop_name: s.workshopName,
    ptx_export_mode: s.ptxExportMode,
    default_saw_kerf_mm: s.defaultSawKerfMm,
    default_trim_margins: s.defaultTrimMargins
      ? {
          top_mm: s.defaultTrimMargins.topMm,
          bottom_mm: s.defaultTrimMargins.bottomMm,
          left_mm: s.defaultTrimMargins.leftMm,
          right_mm: s.defaultTrimMargins.rightMm,
        }
      : undefined,
    default_deduct_edge_band: s.defaultDeductEdgeBand,
    default_cut_strategy: s.defaultCutStrategy,
    nav_mode: s.navMode,
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
  const unitCost = raw.unit_cost ?? raw.unitCost;
  const allocatedProjectId = str(raw.allocated_project_id ?? raw.allocatedProjectId);
  return {
    kind: (kind === 'tableros' || kind === 'cintillas' ? kind : 'herrajes') as StockMaterialKind,
    materialId: str(raw.material_id ?? raw.materialId),
    quantity: num(raw.quantity),
    receivedQuantity: num(raw.received_quantity ?? raw.receivedQuantity),
    unitCost: typeof unitCost === 'number' && Number.isFinite(unitCost) ? unitCost : undefined,
    allocatedProjectId: allocatedProjectId || undefined,
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
    requiredBy: str(raw.required_by ?? raw.requiredBy) || undefined,
    expectedAt: str(raw.expected_at ?? raw.expectedAt) || undefined,
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
    updatedAt: str(raw.updated_at ?? raw.updatedAt, new Date().toISOString()),
    receivedAt: str(raw.received_at ?? raw.receivedAt) || undefined,
    createdBy: str(raw.created_by ?? raw.createdBy) || undefined,
  };
}

/** Domain PO line → snake_case API body (OC-052/053 fields included). */
export function poItemToApi(it: {
  kind: StockMaterialKind;
  materialId: string;
  quantity: number;
  unitCost?: number;
  allocatedProjectId?: string;
}): Record<string, unknown> {
  return {
    kind: it.kind,
    material_id: it.materialId,
    quantity: it.quantity,
    ...(it.unitCost !== undefined ? { unit_cost: it.unitCost } : {}),
    ...(it.allocatedProjectId ? { allocated_project_id: it.allocatedProjectId } : {}),
  };
}

/* ── Job costing (OC-080..OC-084) ─────────────────────────────────────────── */

function costBaselineFromApi(raw: unknown): CostBaseline | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const source = (rec.source ?? {}) as Record<string, unknown>;
  return {
    id: str(rec.id),
    projectId: str(rec.project_id ?? rec.projectId),
    capturedAt: str(rec.captured_at ?? rec.capturedAt),
    capturedByUserId: optionalStr(rec.captured_by_user_id ?? rec.capturedByUserId),
    source: {
      quoteSnapshotCapturedAt: str(source.quote_snapshot_captured_at ?? source.quoteSnapshotCapturedAt),
      projectVersion: num(source.project_version ?? source.projectVersion),
      releaseId: str(source.release_id ?? source.releaseId),
      bomFingerprint: str(source.bom_fingerprint ?? source.bomFingerprint),
    },
    revenue: num(rec.revenue),
    materialsCost: num(rec.materials_cost ?? rec.materialsCost),
    edgeTotal: num(rec.edge_total ?? rec.edgeTotal),
    hardwareTotal: num(rec.hardware_total ?? rec.hardwareTotal),
    laborModular: num(rec.labor_modular ?? rec.laborModular),
    laborFixedCost: num(rec.labor_fixed_cost ?? rec.laborFixedCost),
    estimatedDirectCost: num(rec.estimated_direct_cost ?? rec.estimatedDirectCost),
    expectedGrossMargin: num(rec.expected_gross_margin ?? rec.expectedGrossMargin),
    expectedMarginPercent: num(rec.expected_margin_percent ?? rec.expectedMarginPercent),
  };
}

function costBaselineToApi(b: CostBaseline): Record<string, unknown> {
  return {
    id: b.id,
    project_id: b.projectId,
    captured_at: b.capturedAt,
    captured_by_user_id: b.capturedByUserId,
    source: {
      quote_snapshot_captured_at: b.source.quoteSnapshotCapturedAt,
      project_version: b.source.projectVersion,
      release_id: b.source.releaseId,
      bom_fingerprint: b.source.bomFingerprint,
    },
    revenue: b.revenue,
    materials_cost: b.materialsCost,
    edge_total: b.edgeTotal,
    hardware_total: b.hardwareTotal,
    labor_modular: b.laborModular,
    labor_fixed_cost: b.laborFixedCost,
    estimated_direct_cost: b.estimatedDirectCost,
    expected_gross_margin: b.expectedGrossMargin,
    expected_margin_percent: b.expectedMarginPercent,
  };
}

function timeEntryFromApi(raw: unknown): TimeEntry {
  const rec = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(rec.id),
    category: str(rec.category) as TimeEntry['category'],
    minutes: num(rec.minutes),
    at: str(rec.at),
    byUserId: optionalStr(rec.by_user_id ?? rec.byUserId),
    byName: optionalStr(rec.by_name ?? rec.byName),
    note: optionalStr(rec.note),
    ratePerHour: num(rec.rate_per_hour ?? rec.ratePerHour),
    removedAt: optionalStr(rec.removed_at ?? rec.removedAt),
    removedByUserId: optionalStr(rec.removed_by_user_id ?? rec.removedByUserId),
    removedByName: optionalStr(rec.removed_by_name ?? rec.removedByName),
  };
}

function timeEntryToApi(e: TimeEntry): Record<string, unknown> {
  return {
    id: e.id,
    category: e.category,
    minutes: e.minutes,
    at: e.at,
    by_user_id: e.byUserId,
    by_name: e.byName,
    note: e.note,
    rate_per_hour: e.ratePerHour,
    removed_at: e.removedAt,
    removed_by_user_id: e.removedByUserId,
    removed_by_name: e.removedByName,
  };
}

function otherActualCostFromApi(raw: unknown): OtherActualCost {
  const rec = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(rec.id),
    kind: str(rec.kind) as OtherActualCost['kind'],
    amount: num(rec.amount),
    at: str(rec.at),
    byUserId: optionalStr(rec.by_user_id ?? rec.byUserId),
    byName: optionalStr(rec.by_name ?? rec.byName),
    vendor: optionalStr(rec.vendor),
    note: optionalStr(rec.note),
    removedAt: optionalStr(rec.removed_at ?? rec.removedAt),
    removedByUserId: optionalStr(rec.removed_by_user_id ?? rec.removedByUserId),
    removedByName: optionalStr(rec.removed_by_name ?? rec.removedByName),
  };
}

function otherActualCostToApi(c: OtherActualCost): Record<string, unknown> {
  return {
    id: c.id,
    kind: c.kind,
    amount: c.amount,
    at: c.at,
    by_user_id: c.byUserId,
    by_name: c.byName,
    vendor: c.vendor,
    note: c.note,
    removed_at: c.removedAt,
    removed_by_user_id: c.removedByUserId,
    removed_by_name: c.removedByName,
  };
}

export function jobCostingFromApi(raw: unknown): JobCosting | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const entries: readonly unknown[] = Array.isArray(rec.time_entries ?? rec.timeEntries)
    ? ((rec.time_entries ?? rec.timeEntries) as readonly unknown[])
    : [];
  const costs: readonly unknown[] = Array.isArray(rec.other_costs ?? rec.otherCosts)
    ? ((rec.other_costs ?? rec.otherCosts) as readonly unknown[])
    : [];
  return {
    id: str(rec.id),
    projectId: str(rec.project_id ?? rec.projectId),
    baseline: costBaselineFromApi(rec.baseline),
    laborRatePerHour: num(rec.labor_rate_per_hour ?? rec.laborRatePerHour),
    timeEntries: entries.map(timeEntryFromApi),
    otherCosts: costs.map(otherActualCostFromApi),
    createdAt: str(rec.created_at ?? rec.createdAt),
  };
}

export function jobCostingToApi(j: JobCosting): Record<string, unknown> {
  return {
    id: j.id,
    project_id: j.projectId,
    baseline: j.baseline ? costBaselineToApi(j.baseline) : undefined,
    labor_rate_per_hour: j.laborRatePerHour,
    time_entries: j.timeEntries.map(timeEntryToApi),
    other_costs: j.otherCosts.map(otherActualCostToApi),
    created_at: j.createdAt,
  };
}

/* ── Structured site survey (OC-040/OC-041) ────────────────────────────────── */

function spaceMeasuresFromApi(raw: unknown): SpaceMeasures | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  return {
    widthMm: num(rec.width_mm ?? rec.widthMm),
    heightMm: num(rec.height_mm ?? rec.heightMm),
    depthMm: optionalNum(rec.depth_mm ?? rec.depthMm),
    notes: optionalStr(rec.notes),
  };
}

function spaceMeasuresToApi(m: SpaceMeasures): Record<string, unknown> {
  return {
    width_mm: m.widthMm,
    height_mm: m.heightMm,
    depth_mm: m.depthMm,
    notes: m.notes,
  };
}

function surveyElementFromApi(raw: unknown): SurveyElement {
  const rec = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(rec.id),
    kind: str(rec.kind) as SurveyElement['kind'],
    label: str(rec.label),
    widthMm: optionalNum(rec.width_mm ?? rec.widthMm),
    heightMm: optionalNum(rec.height_mm ?? rec.heightMm),
    distanceMm: optionalNum(rec.distance_mm ?? rec.distanceMm),
    notes: optionalStr(rec.notes),
  };
}

function surveyElementToApi(el: SurveyElement): Record<string, unknown> {
  return {
    id: el.id,
    kind: el.kind,
    label: el.label,
    width_mm: el.widthMm,
    height_mm: el.heightMm,
    distance_mm: el.distanceMm,
    notes: el.notes,
  };
}

function surveySpaceFromApi(raw: unknown): SurveySpace {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const elements: readonly unknown[] = Array.isArray(rec.elements) ? rec.elements : [];
  const photoIds: readonly unknown[] = Array.isArray(rec.photo_ids ?? rec.photoIds)
    ? ((rec.photo_ids ?? rec.photoIds) as readonly unknown[])
    : [];
  return {
    id: str(rec.id),
    name: str(rec.name),
    intent: str(rec.intent) as SurveySpace['intent'],
    measures: spaceMeasuresFromApi(rec.measures),
    preliminaryMeasures: spaceMeasuresFromApi(rec.preliminary_measures ?? rec.preliminaryMeasures),
    elements: elements.map(surveyElementFromApi),
    plumbNote: optionalStr(rec.plumb_note ?? rec.plumbNote),
    levelNote: optionalStr(rec.level_note ?? rec.levelNote),
    squareNote: optionalStr(rec.square_note ?? rec.squareNote),
    photoIds: photoIds.map((p) => str(p)),
    capturedAt: optionalStr(rec.captured_at ?? rec.capturedAt),
    capturedByUserId: optionalStr(rec.captured_by_user_id ?? rec.capturedByUserId),
    approvedAt: optionalStr(rec.approved_at ?? rec.approvedAt),
    approvedByUserId: optionalStr(rec.approved_by_user_id ?? rec.approvedByUserId),
  };
}

function surveySpaceToApi(s: SurveySpace): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    intent: s.intent,
    measures: s.measures ? spaceMeasuresToApi(s.measures) : undefined,
    preliminary_measures: s.preliminaryMeasures ? spaceMeasuresToApi(s.preliminaryMeasures) : undefined,
    elements: s.elements.map(surveyElementToApi),
    plumb_note: s.plumbNote,
    level_note: s.levelNote,
    square_note: s.squareNote,
    photo_ids: s.photoIds,
    captured_at: s.capturedAt,
    captured_by_user_id: s.capturedByUserId,
    approved_at: s.approvedAt,
    approved_by_user_id: s.approvedByUserId,
  };
}

export function siteSurveyFromApi(raw: unknown): SiteSurvey | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const spaces: readonly unknown[] = Array.isArray(rec.spaces) ? rec.spaces : [];
  return {
    id: str(rec.id),
    projectId: str(rec.project_id ?? rec.projectId),
    revision: num(rec.revision),
    spaces: spaces.map(surveySpaceFromApi),
    createdAt: str(rec.created_at ?? rec.createdAt),
    capturedByUserId: optionalStr(rec.captured_by_user_id ?? rec.capturedByUserId),
    verifiedAt: optionalStr(rec.verified_at ?? rec.verifiedAt),
    verifiedByUserId: optionalStr(rec.verified_by_user_id ?? rec.verifiedByUserId),
  };
}

export function siteSurveyToApi(s: SiteSurvey): Record<string, unknown> {
  return {
    id: s.id,
    project_id: s.projectId,
    revision: s.revision,
    spaces: s.spaces.map(surveySpaceToApi),
    created_at: s.createdAt,
    captured_by_user_id: s.capturedByUserId,
    verified_at: s.verifiedAt,
    verified_by_user_id: s.verifiedByUserId,
  };
}

export function surveyGateBlockersFromApi(raw: unknown): readonly SurveyGateBlocker[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const rec = (item ?? {}) as Record<string, unknown>;
    return {
      kind: str(rec.kind) as SurveyGateBlocker['kind'],
      spaceId: optionalStr(rec.space_id ?? rec.spaceId),
      spaceName: optionalStr(rec.space_name ?? rec.spaceName),
      message: str(rec.message),
    };
  });
}

export function jobCostSummaryFromApi(raw: unknown): JobCostSummary {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const minutesRaw = (rec.minutes_by_category ?? rec.minutesByCategory ?? {}) as Record<string, unknown>;
  const otherRaw = (rec.other_cost_by_kind ?? rec.otherCostByKind ?? {}) as Record<string, unknown>;
  const minutesByCategory = {} as Record<TimeEntry['category'], number>;
  for (const category of TIME_ENTRY_CATEGORIES) {
    minutesByCategory[category] = num(minutesRaw[category]);
  }
  const otherCostByKind = {} as Record<OtherActualCost['kind'], number>;
  for (const kind of OTHER_COST_KINDS) {
    otherCostByKind[kind] = num(otherRaw[kind]);
  }
  return {
    revenue: optionalNum(rec.revenue) ?? null,
    estimatedDirectCost: optionalNum(rec.estimated_direct_cost ?? rec.estimatedDirectCost) ?? null,
    actualMaterialCost: num(rec.actual_material_cost ?? rec.actualMaterialCost),
    actualMaterialTruth: (str(rec.actual_material_truth ?? rec.actualMaterialTruth) || 'missing') as CostTruth,
    actualLaborMinutes: num(rec.actual_labor_minutes ?? rec.actualLaborMinutes),
    actualLaborCost: optionalNum(rec.actual_labor_cost ?? rec.actualLaborCost) ?? null,
    actualOtherCost: num(rec.actual_other_cost ?? rec.actualOtherCost),
    actualDirectCost: optionalNum(rec.actual_direct_cost ?? rec.actualDirectCost) ?? null,
    variance: optionalNum(rec.variance) ?? null,
    expectedGrossMargin: optionalNum(rec.expected_gross_margin ?? rec.expectedGrossMargin) ?? null,
    expectedMarginPercent: optionalNum(rec.expected_margin_percent ?? rec.expectedMarginPercent) ?? null,
    actualGrossMargin: optionalNum(rec.actual_gross_margin ?? rec.actualGrossMargin) ?? null,
    actualMarginPercent: optionalNum(rec.actual_margin_percent ?? rec.actualMarginPercent) ?? null,
    minutesByCategory,
    otherCostByKind,
  };
}

export function materialCostValuationFromApi(raw: unknown): MaterialCostValuation {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const lines: readonly unknown[] = Array.isArray(rec.lines) ? rec.lines : [];
  const missing: readonly unknown[] = Array.isArray(rec.missing_valuation_material_ids ?? rec.missingValuationMaterialIds)
    ? ((rec.missing_valuation_material_ids ?? rec.missingValuationMaterialIds) as readonly unknown[])
    : [];
  return {
    lines: lines.map((l) => {
      const line = (l ?? {}) as Record<string, unknown>;
      return {
        materialId: str(line.material_id ?? line.materialId),
        quantity: num(line.quantity),
        unitCost: num(line.unit_cost ?? line.unitCost),
        amount: num(line.amount),
        basis: str(line.basis) as MaterialValuationBasis,
        truth: str(line.truth) as CostTruth,
      };
    }),
    total: num(rec.total),
    truth: (str(rec.truth) || 'missing') as CostTruth,
    missingValuationMaterialIds: missing.map((m) => str(m)),
  };
}
