/**
 * Domain entity types — pure structural contracts (no calculation logic).
 */

// --- Literal unions ---

export type HardwareUnit = 'piece' | 'set' | 'meter';

export type OptionGroupKind = 'board' | 'hardware' | 'edge';

export type Grain = 0 | 1;

export type EdgeSide = 'L1' | 'L2' | 'W1' | 'W2';

/** Workflow: draft → quoted → accepted → produced; reopen → draft (F036). */
export type ProjectStatus = 'draft' | 'quoted' | 'accepted' | 'produced';

export type OptionChoices = { readonly [optionGroupCode: string]: string };

// --- Catalog entities ---

export interface MaterialBoard {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly thicknessMm: number;
  readonly grainDefault: boolean;
  readonly boardPrice: number;
  readonly wastePercent: number;
  readonly costPerM2: number;
  /**
   * Default edge band for this board when a part has edge flags on and the
   * project does not override with an EDGE option choice. Linked by id — never by name.
   */
  readonly defaultEdgeBandId?: string;
  /** Relative media URL (e.g. /api/media/xxx.webp) — never base64 (F040). */
  readonly imageUrl?: string;
  /**
   * Solid color for 3D / fast client preview (`#RRGGBB` or `#RGB`).
   * Use for solid-color boards (paint, lacquer) and color-only view mode.
   */
  readonly previewColor?: string;
  /**
   * Optional texture map for 3D (relative media URL). Color-only mode ignores this.
   */
  readonly previewTextureUrl?: string;
  readonly notes?: string;
  readonly active: boolean;
}

export interface EdgeBand {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly thicknessMm: number;
  readonly costPerMl: number;
  readonly notes?: string;
  readonly active: boolean;
}

export interface Hardware {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unit: HardwareUnit;
  readonly costPerUnit: number;
  /** Relative media URL (F040). */
  readonly imageUrl?: string;
  readonly notes?: string;
  readonly active: boolean;
}

/**
 * Product account roles (F035).
 * `user` = approved account without job title until admin assigns a puesto.
 */
export type UserRole =
  | 'admin'
  | 'user'
  | 'vendedor'
  | 'gerente_ventas'
  | 'ingeniero'
  | 'produccion';

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
  readonly active: boolean;
}

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly address?: string;
  readonly notes?: string;
  readonly active: boolean;
  /**
   * Portfolio owner user id (F034 / OWN-*).
   * Vendedor only sees customers they own; admin can assign/reassign.
   */
  readonly ownerUserId?: string;
}

export interface OptionGroup {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: OptionGroupKind;
  readonly required: boolean;
  readonly optionIds: readonly string[];
}

// --- Module categories (hierarchical, max 3 levels) ---

/**
 * User-defined category for classifying module templates.
 * Roots have no parentId; depth is 1..3 (root = 1).
 */
export interface ModuleCategory {
  readonly id: string;
  readonly name: string;
  /** Parent category id; omit/undefined for root-level categories. */
  readonly parentId?: string;
  readonly sortOrder: number;
}

// --- Module template ---

export interface EdgeAssignment {
  readonly side: EdgeSide;
  readonly enabled: boolean;
}

export interface BoardPart {
  readonly id: string;
  readonly code?: string;
  readonly description: string;
  readonly quantity: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  /**
   * Grain (veta) is NOT set per piece — it is inherited from the resolved
   * material's grainDefault at quotation time (see resolveBom). This mirrors
   * how edgeBandId is also resolved from material.defaultEdgeBandId.
   */
  readonly edges: readonly EdgeAssignment[];
  readonly optionRole: string;
  readonly lengthFormula?: string;
  readonly widthFormula?: string;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly rotateX?: number;
  readonly rotateY?: number;
  readonly rotateZ?: number;
}

export interface HardwareLine {
  readonly id: string;
  readonly quantity: number;
  readonly descriptionOverride?: string;
  readonly optionRole: string;
  readonly hardwareId?: string;
}

