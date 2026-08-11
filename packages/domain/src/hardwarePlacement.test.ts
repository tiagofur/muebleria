import { describe, expect, it } from 'vitest';
import {
  normalizeHardwarePreview,
  resolveHardwarePlacement,
  type ResolvedHardwarePlacement,
} from './hardwarePlacement';
import type { Hardware } from './types';

/**
 * Golden placement table for resolveHardwarePlacement.
 *
 * Board-LOCAL frame: local X = width (W), Y = thickness (T), Z = length (L).
 * The board box occupies [0,W] x [0,T] x [0,L]. Each anchor face maps a
 * (xPercent,yPercent) pair onto the two in-plane axes and points the normal
 * along the remaining axis. Pinned here so the PR2 renderer can trust the
 * local frame of the child <group> it drops on each board mesh.
 */
const BOARD = { widthMm: 600, thicknessMm: 18, lengthMm: 800 } as const;

const knob: Hardware = {
  id: 'hw-knob',
  code: 'HER-JAL-POM',
  name: 'Pomo Cromado',
  unit: 'piece',
  costPerUnit: 18,
  active: true,
  previewShape: 'knob',
  previewSizeMm: 32,
  previewProjectionMm: 12,
  previewDiameterMm: 8,
  previewColor: '#C0C0C0',
  previewMetalness: 1,
  previewRoughness: 0.25,
  previewClearcoat: 0.6,
};

const costOnly: Hardware = {
  id: 'hw-hinge',
  code: 'HER-BIS-CL',
  name: 'Bisagra',
  unit: 'piece',
  costPerUnit: 28,
  active: true,
};

function resolve(
  face: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom',
  xPercent: number,
  yPercent: number,
  hardware: Hardware = knob,
  extra: {
    readonly rotationDeg?: { readonly x?: number; readonly y?: number; readonly z?: number };
    readonly scale?: number;
  } = {},
): ResolvedHardwarePlacement | null {
  return resolveHardwarePlacement({
    componentInstanceId: 'ci-puerta',
    placement: {
      hardwareId: hardware.id,
      anchorFace: face,
      relativePosition: { xPercent, yPercent },
      rotationDeg: extra.rotationDeg,
      scale: extra.scale,
    },
    board: BOARD,
    hardware,
  });
}

describe('resolveHardwarePlacement — per-face board-LOCAL mapping', () => {
  it('front face center sits on the +thickness surface, normal +Y', () => {
    const r = resolve('front', 50, 50);
    expect(r).not.toBeNull();
    expect(r!.localPosition[0]).toBeCloseTo(300, 6); // 0.5 * W
    expect(r!.localPosition[1]).toBeCloseTo(18, 6); // T (front surface)
    expect(r!.localPosition[2]).toBeCloseTo(400, 6); // 0.5 * L
    expect(r!.localNormal).toEqual([0, 1, 0]);
  });

  it('back face center sits on the 0-thickness surface, normal -Y', () => {
    const r = resolve('back', 50, 50);
    expect(r).not.toBeNull();
    expect(r!.localPosition[0]).toBeCloseTo(300, 6);
    expect(r!.localPosition[1]).toBeCloseTo(0, 6);
    expect(r!.localPosition[2]).toBeCloseTo(400, 6);
    expect(r!.localNormal).toEqual([0, -1, 0]);
  });

  it('left face center sits on the 0-width surface, normal -X', () => {
    const r = resolve('left', 50, 50);
    expect(r).not.toBeNull();
    expect(r!.localPosition[0]).toBeCloseTo(0, 6);
    expect(r!.localPosition[1]).toBeCloseTo(9, 6); // 0.5 * T
    expect(r!.localPosition[2]).toBeCloseTo(400, 6); // 0.5 * L
    expect(r!.localNormal).toEqual([-1, 0, 0]);
  });

  it('right face center sits on the +width surface, normal +X', () => {
    const r = resolve('right', 50, 50);
    expect(r).not.toBeNull();
    expect(r!.localPosition[0]).toBeCloseTo(600, 6); // W
    expect(r!.localPosition[1]).toBeCloseTo(9, 6); // 0.5 * T
    expect(r!.localPosition[2]).toBeCloseTo(400, 6); // 0.5 * L
    expect(r!.localNormal).toEqual([1, 0, 0]);
  });

  it('top face center sits on the +length surface, normal +Z', () => {
    const r = resolve('top', 50, 50);
    expect(r).not.toBeNull();
    expect(r!.localPosition[0]).toBeCloseTo(300, 6); // 0.5 * W
    expect(r!.localPosition[1]).toBeCloseTo(9, 6); // 0.5 * T
    expect(r!.localPosition[2]).toBeCloseTo(800, 6); // L
    expect(r!.localNormal).toEqual([0, 0, 1]);
  });

  it('bottom face center sits on the 0-length surface, normal -Z', () => {
    const r = resolve('bottom', 50, 50);
    expect(r).not.toBeNull();
    expect(r!.localPosition[0]).toBeCloseTo(300, 6);
    expect(r!.localPosition[1]).toBeCloseTo(9, 6);
    expect(r!.localPosition[2]).toBeCloseTo(0, 6);
    expect(r!.localNormal).toEqual([0, 0, -1]);
  });
});

