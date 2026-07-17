/**
 * Material preview color helpers (3D / swatches). Pure validation + normalize.
 */

/** Accept #RGB or #RRGGBB (case-insensitive). */
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidPreviewColor(value: string | undefined | null): boolean {
  if (value == null) return false;
  return HEX_COLOR.test(value.trim());
}

/**
 * Normalize a valid preview color to uppercase #RRGGBB.
 * Returns undefined if missing/invalid.
 */
export function normalizePreviewColor(
  value: string | undefined | null,
): string | undefined {
  if (value == null) return undefined;
  const t = value.trim();
  if (!HEX_COLOR.test(t)) return undefined;
  const hex = t.slice(1);
  if (hex.length === 3) {
    const expanded = hex
      .split('')
      .map((c) => c + c)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }
  return `#${hex.toUpperCase()}`;
}

/** Default soft wood tone when a material has no preview color. */
export const DEFAULT_MATERIAL_PREVIEW_COLOR = '#D4C4A8';
