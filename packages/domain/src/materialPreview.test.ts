import { describe, expect, it } from 'vitest';
import {
  isValidPreviewColor,
  normalizePreviewColor,
} from './materialPreview';

describe('materialPreview', () => {
  it('accepts #RGB and #RRGGBB', () => {
    expect(isValidPreviewColor('#fff')).toBe(true);
    expect(isValidPreviewColor('#A1B2C3')).toBe(true);
    expect(isValidPreviewColor('red')).toBe(false);
    expect(isValidPreviewColor('#gg0000')).toBe(false);
  });

  it('normalizes short hex to full uppercase', () => {
    expect(normalizePreviewColor('#abc')).toBe('#AABBCC');
    expect(normalizePreviewColor('  #d4c4a8 ')).toBe('#D4C4A8');
    expect(normalizePreviewColor('nope')).toBeUndefined();
  });
});
