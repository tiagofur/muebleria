/** Canonical empty-field placeholder (design consistency — em dash). */
export const EMPTY_PLACEHOLDER = '—' as const;

/** Display value or em dash when missing/blank. */
export function formatEmpty(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return EMPTY_PLACEHOLDER;
  if (typeof value === 'string' && value.trim() === '') return EMPTY_PLACEHOLDER;
  return String(value);
}
