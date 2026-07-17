/**
 * Pure geometry mapping: PlacedBoardPart → axis-aligned box in workshop mm.
 * No Three.js — used by viewer and unit tests.
 *
 * Workshop frame: X width, Y height, Z depth (0 = front).
 * originMm is the min-corner of the board in furniture space.
 */

import type { BoardFace, PlacedBoardPart, ResolvedAssembly } from '@muebles/domain';

export type BoardBoxMm = {
  readonly partId: string;
  readonly description: string;
  readonly optionRole: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly face: BoardFace;
  /** Box center in workshop mm */
  readonly center: readonly [number, number, number];
  /** Full size along world X,Y,Z in mm */
  readonly size: readonly [number, number, number];
  readonly placement?: string;
};

/**
 * Map a placed board to an AABB box (center + size) in workshop coordinates.
 */
export function placedBoardToBox(part: PlacedBoardPart): BoardBoxMm {
  const L = part.lengthMm;
  const W = part.widthMm;
  const T = Math.max(1, part.thicknessMm);
  const { x, y, z } = part.originMm;

  let size: readonly [number, number, number];
  let center: readonly [number, number, number];

  switch (part.face) {
    case 'xy':
      // Board in front plane; thickness along +Z
      size = [L, W, T];
      center = [x + L / 2, y + W / 2, z + T / 2];
      break;
    case 'xz':
      // Horizontal board; thickness along +Y
      size = [L, T, W];
      center = [x + L / 2, y + T / 2, z + W / 2];
      break;
    case 'yz':
      // Lateral board; thickness along +X
      size = [T, L, W];
      center = [x + T / 2, y + L / 2, z + W / 2];
      break;
    default: {
      const _exhaustive: never = part.face;
      throw new Error(`Unknown board face: ${_exhaustive}`);
    }
  }

  return {
    partId: part.partId,
    description: part.description,
    optionRole: part.optionRole,
    lengthMm: part.lengthMm,
    widthMm: part.widthMm,
    thicknessMm: T,
    face: part.face,
    center,
    size,
    placement: part.placement,
  };
}

export function assemblyToBoxes(
  assembly: ResolvedAssembly,
): readonly BoardBoxMm[] {
  return assembly.boards.map(placedBoardToBox);
}

/** Scale factor: workshop mm → scene units (1 unit = 1 m). */
export const MM_TO_SCENE = 0.001;

export function mmToScene(mm: number): number {
  return mm * MM_TO_SCENE;
}

export function boxToScene(box: BoardBoxMm): {
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
} {
  return {
    position: [
      mmToScene(box.center[0]),
      mmToScene(box.center[1]),
      mmToScene(box.center[2]),
    ],
    scale: [
      mmToScene(box.size[0]),
      mmToScene(box.size[1]),
      mmToScene(box.size[2]),
    ],
  };
}
