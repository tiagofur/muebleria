import { describe, expect, it } from 'vitest';
import type { PlacedBoardPart, ResolvedAssembly } from '@muebles/domain';
import {
  assemblyToBoxes,
  mmToScene,
  placedBoardToBox,
} from './placedBoardGeometry';

const base: Omit<PlacedBoardPart, 'face' | 'originMm' | 'lengthMm' | 'widthMm'> =
  {
    partId: 'p1',
    description: 'Test',
    optionRole: 'INTERIOR',
    thicknessMm: 18,
    source: { kind: 'structure', structureId: 'st' },
  };

describe('placedBoardToBox', () => {
  it('maps xy face with thickness along Z', () => {
    const box = placedBoardToBox({
      ...base,
      face: 'xy',
      lengthMm: 600,
      widthMm: 720,
      originMm: { x: 0, y: 0, z: 0 },
    });
    expect(box.size).toEqual([600, 720, 18]);
    expect(box.center).toEqual([300, 360, 9]);
  });

  it('maps xz horizontal shelf', () => {
    const box = placedBoardToBox({
      ...base,
      face: 'xz',
      lengthMm: 564,
      widthMm: 560,
      originMm: { x: 18, y: 300, z: 0 },
    });
    expect(box.size).toEqual([564, 18, 560]);
    expect(box.center[0]).toBe(18 + 282);
    expect(box.center[1]).toBe(300 + 9);
    expect(box.center[2]).toBe(280);
  });

  it('maps yz lateral with thickness along X', () => {
    const box = placedBoardToBox({
      ...base,
      face: 'yz',
      lengthMm: 720,
      widthMm: 560,
      originMm: { x: 582, y: 0, z: 0 },
      thicknessMm: 18,
    });
    expect(box.size).toEqual([18, 720, 560]);
    expect(box.center).toEqual([582 + 9, 360, 280]);
  });
});

describe('assemblyToBoxes', () => {
  it('maps all boards', () => {
    const assembly: ResolvedAssembly = {
      outerMm: { width: 600, height: 720, depth: 560 },
      completeness: 'full',
      boards: [
        {
          ...base,
          partId: 'a',
          face: 'xy',
          lengthMm: 100,
          widthMm: 100,
          originMm: { x: 0, y: 0, z: 0 },
        },
        {
          ...base,
          partId: 'b',
          face: 'yz',
          lengthMm: 100,
          widthMm: 100,
          originMm: { x: 0, y: 0, z: 0 },
        },
      ],
    };
    expect(assemblyToBoxes(assembly)).toHaveLength(2);
  });
});

describe('mmToScene', () => {
  it('converts mm to meters', () => {
    expect(mmToScene(1000)).toBe(1);
    expect(mmToScene(18)).toBeCloseTo(0.018);
  });
});
