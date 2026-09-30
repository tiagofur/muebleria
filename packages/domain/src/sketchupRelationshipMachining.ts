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
  RelationshipProvenance,
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
  /** J1-B per-relationship joinery resolution states (#874); absent kinds are absent. */
  readonly joineryStatuses: readonly JoineryRelationshipStatus[];
}

/** Canonical resolution stages a declared relationship can occupy (#874 J1-B). */
export type JoineryResolutionStage =
  | 'RELATIONSHIP_UNSUPPORTED'
  | 'CONTACT_INVALID'
  | 'STATION_INVALID'
  | 'TECHNICAL_PROFILE_REQUIRED'
  | 'MACHINING_INVALID'
  | 'MACHINING_READY';

export interface JoineryContactStatus {
  readonly contactId: string;
  readonly status: 'VALID' | 'INVALID';
  readonly issueCodes: readonly string[];
}

export interface JoineryStationPlanStatus {
  readonly status: 'NOT_PLANNED' | 'PLANNED' | 'INVALID';
  readonly issueCodes: readonly string[];
  readonly stationCounts: readonly { readonly contactId: string; readonly stationCount: number }[];
  /** Planned station positions along the contact axis (mm from the frame
   *  origin); manufacturing truth the fingerprint tracks (#874). */
  readonly stationDistances: readonly {
    readonly contactId: string;
    readonly distancesMm: readonly number[];
  }[];
  /** Per-family breakdown when the relationship declares independent
   *  operation families (#874 J2-A); aggregates above stay honest sums. */
  readonly familyPlans?: readonly JoineryFamilyPlan[];
}

/** One family's independently planned station set per contact; plans sorted
 *  by familyId for deterministic cross-runtime parity. */
export interface JoineryFamilyPlan {
  readonly familyId: string;
  readonly stationCounts: readonly { readonly contactId: string; readonly stationCount: number }[];
  readonly stationDistances: readonly { readonly contactId: string; readonly distancesMm: readonly number[] }[];
}

export interface JoineryRelationshipStatus {
  readonly relationshipId: string;
  readonly kind: string;
  readonly stage: JoineryResolutionStage;
  readonly contacts: readonly JoineryContactStatus[];
  readonly stations: JoineryStationPlanStatus;
  readonly blockers: readonly string[];
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
    readonly rotationQuaternion: readonly [number, number, number, number];
    readonly scale: readonly [number, number, number];
  };
}

/**
 * TEST-ONLY SEAM — NOT the industrial recipe model. Explicit technical data
 * one operation family needs to emit real machining (#874 J2-A.2) so engine
 * tests can drive the family→operation frontier while the real versioned
 * recipe contract (per-participant/face rules, technical profile id+revision,
 * offsets, axes, multi-operation fixings) is not yet wired to the productive
 * resolver. Production NEVER supplies profiles: without verified profiles
 * family-bearing relationships stay at TECHNICAL_PROFILE_REQUIRED with zero
 * operations. J2-B/J3 must consume the real recipe model — do NOT extend
 * this type with industrial semantics.
 */
export interface FamilyTechnicalProfile {
  readonly profileId: string;
  readonly diameterMm: number;
  readonly depthMm: number;
  readonly holeType: string;
}

export interface RelationshipMachiningOptions {
  /** Test-only synthetic family profiles keyed by familyId. */
  readonly familyProfiles?: Readonly<Record<string, FamilyTechnicalProfile>>;
}

