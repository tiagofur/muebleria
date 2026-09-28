import { describe, expect, it } from 'vitest';

import { evaluateNeutralBoreGeometry, type NeutralBoreGeometryInput } from './neutralBoreGeometry';
import type { MachiningFace, Point3 } from './neutralMachiningGeometry';

const dimensions = { xMm: 11, yMm: 7, zMm: 3 } as const;
const faces: readonly { face: MachiningFace; point: Point3; axis: Point3; exitMm: number }[] = [
  { face: 'top', point: { x: 5, y: 3, z: 3 }, axis: { x: 0, y: 0, z: -1 }, exitMm: 3 },
  { face: 'bottom', point: { x: 5, y: 3, z: 0 }, axis: { x: 0, y: 0, z: 1 }, exitMm: 3 },
  { face: 'left', point: { x: 0, y: 3, z: 1.5 }, axis: { x: 1, y: 0, z: 0 }, exitMm: 11 },
  { face: 'right', point: { x: 11, y: 3, z: 1.5 }, axis: { x: -1, y: 0, z: 0 }, exitMm: 11 },
  { face: 'front', point: { x: 5, y: 0, z: 1.5 }, axis: { x: 0, y: 1, z: 0 }, exitMm: 7 },
  { face: 'back', point: { x: 5, y: 7, z: 1.5 }, axis: { x: 0, y: -1, z: 0 }, exitMm: 7 },
];

const input = (): NeutralBoreGeometryInput => ({
  sourceKind: 'synthetic-fixture', dimensionsMm: dimensions,
  entryFace: 'top', entryPointMm: faces[0]!.point,
  axisIntoPiece: faces[0]!.axis, diameterMm: 1, depthMm: 1, travel: 'blind',
});

describe('neutral bore geometry (#879 B2b-a)', () => {
  it.each(faces)('reports independent $face ray/box exit without assignment', ({
    face, point, axis, exitMm,
  }) => {
    const result = evaluateNeutralBoreGeometry({ ...input(), entryFace: face,
      entryPointMm: point, axisIntoPiece: axis });
    expect(result).toEqual({
      kind: 'neutral-bore-geometry', nonFabricable: true,
      receiverBlocker: 'NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED',
      geometricallyValid: true, reasons: [], rayExitMm: exitMm,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reasons)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/setupId|coverage|nativeBytes|filename|mprxe/i);
  });

  it('requires through depth to reach exit and blind depth to remain inside', () => {
    const base = input();
    const evaluate = (travel: 'blind' | 'through', depthMm: number) =>
      evaluateNeutralBoreGeometry({ ...base, travel, depthMm });
    expect(evaluate('blind', 3).reasons).toContain('BLIND_TRAVEL_EXITS_PIECE');
    expect(evaluate('blind', 100).reasons).toContain('BLIND_TRAVEL_EXITS_PIECE');
    expect(evaluate('through', 0.5).reasons).toContain('THROUGH_TRAVEL_SHORT_OF_EXIT');
    expect(evaluate('through', 3).geometricallyValid).toBe(true);
  });

  it('rejects an off-face or outside entry and a bore crossing a face edge', () => {
    const base = input();
    const evaluate = (entryPointMm: Point3, diameterMm = 1) =>
      evaluateNeutralBoreGeometry({ ...base, entryPointMm, diameterMm });
    expect(evaluate({ x: 5, y: 3, z: 2 }).reasons).toContain('ENTRY_POINT_NOT_ON_FACE');
    expect(evaluate({ x: -1, y: 3, z: 3 }).reasons).toContain('ENTRY_POINT_OUTSIDE_PIECE');
    expect(evaluate({ x: 5, y: 3, z: 3 }, 100).reasons).toContain('BORE_EXCEEDS_FACE');
    expect(evaluate({ x: 0.2, y: 3, z: 3 }).reasons).toContain('BORE_EXCEEDS_FACE');
    expect(evaluate({ x: 0.5, y: 3, z: 3 }).geometricallyValid).toBe(true);
  });

  it('blocks non-unit, outward, and angled axes without swept-bore semantics', () => {
    const base = input();
    const evaluate = (axisIntoPiece: Point3) =>
      evaluateNeutralBoreGeometry({ ...base, axisIntoPiece });
    expect(evaluate({ x: 0, y: 0, z: -2 }).reasons).toContain('AXIS_NOT_UNIT');
    expect(evaluate({ x: 0, y: 0, z: 1 }).reasons).toContain('AXIS_NOT_INWARD');
    expect(evaluate({ x: 0.6, y: 0, z: -0.8 }).reasons).toContain('ANGLED_BORE_UNPROVEN');
  });

  it('fails closed on malformed synthetic source, dimensions, and numeric fields', () => {
    const base = input();
    expect(evaluateNeutralBoreGeometry({ ...base,
      sourceKind: 'inferred' as 'synthetic-fixture',
    }).reasons).toContain('SYNTHETIC_SOURCE_REQUIRED');
    expect(evaluateNeutralBoreGeometry({ ...base,
      dimensionsMm: null as unknown as NeutralBoreGeometryInput['dimensionsMm'],
    }).reasons).toContain('INVALID_PIECE_DIMENSIONS');
    expect(evaluateNeutralBoreGeometry({ ...base,
      diameterMm: Number.POSITIVE_INFINITY,
    }).reasons).toContain('INVALID_OPERATION_GEOMETRY');
    expect(evaluateNeutralBoreGeometry({ ...base,
      entryFace: 'diagonal' as MachiningFace,
    }).reasons).toContain('INVALID_ENTRY_FACE');
  });
});
