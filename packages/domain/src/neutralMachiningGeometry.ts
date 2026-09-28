/**
 * Pure, symbolic geometry for offline machining candidates. These axes are
 * neither receiver-native coordinates nor evidence of an installed setup.
 */
export type MachiningFace = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';
export type Point3 = Readonly<{ x: number; y: number; z: number }>;
export type PieceDimensions3 = Readonly<{ xMm: number; yMm: number; zMm: number }>;

/** Maps points and directions from one right-handed frame into another. */
export interface RigidFrame {
  readonly xAxis: Point3;
  readonly yAxis: Point3;
  readonly zAxis: Point3;
  /** Translation in millimeters. */
  readonly origin: Point3;
}

const EPSILON = 1e-9;
const point = (x: number, y: number, z: number): Point3 => ({ x, y, z });
const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3, b: Point3): Point3 => point(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x,
);
const finitePoint = (value: Point3): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
const unit = (value: Point3): boolean =>
  finitePoint(value) && Math.abs(dot(value, value) - 1) <= EPSILON;

export function validPieceDimensions(dimensions: PieceDimensions3): boolean {
  return Number.isFinite(dimensions.xMm) && dimensions.xMm > 0
    && Number.isFinite(dimensions.yMm) && dimensions.yMm > 0
    && Number.isFinite(dimensions.zMm) && dimensions.zMm > 0;
}

/** Reflections, scales, shears, and non-finite origins are not rigid setups. */
export function isProperRigidFrame(frame: RigidFrame): boolean {
  const { xAxis: x, yAxis: y, zAxis: z } = frame;
  return finitePoint(frame.origin) && unit(x) && unit(y) && unit(z)
    && Math.abs(dot(x, y)) <= EPSILON
    && Math.abs(dot(x, z)) <= EPSILON
    && Math.abs(dot(y, z)) <= EPSILON
    && Math.abs(dot(cross(x, y), z) - 1) <= EPSILON;
}

export function transformDirection(frame: RigidFrame, direction: Point3): Point3 {
  return point(
    frame.xAxis.x * direction.x + frame.yAxis.x * direction.y + frame.zAxis.x * direction.z,
    frame.xAxis.y * direction.x + frame.yAxis.y * direction.y + frame.zAxis.y * direction.z,
    frame.xAxis.z * direction.x + frame.yAxis.z * direction.y + frame.zAxis.z * direction.z,
  );
}

export function transformPoint(frame: RigidFrame, position: Point3): Point3 {
  const rotated = transformDirection(frame, position);
  return point(rotated.x + frame.origin.x, rotated.y + frame.origin.y, rotated.z + frame.origin.z);
}

export function invertRigidFrame(frame: RigidFrame): RigidFrame {
  if (!isProperRigidFrame(frame)) throw new Error('INVALID_RIGID_FRAME');
  const { xAxis: x, yAxis: y, zAxis: z, origin } = frame;
  return {
    xAxis: point(x.x, y.x, z.x),
    yAxis: point(x.y, y.y, z.y),
    zAxis: point(x.z, y.z, z.z),
    origin: point(-dot(x, origin), -dot(y, origin), -dot(z, origin)),
  };
}

const FACE_ROTATIONS: Readonly<Record<MachiningFace, Pick<RigidFrame, 'xAxis' | 'yAxis' | 'zAxis'>>> = {
  top: {
    xAxis: point(1, 0, 0), yAxis: point(0, 1, 0), zAxis: point(0, 0, 1),
  },
  bottom: {
    xAxis: point(1, 0, 0), yAxis: point(0, -1, 0), zAxis: point(0, 0, -1),
  },
  front: {
    xAxis: point(1, 0, 0), yAxis: point(0, 0, -1), zAxis: point(0, 1, 0),
  },
  back: {
    xAxis: point(1, 0, 0), yAxis: point(0, 0, 1), zAxis: point(0, -1, 0),
  },
  left: {
    xAxis: point(0, 0, -1), yAxis: point(0, 1, 0), zAxis: point(1, 0, 0),
  },
  right: {
    xAxis: point(0, 0, 1), yAxis: point(0, 1, 0), zAxis: point(-1, 0, 0),
  },
};

function corners(dimensions: PieceDimensions3): readonly Point3[] {
  return [0, dimensions.xMm].flatMap((x) =>
    [0, dimensions.yMm].flatMap((y) =>
      [0, dimensions.zMm].map((z) => point(x, y, z))));
}

function rotationFor(face: MachiningFace, dimensions: PieceDimensions3): RigidFrame {
  const rotation = FACE_ROTATIONS[face];
  if (!rotation || !validPieceDimensions(dimensions)) throw new Error('INVALID_PIECE_FRAME');
  return { ...rotation, origin: point(0, 0, 0) };
}

function rotatedBox(face: MachiningFace, dimensions: PieceDimensions3): {
  readonly frame: RigidFrame;
  readonly corners: readonly Point3[];
} {
  const frame = rotationFor(face, dimensions);
  return { frame, corners: corners(dimensions).map((corner) => transformPoint(frame, corner)) };
}

/** Outward face normal becomes +Z; the rotated piece box is shifted positive. */
export function pieceToSetupFrame(face: MachiningFace, dimensions: PieceDimensions3): RigidFrame {
  const { frame, corners: rotated } = rotatedBox(face, dimensions);
  return {
    ...frame,
    origin: point(
      -Math.min(...rotated.map((corner) => corner.x)),
      -Math.min(...rotated.map((corner) => corner.y)),
      -Math.min(...rotated.map((corner) => corner.z)),
    ),
  };
}

/** Setup-frame axis-aligned envelope, not the unrotated piece dimensions. */
export function setupEnvelopeMm(face: MachiningFace, dimensions: PieceDimensions3): PieceDimensions3 {
  const { corners: rotated } = rotatedBox(face, dimensions);
  const extent = (axis: keyof Point3): number =>
    Math.max(...rotated.map((corner) => corner[axis]))
    - Math.min(...rotated.map((corner) => corner[axis]));
  return { xMm: extent('x'), yMm: extent('y'), zMm: extent('z') };
}
