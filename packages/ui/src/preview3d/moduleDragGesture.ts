/**
 * Pointer gesture for Proyectar: click selects; only past a movement
 * threshold counts as drag (move along wall / free floor).
 */

/** Pixels of pointer travel before a press becomes a drag. */
export const MODULE_DRAG_THRESHOLD_PX = 6;

export function isPastDragThreshold(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
  thresholdPx: number = MODULE_DRAG_THRESHOLD_PX,
): boolean {
  const dx = clientX - startX;
  const dy = clientY - startY;
  return dx * dx + dy * dy >= thresholdPx * thresholdPx;
}
