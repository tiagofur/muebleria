/**
 * Ambient (floor/wall) UV repeat + contact-shadow tuning — PURE TS.
 *
 * No three.js import; unit-testable. Mirrors the scene plane geometry in
 * FurnitureScene3D.tsx (floor `planeGeometry args=[totalWidth*1.4,
 * totalDepth*1.6]`, wall `boxGeometry args=[length, 2400, thickness]`).
 * Spec #4149, design #4151 (R5/R7).
 */

/** Tile fallback (mm) — mirrors DEFAULT_TEXTURE_TILE_MM in boardPartVisual.ts. */
const AMBIENT_TILE_FALLBACK_MM = 280;

/** Min UV repeat clamp — mirrors the board textureUvRepeat floor. */
const MIN_UV_REPEAT = 0.25;

function effectiveTile(tile: number | undefined): number {
  return !tile || tile <= 0 ? AMBIENT_TILE_FALLBACK_MM : tile;
}

/**
 * Relative luminance of a `#RRGGBB` / `#RGB` color, normalized 0..1 using the
 * Rec.709 weights (0.2126 R + 0.7152 G + 0.0722 B). null/undefined/unparseable
 * → null.
 */
export function relativeLuminance(color?: string): number | null {
  if (!color) return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const digits = m[1];
  if (!digits) return null;
  let r: number;
  let g: number;
  let b: number;
  if (digits.length === 3) {
    // Shorthand #RGB → #RRGGBB (each digit doubled: digit*16 + digit = digit*17).
    r = parseInt(digits[0]!, 16) * 17;
    g = parseInt(digits[1]!, 16) * 17;
    b = parseInt(digits[2]!, 16) * 17;
  } else {
    r = parseInt(digits.slice(0, 2), 16);
    g = parseInt(digits.slice(2, 4), 16);
    b = parseInt(digits.slice(4, 6), 16);
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Floor-plane UV repeat derived from plane extent (raw totalWidth/totalDepth)
 * + tile mm. The *1.4/*1.6 multipliers live INSIDE this fn (they mirror
 * FurnitureScene3D's `planeGeometry args=[totalWidth*1.4, totalDepth*1.6]`) so
 * a world-space tile equals the real mm. Min clamp 0.25; tile 0/undefined →
 * 280mm fallback.
 */
export function floorPlaneUvRepeat(
  planeWidthMm: number,
  planeDepthMm: number,
  tileWidthMm?: number,
  tileLengthMm?: number,
): [number, number] {
  const tw = effectiveTile(tileWidthMm);
  const tl = effectiveTile(tileLengthMm);
  const u = Math.max((planeWidthMm * 1.4) / tw, MIN_UV_REPEAT);
  const v = Math.max((planeDepthMm * 1.6) / tl, MIN_UV_REPEAT);
  return [u, v];
}

/**
 * Wall box-face UV repeat from wall length/height + tile mm. UV is shared
 * across the box faces (side faces ~40mm distortion acceptable, R5). Same clamp
 * + fallback rules as the floor.
 */
export function wallBoxUvRepeat(
  wallLengthMm: number,
  wallHeightMm: number,
  tileWidthMm?: number,
  tileLengthMm?: number,
): [number, number] {
  const tw = effectiveTile(tileWidthMm);
  const tl = effectiveTile(tileLengthMm);
  const u = Math.max(wallLengthMm / tw, MIN_UV_REPEAT);
  const v = Math.max(wallHeightMm / tl, MIN_UV_REPEAT);
  return [u, v];
}

/**
 * ContactShadow opacity + color band from a floor preview color's luminance
 * (R7). Light floors need a softer, tinted shadow; dark floors a stronger one.
 * Undefined/unparseable floor → mid band (today's default = backward compat).
 */
export function contactShadowForFloor(
  floorColor?: string,
): { opacity: number; color: string } {
  const lum = relativeLuminance(floorColor);
  if (lum === null) {
    return { opacity: 0.32, color: '#000000' };
  }
  if (lum <= 0.25) {
    return { opacity: 0.38, color: '#000000' };
  }
  if (lum > 0.6) {
    return { opacity: 0.22, color: '#1a1a22' };
  }
  return { opacity: 0.32, color: '#000000' };
}
