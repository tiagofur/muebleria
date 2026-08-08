import { describe, expect, it } from 'vitest';
import {
  contactShadowForFloor,
  floorPlaneUvRepeat,
  relativeLuminance,
  wallBoxUvRepeat,
} from './ambientUvRepeat';

/**
 * Pure-function tests for ambient UV repeat + contact-shadow tuning
 * (spec #4149, design #4151 R5/R7). All formulas mirror the real scene
 * geometry args in FurnitureScene3D.tsx (floor plane
 * `planeGeometry args=[totalWidth*1.4, totalDepth*1.6]`, wall box
 * `args=[length, 2400, thickness]`).
 */
describe('ambientUvRepeat', () => {
  describe('relativeLuminance', () => {
    it('returns null for undefined input', () => {
      expect(relativeLuminance(undefined)).toBeNull();
    });

    it('parses #RRGGBB and returns luminance normalized 0..1', () => {
      // #eeeeee → 238 → 238/255 = 0.9333...
      const lum = relativeLuminance('#eeeeee')!;
      expect(lum).toBeGreaterThan(0.6);
      expect(lum).toBeLessThanOrEqual(1);
      expect(lum).toBeCloseTo((0.2126 + 0.7152 + 0.0722) * 238 / 255, 5);
    });

    it('parses #111111 as a dark color (lum <= 0.25)', () => {
      expect(relativeLuminance('#111111')).toBeLessThanOrEqual(0.25);
    });

    it('expands #RGB shorthand to #RRGGBB', () => {
      // #fff → #ffffff → 255 → 1.0
      expect(relativeLuminance('#fff')).toBeCloseTo(1, 5);
    });

    it('returns null for an unparseable color', () => {
      expect(relativeLuminance('not-a-color')).toBeNull();
      expect(relativeLuminance('#zzzzzz')).toBeNull();
    });
  });

  describe('floorPlaneUvRepeat', () => {
    // Formula: [max(planeW*1.4/tileW, 0.25), max(planeD*1.6/tileL, 0.25)]
    // planeW/planeD are the RAW totalWidth/totalDepth; the *1.4/*1.6
    // multipliers live inside the function (they mirror the scene plane).
    it('derives repeat from plane extent vs tile mm', () => {
      // 2000*1.4/400 = 7 ; 2000*1.6/400 = 8
      expect(floorPlaneUvRepeat(2000, 2000, 400, 400)).toEqual([7, 8]);
    });

    it('falls back to 280mm tile when tile is 0 or undefined', () => {
      // 2800*1.4/280 = 14 ; 2800*1.6/280 = 16 (float-imprecision tolerant:
      // 1.4 is not exactly representable, so assert near the math result).
      const zero = floorPlaneUvRepeat(2800, 2800, 0, 0);
      expect(zero[0]).toBeCloseTo(14, 6);
      expect(zero[1]).toBeCloseTo(16, 6);
      const omitted = floorPlaneUvRepeat(2800, 2800);
      expect(omitted[0]).toBeCloseTo(14, 6);
      expect(omitted[1]).toBeCloseTo(16, 6);
    });

    it('clamps a tiny result to 0.25', () => {
      // huge tile vs tiny plane → quotient < 0.25 → 0.25 floor
      expect(floorPlaneUvRepeat(100, 100, 10000, 10000)).toEqual([0.25, 0.25]);
    });

    it('applies asymmetric plane multipliers independently on X/Y', () => {
      // X uses *1.4, Y uses *1.6 → different repeats for a square plane.
      const [u, v] = floorPlaneUvRepeat(3000, 3000, 500, 500);
      expect(u).toBeCloseTo((3000 * 1.4) / 500, 6); // 8.4
      expect(v).toBeCloseTo((3000 * 1.6) / 500, 6); // 9.6
      expect(v).toBeGreaterThan(u);
    });
  });

  describe('wallBoxUvRepeat', () => {
    // Formula: [max(length/tileW, 0.25), max(height/tileL, 0.25)]
    it('derives repeat from wall length/height vs tile mm', () => {
      // 2400/300 = 8 ; 2400/600 = 4
      expect(wallBoxUvRepeat(2400, 2400, 300, 600)).toEqual([8, 4]);
    });

    it('falls back to 280mm tile when tile is 0 or undefined', () => {
      const [u, v] = wallBoxUvRepeat(2400, 2400, 0, 0);
      expect(u).toBeCloseTo(2400 / 280, 5);
      expect(v).toBeCloseTo(2400 / 280, 5);
    });

    it('clamps a tiny result to 0.25', () => {
      expect(wallBoxUvRepeat(100, 100, 10000, 10000)).toEqual([0.25, 0.25]);
    });
  });

  describe('contactShadowForFloor', () => {
    it('returns dark band (opacity 0.38, #000000) for a dark floor', () => {
      expect(contactShadowForFloor('#111111')).toEqual({
        opacity: 0.38,
        color: '#000000',
      });
    });

    it('returns mid band (opacity 0.32, #000000) for a mid floor', () => {
      // #777777 → 119/255 = 0.466 → (0.25, 0.6]
      expect(contactShadowForFloor('#777777')).toEqual({
        opacity: 0.32,
        color: '#000000',
      });
    });

    it('returns mid band at the upper boundary (lum === 0.6 is mid, not light)', () => {
      // #999999 → 153/255 = 0.6 exactly → mid band (light requires lum > 0.6)
      expect(contactShadowForFloor('#999999')).toEqual({
        opacity: 0.32,
        color: '#000000',
      });
    });

    it('returns light band (opacity 0.22, #1a1a22) for a light floor', () => {
      expect(contactShadowForFloor('#eeeeee')).toEqual({
        opacity: 0.22,
        color: '#1a1a22',
      });
    });

    it('returns mid band for undefined floor (backward-compat default)', () => {
      expect(contactShadowForFloor(undefined)).toEqual({
        opacity: 0.32,
        color: '#000000',
      });
    });

    it('returns mid band for an unparseable color', () => {
      expect(contactShadowForFloor('nope')).toEqual({
        opacity: 0.32,
        color: '#000000',
      });
    });
  });
});
