/**
 * Hardware Placement & Machining Sync (#350)
 *
 * Provides pure functions to adjust manual hardware placements in an AuthoringEnvelopeV1,
 * ensuring strict provenance (sourceKind: "manualHardwarePlacement"), deterministic
 * machining isolation, and collision resolution through preflight.
 *
 * Invariant: SketchUp owns authoring/placement interaction; Granete owns manufacturing truth.
 */

import type {
  AuthoringEnvelopeV1,
  ContractIssue,
  HardwarePlacementIntent,
} from "./sketchupAuthoringSchema";
import type { AuthoringCatalogIndex } from "./sketchupAuthoringValidation";
import type { SketchUpJoineryCatalog } from "./sketchupJoineryCatalog";
import {
  runManufacturingPreflight,
  type ManufacturingPreflightResult,
} from "./sketchupPreflight";

export interface RepositionHardwareOptions {
  readonly assemblyId: string;
  readonly placementId: string;
  readonly newOffsetMm: readonly [number, number];
  readonly newRotationDeg?: number;
  readonly newAnchorFace?: "front" | "back" | "left" | "right" | "top" | "bottom" | "inside";
}

export interface SyncHardwareResult {
  readonly success: boolean;
  readonly envelope: AuthoringEnvelopeV1;
  readonly preflight: ManufacturingPreflightResult;
  readonly issues: readonly ContractIssue[];
}

export function repositionHardwarePlacement(
  envelope: AuthoringEnvelopeV1,
  options: RepositionHardwareOptions,
  catalog: AuthoringCatalogIndex,
  joineryCatalog: SketchUpJoineryCatalog,
): SyncHardwareResult {
  const issues: ContractIssue[] = [];

  // Deep clone envelope to ensure immutability
  const updatedEnvelope: AuthoringEnvelopeV1 = JSON.parse(JSON.stringify(envelope));

  const assembly = updatedEnvelope.assemblies.find((a) => a.assemblyId === options.assemblyId);
  if (assembly === undefined) {
    issues.push({
      code: "ASSEMBLY_NOT_FOUND",
      message: `Assembly ${options.assemblyId} not found in envelope`,
      severity: "error",
      entityId: options.assemblyId,
    });
    return {
      success: false,
      envelope,
      preflight: runManufacturingPreflight(envelope, catalog, joineryCatalog),
      issues,
    };
  }

  const placements = assembly.hardwarePlacements ?? [];
  const placementIndex = placements.findIndex((p) => p.hardwarePlacementId === options.placementId);
  if (placementIndex === -1) {
    issues.push({
      code: "HARDWARE_PLACEMENT_NOT_FOUND",
      message: `Hardware placement ${options.placementId} not found in assembly ${options.assemblyId}`,
      severity: "error",
      entityId: options.placementId,
    });
    return {
      success: false,
      envelope,
      preflight: runManufacturingPreflight(envelope, catalog, joineryCatalog),
      issues,
    };
  }

  const targetPlacement = placements[placementIndex]!;
  const updatedPlacement: HardwarePlacementIntent = {
    ...targetPlacement,
    offsetMm: options.newOffsetMm,
    rotationDeg: options.newRotationDeg ?? targetPlacement.rotationDeg,
    anchorFace: options.newAnchorFace ?? targetPlacement.anchorFace,
  };

  const newPlacements = [...placements];
  newPlacements[placementIndex] = updatedPlacement;
  
  const assemblyIndex = updatedEnvelope.assemblies.findIndex((a) => a.assemblyId === options.assemblyId);
  const updatedAssemblies = [...updatedEnvelope.assemblies];
  updatedAssemblies[assemblyIndex] = {
    ...assembly,
    hardwarePlacements: newPlacements,
  };
  const finalEnvelope: AuthoringEnvelopeV1 = {
    ...updatedEnvelope,
    assemblies: updatedAssemblies,
  };

  const preflight = runManufacturingPreflight(finalEnvelope, catalog, joineryCatalog);
  return {
    success: preflight.status === "ready" || preflight.status === "warning",
    envelope: finalEnvelope,
    preflight,
    issues: preflight.issues,
  };

  return {
    success: preflight.status === "ready" || preflight.status === "warning",
    envelope: updatedEnvelope,
    preflight,
    issues: preflight.issues,
  };
}
