/**
 * Snapping helpers for the BoardCanvas (Fase 1 slice 1.4).
 *
 * Pure functions — no React, 100% testable.
 */

/**
 * Snap a value to the nearest grid increment.
 */
export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap a 3D position (x, y, z) to the grid.
 * Each axis snaps independently.
 */
export function snapPositionToGrid(
  x: number,
  y: number,
  z: number,
  gridSize: number,
): readonly [number, number, number] {
  return [snapToGrid(x, gridSize), snapToGrid(y, gridSize), snapToGrid(z, gridSize)];
}

/**
 * Find the nearest peer position within a threshold.
 * Returns the snapped position if within range, otherwise the original.
 */
export function snapToPeer(
  value: number,
  peerValues: readonly number[],
  threshold: number,
): number {
  if (peerValues.length === 0) return value;
  let best = value;
  let bestDist = threshold;
  for (const peer of peerValues) {
    const dist = Math.abs(value - peer);
    if (dist <= bestDist) {
      best = peer;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Snap a position to both grid and peers.
 * Grid snapping runs first, then peer snapping within the threshold.
 */
export function snapPosition(
  x: number,
  y: number,
  z: number,
  options: {
    readonly gridSize: number;
    readonly gridEnabled: boolean;
    readonly peerXs?: readonly number[];
    readonly peerYs?: readonly number[];
    readonly peerZs?: readonly number[];
    readonly peerEnabled?: boolean;
    readonly peerThreshold?: number;
  },
): readonly [number, number, number] {
  const {
    gridSize,
    gridEnabled,
    peerXs = [],
    peerYs = [],
    peerZs = [],
    peerEnabled = false,
    peerThreshold = 10,
  } = options;

  let sx = x;
  let sy = y;
  let sz = z;

  if (gridEnabled) {
    sx = snapToGrid(sx, gridSize);
    sy = snapToGrid(sy, gridSize);
    sz = snapToGrid(sz, gridSize);
  }

  if (peerEnabled) {
    sx = snapToPeer(sx, peerXs, peerThreshold);
    sy = snapToPeer(sy, peerYs, peerThreshold);
    sz = snapToPeer(sz, peerZs, peerThreshold);
  }

  return [sx, sy, sz];
}

/**
 * Convert screen pixel delta (dx, dy) to workshop delta (x, y, z)
 * using the inverse isometric projection.
 *
 * In isometric: screen_x = (ws_x - ws_z) * cos30
 *               screen_y = -ws_y + (ws_x + ws_z) * sin30
 *
 * To go back, we need to decompose screen delta into ws_x and ws_z.
 * With y (depth) assumed constant during drag:
 *   dx = (Δx - Δz) * cos30
 *   dy = (Δx + Δz) * sin30  (ignoring Δy which is 0 for planar drag)
 *
 * Solving:
 *   Δx = dx / (2*cos30) + dy / (2*sin30)
 *   Δz = -dx / (2*cos30) + dy / (2*sin30)
 */
export function screenDeltaToWorkshop(
  dxPx: number,
  dyPx: number,
  scale: number,
): readonly [number, number, number] {
  // Convert pixel delta to projected delta (undo scale).
  const dx = dxPx / scale;
  const dy = dyPx / scale;

  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);

  const wsX = (dx / (2 * cos30) + dy / (2 * sin30));
  const wsZ = (-dx / (2 * cos30) + dy / (2 * sin30));

  return [wsX, 0, wsZ];
}
