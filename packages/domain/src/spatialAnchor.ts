/**
 * Spatial anchor: (x,y,z) means the workshop MIN corner of the part AABB
 * (left / back / bottom), not the local box corner (0,0,0).
 *
 * Local box is [width, thickness, length] growing +local. After Euler XYZ
 * rotation (same as R3F/Three), some local axes point negative in the render
 * frame — so local (0,0,0) is no longer the min corner. Placement used to
 * compensate by hand (y=PD for base, x=PW-2 for door). This module computes
 * the offset so formulas can always use the furniture frame's natural corner.
 *
 * Workshop frame: X = width, Y = depth, Z = height.
 * Render frame (Three Y-up): X = workshop X, Y = workshop Z, Z = workshop Y.
 * Domain rotateX/Y/Z are applied as Euler 'XYZ' in the render frame (see
 * boardPartToVisual) — same as R3F <group rotation={[rx,ry,rz]}>.
 */

export type Vec3 = readonly [number, number, number];

export type SpatialRotation = {
  readonly rotateX?: number | null;
  readonly rotateY?: number | null;
  readonly rotateZ?: number | null;
};

export type BoardLocalSize = {
  /** Local X — board width (W) mm */
  readonly widthMm: number;
  /** Local Y — board thickness (T) mm */
  readonly thicknessMm: number;
  /** Local Z — board length (L) mm */
  readonly lengthMm: number;
};

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Multiply 3×3 row-major matrix by column vector. */
function mulMatVec(m: readonly number[], v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

/** Row-major 3×3 multiply: C = A * B. */
function mulMat(a: readonly number[], b: readonly number[]): number[] {
  const c = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      c[r * 3 + col] =
        a[r * 3]! * b[col]! +
        a[r * 3 + 1]! * b[3 + col]! +
        a[r * 3 + 2]! * b[6 + col]!;
    }
  }
  return c;
}

/**
 * Euler XYZ rotation matrix matching Three.js / R3F default order.
 *
 * Three.js `makeRotationFromEuler(…, 'XYZ')` composes as **Rx * Ry * Rz**
 * (verified against three@Matrix4 — not the Wikipedia Rz*Ry*Rx expansion).
 */
export function eulerXyzMatrix(
  rotateXDeg: number,
  rotateYDeg: number,
  rotateZDeg: number,
): number[] {
  const x = degToRad(rotateXDeg);
  const y = degToRad(rotateYDeg);
  const z = degToRad(rotateZDeg);
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);

  // Elementary rotations (row-major, right-handed, active).
  const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mulMat(rx, mulMat(ry, rz));
}

/**
 * When the group sits at render-frame origin with the given Euler, the local
 * box occupies an AABB. Returns the render-frame coordinates of that AABB's
 * min corner (min X, min Y, min Z).
 *
 * boardPartToVisual places the group at:
 *   workshopToThree(x,y,z) − this offset
 * so that (x,y,z) is the workshop min corner of the part.
 */
export function localBoxMinCornerRenderOffset(
  size: BoardLocalSize,
  rotation: SpatialRotation = {},
): Vec3 {
  const w = Math.max(size.widthMm, 0);
  const t = Math.max(size.thicknessMm, 0);
  const l = Math.max(size.lengthMm, 0);
  const m = eulerXyzMatrix(
    rotation.rotateX ?? 0,
    rotation.rotateY ?? 0,
    rotation.rotateZ ?? 0,
  );

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  for (const aw of [0, w]) {
    for (const at of [0, t]) {
      for (const al of [0, l]) {
        const p = mulMatVec(m, [aw, at, al]);
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[2] < minZ) minZ = p[2];
      }
    }
  }
  // Snap near-zero noise so -0 / 1e-16 don't leak into poses.
  const snap = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n);
  return [snap(minX), snap(minY), snap(minZ)];
}

/**
 * Workshop coordinates of the local origin (0,0,0) such that the part's
 * AABB min corner sits at `minCorner` after rotation.
 *
 * Inverse of the visual mapping: if you only know the min corner you want,
 * this is where to put the raw local-origin pose (legacy mental model).
 */
export function localOriginWorkshopFromMinCorner(
  minCorner: { readonly x: number; readonly y: number; readonly z: number },
  size: BoardLocalSize,
  rotation: SpatialRotation = {},
): { x: number; y: number; z: number } {
  // render offset of min corner when local origin at 0
  const [ox, oy, oz] = localBoxMinCornerRenderOffset(size, rotation);
  // render(group) = workshopToThree(min) - offset
  // group_three = (min.x - ox, min.z - oy, min.y - oz)
  // workshop from group three: x=g.x, y=g.z, z=g.y
  // So localOrigin workshop = (min.x - ox, min.y - oz, min.z - oy)
  return {
    x: minCorner.x - ox,
    y: minCorner.y - oz,
    z: minCorner.z - oy,
  };
}

/**
 * Render-frame group position for a part whose (x,y,z) is the workshop
 * min corner (left/back/bottom of the AABB).
 */
export function groupPositionFromMinCorner(
  minCorner: { readonly x: number; readonly y: number; readonly z: number },
  size: BoardLocalSize,
  rotation: SpatialRotation = {},
): Vec3 {
  const [ox, oy, oz] = localBoxMinCornerRenderOffset(size, rotation);
  // workshop (x,y,z) → three (x, z, y)
  return [minCorner.x - ox, minCorner.z - oy, minCorner.y - oz];
}
