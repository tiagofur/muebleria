/**
 * Suggest physical texture tile size (mm) from an image, as a starting point
 * the carpenter can refine in the material form.
 */

/** Default sample width when the board size is unknown. */
export const DEFAULT_SUGGEST_TILE_WIDTH_MM = 280;

export type TextureTileSuggestInput = {
  readonly imageWidthPx: number;
  readonly imageHeightPx: number;
  /** Catalog board face width (mm). */
  readonly boardWidthMm?: number;
  /** Catalog board face length (mm). */
  readonly boardLengthMm?: number;
  /**
   * Optional base for the X (width) tile when not using full board size.
   * Defaults to DEFAULT_SUGGEST_TILE_WIDTH_MM.
   */
  readonly baseWidthMm?: number;
};

export type TextureTileSuggestResult = {
  readonly tileWidthMm: number;
  readonly tileLengthMm: number;
  /**
   * `board` = used tablero width×length as full-face map.
   * `aspect` = kept image aspect ratio from a base X width.
   */
  readonly mode: 'board' | 'aspect';
};

function positive(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Propose tile X/Y (mm) for 3D UV mapping.
 *
 * - If both board dimensions are set → use them (photo often is the full face).
 * - Else → keep image aspect ratio with baseWidth on X (transverse to grain).
 */
export function suggestTextureTileMmFromImage(
  input: TextureTileSuggestInput,
): TextureTileSuggestResult {
  const iw = Math.max(input.imageWidthPx, 1);
  const ih = Math.max(input.imageHeightPx, 1);
  const ratio = ih / iw;

  if (positive(input.boardWidthMm) && positive(input.boardLengthMm)) {
    return {
      tileWidthMm: Math.round(input.boardWidthMm),
      tileLengthMm: Math.round(input.boardLengthMm),
      mode: 'board',
    };
  }

  const base = positive(input.baseWidthMm)
    ? input.baseWidthMm
    : positive(input.boardWidthMm)
      ? input.boardWidthMm
      : DEFAULT_SUGGEST_TILE_WIDTH_MM;

  return {
    tileWidthMm: Math.round(base),
    tileLengthMm: Math.max(1, Math.round(base * ratio)),
    mode: 'aspect',
  };
}

/**
 * Load natural pixel size of an image URL (browser). Rejects on error.
 */
export function loadImageNaturalSize(
  url: string,
): Promise<{ readonly widthPx: number; readonly heightPx: number }> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('Image no disponible en este entorno'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w < 1 || h < 1) {
        reject(new Error('La imagen no tiene tamaño válido'));
        return;
      }
      resolve({ widthPx: w, heightPx: h });
    };
    img.onerror = () => {
      reject(new Error('No se pudo cargar la imagen'));
    };
    img.src = url;
  });
}
