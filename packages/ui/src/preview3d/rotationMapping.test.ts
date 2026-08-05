/**
 * Anti-regression test for placement → rotation → axis mapping (JD-W3).
 *
 * JD-W3 (judgment-day-wip-3d-2026-07-17): the lateral placement rotation used to be
 * [90,90,0], which (with the local box [width, thickness, length] and Three Euler XYZ)
 * left the panel looking like a back panel — length on X, thickness on Z — instead of a
 * vertical side. This was never caught because there was no test asserting the actual
 * axis mapping against Three.js.
 *
 * This test validates the rotation of each placement against the real Three.js matrix
 * math, independent of rendering: it applies the Euler rotation the way R3F does and
 * checks which world axis each local dimension lands on. If anyone changes the lateral
 * rotation back to a value that doesn't produce a vertical side, this fails.
 */

import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Vector3 } from 'three';
import { defaultPoseForPlacement } from '@muebles/domain';

const dims = { PW: 600, PH: 720, PD: 560, T: 18 };

/**
 * Apply a placement rotation to the three local box axes (x=width, y=thickness,
 * z=length) and report which world axis each lands on.
 *
 * R3F feeds degrees→radians to a <group rotation={[rx,ry,rz]}> which Three interprets
 * as Euler with the default 'XYZ' order.
 */
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

/** A local axis vector "is on" a world axis if that's its dominant component. */
function dominantAxis(v: Vector3): 'X' | 'Y' | 'Z' {
  const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const i = a.indexOf(Math.max(...a));
  return ['X', 'Y', 'Z'][i] as 'X' | 'Y' | 'Z';
}

describe('placement rotation → Three.js axis mapping (JD-W3)', () => {
  it('lateral_izquierdo stands as a vertical SIDE (thick→X, length→Y, width→Z)', () => {
    const pose = defaultPoseForPlacement('lateral_izquierdo', dims, 0, 1);
    const m = axisMapping(pose.rotateX, pose.rotateY, pose.rotateZ);

    // A cabinet side is a vertical panel in the Y·Z plane, with its thin edge along X.
    expect(dominantAxis(m.thicknessAxis)).toBe('X'); // thin edge faces cabinet width
    expect(dominantAxis(m.lengthAxis)).toBe('Y'); // length (PH) stands up
    expect(dominantAxis(m.widthAxis)).toBe('Z'); // width (PD) faces depth
  });

  it('lateral_derecho stands as a vertical SIDE too', () => {
    const pose = defaultPoseForPlacement('lateral_derecho', dims, 0, 1);
    const m = axisMapping(pose.rotateX, pose.rotateY, pose.rotateZ);

    expect(dominantAxis(m.thicknessAxis)).toBe('X');
    expect(dominantAxis(m.lengthAxis)).toBe('Y');
    expect(dominantAxis(m.widthAxis)).toBe('Z');
  });

  it('trasera stays as a vertical BACK panel (thick→Z, length→Y, width→X) and grows upward', () => {
    const pose = defaultPoseForPlacement('trasera', dims, 0, 1);
    const m = axisMapping(pose.rotateX, pose.rotateY, pose.rotateZ);

    // A back panel is vertical but faces depth: thin edge along Z, face on X·Y.
    expect(dominantAxis(m.thicknessAxis)).toBe('Z');
    expect(dominantAxis(m.lengthAxis)).toBe('Y');
    expect(dominantAxis(m.widthAxis)).toBe('X');
    // The box corner (0,0,0) local must grow +Y from the pose, not -Y through
    // the floor. lengthAxis.y > 0 is the JD-W3 follow-up regression guard.
    expect(m.lengthAxis.y).toBeGreaterThan(0);
  });

  it('puerta stands vertical at the FRONT and grows upward (not through the floor)', () => {
    const pose = defaultPoseForPlacement('puerta', dims, 0, 1);
    const m = axisMapping(pose.rotateX, pose.rotateY, pose.rotateZ);

    expect(dominantAxis(m.thicknessAxis)).toBe('Z');
    expect(dominantAxis(m.lengthAxis)).toBe('Y');
    expect(dominantAxis(m.widthAxis)).toBe('X');
    // Regression: rotateX must be 270, not 90 — with 90 the door grew downward
    // (Y from -718 to 2), piercing the floor. Verified against the Three matrix.
    expect(pose.rotateX).toBe(270);
    expect(m.lengthAxis.y).toBeGreaterThan(0);
  });

  it('base stays horizontal as a BOTTOM panel (thick→Y, width→X, length→Z)', () => {
    const pose = defaultPoseForPlacement('base', dims, 0, 1);
    const m = axisMapping(pose.rotateX, pose.rotateY, pose.rotateZ);

    // A shelf/bottom lies flat: thin edge up (Y), length along depth.
    expect(dominantAxis(m.thicknessAxis)).toBe('Y');
    expect(dominantAxis(m.widthAxis)).toBe('X');
    expect(dominantAxis(m.lengthAxis)).toBe('Z');
  });
});
