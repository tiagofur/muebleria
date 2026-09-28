import {
  validPieceDimensions,
  type MachiningFace,
  type PieceDimensions3,
  type Point3,
} from './neutralMachiningGeometry';

/** Synthetic dimensions only; this input is not a machine operation or receiver profile. */
export interface NeutralBoreGeometryInput {
  readonly sourceKind: 'synthetic-fixture';
  readonly dimensionsMm: PieceDimensions3;
  readonly entryFace: MachiningFace;
  readonly entryPointMm: Point3;
  readonly axisIntoPiece: Point3;
  readonly diameterMm: number;
  readonly depthMm: number;
  readonly travel: 'blind' | 'through';
}

export type NeutralBoreGeometryReason =
  | 'SYNTHETIC_SOURCE_REQUIRED' | 'INVALID_PIECE_DIMENSIONS'
  | 'INVALID_ENTRY_FACE' | 'ENTRY_POINT_OUTSIDE_PIECE'
  | 'ENTRY_POINT_NOT_ON_FACE' | 'BORE_EXCEEDS_FACE'
  | 'INVALID_OPERATION_GEOMETRY' | 'AXIS_NOT_UNIT'
  | 'AXIS_NOT_INWARD' | 'ANGLED_BORE_UNPROVEN'
  | 'BLIND_TRAVEL_EXITS_PIECE' | 'THROUGH_TRAVEL_SHORT_OF_EXIT';

export interface NeutralBoreGeometryResult {
  readonly kind: 'neutral-bore-geometry';
  readonly nonFabricable: true;
  readonly receiverBlocker: 'NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED';
  readonly geometricallyValid: boolean;
  readonly reasons: readonly NeutralBoreGeometryReason[];
  readonly rayExitMm?: number;
}

const EPSILON = 1e-9;
const FACES: readonly MachiningFace[] = ['top', 'bottom', 'left', 'right', 'front', 'back'];
const AXES = ['x', 'y', 'z'] as const;
const finitePoint = (value: Point3): boolean => value != null
  && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;

const inward: Readonly<Record<MachiningFace, Point3>> = {
  top: { x: 0, y: 0, z: -1 }, bottom: { x: 0, y: 0, z: 1 },
  left: { x: 1, y: 0, z: 0 }, right: { x: -1, y: 0, z: 0 },
  front: { x: 0, y: 1, z: 0 }, back: { x: 0, y: -1, z: 0 },
};

function faceGeometry(face: MachiningFace, dimensions: PieceDimensions3) {
  const limits = { x: dimensions.xMm, y: dimensions.yMm, z: dimensions.zMm };
  const normalAxis: keyof Point3 = face === 'left' || face === 'right' ? 'x'
    : face === 'front' || face === 'back' ? 'y' : 'z';
  const facePosition = face === 'right' || face === 'back' || face === 'top'
    ? limits[normalAxis] : 0;
  const tangents: (keyof Point3)[] = AXES.filter((axis) => axis !== normalAxis);
  return { limits, normalAxis, facePosition, tangents };
}

/** First positive intersection of a ray from the entry point with the piece box. */
function rayBoxExitMm(entry: Point3, axis: Point3, dimensions: PieceDimensions3): number {
  const limits = { x: dimensions.xMm, y: dimensions.yMm, z: dimensions.zMm };
  const distances = AXES.flatMap((coordinate) => {
    const direction = axis[coordinate];
    if (Math.abs(direction) <= EPSILON) return [];
    const boundary = direction > 0 ? limits[coordinate] : 0;
    const distance = (boundary - entry[coordinate]) / direction;
    return distance > EPSILON ? [distance] : [];
  });
  return Math.min(...distances);
}

/** Proves neutral straight-bore geometry only; never setup support or fabricability. */
export function evaluateNeutralBoreGeometry(suppliedInput: NeutralBoreGeometryInput): NeutralBoreGeometryResult {
  // A null/undefined root reports every malformed-field reason instead of throwing.
  const input = suppliedInput ?? ({} as NeutralBoreGeometryInput);
  const reasons: NeutralBoreGeometryReason[] = [];
  const result = (rayExitMm?: number): NeutralBoreGeometryResult => Object.freeze({
    kind: 'neutral-bore-geometry', nonFabricable: true,
    receiverBlocker: 'NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED',
    geometricallyValid: reasons.length === 0, reasons: Object.freeze([...reasons]),
    ...(rayExitMm === undefined ? {} : { rayExitMm }),
  });
  if (input.sourceKind !== 'synthetic-fixture') reasons.push('SYNTHETIC_SOURCE_REQUIRED');
  if (input.dimensionsMm == null || !validPieceDimensions(input.dimensionsMm))
    reasons.push('INVALID_PIECE_DIMENSIONS');
  if (!FACES.includes(input.entryFace)) reasons.push('INVALID_ENTRY_FACE');
  if (!Number.isFinite(input.diameterMm) || input.diameterMm <= 0
      || !Number.isFinite(input.depthMm) || input.depthMm <= 0
      || (input.travel !== 'blind' && input.travel !== 'through'))
    reasons.push('INVALID_OPERATION_GEOMETRY');
  if (reasons.includes('INVALID_PIECE_DIMENSIONS') || reasons.includes('INVALID_ENTRY_FACE'))
    return result();

  const geometry = faceGeometry(input.entryFace, input.dimensionsMm);
  const entry = input.entryPointMm;
  if (!finitePoint(entry) || AXES.some((axis) =>
    entry[axis] < -EPSILON || entry[axis] > geometry.limits[axis] + EPSILON)) {
    reasons.push('ENTRY_POINT_OUTSIDE_PIECE');
  } else {
    if (Math.abs(entry[geometry.normalAxis] - geometry.facePosition) > EPSILON)
      reasons.push('ENTRY_POINT_NOT_ON_FACE');
    if (Number.isFinite(input.diameterMm) && input.diameterMm > 0
        && geometry.tangents.some((axis) => input.diameterMm / 2
          > Math.min(entry[axis], geometry.limits[axis] - entry[axis]) + EPSILON))
      reasons.push('BORE_EXCEEDS_FACE');
  }

  const axis = input.axisIntoPiece;
  if (!finitePoint(axis) || Math.abs(dot(axis, axis) - 1) > EPSILON) {
    reasons.push('AXIS_NOT_UNIT');
  } else {
    const inwardDot = dot(axis, inward[input.entryFace]);
    if (inwardDot <= EPSILON) reasons.push('AXIS_NOT_INWARD');
    else if (inwardDot < 1 - EPSILON) reasons.push('ANGLED_BORE_UNPROVEN');
  }
  if (reasons.length) return result();

  const exitMm = rayBoxExitMm(entry, axis, input.dimensionsMm);
  if (!Number.isFinite(exitMm) || exitMm <= 0) reasons.push('INVALID_OPERATION_GEOMETRY');
  else if (input.travel === 'blind' && input.depthMm >= exitMm - EPSILON)
    reasons.push('BLIND_TRAVEL_EXITS_PIECE');
  else if (input.travel === 'through' && input.depthMm < exitMm - EPSILON)
    reasons.push('THROUGH_TRAVEL_SHORT_OF_EXIT');
  return result(reasons.length ? undefined : exitMm);
}
