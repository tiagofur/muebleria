import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUGGEST_TILE_WIDTH_MM,
  suggestTextureTileMmFromImage,
} from './materialTextureTileSuggest';

describe('suggestTextureTileMmFromImage', () => {
  it('uses board face size when both dims are set (full-sheet photo)', () => {
    const r = suggestTextureTileMmFromImage({
      imageWidthPx: 2000,
      imageHeightPx: 1000,
      boardWidthMm: 1830,
      boardLengthMm: 2440,
    });
    expect(r).toEqual({
      tileWidthMm: 1830,
      tileLengthMm: 2440,
      mode: 'board',
    });
  });

  it('keeps image aspect ratio from default base width', () => {
    // 2:1 image → Y = 2 * X
    const r = suggestTextureTileMmFromImage({
      imageWidthPx: 1000,
      imageHeightPx: 2000,
    });
    expect(r.mode).toBe('aspect');
    expect(r.tileWidthMm).toBe(DEFAULT_SUGGEST_TILE_WIDTH_MM);
    expect(r.tileLengthMm).toBe(DEFAULT_SUGGEST_TILE_WIDTH_MM * 2);
  });

  it('uses board width as base X when only width is known', () => {
    const r = suggestTextureTileMmFromImage({
      imageWidthPx: 1000,
      imageHeightPx: 500,
      boardWidthMm: 600,
    });
    expect(r.mode).toBe('aspect');
    expect(r.tileWidthMm).toBe(600);
    expect(r.tileLengthMm).toBe(300);
  });

  it('honors explicit baseWidthMm', () => {
    const r = suggestTextureTileMmFromImage({
      imageWidthPx: 800,
      imageHeightPx: 400,
      baseWidthMm: 400,
    });
    expect(r.tileWidthMm).toBe(400);
    expect(r.tileLengthMm).toBe(200);
  });
});
