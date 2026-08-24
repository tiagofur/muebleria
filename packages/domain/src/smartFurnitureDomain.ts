/**
 * Canonical Smart Parametric Furniture Domain Model
 * (ADR-0002 & docs/architecture/parametric-furniture-library.md)
 *
 * Models the 7 decoupled primitives:
 * 1. Asset (multi-representation 3D/PBR digital asset)
 * 2. MaterialDefinition (raw sheet/board goods in catalog)
 * 3. MaterialAssignment (dynamic role-to-material binding)
 * 4. HardwareDefinition (commercial, technical, visual, drilling hardware)
 * 5. ComponentDefinition (reusable building block with part derivation rules)
 * 6. FurnitureDefinition (versioned parametric template)
 * 7. FurnitureInstance (project-level instantiated assembly)
 *
 * Invariant: Granete is not a fixed cabinet catalog. It is an open furniture
 * composition and manufacturing platform.
 */

import type { HoleType } from "./partDrilling";

// 1. Asset: Digital 3D & Visual Resource with Multi-Representation Support
export type AssetRepresentationFormat =
  | "sketchup_component"
  | "gltf"
  | "glb"
  | "obj"
  | "blender"
  | "revit_family"
  | "render_scene"
  | "thumbnail"
  | "texture_pbr";

