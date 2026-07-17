import { describe, expect, it } from 'vitest';
import { extractDominantColorFromRgba } from './extractDominantColor';

function rgbaFill(
  count: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = a;
  }
  return data;
}

describe('extractDominantColorFromRgba', () => {
  it('returns the solid color of a uniform image', () => {
    const data = rgbaFill(100, 245, 245, 240);
    expect(extractDominantColorFromRgba(data, { step: 1, bucketSize: 8 })).toBe(
      '#F5F5F0',
    );
  });

  it('picks the majority color when two colors compete', () => {
    const majority = rgbaFill(80, 200, 160, 100);
    const minority = rgbaFill(20, 10, 10, 200);
    const data = new Uint8ClampedArray(majority.length + minority.length);
    data.set(majority, 0);
    data.set(minority, majority.length);
    const hex = extractDominantColorFromRgba(data, { step: 1, bucketSize: 16 });
    // Majority is warm wood-ish ~ #C8A064
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    const r = parseInt(hex!.slice(1, 3), 16);
    const g = parseInt(hex!.slice(3, 5), 16);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeGreaterThan(100);
  });

  it('ignores transparent pixels', () => {
    const solid = rgbaFill(10, 0, 128, 255, 255);
    const clear = rgbaFill(90, 255, 0, 0, 0);
    const data = new Uint8ClampedArray(solid.length + clear.length);
    data.set(clear, 0);
    data.set(solid, clear.length);
    expect(extractDominantColorFromRgba(data, { step: 1 })).toBe('#0080FF');
  });

  it('returns undefined for empty / fully transparent input', () => {
    expect(extractDominantColorFromRgba(new Uint8ClampedArray(0))).toBeUndefined();
    expect(
      extractDominantColorFromRgba(rgbaFill(5, 1, 2, 3, 0), { step: 1 }),
    ).toBeUndefined();
  });
});
