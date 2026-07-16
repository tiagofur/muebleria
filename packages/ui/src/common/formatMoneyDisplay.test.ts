import { describe, expect, it } from 'vitest';
import { formatMoneyDisplay } from './formatMoneyDisplay';

describe('formatMoneyDisplay (#51)', () => {
  it('formats with es-MX grouping, 2 decimals, and MXN by default', () => {
    expect(formatMoneyDisplay(202.5)).toBe('$202.50 MXN');
    expect(formatMoneyDisplay(1250.5)).toBe('$1,250.50 MXN');
    expect(formatMoneyDisplay(0)).toBe('$0.00 MXN');
  });

  it('treats nullish and non-finite as zero', () => {
    expect(formatMoneyDisplay(undefined)).toBe('$0.00 MXN');
    expect(formatMoneyDisplay(null)).toBe('$0.00 MXN');
    expect(formatMoneyDisplay(Number.NaN)).toBe('$0.00 MXN');
    expect(formatMoneyDisplay(Number.POSITIVE_INFINITY)).toBe('$0.00 MXN');
  });

  it('accepts optional currency for multi-currency projects', () => {
    expect(formatMoneyDisplay(10, { currency: 'USD' })).toBe('$10.00 USD');
    expect(formatMoneyDisplay(10, { currency: ' mxn ' })).toBe('$10.00 MXN');
  });

  it('can omit currency suffix when requested', () => {
    expect(formatMoneyDisplay(99.1, { showCurrency: false })).toBe('$99.10');
  });
});
