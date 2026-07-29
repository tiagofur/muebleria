import { describe, expect, it } from 'vitest';
import { resolveDiscountTier, applyTieredDiscount, totalItemQuantity } from './tieredPricing';
import type { DiscountTier } from './types';

const tiers: readonly DiscountTier[] = [
  { id: 't1', label: '10+ unidades', minQuantity: 10, discountPercent: 5 },
  { id: 't2', label: '20+ unidades', minQuantity: 20, discountPercent: 10 },
  { id: 't3', label: '50+ unidades', minQuantity: 50, discountPercent: 15 },
];

describe('resolveDiscountTier', () => {
  it('returns null when no tiers provided', () => {
    expect(resolveDiscountTier([], 100)).toBeNull();
  });

  it('returns null when quantity below all thresholds', () => {
    expect(resolveDiscountTier(tiers, 3)).toBeNull();
    expect(resolveDiscountTier(tiers, 9)).toBeNull();
  });

  it('returns the lowest qualifying tier (highest minQuantity)', () => {
    const result = resolveDiscountTier(tiers, 10);
    expect(result?.id).toBe('t1');
  });

  it('returns the best tier when quantity is high enough', () => {
    const result = resolveDiscountTier(tiers, 50);
    expect(result?.id).toBe('t3');
  });

  it('returns best tier for quantity above all thresholds', () => {
    const result = resolveDiscountTier(tiers, 100);
    expect(result?.id).toBe('t3');
  });

  it('handles unsorted tiers correctly', () => {
    const unsorted: readonly DiscountTier[] = [
      { id: 't3', label: '50+', minQuantity: 50, discountPercent: 15 },
      { id: 't1', label: '10+', minQuantity: 10, discountPercent: 5 },
      { id: 't2', label: '20+', minQuantity: 20, discountPercent: 10 },
    ];
    expect(resolveDiscountTier(unsorted, 25)?.id).toBe('t2');
    expect(resolveDiscountTier(unsorted, 55)?.id).toBe('t3');
  });
});

describe('applyTieredDiscount', () => {
  it('returns zero discount when no tiers match', () => {
    const result = applyTieredDiscount(tiers, 3, 10000);
    expect(result.discountPercent).toBe(0);
    expect(result.discountAmount).toBe(0);
    expect(result.tier).toBeNull();
  });

  it('applies 5% discount for 10-unit tier', () => {
    const result = applyTieredDiscount(tiers, 10, 10000);
    expect(result.discountPercent).toBe(5);
    expect(result.discountAmount).toBe(500);
    expect(result.tier?.id).toBe('t1');
  });

  it('applies 10% discount for 20-unit tier', () => {
    const result = applyTieredDiscount(tiers, 30, 20000);
    expect(result.discountPercent).toBe(10);
    expect(result.discountAmount).toBe(2000);
    expect(result.tier?.id).toBe('t2');
  });

  it('applies 15% discount for 50-unit tier', () => {
    const result = applyTieredDiscount(tiers, 100, 100000);
    expect(result.discountPercent).toBe(15);
    expect(result.discountAmount).toBe(15000);
    expect(result.tier?.id).toBe('t3');
  });

  it('clamps discountPercent to 0–100', () => {
    const badTier: readonly DiscountTier[] = [
      { id: 'bad', label: 'Bad', minQuantity: 1, discountPercent: 150 },
    ];
    const result = applyTieredDiscount(badTier, 5, 1000);
    expect(result.discountPercent).toBe(100);
    expect(result.discountAmount).toBe(1000);
  });

  it('handles zero base price', () => {
    const result = applyTieredDiscount(tiers, 10, 0);
    expect(result.discountAmount).toBe(0);
    expect(result.discountPercent).toBe(5);
  });

  it('handles empty tiers', () => {
    const result = applyTieredDiscount([], 100, 50000);
    expect(result.discountPercent).toBe(0);
    expect(result.discountAmount).toBe(0);
  });
});

describe('totalItemQuantity', () => {
  it('sums item quantities', () => {
    expect(totalItemQuantity([{ quantity: 3 }, { quantity: 7 }, { quantity: 5 }])).toBe(15);
  });

  it('returns 0 for empty items', () => {
    expect(totalItemQuantity([])).toBe(0);
  });

  it('returns quantity for single item', () => {
    expect(totalItemQuantity([{ quantity: 42 }])).toBe(42);
  });
});
