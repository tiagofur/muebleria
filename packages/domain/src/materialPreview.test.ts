import { describe, expect, it } from 'vitest';
import {
  isValidPreviewColor,
  normalizePreviewColor,
  resolveAmbientMaterials,
} from './materialPreview';
import type { AmbientMaterial } from './types';

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

  it('provides default ambient materials when custom catalog is empty', () => {
    const resolved = resolveAmbientMaterials([]);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.some((m: AmbientMaterial) => m.surfaceType === 'floor')).toBe(true);
    expect(resolved.some((m: AmbientMaterial) => m.surfaceType === 'wall')).toBe(true);
    expect(resolved.some((m: AmbientMaterial) => m.surfaceType === 'ceiling')).toBe(true);
  });
});
