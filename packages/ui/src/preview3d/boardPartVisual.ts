/**
 * Pure helpers for mapping ResolvedBoardPart → visual props (no Three.js).
 * Workshop frame: X = width (PW), Y = depth (PD), Z = height (PH).
 */

import type { MaterialBoard, ResolvedBoardPart } from '@muebles/domain';
import {
  DEFAULT_MATERIAL_PREVIEW_COLOR,
  groupPositionFromMinCorner,
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
  /**
   * Grain flag from resolved BOM (material.grainDefault). When 1 and colorMode
   * is material, the mesh applies procedural veta (or a photo texture if set).
   */
  readonly grain: 0 | 1;
  /**
   * Optional catalog texture URL (material.previewTextureUrl). Only set in
   * material color mode. Relative media paths are fine (same-origin).
   */
  readonly textureUrl?: string;
  /** Physical mm of one texture image on part width (U). Default applied in mesh. */
  readonly textureTileWidthMm?: number;
  /** Physical mm of one texture image on part length / veta (V). */
  readonly textureTileLengthMm?: number;
  /**
   * Optional per-material PBR override (semantic [0,1]) for material color mode.
   * Undefined in role mode or when the material has no PBR entry.
   */
  readonly previewRoughness?: number;
  readonly previewMetalness?: number;
  readonly previewClearcoat?: number;
};

/** How to pick mesh colors in the 3D viewer. */
export type BoardColorMode = 'material' | 'role';

/**
 * How to render material surfaces when colorMode is `material`.
 * - color: solid previewColor only
 * - grain: solid + procedural veta (when part.grain === 1)
 * - texture: catalog photo map when available; else grain; else color
 */
export type MaterialSurfaceMode = 'color' | 'grain' | 'texture';

export const DEFAULT_MATERIAL_SURFACE_MODE: MaterialSurfaceMode = 'grain';

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

/** Default physical tile when material has no tile size set (~sample patch). */
export const DEFAULT_TEXTURE_TILE_MM = 280;

/** One material's 3D texture binding (URL + physical tile size). */
export type MaterialTextureEntry = {
  readonly url: string;
  readonly tileWidthMm: number;
  readonly tileLengthMm: number;
};

/** materialId → optional texture entry for 3D maps. */
export type MaterialTextureLookup = Readonly<
  Record<string, MaterialTextureEntry | undefined>
>;

