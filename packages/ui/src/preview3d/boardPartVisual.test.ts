import { describe, expect, it } from 'vitest';
import type { ResolvedBoardPart } from '@muebles/domain';
import {
  boardPartToVisual,
  colorForMaterialId,
  colorForOptionRole,
  materialColorMap,
  materialPhysicalMap,
  materialTextureMap,
  resolvePartColor,
  cameraPositionForView,
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
  it('maps workshop min-corner to Three group position (with rotation offset)', () => {
    // Identity: min corner == local origin → simple remap (x,z,y).
    const id = boardPartToVisual({
      ...basePart,
      x: 10,
      y: 20,
      z: 30,
      rotateY: 0,
    });
    expect(id.position).toEqual([10, 30, 20]);

    // rotateY 90: width grows −Z; group Z is shifted by +width so min depth stays at y.
    const rotated = boardPartToVisual({
      ...basePart,
      x: 10,
      y: 20,
      z: 30,
      rotateY: 90,
    });
    // size [560, 18, 720]; offset min render (0,0,-560) → group (10, 30, 20-(-560))
    expect(rotated.position[0]).toBeCloseTo(10, 5);
    expect(rotated.position[1]).toBeCloseTo(30, 5);
    expect(rotated.position[2]).toBeCloseTo(580, 5);
    expect(rotated.size).toEqual([560, 18, 720]);
    expect(rotated.rotation[1]).toBeCloseTo(Math.PI / 2, 5);
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

  it('places isometric 3/4 above the scene center (not under floor)', () => {
    const f = sceneFraming(3000, 2400, 3000);
    const pos = cameraPositionForView('isometric', f.center, f.maxDim);
    expect(pos[1]).toBeGreaterThan(f.center[1]);
    expect(pos[0]).toBeGreaterThan(f.center[0]);
    expect(pos[2]).toBeGreaterThan(f.center[2]);
  });

  it('exposes grain and texture only in material color mode', () => {
    const textures = materialTextureMap([
      {
        id: 'mat-white',
        previewTextureUrl: '/api/media/wood.webp',
        previewTextureTileWidthMm: 400,
        previewTextureTileLengthMm: 600,
      },
    ]);
    const withGrain: ResolvedBoardPart = { ...basePart, grain: 1 };
    // Default surface is grain: grain on, no photo
    const mat = boardPartToVisual(withGrain, {
      colorMode: 'material',
      materialTextures: textures,
    });
    expect(mat.grain).toBe(1);
    expect(mat.textureUrl).toBeUndefined();

    const textured = boardPartToVisual(withGrain, {
      colorMode: 'material',
      materialTextures: textures,
      surfaceMode: 'texture',
    });
    expect(textured.textureUrl).toBe('/api/media/wood.webp');
    expect(textured.textureTileWidthMm).toBe(400);
    expect(textured.textureTileLengthMm).toBe(600);
    expect(textured.grain).toBe(0);

    const solid = boardPartToVisual(withGrain, {
      colorMode: 'material',
      materialTextures: textures,
      surfaceMode: 'color',
    });
    expect(solid.grain).toBe(0);
    expect(solid.textureUrl).toBeUndefined();

    const role = boardPartToVisual(withGrain, {
      colorMode: 'role',
      materialTextures: textures,
      surfaceMode: 'texture',
    });
    expect(role.grain).toBe(0);
    expect(role.textureUrl).toBeUndefined();
  });

  it('skips empty texture URLs in materialTextureMap', () => {
    const map = materialTextureMap([
      { id: 'a', previewTextureUrl: '  ' },
      { id: 'b', previewTextureUrl: '/api/media/x.webp' },
    ]);
    expect(map.a).toBeUndefined();
    expect(map.b?.url).toBe('/api/media/x.webp');
  });

  it('falls back to imageUrl and resolveUrl for textures', () => {
    const map = materialTextureMap(
      [
        { id: 'a', previewTextureUrl: '', imageUrl: '/api/media/foto.webp' },
        { id: 'b', previewTextureUrl: '/api/media/tex.webp', imageUrl: '/other' },
      ],
      (u) => (u ? `https://cdn${u}?t=1` : undefined),
    );
    expect(map.a?.url).toBe('https://cdn/api/media/foto.webp?t=1');
    expect(map.b?.url).toBe('https://cdn/api/media/tex.webp?t=1');
  });

  it('grain surface mode only marks materials that have veta', () => {
    const noGrain: ResolvedBoardPart = { ...basePart, grain: 0 };
    const withGrain: ResolvedBoardPart = { ...basePart, grain: 1 };
    expect(
      boardPartToVisual(noGrain, {
        colorMode: 'material',
        surfaceMode: 'grain',
      }).grain,
    ).toBe(0);
    expect(
      boardPartToVisual(withGrain, {
        colorMode: 'material',
        surfaceMode: 'grain',
      }).grain,
    ).toBe(1);
  });

  it('threads per-material PBR fields into the visual in material mode', () => {
    const physical = materialPhysicalMap([
      {
        id: 'mat-white',
        previewRoughness: 0.35,
        previewMetalness: 1,
        previewClearcoat: 0.6,
      },
    ]);
    const v = boardPartToVisual(basePart, {
      colorMode: 'material',
      materialPhysical: physical,
    });
    expect(v.previewRoughness).toBe(0.35);
    expect(v.previewMetalness).toBe(1);
    expect(v.previewClearcoat).toBe(0.6);
  });

  it('leaves PBR visual fields undefined when the material has no entry', () => {
    const physical = materialPhysicalMap([
      { id: 'other', previewRoughness: 0.4 },
    ]);
    const v = boardPartToVisual(basePart, {
      colorMode: 'material',
      materialPhysical: physical,
    });
    expect(v.previewRoughness).toBeUndefined();
    expect(v.previewMetalness).toBeUndefined();
    expect(v.previewClearcoat).toBeUndefined();
  });

  it('leaves PBR visual fields undefined in role mode', () => {
    const physical = materialPhysicalMap([
      {
        id: 'mat-white',
        previewRoughness: 0.35,
        previewMetalness: 1,
        previewClearcoat: 0.6,
      },
    ]);
    const v = boardPartToVisual(basePart, {
      colorMode: 'role',
      materialPhysical: physical,
    });
    expect(v.previewRoughness).toBeUndefined();
    expect(v.previewMetalness).toBeUndefined();
    expect(v.previewClearcoat).toBeUndefined();
  });

  it('omits materials with no finite PBR field in materialPhysicalMap', () => {
    const physical = materialPhysicalMap([
      { id: 'empty' },
      { id: 'has-one', previewMetalness: 0.8 },
      { id: 'nan-only', previewRoughness: Number.NaN },
    ]);
    expect(physical.get('empty')).toBeUndefined();
    expect(physical.get('has-one')?.metalness).toBe(0.8);
    expect(physical.get('has-one')?.roughness).toBeUndefined();
    expect(physical.get('nan-only')).toBeUndefined();
  });
});
