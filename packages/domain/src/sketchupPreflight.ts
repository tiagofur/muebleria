/**
 * Manufacturing preflight resolver (#347, full Definition of Done):
 * Authoritative gate verifying that authoring intent, catalog references,
 * relationships, component geometry, drilling bounds, hole collision safety,
 * release staleness and machine capability negotiation are valid before
 * declaring an assembly manufacturable or releasing CNC output.
 *
 * Invariant: SketchUp owns authoring/interaction; Granete owns manufacturing truth.
 * Critical ambiguity or errors produce ZERO fabricable output (status: blocked).
 *
 * Policy inputs (release state, machine profile, overrides) are server-owned
 * context passed by Granete — they never travel inside the AuthoringEnvelopeV1,
 * so SketchUp cannot bypass the gate.
 */

import type {
  AuthoringEnvelopeV1,
  CapabilityNegotiation,
  ContractIssue,
  DerivedHardwarePlacement,
  MachineCapability,
  MachineProfileRef,
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
  isFingerprintStale,
  type ResolvedRelationshipOperation,
} from "./sketchupRelationshipMachining";
import { getFaceDimensions } from "./partDrillingResolver";

export interface ManufacturingPreflightResult {
  readonly identity: ManufacturingIdentity;
  readonly status: "ready" | "blocked" | "warning";
  readonly issues: readonly ContractIssue[];
  readonly derivedHardwarePlacements: readonly DerivedHardwarePlacement[];
  readonly derivedMachiningOperations: readonly ResolvedRelationshipOperation[];
  readonly requiredCapabilities: readonly MachineCapability[];
  readonly machineNegotiation?: CapabilityNegotiation;
}

/** Released manufacturing state the preflight checks staleness against (contract §8). */
export type ReleaseState = {
  readonly releasedDesignRevisionId: string;
  readonly releasedBomFingerprint: string;
  readonly releasedAt: string;
};

/** Machine profile surface the gate negotiates capabilities against (contract §10). */
export type MachineProfile = {
  readonly ref: MachineProfileRef;
  readonly supported: readonly MachineCapability[];
};

/**
 * Server-authoritative override: explicit and auditable, it may only downgrade
 * policy gates (unsupported machine capability, stale release). It can never
 * bypass critical ambiguity — DRILLING_CONFLICT, orphaned relationships, schema
 * or catalog errors always block.
 */
export type PreflightOverride = {
  readonly overrideId: string;
  readonly code: "MACHINE_CAPABILITY_UNSUPPORTED" | "REVISION_STALE";
  readonly capabilityId?: string;
  readonly reason: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
};

export type PreflightPolicyContext = {
  readonly release?: ReleaseState;
  readonly machineProfile?: MachineProfile;
  readonly overrides?: readonly PreflightOverride[];
};

export const DRILLING_CAPABILITY_ID = "granete.drilling";
export const PANEL_GEOMETRY_CAPABILITY_ID = "granete.panel-geometry";

const CAPABILITY_VERSION = "1";

