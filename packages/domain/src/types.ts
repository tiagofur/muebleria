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

/**
 * Which world plane the board face lies on (workshop frame, S1 spatial).
 * - xy: front/back plane
 * - xz: horizontal (base / top / shelf)
 * - yz: lateral (left / right side)
 */
export type BoardFace = 'xy' | 'xz' | 'yz';

/**
 * Semantic assembly slot — used for defaults and engineering UI (S1).
 * Distinct from BoardFace (physical orientation).
 */
export type PlacementSlot =
  | 'base'
  | 'top'
  | 'left'
  | 'right'
  | 'back'
  | 'front'
  | 'shelf'
  | 'door'
  | 'drawer_front'
  | 'divider'
  | 'custom';

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
  /**
   * Spatial assembly metadata (S1). Optional — modules without these still
   * resolve BOM; assembly degrades to outer_only / partial.
   */
  readonly face?: BoardFace;
  readonly placement?: PlacementSlot;
  /** Origin formulas in furniture mm; tokens W,H,D,T,i,n. */
  readonly originXFormula?: string;
  readonly originYFormula?: string;
  readonly originZFormula?: string;
  /**
   * Design thickness when material is not yet resolved (mm).
   * Assembly prefers resolved material thickness when available.
   */
  readonly designThicknessMm?: number;
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
  readonly externalDims?: ExternalDims;
  readonly baseLaborCost?: number;
  /** Relative media URL for sales showcase (F040). */
  readonly imageUrl?: string;
  readonly boardParts: readonly BoardPart[];
  readonly hardwareLines: readonly HardwareLine[];
  readonly notes?: string;
  /**
   * Optional engineering body for composed furniture (H07 / #102).
   * When set, quotation resolution stretches the structure at the chosen measure preset.
   */
  readonly structureId?: string;
  /**
   * Commercial measure options offered to sales (H09 / #104).
   * Source of truth for allowed sizes — not Structure.presets.
   */
  readonly presets?: readonly DimensionPreset[];
  /**
   * Attached reusable components (H07 / #102). Expanded at resolveBom.
   * Dual path: omit/empty keeps fixed modules unchanged.
   */
  readonly components?: readonly ModuleComponentRef[];
}

/**
 * Kind of reusable engineering add-on (H06 / #101).
 * Spanish workshop labels in UI; codes stay stable in API.
 */
export type FurnitureComponentKind =
  | 'puerta'
  | 'entrepaño'
  | 'frente_cajon'
  | 'lateral'
  | 'otro';

/**
 * Instance of a catalog component on a furniture template (H07 / #102).
 */
export interface ModuleComponentRef {
  readonly componentId: string;
  /** How many times to include this component (e.g. 2 doors). */
  readonly quantity: number;
  /**
   * Instance placement overrides (S1). Applied as the component frame origin
   * for each index i in 0..quantity-1; formulas may use W,H,D,T,i,n.
   */
  readonly placement?: PlacementSlot;
  readonly originXFormula?: string;
  readonly originYFormula?: string;
  readonly originZFormula?: string;
}

/**
 * Reusable catalog component — door, shelf, drawer front, etc. (H06 / #101).
 * Parametric via board part formulas (W/H/D) like Structure; commercial sizes live on Module.
 */
export interface FurnitureComponent {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: FurnitureComponentKind;
  readonly boardParts: readonly BoardPart[];
  readonly hardwareLines: readonly HardwareLine[];
  readonly notes?: string;
  /** Soft-delete / hide from pickers. Default true when omitted. */
  readonly active?: boolean;
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
 * Parametric via part formulas (W/H/D). Commercial size lists live on Module.
 * `presets` is optional engineering preview only (H05 intermediate).
 */
export interface Structure {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Documented outer size of the body. */
  readonly externalDims?: ExternalDims;
  readonly boardParts: readonly BoardPart[];
  /** Optional engineering preview sizes — not the commercial allowlist (see Module.presets). */
  readonly presets?: readonly DimensionPreset[];
  readonly notes?: string;
  /** Soft-delete / hide from pickers. Default true when omitted. */
  readonly active?: boolean;
}

// --- Project / quotation ---

export interface ProjectItem {
  readonly id: string;
  readonly moduleId: string;
  readonly quantity: number;
  readonly optionChoices: OptionChoices;
  /**
   * Selected commercial measure preset from Module.presets (H09 / #104).
   * Required when the module defines presets; ignored for fixed modules without presets.
   */
  readonly measurePresetId?: string;
}

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
   */
  readonly structures?: readonly Structure[];
  /**
   * Reusable components (H06 / #101). Omitted/undefined treated as [].
   */
  readonly components?: readonly FurnitureComponent[];
  /** Hierarchical module categories (MOD-09). Empty/omitted = no taxonomy. */
  readonly categories?: readonly ModuleCategory[];
  readonly customers?: readonly Customer[];
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

/** Completeness of spatial assembly (S1) — viewer may degrade gracefully. */
export type AssemblyCompleteness = 'full' | 'partial' | 'outer_only';

/**
 * One board placed in furniture space (S1). Sibling of ResolvedBoardPart for
 * cost/export — does not replace BOM.
 */
export interface PlacedBoardPart {
  readonly partId: string;
  readonly code?: string;
  readonly description: string;
  readonly optionRole: string;
  readonly materialId?: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly face: BoardFace;
  readonly originMm: { readonly x: number; readonly y: number; readonly z: number };
  readonly placement?: PlacementSlot;
  readonly source: {
    readonly kind: 'structure' | 'component' | 'module';
    readonly structureId?: string;
    readonly componentId?: string;
    readonly instanceIndex?: number;
  };
}

export interface ResolvedAssembly {
  readonly outerMm: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
  };
  readonly boards: readonly PlacedBoardPart[];
  readonly completeness: AssemblyCompleteness;
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