export function deriveRelationshipMachining(
  snapshot: ReadonlyAuthoringSnapshot,
  catalog: SketchUpJoineryCatalog,
  options: RelationshipMachiningOptions = {},
): RelationshipMachiningResult {
  const issues: ContractIssue[] = [];
  const operations: ResolvedRelationshipOperation[] = [];
  const placements: DerivedHardwarePlacement[] = [];

  const joineryStatuses: JoineryRelationshipStatus[] = [];
  for (const assembly of snapshot.assemblies) {
    const components = indexComponents(assembly);
    for (const relationship of assembly.relationships ?? []) {
      deriveRelationshipOperations(assembly, relationship, components, catalog,
        placements, operations, issues, joineryStatuses, options);
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
    joineryStatuses,
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
  joineryStatuses: JoineryRelationshipStatus[],
  options: RelationshipMachiningOptions,
): void {
  const path = `assemblies[assemblyId=${assembly.assemblyId}].relationships[relationshipId=${relationship.relationshipId}]`;

  if (relationship.kind === 'floor-side') {
    deriveFloorSideJoinery(relationship, components, catalog, issues, joineryStatuses, options, operations);
    return;
  }

  if (relationship.kind === 'fixed-shelf-side') {
    deriveFixedShelfJoinery(relationship, components, catalog, issues, joineryStatuses, operations);
    return;
  }

  if (relationship.kind !== 'shelf-support') {
    issues.push({
      code: 'RELATIONSHIP_INVALID',
      message: `no rule registered for relationship kind ${relationship.kind}`,
      severity: 'error',
      entityId: relationship.relationshipId,
      path,
      remediation: 'Use a relationship kind the manufacturing catalog resolves (v1: shelf-support).',
    });
    joineryStatuses.push({
      relationshipId: relationship.relationshipId, kind: relationship.kind,
      stage: 'RELATIONSHIP_UNSUPPORTED', contacts: [],
      stations: { status: 'NOT_PLANNED', issueCodes: [], stationCounts: [], stationDistances: [] },
      blockers: ['RELATIONSHIP_INVALID'],
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

/** Orthonormal board basis from a normalized (x, y, z, w) placement quaternion. */
function quaternionBasis(q: readonly [number, number, number, number]):
  { readonly x: Vec3; readonly y: Vec3; readonly z: Vec3 } | null {
  const [x, y, z, w] = q;
  if (![x, y, z, w].every(Number.isFinite) || Math.abs(x * x + y * y + z * z + w * w - 1) > 1e-6) return null;
  return {
    x: [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    y: [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    z: [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  };
}

/** Mirror of the Go layout pipeline's snapUnitVec3: axis-aligned placements
 *  arrive as exact 0/±1 components, never as floating-point residue — the
 *  A1a face-normal bore guard legitimately requires exact zeros (#874 J2-B:
 *  the Go side snaps in boardLocalPose; this is the TS twin for recipe
 *  participants). Genuinely oblique bases pass through untouched. */
function snapBasisVector(v: Vec3): Vec3 {
  const snap = (component: number): number => {
    if (Math.abs(component) < 1e-9) return 0;
    if (Math.abs(component - 1) < 1e-9) return 1;
    if (Math.abs(component + 1) < 1e-9) return -1;
    return component;
  };
  return [snap(v[0]), snap(v[1]), snap(v[2])];
}

const FLOOR_FACES: readonly ContactFace[] = ['top', 'bottom', 'left', 'right', 'front', 'back'];

/** Exact plane coincidence (1e-6) between B's declared face and exactly one A face. */
function coincidentFaceA(a: ContactBoard, b: ContactBoard, faceB: ContactFace): ContactFace | 'AMBIGUOUS' | null {
  const surfaceB = contactSurface(b, faceB);
  const matches: ContactFace[] = [];
  for (const faceA of FLOOR_FACES) {
    const surfaceA = contactSurface(a, faceA);
    if (Math.abs(contactDot(surfaceA.normal, contactNegate(surfaceB.normal)) - 1) > 1e-6) continue;
    const delta = contactDelta(surfaceA.corners[0]!, surfaceB.corners[0]!);
    if (Math.abs(contactDot(delta, surfaceB.normal)) <= 1e-6) matches.push(faceA);
  }
  if (matches.length === 1) return matches[0]!;
  return matches.length > 1 ? 'AMBIGUOUS' : null;
}

/**
 * J1-B productive floor↔side resolution (#874): explicit anchors and geometry
 * drive the A0a/A0b foundation; without a verified production technical
 * profile the relationship can only occupy TECHNICAL_PROFILE_REQUIRED — no
 * synthetic recipe is ever fabricated here.
 */
function deriveFloorSideJoinery(
  relationship: PartRelationshipIntent,
  components: ReadonlyMap<StableEntityId, ComponentIndexEntry>,
  catalog: SketchUpJoineryCatalog,
  issues: ContractIssue[],
  joineryStatuses: JoineryRelationshipStatus[],
  options: RelationshipMachiningOptions,
  operations: ResolvedRelationshipOperation[],
): void {
  const status = (stage: JoineryResolutionStage, contacts: readonly JoineryContactStatus[],
    stations: JoineryStationPlanStatus, blockers: readonly string[]): void => {
    joineryStatuses.push({ relationshipId: relationship.relationshipId, kind: relationship.kind,
      stage, contacts, stations, blockers });
  };
  const contactIds = relationship.targets.map((anchor) => `${relationship.relationshipId}:${anchor.componentInstanceId}`);
  const failContacts = (codes: readonly string[]): void => {
    status('CONTACT_INVALID', contactIds.map((contactId) => ({ contactId, status: 'INVALID', issueCodes: codes })),
      { status: 'NOT_PLANNED', issueCodes: [], stationCounts: [], stationDistances: [] }, codes);
  };
  const pushIssue = (code: string, message: string, remediation: string): void => {
    issues.push({ code, message, severity: 'error', entityId: relationship.relationshipId, remediation });
  };

  const boards: ContactBoard[] = [];
  const anchorGeometry = (anchor: PartRelationshipIntent['source'], anchorKind: string): boolean => {
    const component = components.get(anchor.componentInstanceId);
    if (component === undefined) {
      pushIssue('RELATIONSHIP_ORPHANED',
        `${anchorKind} anchor references componentInstanceId ${anchor.componentInstanceId} that is not part of this assembly`,
        'Anchor the relationship to a component instance present in the snapshot.');
      return false;
    }
    if (anchorKind === 'target'
        && (anchor.face === undefined || !FLOOR_FACES.includes(anchor.face as ContactFace))) {
      pushIssue('CONTACT_FACE_REQUIRED',
        `${anchorKind} anchor must declare one concrete contact face (${anchor.componentInstanceId})`,
        'Declare the physical contact face on every floor-side target; proximity never infers a union.');
      return false;
    }
    if (anchorKind === 'source' && anchor.face !== undefined
        && !FLOOR_FACES.includes(anchor.face as ContactFace)) {
      pushIssue('CONTACT_FACE_REQUIRED',
        'source anchor declares a face outside the six concrete board faces',
        'Declare a top/bottom/left/right/front/back source face or omit it for exact plane verification.');
      return false;
    }
    const geometry = catalog.componentGeometry[component.componentDefinitionId];
    if (geometry === undefined) {
      pushIssue('CATALOG_REFERENCE_MISSING',
        `no geometry for componentDefinitionId ${component.componentDefinitionId}`,
        'Ensure the component definition exists in the active joinery catalog.');
      return false;
    }
    const basis = quaternionBasis(component.transform.rotationQuaternion);
    if (basis === null || component.transform.scale.some((value) => value !== 1)) {
      pushIssue('TRANSFORM_INVALID',
        `component ${component.componentInstanceId} placement is not a rigid unit-scale frame`,
        'Transport a normalized quaternion and unit scale for every floor-side participant.');
      return false;
    }
    boards.push({
      occurrenceId: component.componentInstanceId,
      widthMm: geometry.widthMm, thicknessMm: geometry.thicknessMm, lengthMm: geometry.lengthMm,
      translationMm: component.transform.translationMm, basis,
    });
    return true;
  };

  if (!anchorGeometry(relationship.source, 'source')) {
    failContacts(['RELATIONSHIP_ORPHANED', 'CONTACT_FACE_REQUIRED', 'CATALOG_REFERENCE_MISSING', 'TRANSFORM_INVALID']
      .filter((code) => issues.some((issue) => issue.entityId === relationship.relationshipId && issue.code === code)));
    return;
  }
  const contacts: ExplicitContact[] = [];
  for (const [index, anchor] of relationship.targets.entries()) {
    const before = issues.length;
    if (!anchorGeometry(anchor, 'target')) {
      failContacts(issues.slice(before).map((issue) => issue.code));
      return;
    }
    const sourceBoard = boards[0]!;
    const targetBoard = boards[boards.length - 1]!;
    const derivedFaceA = coincidentFaceA(sourceBoard, targetBoard, anchor.face as ContactFace);
    if (derivedFaceA === null || derivedFaceA === 'AMBIGUOUS'
        || (relationship.source.face !== undefined && relationship.source.face !== derivedFaceA)) {
      pushIssue('CONTACT_FACE_REQUIRED',
        `declared target face does not coincide with exactly one face of ${relationship.source.componentInstanceId}`,
        'Anchor floor-side contacts on faces that physically coincide; proximity never infers a union.');
      failContacts(['CONTACT_FACE_REQUIRED']);
      return;
    }
    contacts.push({
      relationshipId: relationship.relationshipId, contactId: contactIds[index]!,
      participantA: relationship.source.componentInstanceId, participantB: anchor.componentInstanceId,
      faceA: derivedFaceA, faceB: anchor.face as ContactFace,
    });
  }

  const resolution = resolveExplicitContacts({ boards, contacts, requiredContactIds: contactIds });
  if (resolution.issues.length > 0) {
    for (const issue of resolution.issues) issues.push(issue);
    failContacts([...new Set(resolution.issues.map((issue) => issue.code))]);
    return;
  }

  // J2-A (#874): declared families plan independently per family — one
  // joint, one status, per-family counts and positions. stationCount and
  // families are mutually exclusive (fail closed, never silent precedence).
  if (relationship.families !== undefined && relationship.families.length > 0) {
    deriveFamilyPlans(relationship, resolution, boards, contactIds, status, pushIssue, options, operations);
    return;
  }
  const parameters = relationship.parameters ?? {};
  const count = parameters.stationCount;
  const start: unknown = parameters.startMarginMm ?? 0;
  const end: unknown = parameters.endMarginMm ?? 0;
  const validMargin = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 2
      || !validMargin(start) || !validMargin(end)) {
    pushIssue('STATION_PATTERN_INVALID',
      'floor-side station pattern needs an integer stationCount >= 2 and finite nonnegative margins',
      'Declare stationCount (>= 2) and optional nonnegative start/end margins on the relationship.');
    status('STATION_INVALID', contactIds.map((contactId) => ({ contactId, status: 'VALID', issueCodes: [] })),
      { status: 'INVALID', issueCodes: ['STATION_PATTERN_INVALID'], stationCounts: [], stationDistances: [] },
      ['STATION_PATTERN_INVALID']);
    return;
  }
  const specs = contactIds.map((contactId) =>
    ({ contactId, count, startMarginMm: start as number, endMarginMm: end as number }));
  const planned = planResolvedContactStations(resolution, boards, specs);
  if (planned.issues.length > 0) {
    for (const issue of planned.issues) issues.push(issue);
    status('STATION_INVALID', contactIds.map((contactId) => ({ contactId, status: 'VALID', issueCodes: [] })),
      { status: 'INVALID', issueCodes: [...new Set(planned.issues.map((issue) => issue.code))], stationCounts: [], stationDistances: [] },
      [...new Set(planned.issues.map((issue) => issue.code))]);
    return;
  }

  // No verified production technical profile exists for floor-side yet; that
  // is the honest terminal state, never a synthetic fallback (#874 §J4).
  pushIssue('TECHNICAL_PROFILE_REQUIRED',
    `floor-side relationship ${relationship.relationshipId} has no verified production technical profile`,
    'Attach a versioned, verified technical profile before fabrication; synthetic fixtures never enter production.');
  status('TECHNICAL_PROFILE_REQUIRED',
    contactIds.map((contactId) => ({ contactId, status: 'VALID', issueCodes: [] })),
    { status: 'PLANNED', issueCodes: [],
      stationCounts: planned.plans.map((plan) => ({ contactId: plan.contactId, stationCount: plan.stations.length })),
      stationDistances: planned.plans.map((plan) => ({
        contactId: plan.contactId,
        distancesMm: plan.stations.map((station) => station.distanceMm),
      })) },
    ['TECHNICAL_PROFILE_REQUIRED']);
}

/**
 * J2-A (#874): plans each declared operation family independently over the
 * SAME verified contacts — one joint, one status, per-family counts and
 * positions; cross-family position collisions fail the whole pattern (no
 * auto-reduction, no silent overlap). Aggregate counts are per-contact sums
 * and aggregate distances the united ascending drilling pattern.
 */
function deriveFamilyPlans(
  relationship: PartRelationshipIntent,
  resolution: ContactResolutionResult,
  boards: ContactBoard[],
  contactIds: readonly string[],
  status: (stage: JoineryResolutionStage, contacts: readonly JoineryContactStatus[],
    stations: JoineryStationPlanStatus, blockers: readonly string[]) => void,
  pushIssue: (code: string, message: string, remediation: string) => void,
  options: RelationshipMachiningOptions,
  operations: ResolvedRelationshipOperation[],
): void {
  const invalid = (codes: readonly string[]): void => {
    status('STATION_INVALID', contactIds.map((contactId) => ({ contactId, status: 'VALID', issueCodes: [] })),
      { status: 'INVALID', issueCodes: [...codes], stationCounts: [], stationDistances: [] }, codes);
  };
  if (relationship.parameters?.stationCount !== undefined) {
    pushIssue('STATION_PATTERN_INVALID',
      'stationCount and families are mutually exclusive: declare one station pattern per relationship',
      'Declare either a stationCount parameter or families with unique ids and counts >= 2.');
    invalid(['STATION_PATTERN_INVALID']);
    return;
  }
  const seen = new Set<string>();
  for (const family of relationship.families ?? []) {
    if (!family.familyId.trim() || seen.has(family.familyId) ||
        typeof family.count !== 'number' || !Number.isInteger(family.count) || family.count < 2 ||
        typeof family.startMarginMm !== 'number' || !Number.isFinite(family.startMarginMm) || family.startMarginMm < 0 ||
        typeof family.endMarginMm !== 'number' || !Number.isFinite(family.endMarginMm) || family.endMarginMm < 0) {
      pushIssue('STATION_PATTERN_INVALID',
        'every family needs a unique non-blank familyId, an integer count >= 2 and finite nonnegative margins',
        'Declare families with unique ids, counts >= 2 and optional nonnegative margins.');
      invalid(['STATION_PATTERN_INVALID']);
      return;
    }
    seen.add(family.familyId);
  }
  const families = [...(relationship.families ?? [])].sort((a, b) =>
    compareUnicodeScalarIds(a.familyId, b.familyId));

  const familyPlans: JoineryFamilyPlan[] = [];
  const aggregateCounts = new Map<string, number>();
  const aggregatePositions = new Map<string, number[]>();
  for (const family of families) {
    const specs = contactIds.map((contactId) =>
      ({ contactId, count: family.count, startMarginMm: family.startMarginMm ?? 0, endMarginMm: family.endMarginMm ?? 0 }));
    const planned = planResolvedContactStations(resolution, boards, specs);
    if (planned.issues.length > 0) {
      for (const issue of planned.issues) pushIssue(issue.code, issue.message, issue.remediation ?? '');
      invalid([...new Set(planned.issues.map((issue) => issue.code))]);
      return;
    }
    const counts = planned.plans.map((plan) => ({ contactId: plan.contactId, stationCount: plan.stations.length }));
    const distances = planned.plans.map((plan) => ({
      contactId: plan.contactId,
      distancesMm: plan.stations.map((station) => station.distanceMm),
    }));
    familyPlans.push({ familyId: family.familyId, stationCounts: counts, stationDistances: distances });
    for (const plan of planned.plans) {
      aggregateCounts.set(plan.contactId, (aggregateCounts.get(plan.contactId) ?? 0) + plan.stations.length);
      const positions = aggregatePositions.get(plan.contactId) ?? [];
      positions.push(...plan.stations.map((station) => station.distanceMm));
      aggregatePositions.set(plan.contactId, positions);
    }
  }
  // Cross-family collision: two families planning the same physical position
  // on one contact is a construction error, never an overlap.
  for (const contactId of contactIds) {
    const positions = [...(aggregatePositions.get(contactId) ?? [])].sort((a, b) => a - b);
    for (let i = 1; i < positions.length; i += 1) {
      if (positions[i]! - positions[i - 1]! <= 1e-6) {
        pushIssue('STATION_FAMILY_COLLISION',
          `families plan the same station position ${positions[i]!.toFixed(3)} on contact ${contactId}; patterns must not overlap`,
          "Adjust each family's count or margins so planned positions stay distinct.");
        invalid(['STATION_FAMILY_COLLISION']);
        return;
      }
    }
  }
  const counts = contactIds.map((contactId) => ({
    contactId, stationCount: aggregateCounts.get(contactId) ?? 0,
  }));
  const distances = contactIds.map((contactId) => ({
    contactId,
    distancesMm: [...(aggregatePositions.get(contactId) ?? [])].sort((a, b) => a - b),
  }));
  // J2-A.2 (#874): with a technical profile for EVERY family the joint
  // derives real operations (one per family×contact×participant, one hole
  // per station on the participant's contact face). Any missing profile —
  // or one whose geometry does not fit a participant — keeps the honest
  // state and ZERO operations for the whole relationship.
  const familyProfiles = options.familyProfiles ?? {};
  const profiles = families.map((family) => familyProfiles[family.familyId]);
  const plannedStatus: JoineryStationPlanStatus = {
    status: 'PLANNED', issueCodes: [], stationCounts: counts, stationDistances: distances, familyPlans,
  };
  if (!profiles.every((profile) => profile !== undefined)) {
    pushIssue('TECHNICAL_PROFILE_REQUIRED',
      `floor-side relationship ${relationship.relationshipId} has no verified production technical profile`,
      'Attach a versioned, verified technical profile before fabrication; synthetic fixtures never enter production.');
    status('TECHNICAL_PROFILE_REQUIRED', contactIds.map((contactId) => ({ contactId, status: 'VALID', issueCodes: [] })), plannedStatus, ['TECHNICAL_PROFILE_REQUIRED']);
    return;
  }
  for (const profile of profiles) {
    if (!profile!.profileId.trim() || !profile!.holeType.trim() ||
        !Number.isFinite(profile!.diameterMm) || profile!.diameterMm <= 0 ||
        !Number.isFinite(profile!.depthMm) || profile!.depthMm <= 0) {
      pushIssue('TECHNICAL_PROFILE_INVALID',
        `family profile "${profile!.profileId}" needs a non-blank profile id and hole type, and finite positive diameter and depth`,
        'Attach a verified profile with real identity and tool geometry.');
      status('MACHINING_INVALID', contactIds.map((contactId) => ({ contactId, status: 'VALID', issueCodes: [] })),
        { ...plannedStatus, issueCodes: ['TECHNICAL_PROFILE_INVALID'] }, ['TECHNICAL_PROFILE_INVALID']);
      return;
    }
  }
  const byId = new Map(boards.map((board) => [board.occurrenceId, board]));
  const operationsBefore = operations.length;
  const unfit = (familyId: string, profile: FamilyTechnicalProfile, participant: string, face: string): boolean => {
    pushIssue('TECHNICAL_PROFILE_INCOMPATIBLE',
      `family ${familyId} profile ${profile.profileId} does not fit participant ${participant} on face ${face}`,
      'Attach a profile whose diameter and depth fit every participant of this joint.');
    operations.length = operationsBefore;
    status('MACHINING_INVALID', contactIds.map((contactId) => ({ contactId, status: 'VALID', issueCodes: [] })),
      { ...plannedStatus, issueCodes: ['TECHNICAL_PROFILE_INCOMPATIBLE'] }, ['TECHNICAL_PROFILE_INCOMPATIBLE']);
    return true;
  };
  for (const [familyIndex, family] of families.entries()) {
    const profile = profiles[familyIndex]!;
    const specs = contactIds.map((contactId) =>
      ({ contactId, count: family.count, startMarginMm: family.startMarginMm ?? 0, endMarginMm: family.endMarginMm ?? 0 }));
    const planned = planResolvedContactStations(resolution, boards, specs);
    for (const contact of resolution.contacts) {
      const boardA = byId.get(contact.participantA)!;
      const boardB = byId.get(contact.participantB)!;
      const holesA: HoleDefinition[] = [];
      const holesB: HoleDefinition[] = [];
      let failed = false;
      for (const plan of planned.plans) {
        if (plan.contactId !== contact.contactId) continue;
        for (const station of plan.stations) {
          const holeA = stationHole(boardA, contact.faceA, station.participantALocalMm, profile);
          if (holeA === null) {
            failed = unfit(family.familyId, profile, boardA.occurrenceId, contact.faceA);
            break;
          }
          holesA.push(holeA);
          const holeB = stationHole(boardB, contact.faceB, station.participantBLocalMm, profile);
          if (holeB === null) {
            failed = unfit(family.familyId, profile, boardB.occurrenceId, contact.faceB);
            break;
          }
          holesB.push(holeB);
        }
        if (failed) break;
      }
      if (failed) return;
      operations.push({
        operationId: `${relationship.relationshipId}:${family.familyId}:${contact.contactId}:${boardA.occurrenceId}`,
        hostComponentInstanceId: boardA.occurrenceId,
        provenance: {
          sourceKind: 'relationship', relationshipId: relationship.relationshipId,
          familyId: family.familyId, catalogRuleId: profile.profileId,
        },
        detail: { holes: holesA },
      });
      operations.push({
        operationId: `${relationship.relationshipId}:${family.familyId}:${contact.contactId}:${boardB.occurrenceId}`,
        hostComponentInstanceId: boardB.occurrenceId,
        provenance: {
          sourceKind: 'relationship', relationshipId: relationship.relationshipId,
          familyId: family.familyId, catalogRuleId: profile.profileId,
        },
        detail: { holes: holesB },
      });
    }
  }
  // A joint whose own emitted holes collide is NOT ready: the collision
  // belongs to the relationship's state, never to a global-only issue that
  // contradicts a READY stage. The whole relationship rolls back to zero
  // operations.
  const collision = firstHoleCollision(operations.slice(operationsBefore));
  if (collision !== null) {
    pushIssue('DRILLING_CONFLICT', collision.message, collision.remediation ?? '');
    operations.length = operationsBefore;
    status('MACHINING_INVALID', contactIds.map((contactId) => ({ contactId, status: 'VALID', issueCodes: [] })),
      { ...plannedStatus, issueCodes: ['DRILLING_CONFLICT'] }, ['DRILLING_CONFLICT']);
    return;
  }
  status('MACHINING_READY', contactIds.map((contactId) => ({ contactId, status: 'VALID', issueCodes: [] })), plannedStatus, []);
}

/**
 * J2-B (#874): fixed shelf ↔ sides as the cabinet's second physical contact.
 * The shelf reuses the floor-side contact geometry class (a horizontal board
 * whose length-axis end faces meet the sides' declared inner faces) but is
 * NOT a floor, and an adjustable shelf-support relationship never inherits a
 * fixed joint. This path consumes the REAL versioned recipe contract
 * (ContactOperationRecipe) through the unmodified A1a/A1b derivation; the
 * floor-side path and the frozen test-only FamilyTechnicalProfile seam stay
 * untouched.
 */
function deriveFixedShelfJoinery(
  relationship: PartRelationshipIntent,
  components: ReadonlyMap<StableEntityId, ComponentIndexEntry>,
  catalog: SketchUpJoineryCatalog,
  issues: ContractIssue[],
  joineryStatuses: JoineryRelationshipStatus[],
  operations: ResolvedRelationshipOperation[],
): void {
  const contactIds = relationship.targets.map((anchor) => `${relationship.relationshipId}:${anchor.componentInstanceId}`);
  const failContacts = (codes: readonly string[]): void => {
    joineryStatuses.push({
      relationshipId: relationship.relationshipId, kind: relationship.kind,
      stage: 'CONTACT_INVALID', contacts: contactIds.map((contactId) => ({ contactId, status: 'INVALID', issueCodes: codes })),
      stations: { status: 'NOT_PLANNED', issueCodes: [], stationCounts: [], stationDistances: [] }, blockers: codes,
    });
  };
  const pushIssue = (code: string, message: string, remediation: string): void => {
    issues.push({ code, message, severity: 'error', entityId: relationship.relationshipId, remediation });
  };

  const boards: ContactBoard[] = [];
  const anchorBoard = (anchor: PartRelationshipIntent['source']): boolean => {
    const component = components.get(anchor.componentInstanceId);
    if (component === undefined) {
      pushIssue('RELATIONSHIP_ORPHANED',
        `anchor references componentInstanceId ${anchor.componentInstanceId} that is not part of this assembly`,
        'Anchor the relationship to a component instance present in the snapshot.');
      return false;
    }
    const geometry = catalog.componentGeometry[component.componentDefinitionId];
    if (geometry === undefined) {
      pushIssue('CATALOG_REFERENCE_MISSING',
        `no geometry for componentDefinitionId ${component.componentDefinitionId}`,
        'Ensure the component definition exists in the active joinery catalog.');
      return false;
    }
    const basis = quaternionBasis(component.transform.rotationQuaternion);
    if (basis === null || component.transform.scale.some((value) => value !== 1)) {
      pushIssue('TRANSFORM_INVALID',
        `component ${component.componentInstanceId} placement is not a rigid unit-scale frame`,
        'Transport a normalized quaternion and unit scale for every fixed-shelf participant.');
      return false;
    }
    boards.push({
      occurrenceId: component.componentInstanceId,
      widthMm: geometry.widthMm, thicknessMm: geometry.thicknessMm, lengthMm: geometry.lengthMm,
      translationMm: component.transform.translationMm,
      basis: { x: snapBasisVector(basis.x), y: snapBasisVector(basis.y), z: snapBasisVector(basis.z) },
    });
    return true;
  };

  if (!anchorBoard(relationship.source)) {
    failContacts(['RELATIONSHIP_ORPHANED', 'CATALOG_REFERENCE_MISSING', 'TRANSFORM_INVALID']
      .filter((code) => issues.some((issue) => issue.entityId === relationship.relationshipId && issue.code === code)));
    return;
  }
  for (const anchor of relationship.targets) {
    const before = issues.length;
    if (!anchorBoard(anchor)) {
      failContacts(issues.slice(before).map((issue) => issue.code));
      return;
    }
  }

  const result = deriveFixedShelfOperations(relationship, boards);
  issues.push(...result.issues);
  operations.push(...result.operations);
  joineryStatuses.push(result.status);
}

/** Pure J2-B derivation result: the joinery status, the converted productive
 *  operations and the structured issues (#874). */
export interface FixedShelfOperationsResult {
  readonly status: JoineryRelationshipStatus;
  readonly operations: readonly ResolvedRelationshipOperation[];
  readonly issues: readonly ContractIssue[];
}

/**
 * Pure J2-B derivation over concrete contact boards: declared faces, exact
 * plane coincidence (A0a), one uniform station pattern (A0b), and — when
 * versioned recipes cover every contact — the real A1a/A1b operation
 * derivation converted to productive operations. Without recipes the joint
 * stays at the honest TECHNICAL_PROFILE_REQUIRED terminal with zero
 * operations (#874 §J4: no verified production technical profile exists).
 */
export function deriveFixedShelfOperations(
  relationship: PartRelationshipIntent,
  boards: readonly ContactBoard[],
): FixedShelfOperationsResult {
  const issues: ContractIssue[] = [];
  const operations: ResolvedRelationshipOperation[] = [];
  const contactIds = relationship.targets.map((anchor) => `${relationship.relationshipId}:${anchor.componentInstanceId}`);
  const pushIssue = (code: string, message: string, remediation: string): void => {
    issues.push({ code, message, severity: 'error', entityId: relationship.relationshipId, remediation });
  };
  const status = (stage: JoineryResolutionStage, contacts: readonly JoineryContactStatus[],
    stations: JoineryStationPlanStatus, blockers: readonly string[]): JoineryRelationshipStatus => ({
    relationshipId: relationship.relationshipId, kind: relationship.kind,
    stage, contacts, stations, blockers,
  });
  const failContacts = (codes: readonly string[]): JoineryRelationshipStatus =>
    status('CONTACT_INVALID', contactIds.map((contactId) => ({ contactId, status: 'INVALID', issueCodes: codes })),
      { status: 'NOT_PLANNED', issueCodes: [], stationCounts: [], stationDistances: [] }, codes);
  const validContacts = (): readonly JoineryContactStatus[] =>
    contactIds.map((contactId) => ({ contactId, status: 'VALID' as const, issueCodes: [] as string[] }));

  const counts = new Map<string, number>();
  for (const board of boards) counts.set(board.occurrenceId, (counts.get(board.occurrenceId) ?? 0) + 1);
  const byId = new Map(boards.map((board) => [board.occurrenceId, board]));
  const anchorBoard = (anchor: PartRelationshipIntent['source'], anchorKind: string): ContactBoard | null => {
    if (counts.get(anchor.componentInstanceId) !== 1) {
      pushIssue('RELATIONSHIP_ORPHANED',
        `${anchorKind} anchor references componentInstanceId ${anchor.componentInstanceId} that is not an unambiguous participant board`,
        'Anchor the relationship to exactly one component instance present in the snapshot.');
      return null;
    }
    if (anchorKind === 'target' && (anchor.face === undefined || !FLOOR_FACES.includes(anchor.face as ContactFace))) {
      pushIssue('CONTACT_FACE_REQUIRED',
        `${anchorKind} anchor must declare one concrete contact face (${anchor.componentInstanceId})`,
        'Declare the physical contact face on every fixed-shelf target; proximity never infers a union.');
      return null;
    }
    if (anchorKind === 'source' && anchor.face !== undefined && !FLOOR_FACES.includes(anchor.face as ContactFace)) {
      pushIssue('CONTACT_FACE_REQUIRED',
        'source anchor declares a face outside the six concrete board faces',
        'Declare a top/bottom/left/right/front/back source face or omit it for exact plane verification.');
      return null;
    }
    return byId.get(anchor.componentInstanceId)!;
  };

  const sourceBoard = anchorBoard(relationship.source, 'source');
  if (sourceBoard === null) {
    return { status: failContacts([issues.at(-1)!.code]), operations, issues };
  }
  const participants: ContactBoard[] = [sourceBoard];
  const contacts: ExplicitContact[] = [];
  for (const [index, anchor] of relationship.targets.entries()) {
    const targetBoard = anchorBoard(anchor, 'target');
    if (targetBoard === null) {
      return { status: failContacts([issues.at(-1)!.code]), operations, issues };
    }
    participants.push(targetBoard);
    const derivedFaceA = coincidentFaceA(sourceBoard, targetBoard, anchor.face as ContactFace);
    if (derivedFaceA === null || derivedFaceA === 'AMBIGUOUS'
        || (relationship.source.face !== undefined && relationship.source.face !== derivedFaceA)) {
      pushIssue('CONTACT_FACE_REQUIRED',
        `declared target face does not coincide with exactly one face of ${relationship.source.componentInstanceId}`,
        'Anchor fixed-shelf contacts on faces that physically coincide; proximity never infers a union.');
      return { status: failContacts(['CONTACT_FACE_REQUIRED']), operations, issues };
    }
    contacts.push({
      relationshipId: relationship.relationshipId, contactId: contactIds[index]!,
      participantA: relationship.source.componentInstanceId, participantB: anchor.componentInstanceId,
      faceA: derivedFaceA, faceB: anchor.face as ContactFace,
    });
  }

  const resolution = resolveExplicitContacts({ boards: participants, contacts, requiredContactIds: contactIds });
  if (resolution.issues.length > 0) {
    issues.push(...resolution.issues);
    return { status: failContacts([...new Set(resolution.issues.map((issue) => issue.code))]), operations, issues };
  }

  const invalidStations = (codes: readonly string[]): JoineryRelationshipStatus =>
    status('STATION_INVALID', validContacts(),
      { status: 'INVALID', issueCodes: [...codes], stationCounts: [], stationDistances: [] }, codes);
  if ((relationship.families ?? []).length > 0) {
    pushIssue('STATION_PATTERN_INVALID',
      'fixed-shelf-side declares one uniform station pattern; families are the floor-side mechanism',
      'Declare a stationCount parameter or use a floor-side relationship for operation families.');
    return { status: invalidStations(['STATION_PATTERN_INVALID']), operations, issues };
  }
  const parameters = relationship.parameters ?? {};
  const count = parameters.stationCount;
  const start: unknown = parameters.startMarginMm ?? 0;
  const end: unknown = parameters.endMarginMm ?? 0;
  const validMargin = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 2
      || !validMargin(start) || !validMargin(end)) {
    pushIssue('STATION_PATTERN_INVALID',
      'fixed-shelf station pattern needs an integer stationCount >= 2 and finite nonnegative margins',
      'Declare stationCount (>= 2) and optional nonnegative start/end margins on the relationship.');
    return { status: invalidStations(['STATION_PATTERN_INVALID']), operations, issues };
  }
  const specs = contactIds.map((contactId) =>
    ({ contactId, count, startMarginMm: start as number, endMarginMm: end as number }));
  const planned = planResolvedContactStations(resolution, participants, specs);
  if (planned.issues.length > 0) {
    issues.push(...planned.issues);
    return { status: invalidStations([...new Set(planned.issues.map((issue) => issue.code))]), operations, issues };
  }
  const plannedStatus = (codes: readonly string[], stage: JoineryResolutionStage): JoineryRelationshipStatus =>
    status(stage, validContacts(), {
      status: 'PLANNED', issueCodes: [...codes],
      stationCounts: planned.plans.map((plan) => ({ contactId: plan.contactId, stationCount: plan.stations.length })),
      stationDistances: planned.plans.map((plan) => ({
        contactId: plan.contactId,
        distancesMm: plan.stations.map((station) => station.distanceMm),
      })),
    }, codes);

  if (relationship.recipes === undefined || relationship.recipes.length === 0) {
    // No versioned recipe with a verified technical profile exists for this
    // joint: the honest terminal state, never a synthetic fallback (#874
    // §J4). Stations are published; zero operations are emitted.
    pushIssue('TECHNICAL_PROFILE_REQUIRED',
      `fixed-shelf-side relationship ${relationship.relationshipId} declares no versioned recipe with a verified technical profile`,
      'Attach a versioned recipe with a verified technical profile before fabrication; synthetic fixtures never enter production.');
    return { status: plannedStatus(['TECHNICAL_PROFILE_REQUIRED'], 'TECHNICAL_PROFILE_REQUIRED'), operations, issues };
  }

  // The REAL versioned recipe derivation (#874 J2-B): the A1b reconciler
  // re-validates identity, rules, technical profiles and swept-cylinder
  // geometry, and fails the whole relationship on any defect.
  const derived = deriveResolvedContactOperations(resolution, planned, participants, specs, relationship.recipes);
  if (derived.issues.length > 0) {
    issues.push(...derived.issues.map((issue) => ({ ...issue,
      path: `furniture.relationships[relationshipId=${relationship.relationshipId}].recipes`,
      remediation: 'Attach a versioned recipe with a verified technical profile that fits every participant of this joint.' })));
    const codes = [...new Set(derived.issues.map((issue) => issue.code))];
    const stage: JoineryResolutionStage = codes.includes('TECHNICAL_PROFILE_REQUIRED')
      ? 'TECHNICAL_PROFILE_REQUIRED' : 'MACHINING_INVALID';
    return { status: plannedStatus(codes, stage), operations, issues };
  }

  // Convert the neutral per-station operations into productive operations:
  // one per contact×participant×rule, one hole per station on the entry face
  // under the #356 face-coordinate convention. A1a admits only face-normal
  // bores, so the projection is lossless.
  const order: { operationId: string; participant: string; provenance: RelationshipProvenance; holes: HoleDefinition[] }[] = [];
  const byKey = new Map<string, (typeof order)[number]>();
  for (const neutral of derived.operations) {
    const key = `${neutral.provenance.contactId}\u0000${neutral.provenance.participantId}\u0000${neutral.provenance.ruleId}`;
    let pending = byKey.get(key);
    if (pending === undefined) {
      pending = {
        operationId: `${relationship.relationshipId}:${neutral.provenance.contactId}:${neutral.provenance.participantId}:${neutral.provenance.ruleId}`,
        participant: neutral.provenance.participantId,
        provenance: {
          sourceKind: 'relationship', relationshipId: relationship.relationshipId,
          catalogRuleId: neutral.provenance.recipeId, recipeRevision: neutral.provenance.recipeRevision,
          technicalProfileId: neutral.technicalProfileId, technicalProfileRevision: neutral.technicalProfileRevision,
        },
        holes: [],
      };
      byKey.set(key, pending);
      order.push(pending);
    }
    const hole = fixedShelfHole(neutral);
    if (hole === null) {
      pushIssue('OPERATION_GEOMETRY_INVALID',
        `recipe rule ${neutral.provenance.ruleId} does not project onto a concrete entry face`,
        'Attach a recipe whose rules enter through one of the six concrete board faces.');
      return { status: plannedStatus(['OPERATION_GEOMETRY_INVALID'], 'MACHINING_INVALID'), operations: [], issues };
    }
    pending.holes.push(hole);
  }
  operations.push(...order.map((pending) => ({
    operationId: pending.operationId,
    hostComponentInstanceId: pending.participant,
    provenance: pending.provenance,
    detail: { holes: pending.holes },
  })));
  // A joint whose own emitted holes collide is NOT ready: the collision
  // belongs to the relationship's state (#874). The whole relationship rolls
  // back to zero operations.
  const collision = firstHoleCollision(operations);
  if (collision !== null) {
    pushIssue('DRILLING_CONFLICT', collision.message, collision.remediation ?? '');
    return { status: plannedStatus(['DRILLING_CONFLICT'], 'MACHINING_INVALID'), operations: [], issues };
  }
  return { status: plannedStatus([], 'MACHINING_READY'), operations, issues };
}

/** Project one neutral operation onto its participant's entry face using the
 *  #356 face-coordinate convention: the two non-normal local axes in
 *  X<Y<Z order. A1a admits only face-normal bores, so it is lossless. */
function fixedShelfHole(operation: NeutralContactOperation): HoleDefinition | null {
  const axes: Record<string, [number, boolean]> = {
    left: [0, false], right: [0, true], back: [1, false], front: [1, true], bottom: [2, false], top: [2, true],
  };
  const entry = axes[operation.entryFace];
  if (entry === undefined) return null;
  const [axis] = entry;
  const plane: [number, number] = [0, 0];
  let pi = 0;
  for (let i = 0; i < 3; i += 1) {
    if (i === axis) continue;
    plane[pi] = operation.centerLocalMm[i]!;
    pi += 1;
  }
  return {
    face: operation.entryFace,
    xMm: plane[0]!, yMm: plane[1]!,
    diameterMm: operation.diameterMm, depthMm: operation.depthMm,
    type: operation.provenance.operationRole as HoleDefinition['type'],
  };
}

/** First same-host same-face hole overlap (centers closer than the sum of
 *  the radii) among the given operations; null when clean. */
function firstHoleCollision(
  operations: readonly ResolvedRelationshipOperation[],
): { message: string; remediation?: string } | null {
  // Flat same-host hole list (mirrors the Go detector): pairs may come from
  // the same or different operations.
  const byHost = new Map<string, { operationId: string; hole: HoleDefinition }[]>();
  for (const operation of operations) {
    const bucket = byHost.get(operation.hostComponentInstanceId) ?? [];
    for (const hole of operation.detail.holes) {
      bucket.push({ operationId: operation.operationId, hole });
    }
    byHost.set(operation.hostComponentInstanceId, bucket);
  }
  for (const [host, holes] of byHost) {
    for (let i = 0; i < holes.length; i += 1) {
      for (let j = i + 1; j < holes.length; j += 1) {
        const h1 = holes[i]!.hole;
        const h2 = holes[j]!.hole;
        if (h1.face !== h2.face) continue;
        const distance = Math.hypot(h1.xMm - h2.xMm, h1.yMm - h2.yMm);
        if (distance < (h1.diameterMm + h2.diameterMm) / 2) {
          return {
            message: `Hole collision on host ${host} ` +
              `(${h1.type} Ø${h1.diameterMm} at [${h1.xMm}, ${h1.yMm}] collides with ` +
              `${h2.type} Ø${h2.diameterMm} at [${h2.xMm}, ${h2.yMm}])`,
            remediation: 'Shift conflicting positions to ensure minimum clearance.',
          };
        }
      }
    }
  }
  return null;
}

/** Project a station's board-local point onto its contact face (the entry
 *  face) using the #356 face-coordinate convention: the two non-normal
 *  local axes in X<Y<Z order. The bit must fit the face plane and the bore
 *  the board from the entry face. */
function stationHole(
  board: ContactBoard,
  face: string,
  local: Vec3,
  profile: FamilyTechnicalProfile,
): HoleDefinition | null {
  const axes: Record<string, [number, boolean]> = {
    left: [0, false], right: [0, true], back: [1, false], front: [1, true], bottom: [2, false], top: [2, true],
  };
  const entry = axes[face];
  if (entry === undefined) return null;
  const [axis, high] = entry;
  const dims: Vec3 = [board.widthMm, board.thicknessMm, board.lengthMm];
  const radius = profile.diameterMm / 2;
  const faceCoord = high ? dims[axis]! : 0;
  if (Math.abs(local[axis]! - faceCoord) > 1e-6) return null;
  if (profile.depthMm > dims[axis]! + 1e-6) return null;
  const plane: [number, number] = [0, 0];
  const nonAxis: [number, number] = [0, 0];
  let pi = 0;
  for (let i = 0; i < 3; i += 1) {
    if (i === axis) continue;
    plane[pi] = local[i]!;
    nonAxis[pi] = i;
    pi += 1;
  }
  if (plane[0]! < radius - 1e-6 || plane[1]! < radius - 1e-6 ||
      plane[0]! > dims[nonAxis[0]]! - radius + 1e-6 || plane[1]! > dims[nonAxis[1]]! - radius + 1e-6) {
    return null;
  }
  return {
    face: face as HoleDefinition['face'],
    xMm: plane[0]!, yMm: plane[1]!,
    diameterMm: profile.diameterMm, depthMm: profile.depthMm,
    type: profile.holeType as HoleDefinition['type'],
  };
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
      transform: {
        translationMm: component.transform.translationMm,
        rotationQuaternion: component.transform.rotationQuaternion,
        scale: component.transform.scale,
      },
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

// J1-A0a contact resolution lives beside the #356 relationship owner.
// floor-side and fixed-shelf-side relationships select this foundation for
// productive resolution; the shelf-support legacy table and manual
// placements stay outside it.
type Vec3 = readonly [number, number, number];
type ContactFace = HoleDefinition['face'];

export interface ContactBoard {
  /** Concrete board occurrence, never a component definition ID. */
  readonly occurrenceId: string;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly lengthMm: number;
  readonly translationMm: Vec3;
  readonly basis: { readonly x: Vec3; readonly y: Vec3; readonly z: Vec3 };
}

export interface ExplicitContact {
  readonly relationshipId: string;
  readonly contactId: string;
  readonly participantA: string;
  readonly participantB: string;
  readonly faceA: ContactFace;
  readonly faceB: ContactFace;
}

export interface ContactResolutionInput {
  readonly boards: readonly ContactBoard[];
  readonly contacts: readonly ExplicitContact[];
  readonly requiredContactIds: readonly string[];
}

export interface ResolvedContact extends ExplicitContact {
  readonly frame: { readonly originAssemblyMm: Vec3; readonly axisAssembly: Vec3; readonly normalAssembly: Vec3 };
  /** Useful interval measured from frame.originAssemblyMm along frame.axisAssembly. */
  readonly overlapMm: readonly [number, number];
}

export interface ContactResolutionResult {
  readonly contacts: readonly ResolvedContact[];
  readonly issues: readonly ContractIssue[];
}

const contactDot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const contactDelta = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const contactScale = (a: Vec3, b: Vec3, n: number): Vec3 => [a[0] + n * b[0], a[1] + n * b[1], a[2] + n * b[2]];
const contactNegate = (v: Vec3): Vec3 => v.map((value) => value === 0 ? 0 : -value) as unknown as Vec3;
const contactSize = (b: ContactBoard): Vec3 => [b.widthMm, b.thicknessMm, b.lengthMm];

function contactFrameValid(b: ContactBoard): boolean {
  const { x, y, z } = b.basis;
  const values = [...b.translationMm, ...contactSize(b), ...x, ...y, ...z];
  if (!values.every(Number.isFinite) || contactSize(b).some((size) => size <= 0)) return false;
  const cross: Vec3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return Math.abs(contactDot(x, x) - 1) < 1e-6 && Math.abs(contactDot(y, y) - 1) < 1e-6 &&
    Math.abs(contactDot(z, z) - 1) < 1e-6 && Math.abs(contactDot(x, y)) < 1e-6 &&
    Math.abs(contactDot(x, z)) < 1e-6 && Math.abs(contactDot(y, z)) < 1e-6 &&
    Math.abs(contactDot(cross, z) - 1) < 1e-6;
}

function contactToAssembly(b: ContactBoard, p: Vec3): Vec3 {
  return contactScale(contactScale(contactScale(b.translationMm, b.basis.x, p[0]), b.basis.y, p[1]), b.basis.z, p[2]);
}

function contactSurface(b: ContactBoard, face: ContactFace): { corners: Vec3[]; normal: Vec3 } {
  const dims = contactSize(b);
  const axis = face === 'left' || face === 'right' ? 0 : face === 'front' || face === 'back' ? 1 : 2;
  const high = face === 'right' || face === 'front' || face === 'top';
  const other = ([0, 1, 2] as const).filter((index) => index !== axis);
  const corners = [0, 1, 2, 3].map((index): Vec3 => {
    const p = [0, 0, 0];
    p[axis] = high ? dims[axis]! : 0;
    p[other[0]!] = index & 1 ? dims[other[0]!]! : 0;
    p[other[1]!] = index & 2 ? dims[other[1]!]! : 0;
    return contactToAssembly(b, p as unknown as Vec3);
  });
  const normal = [b.basis.x, b.basis.y, b.basis.z][axis]!;
  return { corners, normal: high ? normal : contactNegate(normal) };
}

/** Unicode scalar order matches Go's UTF-8 order for valid contact and rule IDs. */
const compareUnicodeScalarIds = (a: string, b: string): number => {
  const left = Array.from(a, (character) => character.codePointAt(0)!);
  const right = Array.from(b, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
};

/** Resolve only declared occurrence contacts; A0b will plan stations in this frame. */
export function resolveExplicitContacts(input: ContactResolutionInput): ContactResolutionResult {
  const contacts: ResolvedContact[] = [];
  const issues: ContractIssue[] = [];
  const boards = new Map(input.boards.map((board) => [board.occurrenceId, board]));
  const seen = new Set<string>();
  const contactCounts = new Map<string, number>();
  for (const contact of input.contacts) {
    contactCounts.set(contact.contactId, (contactCounts.get(contact.contactId) ?? 0) + 1);
  }
  const fail = (id: string, code: string): void => {
    issues.push({ code, message: code, severity: 'error', entityId: id });
  };
  for (const id of input.requiredContactIds) {
    if (!input.contacts.some((contact) => contact.contactId === id)) fail(id, 'CONTACT_REQUIRED_MISSING');
  }
  for (const intent of [...input.contacts].sort((a, b) => compareUnicodeScalarIds(a.contactId, b.contactId))) {
    if (seen.has(intent.contactId)) continue;
    seen.add(intent.contactId);
    if (contactCounts.get(intent.contactId)! > 1) { fail(intent.contactId, 'CONTACT_AMBIGUOUS'); continue; }
    if (!intent.contactId.trim() || !intent.relationshipId.trim() ||
        !intent.participantA.trim() || !intent.participantB.trim()) {
      fail(intent.contactId, 'CONTACT_IDENTITY_INVALID'); continue;
    }
    const a = boards.get(intent.participantA);
    const b = boards.get(intent.participantB);
    if (!a || !b || a.occurrenceId === b.occurrenceId) { fail(intent.contactId, 'CONTACT_PARTICIPANT_MISSING'); continue; }
    if (input.boards.filter((board) => board.occurrenceId === a.occurrenceId || board.occurrenceId === b.occurrenceId).length !== 2) {
      fail(intent.contactId, 'CONTACT_AMBIGUOUS'); continue;
    }
    if (!contactFrameValid(a) || !contactFrameValid(b)) { fail(intent.contactId, 'CONTACT_FRAME_INVALID'); continue; }
    if (!['bottom', 'top'].includes(intent.faceA) || !['front', 'back'].includes(intent.faceB)) {
      fail(intent.contactId, 'CONTACT_FACE_INCOMPATIBLE'); continue;
    }
    const sa = contactSurface(a, intent.faceA);
    const sb = contactSurface(b, intent.faceB);
    if (Math.abs(contactDot(sa.normal, sb.normal) + 1) > 1e-6 ||
        Math.abs(contactDot(contactDelta(sa.corners[0]!, sb.corners[0]!), sa.normal)) > 1e-6) {
      fail(intent.contactId, 'CONTACT_FACE_INCOMPATIBLE'); continue;
    }
    const axis = a.basis.x;
    const across = a.basis.y;
    if (Math.abs(Math.abs(contactDot(axis, b.basis.x)) - 1) > 1e-6 ||
        Math.abs(Math.abs(contactDot(across, b.basis.z)) - 1) > 1e-6) {
      fail(intent.contactId, 'CONTACT_FACE_INCOMPATIBLE'); continue;
    }
    const overlap = (direction: Vec3): readonly [number, number] => {
      const pa = sa.corners.map((p) => contactDot(p, direction));
      const pb = sb.corners.map((p) => contactDot(p, direction));
      return [Math.max(Math.min(...pa), Math.min(...pb)), Math.min(Math.max(...pa), Math.max(...pb))];
    };
    const [start, end] = overlap(axis);
    const [crossStart, crossEnd] = overlap(across);
    if (end - start <= 1e-6 || crossEnd - crossStart <= 1e-6) {
      fail(intent.contactId, 'CONTACT_NO_OVERLAP'); continue;
    }
    const corner = sa.corners[0]!;
    const origin = contactScale(contactScale(corner, axis, start - contactDot(corner, axis)),
      across, (crossStart + crossEnd) / 2 - contactDot(corner, across));
    contacts.push({ ...intent, frame: { originAssemblyMm: origin, axisAssembly: axis, normalAssembly: sa.normal },
      overlapMm: [0, end - start] });
  }
  return { contacts, issues };
}

/** Neutral station policy. A single station needs an explicit anchor, not supplied by A0b. */
export interface StationSpec {
  readonly contactId: string;
  readonly count: number;
  readonly startMarginMm: number;
  readonly endMarginMm: number;
}

export interface ContactStation {
  readonly distanceMm: number;
  readonly assemblyPointMm: Vec3;
  readonly participantALocalMm: Vec3;
  readonly participantBLocalMm: Vec3;
}

export interface StationPlan {
  readonly contactId: string;
  readonly stations: readonly ContactStation[];
}

export interface StationPlanResult {
  readonly plans: readonly StationPlan[];
  readonly issues: readonly ContractIssue[];
}

const contactToLocal = (board: ContactBoard, point: Vec3): Vec3 => {
  const delta = contactDelta(point, board.translationMm);
  return [contactDot(delta, board.basis.x), contactDot(delta, board.basis.y), contactDot(delta, board.basis.z)];
};

/** Plan once in the declared contact frame, then invert that same point into each occurrence. */
export function planResolvedContactStations(
  resolution: ContactResolutionResult,
  boards: readonly ContactBoard[],
  specs: readonly StationSpec[],
): StationPlanResult {
  if (resolution.issues.length) return { plans: [], issues: resolution.issues };
  const plans: StationPlan[] = [];
  const issues: ContractIssue[] = [];
  const fail = (id: string, code: string): void => {
    issues.push({ code, message: code, severity: 'error', entityId: id });
  };
  const boardCounts = new Map<string, number>();
  for (const board of boards) boardCounts.set(board.occurrenceId, (boardCounts.get(board.occurrenceId) ?? 0) + 1);
  const specCounts = new Map<string, number>();
  for (const spec of specs) specCounts.set(spec.contactId, (specCounts.get(spec.contactId) ?? 0) + 1);
  const contactCounts = new Map<string, number>();
  for (const contact of resolution.contacts) contactCounts.set(contact.contactId, (contactCounts.get(contact.contactId) ?? 0) + 1);
  for (const spec of specs) if (!contactCounts.has(spec.contactId)) fail(spec.contactId, 'STATION_CONTACT_UNKNOWN');

  for (const contact of [...resolution.contacts].sort((a, b) => compareUnicodeScalarIds(a.contactId, b.contactId))) {
    const id = contact.contactId;
    if (contactCounts.get(id) !== 1) { fail(id, 'STATION_CONTACT_AMBIGUOUS'); continue; }
    if (!specCounts.has(id)) { fail(id, 'STATION_SPEC_MISSING'); continue; }
    if (specCounts.get(id) !== 1) { fail(id, 'STATION_SPEC_AMBIGUOUS'); continue; }
    const spec = specs.find((item) => item.contactId === id)!;
    if (!Number.isSafeInteger(spec.count) || spec.count < 2) { fail(id, 'STATION_COUNT_INVALID'); continue; }
    if (![spec.startMarginMm, spec.endMarginMm].every(Number.isFinite) ||
        spec.startMarginMm < 0 || spec.endMarginMm < 0) { fail(id, 'STATION_MARGIN_INVALID'); continue; }
    const [lo, hi] = contact.overlapMm;
    const { originAssemblyMm: origin, axisAssembly: axis, normalAssembly: normal } = contact.frame;
    if (![lo, hi, ...origin, ...axis, ...normal].every(Number.isFinite) || lo !== 0 || hi <= 0 ||
        Math.abs(contactDot(axis, axis) - 1) > 1e-6 || Math.abs(contactDot(normal, normal) - 1) > 1e-6 ||
        Math.abs(contactDot(axis, normal)) > 1e-6) { fail(id, 'STATION_FRAME_INVALID'); continue; }
    const first = lo + spec.startMarginMm;
    const last = hi - spec.endMarginMm;
    if (!Number.isFinite(first) || !Number.isFinite(last) || first >= last || first < lo || last > hi) {
      fail(id, 'STATION_SPAN_INVALID'); continue;
    }
    const a = boards.find((board) => board.occurrenceId === contact.participantA);
    const b = boards.find((board) => board.occurrenceId === contact.participantB);
    if (!a || !b || a === b || boardCounts.get(a.occurrenceId) !== 1 || boardCounts.get(b.occurrenceId) !== 1 ||
        !contactFrameValid(a) || !contactFrameValid(b)) { fail(id, 'STATION_PARTICIPANT_INVALID'); continue; }
    const stations: ContactStation[] = [];
    for (let index = 0; index < spec.count; index += 1) {
      const distanceMm = index === spec.count - 1 ? last : first + index * (last - first) / (spec.count - 1);
      const assemblyPointMm = contactScale(origin, axis, distanceMm);
      const participantALocalMm = contactToLocal(a, assemblyPointMm);
      const participantBLocalMm = contactToLocal(b, assemblyPointMm);
      const inBounds = (board: ContactBoard, local: Vec3): boolean =>
        local.every((value, coordinate) => Number.isFinite(value) && value >= -1e-6 && value <= contactSize(board)[coordinate]! + 1e-6) &&
        contactDelta(contactToAssembly(board, local), assemblyPointMm).every((delta) => Math.abs(delta) <= 1e-6);
      if (!Number.isFinite(distanceMm) || distanceMm < lo || distanceMm > hi ||
          !inBounds(a, participantALocalMm) || !inBounds(b, participantBLocalMm)) {
        fail(id, 'STATION_POINT_INVALID'); break;
      }
      stations.push({ distanceMm, assemblyPointMm, participantALocalMm, participantBLocalMm });
    }
    if (stations.length === spec.count) plans.push({ contactId: id, stations });
  }
  return issues.length ? { plans: [], issues } : { plans, issues: [] };
}

/** Explicit, versioned technical input; no catalog lookup or synthetic default is supplied here. */
export interface ContactOperationRule {
  readonly ruleId: string;
  readonly ruleRevision: string;
  readonly participantRole: 'A' | 'B';
  readonly operationRole: string;
  readonly entryFace: ContactFace;
  /** Components along contact axis, contact normal, and axis × normal. */
  readonly offsetMm: Vec3;
  readonly axis: Vec3;
  readonly diameterMm: number;
  readonly depthMm: number;
}

export interface ContactOperationRecipe {
  readonly contactId: string;
  readonly recipeId: string;
  readonly recipeRevision: string;
  readonly technicalProfileId: string;
  readonly technicalProfileRevision: string;
  readonly rules: readonly ContactOperationRule[];
}

export interface ContactOperationProvenance {
  readonly sourceKind: 'relationship';
  readonly relationshipId: string;
  readonly contactId: string;
  readonly participantId: string;
  readonly participantRole: 'A' | 'B';
  readonly stationIndex: number;
  readonly recipeId: string;
  readonly recipeRevision: string;
  readonly ruleId: string;
  readonly ruleRevision: string;
  readonly operationRole: string;
}

export interface NeutralContactOperation {
  readonly operationId: string;
  readonly provenance: ContactOperationProvenance;
  readonly technicalProfileId: string;
  readonly technicalProfileRevision: string;
  readonly entryFace: ContactFace;
  readonly centerLocalMm: Vec3;
  readonly axisLocal: Vec3;
  readonly diameterMm: number;
  readonly depthMm: number;
}

export interface ContactOperationResult {
  readonly operations: readonly NeutralContactOperation[];
  readonly issues: readonly ContractIssue[];
}

/** Stable nine-field identity for neutral J1 operations, independent of geometry serialization. */
export function contactOperationId(provenance: ContactOperationProvenance): string {
  const parts = [provenance.relationshipId, provenance.contactId, provenance.participantId,
    provenance.stationIndex, provenance.recipeId, provenance.recipeRevision, provenance.ruleId,
    provenance.ruleRevision, provenance.operationRole];
  return `j1:${JSON.stringify(parts).replace(/[<>&\u2028\u2029]/g,
    value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`)}`;
}

const contactCross = (a: Vec3, b: Vec3): Vec3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const contactNear = (a: Vec3, b: Vec3): boolean =>
  Array.isArray(a) && a.length === 3 && a.every((value, index) =>
    Number.isFinite(value) && Math.abs(value - b[index]!) <= 1e-6);
const contactClean = (v: Vec3): Vec3 => v.map((n) => Math.abs(n) < 1e-9 ? 0 : n) as unknown as Vec3;
const contactFaceAxis = (face: ContactFace): readonly [number, boolean] =>
  face === 'left' || face === 'right' ? [0, face === 'right'] :
    face === 'front' || face === 'back' ? [1, face === 'front'] : [2, face === 'top'];

/** Derive one complete paired operation set; no multi-contact collection is accepted here. */
export function deriveResolvedContactOperationsForContact(
  contact: ResolvedContact,
  plan: StationPlan,
  boards: readonly ContactBoard[],
  spec: StationSpec,
  recipe: ContactOperationRecipe,
): ContactOperationResult {
  if (!contact || !plan || !Array.isArray(boards) || !spec || !recipe) {
    return { operations: [], issues: [{ code: 'OPERATION_INPUT_INVALID', message: 'OPERATION_INPUT_INVALID', severity: 'error' }] };
  }
  const fail = (code: string): ContactOperationResult => ({
    operations: [], issues: [{ code, message: code, severity: 'error', entityId: contact.contactId }],
  });
  const validVector = (vector: unknown): vector is Vec3 =>
    Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite);
  if (!Array.isArray(plan.stations) || plan.stations.some((station) => !station) ||
      !validVector(contact.frame?.originAssemblyMm) || !validVector(contact.frame?.axisAssembly) ||
      !validVector(contact.frame?.normalAssembly) || !Array.isArray(contact.overlapMm) ||
      contact.overlapMm.length !== 2 || !contact.overlapMm.every(Number.isFinite)) return fail('OPERATION_PLAN_INVALID');
  if (boards.some((board) => !board)) return fail('OPERATION_PARTICIPANT_INVALID');
  const id = contact.contactId;
  if (!id?.trim() || !contact.relationshipId?.trim() || !contact.participantA?.trim() ||
      !contact.participantB?.trim() || plan.contactId !== id || spec.contactId !== id || recipe.contactId !== id) {
    return fail('OPERATION_IDENTITY_INVALID');
  }
  const a = boards.filter((board) => board.occurrenceId === contact.participantA);
  const b = boards.filter((board) => board.occurrenceId === contact.participantB);
  if (a.length !== 1 || b.length !== 1 || a[0] === b[0]) return fail('OPERATION_PARTICIPANT_INVALID');
  const validParticipant = (board: ContactBoard): boolean =>
    validVector(board.translationMm) && !!board.basis &&
    validVector(board.basis.x) && validVector(board.basis.y) && validVector(board.basis.z) &&
    contactFrameValid(board);
  if (!validParticipant(a[0]!) || !validParticipant(b[0]!)) return fail('OPERATION_PARTICIPANT_INVALID');
  const authoritative = planResolvedContactStations({ contacts: [contact], issues: [] }, boards, [spec]);
  const stations = authoritative.plans[0]?.stations;
  if (authoritative.issues.length || !stations || plan.stations.length !== stations.length ||
      plan.stations.some((station, index) => {
        const expected = stations[index]!;
        return station.distanceMm !== expected.distanceMm ||
          !contactNear(station.assemblyPointMm, expected.assemblyPointMm) ||
          !contactNear(station.participantALocalMm, expected.participantALocalMm) ||
          !contactNear(station.participantBLocalMm, expected.participantBLocalMm);
      })) return fail('OPERATION_PLAN_INVALID');
  if (!recipe.recipeId?.trim() || !recipe.recipeRevision?.trim()) return fail('OPERATION_RECIPE_INVALID');
  if (!recipe.technicalProfileId?.trim() || !recipe.technicalProfileRevision?.trim()) {
    return fail('TECHNICAL_PROFILE_REQUIRED');
  }
  if (!Array.isArray(recipe.rules) || !recipe.rules.length || recipe.rules.some((rule) => !rule)) {
    return fail('OPERATION_RULE_INVALID');
  }
  const ruleIds = new Set<string>();
  const roleSet = new Set(recipe.rules.map((rule) => rule.participantRole));
  if (!roleSet.has('A') || !roleSet.has('B')) return fail('OPERATION_PARTICIPANT_RULE_MISSING');
  for (const rule of recipe.rules) {
    if (!rule?.ruleId?.trim() || !rule.ruleRevision?.trim() || !rule.operationRole?.trim() ||
        ruleIds.has(rule.ruleId) || !['A', 'B'].includes(rule.participantRole) ||
        !['top', 'bottom', 'left', 'right', 'front', 'back'].includes(rule.entryFace) ||
        !validVector(rule.offsetMm) || !validVector(rule.axis) ||
        !Number.isFinite(rule.diameterMm) || !Number.isFinite(rule.depthMm) ||
        Math.abs(contactDot(rule.axis, rule.axis) - 1) > 1e-6 || rule.diameterMm <= 0 || rule.depthMm <= 0) {
      return fail('OPERATION_RULE_INVALID');
    }
    ruleIds.add(rule.ruleId);
  }
  const { axisAssembly: along, normalAssembly: normal } = contact.frame;
  const cross = contactCross(along, normal);
  const project = (components: Vec3): Vec3 =>
    contactScale(contactScale(contactScale([0, 0, 0], along, components[0]), normal, components[1]), cross, components[2]);
  const operations: NeutralContactOperation[] = [];
  const rules = [...recipe.rules].sort((x, y) =>
    x.participantRole < y.participantRole ? -1 : x.participantRole > y.participantRole ? 1 :
      compareUnicodeScalarIds(x.ruleId, y.ruleId));
  for (const [stationIndex, station] of stations.entries()) {
    for (const rule of rules) {
      const board = rule.participantRole === 'A' ? a[0]! : b[0]!;
      const centerLocal = contactToLocal(board, contactScale(station.assemblyPointMm, project(rule.offsetMm), 1));
      const directionAssembly = project(rule.axis);
      const axisLocal: Vec3 = [contactDot(directionAssembly, board.basis.x),
        contactDot(directionAssembly, board.basis.y), contactDot(directionAssembly, board.basis.z)];
      const dims = contactSize(board);
      const [faceAxis, high] = contactFaceAxis(rule.entryFace);
      const radius = rule.diameterMm / 2;
      if (!centerLocal.every((value, i) => Number.isFinite(value) && value >= -1e-6 && value <= dims[i]! + 1e-6) ||
          Math.abs(centerLocal[faceAxis]! - (high ? dims[faceAxis]! : 0)) > 1e-6 ||
          // Endpoint checks alone do not bound the swept cylinder of an oblique bore.
          axisLocal.some((component, i) => i !== faceAxis && component !== 0) ||
          (high ? axisLocal[faceAxis]! >= -1e-6 : axisLocal[faceAxis]! <= 1e-6) ||
          dims.some((dimension, i) => i !== faceAxis && (centerLocal[i]! < radius - 1e-6 || centerLocal[i]! > dimension - radius + 1e-6)) ||
          !centerLocal.every((value, i) => value + rule.depthMm * axisLocal[i]! >= -1e-6 &&
            value + rule.depthMm * axisLocal[i]! <= dims[i]! + 1e-6)) return fail('OPERATION_GEOMETRY_INVALID');
      const provenance = { sourceKind: 'relationship' as const, relationshipId: contact.relationshipId, contactId: id,
        participantId: board.occurrenceId, participantRole: rule.participantRole, stationIndex,
        recipeId: recipe.recipeId, recipeRevision: recipe.recipeRevision, ruleId: rule.ruleId,
        ruleRevision: rule.ruleRevision, operationRole: rule.operationRole };
      operations.push({ operationId: contactOperationId(provenance),
        provenance, technicalProfileId: recipe.technicalProfileId, technicalProfileRevision: recipe.technicalProfileRevision,
        entryFace: rule.entryFace, centerLocalMm: contactClean(centerLocal), axisLocal: contactClean(axisLocal),
        diameterMm: rule.diameterMm, depthMm: rule.depthMm });
    }
  }
  if (new Set(operations.map((operation) => operation.operationId)).size !== operations.length) {
    return fail('OPERATION_ID_AMBIGUOUS');
  }
  const geometryKeys = operations.map((operation) => JSON.stringify([
    operation.provenance.participantId, operation.entryFace, operation.centerLocalMm,
    operation.axisLocal, operation.diameterMm, operation.depthMm,
  ]));
  if (new Set(geometryKeys).size !== geometryKeys.length) return fail('OPERATION_GEOMETRY_DUPLICATE');
  return { operations, issues: [] };
}

/** Reconcile exact contact inputs without accepting orphan or partial relationship machining. */
export function deriveResolvedContactOperations(
  resolution: ContactResolutionResult,
  stationPlans: StationPlanResult,
  boards: readonly ContactBoard[],
  specs: readonly StationSpec[],
  recipes: readonly ContactOperationRecipe[],
): ContactOperationResult {
  if (resolution.issues.length || stationPlans.issues.length) {
    return { operations: [], issues: [...resolution.issues, ...stationPlans.issues] };
  }
  const counts = (ids: readonly string[]): Map<string, number> => {
    const result = new Map<string, number>();
    for (const id of ids) result.set(id, (result.get(id) ?? 0) + 1);
    return result;
  };
  const contacts = counts(resolution.contacts.map((contact) => contact.contactId));
  const plans = counts(stationPlans.plans.map((plan) => plan.contactId));
  const policies = counts(specs.map((spec) => spec.contactId));
  const rules = counts(recipes.map((recipe) => recipe.contactId));
  if ([...plans.keys(), ...policies.keys(), ...rules.keys()].some((id) => !contacts.has(id))) {
    return { operations: [], issues: [{ code: 'OPERATION_CONTACT_UNKNOWN', message: 'OPERATION_CONTACT_UNKNOWN', severity: 'error' }] };
  }
  const issues: ContractIssue[] = [];
  const operations: NeutralContactOperation[] = [];
  const invalidRelationships = new Set<string>();
  for (const contact of [...resolution.contacts].sort((a, b) =>
    compareUnicodeScalarIds(a.contactId, b.contactId))) {
    const id = contact.contactId;
    const error = contacts.get(id) !== 1 ? 'OPERATION_CONTACT_AMBIGUOUS' :
      plans.get(id) !== 1 || policies.get(id) !== 1 ? 'OPERATION_PLAN_INVALID' :
        rules.get(id) !== 1 ? rules.has(id) ? 'OPERATION_RECIPE_AMBIGUOUS' : 'OPERATION_RECIPE_REQUIRED' : null;
    if (error) {
      issues.push({ code: error, message: error, severity: 'error', entityId: id });
      invalidRelationships.add(contact.relationshipId);
      continue;
    }
    const result = deriveResolvedContactOperationsForContact(contact,
      stationPlans.plans.find((plan) => plan.contactId === id)!, boards,
      specs.find((spec) => spec.contactId === id)!, recipes.find((recipe) => recipe.contactId === id)!);
    if (result.issues.length) invalidRelationships.add(contact.relationshipId);
    issues.push(...result.issues);
    operations.push(...result.operations);
  }
  const geometryOwners = new Map<string, string>();
  for (const operation of operations) {
    if (invalidRelationships.has(operation.provenance.relationshipId)) continue;
    const key = JSON.stringify([operation.provenance.participantId, operation.entryFace,
      operation.centerLocalMm, operation.axisLocal, operation.diameterMm, operation.depthMm]);
    const previous = geometryOwners.get(key);
    if (previous !== undefined && !invalidRelationships.has(previous)) {
      invalidRelationships.add(previous);
      invalidRelationships.add(operation.provenance.relationshipId);
      issues.push({ code: 'OPERATION_GEOMETRY_DUPLICATE', message: 'OPERATION_GEOMETRY_DUPLICATE', severity: 'error' });
    } else geometryOwners.set(key, operation.provenance.relationshipId);
  }
  const kept = operations.filter((operation) => !invalidRelationships.has(operation.provenance.relationshipId));
  if (new Set(kept.map((operation) => operation.operationId)).size !== kept.length) {
    return { operations: [], issues: [...issues, { code: 'OPERATION_ID_AMBIGUOUS', message: 'OPERATION_ID_AMBIGUOUS', severity: 'error' }] };
  }
  return { operations: kept, issues };
}
