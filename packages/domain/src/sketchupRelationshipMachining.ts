/**
 * Relationship→machining resolver (#356): turns PartRelationshipIntent and
 * manual HardwarePlacementIntent from an accepted authoring snapshot into
 * derived hardware placements and machining operations with provenance,
 * reusing the existing joint primitives (jointFastenerPositions) instead of a
 * second engine. Drilling coordinates are RESULTS keyed by provenance —
 * moving a piece changes intent, never persisted holes.
 */

import {
  jointFastenerPositions,
  resolveHardwareId,
} from './jointDrillingRules';
import type { HoleDefinition } from './partDrilling';
import type {
  ContractIssue,
  DesignAssembly,
  DerivedHardwarePlacement,
  DerivedMachiningOperation,
  HardwarePlacementIntent,
  PartRelationshipIntent,
  ReadonlyAuthoringSnapshot,
  StableEntityId,
} from './sketchupAuthoringSchema';
import type {
  ShelfSupportRule,
  SketchUpJoineryCatalog,
} from './sketchupJoineryCatalog';

/** A derived operation enriched with the board-local detail the host piece drills. */
export interface ResolvedRelationshipOperation extends DerivedMachiningOperation {
  readonly detail: {
    readonly holes: readonly HoleDefinition[];
  };
}

export interface RelationshipMachiningResult {
  readonly derivedHardwarePlacements: readonly DerivedHardwarePlacement[];
  readonly derivedMachiningOperations: readonly ResolvedRelationshipOperation[];
  readonly issues: readonly ContractIssue[];
  readonly bomFingerprint: string;
}

export interface RelationshipMachiningDiff {
  readonly unchangedProvenanceKeys: readonly string[];
  readonly recomputedProvenanceKeys: readonly string[];
  readonly addedProvenanceKeys: readonly string[];
  readonly removedProvenanceKeys: readonly string[];
}

interface ComponentIndexEntry {
  readonly assemblyId: StableEntityId;
  readonly componentInstanceId: StableEntityId;
  readonly componentDefinitionId: StableEntityId;
  readonly transform: {
    readonly translationMm: readonly [number, number, number];
  };
}

export function deriveRelationshipMachining(
  snapshot: ReadonlyAuthoringSnapshot,
  catalog: SketchUpJoineryCatalog,
): RelationshipMachiningResult {
  const issues: ContractIssue[] = [];
  const operations: ResolvedRelationshipOperation[] = [];
  const placements: DerivedHardwarePlacement[] = [];

  for (const assembly of snapshot.assemblies) {
    const components = indexComponents(assembly);
    for (const relationship of assembly.relationships ?? []) {
      deriveRelationshipOperations(assembly, relationship, components, catalog, placements, operations, issues);
    }
    for (const placement of assembly.hardwarePlacements ?? []) {
      deriveManualPlacement(assembly, placement, components, catalog, placements, operations, issues);
    }
  }

  return {
    derivedHardwarePlacements: placements,
    derivedMachiningOperations: operations,
    issues,
    bomFingerprint: relationshipBomFingerprint(placements, operations),
  };
}