export interface ExternalDims {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface Module {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Optional leaf-or-any-level category (MOD-09). Unset = uncategorized. */
  readonly categoryId?: string;
  /** Structure reference for composed modules (F049 / H07). Required to resolve pieces. */
  readonly structureId?: string;
  /** Component instances placed directly on this module (doors, shelves, …).
   * Combined with the referenced structure's components to produce board parts. */
  readonly components?: readonly ModuleComponentInstance[];
  readonly externalDims?: ExternalDims;
  /**
   * Commercial measure options offered to sales (H09 / #104).
   * Source of truth for sellable sizes — not Structure.presets.
   */
  readonly presets?: readonly DimensionPreset[];
  readonly baseLaborCost?: number;
  /** Relative media URL for sales showcase (F040). */
  readonly imageUrl?: string;
  readonly hardwareLines: readonly HardwareLine[];
  readonly notes?: string;
}

export interface DimensionPreset {
  readonly id: string;
  readonly name?: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

/**
 * Reusable engineering **body** (cuerpo) — F049 / #99 / H04.
 * Parametric via component formulas (W/H/D). Commercial size lists live on Module.
 * `presets` is optional engineering preview only (H05 intermediate).
 */
export interface Structure {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Documented outer size of the body. */
  readonly externalDims?: ExternalDims;
  /** Optional engineering preview sizes — not the commercial allowlist (see Module.presets). */
  readonly presets?: readonly DimensionPreset[];
  /** Component instances when this structure is used in a composed module. */
  readonly components?: readonly ModuleComponentInstance[];
  readonly notes?: string;
  /** Soft-delete / hide from pickers. Default true when omitted. */
  readonly active?: boolean;
}

// --- Reusable components (F049 / H07) ---

export type ComponentPlacement =
  | 'base' | 'superior' | 'lateral_izquierdo' | 'lateral_derecho'
  | 'frontal' | 'trasera' | 'interno' | 'puerta'
  | 'frente_cajon' | 'custom';

export type ComponentGeometry =
  | {
      readonly kind: 'rectangular_board';
      /** Default length; overridden by lengthFormula at resolution time when present. */
      readonly lengthMm: number;
      /** Default width; overridden by widthFormula at resolution time when present. */
      readonly widthMm: number;
      readonly thicknessMm: number;
      /** Optional parametric formula (W/H/D variables) — overrides lengthMm when set. */
      readonly lengthFormula?: string;
      /** Optional parametric formula (W/H/D variables) — overrides widthMm when set. */
      readonly widthFormula?: string;
    };

export interface Perforation {
  readonly id: string;
  readonly relativePosition: { readonly xPercent: number; readonly yPercent: number };
  readonly diameterMm: number;
  readonly depthMm: number;
  readonly type: 'through' | 'blind' | 'dowel' | 'shelf_pin' | 'hinge_cup';
}

export interface Component {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly placement: ComponentPlacement;
  readonly geometry: ComponentGeometry;
  readonly defaultEdges: readonly EdgeAssignment[];
  readonly perforations?: readonly Perforation[];
  readonly optionRoles: readonly string[];
  readonly notes?: string;
  readonly active: boolean;
  readonly xFormula?: string;
  readonly yFormula?: string;
  readonly zFormula?: string;
  readonly rotateX?: number;
  readonly rotateY?: number;
  readonly rotateZ?: number;
}

export interface ModuleComponentInstance {
  readonly componentId: string;
  readonly quantity: number;
  readonly placementOverride?: ComponentPlacement;
  readonly overrides?: {
    readonly edges?: readonly EdgeAssignment[];
    readonly notes?: string;
    /** Per-instance length formula (W/H/D) — overrides the component's formula/length. */
    readonly lengthFormula?: string;
    /** Per-instance width formula (W/H/D) — overrides the component's formula/width. */
    readonly widthFormula?: string;
    readonly xFormula?: string;
    readonly yFormula?: string;
    readonly zFormula?: string;
    readonly rotateX?: number;
    readonly rotateY?: number;
    readonly rotateZ?: number;
  };
}

// --- Project / quotation ---

export interface ProjectItem {
  readonly id: string;
  readonly moduleId: string;
  readonly quantity: number;
  readonly optionChoices: OptionChoices;
  /**
   * Selected commercial measure preset from Module.presets (H09 / #104).
   * Required when the module defines presets; ignored when none.
   */
  readonly measurePresetId?: string;
}

/** Floor base vs wall-hung elevation for kitchen plan (#133). */
export type PlacementElevation = 'floor' | 'wall';

/**
 * Straight wall segment in plan (mm).
 * angleDeg: 0 = along +X, 90 = along +Y (L kitchen).
 */
export interface KitchenWall {
  readonly id: string;
  readonly lengthMm: number;
  readonly name?: string;
  /** Direction of the wall in plan degrees (0 = +X). */
  readonly angleDeg: number;
  /** Optional start; if omitted, chained from previous wall end. */
  readonly originXMm?: number;
  readonly originYMm?: number;
}

/**
 * Placement of one copy of a quote line on a wall.
 * Does not affect BOM — presentation/obra only (#133).
 */
export interface ProjectItemPlacement {
  readonly itemId: string;
  /** 0-based index when ProjectItem.quantity > 1. */
  readonly instanceIndex: number;
  readonly wallId: string;
  /** Distance along the wall from the wall start (mm). */
  readonly offsetMm: number;
  readonly elevation: PlacementElevation;
}

/** Optional kitchen plan attached to a project. */
export interface ProjectKitchenLayout {
  readonly walls: readonly KitchenWall[];
  readonly placements: readonly ProjectItemPlacement[];
}

/** Simple installation checklist item (#139). */
export interface InstallationChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
}

/** Default checklist template for new projects / first open. */
export const DEFAULT_INSTALLATION_CHECKLIST: readonly Omit<
  InstallationChecklistItem,
  'id'
>[] = [
  { label: 'Verificar medidas en obra', done: false },
  { label: 'Nivelar y fijar módulos', done: false },
  { label: 'Instalar herrajes y ajustes', done: false },
  { label: 'Sellar juntas y limpiar', done: false },
  { label: 'Entrega y conformidad cliente', done: false },
] as const;

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly customerId: string;
  readonly createdBy?: string;
  /**
   * Portfolio owner user id (F034 / OWN-*). May differ from createdBy after reassignment.
   */
  readonly ownerUserId?: string;
  readonly currency: string;
  readonly marginFactor: number;
  readonly laborFixedCost: number;
  readonly status: ProjectStatus;
  readonly items: readonly ProjectItem[];
  /**
   * Default option choices for all line items (F029 / #35).
   * Effective per item: item.optionChoices[role] || projectLevelChoices[role].
   * Empty/missing line values inherit the project default.
   */
  readonly projectLevelChoices?: OptionChoices;
  /**
   * Optional kitchen plan (walls + placements). Omitted = linear 3D run only.
   */
  readonly kitchenLayout?: ProjectKitchenLayout;
  /**
   * Optional installation checklist for obra (#139).
   */
  readonly installationChecklist?: readonly InstallationChecklistItem[];
  /**
   * Optional nesting import (real sheets used) from external optimizer (#142).
   */
  readonly nestingImport?: {
    readonly importedAt: string;
    readonly sourceName?: string;
    readonly rows: readonly {
      readonly materialCode: string;
      readonly sheetsUsed: number;
      readonly areaM2?: number;
    }[];
  };
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Present when closed (quoted/accepted/produced); ignored while draft. */
  readonly priceSnapshot?: QuotePriceSnapshot;
}

