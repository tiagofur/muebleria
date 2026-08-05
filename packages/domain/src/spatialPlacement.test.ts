import { describe, expect, it } from 'vitest';
import { defaultPoseForPlacement } from './spatialPlacement';

const dims = { PW: 600, PH: 720, PD: 560, T: 18 };

describe('defaultPoseForPlacement (min-corner anchors)', () => {
  it('places base and superior at back-left min corner (y=0)', () => {
    expect(defaultPoseForPlacement('base', dims, 0, 1)).toMatchObject({
      x: 18,
      y: 0,
      z: 0,
      rotateY: 90,
    });
    expect(defaultPoseForPlacement('superior', dims, 0, 1)).toMatchObject({
      x: 18,
      y: 0,
      z: 702,
      rotateY: 90,
    });
  });

  it('spreads laterals by copy index when quantity > 1', () => {
    const left0 = defaultPoseForPlacement('lateral_izquierdo', dims, 0, 2);
    const left1 = defaultPoseForPlacement('lateral_izquierdo', dims, 1, 2);
    expect(left0.x).toBe(0);
    expect(left0.rotateX).toBe(90);
    expect(left0.rotateY).toBe(180);
    expect(left0.rotateZ).toBe(90);
    expect(left1.x).toBe(582);

    const right0 = defaultPoseForPlacement('lateral_derecho', dims, 0, 2);
    const right1 = defaultPoseForPlacement('lateral_derecho', dims, 1, 2);
    expect(right0.x).toBe(582);
    expect(right1.x).toBe(0);
  });

  it('anchors single right lateral min corner at PW - T', () => {
    const right = defaultPoseForPlacement('lateral_derecho', dims, 0, 1);
    expect(right.x).toBe(582);
  });

  it('puts door min corner at front-left (x=2, y=PD) with [90,180,0]', () => {
    const door = defaultPoseForPlacement('puerta', dims, 0, 1);
    expect(door.x).toBe(2);
    expect(door.y).toBe(560);
    expect(door.z).toBe(2);
    expect(door.rotateX).toBe(90);
    expect(door.rotateY).toBe(180);
    expect(door.rotateZ).toBe(0);
  });

  it('anchors trasera/frontal on the LEFT edge (min X)', () => {
    const back = defaultPoseForPlacement('trasera', dims, 0, 1);
    expect(back).toMatchObject({
      x: 18,
      y: 0,
      z: 18,
      rotateX: 90,
      rotateY: 180,
    });
    const front = defaultPoseForPlacement('frontal', dims, 0, 1);
    expect(front).toMatchObject({
      x: 18,
      y: 542,
      rotateX: 90,
      rotateY: 180,
    });
  });
});