describe('resolveHardwarePlacement — corners & clamping', () => {
  it('front {0,0} → min corner of the face plane', () => {
    const r = resolve('front', 0, 0);
    expect(r!.localPosition).toEqual([0, 18, 0]);
  });

  it('front {100,100} → max corner of the face plane', () => {
    const r = resolve('front', 100, 100);
    expect(r!.localPosition).toEqual([600, 18, 800]);
  });

  it('clamps xPercent>100 and yPercent<0 into the face bounds', () => {
    const r = resolve('front', 150, -20);
    expect(r!.localPosition[0]).toBeCloseTo(600, 6); // 150 -> 100
    expect(r!.localPosition[2]).toBeCloseTo(0, 6); // -20 -> 0
  });
});

describe('resolveHardwarePlacement — geometry, identity & defaults', () => {
  it('carries componentInstanceId + hardwareId through', () => {
    const r = resolve('front', 50, 50);
    expect(r!.componentInstanceId).toBe('ci-puerta');
    expect(r!.hardwareId).toBe('hw-knob');
  });

  it('standoffMm comes from previewProjectionMm', () => {
    expect(resolve('front', 50, 50)!.standoffMm).toBe(12);
  });

  it('standoffMm defaults to 0 when previewProjectionMm is absent', () => {
    const flush: Hardware = { ...knob, previewProjectionMm: undefined };
    expect(resolve('front', 50, 50, flush)!.standoffMm).toBe(0);
  });

  it('scale defaults to 1 when omitted', () => {
    expect(resolve('front', 50, 50)!.scale).toBe(1);
  });

  it('scale passes through when provided', () => {
    expect(resolve('front', 50, 50, knob, { scale: 1.5 })!.scale).toBe(1.5);
  });

  it('rotationDeg defaults to {0,0,0} when omitted', () => {
    expect(resolve('front', 50, 50)!.rotationDeg).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rotationDeg passes through provided axes and defaults the rest to 0', () => {
    expect(resolve('front', 50, 50, knob, { rotationDeg: { z: 90 } })!.rotationDeg).toEqual({
      x: 0,
      y: 0,
      z: 90,
    });
  });
});