// --- Workspace containers (persistable shape) ---

export interface Catalog {
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
  readonly optionGroups: readonly OptionGroup[];
  readonly modules: readonly Module[];
  /**
   * Engineering bodies (F049). Omitted/undefined treated as [] for older workspaces.
   * Does not affect module resolution until modules compose structures (H07).
   */
  readonly structures?: readonly Structure[];
  /** Hierarchical module categories (MOD-09). Empty/omitted = no taxonomy. */
  readonly categories?: readonly ModuleCategory[];
  readonly customers?: readonly Customer[];
  /** Reusable components catalog (F049 / H07). */
  readonly components?: readonly Component[];
  readonly users?: readonly User[];
}

/**
 * Global workshop defaults for new quotations (F031 / #37).
 * Does not mutate existing projects when changed.
 */
export interface WorkshopSettings {
  readonly defaultMarginFactor: number;
  readonly defaultLaborFixedCost: number;
  readonly defaultCurrency: string;
  /**
   * When true, product role `vendedor` (and `user`) may see workshop costs
   * (COST-02 / F044). Default false — COST-01 parity (F039).
   */
  readonly vendedorCanViewCosts: boolean;
}

export interface Workspace {
  readonly schemaVersion: number;
  readonly catalog: Catalog;
  readonly projects: readonly Project[];
  /** Optional; older workspaces omit this and use product defaults. */
  readonly settings?: WorkshopSettings;
}

// --- Resolution / quote DTOs (calculated shapes; no logic here) ---

