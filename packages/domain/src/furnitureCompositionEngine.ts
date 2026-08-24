/**
 * Smart Furniture Composition & Instantiation Engine
 * (ADR-0002 & docs/architecture/parametric-furniture-library.md)
 *
 * Pure function engine that instantiates a FurnitureDefinition with concrete
 * parameters into an AuthoringEnvelopeV1 / DesignAssembly ready for preflight.
 *
 * Invariant: Zero manufacturing logic duplicated in Ruby. SketchUp captures
 * parameters; Granete resolves components, relationships, and manufacturing truth.
 */

import type {
  AuthoringEnvelopeV1,
  Transform3D,
  ContractIssue,
  DesignAssembly,
  DesignComponent,
  HardwarePlacementIntent,
  PartRelationshipIntent,
} from "./sketchupAuthoringSchema";
import type {
  ComponentDefinition,
  FurnitureDefinition,
  FurnitureParameter,
  HardwareDefinition,
  MaterialAssignment,
  MaterialDefinition,
} from "./smartFurnitureDomain";

export interface InstantiationOptions {
  readonly projectId: string;
  readonly assemblyId?: string;
  readonly sourceRevisionId?: string;
  readonly translationMm?: readonly [number, number, number];
  readonly rotationQuaternion?: readonly [number, number, number, number];
  readonly materialOverrides?: readonly MaterialAssignment[];
}

export interface InstantiationResult {
  readonly success: boolean;
  readonly envelope?: AuthoringEnvelopeV1;
  readonly issues: readonly ContractIssue[];
}

function makeTransform(
  frame: "project" | "assembly",
  translationMm: readonly [number, number, number] = [0, 0, 0],
  rotationQuaternion: readonly [number, number, number, number] = [0, 0, 0, 1],
): Transform3D {
  return {
    frame,
    translationMm,
    rotationQuaternion,
    scale: [1, 1, 1],
  };
}

