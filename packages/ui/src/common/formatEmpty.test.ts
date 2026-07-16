import { describe, expect, it } from 'vitest';
import { EMPTY_PLACEHOLDER, formatEmpty } from './formatEmpty';

describe('formatEmpty', () => {
  it('uses em dash for missing values', () => {
    expect(formatEmpty(null)).toBe(EMPTY_PLACEHOLDER);
    expect(formatEmpty(undefined)).toBe(EMPTY_PLACEHOLDER);
    expect(formatEmpty('')).toBe(EMPTY_PLACEHOLDER);
    expect(formatEmpty('   ')).toBe(EMPTY_PLACEHOLDER);
  });

  it('keeps non-empty values', () => {
    expect(formatEmpty('hola')).toBe('hola');
    expect(formatEmpty(0)).toBe('0');
  });
});
