import { describe, expect, it } from 'vitest';
import type { ResolvedBoardPart } from '@muebles/domain';
import {
  boardPartToVisual,
  colorForMaterialId,
  colorForOptionRole,
  materialColorMap,
  resolvePartColor,
  sceneFraming,
} from './boardPartVisual';

const basePart: ResolvedBoardPart = {
  id: 'p1',
  description: 'Costado',
  quantity: 1,
  lengthMm: 720,
  widthMm: 560,
  grain: 0,
  edges: [],
  optionRole: 'INTERIOR',
  materialId: 'mat-white',
  thicknessMm: 18,
  x: 0,
  y: 0,
  z: 0,
  rotateY: 90,
};

describe('boardPartVisual', () => {
  it('maps workshop axes to Three Y-up', () => {
    const v = boardPartToVisual({
      ...basePart,
      x: 10,
      y: 20,
      z: 30,
    });
    expect(v.position).toEqual([10, 30, 20]);
    expect(v.size).toEqual([560, 18, 720]);
    expect(v.rotation[1]).toBeCloseTo(Math.PI / 2, 5);
  });

  it('uses material color by default', () => {
    const colors = materialColorMap([
      { id: 'mat-white', previewColor: '#f5f5f0' },
    ]);
    const v = boardPartToVisual(basePart, {
      colorMode: 'material',
      materialColors: colors,
    });
    expect(v.color).toBe('#F5F5F0');
  });

  it('role mode ignores material color', () => {
    const colors = materialColorMap([
      { id: 'mat-white', previewColor: '#000000' },
    ]);
    expect(
      resolvePartColor(basePart, 'role', colors),
    ).toBe(colorForOptionRole('INTERIOR'));
  });

  it('falls back when material has no color', () => {
    expect(colorForMaterialId('missing', {})).toMatch(/^#/);
  });

  it('colors doors differently from interior in role mode', () => {
    expect(colorForOptionRole('FRENTE')).not.toBe(
      colorForOptionRole('INTERIOR'),
    );
  });

  it('frames camera from outer dims', () => {
    const f = sceneFraming(600, 720, 560);
    expect(f.center).toEqual([300, 360, 280]);
    expect(f.maxDim).toBe(720);
    expect(f.cameraDistance).toBeGreaterThan(f.maxDim);
  });
});
