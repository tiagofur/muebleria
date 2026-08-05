/**
 * Default 3D pose from component placement when no x/y/z formulas are set.
 * Workshop frame: X = width (PW), Y = depth (PD), Z = height (PH).
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
    case 'base':
      return { ...zero, x: T, y: 0, z: 0 };
    case 'superior':
      return { ...zero, x: T, y: 0, z: Math.max(0, PH - T) };
    case 'lateral_izquierdo':
      // Stand vertical panel: rotX+rotY+rotZ so thickness faces cabinet width (X),
      // length (PH) faces up (Z workshop / Y Three) and width (PD) faces depth (Y workshop / Z Three).
      // [90,180,90] is the validated mapping (see rotationMapping.test.ts); the previous
      // [90,90,0] left the panel lying like a back panel (length on X, thickness on Z). JD-W3.
      return {
        ...zero,
        x: quantity > 1 ? i * Math.max(0, PW - T) : 0,
        rotateX: 90,
        rotateY: 180,
        rotateZ: 90,
      };
    case 'lateral_derecho': {
      // Right-anchored: qty=1 at PW-T; multi-qty spreads from right toward left.
      const span = Math.max(0, PW - T);
      const x =
        quantity > 1 ? span - i * span : span;
      return {
        ...zero,
        x,
        rotateX: 90,
        rotateY: 180,
        rotateZ: 90,
      };
    }
    case 'trasera':
      // rotateX:270 (not 90) so the length grows +Y (up) from the pose instead
      // of -Y (down through the floor). Same axis mapping as 90 (thick→Z, length→Y)
      // but the box corner (0,0,0) local maps above the pose. JD-W3 follow-up.
      return { ...zero, x: T, y: 0, z: T, rotateX: 270 };
    case 'frontal':
      return {
        ...zero,
        x: T,
        y: Math.max(0, PD - T),
        z: T,
        rotateX: 270,
      };
    case 'puerta':
    case 'frente_cajon':
      return { ...zero, x: 2, y: PD, z: 2, rotateX: 270 };
    case 'interno':
      return { ...zero, x: T, y: T, z: 150 + i * 200 };
    case 'custom':
    default:
      return zero;
  }
}
