/**
 * Default 3D pose from component placement when no x/y/z formulas are set.
 * Workshop frame: X = width (PW), Y = depth (PD), Z = height (PH).
 *
 * Convention: (x,y,z) is the **min corner** of the part AABB in workshop space
 * (left / back / bottom). Rotation may send local growth negative; boardPartToVisual
 * + spatialAnchor offset the mesh so formulas never need right-edge / front-edge
 * compensations (no more y=PD for base, x=PW-2 for door).
 */

export type SpatialPose = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotateX: number;
  readonly rotateY: number;
  readonly rotateZ: number;
};

export type PlacementDims = {
  readonly PW: number;
  readonly PH: number;
  readonly PD: number;
  readonly T: number;
};

/**
 * Heuristic pose for a copy of a component by placement slot.
 * Used only when the component has no explicit spatial formulas.
 */
export function defaultPoseForPlacement(
  placement: string,
  dims: PlacementDims,
  copyIndex: number,
  quantity: number,
): SpatialPose {
  const { PW, PH, PD, T } = dims;
  const i = copyIndex;
  const zero: SpatialPose = {
    x: 0,
    y: 0,
    z: 0,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
  };

  switch (placement) {
    // Horizontal panels (piso / techo): L along PW (grain L→R), W along PD.
    // rotateY 90; min corner at back-left (y=0), not front — anchor handles −Z.
    case 'base':
      return { ...zero, x: T, y: 0, z: 0, rotateY: 90 };
    case 'superior':
      return {
        ...zero,
        x: T,
        y: 0,
        z: Math.max(0, PH - T),
        rotateY: 90,
      };
    case 'lateral_izquierdo':
      // Vertical side: [90,180,90] → thick +X, length +Y, width +Z (min = local origin).
      return {
        ...zero,
        x: quantity > 1 ? i * Math.max(0, PW - T) : 0,
        rotateX: 90,
        rotateY: 180,
        rotateZ: 90,
      };
    case 'lateral_derecho': {
      // Min corner of the right panel sits at x = PW − T.
      const span = Math.max(0, PW - T);
      const x = quantity > 1 ? span - i * span : span;
      return {
        ...zero,
        x,
        rotateX: 90,
        rotateY: 180,
        rotateZ: 90,
      };
    }
    // Depth-facing vertical panels: [90,180,0] → thick +Z, length +Y, width −X.
    // Min-corner X is the LEFT edge (anchor offsets the −X growth).
    case 'trasera':
      return {
        ...zero,
        x: T,
        y: 0,
        z: T,
        rotateX: 90,
        rotateY: 180,
      };
    case 'frontal':
      // Inside front: min depth at PD − T (thickness fills to PD).
      return {
        ...zero,
        x: T,
        y: Math.max(0, PD - T),
        z: T,
        rotateX: 90,
        rotateY: 180,
      };
    case 'puerta':
    case 'frente_cajon':
      // Overlay: min depth at PD (thickness grows outside to PD+T).
      return {
        ...zero,
        x: 2,
        y: PD,
        z: 2,
        rotateX: 90,
        rotateY: 180,
      };
    case 'interno':
      return { ...zero, x: T, y: T, z: 150 + i * 200 };
    case 'custom':
    default:
      return zero;
  }
}
