import { evaluateNeutralBoreGeometry, type NeutralBoreGeometryReason } from './neutralBoreGeometry';
import {
  isProperRigidFrame,
  pieceToSetupFrame,
  setupEnvelopeMm,
  transformDirection,
  transformPoint,
  validPieceDimensions,
  type MachiningFace,
  type PieceDimensions3,
  type Point3,
  type RigidFrame,
} from './neutralMachiningGeometry';

/** Synthetic-fixture planning only; neither a receiver profile nor a machine program. */
export interface NeutralMachiningInput {
  readonly source: Readonly<{
    kind: 'synthetic-fixture';
    fixtureId: string;
    sourceRevisionId: string;
    pieceOccurrenceId: string;
  }>;
  readonly resolution: Readonly<
    { status: 'complete' } | { status: 'incomplete'; reasonCodes: readonly string[] }
  >;
  readonly pieceDimensionsMm: PieceDimensions3;
  readonly requiredOperationIds: readonly string[];
  readonly operations: readonly SyntheticDrillOperation[];
  readonly setups: readonly SyntheticMachiningSetup[];
}

export interface SyntheticDrillOperation {
  readonly operationId: string;
  readonly fixtureId: string;
  readonly sourceRevisionId: string;
  readonly pieceOccurrenceId: string;
  readonly kind: 'drill';
  readonly entryFace: MachiningFace;
  readonly entryPointMm: Point3;
  readonly axisIntoPiece: Point3;
  readonly diameterMm: number;
  readonly depthMm: number;
  readonly travel: 'blind' | 'through';
  readonly requiredClearanceMm: number;
  readonly requirementKeys: readonly string[];
  /** Fixture-local symbolic key, never a native or industrial tool ID. */
  readonly toolKey: string;
}

export interface SyntheticMachiningSetup {
  readonly setupId: string;
  readonly presentedFace: MachiningFace;
  readonly accessibleFaces: readonly MachiningFace[];
  readonly setupToCandidate: RigidFrame;
  /** Axis-aligned capacity in the presented setup frame, not piece-local dimensions. */
  readonly maxSetupEnvelopeMm: PieceDimensions3;
  /** Null means explicitly unknown, not zero clearance. */
  readonly clearanceMm: number | null;
  readonly supportedAxesInSetup: readonly Point3[];
  readonly supportedKinds: readonly ('drill')[];
  readonly supportedRequirementKeys: readonly string[];
  readonly supportedToolKeys: readonly string[];
}

export type NeutralMachiningBlocker =
  | 'NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED'
  | 'SYNTHETIC_SOURCE_REQUIRED' | 'UPSTREAM_RESOLUTION_INCOMPLETE'
  | 'NO_REQUIRED_OPERATIONS'
  | 'INVALID_REQUIRED_OPERATION_ID' | 'DUPLICATE_REQUIRED_OPERATION_ID'
  | 'INVALID_OPERATION_ID' | 'DUPLICATE_OPERATION_ID'
  | 'UNEXPECTED_OPERATION_ID' | 'REQUIRED_OPERATION_MISSING'
  | 'OPERATION_SOURCE_MISMATCH' | 'UNSUPPORTED_OPERATION_KIND'
  | NeutralBoreGeometryReason
  | 'INVALID_SETUP_ID' | 'DUPLICATE_SETUP_ID' | 'INVALID_SETUP_FRAME'
  | 'INVALID_SETUP_CAPABILITIES' | 'SETUP_ENVELOPE_EXCEEDED'
  | 'FACE_NOT_ACCESSIBLE' | 'AXIS_NOT_SUPPORTED' | 'KIND_NOT_SUPPORTED'
  | 'TOOL_NOT_SUPPORTED' | 'REQUIREMENT_NOT_SUPPORTED'
  | 'CLEARANCE_NOT_CONFIRMED' | 'CLEARANCE_INSUFFICIENT'
  | 'NO_SUPPORTED_SETUP';

