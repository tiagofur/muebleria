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

  // --- F068: new shapes ---

  it('hinge resolves with cup diameter + depth defaults', () => {
    const hinge: Hardware = { ...knob, previewShape: 'hinge', previewDiameterMm: undefined, previewSizeMm: undefined, previewProjectionMm: undefined };
    const g = resolveHardwareGeometry(hinge, 0)!;
    expect(g.shape).toBe('hinge');
    expect(g.headDiameterMm).toBe(35); // DEFAULT_HINGE_CUP_DIAMETER_MM
    expect(g.cupDepthMm).toBe(11); // DEFAULT_HINGE_CUP_DEPTH_MM
    expect(g.armLengthMm).toBe(50); // DEFAULT_HINGE_ARM_LENGTH_MM
  });

  it('hinge reads catalog dims when present', () => {
    const hinge: Hardware = { ...knob, previewShape: 'hinge', previewDiameterMm: 40, previewProjectionMm: 13, previewSizeMm: 60 };
    const g = resolveHardwareGeometry(hinge, 0)!;
    expect(g.headDiameterMm).toBe(40);
    expect(g.cupDepthMm).toBe(13);
    expect(g.armLengthMm).toBe(60);
  });

  it('slide resolves with length + height defaults', () => {
    const slide: Hardware = { ...knob, previewShape: 'slide', previewSizeMm: undefined, previewDiameterMm: undefined };
    const g = resolveHardwareGeometry(slide, 0)!;
    expect(g.shape).toBe('slide');
    expect(g.railLengthMm).toBe(500); // DEFAULT_SLIDE_LENGTH_MM
    expect(g.railHeightMm).toBe(45); // DEFAULT_SLIDE_HEIGHT_MM
  });

  it('rail resolves with length + height defaults', () => {
    const rail: Hardware = { ...knob, previewShape: 'rail', previewSizeMm: undefined, previewDiameterMm: undefined };
    const g = resolveHardwareGeometry(rail, 0)!;
    expect(g.shape).toBe('rail');
    expect(g.railLengthMm).toBe(500); // DEFAULT_RAIL_LENGTH_MM
    expect(g.railHeightMm).toBe(30); // DEFAULT_RAIL_HEIGHT_MM
  });

  it('leg resolves with diameter + height defaults', () => {
    const leg: Hardware = { ...knob, previewShape: 'leg', previewDiameterMm: undefined, previewSizeMm: undefined };
    const g = resolveHardwareGeometry(leg, 0)!;
    expect(g.shape).toBe('leg');
    expect(g.headDiameterMm).toBe(12); // DEFAULT_LEG_DIAMETER_MM
    expect(g.legHeightMm).toBe(120); // DEFAULT_LEG_HEIGHT_MM
  });

  it('leg reads catalog dims when present', () => {
    const leg: Hardware = { ...knob, previewShape: 'leg', previewDiameterMm: 15, previewSizeMm: 150 };
    const g = resolveHardwareGeometry(leg, 0)!;
    expect(g.headDiameterMm).toBe(15);
    expect(g.legHeightMm).toBe(150);
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

// --- F080: per-part materials -------------------------------------------------

import { hardwarePartMaterials } from './HardwareMesh';

describe('hardwarePartMaterials (F080)', () => {
  const base: Hardware = {
    id: 'h1',
    code: 'HER-BAR-01',
    name: 'Tirador barra',
    unit: 'piece',
    costPerUnit: 10,
    active: true,
    previewShape: 'bar-pull',
    previewColor: '#123456',
    previewRoughness: 0.4,
    previewMetalness: 0.2,
    previewClearcoat: 0.1,
  };
  const placementStandoff = 25;
  const geom = resolveHardwareGeometry(base, placementStandoff)!;

  it('without partFinishes every part uses the global finish (legacy)', () => {
    const mats = hardwarePartMaterials(geom, base, 'present');
    expect(mats.body.color).toBe('#123456');
    expect(mats.base.color).toBe('#123456');
    expect(mats.grip.color).toBe('#123456');
  });

  it('an assigned part uses its preset color and PBR', () => {
    const mats = hardwarePartMaterials(
      geom,
      { ...base, partFinishes: { grip: 'gold', base: 'black-matte' } },
      'present',
    );
    expect(mats.grip.color).toBe('#d4a838');
    expect(mats.base.color).toBe('#1a1a1a');
    expect(mats.body.color).toBe('#123456'); // sin override → global
    // PBR follows the preset (gold: metal 0.9), no longer the global 0.2
    expect(mats.grip.metalness).toBeGreaterThan(mats.body.metalness);
  });

  it('unknown preset id falls back to the global finish', () => {
    const mats = hardwarePartMaterials(
      geom,
      { ...base, partFinishes: { body: 'no-existe' as never } },
      'present',
    );
    expect(mats.body.color).toBe('#123456');
  });

  it('selection tints every part regardless of overrides', () => {
    const mats = hardwarePartMaterials(
      geom,
      { ...base, partFinishes: { grip: 'gold' } },
      'present',
      true,
    );
    expect(mats.body.color).toBe('#3b82f6');
    expect(mats.grip.color).toBe('#3b82f6');
    expect(mats.base.color).toBe('#3b82f6');
  });
});
