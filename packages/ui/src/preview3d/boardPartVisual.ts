/**
 * Pure helpers for mapping ResolvedBoardPart → visual props (no Three.js).
 * Workshop frame: X = width (PW), Y = depth (PD), Z = height (PH).
 */

import type { MaterialBoard, ResolvedBoardPart } from '@muebles/domain';
import {
  DEFAULT_MATERIAL_PREVIEW_COLOR,
  normalizePreviewColor,
} from '@muebles/domain';

export type BoardPartVisual = {
  readonly id: string;
  readonly description: string;
  readonly optionRole: string;
  readonly materialId: string;
  /** Local box size before rotation: [width, thickness, length] mm */
  readonly size: readonly [number, number, number];
  /**
   * Group position in Three (Y-up): [x, z, y] workshop → scene.
   * Rotation in radians [rx, ry, rz] matching domain degrees on workshop axes.
   */
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly color: string;
};

/** How to pick mesh colors in the 3D viewer. */
export type BoardColorMode = 'material' | 'role';

const ROLE_COLORS: Record<string, string> = {
  FRENTE: '#c4a574',
  PUERTA: '#c4a574',
  FONDO: '#8b7355',
  TRASERA: '#8b7355',
  INTERIOR: '#d4c4a8',
  EDGE: '#a09070',
};

/** Soft workshop palette by option role (client-readable, not photoreal). */
export function colorForOptionRole(role: string): string {
  const r = role.toUpperCase();
  for (const [key, color] of Object.entries(ROLE_COLORS)) {
    if (r.includes(key)) return color;
  }
  return '#c8b89a';
}

export type MaterialColorLookup = Readonly<Record<string, string | undefined>>;

/** Build materialId → normalized #RRGGBB from catalog materials. */
export function materialColorMap(
  materials: readonly Pick<MaterialBoard, 'id' | 'previewColor'>[],
): MaterialColorLookup {
  const map: Record<string, string | undefined> = {};
  for (const m of materials) {
    map[m.id] = normalizePreviewColor(m.previewColor);
  }
  return map;
}

export function colorForMaterialId(
  materialId: string,
  colors: MaterialColorLookup | undefined,
): string {
  const fromMap = colors?.[materialId];
  const normalized = normalizePreviewColor(fromMap);
  return normalized ?? DEFAULT_MATERIAL_PREVIEW_COLOR;
}

export function resolvePartColor(
  part: ResolvedBoardPart,
  mode: BoardColorMode,
  materialColors?: MaterialColorLookup,
): string {
  if (mode === 'role') {
    return colorForOptionRole(part.optionRole);
  }
  return colorForMaterialId(part.materialId, materialColors);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export type BoardPartToVisualOptions = {
  readonly colorMode?: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
};

/**
 * Map a resolved board part to mesh visual props.
 * Local box sits in +X/+Y/+Z from the part origin after rotation (corner placement).
 */
export function boardPartToVisual(
  part: ResolvedBoardPart,
  options: BoardPartToVisualOptions = {},
): BoardPartVisual {
  const w = Math.max(part.widthMm, 1);
  const t = Math.max(part.thicknessMm, 1);
  const l = Math.max(part.lengthMm, 1);
  const x = part.x ?? 0;
  const y = part.y ?? 0;
  const z = part.z ?? 0;
  const colorMode = options.colorMode ?? 'material';

  return {
    id: part.id,
    description: part.description,
    optionRole: part.optionRole,
    materialId: part.materialId,
    size: [w, t, l],
    // Three Y-up: workshop X→x, Z(height)→y, Y(depth)→z
    position: [x, z, y],
    rotation: [
      degToRad(part.rotateX ?? 0),
      degToRad(part.rotateY ?? 0),
      degToRad(part.rotateZ ?? 0),
    ],
    color: resolvePartColor(part, colorMode, options.materialColors),
  };
}

export function boardPartsToVisuals(
  parts: readonly ResolvedBoardPart[],
  options: BoardPartToVisualOptions = {},
): BoardPartVisual[] {
  return parts.map((p) => boardPartToVisual(p, options));
}

/** Scene center and fit distance from outer module dims (mm). */
export function sceneFraming(
  width: number,
  height: number,
  depth: number,
): {
  readonly center: readonly [number, number, number];
  readonly maxDim: number;
  readonly cameraDistance: number;
} {
  const W = Math.max(width, 1);
  const H = Math.max(height, 1);
  const D = Math.max(depth, 1);
  const maxDim = Math.max(W, H, D);
  return {
    center: [W / 2, H / 2, D / 2],
    maxDim,
    cameraDistance: maxDim * 1.85,
  };
}
