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
  ComponentInstance,
  FurnitureDefinition,
  FurnitureInstance,
  HardwareDefinition,
  InteractiveValidationIssue,
  InteractiveValidationResult,
  MaterialAssignment,
  MaterialDefinition,
  PartInstance,
  ResolvedFurnitureLayout,
} from "./smartFurnitureDomain";
import {
  evaluateFurnitureParameters,
  FurnitureParameterDefinitionsError,
  type FurnitureParameterIssue,
} from "./furnitureParameters";

type InteractiveParameterEvaluation = {
  readonly normalized: Readonly<Record<string, string | number | boolean>>;
  readonly validation: InteractiveValidationResult;
};

const FURNITURE_DEFINITION_FIELDS = new Set([
  "furnitureDefinitionId", "code", "name", "category", "version", "revisionId",
  "schemaRevision", "definitionHash", "description", "assetId", "parameters",
  "componentSlots", "relationshipTemplates", "defaultMaterialAssignments",
]);

function evaluateFurnitureDefinitionParameters(
  definition: FurnitureDefinition,
  rawParameters: Record<string, string | number | boolean>,
) {
  if (definition === null || typeof definition !== "object" || Array.isArray(definition)) {
    throw new FurnitureParameterDefinitionsError([{
      parameter: "",
      field: "definition",
      message: "must be an object",
    }]);
  }
  const unknownFields = Object.keys(definition).filter((field) => !FURNITURE_DEFINITION_FIELDS.has(field));
  if (unknownFields.length !== 0) {
    throw new FurnitureParameterDefinitionsError(unknownFields.map((field) => ({
      parameter: "",
      field: `definition.${field}`,
      message: "is not supported",
    })));
  }
  if (!Array.isArray(definition.parameters)) {
    throw new FurnitureParameterDefinitionsError([{
      parameter: "",
      field: "parameters",
      message: "must be an array",
    }]);
  }
  if (!Array.isArray(definition.componentSlots)) {
    throw new FurnitureParameterDefinitionsError([{
      parameter: "",
      field: "componentSlots",
      message: "must be an array",
    }]);
  }
  const conditionIssues = definition.parameters.flatMap((parameter) => {
    if (parameter?.binding?.kind !== "componentCondition") return [];
    const directTargets = definition.componentSlots.filter(
      (slot) => slot?.componentDefinitionId === parameter.binding!.componentId,
    );
    return directTargets.length === 1 ? [] : [{
      parameter: parameter.name,
      field: "binding.componentId",
      message: "componentCondition must target exactly one direct component slot",
    }];
  });
  if (conditionIssues.length !== 0) throw new FurnitureParameterDefinitionsError(conditionIssues);
  return evaluateFurnitureParameters(definition.parameters, rawParameters);
}

function parameterContractIssue(
  definition: FurnitureDefinition,
  issue: FurnitureParameterIssue,
): ContractIssue {
  const parameter = definition.parameters.find((candidate) => candidate.name === issue.parameter);
  return {
    code: issue.code,
    message: parameterIssueMessage(parameter?.label ?? issue.parameter, issue.code),
    severity: "error",
    entityId: definition.furnitureDefinitionId,
    path: `parameters.${issue.parameter}`,
    details: { parameterName: issue.parameter, ...issue.details },
    remediation: `Correct ${parameter?.label ?? issue.parameter} before resolving the furniture.`,
  };
}

function evaluateInteractive(
  definition: FurnitureDefinition,
  rawParameters: Record<string, string | number | boolean>,
): InteractiveParameterEvaluation {
  try {
    const evaluation = evaluateFurnitureDefinitionParameters(definition, rawParameters);
    const issues = evaluation.issues.map((issue): InteractiveValidationIssue => {
      const parameter = definition.parameters.find((candidate) => candidate.name === issue.parameter);
      return {
        code: issue.code,
        message: parameterIssueMessage(parameter?.label ?? issue.parameter, issue.code),
        severity: "error",
        parameterName: issue.parameter,
        details: issue.details,
      };
    });
    return {
      normalized: evaluation.normalized,
      validation: { valid: issues.length === 0, issues },
    };
  } catch (error) {
    if (!(error instanceof FurnitureParameterDefinitionsError)) throw error;
    const issues = error.issues.map((issue): InteractiveValidationIssue => ({
      code: "PARAMETER_DEFINITION_INVALID",
      message: `La definición de ${issue.parameter || "parámetros"} es inválida: ${issue.message}.`,
      severity: "error",
      parameterName: issue.parameter || undefined,
      details: { field: issue.field },
    }));
    return { normalized: {}, validation: { valid: false, issues } };
  }
}