export function instantiateFurniture(
  definition: FurnitureDefinition,
  rawParams: Record<string, string | number | boolean>,
  componentCatalog: Record<string, ComponentDefinition>,
  materialCatalog: Record<string, MaterialDefinition>,
  hardwareCatalog: Record<string, HardwareDefinition>,
  options: InstantiationOptions,
): InstantiationResult {
  const issues: ContractIssue[] = [];

  // 1. Validate & evaluate parameters against definition contract
  const evaluatedParams: Record<string, number | string | boolean> = {};
  for (const param of definition.parameters) {
    const rawVal = rawParams[param.name] ?? param.defaultValue;
    const validated = validateParameter(param, rawVal);
    if (!validated.valid) {
      issues.push({
        code: "PARAMETER_OUT_OF_RANGE",
        message: `Parameter ${param.name} value ${String(rawVal)} is invalid: ${validated.error ?? "out of bounds"}`,
        severity: "error",
        entityId: definition.furnitureDefinitionId,
        remediation: `Set ${param.name} within allowed range or options.`,
      });
      continue;
    }
    evaluatedParams[param.name] = validated.value!;
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  // 2. Resolve materials and thicknesses
  const activeMaterials = options.materialOverrides ?? definition.defaultMaterialAssignments;
  const carcassMat = activeMaterials.find((m) => m.role === "carcass") ?? activeMaterials[0];
  const carcassThickness = carcassMat?.thicknessMm ?? 18;

  const widthMm = Number(evaluatedParams.widthMm ?? evaluatedParams.lengthMm ?? 600);
  const heightMm = Number(evaluatedParams.heightMm ?? 720);
  const depthMm = Number(evaluatedParams.depthMm ?? 590);

  const assemblyId = options.assemblyId ?? `asm-${definition.code.toLowerCase()}-01`;
  const components: DesignComponent[] = [];
  const relationships: PartRelationshipIntent[] = [];
  const hardwarePlacements: HardwarePlacementIntent[] = [];

  // 3. Topology-based component generation
  if (definition.category === "kitchen_base" || definition.category === "kitchen_wall" || definition.category === "closet") {
    // Left & Right side panels
    components.push({
      componentInstanceId: "side-left-01",
      componentDefinitionId: "definition-side-panel",
      role: "left-side",
      transform: makeTransform("assembly", [0, 0, 0]),
    });
    components.push({
      componentInstanceId: "side-right-01",
      componentDefinitionId: "definition-side-panel",
      role: "right-side",
      transform: makeTransform("assembly", [widthMm - carcassThickness, 0, 0]),
    });

    // Shelves
    const shelfCount = Number(evaluatedParams.shelfCount ?? 0);
    if (shelfCount > 0) {
      const spacing = heightMm / (shelfCount + 1);
      for (let i = 1; i <= shelfCount; i += 1) {
        const shelfId = `shelf-${String(i).padStart(2, "0")}`;
        const shelfZ = Math.round(spacing * i);
        components.push({
          componentInstanceId: shelfId,
          componentDefinitionId: "definition-shelf",
          role: "shelf",
          transform: makeTransform("assembly", [carcassThickness, 0, shelfZ]),
        });

        relationships.push({
          relationshipId: `rel-${shelfId}`,
          kind: "shelf-support",
          source: {
            componentInstanceId: shelfId,
            role: "shelf-board",
          },
          targets: [
            { componentInstanceId: "side-left-01", role: "inside-face" },
            { componentInstanceId: "side-right-01", role: "inside-face" },
          ],
          joinerySystemId: String(evaluatedParams.joinerySystemId ?? "minifix-dowel"),
        });
      }
    }

    // Door
    const doorCount = Number(evaluatedParams.doorCount ?? 0);
    if (doorCount === 1) {
      components.push({
        componentInstanceId: "door-01",
        componentDefinitionId: "definition-door",
        role: "door",
        transform: makeTransform("assembly", [0, depthMm, 0]),
      });

      // Hinges: top and bottom
      hardwarePlacements.push({
        hardwarePlacementId: "hp-hinge-top",
        catalogHardwareId: "hinge-softclose-110",
        hostComponentInstanceId: "side-left-01",
        anchorFace: "inside",
        offsetMm: [50, heightMm - 100],
        rotationDeg: 0,
      });
      hardwarePlacements.push({
        hardwarePlacementId: "hp-hinge-bottom",
        catalogHardwareId: "hinge-softclose-110",
        hostComponentInstanceId: "side-left-01",
        anchorFace: "inside",
        offsetMm: [50, 100],
        rotationDeg: 0,
      });
    }
  } else if (definition.category === "desk") {
    // Worktop + 2 leg panels + modesty panel
    components.push({
      componentInstanceId: "worktop-01",
      componentDefinitionId: "definition-worktop",
      role: "worktop",
      transform: makeTransform("assembly", [0, 0, heightMm - carcassThickness]),
    });
    components.push({
      componentInstanceId: "leg-left-01",
      componentDefinitionId: "definition-leg-panel",
      role: "leg",
      transform: makeTransform("assembly", [0, 0, 0]),
    });
    components.push({
      componentInstanceId: "leg-right-01",
      componentDefinitionId: "definition-leg-panel",
      role: "leg",
      transform: makeTransform("assembly", [widthMm - carcassThickness, 0, 0]),
    });
  }

  const assembly: DesignAssembly = {
    assemblyId,
    catalogItemId: "module-base-600",
    catalogRevision: "12",
    displayName: definition.name,
    transform: makeTransform("project", options.translationMm ?? [0, 0, 0], options.rotationQuaternion ?? [0, 0, 0, 1]),
    parameters: evaluatedParams,
    components,
    relationships,
    hardwarePlacements,
  };

  const envelope: AuthoringEnvelopeV1 = {
    schemaId: "granete.sketchup-authoring.v1",
    schemaName: "granete.sketchup-authoring",
    schemaVersion: "1.0",
    messageId: `msg-${Date.now()}`,
    idempotencyKey: `${options.projectId}:${options.sourceRevisionId ?? "rev-1"}`,
    sentAt: "2026-08-24T05:00:00Z",
    projectId: options.projectId,
    sourceRevisionId: options.sourceRevisionId ?? "rev-1",
    source: {
      client: "granete-for-sketchup",
      clientVersion: "0.1.0",
      host: "sketchup",
      hostVersion: "2026.2",
    },
    units: { length: "mm", angle: "deg", precisionMm: 0.01 },
    coordinateSystem: {
      handedness: "right",
      upAxis: "z",
      projectFrameId: `frame-${options.projectId}`,
    },
    mutationMode: "full-snapshot-with-tombstones",
    assemblies: [assembly],
    tombstones: [],
  };

  return {
    success: true,
    envelope,
    issues: [],
  };
}

function validateParameter(
  param: FurnitureParameter,
  val: unknown,
): { valid: boolean; value?: number | string | boolean; error?: string } {
  if (param.type === "number") {
    const num = Number(val);
    if (isNaN(num)) return { valid: false, error: "not a number" };
    if (param.min !== undefined && num < param.min) return { valid: false, error: `below min ${param.min}` };
    if (param.max !== undefined && num > param.max) return { valid: false, error: `above max ${param.max}` };
    return { valid: true, value: num };
  }
  if (param.type === "boolean") {
    return { valid: true, value: Boolean(val) };
  }
  if (param.type === "enum" || param.type === "string") {
    const str = String(val);
    if (param.options !== undefined && !param.options.includes(str)) {
      return { valid: false, error: `not in allowed options: ${param.options.join(", ")}` };
    }
    return { valid: true, value: str };
  }
  return { valid: true, value: String(val) };
}