export function runManufacturingPreflight(
  envelope: AuthoringEnvelopeV1,
  catalog: AuthoringCatalogIndex,
  joineryCatalog: SketchUpJoineryCatalog,
  policy: PreflightPolicyContext = {},
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
          remediation: "Fix the catalog geometry: length, width and thickness must be positive millimeters.",
        });
      }
    }
  }

  // 4. Drilling depth and boundary safety
  const componentPaths = indexComponentPaths(envelope);
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
              path: componentPaths.get(hostId),
              remediation: "Fix the joinery rule or hardware profile: diameter and depth must be positive millimeters.",
            });
          }
          // Depth check: blind hole depth cannot exceed the dimension along
          // the hole's normal axis — thickness for front/back, width for
          // left/right, length for top/bottom (getFaceDimensions is the one
          // canonical face table; a hard-coded left/right exemption cannot
          // track the face pair a rule actually uses).
          const faceMaxDepthMm = getFaceDimensions(hole.face, {
            lengthMm: geometry.lengthMm,
            widthMm: geometry.widthMm,
            thicknessMm: geometry.thicknessMm,
          }).maxDepthMm;
          if (hole.depthMm > faceMaxDepthMm) {
            issues.push({
              code: "DRILLING_INVALID",
              message: `Hole depth ${hole.depthMm}mm exceeds the ${hole.face} face limit ${faceMaxDepthMm}mm on ${hostId}`,
              severity: "error",
              entityId: hostId,
              path: componentPaths.get(hostId),
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
            path: componentPaths.get(hostId),
            remediation: "Shift conflicting shelf position or hardware offset to ensure minimum clearance.",
          });
        }
      }
    }
  }

  // 6. Required capabilities derived from resolved manufacturing truth
  const requiredCapabilities = requiredCapabilitiesFrom(envelope, joineryCatalog, machining);

  // 7. Machine capability negotiation (contract §10): unknown or insufficient
  //    capability blocks before export; capabilities are never inferred.
  let machineNegotiation: CapabilityNegotiation | undefined;
  if (policy.machineProfile !== undefined) {
    issues.push(...negotiateCapabilities(requiredCapabilities, policy.machineProfile));
  }

  // 8. Revision/fingerprint/stale check (contract §8): a released fingerprint
  //    that no longer matches current truth marks previous artifacts stale.
  if (
    policy.release !== undefined &&
    isFingerprintStale(policy.release.releasedBomFingerprint, machining.bomFingerprint)
  ) {
    issues.push({
      code: "REVISION_STALE",
      message: `Released bomFingerprint ${policy.release.releasedBomFingerprint} no longer matches current ${machining.bomFingerprint}; released artifacts are stale`,
      severity: "error",
      entityId: envelope.projectId,
      path: `release[designRevisionId=${policy.release.releasedDesignRevisionId}]`,
      remediation:
        "Create a new ProductionRelease for the current revision or apply an audited server-side override; released artifacts are never overwritten silently.",
      details: {
        releasedBomFingerprint: policy.release.releasedBomFingerprint,
        currentBomFingerprint: machining.bomFingerprint,
        releasedAt: policy.release.releasedAt,
        releasedDesignRevisionId: policy.release.releasedDesignRevisionId,
      },
    });
  }

  // 9. Server-authoritative overrides (contract §10): explicit, auditable,
  //    restricted to policy gates. Unknown codes or non-matching scopes never
  //    downgrade anything.
  const effectiveIssues = applyOverrides(issues, policy.overrides ?? []);
  if (policy.machineProfile !== undefined) {
    machineNegotiation = {
      machineProfile: policy.machineProfile.ref,
      required: requiredCapabilities,
      supported: policy.machineProfile.supported,
      // Same issue objects that gate the result, so an overridden capability
      // shows its audited downgrade instead of a stale error copy.
      unsupported: effectiveIssues.filter(
        (issue) => issue.code === "MACHINE_CAPABILITY_UNSUPPORTED",
      ),
    };
  }

  const isBlocked = hasErrors(effectiveIssues);
  const status: "ready" | "blocked" | "warning" = isBlocked
    ? "blocked"
    : effectiveIssues.some((i) => i.severity === "warning")
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
    issues: effectiveIssues,
    derivedHardwarePlacements,
    derivedMachiningOperations,
    requiredCapabilities,
    machineNegotiation,
  };
}

/**
 * Capabilities the resolved model requires from a machine, derived from
 * manufacturing truth only (holes and panel geometry), never from authoring
 * claims. Deterministic: same inputs produce the same ordered list.
 */
function requiredCapabilitiesFrom(
  envelope: AuthoringEnvelopeV1,
  joineryCatalog: SketchUpJoineryCatalog,
  machining: { readonly derivedMachiningOperations: readonly ResolvedRelationshipOperation[] },
): readonly MachineCapability[] {
  const capabilities: MachineCapability[] = [];

  const holes = machining.derivedMachiningOperations.flatMap((op) => op.detail.holes);
  if (holes.length > 0) {
    const diameters = holes.map((h) => h.diameterMm);
    const depths = holes.map((h) => h.depthMm);
    capabilities.push({
      capabilityId: DRILLING_CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      constraints: {
        minDiameterMm: Math.min(...diameters),
        maxDiameterMm: Math.max(...diameters),
        maxDepthMm: Math.max(...depths),
      },
    });
  }

  const lengths: number[] = [];
  const widths: number[] = [];
  const thicknesses: number[] = [];
  for (const assembly of envelope.assemblies) {
    for (const component of assembly.components ?? []) {
      const geometry = joineryCatalog.componentGeometry[component.componentDefinitionId];
      if (geometry === undefined) continue;
      lengths.push(geometry.lengthMm);
      widths.push(geometry.widthMm);
      thicknesses.push(geometry.thicknessMm);
    }
  }
  if (lengths.length > 0) {
    capabilities.push({
      capabilityId: PANEL_GEOMETRY_CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      constraints: {
        maxLengthMm: Math.max(...lengths),
        maxWidthMm: Math.max(...widths),
        maxThicknessMm: Math.max(...thicknesses),
      },
    });
  }

  return capabilities.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
}

/**
 * Deterministic negotiation: a capability is unsupported when the machine does
 * not declare it, declares a different version, or omits/mismatches a numeric
 * constraint the resolved model requires. `max*` machine limits must cover the
 * requirement; `min*` machine floors must not exceed it. Anything the machine
 * did not declare explicitly is unknown and blocks — capabilities are never
 * inferred.
 */
