/**
 * Anti-regression: placement rotation → axis mapping + min-corner box extents.
 *
 * (x,y,z) is the workshop min corner of the part AABB. boardPartToVisual /
 * groupPositionFromMinCorner offsets the local origin so growth signs from
 * Euler no longer require hand-tuned right/front anchors.
 */

import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Vector3 } from 'three';
import {
  defaultPoseForPlacement,
  groupPositionFromMinCorner,
} from '@granete/domain';

const dims = { PW: 600, PH: 720, PD: 560, T: 18 };

function axisMapping(
  rotateX: number,
  rotateY: number,
  rotateZ: number,
): {
  widthAxis: Vector3;
  thicknessAxis: Vector3;
  lengthAxis: Vector3;
} {
  const e = new Euler(
    (rotateX * Math.PI) / 180,
    (rotateY * Math.PI) / 180,
    (rotateZ * Math.PI) / 180,
    'XYZ',
  );
  const m = new Matrix4().makeRotationFromEuler(e);
  return {
    widthAxis: new Vector3(1, 0, 0).applyMatrix4(m),
    thicknessAxis: new Vector3(0, 1, 0).applyMatrix4(m),
    lengthAxis: new Vector3(0, 0, 1).applyMatrix4(m),
  };
}

function dominantAxis(v: Vector3): 'X' | 'Y' | 'Z' {
  const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const i = a.indexOf(Math.max(...a));
  return ['X', 'Y', 'Z'][i] as 'X' | 'Y' | 'Z';
}

/**
 * Workshop min-corner pose + size + rot → axis-aligned bounds in Three space.
 * Uses the same group position helper as boardPartToVisual.
 */
function boxExtentsFromMinCorner(
  minCorner: { x: number; y: number; z: number },
  size: readonly [number, number, number],
  rot: { rotateX: number; rotateY: number; rotateZ: number },
): { x: [number, number]; y: [number, number]; z: [number, number] } {
  const [sw, st, sl] = size;
  const group = groupPositionFromMinCorner(
    minCorner,
    { widthMm: sw, thicknessMm: st, lengthMm: sl },
    rot,
  );
  const origin = new Vector3(group[0], group[1], group[2]);
  const { widthAxis: w, thicknessAxis: t, lengthAxis: l } = axisMapping(
    rot.rotateX,
    rot.rotateY,
    rot.rotateZ,
  );
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const aw of [0, sw]) {
    for (const at of [0, st]) {
      for (const al of [0, sl]) {
        const p = origin
          .clone()
          .addScaledVector(w, aw)
          .addScaledVector(t, at)
          .addScaledVector(l, al);
        xs.push(p.x);
        ys.push(p.y);
        zs.push(p.z);
      }
    }
  }
  const round = (n: number) => {
    const r = Math.round(n * 1000) / 1000;
    return Object.is(r, -0) ? 0 : r;
  };
  return {
    x: [round(Math.min(...xs)), round(Math.max(...xs))],
    y: [round(Math.min(...ys)), round(Math.max(...ys))],
    z: [round(Math.min(...zs)), round(Math.max(...zs))],
  };
}