function deriveRelationshipOperations(
  assembly: DesignAssembly,
  relationship: PartRelationshipIntent,
  components: ReadonlyMap<StableEntityId, ComponentIndexEntry>,
  catalog: SketchUpJoineryCatalog,
  placements: DerivedHardwarePlacement[],
  operations: ResolvedRelationshipOperation[],
  issues: ContractIssue[],
): void {
  const path = `assemblies[assemblyId=${assembly.assemblyId}].relationships[relationshipId=${relationship.relationshipId}]`;

  if (relationship.kind !== 'shelf-support') {
    issues.push({
      code: 'RELATIONSHIP_INVALID',
      message: `no rule registered for relationship kind ${relationship.kind}`,
      severity: 'error',
      entityId: relationship.relationshipId,
      path,
      remediation: 'Use a relationship kind the manufacturing catalog resolves (v1: shelf-support).',
    });
    return;
  }

  const defaultSystem = catalog.relationshipKinds[relationship.kind];
  const systemId = relationship.joinerySystemId ?? defaultSystem;
  if (systemId === undefined) {
    issues.push({
      code: 'JOINERY_SYSTEM_UNSUPPORTED',
      message: `no joinery system for kind ${relationship.kind}`,
      severity: 'error',
      entityId: relationship.relationshipId,
      path,
      remediation: 'Register a default joinery system for this relationship kind in the catalog.',
    });
    return;
  }
  const rule = catalog.joinerySystems[systemId];
  if (rule === undefined) {
    issues.push({
      code: 'JOINERY_SYSTEM_UNSUPPORTED',
      message: `unknown joinery system ${systemId}`,
      severity: 'error',
      entityId: relationship.relationshipId,
      path,
      remediation: 'Request a joinery system that exists in the active catalog.',
    });
    return;
  }

  const source = components.get(relationship.source.componentInstanceId);
  if (source === undefined) {
    issues.push(orphaned(relationship.relationshipId, relationship.source.componentInstanceId, path));
    return;
  }
  const sourceGeometry = catalog.componentGeometry[source.componentDefinitionId];
  if (sourceGeometry === undefined) {
    issues.push({
      code: 'CATALOG_REFERENCE_MISSING',
      message: `no geometry for componentDefinitionId ${source.componentDefinitionId}`,
      severity: 'error',
      entityId: relationship.relationshipId,
      path,
      remediation: 'Ensure the component definition exists in the active joinery catalog.',
    });
    return;
  }

  const targets = relationship.targets
    .map((anchor) => ({ anchor, component: components.get(anchor.componentInstanceId) }))
    .filter((entry): entry is { anchor: typeof entry.anchor; component: ComponentIndexEntry } =>
      entry.component !== undefined,
    );
  if (targets.length === 0) {
    issues.push(orphaned(relationship.relationshipId, relationship.source.componentInstanceId, path));
    return;
  }
  const targetGeometry = catalog.componentGeometry[targets[0]!.component.componentDefinitionId];
  if (targetGeometry === undefined) {
    issues.push({
      code: 'CATALOG_REFERENCE_MISSING',
      message: `no geometry for componentDefinitionId ${targets[0]!.component.componentDefinitionId}`,
      severity: 'error',
      entityId: relationship.relationshipId,
      path,
      remediation: 'Ensure the component definition exists in the active joinery catalog.',
    });
    return;
  }

  // Shelf height in the assembly frame (z-up): authoring intent, the only
  // driver of where derived holes land on the sides.
  const shelfZ = source.transform.translationMm[2] ?? 0;
  const sideLength = targetGeometry.lengthMm;
  if (shelfZ <= 0 || shelfZ >= sideLength) {
    issues.push({
      code: 'RELATIONSHIP_INVALID',
      message: `shelf at z=${shelfZ}mm is outside the side panel height ${sideLength}mm`,
      severity: 'error',
      entityId: relationship.relationshipId,
      path,
      remediation: 'Move the shelf so its height lies strictly inside the side panel span.',
      details: { shelfZ, sideLength },
    });
    return;
  }

  const positions = jointFastenerPositions(
    sourceGeometry.widthMm,
    rule.endMarginMm,
    rule.maxSpacingMm,
    rule.gridMm,
  );
  if (positions.length === 0) {
    issues.push({
      code: 'RELATIONSHIP_INVALID',
      message: 'shelf depth cannot host any fastener under the current rule',
      severity: 'error',
      entityId: relationship.relationshipId,
      path,
      remediation: 'Widen the shelf beyond twice the end margin or relax the joinery rule spacing.',
    });
    return;
  }

  let opIndex = 0;
  const nextOpId = (): string => `${relationship.relationshipId}:op-${(opIndex += 1)}`;

  // Side panels: cams (and companion dowels) on the inside face at shelf height.
  const minifixId = resolveHardwareId(catalog.hardware, rule.minifixCode);
  const dowelId = resolveHardwareId(catalog.hardware, rule.dowelCode);
  for (const { component } of targets) {
    if (minifixId !== undefined) {
      const holes: HoleDefinition[] = positions.map((x) => ({
        face: 'front',
        xMm: x,
        yMm: shelfZ,
        diameterMm: rule.camDiameterMm,
        depthMm: rule.camDepthMm,
        type: 'minifix',
      }));
      pushOperation(operations, nextOpId(), component, relationship, systemId, holes);
      pushPlacement(placements, `${relationship.relationshipId}:dhp-side-${component.componentInstanceId ?? ''}`, component, relationship);
    }
    if (rule.withDowels && dowelId !== undefined) {
      const holes: HoleDefinition[] = [];
      for (const x of positions) {
        for (const offset of [-rule.gridMm, rule.gridMm]) {
          const dowelX = x + offset;
          if (dowelX > 0 && dowelX < targetGeometry.widthMm) {
            holes.push({
              face: 'front',
              xMm: dowelX,
              yMm: shelfZ,
              diameterMm: rule.dowelDiameterMm,
              depthMm: rule.dowelDepthMm,
              type: 'dowel',
            });
          }
        }
      }
      pushOperation(operations, nextOpId(), component, relationship, systemId, holes);
      pushPlacement(placements, `${relationship.relationshipId}:dhp-dowel-${component.componentInstanceId ?? ''}`, component, relationship);
    }
  }

  // Shelf ends: bolts and dowels along the shelf's length-axis end faces.
  // Length-axis ends are the board-local bottom/top faces (getFaceDimensions
  // plane width×thickness; jointDrillingRules F129 uses the same pair), so
  // xMm rides the width axis and yMm the half-thickness — left/right would
  // place the holes outside the resolved board (#470 3D projection proof).
  const shelfEndHoles: HoleDefinition[] = [];
  const halfThickness = sourceGeometry.thicknessMm / 2;
  for (const x of positions) {
    for (const face of ['bottom', 'top'] as const) {
      if (minifixId !== undefined) {
        shelfEndHoles.push({
          face,
          xMm: x,
          yMm: halfThickness,
          diameterMm: rule.camDiameterMm,
          depthMm: rule.camDepthMm,
          type: 'minifix',
        });
      }
      if (rule.withDowels && dowelId !== undefined) {
        for (const offset of [-rule.gridMm, rule.gridMm]) {
          const dowelX = x + offset;
          if (dowelX > 0 && dowelX < sourceGeometry.widthMm) {
            shelfEndHoles.push({
              face,
              xMm: dowelX,
              yMm: halfThickness,
              diameterMm: rule.dowelDiameterMm,
              depthMm: rule.dowelEndDepthMm ?? 20,
              type: 'dowel',
            });
          }
        }
      }
    }
  }
  if (shelfEndHoles.length > 0) {
    pushOperation(operations, nextOpId(), source, relationship, systemId, shelfEndHoles);
    if (minifixId !== undefined) {
      pushPlacement(placements, `${relationship.relationshipId}:dhp-shelf-${source.componentInstanceId ?? ''}`, source, relationship);
    }
  }
}

