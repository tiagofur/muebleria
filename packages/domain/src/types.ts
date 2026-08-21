/**
 * Domain entity types — pure structural contracts (no calculation logic).
 */

import type { HardwareFinishId } from './hardwareFinishes';

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
  /**
   * Surface roughness (0..1). 0.05 = high gloss / lacquer, 0.9 = matte.
   */
  readonly previewRoughness?: number;
  /**
   * Metallic property (0..1). 0 = wood/melamine/paint, 1 = metal.
   */
  readonly previewMetalness?: number;
  /**
   * Clearcoat lacquer layer (0..1). 0 = standard finish, 0.85 = high gloss lacquer.
   */
  readonly previewClearcoat?: number;
  readonly notes?: string;
  readonly active: boolean;
}

/**
 * Surface an ambient material is intended for in the 3D room scene.
 * Presentation-only — never quoted, never in BOM/cost/export (spec #4148).
 */
export type AmbientSurfaceType = 'floor' | 'wall' | 'ceiling';

/**
 * Presentation-only material (floor tiles, wall porcelain, paint) used to
 * texture the 3D room scene. Clean separation from `MaterialBoard` (no
 * `ambientOnly` flag) is the primary leak guarantee: this type carries NO
 * pricing/BOM fields (widthMm/lengthMm/thicknessMm/boardPrice/wastePercent/
 * costPerM2/defaultEdgeBandId/grainDefault). Reuses only the `preview*` field
 * shape from MaterialBoard (spec #4148 / design #4151).
 */
export interface AmbientMaterial {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
  readonly surfaceType?: AmbientSurfaceType;
  /** Hierarchical category node id; omit/undefined for uncategorized. */
  readonly categoryId?: string;
  readonly previewColor?: string;
  readonly previewTextureUrl?: string;
  readonly previewTextureTileWidthMm?: number;
  readonly previewTextureTileLengthMm?: number;
  readonly previewRoughness?: number;
  readonly previewMetalness?: number;
  readonly previewClearcoat?: number;
}

export interface EdgeBand {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly thicknessMm: number;
  readonly costPerMl: number;
  readonly notes?: string;
  readonly active: boolean;
  /**
   * Solid color for swatches / labels (#RGB or #RRGGBB) — same hex path as
   * `MaterialBoard.previewColor` (F095: enables "metros por color" summaries
   * in edge banding).
   */
  readonly previewColor?: string;
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
  /**
   * Parametric preview shape rendered in the 3D scene. When omitted (or
   * invalid) the hardware is cost-only and renders nothing (VH-09).
   */
  readonly previewShape?: 'knob' | 'bar-pull' | 'cup-pull' | 'hinge' | 'slide' | 'rail' | 'leg';
  /** Knob diameter, bar-pull length, hinge cup diameter, slide/rail length, or leg height, in mm. */
  readonly previewSizeMm?: number;
  /** Standoff of the handle from the anchor face, in mm (0 = flush). */
  readonly previewProjectionMm?: number;
  /** Grip tube diameter (bar-pull / cup-pull), in mm. */
  readonly previewDiameterMm?: number;
  /**
   * Solid color for the preview mesh — same hex path as
   * `MaterialBoard.previewColor` (`#RGB` or `#RRGGBB`).
   */
  readonly previewColor?: string;
  /**
   * Surface roughness (0..1) — same semantics as `MaterialBoard.previewRoughness`.
   * The renderer feeds this into `boardPhysicalResponse` (PR2).
   */
  readonly previewRoughness?: number;
  /**
   * Metallic property (0..1) — same semantics as `MaterialBoard.previewMetalness`.
   */
  readonly previewMetalness?: number;
  /**
   * Clearcoat lacquer layer (0..1) — same semantics as
   * `MaterialBoard.previewClearcoat`.
   */
  readonly previewClearcoat?: number;
  /**
   * Per-part finish overrides (F080): role → finish preset id. Parts without
   * an entry (or an unknown id) fall back to the hardware's global preview*
   * finish — legacy catalogs render exactly as before.
   */
  readonly partFinishes?: Readonly<
    Partial<Record<HardwarePartRole, HardwareFinishId>>
  >;
  /**
   * CNC machining footprint (F127): the drilling operations this hardware
   * requires, per structural part, in the part-local frame of its placement
   * anchor. Omitted = cost-only hardware (no drilling derived from it).
   * Resolution to concrete per-piece holes is the drilling engine (F128).
   */
  readonly machining?: HardwareMachiningProfile;
}

