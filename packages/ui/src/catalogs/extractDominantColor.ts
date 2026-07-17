/**
 * Extract a solid preview color from image pixels (catalog materials).
 * Pure histogram path is unit-tested; File/canvas is browser-only.
 */

export type DominantColorOptions = {
  /** Bucket size 8–64 (default 24). Larger = coarser palette. */
  readonly bucketSize?: number;
  /** Sample every Nth pixel (default 4). */
  readonly step?: number;
  /** Min alpha 0–255 to count a pixel (default 200). */
  readonly minAlpha?: number;
};

const DEFAULT_BUCKET = 24;
const DEFAULT_STEP = 4;
const DEFAULT_MIN_ALPHA = 200;

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/**
 * Dominant color from raw RGBA bytes (ImageData.data).
 * Quantizes RGB into buckets and returns the mode as #RRGGBB.
 */
export function extractDominantColorFromRgba(
  data: ArrayLike<number>,
  options: DominantColorOptions = {},
): string | undefined {
  const bucketSize = Math.max(8, Math.min(64, options.bucketSize ?? DEFAULT_BUCKET));
  const step = Math.max(1, options.step ?? DEFAULT_STEP);
  const minAlpha = options.minAlpha ?? DEFAULT_MIN_ALPHA;

  const counts = new Map<string, { n: number; r: number; g: number; b: number }>();
  const pixelCount = Math.floor(data.length / 4);

  for (let i = 0; i < pixelCount; i += step) {
    const o = i * 4;
    const a = data[o + 3] ?? 255;
    if (a < minAlpha) continue;
    const r = data[o] ?? 0;
    const g = data[o + 1] ?? 0;
    const b = data[o + 2] ?? 0;
    const br = Math.floor(r / bucketSize) * bucketSize;
    const bg = Math.floor(g / bucketSize) * bucketSize;
    const bb = Math.floor(b / bucketSize) * bucketSize;
    const key = `${br},${bg},${bb}`;
    const prev = counts.get(key);
    if (prev) {
      prev.n += 1;
      prev.r += r;
      prev.g += g;
      prev.b += b;
    } else {
      counts.set(key, { n: 1, r, g, b });
    }
  }

  if (counts.size === 0) return undefined;

  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  if (!best) return undefined;

  return toHex(best.r / best.n, best.g / best.n, best.b / best.n);
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

/**
 * Downscale image on canvas and extract dominant color.
 * Max edge 64px keeps it fast even for large product photos.
 */
export async function extractDominantColorFromImageFile(
  file: File,
  options: DominantColorOptions = {},
): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined;
  const img = await loadImageFromFile(file);
  const maxEdge = 64;
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return extractDominantColorFromRgba(data, { step: 1, ...options });
}
