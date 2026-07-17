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
      // Stand vertical panel: rotX+rotY so thickness faces cabinet width (X).
      return {
        ...zero,
        x: quantity > 1 ? i * Math.max(0, PW - T) : 0,
        rotateX: 90,
        rotateY: 90,
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
        rotateY: 90,
      };
    }
    case 'trasera':
      return { ...zero, x: T, y: 0, z: T, rotateX: 90 };
    case 'frontal':
      return {
        ...zero,
        x: T,
        y: Math.max(0, PD - T),
        z: T,
        rotateX: 90,
      };
    case 'puerta':
    case 'frente_cajon':
      return { ...zero, x: 2, y: PD, z: 2, rotateX: 90 };
    case 'interno':
      return { ...zero, x: T, y: T, z: 150 + i * 200 };
    case 'custom':
    default:
      return zero;
  }
}