/**
 * CNC machining operation a hardware part requires on its host board (F127).
 * Kinds: blind hole (fixed depth), through hole, counterbore (escareado),
 * screw pilot (piloto para tornillo/perno).
 */
export type MachiningOperationKind =
  | 'blind_hole'
  | 'through_hole'
  | 'counterbore'
  | 'screw_pilot';

/** Face the tool enters from, relative to the part's anchor face. */
export type MachiningEntryFace = 'anchor' | 'opposite';

export interface MachiningOperation {
  readonly id: string;
  readonly kind: MachiningOperationKind;
  /** Hole (or counterbore outer) diameter, mm. */
  readonly diameterMm: number;
  /** Depth from the entry face, mm. Required for blind kinds. */
  readonly depthMm?: number;
  /** Shank diameter, mm — counterbore kind only. */
  readonly innerDiameterMm?: number;
  /** Offset from the part anchor in the part-local plane, mm. */
  readonly xMm: number;
  readonly yMm: number;
  readonly face: MachiningEntryFace;
  readonly label?: string;
}

/**
 * Structural part of a hardware set that carries its own drilling (F127):
 * e.g. a minifix set has a `cam` part (Ø15 hole) and a `bolt` part (pilot).
 */
export interface HardwareMachiningPart {
  readonly id: string;
  readonly role: string;
  readonly operations: readonly MachiningOperation[];
}

export interface HardwareMachiningProfile {
  readonly parts: readonly HardwareMachiningPart[];
}

/**
 * Structural parts of a hardware piece that can carry independent finishes
 * (F080). Which roles apply depends on the preview shape — see
 * `hardwarePartRolesForShape` in hardwareFinishes.ts.
 */
export type HardwarePartRole = 'body' | 'base' | 'grip';

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

// --- Hierarchical categories (generic, max 3 levels) ---

export interface CategoryNode {
  readonly id: string;
  readonly name: string;
  /** Parent category id; omit/undefined for root-level categories. */
  readonly parentId?: string;
  readonly sortOrder: number;
}

// --- Module categories ---

/**
 * User-defined category for classifying module templates.
 * Roots have no parentId; depth is 1..3 (root = 1).
 */
export type ModuleCategory = CategoryNode;

// --- Ambient / Finish material categories ---

/**
 * User-defined category for classifying ambient/finish materials (textures, finishes).
 * Roots have no parentId; depth is 1..3 (root = 1).
 */
export type AmbientCategory = CategoryNode;

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
  /** Sub-assembly instances placed directly on this module (e.g. doors with hinges, drawers). */
  readonly agregados?: readonly ModuleAgregadoInstance[];
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
  /** Sub-assembly instances placed on this structure. */
  readonly agregados?: readonly ModuleAgregadoInstance[];
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
  readonly agregados?: readonly ModuleAgregadoInstance[];
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

/**
 * Board face a piece of hardware is anchored to, expressed in the board-LOCAL
 * frame (local X = width, Y = thickness, Z = length). This is a visualization
 * anchor — distinct from {@link Perforation} which models CNC machining and has
 * a different lifecycle/consumers (VH-02).
 */
export type AnchorFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/**
 * Visualization anchor for a piece of hardware on a board face. The position is
 * expressed in millimeters from the face's origin corner along the two in-plane
 * axes — fixed and independent of the resolved board size (a handle at 38 mm
 * from the edge stays at 38 mm regardless of the door width). This is the data
 * the CNC perforation pipeline consumes. Optional per-instance rotation/scale.
 * Rides the component-instance overrides JSONB — no dedicated migration (VH-02).
 * Distinct from {@link Perforation} (CNC/machining).
 */
export interface HardwarePlacement {
  readonly hardwareId: string;
  readonly anchorFace: AnchorFace;
  readonly relativePosition: {
    readonly xMm: number;
    readonly yMm: number;
    readonly xFormula?: string;
    readonly yFormula?: string;
  };
  readonly rotationDeg?: { readonly x?: number; readonly y?: number; readonly z?: number };
  readonly scale?: number;
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
    /**
     * Visualization anchors for parametric handles on this board instance
     * (VH-02). Rides this overrides JSONB — no dedicated migration. The
     * renderer resolves each via `resolveHardwarePlacement` (PR2).
     */
    readonly hardwarePlacements?: readonly HardwarePlacement[];
  };
}