function parameterIssueMessage(label: string, code: FurnitureParameterIssue["code"]): string {
  switch (code) {
    case "PARAMETER_UNKNOWN":
      return `El parámetro ${label} no está declarado en la definición.`;
    case "PARAMETER_REQUIRED":
      return `El parámetro ${label} es obligatorio.`;
    case "PARAMETER_TYPE_INVALID":
      return `El parámetro ${label} tiene un tipo de dato inválido.`;
    case "PARAMETER_OUT_OF_RANGE":
      return `El parámetro ${label} está fuera del rango permitido.`;
    case "PARAMETER_STEP_INVALID":
      return `El parámetro ${label} no respeta el incremento permitido.`;
    case "PARAMETER_ENUM_INVALID":
      return `El parámetro ${label} no contiene una opción permitida.`;
    case "PARAMETER_STRING_TOO_LONG":
      return `El parámetro ${label} supera la longitud permitida.`;
  }
}

function excludedComponentDefinitionIds(
  definition: FurnitureDefinition,
  parameters: Readonly<Record<string, string | number | boolean>>,
): ReadonlySet<string> {
  const excluded = new Set<string>();
  for (const parameter of definition.parameters) {
    if (parameter.binding?.kind === "componentCondition" && parameters[parameter.name] === false) {
      excluded.add(parameter.binding.componentId!);
    }
  }
  return excluded;
}

export interface InstantiationOptions {
  readonly projectId: string;
  readonly assemblyId?: string;
  readonly sourceRevisionId?: string;
  readonly translationMm?: readonly [number, number, number];
  readonly rotationQuaternion?: readonly [number, number, number, number];
  readonly materialOverrides?: readonly MaterialAssignment[];
  readonly authoringClient?: {
    readonly name: string;
    readonly version: string;
    readonly extensionVersion?: string;
  };
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

