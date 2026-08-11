/**
 * @vitest-environment jsdom
 *
 * HardwareMesh — pure geometry helpers for parametric handles (Fase 2, WU4).
 *
 * jsdom has no WebGL, so the R3F <mesh>/<geometry> rendering is NOT exercised
 * (same convention as AmbientMeshes.test.tsx / BoardMeshMaterial). The pose +
 * geometry math extracted in HardwareMesh.tsx is pure, so it is unit-tested
 * directly here. A smoke check confirms HardwareMesh is an exported component.
 *
 * Actual WebGL pixel rendering is verified via the runtime harness (apps/web
 * Vite dev → a puerta with previewShape='knob') — see Work Unit Evidence.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { Hardware, ResolvedHardwarePlacement } from '@muebles/domain';
import {
  HardwareMesh,
  DEFAULT_BAR_LENGTH_MM,
  DEFAULT_KNOB_DIAMETER_MM,
  DEFAULT_PROJECTION_MM,
  degToRad,
  hardwarePlacementPosition,
  hardwarePlacementRotation,
  normalOrientationQuaternion,
  resolveHardwareGeometry,
} from './HardwareMesh';

function placement(over: Partial<ResolvedHardwarePlacement> = {}): ResolvedHardwarePlacement {
  return {
    componentInstanceId: 'c-puerta-copy-0',
    hardwareId: 'hw-knob',
    localPosition: [298, 18, 360],
    localNormal: [0, 1, 0],
    standoffMm: 25,
    scale: 1,
    rotationDeg: { x: 0, y: 0, z: 0 },
    ...over,
  };
}

describe('hardwarePlacementPosition', () => {
  it('offsets the face point by standoff along the normal (front face)', () => {
    // front center of a 596x18x720 board, normal +Y, standoff 25 → +25 on Y.
    const pos = hardwarePlacementPosition(placement({ standoffMm: 25 }));
    expect(pos).toEqual([298, 43, 360]);
  });

  it('zero standoff leaves the position on the face surface', () => {
    const pos = hardwarePlacementPosition(placement({ standoffMm: 0 }));
    expect(pos).toEqual([298, 18, 360]);
  });

  it('offsets along the normal for a side face (right, +X)', () => {
    const pos = hardwarePlacementPosition(
      placement({ localPosition: [596, 9, 360], localNormal: [1, 0, 0], standoffMm: 10 }),
    );
    expect(pos).toEqual([606, 9, 360]);
  });
});

describe('hardwarePlacementRotation', () => {
  it('converts per-axis rotationDeg to radians', () => {
    const rot = hardwarePlacementRotation(
      placement({ rotationDeg: { x: 90, y: 0, z: 45 } }),
    );
    expect(rot[0]).toBeCloseTo(Math.PI / 2, 6);
    expect(rot[1]).toBe(0);
    expect(rot[2]).toBeCloseTo(Math.PI / 4, 6);
  });

  it('defaults to zero rotation', () => {
    expect(hardwarePlacementRotation(placement())).toEqual([0, 0, 0]);
  });
});

describe('normalOrientationQuaternion', () => {
  // Cross-checked against three.js Quaternion.setFromUnitVectors(+Y, normal).
  const cases: ReadonlyArray<readonly [string, readonly [number, number, number]]> = [
    ['front', [0, 1, 0]],
    ['back', [0, -1, 0]],
    ['right', [1, 0, 0]],
    ['left', [-1, 0, 0]],
    ['top', [0, 0, 1]],
    ['bottom', [0, 0, -1]],
  ];

  for (const [face, normal] of cases) {
    it(`orients +Y onto the ${face} face normal (matches three.setFromUnitVectors)`, () => {
      const q = normalOrientationQuaternion(normal);
      const expected = new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(normal[0], normal[1], normal[2]),
      );
      // Quaternions q and -q represent the same rotation; compare the rotated
      // +Y vector instead of the components directly.
      const rotated = new Vector3(0, 1, 0).applyQuaternion(
        new Quaternion(q[0], q[1], q[2], q[3]),
      );
      const expectedRotated = new Vector3(0, 1, 0).applyQuaternion(expected);
      expect(rotated.x).toBeCloseTo(expectedRotated.x, 5);
      expect(rotated.y).toBeCloseTo(expectedRotated.y, 5);
      expect(rotated.z).toBeCloseTo(expectedRotated.z, 5);
      // ...and the rotated vector must equal the target normal.
      expect(rotated.x).toBeCloseTo(normal[0], 5);
      expect(rotated.y).toBeCloseTo(normal[1], 5);
      expect(rotated.z).toBeCloseTo(normal[2], 5);
    });
  }

  it('front face (+Y) is the identity quaternion', () => {
    expect(normalOrientationQuaternion([0, 1, 0])).toEqual([0, 0, 0, 1]);
  });
});

describe('resolveHardwareGeometry', () => {
  const knob: Hardware = {
    id: 'hw',
    code: 'HW',
    name: 'Knob',
    unit: 'piece',
    costPerUnit: 0,
    active: true,
    previewShape: 'knob',
    previewDiameterMm: 32,
    previewProjectionMm: 25,
    previewColor: '#888',
    previewMetalness: 0.9,
    previewRoughness: 0.25,
  };

  it('reads catalog dims when present (knob)', () => {
    const g = resolveHardwareGeometry(knob, 25)!;
    expect(g.shape).toBe('knob');
    expect(g.headDiameterMm).toBe(32);
    expect(g.projectionMm).toBe(25);
    expect(g.color).toBe('#888888');
    expect(g.previewMetalness).toBe(0.9);
  });

  it('applies fallback defaults when dims are missing', () => {
    const minimal: Hardware = { ...knob, previewDiameterMm: undefined, previewProjectionMm: undefined };
    const g = resolveHardwareGeometry(minimal, 0)!;
    expect(g.headDiameterMm).toBe(DEFAULT_KNOB_DIAMETER_MM);
    expect(g.projectionMm).toBe(DEFAULT_PROJECTION_MM);
  });

  it('falls back grip length/diameter for a bar-pull', () => {
    const bar: Hardware = { ...knob, previewShape: 'bar-pull', previewSizeMm: undefined, previewDiameterMm: undefined };
    const g = resolveHardwareGeometry(bar, 20)!;
    expect(g.shape).toBe('bar-pull');
    expect(g.gripLengthMm).toBe(DEFAULT_BAR_LENGTH_MM);
  });

  it('returns null for a cost-only hardware (no valid shape)', () => {
    const costOnly: Hardware = { ...knob, previewShape: undefined };
    expect(resolveHardwareGeometry(costOnly, 25)).toBeNull();
  });

  it('returns null for an invalid shape string', () => {
    const bad: Hardware = { ...knob, previewShape: 'ring' as Hardware['previewShape'] };
    expect(resolveHardwareGeometry(bad, 25)).toBeNull();
  });
});

describe('degToRad', () => {
  it('converts degrees to radians', () => {
    expect(degToRad(0)).toBe(0);
    expect(degToRad(180)).toBeCloseTo(Math.PI, 6);
    expect(degToRad(360)).toBeCloseTo(2 * Math.PI, 6);
  });
});

describe('HardwareMesh component', () => {
  it('is an exported React component (smoke; R3F render needs WebGL)', () => {
    expect(typeof HardwareMesh).toBe('function');
  });
});