/**
 * A reusable sub-assembly composed of ComponentInstances + HardwareLines.
 * Examples: a drawer, a door with hinges and handle, a divider panel group.
 * Added to a module via ModuleAgregadoInstance (quantity + optional mirror flag).
 */
export interface Agregado {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly notes?: string;
  readonly active?: boolean;
  /**
   * Reference (bounding-box) dimensions for the sub-assembly.
   * W/H/D formulas in child components resolve against these.
   */
  readonly externalDims?: ExternalDims;
  /** Board components that make up this sub-assembly. */
  readonly components?: readonly ModuleComponentInstance[];
  /** Fixed hardware included per unit (bisagras, correderas, jaladeras, etc.). */
  readonly hardwareLines?: readonly HardwareLine[];
}

/**
 * Reference to an Agregado placed inside a Module or Structure, with
 * spatial positioning, local bounding box, stacking, and overrides.
 */
export interface ModuleAgregadoInstance {
  readonly id?: string;
  readonly agregadoId: string;
  readonly name?: string;
  /** Spatial position (X, Y, Z formulas or mm) inside the parent furniture piece. */
  readonly position?: {
    readonly xFormula?: string;
    readonly yFormula?: string;
    readonly zFormula?: string;
  };
  /** Local bounding box dimensions (W, H, D formulas or mm) for the sub-assembly space. */
  readonly dimensions?: {
    readonly widthFormula?: string;
    readonly heightFormula?: string;
    readonly depthFormula?: string;
  };
  readonly quantity: number;
  /** Direction for distributing N units (e.g. vertical stack of drawers). */
  readonly layoutDirection?: 'vertical' | 'horizontal' | 'none';
  /** Clearance/gap between stacked units in mm (default 0). */
  readonly gapMm?: number;
  /** When true, the sub-assembly is mirrored (e.g. door opening to the opposite side). */
  readonly mirrored?: boolean;
  /** Hardware option overrides per instance (e.g. { JALADERA: 'jaladera-gola-256' }). */
  readonly optionOverrides?: Record<string, string>;
}

// --- Project / quotation ---

/**
 * Shop-floor pipeline status per line item (PROD-3.1 / #226).
 * Factory-only; does not affect BOM, price, or design.
 */
export type ItemFloorStatus =
  | 'pending'
  | 'cut'
  | 'edged'
  | 'assembled'
  | 'packaged'
  | 'loaded'
  | 'installed';

/** How a floor transition was performed (F092; 'activity' = F094 claim finish). */
export type FloorEventSource = 'scan' | 'manual' | 'dispatch' | 'api' | 'activity';

/**
 * Immutable entry of the shop-floor log (F092): one per floor status
 * transition, answering who/when/how. Never mutated — history only.
 */
export interface FloorStatusEvent {
  readonly id: string;
  readonly projectId: string;
  readonly itemId: string;
  readonly from: ItemFloorStatus;
  readonly to: ItemFloorStatus;
  /** ISO timestamp of the transition. */
  readonly at: string;
  readonly byUserId?: string;
  readonly byName?: string;
  readonly source: FloorEventSource;
  /** Reason when the transition skipped stages (jump), e.g. dispatch loading. */
  readonly note?: string;
}

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
   * Base treatment override for this line (F087): how the unit meets the floor
   * (zoclo board / purchased profile / legs / none). Wins over the catalog
   * module's `baseMode`; written at add-to-project time from the furniture
   * type default and editable per item in Proyectar.
   */
  readonly baseMode?: ModuleBaseMode;
  /**
   * Pinned structure revision (#108). Pegged onto the item when the project is
   * closed (quoted/accepted/produced) so later structure edits don't mutate the
   * frozen BOM. Re-resolving uses `resolveStructureRevision(structure, pin)`.
   */
  readonly structureRevisionPin?: number;
  /**
   * Floor progress (PROD-3.1). Omitted = pending.
   */
  readonly floorStatus?: ItemFloorStatus;
}

/**
 * Factory OP tracking (PROD-3.2 / #227).
 * Revision + fingerprints for stale-export warnings; independent of quote `version`.
 */
