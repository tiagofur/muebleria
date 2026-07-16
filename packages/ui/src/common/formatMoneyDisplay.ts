/**
 * Unified money display for workshop UI (issue #51).
 * Presentation only — no domain conversion.
 *
 * Rules: locale `es-MX`, 2 decimals, currency code default **MXN**.
 */

export type FormatMoneyDisplayOptions = {
  /** ISO-ish currency code shown after the amount (default MXN). */
  readonly currency?: string;
  /**
   * When false, omit the currency suffix (still uses `$` + locale amount).
   * Prefer leaving true for business amounts.
   */
  readonly showCurrency?: boolean;
};

const DEFAULT_CURRENCY = 'MXN';
const LOCALE = 'es-MX';

/**
 * Format a money amount for display across catalogs, quotes, modules, dashboard.
 * Nullish / non-finite values render as zero.
 */
export function formatMoneyDisplay(
  n: number | null | undefined,
  options?: FormatMoneyDisplayOptions,
): string {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  const amount = value.toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const withCurrency = options?.showCurrency !== false;
  if (!withCurrency) {
    return `$${amount}`;
  }
  const currency = (options?.currency?.trim() || DEFAULT_CURRENCY).toUpperCase();
  return `$${amount} ${currency}`;
}