function negotiateCapabilities(
  required: readonly MachineCapability[],
  machine: MachineProfile,
): readonly ContractIssue[] {
  const unsupported: ContractIssue[] = [];
  const path = (capabilityId: string): string =>
    `machineNegotiation[capabilityId=${capabilityId}]`;

  for (const requirement of required) {
    const declared = machine.supported.find(
      (candidate) => candidate.capabilityId === requirement.capabilityId,
    );
    if (declared === undefined) {
      unsupported.push({
        code: "MACHINE_CAPABILITY_UNSUPPORTED",
        message: `Machine profile ${machine.ref.machineProfileId} does not declare capability ${requirement.capabilityId}; capabilities are never inferred`,
        severity: "error",
        entityId: machine.ref.machineProfileId,
        path: path(requirement.capabilityId),
        remediation:
          "Register the capability in the machine profile, select a compatible machine, or apply an audited server-side override.",
        details: { capabilityId: requirement.capabilityId, requiredVersion: requirement.version },
      });
      continue;
    }
    if (declared.version !== requirement.version) {
      unsupported.push({
        code: "MACHINE_CAPABILITY_UNSUPPORTED",
        message: `Capability ${requirement.capabilityId} version mismatch: machine declares ${declared.version}, resolved model requires ${requirement.version}`,
        severity: "error",
        entityId: machine.ref.machineProfileId,
        path: path(requirement.capabilityId),
        remediation:
          "Upgrade the machine profile capability or regenerate the model against the declared version.",
        details: {
          capabilityId: requirement.capabilityId,
          machineVersion: declared.version,
          requiredVersion: requirement.version,
        },
      });
      continue;
    }
    for (const [key, requiredValue] of Object.entries(requirement.constraints)) {
      const declaredValue = declared.constraints[key];
      if (declaredValue === undefined) {
        unsupported.push({
          code: "MACHINE_CAPABILITY_UNSUPPORTED",
          message: `Capability ${requirement.capabilityId} does not declare constraint ${key} required by the resolved model`,
          severity: "error",
          entityId: machine.ref.machineProfileId,
          path: path(requirement.capabilityId),
          remediation: `Declare ${key} explicitly in the machine profile; undeclared limits are unknown and block.`,
          details: { capabilityId: requirement.capabilityId, constraint: key },
        });
        continue;
      }
      if (typeof requiredValue !== "number" || typeof declaredValue !== "number") {
        unsupported.push({
          code: "MACHINE_CAPABILITY_UNSUPPORTED",
          message: `Constraint ${key} of ${requirement.capabilityId} has a non-numeric declaration (${String(declaredValue)}) where the model requires a number`,
          severity: "error",
          entityId: machine.ref.machineProfileId,
          path: path(requirement.capabilityId),
          remediation: "Machine profile constraints must be numeric millimeters.",
          details: { capabilityId: requirement.capabilityId, constraint: key },
        });
        continue;
      }
      const insufficient =
        (key.startsWith("max") && declaredValue < requiredValue) ||
        (key.startsWith("min") && declaredValue > requiredValue);
      if (insufficient) {
        unsupported.push({
          code: "MACHINE_CAPABILITY_UNSUPPORTED",
          message: `Capability ${requirement.capabilityId} constraint ${key}: machine declares ${declaredValue} but the resolved model requires ${requiredValue}`,
          severity: "error",
          entityId: machine.ref.machineProfileId,
          path: path(requirement.capabilityId),
          remediation:
            "Select a compatible machine, relax the model requirement, or apply an audited server-side override.",
          details: {
            capabilityId: requirement.capabilityId,
            constraint: key,
            machineValue: declaredValue,
            requiredValue,
          },
        });
      }
    }
  }
  return unsupported;
}

/**
 * Applies server-authoritative overrides to policy-gate errors only. A matching
 * override downgrades the error to a warning carrying the full audit record;
 * every other error (critical ambiguity included) passes through untouched.
 */
function applyOverrides(
  issues: readonly ContractIssue[],
  overrides: readonly PreflightOverride[],
): readonly ContractIssue[] {
  if (overrides.length === 0) return issues;
  return issues.map((issue) => {
    if (issue.severity !== "error") return issue;
    if (issue.code !== "MACHINE_CAPABILITY_UNSUPPORTED" && issue.code !== "REVISION_STALE") {
      return issue;
    }
    const matching = overrides.find((override) => {
      if (override.code !== issue.code) return false;
      if (override.capabilityId === undefined) return true;
      return issue.details?.capabilityId === override.capabilityId;
    });
    if (matching === undefined) return issue;
    return {
      ...issue,
      severity: "warning" as const,
      message: `${issue.message} [overridden: ${matching.reason}]`,
      details: {
        ...issue.details,
        override: {
          overrideId: matching.overrideId,
          code: matching.code,
          capabilityId: matching.capabilityId,
          reason: matching.reason,
          approvedBy: matching.approvedBy,
          approvedAt: matching.approvedAt,
        },
      },
    };
  });
}

function indexComponentPaths(envelope: AuthoringEnvelopeV1): Map<string, string> {
  const paths = new Map<string, string>();
  for (const assembly of envelope.assemblies) {
    const assemblyPath = `assemblies[assemblyId=${assembly.assemblyId}]`;
    for (const component of assembly.components ?? []) {
      paths.set(
        component.componentInstanceId,
        `${assemblyPath}.components[componentInstanceId=${component.componentInstanceId}]`,
      );
    }
  }
  return paths;
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
