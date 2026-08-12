/**
 * Hardware placement resolver — pure domain.
 *
 * Resolves a {@link HardwarePlacement} (an mm-based face anchor) into a
 * concrete position + normal in the BOARD-LOCAL frame, given the host board's
 * local size. Mirrors the min-corner / local-box convention of `spatialAnchor`:
 * local X = width (W), Y = thickness (T), Z = length (L), and the board box
 * occupies [0,W] x [0,T] x [0,L].
 *
 * The output is intentionally LOCAL — it carries no global Euler or AABB math.
 * The PR2 renderer drops each placement as a child <group> of an already-posed
 * board mesh, so only face coordinates are needed here.
 */

import { normalizePreviewColor } from './materialPreview';
import type { BoardLocalSize, Vec3 } from './spatialAnchor';
import type { Hardware, HardwarePlacement } from './types';

/**
 * Resolver output (D4). All coordinates are in the BOARD-LOCAL frame so the
 * renderer can attach this directly as a child of the board group.
 */
export interface ResolvedHardwarePlacement {
  /** Component instance the host board belongs to (attaches the child group). */
  readonly componentInstanceId: string;
  /** Hardware being rendered (the mesh reads its own preview* fields). */
  readonly hardwareId: string;
  /** Local position on the anchor face, in mm. */
  readonly localPosition: Vec3;
  /** Unit normal of the anchor face, in the local frame. */
  readonly localNormal: Vec3;
  /** Standoff of the handle from the face (previewProjectionMm, 0 = flush). */
  readonly standoffMm: number;
  /** Per-instance scale (placement.scale, default 1). */
  readonly scale: number;
  /** Per-instance Euler rotation in degrees (defaults 0 on every axis). */
  readonly rotationDeg: { readonly x: number; readonly y: number; readonly z: number };
}

/** Normalized preview descriptor (VH-07). Undefined fields mean "not renderable". */
export interface NormalizedHardwarePreview {
  readonly shape?: 'knob' | 'bar-pull' | 'cup-pull' | 'hinge' | 'slide' | 'rail' | 'leg';
  readonly sizeMm?: number;
  readonly projectionMm?: number;
  readonly diameterMm?: number;
  readonly color?: string;
  readonly metalness?: number;
  readonly roughness?: number;
  readonly clearcoat?: number;
}

const PREVIEW_SHAPES = new Set(['knob', 'bar-pull', 'cup-pull', 'hinge', 'slide', 'rail', 'leg']);