function deriveManualPlacement(
  assembly: DesignAssembly,
  placement: HardwarePlacementIntent,
  components: ReadonlyMap<StableEntityId, ComponentIndexEntry>,
  catalog: SketchUpJoineryCatalog,
  placements: DerivedHardwarePlacement[],
  operations: ResolvedRelationshipOperation[],
  issues: ContractIssue[],
): void {
  const path = `assemblies[assemblyId=${assembly.assemblyId}].hardwarePlacements[hardwarePlacementId=${placement.hardwarePlacementId}]`;
  const rule = catalog.manualHardware[placement.catalogHardwareId];
  if (rule === undefined) {
    issues.push({
      code: 'CATALOG_REFERENCE_MISSING',
      message: `no machining rule for manual hardware ${placement.catalogHardwareId}`,
      severity: 'error',
      entityId: placement.hardwarePlacementId,
      path,
      remediation: 'Choose a hardware item with a machining rule in the active catalog.',
    });
    return;
  }
  const host = components.get(placement.hostComponentInstanceId);
  if (host === undefined) {
    issues.push({
      code: 'HARDWARE_HOST_INVALID',
      message: `manual hardware host ${placement.hostComponentInstanceId} is not a component of this assembly`,
      severity: 'error',
      entityId: placement.hardwarePlacementId,
      path,
      remediation: 'Host the placement on a component instance that exists in the assembly.',
    });
    return;
  }

  operations.push({
    operationId: `${placement.hardwarePlacementId}:op-1`,
    hostComponentInstanceId: placement.hostComponentInstanceId,
    provenance: {
      sourceKind: 'manualHardwarePlacement',
      hardwarePlacementId: placement.hardwarePlacementId,
    },
    detail: {
      holes: [
        {
          face: rule.boardFace,
          xMm: placement.offsetMm[0] ?? 0,
          yMm: placement.offsetMm[1] ?? 0,
          diameterMm: rule.pilotDiameterMm,
          depthMm: rule.pilotDepthMm,
          type: rule.holeType,
        },
      ],
    },
  });
  // Manual hardware placements do not produce DerivedHardwarePlacement (only relationships/joints do).
}

