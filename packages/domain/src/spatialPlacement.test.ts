import { describe, expect, it } from 'vitest';
import { defaultPoseForPlacement } from './spatialPlacement';

const dims = { PW: 600, PH: 720, PD: 560, T: 18 };

describe('defaultPoseForPlacement', () => {
  it('places base and superior on Z', () => {
    expect(defaultPoseForPlacement('base', dims, 0, 1)).toMatchObject({
      x: 18,
      y: 0,
      z: 0,
    });
    expect(defaultPoseForPlacement('superior', dims, 0, 1)).toMatchObject({
      x: 18,
      z: 702,
    });
  });

  it('spreads laterals by copy index when quantity > 1', () => {
    const left0 = defaultPoseForPlacement('lateral_izquierdo', dims, 0, 2);
    const left1 = defaultPoseForPlacement('lateral_izquierdo', dims, 1, 2);
    expect(left0.x).toBe(0);
    expect(left0.rotateX).toBe(90);
    expect(left0.rotateY).toBe(90);
    expect(left1.x).toBe(582);
    expect(left1.rotateY).toBe(90);

    const right0 = defaultPoseForPlacement('lateral_derecho', dims, 0, 2);
    const right1 = defaultPoseForPlacement('lateral_derecho', dims, 1, 2);
    expect(right0.x).toBe(582);
    expect(right1.x).toBe(0);
    expect(right0.rotateX).toBe(90);
    expect(right0.rotateY).toBe(90);
  });

  it('anchors single right lateral at PW - T', () => {
    const right = defaultPoseForPlacement('lateral_derecho', dims, 0, 1);
    expect(right.x).toBe(582);
  });

  it('puts door at front face', () => {
    const door = defaultPoseForPlacement('puerta', dims, 0, 1);
    expect(door.y).toBe(560);
    expect(door.rotateX).toBe(90);
  });
});
