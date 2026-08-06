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
  /**
   * Physical size (mm) of one full texture image across the board **width**
   * (local X / U). Used to UV-scale photo textures so pattern density matches
   * the real melamine sample. Omit/0 → default tile (~280 mm).
   */
  readonly previewTextureTileWidthMm?: number;
  /**
   * Physical size (mm) of one full texture image along board **length** / veta
   * (local Z / V). Omit/0 → default tile (~280 mm).
   */
  readonly previewTextureTileLengthMm?: number;
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
  /**
   * Commercial package size in the same unit as `unit`.
   * Example: unit `meter` + packageSize `4` → barras de 4 m.
   * Used by the hardware purchase list to ceil consumption to packages.
   */
  readonly packageSize?: number;
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

/**
 * Fundamental furniture type (#109 / H14). Workshops distinguish base/wall/tall
 * units with different proportions (e.g. depth ~560 for inferiors, ~320 for
 * superiors, height ~2100 for altos). Project measure defaults are keyed by
 * this type. Unset on a Module defaults to `'inferior'` for legacy fixtures.
 */
export type FurnitureType = 'inferior' | 'superior' | 'alto';

/**
 * How the floor cabinet meets the floor (zoclo / patas).
 * - none: no base BOM (wall units, or carcass only)
 * - plinth_board: melamine plinth component(s), role ZOCLO (material fallback FRENTE)
 * - plinth_strip: purchased profile by linear meter, role ZOCLO_PERFIL
 * - legs: hardware feet/levelers, role PATAS
 */
export type ModuleBaseMode =
  | 'none'
  | 'plinth_board'
  | 'plinth_strip'
  | 'legs';

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
  /** Fundamental furniture type for project measure defaults (#109). */
  readonly furnitureType?: FurnitureType;
  /**
   * Floor base treatment (zoclo board / strip / legs). Omit → none.
   */
  readonly baseMode?: ModuleBaseMode;
  /**
   * Default zoclo/patas height B (mm) for formulas and 3D clearance.
   * Omit → domain default (100) when baseMode needs a height.
   */
  readonly baseClearanceMm?: number;
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
 *
 * #108 — Versioned structure: editing a published structure bumps `revision`
 * and pushes an immutable snapshot of the previous revision into `history`.
 * `revision` is optional on the type so legacy fixtures / old persisted
 * workspaces keep compiling; versioning helpers normalize missing → 1.
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
  /**
   * Monotonic revision number (#108). Defaults to 1 when absent (legacy data).
   * Incremented by `bumpStructureRevision` on each edit.
   */
  readonly revision?: number;
  /**
   * Immutable snapshots of previous revisions (#108), newest first.
   * `history[0]` is always the most recently superseded revision.
   */
  readonly history?: readonly StructureRevision[];
}

/**
 * Immutable snapshot of a superseded Structure revision (#108).
 * Captures only the fields that affect BOM resolution so the pinned revision
 * can be re-resolved exactly as it was at quotation time.
 */