export interface NeutralOperationCoverage {
  /** Stable input position also distinguishes duplicate required identities. */
  readonly requirementIndex: number;
  readonly operationId: string;
  readonly status: 'ASSIGNED_TO_SUPPORTED_SETUP' | 'BLOCKED';
  readonly reasons: readonly NeutralMachiningBlocker[];
  /** Deep-copied, validated fixture operation; present only for an assignment. */
  readonly validatedOperation?: SyntheticDrillOperation;
  readonly setupId?: string;
  readonly pieceToSetup?: RigidFrame;
  readonly setupToCandidate?: RigidFrame;
  readonly candidateEntryPointMm?: Point3;
  readonly candidateAxisIntoPiece?: Point3;
}

export interface NeutralMachiningCandidate {
  readonly kind: 'neutral-offline-candidate';
  readonly nonFabricable: true;
  readonly source: NeutralMachiningInput['source'];
  readonly coverage: readonly NeutralOperationCoverage[];
  readonly blockers: readonly NeutralMachiningBlocker[];
}

const EPSILON = 1e-9;
const FACES: readonly MachiningFace[] = ['top', 'bottom', 'left', 'right', 'front', 'back'];
const validId = (id: string): boolean => typeof id === 'string' && id.trim().length > 0;
const validDimensions = (dimensions: PieceDimensions3): boolean =>
  dimensions != null && validPieceDimensions(dimensions);
const isFace = (face: MachiningFace): boolean => FACES.includes(face);
const finitePoint = (p: Point3): boolean => p != null
  && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const unitPoint = (p: Point3): boolean => finitePoint(p)
  && Math.abs(p.x * p.x + p.y * p.y + p.z * p.z - 1) <= EPSILON;
const samePoint = (a: Point3, b: Point3): boolean => finitePoint(a) && finitePoint(b)
  && Math.abs(a.x - b.x) <= EPSILON
  && Math.abs(a.y - b.y) <= EPSILON
  && Math.abs(a.z - b.z) <= EPSILON;
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
const isSuppliedRigidFrame = (frame: RigidFrame): boolean => frame != null
  && frame.xAxis != null && frame.yAxis != null
  && frame.zAxis != null && frame.origin != null && isProperRigidFrame(frame);

function compareCodepoints(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0)!);
  const b = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

function validatedOperationSnapshot(op: SyntheticDrillOperation): SyntheticDrillOperation {
  return Object.freeze({
    operationId: op.operationId, fixtureId: op.fixtureId,
    sourceRevisionId: op.sourceRevisionId, pieceOccurrenceId: op.pieceOccurrenceId,
    kind: op.kind, entryFace: op.entryFace,
    entryPointMm: Object.freeze({ ...op.entryPointMm }),
    axisIntoPiece: Object.freeze({ ...op.axisIntoPiece }),
    diameterMm: op.diameterMm, depthMm: op.depthMm, travel: op.travel,
    requiredClearanceMm: op.requiredClearanceMm,
    requirementKeys: Object.freeze([...op.requirementKeys]), toolKey: op.toolKey,
  });
}

function snapshotFrame(frame: RigidFrame): RigidFrame {
  return Object.freeze({
    xAxis: Object.freeze({ ...frame.xAxis }),
    yAxis: Object.freeze({ ...frame.yAxis }),
    zAxis: Object.freeze({ ...frame.zAxis }),
    origin: Object.freeze({ ...frame.origin }),
  });
}

function operationReasons(op: SyntheticDrillOperation, input: NeutralMachiningInput): NeutralMachiningBlocker[] {
  const reasons: NeutralMachiningBlocker[] = [];
  if (op.fixtureId !== input.source.fixtureId
      || op.sourceRevisionId !== input.source.sourceRevisionId
      || op.pieceOccurrenceId !== input.source.pieceOccurrenceId) reasons.push('OPERATION_SOURCE_MISMATCH');
  if (op.kind !== 'drill') reasons.push('UNSUPPORTED_OPERATION_KIND');
  if (!Number.isFinite(op.requiredClearanceMm) || op.requiredClearanceMm < 0
      || !validId(op.toolKey) || !Array.isArray(op.requirementKeys)
      || op.requirementKeys.length === 0 || op.requirementKeys.some((key) => !validId(key))) {
    reasons.push('INVALID_OPERATION_GEOMETRY');
  }
  reasons.push(...evaluateNeutralBoreGeometry({
    sourceKind: 'synthetic-fixture', dimensionsMm: input.pieceDimensionsMm,
    entryFace: op.entryFace, entryPointMm: op.entryPointMm,
    axisIntoPiece: op.axisIntoPiece, diameterMm: op.diameterMm,
    depthMm: op.depthMm, travel: op.travel,
  }).reasons);
  return reasons;
}