function isPositiveFinite(value: number | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

/** Clamp a PBR scalar into [0,1]; non-finite/missing → undefined. */
function clampPbr(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Clamp millimeters into [0, max] (keep the hardware on the face); non-finite → 0. */
function clampMm(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

/** Snap near-zero noise so -0 / 1e-16 don't leak into poses (mirrors spatialAnchor). */
function snap(n: number): number {
  return Math.abs(n) < 1e-9 ? 0 : n;
}

/**
 * Validate + clamp a Hardware's preview descriptor (VH-07). Non-throwing.
 *
 * - `shape` must be one of the enum values, else it is dropped (cost-only fallback).
 * - `sizeMm`/`projectionMm`/`diameterMm` must be finite and > 0.
 * - PBR scalars are clamped into [0,1]; NaN/±Infinity → undefined.
 * - `color` reuses the MaterialBoard preview-color hex path.
 *
 * A cost-only hardware (no preview fields) normalizes to an empty object.
 */
export function normalizeHardwarePreview(hardware: Hardware): NormalizedHardwarePreview {
  const result: {
    shape?: 'knob' | 'bar-pull' | 'cup-pull' | 'hinge' | 'slide' | 'rail' | 'leg';
    sizeMm?: number;
    projectionMm?: number;
    diameterMm?: number;
    color?: string;
    metalness?: number;
    roughness?: number;
    clearcoat?: number;
  } = {};

  const shape = hardware.previewShape;
  if (shape != null && PREVIEW_SHAPES.has(shape)) {
    result.shape = shape;
  }

  if (isPositiveFinite(hardware.previewSizeMm)) result.sizeMm = hardware.previewSizeMm;
  if (isPositiveFinite(hardware.previewProjectionMm)) {
    result.projectionMm = hardware.previewProjectionMm;
  }
  if (isPositiveFinite(hardware.previewDiameterMm)) result.diameterMm = hardware.previewDiameterMm;

  const color = normalizePreviewColor(hardware.previewColor);
  if (color !== undefined) result.color = color;

  const metalness = clampPbr(hardware.previewMetalness);
  if (metalness !== undefined) result.metalness = metalness;
  const roughness = clampPbr(hardware.previewRoughness);
  if (roughness !== undefined) result.roughness = roughness;
  const clearcoat = clampPbr(hardware.previewClearcoat);
  if (clearcoat !== undefined) result.clearcoat = clearcoat;

  return result;
}

export interface ResolveHardwarePlacementParams {
  readonly componentInstanceId: string;
  readonly placement: HardwarePlacement;
  readonly board: BoardLocalSize;
  readonly hardware: Hardware;
}

/**
 * Resolve a hardware placement to board-LOCAL coordinates.
 *
 * Returns `null` when:
 *  - the hardware has no valid `previewShape` (VH-09 cost-only fallback), or
 *  - a board dimension is non-finite (cannot place on the face), or
 *  - the anchor face is unknown.
 *
 * Negative board dimensions are clamped to 0 (mirrors spatialAnchor). The
 * `relativePosition` millimeter offsets are clamped into the face bounds
 * ([0, faceDim]) so the hardware never leaves the board surface.
 */
export function resolveHardwarePlacement(
  params: ResolveHardwarePlacementParams,
): ResolvedHardwarePlacement | null {
  const { componentInstanceId, placement, board, hardware } = params;

  const normalized = normalizeHardwarePreview(hardware);
  // VH-09: hardware without a valid preview shape renders nothing (cost-only).
  if (normalized.shape === undefined) return null;

  if (
    !Number.isFinite(board.widthMm) ||
    !Number.isFinite(board.thicknessMm) ||
    !Number.isFinite(board.lengthMm)
  ) {
    return null;
  }

  const w = Math.max(board.widthMm, 0);
  const t = Math.max(board.thicknessMm, 0);
  const l = Math.max(board.lengthMm, 0);

  // Millimeter offsets from the face's origin corner along the two in-plane
  // axes (same axis mapping as before), clamped per-face so the hardware never
  // leaves the board surface.
  const { xMm, yMm } = placement.relativePosition;

  let localPosition: Vec3;
  let localNormal: Vec3;
  switch (placement.anchorFace) {
    case 'front':
      // Face plane W x L on the +thickness surface. xMm along width, yMm along length.
      localPosition = [clampMm(xMm, w), t, clampMm(yMm, l)];
      localNormal = [0, 1, 0];
      break;
    case 'back':
      // Face plane W x L on the 0-thickness surface.
      localPosition = [clampMm(xMm, w), 0, clampMm(yMm, l)];
      localNormal = [0, -1, 0];
      break;
    case 'left':
      // Face plane T x L on the 0-width surface. xMm along thickness, yMm along length.
      localPosition = [0, clampMm(xMm, t), clampMm(yMm, l)];
      localNormal = [-1, 0, 0];
      break;
    case 'right':
      // Face plane T x L on the +width surface.
      localPosition = [w, clampMm(xMm, t), clampMm(yMm, l)];
      localNormal = [1, 0, 0];
      break;
    case 'top':
      // Face plane W x T on the +length surface. xMm along width, yMm along thickness.
      localPosition = [clampMm(xMm, w), clampMm(yMm, t), l];
      localNormal = [0, 0, 1];
      break;
    case 'bottom':
      // Face plane W x T on the 0-length surface.
      localPosition = [clampMm(xMm, w), clampMm(yMm, t), 0];
      localNormal = [0, 0, -1];
      break;
    default:
      return null;
  }

  const scale =
    placement.scale != null && Number.isFinite(placement.scale) ? placement.scale : 1;

  return {
    componentInstanceId,
    hardwareId: placement.hardwareId,
    localPosition: [snap(localPosition[0]), snap(localPosition[1]), snap(localPosition[2])],
    localNormal,
    standoffMm: normalized.projectionMm ?? 0,
    scale,
    rotationDeg: {
      x: Number.isFinite(placement.rotationDeg?.x) ? placement.rotationDeg!.x! : 0,
      y: Number.isFinite(placement.rotationDeg?.y) ? placement.rotationDeg!.y! : 0,
      z: Number.isFinite(placement.rotationDeg?.z) ? placement.rotationDeg!.z! : 0,
    },
  };
}