function positiveTileMm(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

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

/**
 * Build materialId → texture entry for 3D maps.
 * Prefers previewTextureUrl, then catalog imageUrl (foto del material).
 * Optional resolveUrl appends auth tokens / absolute origin for TextureLoader.
 * Tile sizes come from material; 0/omit → DEFAULT_TEXTURE_TILE_MM.
 */
export function materialTextureMap(
  materials: readonly Pick<
    MaterialBoard,
    | 'id'
    | 'previewTextureUrl'
    | 'imageUrl'
    | 'previewTextureTileWidthMm'
    | 'previewTextureTileLengthMm'
  >[],
  resolveUrl?: (url: string | undefined) => string | undefined,
): MaterialTextureLookup {
  const map: Record<string, MaterialTextureEntry | undefined> = {};
  for (const m of materials) {
    const raw = m.previewTextureUrl?.trim() || m.imageUrl?.trim();
    if (!raw) continue;
    const resolved = resolveUrl ? resolveUrl(raw) : raw;
    if (!resolved?.trim()) continue;
    map[m.id] = {
      url: resolved.trim(),
      tileWidthMm: positiveTileMm(
        m.previewTextureTileWidthMm,
        DEFAULT_TEXTURE_TILE_MM,
      ),
      tileLengthMm: positiveTileMm(
        m.previewTextureTileLengthMm,
        DEFAULT_TEXTURE_TILE_MM,
      ),
    };
  }
  return map;
}

/** Per-material PBR override entry (semantic [0,1]); undefined ⇒ mode default. */
export type MaterialPhysicalEntry = {
  readonly roughness?: number;
  readonly metalness?: number;
  readonly clearcoat?: number;
};

/** materialId → optional PBR override entry for the 3D preview. */
export type MaterialPhysicalLookup = ReadonlyMap<
  string,
  MaterialPhysicalEntry
>;

function finitePbrField(v: number | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Build materialId → PBR override entry from catalog materials. Only finite
 * numbers pass through (clamping is the resolver's job); a material with no
 * finite PBR field is omitted entirely. Mirrors the materialColorMap /
 * materialTextureMap builders.
 */
export function materialPhysicalMap(
  materials: readonly Pick<
    MaterialBoard,
    'id' | 'previewRoughness' | 'previewMetalness' | 'previewClearcoat'
  >[],
): MaterialPhysicalLookup {
  const map = new Map<string, MaterialPhysicalEntry>();
  for (const m of materials) {
    const roughness = finitePbrField(m.previewRoughness);
    const metalness = finitePbrField(m.previewMetalness);
    const clearcoat = finitePbrField(m.previewClearcoat);
    if (
      roughness === undefined &&
      metalness === undefined &&
      clearcoat === undefined
    ) {
      continue;
    }
    map.set(m.id, { roughness, metalness, clearcoat });
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
  readonly materialTextures?: MaterialTextureLookup;
  readonly materialPhysical?: MaterialPhysicalLookup;
  /** Surface look when painting by material. Ignored in role mode. */
  readonly surfaceMode?: MaterialSurfaceMode;
};

/**
 * Resolve grain + texture flags for a part under the chosen surface mode.
 * Pure — used by boardPartToVisual and tests.
 *
 * Grain mode only draws procedural marks when the part inherits veta from the
 * material (part.grain === 1). Materials without veta stay solid color.
 * Texture mode uses the catalog photo when present; otherwise falls back to
 * grain (if any) or solid color.
 */
export type MaterialSurfaceResolve = {
  readonly grain: 0 | 1;
  readonly textureUrl?: string;
  readonly textureTileWidthMm?: number;
  readonly textureTileLengthMm?: number;
};

export function resolveMaterialSurface(
  part: Pick<ResolvedBoardPart, 'grain' | 'materialId'>,
  surfaceMode: MaterialSurfaceMode,
  materialTextures?: MaterialTextureLookup,
): MaterialSurfaceResolve {
  const entry = materialTextures?.[part.materialId];
  const hasGrain: 0 | 1 = part.grain === 1 ? 1 : 0;

  switch (surfaceMode) {
    case 'color':
      return { grain: 0 };
    case 'grain':
      return { grain: hasGrain };
    case 'texture':
      if (entry?.url) {
        return {
          grain: 0,
          textureUrl: entry.url,
          textureTileWidthMm: entry.tileWidthMm,
          textureTileLengthMm: entry.tileLengthMm,
        };
      }
      // No photo → same as grain mode (veta only if material has it).
      return { grain: hasGrain };
    default:
      return { grain: hasGrain };
  }
}

/**
 * Map a resolved board part to mesh visual props.
 *
 * (x,y,z) on the part is the workshop **min corner** of the AABB
 * (left / back / bottom). Local box still grows +X/+Y/+Z from its local
 * origin after rotation; groupPositionFromMinCorner offsets the group so
 * that min corner lands on (x,y,z) regardless of Euler growth signs.
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
  const rot = {
    rotateX: part.rotateX ?? 0,
    rotateY: part.rotateY ?? 0,
    rotateZ: part.rotateZ ?? 0,
  };
  const colorMode = options.colorMode ?? 'material';
  const useMaterialLook = colorMode === 'material';
  const surfaceMode =
    options.surfaceMode ?? DEFAULT_MATERIAL_SURFACE_MODE;
  const surface = useMaterialLook
    ? resolveMaterialSurface(part, surfaceMode, options.materialTextures)
    : { grain: 0 as const };
  // PBR override only applies in material mode when the lookup has an entry.
  const phys =
    useMaterialLook && options.materialPhysical
      ? options.materialPhysical.get(part.materialId)
      : undefined;

  return {
    id: part.id,
    description: part.description,
    optionRole: part.optionRole,
    materialId: part.materialId,
    size: [w, t, l],
    // Min-corner anchor → render group position (Three Y-up).
    position: groupPositionFromMinCorner(
      { x, y, z },
      { widthMm: w, thicknessMm: t, lengthMm: l },
      rot,
    ),
    rotation: [
      degToRad(rot.rotateX),
      degToRad(rot.rotateY),
      degToRad(rot.rotateZ),
    ],
    color: resolvePartColor(part, colorMode, options.materialColors),
    grain: surface.grain,
    textureUrl: surface.textureUrl,
    textureTileWidthMm: surface.textureTileWidthMm,
    textureTileLengthMm: surface.textureTileLengthMm,
    previewRoughness: phys?.roughness,
    previewMetalness: phys?.metalness,
    previewClearcoat: phys?.clearcoat,
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

export type SceneCameraViewType = 'front' | 'top' | 'side' | 'isometric';

/**
 * Absolute camera position for preset views (mm). Used by both the default
 * Canvas camera and CameraViewSetter so open ≈ button 3/4.
 */
export function cameraPositionForView(
  type: SceneCameraViewType,
  center: readonly [number, number, number],
  maxDim: number,
): readonly [number, number, number] {
  const dist = Math.max(maxDim, 1) * 1.85;
  const d = Math.max(maxDim, 1);
  if (type === 'top') {
    return [center[0], center[1] + dist, center[2]];
  }
  if (type === 'front') {
    return [center[0], center[1], center[2] + dist];
  }
  if (type === 'side') {
    return [center[0] + dist, center[1], center[2]];
  }
  // isometric 3/4 — elevated so the room is seen from above-front, not underfloor
  return [
    center[0] + d * 0.55,
    center[1] + d * 0.9,
    center[2] + d * 1.8,
  ];
}
