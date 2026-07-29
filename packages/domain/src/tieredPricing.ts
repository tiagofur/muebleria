/**
 * Tiered pricing / volume discount logic (#202).
 *
 * Tiers are evaluated **highest-first** (sorted descending by minQuantity).
 * The first tier whose `minQuantity <= totalItemQuantity` wins.
 * If no tier applies (totalQuantity below all thresholds), discount is 0.
 */

import type { DiscountTier } from './types';

export interface ResolvedDiscount {
  /** The tier that was applied, or `null` if none matched. */
  readonly tier: DiscountTier | null;
  /** Discount percentage (0–100). */
  readonly discountPercent: number;
  /** Absolute discount amount on the given base price. */
  readonly discountAmount: number;
}

/**
 * Find the best (most generous) discount tier for a given total item quantity.
 * Tiers must be sorted descending by `minQuantity` for correct evaluation.
 */
export function resolveDiscountTier(
  tiers: readonly DiscountTier[],
  totalItemQuantity: number,
): DiscountTier | null {
  // Sort descending by minQuantity (defensive — caller should pre-sort)
  const sorted = [...tiers].sort((a, b) => b.minQuantity - a.minQuantity);
  for (const tier of sorted) {
    if (totalItemQuantity >= tier.minQuantity) {
      return tier;
    }
  }
  return null;
}

/**
 * Compute the discount amount for a base price given a set of tiers and the
 * project's total item quantity.
 */
export function applyTieredDiscount(
  tiers: readonly DiscountTier[],
  totalItemQuantity: number,
  basePrice: number,
): ResolvedDiscount {
  const tier = resolveDiscountTier(tiers, totalItemQuantity);
  if (!tier) {
    return { tier: null, discountPercent: 0, discountAmount: 0 };
  }
  const pct = Math.min(Math.max(tier.discountPercent, 0), 100);
  const amount = basePrice * (pct / 100);
  return { tier, discountPercent: pct, discountAmount: amount };
}

/**
 * Sum of all item quantities in a project.
 */
export function totalItemQuantity(
  items: readonly { readonly quantity: number }[],
): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}
