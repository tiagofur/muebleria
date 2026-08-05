/**
 * Procedural wood-grain helpers for 3D board preview.
 * Grain streaks run along the texture V axis so they align with board length
 * (local Z of the box [width, thickness, length]) on the large faces.
 *
 * Contrast is intentionally high so "color" vs "grain" modes are obvious
 * in the workshop viewer (not photoreal).
 */

/** Approximate mm of real board per texture tile (controls stripe density). */
export const GRAIN_TILE_MM = 100;

/**
 * UV repeat so grain density stays similar across piece sizes.
 * U → local width, V → local length (streaks along length).
 */
export function grainUvRepeat(
  widthMm: number,
  lengthMm: number,
  tileMm: number = GRAIN_TILE_MM,
): readonly [number, number] {
  const tile = Math.max(tileMm, 1);
  const u = Math.max(Math.max(widthMm, 1) / tile, 0.35);
  const v = Math.max(Math.max(lengthMm, 1) / tile, 0.35);
  return [u, v];
}

/** Parse #RGB / #RRGGBB to 0–255 channels. Falls back to soft wood. */
export function parseHexColor(
  hex: string,
): readonly [number, number, number] {
  const t = hex.trim();
  const m6 = /^#?([0-9a-fA-F]{6})$/.exec(t);
  if (m6) {
    const n = parseInt(m6[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m3 = /^#?([0-9a-fA-F]{3})$/.exec(t);
  if (m3) {
    const s = m3[1]!;
    return [
      parseInt(s[0]! + s[0]!, 16),
      parseInt(s[1]! + s[1]!, 16),
      parseInt(s[2]! + s[2]!, 16),
    ];
  }
  return [212, 196, 168];
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Draw a high-contrast wood grain tile (browser only).
 * Streaks run vertically (V) = along board length after UV mapping.
 */
export function paintGrainCanvas(
  ctx: CanvasRenderingContext2D,
  size: number,
  baseHex: string,
): void {
  const [br, bg, bb] = parseHexColor(baseHex);
  const s = Math.max(size, 8);

  // Slightly lifted base so dark streaks read clearly.
  ctx.fillStyle = `rgb(${clampByte(br + 8)},${clampByte(bg + 6)},${clampByte(bb + 4)})`;
  ctx.fillRect(0, 0, s, s);

  // Broad soft planks (high opacity for clear mode difference).
  for (let i = 0; i < 14; i++) {
    const x = (i / 14) * s;
    const shade = i % 2 === 0 ? -38 : 22;
    ctx.fillStyle = `rgba(${clampByte(br + shade)},${clampByte(bg + shade * 0.9)},${clampByte(bb + shade * 0.75)},0.55)`;
    ctx.fillRect(x, 0, s / 14 + 2, s);
  }

  // Strong grain streaks along V.
  for (let i = 0; i < 36; i++) {
    const x = ((i * 53) % s) + Math.sin(i * 1.3) * 3;
    const shade = i % 3 === 0 ? -55 : i % 3 === 1 ? 35 : -25;
    const alpha = 0.45 + (i % 4) * 0.08;
    ctx.strokeStyle = `rgba(${clampByte(br + shade)},${clampByte(bg + shade * 0.85)},${clampByte(bb + shade * 0.65)},${alpha})`;
    ctx.lineWidth = 1.2 + (i % 5) * 0.7;
    ctx.beginPath();
    const x0 = x;
    ctx.moveTo(x0, -2);
    for (let y = 0; y <= s + 2; y += 2) {
      const wobble =
        Math.sin(y * 0.05 + i * 0.8) * 5 + Math.sin(y * 0.14 + i) * 2;
      ctx.lineTo(x0 + wobble, y);
    }
    ctx.stroke();
  }

  // Occasional darker pores / knots.
  for (let i = 0; i < 8; i++) {
    const cx = ((i * 97) % s);
    const cy = ((i * 61) % s);
    const r = 2 + (i % 3);
    ctx.fillStyle = `rgba(${clampByte(br - 50)},${clampByte(bg - 45)},${clampByte(bb - 40)},0.35)`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 2.2, r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Create an HTMLCanvasElement with procedural grain. Returns null outside DOM.
 */
export function createGrainCanvas(
  baseHex: string,
  size = 256,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintGrainCanvas(ctx, size, baseHex);
  return canvas;
}