export interface StructureRevision {
  readonly revision: number;
  readonly code: string;
  readonly name: string;
  readonly externalDims?: ExternalDims;
  readonly presets?: readonly DimensionPreset[];
  readonly components?: readonly ModuleComponentInstance[];
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
  /**
   * Pinned structure revision (#108). Pegged onto the item when the project is
   * closed (quoted/accepted/produced) so later structure edits don't mutate the
   * frozen BOM. Re-resolving uses `resolveStructureRevision(structure, pin)`.
   */
  readonly structureRevisionPin?: number;
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

/** How a quote unit is anchored in the kitchen plan. Default `wall`. */
export type PlacementMode = 'wall' | 'free';

/**
 * Placement of one copy of a quote line on a wall or free (island).
 * Does not affect BOM — presentation/obra only (#133 / free-place icebox).
 */
export interface ProjectItemPlacement {
  readonly itemId: string;
  /** 0-based index when ProjectItem.quantity > 1. */
  readonly instanceIndex: number;
  /**
   * Wall id when mode is `wall` (or omitted). Empty / ignored when mode is `free`.
   */
  readonly wallId: string;
  /** Distance along the wall from the wall start (mm). Ignored when free. */
  readonly offsetMm: number;
  readonly elevation: PlacementElevation;
  /**
   * Clearance under this unit for plinth/legs (zoclo/patas), mm.
   * Only used when elevation is `floor`. Omit to inherit layout default.
   */
  readonly baseClearanceMm?: number;
  /**
   * `free` = island / free place on the floor plane (not snapped to a wall).
   * Omit or `wall` = classic wall-run placement.
   */
  readonly mode?: PlacementMode;
  /** Plan X (mm) when mode is free. */
  readonly freeXMm?: number;
  /** Plan Y / depth (mm) when mode is free. */
  readonly freeYMm?: number;
  /** Plan yaw (degrees) when mode is free. 0 = face +Y depth into room convention. */
  readonly freeYawDeg?: number;
}

/**
 * Background plan image (PDF page exported as PNG/JPG, photo of blueprint, etc.).
 * Presentation only — not BOM. Used to trace walls in Proyectar.
 */
export interface KitchenPlanUnderlay {
  /** Media path or data URL of the plan image. */
  readonly imageUrl: string;
  /** Horizontal span of the image in workshop mm. */
  readonly widthMm: number;
  /** Vertical span of the image in workshop mm. */
  readonly heightMm: number;
  /** Min-corner of the image in plan coords (default 0). */
  readonly originXMm?: number;
  readonly originYMm?: number;
  /** 0–1; default ~0.45 in UI. */
  readonly opacity?: number;
  /** Original file name for UI. */
  readonly fileName?: string;
}

/**
 * One named environment (cocina, baño, living…) inside a kitchen plan.
 * Walls + placements are local to the space. Presentation only — not BOM.
 */
export interface KitchenSpace {
  readonly id: string;
  readonly name: string;
  readonly walls: readonly KitchenWall[];
  readonly placements: readonly ProjectItemPlacement[];
  readonly baseClearanceMm?: number;
  readonly wallCabinetZMm?: number;
  readonly showCountertop?: boolean;
  /** Optional floor-plan underlay for this space. */
  readonly underlay?: KitchenPlanUnderlay;
}

/** Optional kitchen plan attached to a project. */
export interface ProjectKitchenLayout {
  /**
   * Active space content (mirrored from `spaces[active]` when multi-ambiente).
   * Existing consumers (3D, prune, studio) read these fields.
   */
  readonly walls: readonly KitchenWall[];
  readonly placements: readonly ProjectItemPlacement[];
  /**
   * Default clearance under floor cabinets for plinth/legs (zoclo/patas), mm.
   * Typical workshop values: 80–150. Omit → domain default (100).
   */
  readonly baseClearanceMm?: number;
  /**
   * Bottom height of wall-hung units (alacenas), mm from floor.
   * Typical 1400–1500. Omit → domain default (1400).
   */
  readonly wallCabinetZMm?: number;
  /**
   * When true, 3D shows a simple visual countertop on floor cabinets.
   * Presentation only — not BOM. Omit → true (obra look).
   */
  readonly showCountertop?: boolean;
  /**
   * Named spaces (multi-ambiente). When omitted, the top-level walls/placements
   * are treated as a single default space ("Cocina").
   */
  readonly spaces?: readonly KitchenSpace[];
  /** Id of the active space; mirrored into top-level walls/placements. */
  readonly activeSpaceId?: string;
  /** Underlay of the active space (mirrored). */
  readonly underlay?: KitchenPlanUnderlay;
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

/**
 * Volume discount tier (#202). Each tier defines a minimum quantity threshold
 * and the discount percentage applied when the project's total item quantity
 * reaches or exceeds that threshold. Tiers are evaluated highest-first: the
 * most generous applicable tier wins.
 */
export interface DiscountTier {
  /** Unique id (crypto.randomUUID or similar). */
  readonly id: string;
  /** Human-readable label shown in the UI (e.g. "10+ unidades"). */
  readonly label: string;
  /** Minimum total item quantity to activate this tier (>= 1). */
  readonly minQuantity: number;
  /** Discount percentage (0–100) applied to the sale price. */
  readonly discountPercent: number;
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
   * Optional volume discount tiers (#202). Sorted descending by minQuantity.
   * The first tier whose minQuantity <= totalItemQuantity applies.
   */
  readonly discountTiers?: readonly DiscountTier[];
  /**
   * Default option choices for all line items (F029 / #35).
   * Effective per item: item.optionChoices[role] || projectLevelChoices[role].
   * Empty/missing line values inherit the project default.
   */
  readonly projectLevelChoices?: OptionChoices;
  /**
   * Project-level measure defaults keyed by furniture type (#109 / H14).
   * When set, the add-item flow pre-selects the module preset whose depth/height
   * is closest to these values for the module's furnitureType. Per-line
   * measurePresetId always wins. Dimensions in mm.
   */
  readonly measureDefaults?: {
    readonly [type in FurnitureType]?: {
      readonly depth?: number;
      readonly height?: number;
    };
  };
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
  /**
   * Monotonic version number (#200). Defaults to 1 when absent (legacy data).
   * Incremented on each snapshot (status change or manual save).
   */
  readonly version?: number;
  /**
   * Immutable snapshots of previous versions (#200), newest first.
   * `history[0]` is always the most recently superseded version.
   */
  readonly history?: readonly ProjectVersion[];
}

/**
 * Immutable snapshot of a superseded Project version (#200).
 * Captures the full project state at a point in time so it can be restored.
 */
export interface ProjectVersion {
  readonly version: number;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly items: readonly ProjectItem[];
  readonly projectLevelChoices?: OptionChoices;
  readonly measureDefaults?: {
    readonly [type in FurnitureType]?: {
      readonly depth?: number;
      readonly height?: number;
    };
  };
  readonly kitchenLayout?: ProjectKitchenLayout;
  readonly notes?: string;
  readonly priceSnapshot?: QuotePriceSnapshot;
  readonly snapshotAt: string;
  readonly label?: string;
}

/**
 * Reusable project template (#110 / H15). Slimmed Project: no customer, status,
 * priceSnapshot, owner, or runtime-only fields (nestingImport, createdBy).
 * "Crear desde plantilla" clones a new editable draft Project from one of these
 * via `createProjectFromTemplate`. Items here do NOT carry `structureRevisionPin`
 * — a fresh quote resolves against the live structure revision.
 */
export interface ProjectTemplate {
  readonly id: string;
  readonly name: string;
  /** Default currency/margin/labor applied to projects created from this template. */
  readonly currency: string;
  readonly marginFactor: number;
  readonly laborFixedCost: number;
  readonly items: readonly ProjectItem[];
  readonly projectLevelChoices?: OptionChoices;
  readonly measureDefaults?: {
    readonly [type in FurnitureType]?: {
      readonly depth?: number;
      readonly height?: number;
    };
  };
  readonly kitchenLayout?: ProjectKitchenLayout;
  readonly installationChecklist?: readonly InstallationChecklistItem[];
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
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
  /** Workshop / business name shown in PDF exports branding. */
  readonly workshopName?: string;
}

export interface Workspace {
  readonly schemaVersion: number;
  readonly catalog: Catalog;
  readonly projects: readonly Project[];
  /**
   * Reusable project templates (#110 / H15). Optional; older workspaces omit
   * this and it's treated as []. Templates are a separate collection, NOT
   * flagged Projects, so list/dashboard/counts stay clean.
   */
  readonly projectTemplates?: readonly ProjectTemplate[];
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
  /** Percentage discount applied by tiered pricing (0 = no discount). */
  readonly discountPercent?: number;
  /** Absolute discount amount subtracted from salePrice. */
  readonly discountAmount?: number;
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
  /** Net consumption in catalog unit (e.g. meters from BOM). */
  readonly quantity: number;
  /**
   * Quantity to buy in catalog unit after package rounding.
   * Equals `quantity` when the hardware has no packageSize.
   */
  readonly purchaseQuantity: number;
  /** Packages to buy (ceil); only set when packageSize is defined. */
  readonly purchasePackages?: number;
  /** Echo of Hardware.packageSize when applied. */
  readonly packageSize?: number;
  readonly costPerUnit: number;
  /** Cost of purchaseQuantity (not raw quantity). */
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
