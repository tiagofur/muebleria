/**
 * Workshop rules tests (Fase 5 slice 5.1).
 */

import { describe, expect, it } from 'vitest';
import {
  suggestHingeCount,
  suggestSlideLength,
  suggestShelfCount,
  suggestHandleCount,
  suggestLegCount,
  suggestHardwareForModule,
} from './workshopRules';

describe('suggestHingeCount', () => {
  it('returns 0 for zero or negative height', () => {
    expect(suggestHingeCount(0)).toBe(0);
    expect(suggestHingeCount(-100)).toBe(0);
  });

  it('returns 2 for doors ≤ 800mm', () => {
    expect(suggestHingeCount(500)).toBe(2);
    expect(suggestHingeCount(800)).toBe(2);
  });

  it('returns 3 for doors 801-1400mm', () => {
    expect(suggestHingeCount(801)).toBe(3);
    expect(suggestHingeCount(1400)).toBe(3);
  });

  it('returns 4 for doors 1401-2000mm', () => {
    expect(suggestHingeCount(1401)).toBe(4);
    expect(suggestHingeCount(2000)).toBe(4);
  });

  it('returns 5 for doors > 2000mm', () => {
    expect(suggestHingeCount(2100)).toBe(5);
  });
});

describe('suggestSlideLength', () => {
  it('returns 0 for zero or negative depth', () => {
    expect(suggestSlideLength(0)).toBe(0);
    expect(suggestSlideLength(-50)).toBe(0);
  });

  it('rounds up to nearest standard size', () => {
    expect(suggestSlideLength(280)).toBe(300);
    expect(suggestSlideLength(450)).toBe(450);
    expect(suggestSlideLength(420)).toBe(450);
  });

  it('returns smallest size for small drawers', () => {
    expect(suggestSlideLength(200)).toBe(250);
  });

  it('returns largest size for very deep drawers', () => {
    expect(suggestSlideLength(600)).toBe(550);
  });
});

describe('suggestShelfCount', () => {
  it('returns 0 for too-short cabinet', () => {
    expect(suggestShelfCount(200, 300)).toBe(0);
    expect(suggestShelfCount(300, 300)).toBe(0);
  });

  it('returns correct count for standard heights', () => {
    // interior 720mm, spacing 300: floor(720/300) - 1 = 2 - 1 = 1
    expect(suggestShelfCount(720, 300)).toBe(1);
    // interior 1000mm, spacing 300: floor(1000/300) - 1 = 3 - 1 = 2
    expect(suggestShelfCount(1000, 300)).toBe(2);
  });

  it('respects custom spacing', () => {
    expect(suggestShelfCount(900, 450)).toBe(1);
    expect(suggestShelfCount(900, 200)).toBe(3);
  });
});

describe('suggestHandleCount', () => {
  it('returns one per door', () => {
    expect(suggestHandleCount(1)).toBe(1);
    expect(suggestHandleCount(3)).toBe(3);
  });

  it('returns 0 for no doors', () => {
    expect(suggestHandleCount(0)).toBe(0);
  });
});

describe('suggestLegCount', () => {
  it('returns 4 for narrow cabinets', () => {
    expect(suggestLegCount(600)).toBe(4);
    expect(suggestLegCount(800)).toBe(4);
  });

  it('adds 1 leg per 400mm extra', () => {
    expect(suggestLegCount(1000)).toBe(5); // 4 + ceil(200/400) = 4+1
    expect(suggestLegCount(1600)).toBe(6); // 4 + ceil(800/400) = 4+2
  });
});

describe('suggestHardwareForModule', () => {
  it('computes complete suggestion for a standard base cabinet', () => {
    const s = suggestHardwareForModule({
      heightMm: 720,
      widthMm: 600,
      depthMm: 560,
      doorCount: 1,
      drawerCount: 0,
    });
    expect(s.hinges).toBe(2); // 720mm → 2 per door, 1 door (720 ≤ 800)
    expect(s.handles).toBe(1);
    expect(s.legs).toBe(4);
    expect(s.slides).toBe(0);
    expect(s.slideLengthMm).toBe(0);
  });

  it('computes for a tall pantry cabinet', () => {
    const s = suggestHardwareForModule({
      heightMm: 2100,
      widthMm: 600,
      depthMm: 580,
      doorCount: 2,
      drawerCount: 0,
    });
    expect(s.hinges).toBe(10); // 5 per door × 2 doors
    expect(s.handles).toBe(2);
    expect(s.shelves).toBeGreaterThan(0);
  });

  it('computes for a drawer bank', () => {
    const s = suggestHardwareForModule({
      heightMm: 720,
      widthMm: 500,
      depthMm: 500,
      doorCount: 0,
      drawerCount: 4,
    });
    expect(s.slides).toBe(4);
    expect(s.slideLengthMm).toBe(500);
    expect(s.hinges).toBe(0);
    expect(s.handles).toBe(0);
  });
});
