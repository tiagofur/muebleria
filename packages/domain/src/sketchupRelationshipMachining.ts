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

// J1-A0a contact resolution lives beside the #356 relationship owner. Productive
// relationship resolution does not select or invoke this foundation yet.
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

/** Unicode scalar order matches Go's UTF-8 order for valid contact IDs. */
const compareContactIds = (a: string, b: string): number => {
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
  for (const intent of [...input.contacts].sort((a, b) => compareContactIds(a.contactId, b.contactId))) {
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

  for (const contact of [...resolution.contacts].sort((a, b) => compareContactIds(a.contactId, b.contactId))) {
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
  if (!Array.isArray(plan.stations) || plan.stations.some((station) => !station) ||
      !contact.frame?.originAssemblyMm || !contact.frame.axisAssembly || !contact.frame.normalAssembly ||
      !Array.isArray(contact.overlapMm)) return fail('OPERATION_PLAN_INVALID');
  if (boards.some((board) => !board)) return fail('OPERATION_PARTICIPANT_INVALID');
  const id = contact.contactId;
  if (!id?.trim() || !contact.relationshipId?.trim() || !contact.participantA?.trim() ||
      !contact.participantB?.trim() || plan.contactId !== id || spec.contactId !== id || recipe.contactId !== id) {
    return fail('OPERATION_IDENTITY_INVALID');
  }
  const a = boards.filter((board) => board.occurrenceId === contact.participantA);
  const b = boards.filter((board) => board.occurrenceId === contact.participantB);
  if (a.length !== 1 || b.length !== 1 || a[0] === b[0]) return fail('OPERATION_PARTICIPANT_INVALID');
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
  const validVector = (vector: Vec3): boolean =>
    Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite);
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
      x.ruleId < y.ruleId ? -1 : x.ruleId > y.ruleId ? 1 : 0);
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
