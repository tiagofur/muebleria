import { describe, expect, it } from 'vitest';

import {
  invertRigidFrame,
  isProperRigidFrame,
  pieceToSetupFrame,
  setupEnvelopeMm,
  transformDirection,
  transformPoint,
  validPieceDimensions,
  type MachiningFace,
  type RigidFrame,
} from './neutralMachiningGeometry';

const piece = { xMm: 11, yMm: 7, zMm: 3 } as const;
const cases = [
  {
    face: 'top', point: { x: 2, y: 3, z: 3 },
    axis: { x: 0, y: 0, z: -1 },
    expectedPoint: { x: 2, y: 3, z: 3 },
    envelope: { xMm: 11, yMm: 7, zMm: 3 },
  },
  {
    face: 'bottom', point: { x: 2, y: 3, z: 0 },
    axis: { x: 0, y: 0, z: 1 },
    expectedPoint: { x: 2, y: 4, z: 3 },
    envelope: { xMm: 11, yMm: 7, zMm: 3 },
  },
  {
    face: 'left', point: { x: 0, y: 3, z: 1 },
    axis: { x: 1, y: 0, z: 0 },
    expectedPoint: { x: 1, y: 3, z: 11 },
    envelope: { xMm: 3, yMm: 7, zMm: 11 },
  },
  {
    face: 'right', point: { x: 11, y: 3, z: 1 },
    axis: { x: -1, y: 0, z: 0 },
    expectedPoint: { x: 2, y: 3, z: 11 },
    envelope: { xMm: 3, yMm: 7, zMm: 11 },
  },
  {
    face: 'front', point: { x: 2, y: 0, z: 1 },
    axis: { x: 0, y: 1, z: 0 },
    expectedPoint: { x: 2, y: 1, z: 7 },
    envelope: { xMm: 11, yMm: 3, zMm: 7 },
  },
  {
    face: 'back', point: { x: 2, y: 7, z: 1 },
    axis: { x: 0, y: -1, z: 0 },
    expectedPoint: { x: 2, y: 2, z: 7 },
    envelope: { xMm: 11, yMm: 3, zMm: 7 },
  },
] as const;

describe('neutral machining geometry (#879 B2a)', () => {
  it.each(cases)('maps $face into a proper setup frame with independent expected coordinates', ({
    face, point, axis, expectedPoint, envelope,
  }) => {
    const frame = pieceToSetupFrame(face, piece);

    expect(isProperRigidFrame(frame)).toBe(true);
    expect(transformPoint(frame, point)).toEqual(expectedPoint);
    expect(transformDirection(frame, axis)).toEqual({ x: 0, y: 0, z: -1 });
    expect(setupEnvelopeMm(face, piece)).toEqual(envelope);
    expect(transformPoint(invertRigidFrame(frame), expectedPoint)).toEqual(point);
    expect(transformDirection(invertRigidFrame(frame), { x: 0, y: 0, z: -1 }))
      .toEqual(axis);
  });

  it('maps a separate symbolic candidate frame and inverts it exactly', () => {
    const setupToCandidate: RigidFrame = {
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 0, y: -1, z: 0 },
      origin: { x: 19, y: 23, z: 29 },
    };
    const setupPoint = transformPoint(pieceToSetupFrame('left', piece), cases[2].point);
    const candidatePoint = transformPoint(setupToCandidate, setupPoint);

    expect(candidatePoint).toEqual({ x: 20, y: 12, z: 32 });
    expect(transformPoint(invertRigidFrame(setupToCandidate), candidatePoint))
      .toEqual(setupPoint);
    expect(transformDirection(setupToCandidate, { x: 0, y: 0, z: -1 }))
      .toEqual({ x: 0, y: 1, z: 0 });
  });

  it('rejects reflected, scaled, sheared, and non-finite frames', () => {
    const frame = pieceToSetupFrame('top', piece);
    const invalid: RigidFrame[] = [
      { ...frame, xAxis: { x: -1, y: 0, z: 0 } },
      { ...frame, xAxis: { x: 2, y: 0, z: 0 } },
      { ...frame, yAxis: { x: 0.2, y: 1, z: 0 } },
      { ...frame, origin: { x: Number.NaN, y: 0, z: 0 } },
    ];

    for (const candidate of invalid) {
      expect(isProperRigidFrame(candidate)).toBe(false);
      expect(() => invertRigidFrame(candidate)).toThrow('INVALID_RIGID_FRAME');
    }
  });

  it('fails closed on degenerate dimensions and unsupported face values', () => {
    expect(validPieceDimensions(piece)).toBe(true);
    expect(validPieceDimensions({ ...piece, zMm: 0 })).toBe(false);
    expect(validPieceDimensions({ ...piece, xMm: Number.POSITIVE_INFINITY })).toBe(false);
    expect(() => pieceToSetupFrame('left', { ...piece, xMm: Number.NaN }))
      .toThrow('INVALID_PIECE_FRAME');
    expect(() => setupEnvelopeMm('diagonal' as MachiningFace, piece))
      .toThrow('INVALID_PIECE_FRAME');
  });
});
