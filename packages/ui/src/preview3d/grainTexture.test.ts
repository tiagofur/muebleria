import { describe, expect, it } from 'vitest';
import {
  grainUvRepeat,
  parseHexColor,
  createGrainCanvas,
  GRAIN_TILE_MM,
} from './grainTexture';

describe('grainTexture', () => {
  it('scales UV repeat with piece size', () => {
    const [u, v] = grainUvRepeat(280, 560, 140);
    expect(u).toBeCloseTo(2, 5);
    expect(v).toBeCloseTo(4, 5);
  });

  it('clamps tiny pieces to a visible minimum repeat', () => {
    const [u, v] = grainUvRepeat(1, 1, GRAIN_TILE_MM);
    expect(u).toBe(0.35);
    expect(v).toBe(0.35);
  });

  it('parses #RGB and #RRGGBB', () => {
    expect(parseHexColor('#abc')).toEqual([170, 187, 204]);
    expect(parseHexColor('#C4A574')).toEqual([196, 165, 116]);
  });

  it('returns null for grain canvas outside a full browser canvas', () => {
    // Node / jsdom without canvas 2d → graceful no-op for R3F mesh fallback.
    expect(createGrainCanvas('#C4A574', 64)).toBeNull();
  });
});