describe('placement rotation → Three.js axis mapping', () => {
  it('lateral_izquierdo stands as a vertical SIDE (thick→X, length→Y, width→Z)', () => {
    const pose = defaultPoseForPlacement('lateral_izquierdo', dims, 0, 1);
    const m = axisMapping(pose.rotateX, pose.rotateY, pose.rotateZ);
    expect(dominantAxis(m.thicknessAxis)).toBe('X');
    expect(dominantAxis(m.lengthAxis)).toBe('Y');
    expect(dominantAxis(m.widthAxis)).toBe('Z');
  });

  it('lateral_derecho stands as a vertical SIDE too', () => {
    const pose = defaultPoseForPlacement('lateral_derecho', dims, 0, 1);
    const m = axisMapping(pose.rotateX, pose.rotateY, pose.rotateZ);
    expect(dominantAxis(m.thicknessAxis)).toBe('X');
    expect(dominantAxis(m.lengthAxis)).toBe('Y');
    expect(dominantAxis(m.widthAxis)).toBe('Z');
  });

  it('trasera: thick +Z into body, length +Y', () => {
    const pose = defaultPoseForPlacement('trasera', dims, 0, 1);
    const m = axisMapping(pose.rotateX, pose.rotateY, pose.rotateZ);
    expect(dominantAxis(m.thicknessAxis)).toBe('Z');
    expect(dominantAxis(m.lengthAxis)).toBe('Y');
    expect(m.lengthAxis.y).toBeGreaterThan(0);
    expect(m.thicknessAxis.z).toBeGreaterThan(0);
    expect(pose.x).toBe(dims.T); // left edge (min corner)
  });

  it('puerta: length up and thickness outward (+Z), min at front-left', () => {
    const pose = defaultPoseForPlacement('puerta', dims, 0, 1);
    const m = axisMapping(pose.rotateX, pose.rotateY, pose.rotateZ);
    expect(m.lengthAxis.y).toBeGreaterThan(0);
    expect(m.thicknessAxis.z).toBeGreaterThan(0);
    expect(pose.x).toBe(2);
    expect(pose.y).toBe(dims.PD);
  });

  it('base: horizontal, length on X, width on Z, min at y=0', () => {
    const pose = defaultPoseForPlacement('base', dims, 0, 1);
    const m = axisMapping(pose.rotateX, pose.rotateY, pose.rotateZ);
    expect(dominantAxis(m.thicknessAxis)).toBe('Y');
    expect(dominantAxis(m.lengthAxis)).toBe('X');
    expect(dominantAxis(m.widthAxis)).toBe('Z');
    expect(pose.y).toBe(0);
    expect(pose.rotateY).toBe(90);
  });
});

describe('min-corner box extents', () => {
  const T = dims.T;
  const doorW = dims.PW - 4;
  const doorL = dims.PH - 3;
  const backW = dims.PW - 2 * T;
  const backL = dims.PH - 2 * T;

  it('puerta overlay spans outside the front face and above the floor', () => {
    const pose = defaultPoseForPlacement('puerta', dims, 0, 1);
    const e = boxExtentsFromMinCorner(pose, [doorW, T, doorL], pose);
    expect(e.z[0]).toBe(dims.PD);
    expect(e.z[1]).toBe(dims.PD + T);
    expect(e.y[0]).toBe(pose.z);
    expect(e.y[1]).toBe(pose.z + doorL);
    expect(e.x[0]).toBe(2);
    expect(e.x[1]).toBe(2 + doorW);
  });

  it('trasera sits in the back bay (0..T depth) and grows upward', () => {
    const pose = defaultPoseForPlacement('trasera', dims, 0, 1);
    const e = boxExtentsFromMinCorner(pose, [backW, T, backL], pose);
    expect(e.z[0]).toBe(0);
    expect(e.z[1]).toBe(T);
    expect(e.y[0]).toBe(T);
    expect(e.y[1]).toBe(T + backL);
    expect(e.x[0]).toBe(T);
    expect(e.x[1]).toBe(T + backW);
  });

  it('frontal fills the last T mm of depth (inside front face)', () => {
    const pose = defaultPoseForPlacement('frontal', dims, 0, 1);
    const frontW = dims.PW - 2 * T;
    const frontL = 120;
    const e = boxExtentsFromMinCorner(pose, [frontW, T, frontL], pose);
    expect(e.z[0]).toBe(dims.PD - T);
    expect(e.z[1]).toBe(dims.PD);
    expect(e.y[0]).toBe(T);
    expect(e.y[1]).toBe(T + frontL);
  });

  it('base with y=0 covers full depth 0..PD (does not stick out the back)', () => {
    const pose = defaultPoseForPlacement('base', dims, 0, 1);
    const e = boxExtentsFromMinCorner(
      pose,
      [dims.PD, T, dims.PW - 2 * T],
      pose,
    );
    expect(e.z[0]).toBe(0);
    expect(e.z[1]).toBe(dims.PD);
    expect(e.y[0]).toBe(0);
    expect(e.y[1]).toBe(T);
  });
});