  // 1. Validate & evaluate parameters against the canonical strict contract.
  let evaluatedParams: Readonly<Record<string, number | string | boolean>> = {};
  try {
    const evaluation = evaluateFurnitureDefinitionParameters(definition, rawParams);
    evaluatedParams = evaluation.normalized;
    issues.push(...evaluation.issues.map((issue) => parameterContractIssue(definition, issue)));
  } catch (error) {
    if (!(error instanceof FurnitureParameterDefinitionsError)) throw error;
    issues.push(...error.issues.map((issue) => ({
      code: "PARAMETER_DEFINITION_INVALID",
      message: `Parameter definition ${issue.parameter || "catalog"} is invalid: ${issue.message}`,
      severity: "error" as const,
      entityId: definition.furnitureDefinitionId,
      path: issue.parameter ? `parameters.${issue.parameter}.${issue.field}` : `parameters.${issue.field}`,
      details: { parameterName: issue.parameter, field: issue.field },
      remediation: "Correct and republish the furniture definition before resolving it.",
    })));
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

  for (const parameter of definition.parameters) {
    if (parameter.binding?.kind !== "componentCondition" || evaluatedParams[parameter.name] !== true) continue;
    const slot = definition.componentSlots.find(
      (candidate) => candidate.componentDefinitionId === parameter.binding!.componentId,
    );
    if (!slot || components.some((component) => component.componentDefinitionId === slot.componentDefinitionId)) continue;
    components.push({
      componentInstanceId: `condition-${slot.slotId}-01`,
      componentDefinitionId: slot.componentDefinitionId,
      role: slot.role,
      transform: makeTransform("assembly"),
    });
  }

  const excludedDefinitionIds = excludedComponentDefinitionIds(definition, evaluatedParams);
  const activeComponents = components.filter((component) => !excludedDefinitionIds.has(component.componentDefinitionId));
  const activeComponentIds = new Set(activeComponents.map((component) => component.componentInstanceId));
  const activeRelationships = relationships.filter((relationship) =>
    activeComponentIds.has(relationship.source.componentInstanceId) &&
    relationship.targets.every((target) => activeComponentIds.has(target.componentInstanceId))
  );
  const activeHardwarePlacements = hardwarePlacements.filter((placement) =>
    activeComponentIds.has(placement.hostComponentInstanceId)
  );

  const assembly: DesignAssembly = {
    assemblyId,
    catalogItemId: "module-base-600",
    catalogRevision: "12",
    displayName: definition.name,
    transform: makeTransform("project", options.translationMm ?? [0, 0, 0], options.rotationQuaternion ?? [0, 0, 0, 1]),
    parameters: evaluatedParams,
    components: activeComponents,
    relationships: activeRelationships,
    hardwarePlacements: activeHardwarePlacements,
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

/**
 * Lightweight interactive preflight validation for UI forms.
 */
export function validateInteractiveParameters(
  definition: FurnitureDefinition,
  rawParameters: Record<string, string | number | boolean>
): InteractiveValidationResult {
  return evaluateInteractive(definition, rawParameters).validation;
}

/**
 * Resolves full component and part layout with millimeter precision
 * for renderer/adapter consumption.
 */
export function resolveFurnitureLayout(
  definition: FurnitureDefinition,
  rawParameters: Record<string, string | number | boolean>,
  componentCatalog: Record<string, ComponentDefinition> = {},
  materialCatalog: Record<string, MaterialDefinition> = {},
  hardwareCatalog: Record<string, HardwareDefinition> = {},
  options: InstantiationOptions = { projectId: "project-active" }
): ResolvedFurnitureLayout {
  const evaluation = evaluateInteractive(definition, rawParameters);
  const { validation } = evaluation;
  const assemblyId = options.assemblyId ?? `assembly-${definition.furnitureDefinitionId}-1`;
  const furnitureInstanceId = `inst-${definition.furnitureDefinitionId}-1`;
  const evaluated = evaluation.normalized;

  const furnitureInstance: FurnitureInstance = {
    furnitureInstanceId,
    furnitureDefinitionId: definition.furnitureDefinitionId,
    definitionVersion: definition.version,
    name: definition.name,
    assemblyId,
    transform: {
      translationMm: options.translationMm ?? [0, 0, 0],
      rotationDeg: [0, 0, 0]
    },
    evaluatedParameters: evaluated,
    materialAssignments: definition.defaultMaterialAssignments
  };

  const width = Number(evaluated.widthMm || evaluated.lengthMm || 600);
  const height = Number(evaluated.heightMm || 720);
  const depth = Number(evaluated.depthMm || 590);
  const thickness = 18;

  const components: ComponentInstance[] = [];
  const parts: PartInstance[] = [];

  if (!validation.valid) {
    return { furnitureInstance, components, parts, validation };
  }

  let partIdx = 1;
  const makePart = (
    role: string,
    name: string,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    componentDefinitionId = `def-${role}`,
  ) => {
    const compId = `comp-${furnitureInstanceId}-${partIdx}`;
    const partId = `part-${furnitureInstanceId}-${partIdx}`;
    partIdx++;

    components.push({
      componentInstanceId: compId,
      furnitureInstanceId,
      slotId: role,
      componentDefinitionId,
      role,
      transform: { translationMm: [x, y, z] },
      dimensionsMm: [dx, dy, dz]
    });

    parts.push({
      partInstanceId: partId,
      componentInstanceId: compId,
      furnitureInstanceId,
      role,
      name,
      lengthMm: Math.max(dx, dy, dz),
      widthMm: Math.min(Math.max(dx, dy), Math.max(dy, dz)),
      thicknessMm: Math.min(dx, dy, dz),
      grainDirection: "length",
      materialId: "mat-melamine-white-18",
      transform: { translationMm: [x, y, z] }
    });
  };

  if (["kitchen_base", "kitchen_wall", "closet"].includes(definition.category)) {
    // Left side
    makePart("left_side", "Lateral Izquierdo", 0, 0, 0, thickness, depth, height);
    // Right side
    makePart("right_side", "Lateral Derecho", width - thickness, 0, 0, thickness, depth, height);

    // Shelves
    const shelfCount = Number(evaluated.shelfCount || 0);
    if (shelfCount > 0) {
      const spacing = height / (shelfCount + 1);
      for (let i = 1; i <= shelfCount; i++) {
        makePart(
          "shelf",
          `Entrepaño ${i}`,
          thickness,
          0,
          spacing * i,
          width - 2 * thickness,
          depth,
          thickness,
          "definition-shelf",
        );
      }
    }

    // Door
    const doorCount = Number(evaluated.doorCount || 0);
    if (doorCount === 1) {
      makePart("door", "Puerta", 0, depth, 0, width, thickness, height);
    }
  } else if (definition.category === "desk") {
    // Worktop
    makePart("worktop", "Cubierta", 0, 0, height - thickness, width, depth, thickness);
    // Legs
    makePart("leg_left", "Pata Izquierda", 0, 0, 0, thickness, depth, height - thickness);
    makePart("leg_right", "Pata Derecha", width - thickness, 0, 0, thickness, depth, height - thickness);
  }

  for (const parameter of definition.parameters) {
    if (parameter.binding?.kind !== "componentCondition" || evaluated[parameter.name] !== true) continue;
    const slot = definition.componentSlots.find(
      (candidate) => candidate.componentDefinitionId === parameter.binding!.componentId,
    );
    if (!slot || components.some((component) => component.componentDefinitionId === slot.componentDefinitionId)) continue;
    makePart(
      slot.role,
      slot.role,
      0,
      0,
      0,
      width,
      thickness,
      height,
      slot.componentDefinitionId,
    );
  }

  const excludedDefinitionIds = excludedComponentDefinitionIds(definition, evaluated);
  const activeComponents = components.filter((component) => !excludedDefinitionIds.has(component.componentDefinitionId));
  const activeComponentIds = new Set(activeComponents.map((component) => component.componentInstanceId));

  return {
    furnitureInstance,
    components: activeComponents,
    parts: parts.filter((part) => activeComponentIds.has(part.componentInstanceId)),
    validation
  };
}