export interface ProjectProductionState {
  /** Monotonic OP revision (starts at 1 when plant-ready). */
  readonly revision: number;
  readonly revisionAt: string;
  /** Design fingerprint at last revision freeze. */
  readonly fingerprint?: string;
  readonly lastExportRevision?: number;
  readonly lastExportAt?: string;
  /** Design fingerprint when last factory export was generated. */
  readonly lastExportFingerprint?: string;
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
  /** Optional per-wall ambient material override. Omit = inherit space wallMaterialId. */
  readonly wallMaterialId?: string;
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
  /**
   * Ambient floor material for the 3D room scene (presentation-only, #4148).
   * Resolves against `Catalog.ambientMaterials` (surfaceType 'floor'). Omit = none.
   */
  readonly floorMaterialId?: string;
  /**
   * Ambient wall material for the 3D room scene (presentation-only, #4148).
   * Resolves against `Catalog.ambientMaterials` (surfaceType 'wall'). Omit = none.
   */
  readonly wallMaterialId?: string;
  /**
   * Ambient ceiling material for the 3D room scene (presentation-only).
   * Resolves against `Catalog.ambientMaterials` (surfaceType 'ceiling'). Omit = default white paint.
   */
  readonly ceilingMaterialId?: string;
  /**
   * Ambient countertop material for the 3D room scene (presentation-only).
   * Resolves against `Catalog.ambientMaterials`. Omit = default color.
   */
  readonly countertopMaterialId?: string;
  /** Show the room ceiling in the 3D scene (Q1, #4151). Default undefined = OFF. */
  readonly showCeiling?: boolean;
  /** Optional floor-plan underlay for this space. */
  readonly underlay?: KitchenPlanUnderlay;
}

/**
 * Soft lock: who is editing the kitchen plan (Proyectar).
 * Expires if not renewed — prevents silent multi-user overwrite without OT.
 */