function setupReasons(op: SyntheticDrillOperation, setup: SyntheticMachiningSetup,
  dimensions: PieceDimensions3): NeutralMachiningBlocker[] {
  const reasons: NeutralMachiningBlocker[] = [];
  if (!isFace(setup.presentedFace) || !Array.isArray(setup.accessibleFaces)
      || !setup.accessibleFaces.every(isFace)
      || !Array.isArray(setup.supportedAxesInSetup)
      || !setup.supportedAxesInSetup.every(unitPoint)
      || !Array.isArray(setup.supportedKinds)
      || !setup.supportedKinds.every((kind) => kind === 'drill')
      || !Array.isArray(setup.supportedRequirementKeys)
      || !setup.supportedRequirementKeys.every(validId)
      || !Array.isArray(setup.supportedToolKeys)
      || !setup.supportedToolKeys.every(validId)
      || !validDimensions(setup.maxSetupEnvelopeMm)) {
    reasons.push('INVALID_SETUP_CAPABILITIES');
  }
  if (!isSuppliedRigidFrame(setup.setupToCandidate))
    reasons.push('INVALID_SETUP_FRAME');
  if (reasons.length) return reasons;
  if (!setup.accessibleFaces.includes(op.entryFace)) reasons.push('FACE_NOT_ACCESSIBLE');
  if (!setup.supportedKinds.includes(op.kind)) reasons.push('KIND_NOT_SUPPORTED');
  const envelope = setupEnvelopeMm(setup.presentedFace, dimensions);
  if (envelope.xMm > setup.maxSetupEnvelopeMm.xMm + EPSILON
      || envelope.yMm > setup.maxSetupEnvelopeMm.yMm + EPSILON
      || envelope.zMm > setup.maxSetupEnvelopeMm.zMm + EPSILON)
    reasons.push('SETUP_ENVELOPE_EXCEEDED');
  const pieceToSetup = pieceToSetupFrame(setup.presentedFace, dimensions);
  if (!isProperRigidFrame(pieceToSetup)) reasons.push('INVALID_SETUP_FRAME');
  else {
    const setupAxis = transformDirection(pieceToSetup, op.axisIntoPiece);
    if (!setup.supportedAxesInSetup.some((axis) => samePoint(axis, setupAxis)))
      reasons.push('AXIS_NOT_SUPPORTED');
  }
  if (!setup.supportedToolKeys.includes(op.toolKey)) reasons.push('TOOL_NOT_SUPPORTED');
  if (!op.requirementKeys.every((key) => setup.supportedRequirementKeys.includes(key)))
    reasons.push('REQUIREMENT_NOT_SUPPORTED');
  if (setup.clearanceMm === null || !Number.isFinite(setup.clearanceMm)
      || setup.clearanceMm < 0) reasons.push('CLEARANCE_NOT_CONFIRMED');
  else if (setup.clearanceMm + EPSILON < op.requiredClearanceMm)
    reasons.push('CLEARANCE_INSUFFICIENT');
  return reasons;
}

