/**
 * Manufacturing preflight resolver (§11, Issue #347): Authoritative gate
 * verifying that authoring intent, catalog references, relationships,
 * component geometry, drilling bounds, and hole collision safety are valid
 * before declaring an assembly manufacturable or releasing CNC output.
 *
 * Invariant: SketchUp owns authoring/interaction; Granete owns manufacturing truth.
 * Critical ambiguity or errors produce ZERO fabricable output (status: blocked).
 */

import type {
  AuthoringEnvelopeV1,
  ContractIssue,
  DerivedHardwarePlacement,
  ManufacturingIdentity,
  ReadonlyAuthoringSnapshot,
} from "./sketchupAuthoringSchema";
import {
  hasErrors,
  validateAuthoringEnvelope,
  type AuthoringCatalogIndex,
} from "./sketchupAuthoringValidation";
import type { SketchUpJoineryCatalog } from "./sketchupJoineryCatalog";
import {
  deriveRelationshipMachining,
  relationshipBomFingerprint,
  type ResolvedRelationshipOperation,
} from "./sketchupRelationshipMachining";

export interface ManufacturingPreflightResult {
  readonly identity: ManufacturingIdentity;
  readonly status: "ready" | "blocked" | "warning";
  readonly issues: readonly ContractIssue[];
  readonly derivedHardwarePlacements: readonly DerivedHardwarePlacement[];
  readonly derivedMachiningOperations: readonly ResolvedRelationshipOperation[];
}

export function runManufacturingPreflight(
  envelope: AuthoringEnvelopeV1,
  catalog: AuthoringCatalogIndex,
  joineryCatalog: SketchUpJoineryCatalog,
): ManufacturingPreflightResult {
  const issues: ContractIssue[] = [];

  // 1. Envelope structural & catalog validation
  const structuralIssues = validateAuthoringEnvelope(envelope, catalog);
  issues.push(...structuralIssues);

  // 2. Derive relationship machining
  const snapshot: ReadonlyAuthoringSnapshot = {
    projectId: envelope.projectId,
    sourceRevisionId: envelope.sourceRevisionId,
    assemblies: envelope.assemblies,
  };
  const machining = deriveRelationshipMachining(snapshot, joineryCatalog);
  issues.push(...machining.issues);

  // 3. Geometry & bounds validation
  for (const assembly of envelope.assemblies) {
    const assemblyPath = `assemblies[assemblyId=${assembly.assemblyId}]`;
    for (const component of assembly.components ?? []) {
      const componentPath = `${assemblyPath}.components[componentInstanceId=${component.componentInstanceId}]`;
      const geometry = joineryCatalog.componentGeometry[component.componentDefinitionId];
      if (geometry === undefined) {
        issues.push({
          code: "CATALOG_REFERENCE_MISSING",
          message: `No geometry definition for componentDefinitionId ${component.componentDefinitionId}`,
          severity: "error",
          entityId: component.componentInstanceId,
          path: componentPath,
          remediation: "Ensure the component definition exists in the active joinery catalog.",
        });
        continue;
      }

      if (geometry.thicknessMm <= 0 || geometry.lengthMm <= 0 || geometry.widthMm <= 0) {
        issues.push({
          code: "TRANSFORM_INVALID",
          message: `Component ${component.componentInstanceId} has non-positive dimensions in catalog`,
          severity: "error",
          entityId: component.componentInstanceId,
          path: componentPath,
        });
      }
    }
  }

  // 4. Drilling depth and boundary safety
  const operationsByHost = new Map<string, ResolvedRelationshipOperation[]>();
  for (const operation of machining.derivedMachiningOperations) {
    const hostId = operation.hostComponentInstanceId;
    const bucket = operationsByHost.get(hostId);
    if (bucket === undefined) {
      operationsByHost.set(hostId, [operation]);
    } else {
      bucket.push(operation);
    }

    const hostComponent = findComponent(envelope, hostId);
    if (hostComponent !== undefined) {
      const geometry = joineryCatalog.componentGeometry[hostComponent.componentDefinitionId];
      if (geometry !== undefined) {
        for (const hole of operation.detail.holes) {
          if (hole.depthMm <= 0 || hole.diameterMm <= 0) {
            issues.push({
              code: "DRILLING_INVALID",
              message: `Invalid hole parameters on ${hostId}: diameter ${hole.diameterMm}mm, depth ${hole.depthMm}mm`,
              severity: "error",
              entityId: hostId,
            });
          }
          // Depth check: blind hole depth cannot exceed host thickness
          if (hole.depthMm > geometry.thicknessMm && hole.face !== "left" && hole.face !== "right") {
            issues.push({
              code: "DRILLING_INVALID",
              message: `Hole depth ${hole.depthMm}mm exceeds panel thickness ${geometry.thicknessMm}mm on ${hostId}`,
              severity: "error",
              entityId: hostId,
              remediation: "Reduce drilling depth or change panel thickness.",
            });
          }
        }
      }
    }
  }

  // 5. Hole collision detection on the same panel face
  for (const [hostId, ops] of operationsByHost) {
    const allHoles = ops.flatMap((op) =>
      op.detail.holes.map((hole) => ({
        ...hole,
        operationId: op.operationId,
        provenance: op.provenance,
      }))
    );

    for (let i = 0; i < allHoles.length; i += 1) {
      for (let j = i + 1; j < allHoles.length; j += 1) {
        const h1 = allHoles[i]!;
        const h2 = allHoles[j]!;
        if (h1.face !== h2.face) continue;

        const dist = Math.hypot(h1.xMm - h2.xMm, h1.yMm - h2.yMm);
        const minCenterDist = (h1.diameterMm + h2.diameterMm) / 2;

        if (dist < minCenterDist) {
          issues.push({
            code: "DRILLING_CONFLICT",
            message: `Hole collision on host ${hostId} (${h1.type} Ø${h1.diameterMm} at [${h1.xMm}, ${h1.yMm}] collides with ${h2.type} Ø${h2.diameterMm} at [${h2.xMm}, ${h2.yMm}])`,
            severity: "error",
            entityId: hostId,
            remediation: "Shift conflicting shelf position or hardware offset to ensure minimum clearance.",
          });
        }
      }
    }
  }

  const isBlocked = hasErrors(issues);
  const status: "ready" | "blocked" | "warning" = isBlocked
    ? "blocked"
    : issues.some((i) => i.severity === "warning")
      ? "warning"
      : "ready";

  // Critical rule: If blocked, ZERO fabricable output is produced
  const derivedHardwarePlacements = isBlocked ? [] : machining.derivedHardwarePlacements;
  const derivedMachiningOperations = isBlocked ? [] : machining.derivedMachiningOperations;

  return {
    identity: {
      projectId: envelope.projectId,
      designRevisionId: `rev-${envelope.sourceRevisionId}`,
      sourceRevisionId: envelope.sourceRevisionId,
      bomFingerprint: machining.bomFingerprint,
      resolvedAt: envelope.sentAt,
    },
    status,
    issues,
    derivedHardwarePlacements,
    derivedMachiningOperations,
  };
}

function findComponent(envelope: AuthoringEnvelopeV1, componentInstanceId: string) {
  for (const assembly of envelope.assemblies) {
    for (const component of assembly.components ?? []) {
      if (component.componentInstanceId === componentInstanceId) {
        return component;
      }
    }
  }
  return undefined;
}