export interface ProjectPlanEditSession {
  readonly userId: string;
  readonly userName: string;
  /** ISO-8601 expiry; after this the session is free. */
  readonly expiresAt: string;
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
   * Ambient countertop material for the 3D room scene (presentation-only).
   * Mirror of active space's ref. Omit = default color.
   */
   readonly countertopMaterialId?: string;
  /**
   * Ambient floor material for the 3D room scene (presentation-only, #4148).
   * Mirror of the active space's ref — resolved against
   * `Catalog.ambientMaterials` (surfaceType 'floor') by the caller. Omit = none.
   */
   readonly floorMaterialId?: string;
  /**
   * Ambient wall material for the 3D room scene (presentation-only, #4148).
   * Mirror of the active space's ref. Omit = none.
   */
   readonly wallMaterialId?: string;
  /**
   * Ambient ceiling material for the 3D room scene (presentation-only).
   * Mirror of the active space's ref. Omit = default white paint.
   */
   readonly ceilingMaterialId?: string;
  /** Show the room ceiling in the 3D scene (Q1, #4151). Mirror of active space. */
   readonly showCeiling?: boolean;
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
  /**
   * Technical / Production engineer in charge (CRM Phase 2).
   */
  readonly assignedEngineerId?: string;
  /**
   * Engineering & production lifecycle stage (CRM Phase 2).
   */
  readonly technicalStatus?: ProjectTechnicalStatus;
  /**
   * Date/time when site measurements/survey were completed.
   */
  readonly surveyCompletedAt?: string;
  /**
   * Planned installation date in Obra (YYYY-MM-DD).
   */
  readonly installationScheduledDate?: string;
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
   * Soft lock for Proyectar multi-user collaboration.
   * When present and not expired, another editor should open read-only.
   */
  readonly planEditSession?: ProjectPlanEditSession;
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
  /**
   * 2D Guillotine Cut Plan for board cutting & warehouse exact sheet requisition (F115).
   */
  readonly cutPlan?: import('./optimizer/types').CutPlan;
  /**
   * Factory OP revision / export tracking (PROD-3.2 / #227).
   */
  readonly production?: ProjectProductionState;
  /**
   * Shop-floor transition log (F092), oldest first. Appended on every
   * floor status change (web, floor-scan, dispatch) so the workshop can
   * answer who/when/how. Local JSON repos persist it inside the project;
   * the Go API serves it from `project_item_floor_events`.
   */
  readonly floorEvents?: readonly FloorStatusEvent[];
  /**
   * Engineering audit log. Records who started engineering, when docs
   * were generated, and when the project was sent to production.
   */
  readonly engineeringLog?: import('./engineering').EngineeringLog;
  /**
   * Almacén's explicit "materials complete" release stamp — the gate that
   * makes the project visible to the production floor (processStage).
   */
  readonly materialsRelease?: import('./processStage').MaterialsRelease;
  readonly cancelledAt?: string;                          // ISO timestamp — explicit cancel
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

/** Lifecycle stage for a project photo. */
export type ProjectPhotoStage = 'survey' | 'in_workshop' | 'installed' | 'delivery_receipt';

/** Photo attached to a project gallery across its lifecycle. */
export interface ProjectPhoto {
  readonly id: string;
  readonly projectId: string;
  readonly stage: ProjectPhotoStage;
  readonly url: string;
  readonly thumbnailUrl?: string;
  readonly caption?: string;
  readonly isShowcase: boolean;
  readonly createdBy?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/** Technical status of a project in engineering and production. */
export type ProjectTechnicalStatus =
  | 'pending_assignment'
  | 'in_review'
  | 'changes_requested'
  | 'approved_for_production'
  | 'in_workshop'
  | 'ready_to_install'
  | 'installed'
  | 'completed';

/** Classification for internal messages and collaboration queries. */
export type ProjectInternalMessageType =
  | 'comment'
  | 'technical_query'
  | 'query_response'
  | 'design_change'
  | 'production_alert'
  | 'gate_approval';

/** Internal communication message between sales, engineering and workshop. */
export interface ProjectInternalMessage {
  readonly id: string;
  readonly projectId: string;
  readonly senderId?: string;
  readonly senderName: string;
  readonly messageType: ProjectInternalMessageType;
  readonly content: string;
  readonly isResolved: boolean;
  readonly attachments?: readonly string[];
  readonly createdAt: string;
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
  /**
   * Ambient materials catalog (presentation-only, #4148). Omitted/undefined
   * treated as [] for older workspaces. Codes are unique within this collection
   * (NOT shared namespace with `materials` board codes).
   */
  readonly ambientMaterials?: readonly AmbientMaterial[];
  /** Hierarchical ambient/finish categories (up to 3 levels). */
  readonly ambientCategories?: readonly AmbientCategory[];
  readonly customers?: readonly Customer[];
  /** Reusable components catalog (F049 / H07). */
  readonly components?: readonly Component[];
  /** Reusable sub-assemblies (agregados): drawers, doors with hardware, etc. */
  readonly agregados?: readonly Agregado[];
  readonly users?: readonly User[];
}

/**
 * Global workshop defaults for new quotations (F031 / #37).
 * Does not mutate existing projects when changed.
 */
export interface WorkshopTrimMargins {
  readonly topMm: number;
  readonly bottomMm: number;
  readonly leftMm: number;
  readonly rightMm: number;
}

/**
 * Cutting strategy for the 2D optimizer (F124): guillotine saw or CNC nesting.
 * Lives here (not in optimizer/) so `WorkshopSettings.defaultCutStrategy` can
 * reference it without an import cycle; optimizer/types re-exports it.
 */
export type CutStrategy = 'saw-guillotine' | 'cnc-nesting';

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
  /**
   * Default PTX packaging mode for beam saws:
   * - 'unified': single .ptx file containing all materials.
   * - 'by-material': separate .ptx files per finish/thickness, bundled in .zip.
   */
  readonly ptxExportMode?: 'unified' | 'by-material';
  /** Default saw blade kerf thickness (mm) for 2D guillotine optimization (e.g. 4.4 mm). */
  readonly defaultSawKerfMm?: number;
  /** Default perimetral trim margins (mm) around raw boards. */
  readonly defaultTrimMargins?: WorkshopTrimMargins;
  /**
   * Default edgeband deduction policy:
   * - true: deduct edgeband thickness from raw piece cut dimensions (manual edgebander).
   * - false: cut to finished dimension (edgebander with pre-milling / tupí).
   */
  readonly defaultDeductEdgeBand?: boolean;
  /**
   * Default cut strategy for projects without a generated plan yet (F133):
   * guillotine saw or CNC nesting. Per-project choice (Ingeniería →
   * Optimización, F126) always wins over this default.
   */
  readonly defaultCutStrategy?: CutStrategy;
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
  /** Material identity for workshop lists (cut row stays name-compatible). */
  readonly materialCode?: string;
  /** Board thickness in mm from the resolved part. */
  readonly thicknessMm?: number;
  /**
   * Assigned edge band for this row's banded sides — what to load in the
   * edge bander. Undefined when no single band applies / part has none.
   */
  readonly edgeBandCode?: string;
  readonly edgeBandName?: string;
  readonly edgeBandThicknessMm?: number;
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
  readonly thicknessMm?: number;
  readonly grain?: 0 | 1;
  readonly materialCode: string;
  readonly materialName: string;
  readonly edgeBandCode?: string;
  readonly edgeBandName?: string;
  readonly edgeBandThicknessMm?: number;
  readonly L1: boolean;
  readonly L2: boolean;
  readonly W1: boolean;
  readonly W2: boolean;
  /** Spanish workshop instruction (sides + edge band when known). */
  readonly edgeBandingInstruction: string;
}

/**
 * Module / furniture / package label for workshop print, assembly, and dispatch tracking.
 */
export interface ModuleLabel {
  readonly itemId: string;
  /** Unique factory code within the project, e.g. "GAB-01" or "GAB-01-L2" */
  readonly factoryCode: string;
  readonly moduleCode: string;
  readonly moduleName: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly customerName?: string;
  /** Index of this unit among all physical module packages in the project (1-based) */
  readonly packageIndex: number;
  /** Total number of module packages in the project scope */
  readonly totalPackages: number;
  /** Physical unit copy number for this item line (1..item.quantity) */
  readonly unitIndex: number;
  /** Total quantity of this item line */
  readonly unitQuantity: number;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
  readonly depthMm: number | null;
  readonly measuresLabel: string;
  /** Associated space / room / wall if placed in layout */
  readonly spaceName?: string;
  readonly wallName?: string;
  /** Floor status at the time of resolution */
  readonly floorStatus: string;
  /** Count of board parts and hardware items inside this module */
  readonly boardPartCount: number;
  readonly hardwareCount: number;
  /** Order revision when generated */
  readonly revision?: string;
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

// ---------------------------------------------------------------------------
// Warranty Desk & Post-Sale Tickets (CRM Phase 3)
// ---------------------------------------------------------------------------

export type WarrantyTicketCategory =
  | 'hardware_adjustment'
  | 'damaged_part'
  | 'finishing_defect'
  | 'installation_issue'
  | 'other';

export type WarrantyTicketPriority = 'low' | 'normal' | 'urgent';

export type WarrantyTicketStatus =
  | 'open'
  | 'visit_scheduled'
  | 'in_progress'
  | 'resolved'
  | 'cancelled';

export type WarrantyPhotoKind = 'issue_report' | 'resolution_proof';

export interface WarrantyRefabricationPiece {
  readonly pieceDescription: string;
  readonly materialName: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly quantity: number;
  readonly grain: Grain;
  readonly L1: 0 | 1;
  readonly L2: 0 | 1;
  readonly W1: 0 | 1;
  readonly W2: 0 | 1;
  readonly partName?: string;
  readonly partCode?: string;
  readonly moduleCode?: string;
  readonly notes?: string;
}

export interface WarrantyTicketPhoto {
  readonly id: string;
  readonly ticketId: string;
  readonly kind: WarrantyPhotoKind;
  readonly url: string;
  readonly thumbnailUrl: string;
  readonly caption?: string;
  readonly createdAt: string;
}

export interface WarrantyTicket {
  readonly id: string;
  readonly ticketNumber: string;
  readonly projectId: string;
  readonly customerId?: string;
  readonly title: string;
  readonly description: string;
  readonly category: WarrantyTicketCategory;
  readonly priority: WarrantyTicketPriority;
  readonly status: WarrantyTicketStatus;
  readonly assignedTechnicianId?: string;
  readonly scheduledDate?: string;
  readonly resolvedAt?: string;
  readonly resolutionNotes?: string;
  readonly refabricationPieces: readonly WarrantyRefabricationPiece[];
  readonly photos: readonly WarrantyTicketPhoto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