export interface AssetRepresentation {
  readonly format: AssetRepresentationFormat;
  readonly uri: string;
  readonly purpose?: "authoring" | "realtime_3d" | "rendering" | "thumbnail" | "ar";
  readonly lod?: "lod0" | "lod1" | "lod2" | "preview";
  readonly byteSize?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Asset {
  readonly assetId: string;
  readonly name: string;
  readonly defaultFormat: AssetRepresentationFormat;
  readonly uri: string;
  readonly representations?: readonly AssetRepresentation[];
  readonly thumbnailUri?: string;
  readonly visualProperties?: {
    readonly textureUri?: string;
    readonly normalMapUri?: string;
    readonly roughness?: number;
    readonly metalness?: number;
    readonly colorHex?: string;
  };
  readonly boundingBoxMm?: readonly [number, number, number];
}

// 2. MaterialDefinition: Raw Material in Catalog / Inventory
export type MaterialCategory =
  | "melamine"
  | "mdf"
  | "plywood"
  | "solid_wood"
  | "glass"
  | "metal"
  | "edgeband";

export interface MaterialDefinition {
  readonly materialId: string;
  readonly materialCode: string;
  readonly name: string;
  readonly category: MaterialCategory;
  readonly supplier?: string;
  readonly costPerUnit?: number;
  readonly pricePerUnit?: number;
  readonly currency?: string;
  readonly thicknessMm: number;
  readonly sheetLengthMm?: number;
  readonly sheetWidthMm?: number;
  readonly grainDirection: "length" | "width" | "none";
  readonly compatibleEdgeBandIds?: readonly string[];
  readonly visualAssetId?: string;
}

// 3. MaterialAssignment: Role-Based Material & Edging Binding
export interface MaterialAssignment {
  readonly assignmentId: string;
  readonly role: string; // e.g. "carcass", "front", "shelf", "back_panel", "worktop", "drawer_box"
  readonly materialId: string;
  readonly thicknessMm: number;
  readonly grainDirection?: "length" | "width" | "none";
  readonly edgeBandId?: string;
  readonly edgeBandThicknessMm?: number;
  readonly visualAssetId?: string;
}

// 4. HardwareDefinition: Commercial, Technical, Visual & Drilling Rules
export type HardwareCategory =
  | "hinge"
  | "slide"
  | "handle"
  | "connector"
  | "shelf_pin"
  | "leg"
  | "hanging_cleat"
  | "accessory";

export interface HardwarePlacementRule {
  readonly defaultFace: "front" | "back" | "left" | "right" | "top" | "bottom" | "inside";
  readonly marginMm: number;
  readonly systemLineMm?: number;
  readonly maxSpacingMm?: number;
}

export interface HardwareDefinition {
  readonly hardwareId: string;
  readonly code: string;
  readonly name: string;
  readonly brand?: string;
  readonly category: HardwareCategory;
  readonly assetId?: string;
  readonly dimensionsMm?: readonly [number, number, number];
  readonly pilotDiameterMm?: number;
  readonly pilotDepthMm?: number;
  readonly holeType?: HoleType;
  readonly placementRules?: HardwarePlacementRule;
}

// 5. ComponentDefinition: Reusable Building Block with Part Derivation Rules
export type ComponentCategory =
  | "panel_lateral"
  | "panel_horizontal"
  | "panel_back"
  | "door"
  | "drawer_front"
  | "drawer_box"
  | "shelf"
  | "divider"
  | "stretcher"
  | "worktop"
  | "plinth"
  | "leg"
  | "accessory";

export interface ComponentPartDerivationRule {
  readonly partRole: string;
  readonly sizingFormula?: {
    readonly lengthFormula?: string;
    readonly widthFormula?: string;
    readonly thicknessFormula?: string;
  };
  readonly edgeBandingRule?: {
    readonly top?: boolean;
    readonly bottom?: boolean;
    readonly left?: boolean;
    readonly right?: boolean;
    readonly edgeBandRole?: string;
  };
  readonly grainDirection?: "length" | "width" | "none";
}

export interface ComponentDefinition {
  readonly componentDefinitionId: string;
  readonly code: string;
  readonly name: string;
  readonly category: ComponentCategory;
  readonly boardLocal: "lateral" | "horizontal" | "door" | "back" | "custom";
  readonly defaultThicknessMm: number;
  readonly assetId?: string;
  readonly compatibleHardwareCategories?: readonly HardwareCategory[];
  readonly partDerivationRule?: ComponentPartDerivationRule;
}

// 6. FurnitureDefinition: Versioned Parametric Furniture Template
export type ParameterType = "number" | "string" | "boolean" | "enum";

export interface FurnitureParameter {
  readonly name: string;
  readonly label: string;
  readonly type: ParameterType;
  readonly defaultValue: string | number | boolean;
  readonly unit?: "mm" | "deg" | "count";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly category: "dimension" | "configuration" | "style" | "hardware";
}

export interface FurnitureComponentSlot {
  readonly slotId: string;
  readonly role: string; // e.g. "left_side", "right_side", "bottom_panel", "shelf", "door"
  readonly componentDefinitionId: string;
  readonly defaultMaterialRole: string; // references MaterialAssignment.role
  readonly quantityParameter?: string; // e.g. "shelfCount"
  readonly conditionParameter?: string; // e.g. "hasBackPanel"
}

export interface FurnitureRelationshipTemplate {
  readonly templateId: string;
  readonly kind: string; // e.g. "shelf-support", "panel-joint", "drawer-runner"
  readonly sourceRole: string;
  readonly targetRoles: readonly string[];
  readonly defaultJoinerySystemId: string;
}

export interface FurnitureDefinition {
  readonly furnitureDefinitionId: string;
  readonly code: string;
  readonly name: string;
  readonly category: string; // "kitchen_base" | "kitchen_wall" | "closet" | "desk" | "table" | "vanity" | etc.
  readonly version: string; // semver e.g. "1.0.0"
  readonly revisionId?: string; // e.g. "rev-1"
  readonly schemaRevision?: number; // e.g. 1
  readonly definitionHash?: string; // cryptographic content hash
  readonly description?: string;
  readonly assetId?: string;
  readonly parameters: readonly FurnitureParameter[];
  readonly componentSlots: readonly FurnitureComponentSlot[];
  readonly relationshipTemplates: readonly FurnitureRelationshipTemplate[];
  readonly defaultMaterialAssignments: readonly MaterialAssignment[];
}

// 7. FurnitureInstance: Concrete Placement in Project
export interface FurnitureInstance {
  readonly furnitureInstanceId: string;
  readonly furnitureDefinitionId: string;
  readonly definitionVersion: string;
  readonly name: string;
  readonly assemblyId: string;
  readonly transform: {
    readonly translationMm: readonly [number, number, number];
    readonly rotationDeg: readonly [number, number, number];
  };
  readonly evaluatedParameters: Readonly<Record<string, string | number | boolean>>;
  readonly materialAssignments: readonly MaterialAssignment[];
}