/** Complete per-required-entry accounting; successful geometry is never a fabrication claim. */
export function planNeutralMachining(input: NeutralMachiningInput): NeutralMachiningCandidate {
  const integrityReasons: NeutralMachiningBlocker[] = [];
  const source = input.source;
  if (source?.kind !== 'synthetic-fixture' || !validId(source.fixtureId)
      || !validId(source.sourceRevisionId) || !validId(source.pieceOccurrenceId))
    integrityReasons.push('SYNTHETIC_SOURCE_REQUIRED');
  if (input.resolution?.status !== 'complete') integrityReasons.push('UPSTREAM_RESOLUTION_INCOMPLETE');
  if (!validDimensions(input.pieceDimensionsMm)) integrityReasons.push('INVALID_PIECE_DIMENSIONS');
  const required = Array.isArray(input.requiredOperationIds) ? input.requiredOperationIds : [];
  if (!Array.isArray(input.requiredOperationIds))
    integrityReasons.push('INVALID_REQUIRED_OPERATION_ID');
  if (required.length === 0) integrityReasons.push('NO_REQUIRED_OPERATIONS');
  if (required.some((id) => !validId(id))) integrityReasons.push('INVALID_REQUIRED_OPERATION_ID');
  if (new Set(required).size !== required.length) integrityReasons.push('DUPLICATE_REQUIRED_OPERATION_ID');
  const operations = Array.isArray(input.operations) ? input.operations : [];
  if (!Array.isArray(input.operations)) integrityReasons.push('INVALID_OPERATION_ID');
  const ids = operations.map((op) => op?.operationId ?? '');
  if (ids.some((id) => !validId(id))) integrityReasons.push('INVALID_OPERATION_ID');
  if (new Set(ids).size !== ids.length) integrityReasons.push('DUPLICATE_OPERATION_ID');
  if (ids.some((id) => !required.includes(id))) integrityReasons.push('UNEXPECTED_OPERATION_ID');
  const setups = Array.isArray(input.setups) ? input.setups : [];
  if (!Array.isArray(input.setups)) integrityReasons.push('INVALID_SETUP_CAPABILITIES');
  const setupIds = setups.map((setup) => setup?.setupId ?? '');
  if (setupIds.some((id) => !validId(id))) integrityReasons.push('INVALID_SETUP_ID');
  if (new Set(setupIds).size !== setupIds.length) integrityReasons.push('DUPLICATE_SETUP_ID');

  const coverage: NeutralOperationCoverage[] = required.map((operationId, requirementIndex) => {
    const op = operations.find((item) => item?.operationId === operationId);
    const reasons = [...integrityReasons];
    if (!op) reasons.push('REQUIRED_OPERATION_MISSING');
    else if (source && validDimensions(input.pieceDimensionsMm))
      reasons.push(...operationReasons(op, input));
    if (reasons.length || !op) return {
      requirementIndex, operationId, status: 'BLOCKED', reasons: unique(reasons),
    };
    const setupFailures: NeutralMachiningBlocker[] = [];
    const sortedSetups = [...setups].sort((a, b) => compareCodepoints(a.setupId, b.setupId));
    for (const setup of sortedSetups) {
      const failure = setupReasons(op, setup, input.pieceDimensionsMm);
      if (failure.length) { setupFailures.push(...failure); continue; }
      const pieceToSetup = pieceToSetupFrame(setup.presentedFace, input.pieceDimensionsMm);
      const setupToCandidate = snapshotFrame(setup.setupToCandidate);
      return {
        requirementIndex, operationId, status: 'ASSIGNED_TO_SUPPORTED_SETUP', reasons: [],
        validatedOperation: validatedOperationSnapshot(op),
        setupId: setup.setupId, pieceToSetup: snapshotFrame(pieceToSetup), setupToCandidate,
        candidateEntryPointMm: Object.freeze(transformPoint(setupToCandidate,
          transformPoint(pieceToSetup, op.entryPointMm))),
        candidateAxisIntoPiece: Object.freeze(transformDirection(setupToCandidate,
          transformDirection(pieceToSetup, op.axisIntoPiece))),
      };
    }
    return {
      requirementIndex, operationId, status: 'BLOCKED',
      reasons: unique(setupFailures.length ? setupFailures : ['NO_SUPPORTED_SETUP']),
    };
  });
  const frozenCoverage = Object.freeze(coverage.map((record) => Object.freeze({
    ...record,
    reasons: Object.freeze([...record.reasons]),
  })));
  const blockers = Object.freeze(unique<NeutralMachiningBlocker>([
    'NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED',
    ...integrityReasons,
    ...coverage.flatMap((record) => record.reasons),
  ]));
  return Object.freeze({
    kind: 'neutral-offline-candidate', nonFabricable: true,
    source: source == null ? source : Object.freeze({ ...source }),
    coverage: frozenCoverage,
    blockers,
  });
}