export interface ResolvedBoardPart {
  readonly id: string;
  readonly code?: string;
  readonly description: string;
  readonly quantity: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  /**
   * Grain (veta) inherited from the resolved material's grainDefault
   * (material.grainDefault ? 1 : 0) — materialized here for cost/export paths.
   */
  readonly grain: Grain;
  readonly edges: readonly EdgeAssignment[];
  readonly optionRole: string;
  readonly materialId: string;
  readonly edgeBandId?: string;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly rotateX?: number;
  readonly rotateY?: number;
  readonly rotateZ?: number;
  readonly thicknessMm: number;
}

export interface ResolvedHardwareLine {
  readonly id: string;
  readonly quantity: number;
  readonly descriptionOverride?: string;
  readonly optionRole: string;
  readonly hardwareId: string;
}

export interface ResolvedBom {
  readonly boardParts: readonly ResolvedBoardPart[];
  readonly hardwareLines: readonly ResolvedHardwareLine[];
}

export interface QuoteBreakdown {
  readonly materialsCost: number;
  readonly edgeTotal: number;
  readonly hardwareTotal: number;
  readonly directCost: number;
  readonly laborModular: number;
  readonly laborFixedCost: number;
  readonly marginFactor: number;
  readonly salePrice: number;
}

/**
 * Frozen quote prices captured when a project is closed (quoted/accepted).
 * PRD §7.4 cost policy — closed projects ignore catalog price changes.
 */
export interface QuotePriceSnapshot {
  readonly capturedAt: string; // ISO
  readonly breakdown: QuoteBreakdown;
  /** Optional unit prices used for audit */
  readonly materialCostPerM2?: Readonly<Record<string, number>>; // materialId -> costPerM2
  readonly edgeCostPerMl?: Readonly<Record<string, number>>;
  readonly hardwareCostPerUnit?: Readonly<Record<string, number>>;
}

/** Flat cut-list row for Optimizer export (columns A–J). */
export interface ProductionCutRow {
  readonly quantity: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  /**
   * Optimizer column D — includes part/module codes for workshop ID (F048).
   * Format: `{partCode} · {partName} · {moduleCode}` when codes exist.
   */
  readonly description: string;
  readonly materialName: string;
  readonly grain: Grain;
  readonly L1: 0 | 1;
  readonly L2: 0 | 1;
  readonly W1: 0 | 1;
  readonly W2: 0 | 1;
  /** Original part name without codes (F048). */
  readonly partName?: string;
  readonly partCode?: string;
  readonly moduleCode?: string;
  /** Stable label key for matching piece labels (F046/F048). */
  readonly labelRef?: string;
}

/** Aggregated hardware line for purchase-list export (EXP-08). */
export interface HardwarePurchaseRow {
  readonly hardwareId: string;
  readonly code: string;
  readonly description: string;
  readonly unit: HardwareUnit;
  readonly quantity: number;
  readonly costPerUnit: number;
  readonly lineCost: number;
}

/**
 * Piece label for workshop print/export (F046 / #96).
 * Board parts only — never hardware.
 */
export interface PieceLabel {
  readonly moduleCode: string;
  readonly moduleName: string;
  readonly partCode?: string;
  readonly description: string;
  /** part.quantity × project item quantity */
  readonly quantity: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly materialCode: string;
  readonly materialName: string;
  readonly edgeBandCode?: string;
  readonly edgeBandName?: string;
  readonly L1: boolean;
  readonly L2: boolean;
  readonly W1: boolean;
  readonly W2: boolean;
  /** Spanish workshop instruction (sides + edge band when known). */
  readonly edgeBandingInstruction: string;
}

/** Aggregated board material usage for a project (F047 / #97). */
export interface MaterialUsageRow {
  readonly materialId: string;
  readonly code: string;
  readonly name: string;
  readonly areaM2: number;
  readonly edgeMl: number;
  readonly boardCost: number;
}

/** Aggregated edge-band ML for a project (F047 / #97). */
export interface EdgeUsageRow {
  readonly edgeBandId: string;
  readonly code: string;
  readonly name: string;
  readonly edgeMl: number;
  readonly edgeCost: number;
}

/**
 * Consolidated purchase/planning summary for a project (F047 / #97).
 * Costs are included for roles that may view them; UI redacts when needed.
 */
export interface ProjectMaterialSummary {
  readonly materials: readonly MaterialUsageRow[];
  readonly edges: readonly EdgeUsageRow[];
  readonly hardware: readonly HardwarePurchaseRow[];
  readonly totalAreaM2: number;
  readonly totalEdgeMl: number;
  readonly totalBoardCost: number;
  readonly totalEdgeCost: number;
  readonly totalHardwareCost: number;
}
