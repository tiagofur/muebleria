/**
 * Pure isometric projection helpers for the BoardCanvas (Fase 1 slice 1.1).
 *
 * Workshop frame: X = width (PW), Y = depth (PD), Z = height (PH).
 * Isometric projects the 3D box onto 2D screen coordinates.
 *
 * No React — 100% testable.
 */

/** A 3D point in workshop space (mm). */
export type Point3D = readonly [number, number, number];

/** A 2D point on screen (px). */
export type Point2D = readonly [number, number];

const COS_30 = Math.cos(Math.PI / 6); // ≈ 0.866
const SIN_30 = Math.sin(Math.PI / 6); // = 0.5

/**
 * Project a single 3D workshop point to 2D isometric screen coords.
 * Classic 30° isometric: X goes right-down, Z goes left-down, Y goes up.
 */
export function isoProject(x: number, y: number, z: number): Point2D {
  const isoX = (x - z) * COS_30;
  const isoY = -y + (x + z) * SIN_30;
  return [isoX, isoY];
}

/** The 8 corners of a box in workshop space. */
export interface BoxCorners3D {
  /** Bottom face (y=0): bl, br, bt, bf */
  readonly bottom: readonly [Point3D, Point3D, Point3D, Point3D];
  /** Top face (y=height): same order shifted up */
  readonly top: readonly [Point3D, Point3D, Point3D, Point3D];
}

/**
 * Compute the 8 corners of a box (table) from position + size.
 * Size is [width(X), height(Y), depth(Z)] in mm.
 * Position is the corner origin (min X, min Y, min Z).
 */
export function boxCorners(
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
): BoxCorners3D {
  return {
    bottom: [
      [x, y, z],
      [x + w, y, z],
      [x + w, y, z + d],
      [x, y, z + d],
    ],
    top: [
      [x, y + h, z],
      [x + w, y + h, z],
      [x + w, y + h, z + d],
      [x, y + h, z + d],
    ],
  };
}

/** A visible face of the box as projected 2D polygon points. */
export interface IsoFace {
  readonly points: readonly Point2D[];
  readonly shade: 'light' | 'medium' | 'dark';
}

/**
 * Project the 3 visible faces of a box for isometric rendering.
 * Faces: top (lightest), front-right (medium), front-left (darkest).
 * Returns faces sorted back-to-front for correct painter's algorithm.
 */
export function isoBox(
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
): IsoFace[] {
  const c = boxCorners(x, y, z, w, h, d);

  const p = (pt: Point3D): Point2D => isoProject(pt[0], pt[1], pt[2]);

  // Top face (4 corners, visible from above).
  const top: IsoFace = {
    points: [p(c.top[0]), p(c.top[1]), p(c.top[2]), p(c.top[3])],
    shade: 'light',
  };

  // Front-right face (visible from front-right).
  const right: IsoFace = {
    points: [
      p(c.bottom[1]),
      p(c.bottom[2]),
      p(c.top[2]),
      p(c.top[1]),
    ],
    shade: 'medium',
  };

  // Front-left face (visible from front-left).
  const left: IsoFace = {
    points: [
      p(c.bottom[0]),
      p(c.bottom[1]),
      p(c.top[1]),
      p(c.top[0]),
    ],
    shade: 'dark',
  };

  return [left, right, top];
}

/**
 * Compute a bounding box of all projected points to auto-fit the SVG viewBox.
 * Returns [minX, minY, maxX, maxY] in projected coords.
 */
export function projectedBounds(
  faces: readonly IsoFace[],
): readonly [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const face of faces) {
    for (const [px, py] of face.points) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Convert projected bounds to an SVG viewBox string with padding.
 */
export function viewBoxFromBounds(
  bounds: readonly [number, number, number, number],
  padding = 40,
): string {
  const [minX, minY, maxX, maxY] = bounds;
  const w = maxX - minX + padding * 2;
  const h = maxY - minY + padding * 2;
  return `${minX - padding} ${minY - padding} ${w} ${h}`;
}