function pushOperation(
  operations: ResolvedRelationshipOperation[],
  operationId: string,
  component: ComponentIndexEntry,
  relationship: PartRelationshipIntent,
  systemId: string,
  holes: readonly HoleDefinition[],
): void {
  operations.push({
    operationId,
    hostComponentInstanceId: component.componentInstanceId,
    provenance: {
      sourceKind: 'relationship',
      relationshipId: relationship.relationshipId,
      catalogRuleId: systemId,
    },
    detail: { holes },
  });
}

function pushPlacement(
  placements: DerivedHardwarePlacement[],
  id: string,
  component: ComponentIndexEntry,
  relationship: PartRelationshipIntent,
): void {
  placements.push({
    derivedHardwarePlacementId: id,
    hostComponentInstanceId: component.componentInstanceId,
    provenance: {
      sourceKind: 'relationship',
      relationshipId: relationship.relationshipId,
    },
  });
}

function indexComponents(assembly: DesignAssembly): ReadonlyMap<StableEntityId, ComponentIndexEntry> {
  const index = new Map<StableEntityId, ComponentIndexEntry>();
  for (const component of assembly.components ?? []) {
    index.set(component.componentInstanceId, {
      assemblyId: assembly.assemblyId,
      componentInstanceId: component.componentInstanceId,
      componentDefinitionId: component.componentDefinitionId,
      transform: { translationMm: component.transform.translationMm },
    });
  }
  return index;
}

function orphaned(
  relationshipId: StableEntityId,
  instanceId: StableEntityId,
  path: string,
): ContractIssue {
  return {
    code: 'RELATIONSHIP_ORPHANED',
    message: `anchor references componentInstanceId ${instanceId} that is not part of this assembly`,
    severity: 'error',
    entityId: relationshipId,
    path,
    remediation: 'Anchor the relationship to a component instance present in the snapshot.',
  };
}

/**
 * Deterministic fingerprint over canonicalized manufacturing inputs (derived
 * placements + operations, sorted by id). Renames and other non-manufacturing
 * changes leave it untouched; any machining change moves it.
 */
export function relationshipBomFingerprint(
  placements: readonly DerivedHardwarePlacement[],
  operations: readonly ResolvedRelationshipOperation[],
): string {
  const canonical = {
    placements: [...placements]
      .map((p) => ({ id: p.derivedHardwarePlacementId, host: p.hostComponentInstanceId, prov: p.provenance }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    operations: [...operations]
      .map((o) => ({ id: o.operationId, host: o.hostComponentInstanceId, prov: o.provenance, holes: o.detail.holes }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return fnv1aHex(canonicalJson(canonical));
}

/** Differential view: which provenance groups changed between two resolutions. */
export function diffRelationshipMachining(
  previous: RelationshipMachiningResult,
  next: RelationshipMachiningResult,
): RelationshipMachiningDiff {
  const previousGroups = groupByProvenanceKey(previous.derivedMachiningOperations);
  const nextGroups = groupByProvenanceKey(next.derivedMachiningOperations);
  const unchanged: string[] = [];
  const recomputed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [key, ops] of previousGroups) {
    const nextOps = nextGroups.get(key);
    if (nextOps === undefined) {
      removed.push(key);
    } else if (canonicalJson(ops) === canonicalJson(nextOps)) {
      unchanged.push(key);
    } else {
      recomputed.push(key);
    }
  }
  for (const key of nextGroups.keys()) {
    if (!previousGroups.has(key)) added.push(key);
  }
  return {
    unchangedProvenanceKeys: unchanged.sort(),
    recomputedProvenanceKeys: recomputed.sort(),
    addedProvenanceKeys: added.sort(),
    removedProvenanceKeys: removed.sort(),
  };
}

/** A released fingerprint goes stale the moment current manufacturing truth moves. */
export function isFingerprintStale(released: string, current: string): boolean {
  return released !== current;
}

function groupByProvenanceKey(
  operations: readonly ResolvedRelationshipOperation[],
): ReadonlyMap<string, ResolvedRelationshipOperation[]> {
  const groups = new Map<string, ResolvedRelationshipOperation[]>();
  for (const operation of operations) {
    const key = provenanceKey(operation.provenance);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [operation]);
    } else {
      bucket.push(operation);
    }
  }
  return groups;
}

export function provenanceKey(provenance: DerivedMachiningOperation['provenance']): string {
  return provenance.sourceKind === 'relationship'
    ? `relationship:${provenance.relationshipId}`
    : provenance.sourceKind === 'joint'
      ? `joint:${provenance.jointPlacementId}`
      : `manualHardwarePlacement:${provenance.hardwarePlacementId}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
}