describe('resolveHardwarePlacement — null / fallback paths', () => {
  it('returns null when hardware has no previewShape (VH-09 cost-only)', () => {
    expect(resolve('front', 50, 50, costOnly)).toBeNull();
  });

  it('returns null when previewShape is not in the enum (treated cost-only)', () => {
    const bad: Hardware = { ...knob, previewShape: 'ring' as Hardware['previewShape'] };
    expect(resolve('front', 50, 50, bad)).toBeNull();
  });

  it('returns null when a board dimension is non-finite', () => {
    const r = resolveHardwarePlacement({
      componentInstanceId: 'ci',
      placement: {
        hardwareId: knob.id,
        anchorFace: 'front',
        relativePosition: { xPercent: 50, yPercent: 50 },
      },
      board: { widthMm: NaN, thicknessMm: 18, lengthMm: 800 },
      hardware: knob,
    });
    expect(r).toBeNull();
  });

  it('clamps negative board dimensions to 0 instead of null', () => {
    const r = resolveHardwarePlacement({
      componentInstanceId: 'ci',
      placement: {
        hardwareId: knob.id,
        anchorFace: 'front',
        relativePosition: { xPercent: 50, yPercent: 50 },
      },
      board: { widthMm: -10, thicknessMm: 18, lengthMm: 800 },
      hardware: knob,
    });
    expect(r).not.toBeNull();
    expect(r!.localPosition[0]).toBe(0); // max(-10,0) * 0.5
  });
});

describe('normalizeHardwarePreview (VH-07)', () => {
  it('keeps a valid previewShape', () => {
    expect(normalizeHardwarePreview(knob).shape).toBe('knob');
  });

  it('drops an invalid previewShape (cost-only fallback)', () => {
    const bad: Hardware = { ...knob, previewShape: 'ring' as Hardware['previewShape'] };
    expect(normalizeHardwarePreview(bad).shape).toBeUndefined();
  });

  it('NaN metalness → undefined', () => {
    expect(
      normalizeHardwarePreview({ ...knob, previewMetalness: NaN }).metalness,
    ).toBeUndefined();
  });

  it('clamps metalness 1.5 → 1', () => {
    expect(
      normalizeHardwarePreview({ ...knob, previewMetalness: 1.5 }).metalness,
    ).toBe(1);
  });

  it('clamps a negative PBR scalar → 0', () => {
    expect(
      normalizeHardwarePreview({ ...knob, previewRoughness: -0.3 }).roughness,
    ).toBe(0);
  });

  it('Infinity clearcoat → undefined', () => {
    expect(
      normalizeHardwarePreview({ ...knob, previewClearcoat: Infinity }).clearcoat,
    ).toBeUndefined();
  });

  it('preserves valid PBR scalars', () => {
    const n = normalizeHardwarePreview(knob);
    expect(n.metalness).toBe(1);
    expect(n.roughness).toBeCloseTo(0.25, 6);
    expect(n.clearcoat).toBeCloseTo(0.6, 6);
  });

  it('dims (size/projection/diameter) ≤ 0 or non-finite → undefined', () => {
    expect(
      normalizeHardwarePreview({ ...knob, previewSizeMm: 0 }).sizeMm,
    ).toBeUndefined();
    expect(
      normalizeHardwarePreview({ ...knob, previewSizeMm: -5 }).sizeMm,
    ).toBeUndefined();
    expect(
      normalizeHardwarePreview({ ...knob, previewProjectionMm: 0 }).projectionMm,
    ).toBeUndefined();
    expect(
      normalizeHardwarePreview({ ...knob, previewDiameterMm: NaN }).diameterMm,
    ).toBeUndefined();
  });

  it('keeps a positive finite dim', () => {
    const n = normalizeHardwarePreview(knob);
    expect(n.sizeMm).toBe(32);
    expect(n.projectionMm).toBe(12);
    expect(n.diameterMm).toBe(8);
  });

  it('normalizes a valid color and drops an invalid one', () => {
    expect(
      normalizeHardwarePreview({ ...knob, previewColor: '#abc' }).color,
    ).toBe('#AABBCC');
    expect(
      normalizeHardwarePreview({ ...knob, previewColor: 'red' }).color,
    ).toBeUndefined();
  });

  it('cost-only hardware normalizes to an empty object and never throws', () => {
    expect(() => normalizeHardwarePreview(costOnly)).not.toThrow();
    expect(normalizeHardwarePreview(costOnly)).toEqual({});
  });
});
