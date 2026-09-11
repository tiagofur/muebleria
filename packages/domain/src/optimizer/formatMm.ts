/**
 * Presentation-only millimetre formatting (#650, PR #655 R2).
 *
 * The operator-facing text must describe the exact measure the validated
 * program carries — never another one. This helper removes insignificant
 * IEEE-754 representation noise and keeps useful decimals without forcing
 * a trailing ".0". It NEVER alters the structured number and is NOT a
 * manufacturing tolerance: rounding happens only in the visible string.
 */

/** Explicit presentation cap; enough for every board-scale measure in the domain. */
const MAX_DECIMALS = 3;

export function formatMm(valueMm: number): string {
  if (!Number.isFinite(valueMm)) {
    return String(valueMm);
  }
  const factor = 10 ** MAX_DECIMALS;
  const cleaned = Math.round(valueMm * factor) / factor;
  // String() of the cleaned number drops trailing zeros ("2430", "3.2") and
  // never switches to exponent notation at board-scale magnitudes (< 1e21).
  return String(cleaned);
}
