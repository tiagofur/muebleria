/**
 * Workshop rules — automatic hardware suggestions based on dimensions (Fase 5 slice 5.1).
 *
 * These rules compute suggested quantities of common hardware based on the
 * physical dimensions of a module (height, width, depth). They are SUGGESTIONS
 * — the user can override in the editor. The rules encode workshop know-how
 * that today lives in the carpenter's head.
 *
 * Pure domain logic — no React, no IO. 100% testable.
 */

/**
 * Suggested hinge count for a door based on its height.
 *
 * Common rule of thumb:
 * - ≤ 800mm: 2 hinges
 * - 801-1400mm: 3 hinges
 * - 1401-2000mm: 4 hinges
 * - > 2000mm: 5 hinges
 */
export function suggestHingeCount(doorHeightMm: number): number {
  if (doorHeightMm <= 0) return 0;
  if (doorHeightMm <= 800) return 2;
  if (doorHeightMm <= 1400) return 3;
  if (doorHeightMm <= 2000) return 4;
  return 5;
}

/**
 * Suggested drawer slide (corredera) length based on drawer depth.
 *
 * The slide should match the drawer depth, rounded to the nearest
 * standard commercial size (250/300/350/400/450/500/550 mm).
 */
export function suggestSlideLength(drawerDepthMm: number): number {
  if (drawerDepthMm <= 0) return 0;
  const STANDARD_SIZES = [250, 300, 350, 400, 450, 500, 550];
  // Find the nearest standard size ≥ drawerDepth (slides can be slightly longer).
  for (const size of STANDARD_SIZES) {
    if (size >= drawerDepthMm) return size;
  }
  return STANDARD_SIZES[STANDARD_SIZES.length - 1]!;
}

/**
 * Suggested number of shelves (repisas) based on cabinet interior height
 * and desired spacing between shelves.
 *
 * @param interiorHeightMm - Available height inside the cabinet (excluding top/bottom panels).
 * @param desiredSpacingMm - Desired gap between shelves (default 300mm).
 * @returns Suggested shelf count (0 if cabinet too short).
 */
export function suggestShelfCount(
  interiorHeightMm: number,
  desiredSpacingMm = 300,
): number {
  if (interiorHeightMm <= 0 || desiredSpacingMm <= 0) return 0;
  // Number of shelves = floor(interiorHeight / spacing) - 1
  // (subtract 1 because the top and bottom panels are not shelves).
  const count = Math.floor(interiorHeightMm / desiredSpacingMm) - 1;
  return Math.max(0, count);
}

/**
 * Suggested number of handles (tiradores) based on door count.
 * One handle per door, or one per pair of adjacent doors if specified.
 */
export function suggestHandleCount(doorCount: number): number {
  return Math.max(0, doorCount);
}

/**
 * Suggested number of legs/levelers (patas/bases) based on cabinet width.
 *
 * Standard rule: 4 legs for cabinets ≤ 800mm wide, +1 leg per 400mm extra.
 */
export function suggestLegCount(cabinetWidthMm: number): number {
  if (cabinetWidthMm <= 0) return 0;
  if (cabinetWidthMm <= 800) return 4;
  const extra = Math.ceil((cabinetWidthMm - 800) / 400);
  return 4 + extra;
}

/**
 * Complete workshop suggestion for a single module based on its dimensions.
 */
export interface WorkshopSuggestion {
  readonly hinges: number;
  readonly slides: number;
  readonly shelves: number;
  readonly handles: number;
  readonly legs: number;
  readonly slideLengthMm: number;
}

/**
 * Compute all workshop suggestions for a module given its external dimensions
 * and configuration hints (number of doors, number of drawers).
 */
export function suggestHardwareForModule(params: {
  readonly heightMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly panelThicknessMm?: number;
  readonly doorCount?: number;
  readonly drawerCount?: number;
  readonly desiredShelfSpacingMm?: number;
}): WorkshopSuggestion {
  const {
    heightMm,
    widthMm,
    depthMm,
    panelThicknessMm = 18,
    doorCount = 1,
    drawerCount = 0,
    desiredShelfSpacingMm = 300,
  } = params;

  const interiorHeight = heightMm - panelThicknessMm * 2;

  return {
    hinges: suggestHingeCount(heightMm) * doorCount,
    slides: drawerCount,
    shelves: suggestShelfCount(interiorHeight, desiredShelfSpacingMm),
    handles: suggestHandleCount(doorCount),
    legs: suggestLegCount(widthMm),
    slideLengthMm: drawerCount > 0 ? suggestSlideLength(depthMm) : 0,
  };
}
